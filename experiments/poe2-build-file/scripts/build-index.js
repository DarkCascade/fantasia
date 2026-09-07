#!/usr/bin/env node
'use strict';

// Derives the compact lookup index this tool actually ships/commits
// (data/index/*.json) from the raw upstream dumps in data/raw/ (gitignored).
// The raw tree export alone is ~5MB, mostly icon paths, flavour text and
// UI art metadata this tool never touches — this strips that down to just
// what name/id resolution and passive-tree pathfinding need.

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');
const INDEX_DIR = path.join(__dirname, '..', 'data', 'index');

function readRaw(name) {
  return JSON.parse(fs.readFileSync(path.join(RAW_DIR, name), 'utf8'));
}

function buildPassivesIndex() {
  const tree = readRaw('poe2-passive-tree.json');
  const nodes = {};
  for (const [numericId, n] of Object.entries(tree.nodes || {})) {
    if (!n || typeof n !== 'object' || !n.id) continue; // skips the placeholder "root" node
    nodes[n.id] = {
      numericId,
      skill: n.skill,
      name: n.name,
      stats: n.stats || [],
      ascendancyId: n.ascendancyId || null,
      isNotable: !!n.isNotable,
      isKeystone: !!n.isKeystone,
      isAscendancyStart: !!n.isAscendancyStart,
      isMastery: !!n.isMastery,
      isGenericAttribute: !!n.isGenericAttribute,
      isJewelSocket: !!n.isJewelSocket,
      classStartIndex: n.classStartIndex || null,
      // Adjacency for pathfinding. Both directions recorded on each node in
      // the raw export; keep both since a couple of nodes only carry one.
      in: n.in || [],
      out: n.out || [],
    };
  }

  const classes = (tree.classes || []).map((c) => ({
    name: c.name,
    ascendancies: (c.ascendancies || []).map((a) => ({ id: a.id, name: a.name })),
  }));

  return { nodeCount: Object.keys(nodes).length, nodes, classes };
}

function buildGemsIndex() {
  const files = {
    active: 'active-skill-gem.json',
    support: 'support-skill-gem.json',
    meta: 'meta-skill-gem.json',
  };
  const gems = {};
  for (const [category, file] of Object.entries(files)) {
    const data = readRaw(file);
    for (const [id, item] of Object.entries(data)) {
      gems[id] = { name: item.name, category };
    }
  }
  return gems;
}

function buildUniquesIndex() {
  const data = readRaw('uniques.json');
  const uniques = {};
  for (const entry of Object.values(data)) {
    if (entry && entry.name) uniques[entry.name] = { itemClass: entry.item_class || null };
  }
  return uniques;
}

function main() {
  fs.mkdirSync(INDEX_DIR, { recursive: true });

  const passives = buildPassivesIndex();
  fs.writeFileSync(path.join(INDEX_DIR, 'passives.json'), JSON.stringify(passives));
  console.log(`  ✓ passives.json — ${passives.nodeCount} nodes, ${passives.classes.length} classes`);

  const gems = buildGemsIndex();
  fs.writeFileSync(path.join(INDEX_DIR, 'gems.json'), JSON.stringify(gems));
  console.log(`  ✓ gems.json — ${Object.keys(gems).length} gems`);

  const uniques = buildUniquesIndex();
  fs.writeFileSync(path.join(INDEX_DIR, 'uniques.json'), JSON.stringify(uniques));
  console.log(`  ✓ uniques.json — ${Object.keys(uniques).length} uniques`);
}

if (require.main === module) {
  main();
}

module.exports = { buildPassivesIndex, buildGemsIndex, buildUniquesIndex };
