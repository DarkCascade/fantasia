'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  apiRequest,
  createCircuitBreaker,
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

    // Real MediaWiki rejects redirects=1 combined with generator=allpages
    // unless gapfilterredir=nonredirects, so content and redirect titles are
    // enumerated with two separate gapfilterredir values (mirroring the real
    // fetchAllPagesByRedirFilter calls), and redirect targets are resolved
    // via a plain (non-generator) action=query&titles=...&redirects=1 call.
    if (params.get('generator') === 'allpages') {
      const filter = params.get('gapfilterredir');
      if (filter === 'redirects') {
        res.end(JSON.stringify({ query: { pages: [{ title: redirectFrom }] } }));
        return;
      }
      const gapcontinue = params.get('gapcontinue');
      const page1 = ['Fireball Skill Gem'];
      const page2 = ['Cast on Crit Support'];
      const batch = gapcontinue ? page2 : page1;
      const body = { query: { pages: batch.map((t) => ({ title: t })) } };
      if (!gapcontinue) body.continue = { gapcontinue: 'batch2' };
      res.end(JSON.stringify(body));
      return;
    }

    if (params.get('action') === 'query' && params.get('titles')) {
      const titles = params.get('titles').split('|');
      const redirects = titles.filter((t) => t === redirectFrom).map((t) => ({ from: t, to: redirectTo }));
      res.end(JSON.stringify({ query: { redirects, pages: [] } }));
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

// Regression test: a real run against poe2wiki.net showed every title 429ing
// from its very first attempt, even ~30s after the previous title's retries
// had already exhausted — a real timed block, not a per-second burst limit.
// The old code just moved on to the next title and immediately hammered the
// server again, over and over. The circuit breaker instead pauses everything
// after a few consecutive full-title failures.
test('createCircuitBreaker trips after `threshold` consecutive failures and cools down', async () => {
  const breaker = createCircuitBreaker({ threshold: 2, initialCooldownMs: 60, maxCooldownMs: 60 });
  await breaker.waitIfCoolingDown(); // nothing recorded yet: no-op
  breaker.recordFailure(); // 1 of 2: not tripped yet
  const notCoolingElapsed = await timeIt(() => breaker.waitIfCoolingDown());
  assert.ok(notCoolingElapsed < 30, `expected no wait before threshold, waited ${notCoolingElapsed}ms`);

  breaker.recordFailure(); // 2 of 2: trips
  const coolingElapsed = await timeIt(() => breaker.waitIfCoolingDown());
  assert.ok(coolingElapsed >= 50, `expected to wait out the ~60ms cooldown, only waited ${coolingElapsed}ms`);
});

test('createCircuitBreaker resets the failure streak on success', async () => {
  const breaker = createCircuitBreaker({ threshold: 2, initialCooldownMs: 10000, maxCooldownMs: 10000 });
  breaker.recordFailure();
  breaker.recordSuccess();
  breaker.recordFailure(); // only 1 consecutive failure since the reset
  const elapsed = await timeIt(() => breaker.waitIfCoolingDown());
  assert.ok(elapsed < 30, `expected the streak to have reset, waited ${elapsed}ms`);
});

test('createCircuitBreaker doubles the cooldown on repeated trips, capped at maxCooldownMs', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, initialCooldownMs: 30, maxCooldownMs: 50 });
  breaker.recordFailure(); // trips at 30ms; next cooldown would be 60, capped to 50
  await breaker.waitIfCoolingDown();
  breaker.recordFailure(); // trips again at the capped 50ms
  const elapsed = await timeIt(() => breaker.waitIfCoolingDown());
  assert.ok(elapsed >= 40 && elapsed < 200, `expected the capped ~50ms cooldown, waited ${elapsed}ms`);
});

test('scrapeAll pauses via the circuit breaker after repeated full-title failures', async () => {
  const rateLimited = http.createServer((req, res) => {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'ratelimited' } }));
  });
  await new Promise((resolve) => rateLimited.listen(0, '127.0.0.1', resolve));
  try {
    const port = rateLimited.address().port;
    const breaker = createCircuitBreaker({ threshold: 2, initialCooldownMs: 100, maxCooldownMs: 100 });
    const elapsed = await timeIt(() =>
      scrapeAll({
        apiUrl: `http://127.0.0.1:${port}/api.php`,
        titles: ['A', 'B', 'C'],
        concurrency: 1,
        delayMs: 0,
        apiOpts: { retries: 0 },
        circuitBreaker: breaker,
        onPage: async () => {},
      })
    );
    // A, then B, fail consecutively and trip the breaker; C's request has to
    // wait out the ~100ms cooldown first, so the whole run takes noticeably
    // longer than three near-instant failed requests would on their own.
    assert.ok(elapsed >= 90, `expected the cooldown to add ~100ms, only took ${elapsed}ms`);
  } finally {
    rateLimited.close();
  }
});

async function timeIt(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}
