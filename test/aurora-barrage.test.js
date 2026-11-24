"use strict";
// Light checks on Aurora Barrage's simulation core (src/aurora-barrage/sim.js).
// Run with: node --test test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/aurora-barrage/sim.js");

test("level track: 1-4 beams, then a missile battery joins at 5 and 10 and the beams restart", () => {
  const L = (n) => { const o = S.loadout(n); return [o.beams, o.missiles]; };
  assert.deepEqual([1, 2, 3, 4].map(L), [[1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.deepEqual(L(5), [1, 1]);
  assert.deepEqual([6, 7, 8, 9].map(L), [[2, 1], [3, 1], [4, 1], [5, 1]]);
  assert.deepEqual(L(10), [1, 2]);
  assert.deepEqual(L(11), [2, 2]);
  for (const n of [1, 2, 4, 5, 9, 10, 57, S.MAX_LEVEL]) {
    const v = S.volley(n);
    assert.equal(v.length, S.loadout(n).beams);
    for (const b of v) assert.ok(Math.abs(b.ang) <= (41 * Math.PI) / 180 && Math.abs(b.dx) <= 61, `beam out of range at n=${n}`);
    assert.ok(Math.abs(v.reduce((a, b) => a + b.ang, 0)) < 1e-9, "fan is centred");
  }
  const w = new S.World({ seed: 3, level: 9 });
  w.pbolts.length = 0;
  w.fireVolley();
  assert.equal(w.pbolts.length, 5);
});

test("missile batteries launch on their cadence and the missiles home in on a target", () => {
  const w = new S.World({ seed: 5, level: 10 });
  w.player.inv = 999; w.spawnT = 999;
  w.stepDirector = () => {}; w.stepEnemies = () => {}; w.stepPlayerBolts = () => {};
  const e = w.make("gunship", 440, 260);
  e.hp = e.maxHp = 1e6; // a punching bag far off the ship's centreline
  let fired = 0, hits = 0;
  for (let i = 0; i < 60 * 6; i++) {
    w.step(S.STEP);
    for (const ev of w.drainEvents()) { if (ev.t === "missile") fired++; if (ev.t === "mhit") hits++; }
  }
  assert.ok(Math.abs(fired - (6 / S.MISSILE.interval) * 2) <= 3, "two batteries on one interval each, fired " + fired);
  assert.ok(hits >= fired - 3, `homing missiles reach an off-axis target (${hits}/${fired})`);
  assert.ok(e.hp < 1e6);
  // the knobs are live: no batteries below level 5
  const lo = new S.World({ seed: 5, level: 4 });
  for (let i = 0; i < 180; i++) lo.step(S.STEP);
  assert.equal(lo.missiles.length, 0);
});

test("xp curve is monotonic and orbs split without losing xp", () => {
  for (let l = 1; l < S.MAX_LEVEL; l++) assert.ok(S.xpNeed(l + 1) > S.xpNeed(l));
  for (const xp of [1, 7, 26, 420, 5000]) {
    const parts = S.splitXp(xp, 8);
    assert.equal(parts.reduce((a, b) => a + b, 0), xp);
    assert.ok(parts.length <= 8 + 4);
  }
});

test("collecting orbs levels the weapon up; getting hit costs hull and levels", () => {
  const w = new S.World({ seed: 1 });
  w.gainXp(S.xpNeed(1), false);
  assert.equal(w.player.level, 2);
  w.player.level = 40; w.player.xp = 0; w.player.inv = 0;
  w.hurt(0);
  assert.equal(w.player.hull, S.START_HULL - 1);
  assert.equal(w.player.level, S.levelAfterHit(40));
  assert.ok(w.player.level < 40 && w.player.level >= 30);
  assert.ok(w.orbs.length > 0, "lost levels spill recoverable orbs");
  const hull = w.player.hull;
  w.hurt(0); // invulnerable right after a hit
  assert.equal(w.player.hull, hull);
  assert.equal(S.levelAfterHit(1), 1);
});

test("an idle ship is killed by the game (it is not a screensaver) and runs are deterministic", () => {
  const run = () => {
    const w = new S.World({ seed: 42 });
    while (!w.over && w.t < 240) { w.step(S.STEP); w.drainEvents(); }
    return w;
  };
  const a = run(), b = run();
  assert.ok(a.over, "idle play must end");
  assert.equal(a.t, b.t);
  assert.equal(a.score, b.score);
  assert.equal(a.kills, b.kills);
});

test("stage flow: waves -> warning -> boss -> clear -> next stage, with a hull refund", () => {
  const w = new S.World({ seed: 5, level: 60 });
  w.player.hull = 2;
  w.phaseT = S.stageDuration(1) + 0.1;
  const seen = new Set();
  let guard = 0;
  while (w.stage === 1 && guard++ < 60 * 90) {
    w.setTarget(w.boss ? w.boss.x : w.player.x, 760);
    w.step(S.STEP);
    seen.add(w.phase);
    w.player.inv = 5; // flow test, not a survival test
  }
  assert.equal(w.stage, 2);
  for (const p of ["warn", "boss", "clear"]) assert.ok(seen.has(p), "missing phase " + p);
  assert.equal(w.bossesDown, 1);
  assert.equal(w.player.hull, 3, "boss kill repairs one hull");
});
