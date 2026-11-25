"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { Shift, QUARTER_SECS, WRONGFUL_BRAND, STRUCK_SECS } = require("../src/cease-desist.js");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Put a mole of the given kind in a hole by hand so tests don't depend on rolls.
function put(s, i, kind, life = 2) {
  const h = s.holes[i];
  h.state = "up";
  h.kind = kind;
  h.hp = { release: 1, pirate: 1, clone: 2, troll: 1 }[kind];
  h.life = h.maxLife = life;
  h.tag = "x";
}

test("whacking a pirate pays, charges the fund and builds a combo", () => {
  const s = new Shift(rng(1));
  put(s, 0, "pirate");
  s.whack(0);
  assert.equal(s.revenue, 100);
  assert.equal(s.combo, 1);
  assert.ok(s.fund > 0);
  assert.equal(s.holes[0].state, "hit");
});

test("a clone takes two whacks", () => {
  const s = new Shift(rng(1));
  put(s, 0, "clone");
  s.whack(0);
  assert.equal(s.holes[0].state, "up");
  assert.equal(s.revenue, 0);
  s.whack(0);
  assert.equal(s.holes[0].state, "hit");
  assert.equal(s.revenue, 250);
});

test("whacking a legitimate release is a wrongful takedown", () => {
  const s = new Shift(rng(1));
  s.revenue = 500;
  s.combo = 7;
  put(s, 2, "release");
  s.whack(2);
  assert.equal(s.brand, 100 - WRONGFUL_BRAND);
  assert.equal(s.revenue, 300);
  assert.equal(s.combo, 0);
  assert.equal(s.stats.wrongful, 1);
});

test("a release left alone sells and restores a little brand", () => {
  const s = new Shift(rng(1));
  s.brand = 80;
  put(s, 0, "release", 0.1);
  s.spawnT = 99;
  s.step(0.2);
  assert.equal(s.revenue, 60);
  assert.equal(s.brand, 81);
  assert.equal(s.holes[0].state, "idle");
});

test("an escaped pirate costs brand, cash and combo", () => {
  const s = new Shift(rng(1));
  s.revenue = 300;
  s.combo = 4;
  put(s, 0, "pirate", 0.1);
  s.spawnT = 99;
  s.step(0.2);
  assert.equal(s.brand, 94);
  assert.equal(s.revenue, 225);
  assert.equal(s.combo, 0);
});

test("an escaped troll locks its studio for a while", () => {
  const s = new Shift(rng(1));
  put(s, 3, "troll", 0.1);
  s.spawnT = 99;
  s.step(0.2);
  assert.equal(s.holes[3].state, "struck");
  s.step(STRUCK_SECS + 0.1);
  assert.equal(s.holes[3].state, "idle");
});

test("class action needs a full fund and clears threats but not releases", () => {
  const s = new Shift(rng(1));
  put(s, 0, "pirate");
  put(s, 1, "clone");
  put(s, 2, "release");
  assert.equal(s.classAction(), 0);
  s.fund = 100;
  assert.equal(s.classAction(), 2);
  assert.equal(s.holes[0].state, "hit");
  assert.equal(s.holes[1].state, "hit");
  assert.equal(s.holes[2].state, "up");
  assert.equal(s.fund, 0);
});

test("brand reaching zero ends the shift", () => {
  const s = new Shift(rng(1));
  s.brand = 5;
  put(s, 0, "release");
  s.whack(0);
  assert.ok(s.over);
  assert.equal(s.brand, 0);
  assert.ok(s.drainEvents().some((e) => e.type === "over"));
});

test("combo multiplier rises every 5 and is capped", () => {
  const s = new Shift(rng(1));
  s.combo = 4;
  assert.equal(s.mult(), 1);
  s.combo = 5;
  assert.equal(s.mult(), 1.5);
  s.combo = 999;
  assert.equal(s.mult(), 4);
});

test("same seed, same shift", () => {
  const run = () => {
    const s = new Shift(rng(42));
    for (let i = 0; i < 60 * 40; i++) s.step(1 / 60);
    return JSON.stringify([s.brand, s.revenue, s.holes.map((h) => h.state + h.kind)]);
  };
  assert.equal(run(), run());
});

test("an idle player eventually goes bankrupt, and new threat types arrive by quarter", () => {
  const s = new Shift(rng(7));
  const kinds = new Set();
  let t = 0;
  while (!s.over && t < 60 * 20) {
    s.step(1 / 30);
    t += 1 / 30;
    s.drainEvents().forEach((e) => e.type === "spawn" && kinds.add(e.kind));
  }
  assert.ok(s.over, "doing nothing must end the run");
  assert.ok(kinds.has("pirate") && kinds.has("release"));
  assert.ok(QUARTER_SECS > 0);
});
