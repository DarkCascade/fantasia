"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { Shift, BarShift, LEVELS, QUARTER_SECS, WRONGFUL_BRAND, STRUCK_SECS, ROW_CD, MUG_SPEED, BAR_LOCK_SECS, FAN_UNSERVED_BRAND } = require("../src/cease-desist.js");

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

/* ---------- level targets ---------- */

test("reaching the revenue target wins the level and stops the clock", () => {
  const s = new Shift(rng(1), { target: 300 });
  s.revenue = 250;
  put(s, 0, "pirate");
  s.whack(0);
  assert.ok(s.won && s.over);
  const evs = s.drainEvents();
  assert.ok(evs.some((e) => e.type === "win"));
  assert.ok(!evs.some((e) => e.type === "over"));
  const t = s.t;
  s.step(1);
  assert.equal(s.t, t, "a finished level does not tick on");
});

test("a sale can win the level too, and no target means never winning", () => {
  const s = new Shift(rng(1), { target: 100 });
  s.revenue = 60;
  put(s, 0, "release", 0.1);
  s.spawnT = 99;
  s.step(0.2);
  assert.ok(s.won);
  const free = new Shift(rng(1));
  free.revenue = 1e9;
  put(free, 0, "pirate");
  free.whack(0);
  assert.ok(!free.won);
});

test("campaign targets: level 1 is a quick one, level 2 asks for more", () => {
  assert.equal(LEVELS[0].target, 4000);
  assert.ok(LEVELS[1].target > LEVELS[0].target);
});

/* ---------- level 2: bar rush ---------- */

function cust(s, row, kind, x = 0.5, speed = 0) {
  const k = { fan: 1, pirate: 1, clone: 2, troll: 1 }[kind];
  const c = { id: s.nextId++, row, kind, hp: k, maxHp: k, x, speed };
  s.custs.push(c);
  return c;
}
function quiet(s) {
  s.spawnT = 999;
  return s;
}

test("serving a fan pays, builds a combo and heals a little", () => {
  const s = quiet(new BarShift(rng(1)));
  s.brand = 90;
  const c = cust(s, 2, "fan", 0.5);
  assert.ok(s.serve(2));
  for (let i = 0; i < 60 * 2 && s.custs.includes(c); i++) s.step(1 / 60);
  assert.ok(!s.custs.includes(c), "the fan took the mug");
  assert.equal(s.revenue, 70);
  assert.equal(s.combo, 1);
  assert.equal(s.brand, 91);
  assert.ok(s.drainEvents().some((e) => e.type === "sale"));
});

test("serving a pirate pirates the copy", () => {
  const s = quiet(new BarShift(rng(1)));
  s.revenue = 300;
  s.combo = 6;
  cust(s, 0, "pirate", 0.4);
  s.serve(0);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert.equal(s.brand, 94);
  assert.equal(s.revenue, 225);
  assert.equal(s.combo, 0);
  assert.equal(s.custs.length, 0);
  assert.ok(s.drainEvents().some((e) => e.type === "steal"));
});

test("a mug only reaches the first customer on its bartop", () => {
  const s = quiet(new BarShift(rng(1)));
  const back = cust(s, 1, "pirate", 0.2);
  const front = cust(s, 1, "fan", 0.7);
  s.serve(1);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert.ok(!s.custs.includes(front), "the fan in front got the mug");
  assert.ok(s.custs.includes(back), "the pirate behind it did not");
  assert.equal(s.brand, 100);
});

test("a mug stays in its own bartop and spills at the door", () => {
  const s = quiet(new BarShift(rng(1)));
  const other = cust(s, 3, "pirate", 0.5);
  s.serve(2);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert.ok(s.custs.includes(other));
  assert.equal(s.mugs.length, 0);
  assert.equal(s.brand, 100);
});

test("serving has a per-bartop cooldown, and a locked bartop can't serve", () => {
  const s = quiet(new BarShift(rng(1)));
  assert.ok(s.serve(0));
  assert.ok(!s.serve(0), "still cooling down");
  assert.ok(s.serve(1), "other bartops are independent");
  s.step(ROW_CD + 0.01);
  assert.ok(s.serve(0));
  s.rows[4].lock = 2;
  assert.ok(!s.serve(4));
  assert.ok(MUG_SPEED > 0);
});

test("tapping a pirate bounces it for the combo payout; a knockoff takes two", () => {
  const s = quiet(new BarShift(rng(1)));
  const p = cust(s, 0, "pirate");
  s.whackCust(p.id);
  assert.equal(s.revenue, 100);
  assert.equal(s.combo, 1);
  assert.ok(s.fund > 0);
  const k = cust(s, 1, "clone");
  s.whackCust(k.id);
  assert.ok(s.custs.includes(k));
  s.whackCust(k.id);
  assert.ok(!s.custs.includes(k));
  assert.equal(s.revenue, 350);
});

test("tapping a fan is a wrongful takedown", () => {
  const s = quiet(new BarShift(rng(1)));
  s.revenue = 500;
  s.combo = 8;
  const f = cust(s, 0, "fan");
  s.whackCust(f.id);
  assert.equal(s.brand, 100 - WRONGFUL_BRAND);
  assert.equal(s.revenue, 300);
  assert.equal(s.combo, 0);
  assert.equal(s.stats.wrongful, 1);
  assert.ok(!s.custs.includes(f));
});

test("customers reaching the counter: fans leave angry, pirates leak, trolls lock the bar", () => {
  const s = quiet(new BarShift(rng(1)));
  s.revenue = 300;
  cust(s, 0, "fan", 0.99, 1);
  cust(s, 1, "pirate", 0.99, 1);
  cust(s, 2, "troll", 0.99, 1);
  s.step(0.1);
  assert.equal(s.custs.length, 0);
  assert.equal(s.stats.unserved, 1);
  assert.equal(s.stats.leaks, 2);
  assert.equal(s.brand, 100 - FAN_UNSERVED_BRAND - 6 - 4);
  assert.equal(s.revenue, 225);
  assert.ok(s.rows[2].lock > BAR_LOCK_SECS - 0.5);
  assert.equal(s.rows[0].lock, 0);
});

test("a served troll locks its bartop", () => {
  const s = quiet(new BarShift(rng(1)));
  cust(s, 5, "troll", 0.3);
  s.serve(5);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert.ok(s.rows[5].lock > 0);
});

test("bar class action clears threats but not fans", () => {
  const s = quiet(new BarShift(rng(1)));
  cust(s, 0, "pirate");
  cust(s, 1, "clone");
  const fan = cust(s, 2, "fan");
  assert.equal(s.classAction(), 0, "needs a full fund");
  s.fund = 100;
  assert.equal(s.classAction(), 2);
  assert.deepEqual(s.custs, [fan]);
  assert.equal(s.fund, 0);
});

test("bar level can be won and lost", () => {
  const w = quiet(new BarShift(rng(1), { target: 150 }));
  const p = cust(w, 0, "pirate");
  w.whackCust(p.id);
  assert.ok(!w.won);
  const q = cust(w, 1, "pirate");
  w.whackCust(q.id);
  assert.ok(w.won && w.over);

  const l = quiet(new BarShift(rng(1)));
  l.brand = 4;
  const f = cust(l, 0, "fan");
  l.whackCust(f.id);
  assert.ok(l.over && !l.won);
});

test("bar level is deterministic, and an idle bar ends in bankruptcy", () => {
  const run = () => {
    const s = new BarShift(rng(9));
    for (let i = 0; i < 60 * 30; i++) s.step(1 / 60);
    return JSON.stringify([s.brand, s.custs.map((c) => c.kind + c.row), s.stats]);
  };
  assert.equal(run(), run());
  const s = new BarShift(rng(3));
  let t = 0;
  while (!s.over && t < 600) {
    s.step(1 / 30);
    t += 1 / 30;
  }
  assert.ok(s.over && !s.won, "doing nothing must lose");
});
