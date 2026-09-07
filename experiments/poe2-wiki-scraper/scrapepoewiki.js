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
const SAVE_EVERY = 25;
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
    concurrency: 2,
    delayMs: 300,
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
  --concurrency <n>       Parallel API requests (default: 2)
  --delay <ms>            Delay between each worker's requests (default: 300)
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
  return Math.min(1000 * 2 ** attempt, 15000);
}

async function apiRequest(apiUrl, params, { retries = 4, fetchImpl = fetch } = {}) {
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    ...params,
  }).toString();

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
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
          await sleep(backoff(attempt));
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

// Enumerates every content page once (as generator=allpages resolves
// redirects for us), plus the from->to map for every redirect encountered.
async function fetchAllTitlesAndRedirects(apiUrl, { namespaces, maxPages, apiOpts = {} }) {
  const titles = [];
  const redirects = {};
  for (const ns of namespaces) {
    let gapcontinue;
    do {
      const params = {
        action: 'query',
        generator: 'allpages',
        gapnamespace: String(ns),
        gaplimit: 'max',
        gapfilterredir: 'all',
        redirects: '1',
        prop: 'info',
      };
      if (gapcontinue) params.gapcontinue = gapcontinue;
      const data = await apiRequest(apiUrl, params, apiOpts);
      for (const p of data?.query?.pages || []) {
        if (!p.missing) titles.push(p.title);
      }
      for (const r of data?.query?.redirects || []) {
        redirects[r.from] = r.to;
      }
      gapcontinue = data?.continue?.gapcontinue;
      if (titles.length >= maxPages) gapcontinue = undefined;
    } while (gapcontinue);
  }
  const uniqueTitles = Array.from(new Set(titles)).slice(0, maxPages);
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

async function scrapeAll({ apiUrl, titles, concurrency, delayMs, alreadyScraped, onPage, apiOpts = {} }) {
  const pending = titles.filter((t) => !alreadyScraped || !(t in alreadyScraped));
  await mapWithConcurrency(pending, concurrency, async (title) => {
    try {
      const content = await fetchPageContent(apiUrl, title, apiOpts);
      if (content) await onPage(content, pending.length);
    } catch (err) {
      console.error(`  x Failed "${title}": ${err.message}`);
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
  resolveApiUrl,
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
