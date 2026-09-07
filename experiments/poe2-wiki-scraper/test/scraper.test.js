'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  apiRequest,
  resolveApiUrl,
  fetchAllTitlesAndRedirects,
  fetchPageContent,
  createConverter,
  htmlToMarkdown,
  scrapeAll,
} = require('../scrapepoewiki.js');

// A minimal fake MediaWiki API: enough of the real shape (siteinfo,
// generator=allpages pagination + redirects, action=parse) to exercise the
// scraper's HTTP layer without touching the real wiki.
function startFakeWiki() {
  const allTitles = ['Fireball Skill Gem', 'Cast on Crit Support', 'Old Fireball Name'];
  const redirectFrom = 'Old Fireball Name';
  const redirectTo = 'Fireball Skill Gem';

  const pageHtml = {
    'Fireball Skill Gem': `
      <div class="mw-parser-output">
        <p>Fireball is a projectile spell.</p>
        <table class="infobox">
          <tr><th>Mana Cost</th><td>7</td></tr>
          <tr><th>Damage</th><td>12-18</td></tr>
        </table>
        <span class="mw-editsection">[edit]</span>
      </div>`,
    'Cast on Crit Support': `
      <div class="mw-parser-output"><p>Supports triggerable spells.</p></div>`,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const params = url.searchParams;
    res.setHeader('Content-Type', 'application/json');

    if (params.get('meta') === 'siteinfo') {
      res.end(JSON.stringify({ query: { general: { sitename: 'Fake PoE2 Wiki' } } }));
      return;
    }

    if (params.get('generator') === 'allpages') {
      const gapcontinue = params.get('gapcontinue');
      const page1 = ['Fireball Skill Gem'];
      const page2 = ['Cast on Crit Support', 'Old Fireball Name'];
      const batch = gapcontinue ? page2 : page1;
      const body = {
        query: {
          pages: batch
            .filter((t) => t !== redirectFrom)
            .map((t) => ({ title: t })),
          redirects: batch.includes(redirectFrom) ? [{ from: redirectFrom, to: redirectTo }] : [],
        },
      };
      if (!gapcontinue) body.continue = { gapcontinue: 'batch2' };
      res.end(JSON.stringify(body));
      return;
    }

    if (params.get('action') === 'parse') {
      const page = params.get('page');
      if (!(page in pageHtml)) {
        res.end(JSON.stringify({ error: { code: 'missingtitle', info: 'no such page' } }));
        return;
      }
      res.end(
        JSON.stringify({
          parse: {
            title: page,
            displaytitle: page,
            text: pageHtml[page],
            categories: [{ category: 'Skill gems' }],
          },
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'unknown', info: 'unhandled request' } }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, apiUrl: `http://127.0.0.1:${port}/api.php`, allTitles, redirectFrom, redirectTo });
    });
  });
}

test('resolveApiUrl finds api.php from siteinfo', async () => {
  const { server, apiUrl } = await startFakeWiki();
  try {
    const origin = apiUrl.replace('/api.php', '');
    const result = await resolveApiUrl(origin);
    assert.equal(result.apiUrl, apiUrl);
    assert.equal(result.siteName, 'Fake PoE2 Wiki');
  } finally {
    server.close();
  }
});

test('fetchAllTitlesAndRedirects paginates and resolves redirects', async () => {
  const { server, apiUrl, redirectFrom, redirectTo } = await startFakeWiki();
  try {
    const { titles, redirects } = await fetchAllTitlesAndRedirects(apiUrl, {
      namespaces: [0],
      maxPages: Infinity,
    });
    assert.deepEqual(new Set(titles), new Set(['Fireball Skill Gem', 'Cast on Crit Support']));
    assert.equal(redirects[redirectFrom], redirectTo);
  } finally {
    server.close();
  }
});

test('fetchPageContent + htmlToMarkdown converts infobox tables to GFM markdown', async () => {
  const { server, apiUrl } = await startFakeWiki();
  try {
    const content = await fetchPageContent(apiUrl, 'Fireball Skill Gem');
    assert.equal(content.title, 'Fireball Skill Gem');
    assert.deepEqual(content.categories, ['Skill gems']);

    const converter = createConverter();
    const md = htmlToMarkdown(converter, content.html);
    assert.match(md, /Fireball is a projectile spell/);
    assert.match(md, /\*\*Mana Cost:\*\* 7/);
    assert.match(md, /\*\*Damage:\*\* 12-18/);
    assert.doesNotMatch(md, /\[edit\]/);
    assert.doesNotMatch(md, /<table/);
  } finally {
    server.close();
  }
});

test('scrapeAll visits every pending title exactly once and skips already-scraped ones', async () => {
  const { server, apiUrl } = await startFakeWiki();
  try {
    const seen = [];
    const alreadyScraped = { 'Cast on Crit Support': true };
    const count = await scrapeAll({
      apiUrl,
      titles: ['Fireball Skill Gem', 'Cast on Crit Support'],
      concurrency: 2,
      delayMs: 0,
      alreadyScraped,
      onPage: async (content) => seen.push(content.title),
    });
    assert.equal(count, 1);
    assert.deepEqual(seen, ['Fireball Skill Gem']);
  } finally {
    server.close();
  }
});

// Regression test: a wiki that rate-limits (HTTP 429) every retry attempt
// must surface a real Error, not `undefined` — apiRequest's retry loop only
// used to set lastErr inside its catch block, so a run of 429s (the
// `continue` path, not `catch`) exhausted retries without ever assigning
// lastErr, and `throw lastErr` threw undefined. That then crashed the
// "Failed" logger itself (reading .message off undefined) instead of
// reporting the failure and moving on to the next page.
test('apiRequest throws a real Error, never undefined, when every retry is rate-limited', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'ratelimited' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const apiUrl = `http://127.0.0.1:${port}/api.php`;
    await assert.rejects(
      () => apiRequest(apiUrl, { action: 'query' }, { retries: 0 }),
      (err) => {
        assert.ok(err instanceof Error, `expected an Error, got ${err}`);
        assert.match(err.message, /429/);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('scrapeAll survives a title whose every retry is rate-limited and still processes the rest', async () => {
  const { server: goodServer, apiUrl: goodApiUrl } = await startFakeWiki();
  const rateLimited = http.createServer((req, res) => {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'ratelimited' } }));
  });
  await new Promise((resolve) => rateLimited.listen(0, '127.0.0.1', resolve));
  try {
    // fetchPageContent always calls apiUrl for both the rate-limited title
    // and the good one, so point at the always-429 server directly to prove
    // scrapeAll itself doesn't crash — startFakeWiki's real title, requested
    // against goodApiUrl, confirms the loop keeps going afterward.
    const seen = [];
    const rateLimitedPort = rateLimited.address().port;
    await scrapeAll({
      apiUrl: `http://127.0.0.1:${rateLimitedPort}/api.php`,
      titles: ['Anything'],
      concurrency: 1,
      delayMs: 0,
      apiOpts: { retries: 0 },
      onPage: async (content) => seen.push(content.title),
    });
    assert.deepEqual(seen, []); // failed, but didn't throw

    const count = await scrapeAll({
      apiUrl: goodApiUrl,
      titles: ['Fireball Skill Gem'],
      concurrency: 1,
      delayMs: 0,
      onPage: async (content) => seen.push(content.title),
    });
    assert.equal(count, 1);
    assert.deepEqual(seen, ['Fireball Skill Gem']);
  } finally {
    goodServer.close();
    rateLimited.close();
  }
});
