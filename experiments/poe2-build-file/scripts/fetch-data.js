#!/usr/bin/env node
'use strict';

// Downloads the raw upstream game-data files this tool derives its
// id-lookup index from, into data/raw/ (gitignored — regenerate anytime;
// PoE2 patches change passives/gems, so this data goes stale and the whole
// pipeline — fetch, then `node scripts/build-index.js` — is meant to be
// re-run after a patch, not treated as a one-time vendor).
//
// Sources:
//  - grindinggear/poe2-skilltree-export: GGG's own repo, the exact data
//    their web passive tree planner runs on. Ground truth for passive node
//    ids/names/adjacency.
//  - repoe-fork/poe2: a community extraction of PoE2's internal game data
//    tables (in the same style as PoE1's long-established RePoE project).
//    Ground truth for skill/support gem ids/names. This repo also carries
//    hundreds of MB of art assets we don't want — fetched as individual
//    raw files below, never cloned.

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

const SOURCES = {
  'poe2-passive-tree.json':
    'https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/main/data.json',
  'active-skill-gem.json':
    'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/base_items/Active%20Skill%20Gem.json',
  'support-skill-gem.json':
    'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/base_items/Support%20Skill%20Gem.json',
  'meta-skill-gem.json':
    'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/base_items/Meta%20Skill%20Gem.json',
  'uniques.json': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/uniques.json',
};

async function fetchOne(name, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fantasia-poe2-build-file/1.0' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  JSON.parse(text); // fail fast on a bad/HTML (e.g. rate-limited) response
  fs.writeFileSync(path.join(RAW_DIR, name), text);
  console.log(`  ✓ ${name} (${(text.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  console.log('Fetching upstream PoE2 game data...');
  for (const [name, url] of Object.entries(SOURCES)) {
    await fetchOne(name, url);
  }
  console.log('\nDone. Run `node scripts/build-index.js` next to derive the lookup index.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { SOURCES };
