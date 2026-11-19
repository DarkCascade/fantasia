"use strict";
// Light checks on Aurora Barrage's simulation core (src/aurora-barrage/sim.js).
// Run with: node --test test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/aurora-barrage/sim.js");

test("weapon level is beam count: one volley fires exactly `level` symmetric beams", () => {
  for (const n of [1, 2, 3, 10, 57, S.MAX_LEVEL]) {
    const v = S.volley(n);
    assert.equal(v.length, n);
    for (const b of v) assert.ok(Math.abs(b.ang) <= (41 * Math.PI) / 180 && Math.abs(b.dx) <= 61, `beam out of range at n=${n}`);
    assert.ok(Math.abs(v.reduce((a, b) => a + b.ang, 0)) < 1e-9, "fan is centred");
  }
  const w = new S.World({ seed: 3, level: 5 });
  w.pbolts.length = 0;
  w.fireVolley();
  assert.equal(w.pbolts.length, 5);
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
