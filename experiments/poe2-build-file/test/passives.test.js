'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const passives = require('../src/passives');

test('resolves a real notable id from the real example file by its display name', () => {
  assert.equal(passives.resolvePassiveId('Essence of Virtue', { ascendancyId: 'Mercenary3' }), 'AscendancyMercenary3Notable1_');
});

test('a generic effect name can repeat even within one ascendancy — scoping alone is not always enough', () => {
  // The real example resolves this ambiguity itself by ordering allocation
  // steps rather than naming a passive in isolation: three separate
  // Mercenary3 "Small" nodes are all just named "Skill Gem Quality".
  // ascendancyId narrows the field but doesn't guarantee uniqueness.
  const matches = passives.findPassivesByName('Skill Gem Quality', { ascendancyId: 'Mercenary3' });
  assert.ok(matches.length >= 3, `expected several same-named nodes, got ${matches.length}`);
  assert.throws(() => passives.resolvePassiveId('Skill Gem Quality', { ascendancyId: 'Mercenary3' }), /ambiguous/i);
});

test('a generic filler name without ascendancy scoping is ambiguous', () => {
  assert.throws(() => passives.resolvePassiveId('Attribute'), /ambiguous/i);
});

test('an unknown passive name throws', () => {
  assert.throws(() => passives.resolvePassiveId('Not A Real Passive Name'), /no passive node/i);
});

test('resolveAscendancyId accepts either the id or the display name', () => {
  assert.deepEqual(passives.resolveAscendancyId('Mercenary3'), {
    id: 'Mercenary3',
    name: 'Gemling Legionnaire',
    className: 'Mercenary',
  });
  assert.deepEqual(passives.resolveAscendancyId('Gemling Legionnaire'), {
    id: 'Mercenary3',
    name: 'Gemling Legionnaire',
    className: 'Mercenary',
  });
});

test('getClassStartNodeId maps Mercenary to the internal "duelist" start node', () => {
  // Confirmed by BFS graph-distance in the research for this tool: every
  // Mercenary-ascendancy node clusters within 2-3 edges of duelist597,
  // versus 15+ from every other start node.
  assert.equal(passives.getClassStartNodeId('Mercenary'), 'duelist597');
});

test('shortestPath returns a real, fully-connected path between two nodes', () => {
  const path = passives.shortestPath('duelist597', 'AscendancyMercenary3Notable1_');
  assert.equal(path[0], 'duelist597');
  assert.equal(path.at(-1), 'AscendancyMercenary3Notable1_');
  assertConnected(path);
});

test('computeAllocationPath connects the start to every target, in order', () => {
  const start = passives.getClassStartNodeId('Mercenary');
  const targets = [
    passives.resolvePassiveId('Essence of Virtue', { ascendancyId: 'Mercenary3' }),
    passives.resolvePassiveId('Avatar of Fire'), // a real keystone, unrelated to the ascendancy, to prove multi-target works
  ];
  const allocation = computeAndCheck(start, targets);
  for (const t of targets) assert.ok(allocation.includes(t), `expected ${t} in the allocation`);
});

test('routes never pass through an unallocatable mastery hub', () => {
  // Before the fix, the shortest way from the Huntress start to Roll and
  // Strike stepped through "mastery_spear_6704" — an edge-connected hub
  // with no stats that the game won't let anyone allocate.
  const index = passives.loadIndex();
  const allocation = computeAndCheck('ranger596', ['spear13', 'spear18']);
  const masteries = allocation.filter((id) => index.nodes[id].isMastery);
  assert.deepEqual(masteries, []);
});

test('ordered allocation reaches targets in the order given, not nearest-first', () => {
  // Roll and Strike is ~20 nodes out, Honed Instincts ~5: nearest-first
  // takes Honed Instincts first no matter how they're listed; ordered mode
  // must honour the caller's order.
  const targets = ['spear18', 'ranger_huntress_notable2'];
  const greedy = computeAndCheck('ranger596', targets);
  const ordered = computeAndCheck('ranger596', targets, { ordered: true });
  assert.ok(greedy.indexOf('ranger_huntress_notable2') < greedy.indexOf('spear18'));
  assert.ok(ordered.indexOf('spear18') < ordered.indexOf('ranger_huntress_notable2'));
});

function computeAndCheck(start, targets, opts) {
  const allocation = passives.computeAllocationPath(start, targets, opts);
  // Every allocated node must be adjacent to some earlier node (or the
  // start) — the whole point of pathfinding is a connected, allocatable
  // route, not just "the targets, however you get there".
  const index = passives.loadIndex();
  const reachable = new Set([start]);
  for (const id of allocation) {
    const n = index.nodes[id];
    const adjacent = [...n.in, ...n.out].some((numId) => {
      for (const r of reachable) {
        if (index.nodes[r].numericId === numId) return true;
      }
      return false;
    });
    assert.ok(adjacent, `${id} is not adjacent to anything allocated before it`);
    reachable.add(id);
  }
  return allocation;
}

function assertConnected(idPath) {
  const index = passives.loadIndex();
  for (let i = 1; i < idPath.length; i++) {
    const prev = index.nodes[idPath[i - 1]];
    const cur = index.nodes[idPath[i]];
    const adjacent = [...prev.in, ...prev.out].includes(cur.numericId);
    assert.ok(adjacent, `${idPath[i - 1]} -> ${idPath[i]} are not adjacent`);
  }
}
