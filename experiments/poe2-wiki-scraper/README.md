# PoE2 wiki scraper

Crawls a MediaWiki-based wiki — by default the [Path of Exile 2 community
wiki](https://www.poe2wiki.net/) — into a single JSON file containing every
page's content, ready for an agent to read (or for `--markdown-dir` to fan
out into per-page Markdown files first).

## Why this doesn't use a browser

The version this replaced drove a headless/stealth Puppeteer browser over
every page and saved the *entire rendered document* (nav, sidebars, scripts —
everything) keyed by URL, discovering pages only by following links it found
on already-visited pages starting from one seed page. That has three real
problems for this use case: it misses any page not link-reachable from the
seed within the crawl's page cap, it bloats the output with site chrome that
just gets thrown away in the "translate to Markdown" step anyway, and it was
built against an old Puppeteer API — `page.waitForTimeout` was removed in
Puppeteer 22+, so it would have thrown immediately on the pinned
`puppeteer@^25.10.0`.

MediaWiki wikis expose a JSON API built for exactly this kind of bulk read.
This version talks to `api.php` directly:

- **Full coverage.** `action=query&generator=allpages` enumerates *every*
  page in a namespace, not just ones reachable by clicking around from one
  page. It also resolves redirects for you, so the output separates real
  content pages from a `title -> target` alias map.
- **Clean content, not a whole document.** `action=parse` returns just the
  rendered content HTML (`.mw-parser-output`, no header/nav/footer/scripts).
- **No browser, no bot-detection cat-and-mouse.** A JSON API meant for
  programmatic clients doesn't run the same anti-automation checks as the
  page itself might. If a wiki *does* firewall its API off from
  automated clients, this tool will fail fast with a clear error rather than
  silently saving challenge-page HTML — see "If it can't find api.php" below.

## Setup

```sh
npm install
```

## Usage

```sh
# Scrape the default wiki (PoE2) into ./poe2wiki-net-pages.json
node scrapepoewiki.js

# Scrape a different wiki, and also render Markdown files as you go
node scrapepoewiki.js https://www.poewiki.net/wiki/Path_of_Exile_Wiki \
  --out poe1-wiki.json --markdown-dir ./poe1-wiki-md

# Resume an interrupted run (Ctrl+C saves progress; --resume skips
# pages already in the output file on the next run)
node scrapepoewiki.js --resume --out poe2wiki-net-pages.json

# Already have a JSON dump and just want the Markdown files?
node scrapepoewiki.js --from-json poe2wiki-net-pages.json --markdown-dir ./md
```

Run `node scrapepoewiki.js --help` for the full flag list (output path,
concurrency, per-request delay, namespaces, page cap).

Ctrl+C at any point saves everything scraped so far to `--out` before
exiting — a run over a wiki with a few thousand pages doesn't have to
finish in one sitting.

## Output shape

```jsonc
{
  "meta": { "wiki": "...", "apiUrl": "...", "siteName": "...", "pageCount": 1234, ... },
  "redirects": { "Fireball": "Fireball Skill Gem" },
  "pages": {
    "Fireball Skill Gem": {
      "title": "Fireball Skill Gem",
      "url": "https://www.poe2wiki.net/wiki/Fireball_Skill_Gem",
      "categories": ["Spell skill gems", "Fire skill gems"],
      "html": "<div class=\"mw-parser-output\">...</div>",
      "markdown": "# ...already-converted Markdown..."
    }
  }
}
```

Each page's `markdown` field is already converted (via `turndown` +
`turndown-plugin-gfm`), so most consumers never need to touch `html` at all
— it's kept mainly as a fidelity fallback. One conversion detail worth
knowing: game-wiki infoboxes (item/gem stat blocks — exactly the data this
scraper exists to get at) are usually a *transposed* table — one row per
stat, label in the first cell — rather than a normal column-headers table.
`turndown-plugin-gfm` only handles the normal orientation, so this tool adds
its own rule that turns that shape into a `- **Label:** value` list instead
of leaving it as an embedded raw `<table>`.

## If it can't find `api.php`

The tool tries `<origin>/api.php` then `<origin>/w/api.php`. If neither
returns JSON, it's most likely one of:

- The wiki isn't MediaWiki-based (this tool won't work on it).
- The API is firewalled off from non-browser clients. Check by opening
  `<wiki>/api.php?action=query&meta=siteinfo&format=json` in an ordinary
  browser tab — if that also fails/challenges you, a browser-automation
  approach (like the version this replaced) is the fallback, not this one.

## Tests

```sh
npm test
```

Runs against an in-process fake MediaWiki API (`node:test` + `node:http`,
no network) covering API discovery, allpages pagination + redirect
resolution, HTML→Markdown conversion (including the infobox-table rule),
and the concurrency/resume logic.
