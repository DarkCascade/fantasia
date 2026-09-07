#!/usr/bin/env node
'use strict';

// Crawls a MediaWiki-based wiki (default: the Path of Exile 2 community wiki
// at poe2wiki.net) into a single JSON file, ready for a downstream agent to
// read directly or for the --markdown-dir flag to fan out into per-page
// Markdown files.
//
// The original version of this tool drove a headless/stealth Puppeteer
// browser over every page to grab full page.content() (nav, sidebars,
// scripts and all). MediaWiki wikis expose a JSON API meant for exactly this
// kind of bulk read, so this version talks to api.php directly: no browser,
// no bot-detection cat-and-mouse, full coverage of every page (not just ones
// reachable by following links from one seed page), and pre-cleaned content
// HTML instead of a whole rendered document. See README.md.

const fs = require('fs');
const path = require('path');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

const DEFAULT_WIKI_URL = 'https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki';
const SAVE_EVERY = 10;
const USER_AGENT =
  'fantasia-wiki-scraper/1.0 (personal research tool; run locally by a single wiki reader, not a distributed crawl)';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    wikiUrl: DEFAULT_WIKI_URL,
    out: null,
    markdownDir: null,
    maxPages: Infinity,
    concurrency: 1,
    delayMs: 2000,
    namespaces: [0],
    resume: false,
    fromJson: null,
    help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--out':
        args.out = argv[++i];
        break;
      case '--markdown-dir':
        args.markdownDir = argv[++i];
        break;
      case '--max-pages':
        args.maxPages = Number(argv[++i]);
        break;
      case '--concurrency':
        args.concurrency = Number(argv[++i]);
        break;
      case '--delay':
        args.delayMs = Number(argv[++i]);
        break;
      case '--namespaces':
        args.namespaces = argv[++i].split(',').map(Number);
        break;
      case '--resume':
        args.resume = true;
        break;
      case '--from-json':
        args.fromJson = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        positional.push(a);
    }
  }
  if (positional[0]) args.wikiUrl = positional[0];
  return args;
}

function printHelp() {
  console.log(`Usage: node scrapepoewiki.js [wikiUrl] [options]

  wikiUrl                URL of any page on the wiki (default: the PoE2 wiki
                          main page). Only its origin is used to find api.php.

Options:
  --out <file>            Output JSON path (default: <host>-pages.json)
  --markdown-dir <dir>    Also write one .md file per page (+ an _index.md)
  --max-pages <n>         Stop after this many content pages (default: all)
  --concurrency <n>       Parallel API requests (default: 1)
  --delay <ms>            Delay between each worker's requests (default: 2000)
  --namespaces <ids>      Comma-separated MediaWiki namespace ids (default: 0)
  --resume                Skip pages already present in --out's existing file
  --from-json <file>      Skip scraping; just render an existing JSON dump to
                          --markdown-dir
  --help                  Show this help
`);
}

// ---------------------------------------------------------------------------
// MediaWiki API client
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt) {
  return Math.min(1000 * 2 ** attempt, 6000);
}

// Detects a real block (a wiki-side ban/limit, not just a momentary blip):
// several *titles* in a row exhausting every retry, not merely one retried
// request. A single title retrying through a few 429s and then succeeding
// never trips this. When it does trip, everything pauses for a long,
// doubling cooldown instead of continuing to hammer the block every second
// or two — which, evidence from a real run against poe2wiki.net suggests,
// just prolongs it rather than working around it.
function createCircuitBreaker({ threshold = 2, initialCooldownMs = 60000, maxCooldownMs = 20 * 60000 } = {}) {
  let consecutiveFailures = 0;
  let cooldownMs = initialCooldownMs;
  let cooldownUntil = 0;
  return {
    async waitIfCoolingDown() {
      const wait = cooldownUntil - Date.now();
      if (wait > 0) await sleep(wait);
    },
    recordSuccess() {
      consecutiveFailures = 0;
      cooldownMs = initialCooldownMs;
    },
    recordFailure() {
      consecutiveFailures++;
      if (consecutiveFailures >= threshold) {
        cooldownUntil = Date.now() + cooldownMs;
        console.warn(
          `\n  !! ${consecutiveFailures} pages in a row were fully rate-limited — this looks like a real ` +
            `block, not a blip. Cooling everything down for ${Math.round(cooldownMs / 1000)}s before trying ` +
            `more pages (raise --delay or lower --concurrency if this keeps happening).\n`
        );
        cooldownMs = Math.min(cooldownMs * 2, maxCooldownMs);
        consecutiveFailures = 0;
      }
    },
  };
}

async function apiRequest(apiUrl, params, { retries = 2, fetchImpl = fetch } = {}) {
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    ...params,
  }).toString();

  // Always a real Error by the time we might throw it below — the 429/503
  // and maxlag branches `continue` the loop rather than throwing, so without
  // this a wiki that rate-limits every retry attempt would exhaust them
  // without lastErr ever being assigned, and `throw lastErr` would throw
  // `undefined` instead of a diagnosable error.
  let lastErr = new Error(`apiRequest: exhausted ${retries + 1} attempt(s) against ${url} with no successful response`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        // A retry wait can run to several seconds; without this a run looks
        // hung rather than backing off (this is what "getting stuck" turned
        // out to be — silent per-attempt waits, not a real freeze).
        console.warn(`  ! HTTP ${res.status}, waiting ${wait}ms before retry ${attempt + 1}/${retries + 1}...`);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Non-JSON response from ${url} (likely bot protection, a login wall, or the wrong api.php path). First 200 chars: ${text.slice(0, 200)}`
        );
      }
      if (data.error) {
        if (data.error.code === 'maxlag') {
          lastErr = new Error(`MediaWiki maxlag: ${data.error.info}`);
          const wait = backoff(attempt);
          console.warn(`  ! MediaWiki maxlag, waiting ${wait}ms before retry ${attempt + 1}/${retries + 1}...`);
          await sleep(wait);
          continue;
        }
        throw new Error(`MediaWiki API error ${data.error.code}: ${data.error.info}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoff(attempt));
    }
  }
  throw lastErr;
}

async function resolveApiUrl(origin, opts = {}) {
  const candidates = [`${origin}/api.php`, `${origin}/w/api.php`];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const data = await apiRequest(
        candidate,
        { action: 'query', meta: 'siteinfo', siprop: 'general' },
        { retries: 1, ...opts }
      );
      const sitename = data?.query?.general?.sitename;
      if (sitename) return { apiUrl: candidate, siteName: sitename };
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(
    `Could not find a working MediaWiki api.php for ${origin}.\n` +
      errors.map((e) => `  - ${e}`).join('\n') +
      `\nThe site may not run MediaWiki, or api.php may be blocked for automated clients.`
  );
}

// Pages in one namespace matching a gapfilterredir value ('nonredirects' or
// 'redirects'), following gapcontinue until exhausted.
async function fetchAllPagesByRedirFilter(apiUrl, { ns, gapfilterredir, maxPages, apiOpts = {} }) {
  const titles = [];
  let gapcontinue;
  do {
    const params = {
      action: 'query',
      generator: 'allpages',
      gapnamespace: String(ns),
      gaplimit: 'max',
      gapfilterredir,
      prop: 'info',
    };
    if (gapcontinue) params.gapcontinue = gapcontinue;
    const data = await apiRequest(apiUrl, params, apiOpts);
    for (const p of data?.query?.pages || []) {
      if (!p.missing) titles.push(p.title);
    }
    gapcontinue = data?.continue?.gapcontinue;
    if (maxPages && titles.length >= maxPages) gapcontinue = undefined;
  } while (gapcontinue);
  return titles;
}

// MediaWiki rejects `redirects=1` combined with generator=allpages unless
// gapfilterredir=nonredirects (in which case there's nothing to resolve) —
// its own error message is literally "Use gapfilterredir=nonredirects
// instead of redirects when using allpages as a generator." So the from->to
// map can't come from the same enumeration call; resolve it separately by
// batch-querying the redirect pages' titles directly (redirects=1 is fine
// there, since titles= isn't a generator).
async function resolveRedirectTargets(apiUrl, redirectTitles, apiOpts = {}) {
  const redirects = {};
  const CHUNK = 50; // the API's default (non-bot) titles= batch limit
  for (let i = 0; i < redirectTitles.length; i += CHUNK) {
    const chunk = redirectTitles.slice(i, i + CHUNK);
    const data = await apiRequest(apiUrl, { action: 'query', titles: chunk.join('|'), redirects: '1' }, apiOpts);
    for (const r of data?.query?.redirects || []) {
      redirects[r.from] = r.to;
    }
  }
  return redirects;
}

async function fetchAllTitlesAndRedirects(apiUrl, { namespaces, maxPages, apiOpts = {} }) {
  const titles = [];
  const redirectTitles = [];
  for (const ns of namespaces) {
    titles.push(...(await fetchAllPagesByRedirFilter(apiUrl, { ns, gapfilterredir: 'nonredirects', maxPages, apiOpts })));
    redirectTitles.push(...(await fetchAllPagesByRedirFilter(apiUrl, { ns, gapfilterredir: 'redirects', apiOpts })));
  }
  const uniqueTitles = Array.from(new Set(titles)).slice(0, maxPages);
  const redirects = await resolveRedirectTargets(apiUrl, Array.from(new Set(redirectTitles)), apiOpts);
  return { titles: uniqueTitles, redirects };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

async function fetchPageContent(apiUrl, title, apiOpts = {}) {
  const data = await apiRequest(
    apiUrl,
    { action: 'parse', page: title, prop: 'text|categories|displaytitle', redirects: '1' },
    apiOpts
  );
  const parse = data.parse;
  if (!parse) return null;
  return {
    title: parse.title,
    displayTitle: stripTags(parse.displaytitle || parse.title),
    html: parse.text || '',
    categories: (parse.categories || []).map((c) => c.category),
  };
}

// ---------------------------------------------------------------------------
// HTML -> Markdown
// ---------------------------------------------------------------------------

function createConverter() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  });
  td.use(gfm);
  td.remove(['style', 'script']);
  // Strip MediaWiki chrome that has no business in an agent-facing doc:
  // per-heading [edit] links, navboxes, and "jump to" accessibility links.
  td.addRule('stripWikiChrome', {
    filter: (node) => {
      const cls = (node.getAttribute && node.getAttribute('class')) || '';
      return /\bmw-editsection\b|\bnavbox\b|\bmw-jump-link\b|\bmw-empty-elt\b/.test(cls);
    },
    replacement: () => '',
  });
  // Game-wiki infoboxes (item/gem stat blocks — exactly the data worth
  // scraping this wiki for) are almost always a *transposed* table: one row
  // per attribute, label in a <th>, value in a <td>. turndown-plugin-gfm's
  // table rule only recognizes the normal orientation (one header row across
  // the top) and otherwise leaves the table as raw embedded HTML, so give
  // this shape its own rule rendering each row as a "**Label:** value" line.
  // Registered after td.use(gfm): turndown checks custom rules newest-first,
  // so this runs before (and, via its filter, only overrides) gfm's table
  // rule for this specific shape.
  td.addRule('keyValueInfobox', {
    filter: (node) => {
      if (node.nodeName !== 'TABLE') return false;
      const rows = Array.from(node.children)
        .flatMap((el) => (el.nodeName === 'TBODY' ? Array.from(el.children) : [el]))
        .filter((el) => el.nodeName === 'TR');
      if (!rows.length) return false;
      return rows.every((row) => {
        const cells = Array.from(row.children).filter((el) => el.nodeName === 'TH' || el.nodeName === 'TD');
        return cells.length >= 1 && cells[0].nodeName === 'TH';
      });
    },
    replacement: (content, node) => {
      const rows = Array.from(node.children)
        .flatMap((el) => (el.nodeName === 'TBODY' ? Array.from(el.children) : [el]))
        .filter((el) => el.nodeName === 'TR');
      const lines = rows.map((row) => {
        const cells = Array.from(row.children).filter((el) => el.nodeName === 'TH' || el.nodeName === 'TD');
        const label = cells[0].textContent.trim();
        const value = cells
          .slice(1)
          .map((c) => c.textContent.trim())
          .filter(Boolean)
          .join(' — ');
        return value ? `- **${label}:** ${value}` : `- **${label}**`;
      });
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });
  return td;
}

function htmlToMarkdown(converter, html) {
  return converter.turndown(html || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Crawl orchestration
// ---------------------------------------------------------------------------

async function mapWithConcurrency(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function scrapeAll({ apiUrl, titles, concurrency, delayMs, alreadyScraped, onPage, apiOpts = {}, circuitBreaker }) {
  const pending = titles.filter((t) => !alreadyScraped || !(t in alreadyScraped));
  const breaker = circuitBreaker || createCircuitBreaker();
  await mapWithConcurrency(pending, concurrency, async (title) => {
    await breaker.waitIfCoolingDown();
    try {
      const content = await fetchPageContent(apiUrl, title, apiOpts);
      breaker.recordSuccess();
      if (content) await onPage(content, pending.length);
    } catch (err) {
      breaker.recordFailure();
      console.error(`  x Failed "${title}": ${err && err.message ? err.message : String(err)}`);
    }
    if (delayMs) await sleep(delayMs);
  });
  return pending.length;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function atomicWriteJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function defaultOutFile(origin) {
  const host = new URL(origin).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
  return `${host}-pages.json`;
}

function encodeWikiTitleForUrl(title) {
  return encodeURIComponent(title.replace(/ /g, '_'))
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%27/gi, "'")
    .replace(/%2C/gi, ',');
}

function slugify(title) {
  return title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function writeMarkdownFiles(output, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const indexLines = [`# ${output.meta.siteName || output.meta.wiki} — page index`, ''];
  for (const [title, page] of Object.entries(output.pages)) {
    const file = path.join(dir, `${slugify(title)}.md`);
    const header = `# ${page.displayTitle || title}\n\nSource: ${page.url}\n\n`;
    fs.writeFileSync(file, header + page.markdown + '\n');
    const cats = page.categories && page.categories.length ? ` — _${page.categories.join(', ')}_` : '';
    indexLines.push(`- [${title}](./${slugify(title)}.md)${cats}`);
  }
  const redirectEntries = Object.entries(output.redirects || {});
  if (redirectEntries.length) {
    indexLines.push('', '## Redirects', '');
    for (const [from, to] of redirectEntries) indexLines.push(`- ${from} → ${to}`);
  }
  fs.writeFileSync(path.join(dir, '_index.md'), indexLines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.fromJson) {
    if (!args.markdownDir) throw new Error('--from-json requires --markdown-dir');
    const output = JSON.parse(fs.readFileSync(args.fromJson, 'utf8'));
    writeMarkdownFiles(output, args.markdownDir);
    console.log(`Wrote markdown for ${Object.keys(output.pages).length} pages to ${args.markdownDir}`);
    return;
  }

  const origin = new URL(args.wikiUrl).origin;
  console.log(`Resolving MediaWiki API for ${origin} ...`);
  const { apiUrl, siteName } = await resolveApiUrl(origin);
  console.log(`Found API at ${apiUrl} (${siteName})`);

  const outFile = args.out || defaultOutFile(origin);
  let output = { meta: {}, redirects: {}, pages: {} };
  if (args.resume && fs.existsSync(outFile)) {
    output = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    console.log(`Resuming: ${Object.keys(output.pages).length} pages already saved in ${outFile}.`);
  }

  console.log(`Enumerating pages in namespace(s) ${args.namespaces.join(',')} ...`);
  const { titles, redirects } = await fetchAllTitlesAndRedirects(apiUrl, {
    namespaces: args.namespaces,
    maxPages: args.maxPages,
  });
  Object.assign(output.redirects, redirects);
  console.log(`Found ${titles.length} content pages (+${Object.keys(redirects).length} redirects).`);

  const converter = createConverter();
  let scraped = 0;

  const flush = () => atomicWriteJson(outFile, output);
  let interrupted = false;
  const onSignal = () => {
    if (interrupted) process.exit(1);
    interrupted = true;
    console.log(`\n\nInterrupted — saving ${Object.keys(output.pages).length} pages to ${outFile} ...`);
    flush();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  await scrapeAll({
    apiUrl,
    titles,
    concurrency: args.concurrency,
    delayMs: args.delayMs,
    alreadyScraped: output.pages,
    onPage: async (content, totalPending) => {
      output.pages[content.title] = {
        title: content.title,
        displayTitle: content.displayTitle,
        url: `${origin}/wiki/${encodeWikiTitleForUrl(content.title)}`,
        categories: content.categories,
        html: content.html,
        markdown: htmlToMarkdown(converter, content.html),
      };
      scraped++;
      console.log(`[${scraped}/${totalPending}] ${content.title}`);
      if (scraped % SAVE_EVERY === 0) flush();
    },
  });

  output.meta = {
    wiki: origin,
    apiUrl,
    siteName,
    scrapedAt: new Date().toISOString(),
    pageCount: Object.keys(output.pages).length,
    redirectCount: Object.keys(output.redirects).length,
    namespaces: args.namespaces,
  };
  flush();
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  console.log(`\nDone. Saved ${Object.keys(output.pages).length} pages to ${outFile}`);

  if (args.markdownDir) {
    writeMarkdownFiles(output, args.markdownDir);
    console.log(`Wrote markdown files to ${args.markdownDir}`);
  }
}

module.exports = {
  parseArgs,
  apiRequest,
  createCircuitBreaker,
  resolveApiUrl,
  fetchAllPagesByRedirFilter,
  resolveRedirectTargets,
  fetchAllTitlesAndRedirects,
  fetchPageContent,
  createConverter,
  htmlToMarkdown,
  mapWithConcurrency,
  scrapeAll,
  defaultOutFile,
  encodeWikiTitleForUrl,
  slugify,
  writeMarkdownFiles,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
