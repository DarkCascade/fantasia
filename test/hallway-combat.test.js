"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { World, CONFIG } = require("../src/hallway-combat/sim.js");

const DT = 1 / 60;

function run(seed, seconds) {
  const w = new World({ seed });
  const log = { events: [], minKnightHp: w.knight.hp, phases: new Set(), minGapAtSwing: Infinity, maxGapAtSwing: 0 };
  for (let i = 0; i < seconds / DT; i++) {
    w.step(DT);
    log.phases.add(w.phase);
    log.minKnightHp = Math.min(log.minKnightHp, w.knight.hp);
    for (const e of w.drainEvents()) {
      log.events.push(Object.assign({ t: w.time }, e));
      if (e.type === "swing") {
        const gap = Math.abs(w.orc.x - w.knight.x);
        log.minGapAtSwing = Math.min(log.minGapAtSwing, gap);
        log.maxGapAtSwing = Math.max(log.maxGapAtSwing, gap);
      }
    }
  }
  return { w, log };
}

test("the loop repeats: walk -> fight -> dying -> walk, many orcs", () => {
  const { w, log } = run(7, 120);
  assert.ok(w.kills >= 10, "expected at least 10 orcs in two minutes, got " + w.kills);
  for (const p of ["walk", "fight", "dying"]) assert.ok(log.phases.has(p), "phase " + p + " never seen");
  const count = (type) => log.events.filter((e) => e.type === type).length;
  assert.strictEqual(count("spawn"), count("engage") + (w.orc && w.phase === "walk" ? 1 : 0));
  assert.strictEqual(count("death"), w.kills);
});

test("the knight is overpowered: he never comes close to dying", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { log } = run(seed, 90);
    assert.ok(log.minKnightHp > 40, "seed " + seed + " dropped the knight to " + log.minKnightHp);
  }
});

test("the orc is not a pushover: it lands hits across a run", () => {
  const { log } = run(3, 120);
  const orcHits = log.events.filter((e) => e.type === "hit" && e.by === "orc");
  const knightHits = log.events.filter((e) => e.type === "hit" && e.by === "knight");
  assert.ok(orcHits.length > 0, "orc never hit");
  assert.ok(knightHits.length > orcHits.length * 2, "knight should out-hit the orc by a wide margin");
});

test("swings are strictly in place: only inside melee range, damage within bounds", () => {
  const { log } = run(11, 120);
  assert.ok(log.maxGapAtSwing <= CONFIG.knight.range + 1e-9);
  for (const e of log.events.filter((e) => e.type === "hit")) {
    const spec = e.by === "knight" ? CONFIG.knight : CONFIG.orc;
    assert.ok(e.dmg >= spec.dmg[0] && e.dmg <= spec.dmg[1]);
  }
});

test("a dead orc never lands a blow, and the orc fades in rather than popping in", () => {
  const w = new World({ seed: 5 });
  let sawPartialFade = false;
  let deadSwings = 0;
  for (let i = 0; i < 120 / DT; i++) {
    w.step(DT);
    if (w.orc && w.orc.alive && w.orc.alpha > 0 && w.orc.alpha < 1) sawPartialFade = true;
    for (const e of w.drainEvents()) {
      if (e.type === "hit" && e.by === "orc" && w.phase === "dying") deadSwings++;
    }
  }
  assert.ok(sawPartialFade, "orc should fade in over several frames");
  assert.strictEqual(deadSwings, 0);
});

test("determinism: the same seed gives the same run", () => {
  const a = run(42, 60);
  const b = run(42, 60);
  assert.deepStrictEqual(a.log.events, b.log.events);
});
