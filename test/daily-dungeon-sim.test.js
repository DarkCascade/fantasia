// Unit tests for Daily Dungeon's content tables and tuning (src/daily-dungeon/sim.js).
// Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/daily-dungeon/sim.js");

const COMBAT = ["swarm", "magic", "elite", "boss"];

test("there are exactly the six PRD room types, each with a valid target", () => {
  assert.deepEqual([...S.ROOM_TYPE_IDS].sort(), ["ambush", "boss", "elite", "magic", "swarm", "trap"]);
  for (const id of S.ROOM_TYPE_IDS) {
    const t = S.roomType(id);
    assert.equal(t.id, id);
    assert.ok(S.TARGETS.includes(t.target), `${id} has target ${t.target}`);
    assert.ok(t.name && t.emoji && t.counterText, `${id} has player-facing text`);
    assert.ok(t.variants.length >= 1, `${id} has display names`);
    for (const v of t.variants) assert.ok(v.id && v.name);
    for (const h of t.counteredBy) assert.ok(S.HERO_IDS.includes(h), `${id} countered by known hero ${h}`);
  }
});

test("room targets and flags follow PRD §6.1 / §7.2", () => {
  assert.equal(S.roomType("trap").target, "slot1");
  assert.equal(S.roomType("ambush").target, "slot4");
  for (const id of COMBAT) {
    assert.equal(S.roomType(id).target, "front");
    assert.equal(S.roomType(id).combat, true, `${id} is a combat room`);
  }
  assert.equal(S.roomType("trap").combat, false);
  assert.equal(S.roomType("ambush").combat, false);
  const clearable = S.ROOM_TYPE_IDS.filter((id) => S.roomType(id).clearable).sort();
  assert.deepEqual(clearable, ["magic", "swarm"]);
});

test("PRD-named rooms exist: Spike Trap, Rune Trap, Skeleton Horde", () => {
  assert.equal(S.roomVariant("spike-trap").type, "trap");
  assert.equal(S.roomVariant("rune-trap").type, "trap");
  assert.equal(S.roomVariant("rune-trap").variant.name, "Rune Trap");
  assert.equal(S.roomVariant("skeleton-horde").variant.name, "Skeleton Horde");
});

test("every TUNE room entry has damage and time, and combat rooms outlast traps", () => {
  assert.deepEqual(Object.keys(S.TUNE.rooms).sort(), [...S.ROOM_TYPE_IDS].sort());
  const trap = S.roomStats("trap").time;
  for (const id of S.ROOM_TYPE_IDS) {
    const s = S.roomStats(id);
    assert.ok(Number.isFinite(s.damage) && s.damage > 0, `${id} damage`);
    assert.ok(Number.isFinite(s.time) && s.time >= S.TUNE.minRoomTime, `${id} time`);
    if (id !== "trap") assert.ok(s.time > trap, `${id} takes longer than a trap`);
  }
});

test("every Rumor offers two options naming valid room types (and valid variants)", () => {
  assert.equal(S.RUMORS.length, 3);
  for (const r of S.RUMORS) {
    assert.ok(r.text);
    assert.equal(r.options.length, 2, `${r.id} has two options`);
    assert.notEqual(r.options[0].type, r.options[1].type, `${r.id} options differ`);
    for (const o of r.options) {
      assert.ok(S.ROOM_TYPE_IDS.includes(o.type), `${r.id}: ${o.type}`);
      if (o.variant !== null) assert.equal(S.roomVariant(o.variant).type, o.type);
      // every option can be turned into a concrete room
      const room = S.makeRoom(o.type, o.variant);
      assert.equal(room.type, o.type);
    }
  }
});

test("Rumors match PRD §6.2 exactly", () => {
  const byText = Object.fromEntries(S.RUMORS.map((r) => [r.text, r.options.map((o) => o.type)]));
  assert.deepEqual(byText, {
    "A whiff of ozone": ["magic", "trap"],
    "Whispers in the dark": ["ambush", "elite"],
    "Bones rattle": ["swarm", "elite"],
  });
  const ozoneTrap = S.rumorById("ozone").options.find((o) => o.type === "trap");
  assert.equal(ozoneTrap.variant, "rune-trap");
  assert.equal(S.makeRoom(ozoneTrap.type, ozoneTrap.variant).name, "Rune Trap");
});

test("hero table invariants (PRD §8)", () => {
  assert.equal(S.HEROES.length, 6);
  assert.deepEqual(S.HERO_IDS, ["knight", "rogue", "mage", "cleric", "ranger", "berserker"]);
  assert.equal(new Set(S.HERO_IDS).size, 6);
  const rotating = S.HEROES.filter((h) => h.rotates).map((h) => h.id).sort();
  assert.deepEqual(rotating, ["mage", "rogue"]);
  for (const h of S.HEROES) {
    assert.equal(typeof h.rotates, "boolean");
    assert.equal(h.hp, h.id === "mage" ? 2 : 3, `${h.id} hp`);
    assert.ok(h.name && h.role && h.emoji && h.ability, `${h.id} has UI fields`);
  }
  assert.equal(S.heroById("mage").hp, 2);
  assert.deepEqual(S.heroById("rogue").slots, [1, 2]);
  assert.deepEqual(S.heroById("knight").slots, [1]);
  assert.deepEqual(S.heroById("ranger").slots, [4]);
});

test("TUNE holds the PRD's stated values and is deeply frozen", () => {
  assert.equal(S.TUNE.mageTimeSave, 20);
  assert.equal(S.TUNE.berserkerTimeSave, 15);
  assert.equal(S.TUNE.knightReduction, 2);
  assert.equal(S.TUNE.clericHeal, 1);
  assert.equal(S.TUNE.mageMode, "cancel");
  for (const k of ["rangerTimeSave", "parSlack", "minRoomTime", "rumorMin", "maxReseeds"])
    assert.ok(Number.isFinite(S.TUNE[k]) && S.TUNE[k] > 0, k);
  assert.ok(S.TUNE.rumorMin <= 1);
  assert.ok(Object.isFrozen(S.TUNE));
  assert.ok(Object.isFrozen(S.TUNE.rooms));
  assert.ok(Object.isFrozen(S.TUNE.rooms.trap));
  assert.throws(() => {
    S.TUNE.rooms.trap.damage = 99;
  }, TypeError);
  assert.ok(Object.isFrozen(S.HEROES[0]) && Object.isFrozen(S.ROOM_TYPES.trap.variants[0]));
});

test("withTune deep-merges overrides without touching the default", () => {
  const t = S.withTune({ rooms: { trap: { damage: 7 } }, mageMode: "halve", parSlack: 10 });
  assert.equal(t.rooms.trap.damage, 7);
  assert.equal(t.rooms.trap.time, S.TUNE.rooms.trap.time); // sibling kept
  assert.equal(t.rooms.boss.damage, S.TUNE.rooms.boss.damage);
  assert.equal(t.mageMode, "halve");
  assert.equal(t.parSlack, 10);
  assert.ok(Object.isFrozen(t.rooms.trap));
  // the default is untouched
  assert.equal(S.TUNE.rooms.trap.damage, 2);
  assert.equal(S.TUNE.mageMode, "cancel");
  // chaining on a custom base
  const t2 = S.withTune({ knightReduction: 3 }, t);
  assert.equal(t2.rooms.trap.damage, 7);
  assert.equal(t2.knightReduction, 3);
  // no overrides → an equal copy
  assert.deepEqual(S.withTune(), S.TUNE);
  assert.notEqual(S.withTune(), S.TUNE);
});

test("withTune rejects typos and bad values", () => {
  assert.throws(() => S.withTune({ mageTimeSav: 30 }), /unknown tune key 'mageTimeSav'/);
  assert.throws(() => S.withTune({ rooms: { pit: { damage: 1 } } }), /unknown tune key 'rooms.pit'/);
  assert.throws(() => S.withTune({ mageMode: "double" }), /mageMode/);
  assert.throws(() => S.withTune({ knightReduction: -1 }), /non-negative/);
  assert.throws(() => S.withTune({ knightReduction: "2" }), /must be a number/);
  assert.throws(() => S.withTune({ rooms: 5 }), /must be an object/);
});

test("withTune enforces integers, par slack, the rumor share and reseed count", () => {
  // anything that changes HP must be an integer
  assert.throws(() => S.withTune({ rooms: { trap: { damage: 1.5 } } }), /'rooms.trap.damage' must be an integer/);
  assert.throws(() => S.withTune({ rooms: { boss: { damage: 4.2 } } }), /'rooms.boss.damage' must be an integer/);
  assert.throws(() => S.withTune({ knightReduction: 1.5 }), /'knightReduction' must be an integer/);
  assert.throws(() => S.withTune({ clericHeal: 0.5 }), /'clericHeal' must be an integer/);
  assert.throws(() => S.withTune({ maxReseeds: 2.5 }), /'maxReseeds' must be an integer/);
  // par slack must be strictly positive
  assert.throws(() => S.withTune({ parSlack: 0 }), /'parSlack' must be > 0/);
  // rumorMin is a share
  assert.throws(() => S.withTune({ rumorMin: 5 }), /'rumorMin'.*\[0, 1\]/);
  assert.throws(() => S.withTune({ rumorMin: -0.1 }), /'rumorMin' must be a non-negative number/);
  // at least one reseed
  assert.throws(() => S.withTune({ maxReseeds: 0 }), /'maxReseeds' must be >= 1/);
  // times must be non-negative but may be fractional
  assert.throws(() => S.withTune({ rooms: { trap: { time: -1 } } }), /'rooms.trap.time' must be a non-negative number/);
  assert.throws(() => S.withTune({ minRoomTime: -0.5 }), /'minRoomTime' must be a non-negative number/);
  assert.throws(() => S.withTune({ rooms: { swarm: { time: NaN } } }), /non-negative number/);
  // boundary values that are allowed
  const t = S.withTune({
    rooms: { trap: { time: 7.5, damage: 0 } },
    minRoomTime: 2.5,
    parSlack: 0.5,
    rumorMin: 0,
    maxReseeds: 1,
    knightReduction: 0,
  });
  assert.equal(t.rooms.trap.time, 7.5);
  assert.equal(S.withTune({ rumorMin: 1 }).rumorMin, 1);
});

test("the browser path: with no module/exports the API lands on the global", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../src/daily-dungeon/sim.js"), "utf8");
  const sandbox = {};
  sandbox.self = sandbox; // a browser's `self` is the window
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "sim.js" });
  assert.equal(typeof sandbox.module, "undefined");
  const G = sandbox.DailyDungeonSim;
  assert.ok(G, "DailyDungeonSim is set on the global");
  assert.deepEqual(Object.keys(G).sort(), Object.keys(S).sort());
  for (const k of Object.keys(S)) assert.equal(typeof G[k], typeof S[k], k);
  assert.equal(G.HEROES.length, 6);
  assert.equal(G.makeRoom("trap", "rune-trap").name, "Rune Trap");
  assert.equal(G.withTune({ parSlack: 9 }).parSlack, 9);
});

test("room and hero emoji avoid code points newer than Unicode 9", () => {
  // Everything from U+1F900 up (🦴 🧙 🪤 🪓 …) is Unicode 8+ and mostly 10+,
  // and renders as tofu on older Android / Windows 10. Stay below it.
  const all = [
    ...S.ROOM_TYPE_IDS.map((id) => [id, S.roomType(id).emoji]),
    ...S.HEROES.map((h) => [h.id, h.emoji]),
  ];
  for (const [id, e] of all)
    for (const ch of e) assert.ok(ch.codePointAt(0) < 0x1f900, `${id} emoji ${e} uses U+${ch.codePointAt(0).toString(16)}`);
});

test("a TUNE override changes room stats and the rooms built from them", () => {
  const t = S.withTune({ rooms: { swarm: { damage: 9, time: 44 } } });
  assert.deepEqual(S.roomStats("swarm", t), { damage: 9, time: 44 });
  const room = S.makeRoom("swarm", "skeleton-horde", t);
  assert.deepEqual(room, {
    type: "swarm",
    variant: "skeleton-horde",
    name: "Skeleton Horde",
    target: "front",
    damage: 9,
    time: 44,
  });
  assert.equal(S.makeRoom("swarm", "skeleton-horde").damage, S.TUNE.rooms.swarm.damage);
  assert.equal(S.makeRoom("trap").name, "Spike Trap"); // default variant
  assert.throws(() => S.makeRoom("trap", "skeleton-horde"), /is a swarm/);
  assert.throws(() => S.makeRoom("lava"), /unknown room type/);
});

test("ability and counter text quote TUNE, so overrides show up on screen", () => {
  // every template resolves against the default tune
  for (const id of S.HERO_IDS) assert.doesNotMatch(S.heroAbilityText(id), /[{}]/);
  for (const id of S.ROOM_TYPE_IDS) assert.doesNotMatch(S.roomCounterText(id), /[{}]/);

  assert.match(S.heroAbilityText("knight"), /−2\b/);
  assert.match(S.heroAbilityText("mage"), /no damage, −20 s/);
  const t = S.withTune({ knightReduction: 3, mageTimeSave: 25, mageMode: "halve" });
  assert.match(S.heroAbilityText("knight", t), /−3\b/);
  assert.match(S.heroAbilityText("mage", t), /half damage \(rounded down\), −25 s/);
  assert.match(S.roomCounterText("swarm", t), /−25 s/);
  assert.match(S.roomCounterText("boss", S.withTune({ berserkerTimeSave: 9 })), /−9 s/);

  assert.equal(S.fillText("{damage} dmg", undefined, { damage: 4 }), "4 dmg");
  assert.throws(() => S.fillText("{nope}"), /no value for \{nope\}/);
});

test("lookups throw on unknown ids", () => {
  assert.throws(() => S.heroById("bard"), /unknown hero/);
  assert.throws(() => S.rumorById("smoke"), /unknown rumor/);
  assert.throws(() => S.roomVariant("lava-pit"), /unknown room variant/);
});

test("variant ids are unique across room types", () => {
  const ids = S.ROOM_TYPE_IDS.flatMap((t) => S.roomType(t).variants.map((v) => v.id));
  assert.equal(new Set(ids).size, ids.length);
});
