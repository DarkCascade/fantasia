// Unit tests for Daily Dungeon's daily generator (generateCandidate in src/daily-dungeon/sim.js).
// Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/daily-dungeon/sim.js");
const D = require("../src/daily-dungeon/daily.js");

const SWEEP = Array.from({ length: 1000 }, (_, i) => D.seedString(D.dayKeyForNumber(i + 1, "2026-11-14"), i % 3));

function sweepDays() {
  return SWEEP.map((s) => S.generateCandidate(s));
}

test("the same seed gives a deep-equal day", () => {
  for (const s of ["2026-11-14", "2026-11-14#1", "2027-02-29#3", "anything"]) {
    const a = S.generateCandidate(s);
    const b = S.generateCandidate(s);
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  }
});

test("different seeds vary", () => {
  const days = sweepDays();
  const distinct = new Set(days.map((d) => JSON.stringify({ ...d, seed: null })));
  assert.ok(distinct.size > 500, `only ${distinct.size} distinct days in 1,000 seeds`);
  // reseeds of one date differ too
  const reseeds = new Set([0, 1, 2, 3, 4].map((n) => JSON.stringify({ ...S.generateCandidate(D.seedString("2026-11-14", n)), seed: null })));
  assert.ok(reseeds.size >= 4);
});

test("output shape: five makeRoom() rooms, Rumors, hidden rooms, roster, missing, seed", () => {
  const d = S.generateCandidate("2026-11-14");
  assert.deepEqual(Object.keys(d).sort(), ["hidden", "missing", "rooms", "roster", "rumors", "seed"]);
  assert.equal(d.seed, "2026-11-14");
  assert.equal(d.rooms.length, 5);
  for (const r of d.rooms) assert.deepEqual(r, S.makeRoom(r.type, r.variant));
  assert.deepEqual(Object.keys(d.rumors), ["3", "4"]);
  assert.deepEqual(Object.keys(d.hidden), ["3", "4"]);
});

test("every invariant holds across 1,000 seeds", () => {
  for (const d of sweepDays()) {
    const [r1, r2, r3, r4, r5] = d.rooms;
    // room 5 is always the boss; rooms 1–2 never are
    assert.equal(r5.type, "boss");
    assert.notEqual(r1.type, "boss");
    assert.notEqual(r2.type, "boss");
    assert.ok(S.GEN.visibleTypes.includes(r1.type) && S.GEN.visibleTypes.includes(r2.type));
    // room 1 is a lowest-damage visible type; room 2 never repeats its variant
    const minDmg = Math.min(...S.GEN.visibleTypes.map((t) => S.TUNE.rooms[t].damage));
    assert.equal(r1.damage, minDmg, `${d.seed}: room 1 ${r1.type}`);
    assert.notEqual(r2.variant, r1.variant, `${d.seed}: room 2 repeats room 1`);
    // rooms 3–4 are one of their Rumor's two options, and hidden mirrors them
    for (const [n, room] of [[3, r3], [4, r4]]) {
      const rumor = S.rumorById(d.rumors[n]);
      const opt = rumor.options.find((o) => o.type === room.type);
      assert.ok(opt, `${d.seed}: room ${n} ${room.type} is not an option of ${rumor.id}`);
      if (opt.variant !== null) assert.equal(room.variant, opt.variant);
      assert.deepEqual(d.hidden[n], { type: room.type, variant: room.variant });
    }
    // unpinned rooms never reuse a variant already placed that day
    const pinned = new Set(S.RUMORS.flatMap((r) => r.options.map((o) => o.variant)).filter(Boolean));
    const seen = [];
    d.rooms.forEach((r, i) => {
      const isPinned = (i === 2 || i === 3) && pinned.has(r.variant) && S.rumorById(d.rumors[i + 1]).options.some((o) => o.variant === r.variant);
      if (!isPinned) assert.ok(!seen.includes(r.variant), `${d.seed}: ${r.variant} repeats`);
      seen.push(r.variant);
    });
    // roster: 5–6 unique heroes; `missing` names the absent one
    assert.ok(d.roster.length === 5 || d.roster.length === 6);
    assert.equal(new Set(d.roster).size, d.roster.length);
    for (const h of d.roster) assert.ok(S.HERO_IDS.includes(h));
    if (d.roster.length === 6) assert.equal(d.missing, null);
    else {
      assert.ok(S.HERO_IDS.includes(d.missing));
      assert.ok(!d.roster.includes(d.missing));
    }
    assert.deepEqual(d.roster, S.HERO_IDS.filter((h) => h !== d.missing)); // canonical order
  }
});

test("sweep: no dead table entries across 1,000 seeds", () => {
  const types = new Set();
  const variants = new Set();
  const rumorOptions = new Set(); // "rumorId:type"
  const rumorsSeen = new Set();
  const sizes = new Set();
  const missing = new Set();
  const room1Types = new Set();
  let sameRumor = 0;
  let diffRumor = 0;
  for (const d of sweepDays()) {
    d.rooms.forEach((r) => {
      types.add(r.type);
      variants.add(r.variant);
    });
    room1Types.add(d.rooms[0].type);
    for (const n of [3, 4]) {
      rumorsSeen.add(d.rumors[n]);
      rumorOptions.add(d.rumors[n] + ":" + d.hidden[n].type);
    }
    if (d.rumors[3] === d.rumors[4]) sameRumor++;
    else diffRumor++;
    sizes.add(d.roster.length);
    if (d.missing) missing.add(d.missing);
  }
  assert.deepEqual([...types].sort(), [...S.ROOM_TYPE_IDS].sort(), "every room type");
  const allVariants = S.ROOM_TYPE_IDS.flatMap((t) => S.roomType(t).variants.map((v) => v.id));
  assert.deepEqual([...variants].sort(), allVariants.sort(), "every variant");
  assert.deepEqual([...rumorsSeen].sort(), [...S.RUMOR_IDS].sort(), "every Rumor");
  const allOptions = S.RUMORS.flatMap((r) => r.options.map((o) => r.id + ":" + o.type));
  assert.deepEqual([...rumorOptions].sort(), allOptions.sort(), "both options of every Rumor");
  assert.deepEqual([...room1Types].sort(), ["ambush", "trap"], "both lowest-damage types lead");
  assert.ok(sameRumor > 0 && diffRumor > 0, `Rumor repeats ${sameRumor}, differs ${diffRumor}`);
  assert.deepEqual([...sizes].sort(), [5, 6], "both roster sizes");
  assert.deepEqual([...missing].sort(), [...S.HERO_IDS].sort(), "every hero is left out at least once");
});

test("room 1 follows the tune: a unique minimum-damage type always leads", () => {
  const t = S.withTune({ rooms: { trap: { damage: 1 } } });
  const days = SWEEP.slice(0, 200).map((s) => S.generateCandidate(s, t));
  for (const d of days) {
    assert.equal(d.rooms[0].type, "trap");
    assert.equal(d.rooms[0].damage, 1);
  }
  const t2 = S.withTune({ rooms: { swarm: { damage: 1 }, magic: { damage: 1 } } });
  const leads = new Set(SWEEP.slice(0, 200).map((s) => S.generateCandidate(s, t2).rooms[0].type));
  assert.deepEqual([...leads].sort(), ["magic", "swarm"]);
});

test("a tune override changes room numbers, not the stream's other choices", () => {
  // Same minimum-damage set, so every choice is identical; only numbers move.
  const t = S.withTune({ rooms: { elite: { damage: 6, time: 33 }, boss: { time: 50 } } });
  for (const s of SWEEP.slice(0, 100)) {
    const a = S.generateCandidate(s);
    const b = S.generateCandidate(s, t);
    assert.deepEqual(b.rooms.map((r) => r.variant), a.rooms.map((r) => r.variant));
    assert.deepEqual(b.roster, a.roster);
    assert.deepEqual(b.rumors, a.rumors);
    for (const r of b.rooms) assert.deepEqual(r, S.makeRoom(r.type, r.variant, t));
  }
});

test("the day is deeply frozen", () => {
  const d = S.generateCandidate("2026-11-14");
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.rooms) && Object.isFrozen(d.rooms[0]));
  assert.ok(Object.isFrozen(d.rumors) && Object.isFrozen(d.hidden[3]) && Object.isFrozen(d.roster));
  assert.throws(() => {
    d.rooms[0].damage = 99;
  }, TypeError);
});

test("GEN is deep-frozen and describes the generator", () => {
  assert.ok(Object.isFrozen(S.GEN) && Object.isFrozen(S.GEN.visibleTypes) && Object.isFrozen(S.GEN.drawOrder));
  assert.deepEqual([...S.GEN.visibleTypes].sort(), ["ambush", "elite", "magic", "swarm", "trap"]);
  assert.ok(S.GEN.fullRosterChance > 0 && S.GEN.fullRosterChance < 1);
  assert.equal(S.GEN.drawOrder.length, 13);
});

test("the generator uses exactly 13 draws, whatever the seed (CONTRACT)", () => {
  // Wrap the real createRng so every draw is counted.
  const real = D.createRng;
  let draws = 0;
  D.createRng = (seed) => {
    const rng = real(seed);
    for (const k of ["float", "pick", "int", "chance", "shuffle"]) {
      const f = rng[k];
      rng[k] = (...a) => {
        draws++;
        return f(...a);
      };
    }
    return rng;
  };
  try {
    for (const s of SWEEP.slice(0, 300)) {
      draws = 0;
      S.generateCandidate(s);
      assert.equal(draws, S.GEN.drawOrder.length, s);
    }
  } finally {
    D.createRng = real;
  }
});

test("generateCandidate never reads Math.random or Date", () => {
  const rnd = Math.random;
  const RealDate = global.Date;
  Math.random = () => {
    throw new Error("Math.random called");
  };
  global.Date = function () {
    throw new Error("Date called");
  };
  global.Date.now = global.Date;
  try {
    S.generateCandidate("2026-11-14");
    S.generateCandidate("2026-11-14#7");
  } finally {
    Math.random = rnd;
    global.Date = RealDate;
  }
});

test("bad seeds throw", () => {
  assert.throws(() => S.generateCandidate(), /non-empty string/);
  assert.throws(() => S.generateCandidate(""), /non-empty string/);
  assert.throws(() => S.generateCandidate(20261114), /non-empty string/);
});

// GOLDEN: every player's dungeon is this stream. If this fails, the draw order
// or a candidate list changed (see the CONTRACT above generateCandidate): the
// fix is almost never to update these days. The tune is pinned here so an M1
// retune of TUNE's numbers doesn't read as a stream change.
const GOLDEN_TUNE = S.withTune({
  rooms: {
    trap: { damage: 2, time: 10 },
    swarm: { damage: 3, time: 30 },
    magic: { damage: 3, time: 25 },
    elite: { damage: 4, time: 30 },
    ambush: { damage: 2, time: 15 },
    boss: { damage: 5, time: 40 },
  },
});

function room(type, variant, name, target, damage, time) {
  return { type, variant, name, target, damage, time };
}

const GOLDEN = {
  "2026-11-14": {
    seed: "2026-11-14",
    rooms: [
      room("trap", "pit-trap", "Pit Trap", "slot1", 2, 10),
      room("magic", "arcane-storm", "Arcane Storm", "front", 3, 25),
      room("magic", "haunted-library", "Haunted Library", "front", 3, 25),
      room("elite", "ogre-brute", "Ogre Brute", "front", 4, 30),
      room("boss", "the-lich", "The Lich", "front", 5, 40),
    ],
    rumors: { 3: "ozone", 4: "whispers" },
    hidden: { 3: { type: "magic", variant: "haunted-library" }, 4: { type: "elite", variant: "ogre-brute" } },
    roster: ["knight", "rogue", "mage", "cleric", "ranger", "berserker"],
    missing: null,
  },
  "2026-11-14#1": {
    seed: "2026-11-14#1",
    rooms: [
      room("trap", "spike-trap", "Spike Trap", "slot1", 2, 10),
      room("magic", "arcane-storm", "Arcane Storm", "front", 3, 25),
      room("elite", "ogre-brute", "Ogre Brute", "front", 4, 30),
      room("ambush", "bandit-ambush", "Bandit Ambush", "slot4", 2, 15),
      room("boss", "the-bone-dragon", "The Bone Dragon", "front", 5, 40),
    ],
    rumors: { 3: "bones", 4: "whispers" },
    hidden: { 3: { type: "elite", variant: "ogre-brute" }, 4: { type: "ambush", variant: "bandit-ambush" } },
    roster: ["knight", "rogue", "mage", "cleric", "ranger", "berserker"],
    missing: null,
  },
  "2026-11-17": {
    seed: "2026-11-17",
    rooms: [
      room("trap", "spike-trap", "Spike Trap", "slot1", 2, 10),
      room("magic", "arcane-storm", "Arcane Storm", "front", 3, 25),
      room("swarm", "skeleton-horde", "Skeleton Horde", "front", 3, 30),
      room("magic", "wisp-circle", "Wisp Circle", "front", 3, 25),
      room("boss", "the-lich", "The Lich", "front", 5, 40),
    ],
    rumors: { 3: "bones", 4: "ozone" },
    hidden: { 3: { type: "swarm", variant: "skeleton-horde" }, 4: { type: "magic", variant: "wisp-circle" } },
    roster: ["knight", "rogue", "cleric", "ranger", "berserker"],
    missing: "mage",
  },
};

test("golden days: the stream is pinned for fixed seeds", () => {
  for (const [seed, expected] of Object.entries(GOLDEN)) assert.deepEqual(S.generateCandidate(seed, GOLDEN_TUNE), expected, seed);
});

test("browser path: daily.js then sim.js in one context generates through the globals", () => {
  const dir = path.join(__dirname, "../src/daily-dungeon");
  const sandbox = {};
  sandbox.self = sandbox; // a browser's `self` is the window
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, "daily.js"), "utf8"), sandbox, { filename: "daily.js" });
  vm.runInContext(fs.readFileSync(path.join(dir, "sim.js"), "utf8"), sandbox, { filename: "sim.js" });
  assert.ok(sandbox.DailyPlumbing && sandbox.DailyDungeonSim);
  const G = sandbox.DailyDungeonSim;
  // vm objects come from another realm, so compare as JSON
  for (const seed of Object.keys(GOLDEN))
    assert.equal(JSON.stringify(G.generateCandidate(seed)), JSON.stringify(S.generateCandidate(seed)), seed);
});

test("browser path without daily.js: sim.js still loads; the generator names daily.js", () => {
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/daily-dungeon/sim.js"), "utf8"), sandbox, { filename: "sim.js" });
  const G = sandbox.DailyDungeonSim;
  assert.equal(G.makeRoom("trap", "rune-trap").name, "Rune Trap"); // the rest works
  assert.throws(() => G.generateCandidate("2026-11-14"), /daily\.js/);
  // loading daily.js later is picked up (resolved lazily, on first call)
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/daily-dungeon/daily.js"), "utf8"), sandbox, { filename: "daily.js" });
  assert.equal(G.generateCandidate("2026-11-14").rooms.length, 5);
});

test("Node path without daily.js: sim.js still loads; the generator names daily.js", () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gen-"));
  try {
    const file = path.join(dir, "sim.js");
    fs.copyFileSync(path.join(__dirname, "../src/daily-dungeon/sim.js"), file);
    const Lone = require(file);
    assert.equal(Lone.makeRoom("trap", "rune-trap").name, "Rune Trap");
    assert.throws(() => Lone.generateCandidate("2026-11-14"), /daily\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
