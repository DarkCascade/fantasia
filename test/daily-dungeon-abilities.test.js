// Unit tests for Daily Dungeon's hero abilities (FAN-11): the six abilities at
// their PRD §7.5 steps, exhaustion, rotation, the Cleric heal and the events
// that explain them to the replay. Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/daily-dungeon/sim.js");

// HP (PRD §8): everyone 3, Mage 2. Default TUNE damage: trap 2, swarm 3,
// magic 3, elite 4, ambush 2, boss 5. Times: 10, 30, 25, 30, 15, 40.
// Savings: Mage 20, Berserker 15, Ranger 5. Knight −2, Cleric +1.

const rooms = (...types) => types.map((t) => S.makeRoom(t));
const ids = (line) => line.map((h) => h.id);
const hp = (line) => Object.fromEntries(line.map((h) => [h.id, h.hp]));
const ofKind = (events, kind) => events.filter((e) => e.kind === kind);
const counters = (room, hero) => ofKind(room.events, "counter").filter((e) => !hero || e.hero === hero);
const timeEv = (room) => room.events.find((e) => e.kind === "time");
const HALVE = S.withTune({ mageMode: "halve" });

function allLineups() {
  const out = [];
  const pick = (cur) => {
    if (cur.length === 4) return out.push(cur);
    for (const h of S.HERO_IDS) if (!cur.includes(h)) pick([...cur, h]);
  };
  pick([]);
  return out;
}

/* --------------------------------------------------------------------- */
/* Rogue — disarm (rotates)                                               */
/* --------------------------------------------------------------------- */

test("Rogue in Slot 1 disarms a trap, is exhausted and rotates: line becomes [2, 3, 4, Rogue]", () => {
  const r = S.runDungeon(rooms("trap"), ["rogue", "knight", "mage", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [
    { kind: "counter", hero: "rogue", ability: "disarm", fired: true, effect: "disarm", amount: 2 },
  ]);
  assert.equal(room.damage, 0);
  assert.equal(room.damageTaken, 0);
  assert.deepEqual(ofKind(room.events, "damage"), []);
  assert.deepEqual(ofKind(room.events, "exhaust"), [{ kind: "exhaust", hero: "rogue", exhausted: true }]);
  assert.deepEqual(ofKind(room.events, "rotate"), [
    { kind: "rotate", hero: "rogue", from: 1, line: ["knight", "mage", "cleric", "rogue"] },
  ]);
  assert.deepEqual(room.lineAfter, [
    { id: "knight", hp: 3, maxHp: 3, exhausted: false },
    { id: "mage", hp: 2, maxHp: 2, exhausted: false },
    { id: "cleric", hp: 3, maxHp: 3, exhausted: false },
    { id: "rogue", hp: 3, maxHp: 3, exhausted: true },
  ]);
  assert.deepEqual(room.events.map((e) => e.kind), ["counter", "time", "exhaust", "rotate"]);
});

test("Rogue in Slot 2 also disarms", () => {
  const r = S.runDungeon(rooms("trap"), ["knight", "rogue", "mage", "cleric"]);
  assert.equal(counters(r.rooms[0], "rogue")[0].fired, true);
  assert.equal(r.rooms[0].damageTaken, 0);
  assert.deepEqual(ids(r.rooms[0].lineAfter), ["knight", "mage", "cleric", "rogue"]);
  assert.equal(ofKind(r.rooms[0].events, "rotate")[0].from, 2);
});

test("Rogue in Slot 3 is blocked by slot: the trap hits Slot 1, nobody rotates", () => {
  const r = S.runDungeon(rooms("trap"), ["knight", "mage", "rogue", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [{ kind: "counter", hero: "rogue", ability: "disarm", fired: false, blocked: "slot" }]);
  assert.deepEqual(ofKind(room.events, "damage").map((e) => [e.hero, e.amount]), [["knight", 2]]);
  assert.deepEqual(ofKind(room.events, "rotate"), []);
  assert.deepEqual(ofKind(room.events, "exhaust"), []);
  assert.deepEqual(ids(room.lineAfter), ["knight", "mage", "rogue", "cleric"]);
});

test("an exhausted Rogue in Slot 2 is blocked: the trap hits, and next room he disarms again", () => {
  // Swarm 6 knocks out Berserker and Ranger, leaving [Rogue, Knight]. The
  // Rogue disarms room 2 and rotates to Slot 2, exhausted for room 3.
  const tune = S.withTune({ rooms: { swarm: { damage: 6 } } });
  const r = S.runDungeon(rooms("swarm", "trap", "trap", "trap"), ["berserker", "ranger", "rogue", "knight"], tune);
  const [, r2, r3, r4] = r.rooms;
  assert.equal(counters(r2, "rogue")[0].fired, true);
  assert.deepEqual(r2.lineAfter, [
    { id: "knight", hp: 3, maxHp: 3, exhausted: false },
    { id: "rogue", hp: 3, maxHp: 3, exhausted: true },
  ]);
  // Room 3: the Rogue stands in Slot 2 (a disarm slot) but is exhausted.
  assert.deepEqual(counters(r3), [{ kind: "counter", hero: "rogue", ability: "disarm", fired: false, blocked: "exhausted" }]);
  assert.deepEqual(ofKind(r3.events, "damage").map((e) => [e.hero, e.amount]), [["knight", 2]]);
  assert.deepEqual(ofKind(r3.events, "exhaust"), [{ kind: "exhaust", hero: "rogue", exhausted: false }]);
  assert.deepEqual(ofKind(r3.events, "rotate"), []);
  // Room 4: rested, still in Slot 2, he disarms again.
  assert.equal(counters(r4, "rogue")[0].fired, true);
  assert.equal(r4.damageTaken, 0);
});

/* --------------------------------------------------------------------- */
/* Mage — clear (rotates)                                                 */
/* --------------------------------------------------------------------- */

test("Mage clears a Swarm from any slot: no damage, −mageTimeSave s, exhausted, rotates", () => {
  const r = S.runDungeon(rooms("swarm"), ["mage", "berserker", "rogue", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [
    { kind: "counter", hero: "mage", ability: "clear", fired: true, effect: "clear", amount: 3, seconds: 20 },
  ]);
  assert.equal(room.damageTaken, 0);
  assert.equal(room.time, 10);
  assert.deepEqual(timeEv(room), {
    kind: "time",
    seconds: 10,
    base: 30,
    saved: 20,
    floored: false,
    total: 10,
    savings: [{ hero: "mage", seconds: 20, reason: "clear" }],
  });
  assert.deepEqual(ids(room.lineAfter), ["berserker", "rogue", "cleric", "mage"]);
  assert.equal(room.lineAfter[3].exhausted, true);
});

test("Mage clears a Magic room too, and the time saving follows TUNE", () => {
  const tune = S.withTune({ mageTimeSave: 7 });
  const r = S.runDungeon(rooms("magic"), ["berserker", "rogue", "mage", "cleric"], tune);
  assert.equal(counters(r.rooms[0], "mage")[0].seconds, 7);
  assert.equal(r.rooms[0].time, 18);
  assert.equal(r.rooms[0].damageTaken, 0);
});

test("Mage in Slot 4 still rotates (already last), so the rotate event says from 4", () => {
  const r = S.runDungeon(rooms("swarm"), ["berserker", "rogue", "cleric", "mage"]);
  assert.deepEqual(ofKind(r.rooms[0].events, "rotate"), [
    { kind: "rotate", hero: "mage", from: 4, line: ["berserker", "rogue", "cleric", "mage"] },
  ]);
});

test("an exhausted Mage is blocked: the second Swarm lands in full and takes its whole time", () => {
  const r = S.runDungeon(rooms("swarm", "swarm"), ["berserker", "mage", "rogue", "cleric"]);
  const r2 = r.rooms[1];
  assert.deepEqual(ids(r2.lineBefore), ["berserker", "rogue", "cleric", "mage"]);
  assert.equal(r2.lineBefore[3].exhausted, true);
  assert.deepEqual(counters(r2), [{ kind: "counter", hero: "mage", ability: "clear", fired: false, blocked: "exhausted" }]);
  assert.deepEqual(ofKind(r2.events, "damage").map((e) => [e.hero, e.amount]), [["berserker", 3]]);
  assert.equal(r2.time, 30);
  assert.deepEqual(timeEv(r2).savings, []);
  assert.deepEqual(ofKind(r2.events, "exhaust"), [{ kind: "exhaust", hero: "mage", exhausted: false }]);
});

test("no Mage counter outside Swarm/Magic rooms", () => {
  const r = S.runDungeon(rooms("trap", "elite", "ambush", "boss"), ["berserker", "mage", "rogue", "cleric"]);
  for (const room of r.rooms) assert.deepEqual(counters(room, "mage"), []);
});

test('mageMode "halve": damage halved (rounded down), still −mageTimeSave s, exhausted and rotates', () => {
  const r = S.runDungeon(rooms("swarm"), ["berserker", "mage", "rogue", "cleric"], HALVE);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [
    { kind: "counter", hero: "mage", ability: "clear", fired: true, effect: "halve", amount: 2, seconds: 20 },
  ]);
  assert.equal(room.damage, 1); // floor(3 / 2)
  assert.deepEqual(ofKind(room.events, "damage").map((e) => [e.hero, e.amount]), [["berserker", 1]]);
  assert.equal(room.time, 10);
  assert.deepEqual(ids(room.lineAfter), ["berserker", "rogue", "cleric", "mage"]);
  assert.equal(room.lineAfter[3].exhausted, true);
  // An odd larger number rounds down too: 5 → 2.
  const five = S.withTune({ mageMode: "halve", rooms: { magic: { damage: 5 } } });
  assert.equal(S.runDungeon(rooms("magic"), ["berserker", "mage", "rogue", "cleric"], five).rooms[0].damage, 2);
});

test('mageMode "halve": a Mage knocked out by the halved damage still saves time but neither exhausts nor rotates', () => {
  const tune = S.withTune({ mageMode: "halve", rooms: { swarm: { damage: 6 } } });
  const r = S.runDungeon(rooms("swarm"), ["mage", "berserker", "rogue", "cleric"], tune);
  const room = r.rooms[0];
  assert.equal(counters(room, "mage")[0].fired, true);
  assert.deepEqual(room.knockouts, ["mage"]); // 3 damage: Mage 2→0, 1 onto the Berserker
  assert.equal(room.time, 10);
  assert.deepEqual(ofKind(room.events, "exhaust"), []);
  assert.deepEqual(ofKind(room.events, "rotate"), []);
});

/* --------------------------------------------------------------------- */
/* Knight — guard (formation)                                             */
/* --------------------------------------------------------------------- */

test("Knight in Slot 1 reduces Elite and Boss damage by knightReduction", () => {
  const r = S.runDungeon(rooms("elite", "boss"), ["knight", "rogue", "berserker", "cleric"]);
  const [elite, boss] = r.rooms;
  assert.deepEqual(counters(elite), [
    { kind: "counter", hero: "knight", ability: "guard", fired: true, effect: "reduce", amount: 2 },
  ]);
  assert.equal(elite.damage, 2);
  assert.deepEqual(ofKind(elite.events, "damage").map((e) => [e.hero, e.amount]), [["knight", 2]]);
  assert.equal(counters(boss, "knight")[0].amount, 2);
  assert.equal(boss.damage, 3);
  // A formation ability: the Knight never rotates or tires.
  assert.deepEqual(ofKind(elite.events, "rotate"), []);
  assert.deepEqual(ofKind(elite.events, "exhaust"), []);
});

test("Knight reduces Swarm/Magic damage when no Mage clears it", () => {
  const r = S.runDungeon(rooms("swarm", "magic"), ["knight", "rogue", "berserker", "cleric"]);
  for (const room of r.rooms) {
    assert.equal(counters(room, "knight")[0].fired, true);
    assert.equal(room.damage, 1);
  }
});

test("Knight's reduction never takes damage below 0 (amount is what it actually prevented)", () => {
  const tune = S.withTune({ rooms: { elite: { damage: 1 } } });
  const r = S.runDungeon(rooms("elite"), ["knight", "rogue", "berserker", "cleric"], tune);
  assert.deepEqual(counters(r.rooms[0]), [
    { kind: "counter", hero: "knight", ability: "guard", fired: true, effect: "reduce", amount: 1 },
  ]);
  assert.equal(r.rooms[0].damage, 0);
  assert.deepEqual(ofKind(r.rooms[0].events, "damage"), []);
});

test("Knight in Slot 2 is blocked by slot in the boss room: full damage on the front", () => {
  const r = S.runDungeon(rooms("boss"), ["rogue", "knight", "mage", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room, "knight"), [
    { kind: "counter", hero: "knight", ability: "guard", fired: false, blocked: "slot" },
  ]);
  assert.equal(room.damage, 5);
  assert.deepEqual(ofKind(room.events, "damage").map((e) => [e.hero, e.amount]), [
    ["rogue", 3],
    ["knight", 2],
  ]);
});

test("Knight emits nothing in Traps and Ambushes", () => {
  const r = S.runDungeon(rooms("trap", "ambush"), ["knight", "mage", "berserker", "cleric"]);
  for (const room of r.rooms) assert.deepEqual(counters(room, "knight"), []);
});

test("cancel mode: in a room the Mage cleared the Knight neither fires nor reports a block", () => {
  const r = S.runDungeon(rooms("swarm"), ["knight", "mage", "rogue", "cleric"]);
  assert.deepEqual(counters(r.rooms[0]).map((e) => e.hero), ["mage"]);
});

test('halve mode: a halved room is not cleared, so a Slot-1 Knight reduces it too (halve, then −2, min 0)', () => {
  const r = S.runDungeon(rooms("swarm"), ["knight", "mage", "rogue", "cleric"], HALVE);
  assert.deepEqual(counters(r.rooms[0]), [
    { kind: "counter", hero: "mage", ability: "clear", fired: true, effect: "halve", amount: 2, seconds: 20 },
    { kind: "counter", hero: "knight", ability: "guard", fired: true, effect: "reduce", amount: 1 },
  ]);
  assert.equal(r.rooms[0].damage, 0);
  // Magic 9: halved to 4, then −2 → 2.
  const nine = S.withTune({ mageMode: "halve", rooms: { magic: { damage: 9 } } });
  const r9 = S.runDungeon(rooms("magic"), ["knight", "mage", "rogue", "cleric"], nine);
  assert.equal(r9.rooms[0].damage, 2);
  assert.equal(counters(r9.rooms[0], "knight")[0].amount, 2);
});

/* --------------------------------------------------------------------- */
/* Ranger — ambush cancel and speed (formation)                           */
/* --------------------------------------------------------------------- */

test("Ranger in Slot 4 cancels an Ambush and saves rangerTimeSave s", () => {
  const r = S.runDungeon(rooms("ambush"), ["knight", "rogue", "cleric", "ranger"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [
    { kind: "counter", hero: "ranger", ability: "cancel", fired: true, effect: "cancel", amount: 2 },
  ]);
  assert.equal(room.damageTaken, 0);
  assert.deepEqual(timeEv(room).savings, [{ hero: "ranger", seconds: 5, reason: "speed" }]);
  assert.equal(room.time, 10);
  assert.deepEqual(ids(room.lineAfter), ["knight", "rogue", "cleric", "ranger"]); // no rotation
});

test("Ranger in Slot 3 is blocked by slot: the Ambush hits Slot 4 and no speed bonus", () => {
  const r = S.runDungeon(rooms("ambush"), ["knight", "rogue", "ranger", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room), [{ kind: "counter", hero: "ranger", ability: "cancel", fired: false, blocked: "slot" }]);
  assert.deepEqual(ofKind(room.events, "damage").map((e) => [e.hero, e.slot, e.amount]), [["cleric", 4, 2]]);
  assert.equal(room.time, 15);
  assert.deepEqual(timeEv(room).savings, []);
});

test("Ranger speed bonus applies in Slot 4 in any room, and is a time saving, not a counter", () => {
  // Harmless rooms, so all four stay standing and the Ranger stays in Slot 4.
  const z = { damage: 0 };
  const tune = S.withTune({ rooms: { trap: z, swarm: z, elite: z, boss: z } });
  const r = S.runDungeon(rooms("trap", "swarm", "elite", "boss"), ["knight", "berserker", "cleric", "ranger"], tune);
  for (const room of r.rooms) {
    assert.deepEqual(counters(room, "ranger"), []);
    assert.deepEqual(timeEv(room).savings.filter((s) => s.hero === "ranger"), [{ hero: "ranger", seconds: 5, reason: "speed" }]);
  }
  assert.equal(r.rooms[1].time, 25);
  // The trap hits 10 − 5 = 5, which is exactly the floor, not below it.
  assert.equal(r.rooms[0].time, 5);
  assert.equal(timeEv(r.rooms[0]).floored, false);
});

test("Slot 4 is literal: with 3 standing the back-most Ranger is in Slot 3 — the Ambush hits him, no speed", () => {
  // Elite 4 knocks out the Mage (2) and puts 2 on the Rogue: [Rogue, Cleric, Ranger].
  const r = S.runDungeon(rooms("elite", "ambush"), ["mage", "rogue", "cleric", "ranger"]);
  const amb = r.rooms[1];
  assert.deepEqual(ids(amb.lineBefore), ["rogue", "cleric", "ranger"]);
  assert.deepEqual(counters(amb), [{ kind: "counter", hero: "ranger", ability: "cancel", fired: false, blocked: "slot" }]);
  assert.deepEqual(ofKind(amb.events, "damage").map((e) => [e.hero, e.slot, e.amount]), [["ranger", 3, 2]]);
  assert.equal(amb.time, 15);
  assert.deepEqual(timeEv(amb).savings, []);
  // Room 1 he did start in Slot 4, so he got the bonus there.
  assert.equal(r.rooms[0].time, 25);
});

test("the speed bonus still counts if the Slot-4 Ranger is knocked out in the room", () => {
  const tune = S.withTune({ rooms: { boss: { damage: 30 } } });
  const r = S.runDungeon(rooms("boss"), ["knight", "rogue", "cleric", "ranger"], tune);
  assert.equal(r.wipedAt, 0);
  assert.deepEqual(timeEv(r.rooms[0]).savings, [{ hero: "ranger", seconds: 5, reason: "speed" }]);
  assert.equal(r.rooms[0].time, 35);
});

test("a rotation that pushes a Slot-4 Ranger to Slot 3 loses the Ambush cancel (and speed) next room", () => {
  const r = S.runDungeon(rooms("trap", "ambush"), ["rogue", "knight", "cleric", "ranger"]);
  const [trap, amb] = r.rooms;
  assert.equal(trap.time, 5); // Ranger started the trap in Slot 4
  assert.deepEqual(ids(trap.lineAfter), ["knight", "cleric", "ranger", "rogue"]);
  assert.deepEqual(counters(amb), [{ kind: "counter", hero: "ranger", ability: "cancel", fired: false, blocked: "slot" }]);
  // The exhausted Rogue, now in Slot 4, takes the Ambush.
  assert.deepEqual(ofKind(amb.events, "damage").map((e) => [e.hero, e.slot, e.amount]), [["rogue", 4, 2]]);
  assert.equal(amb.lineBefore[3].exhausted, true);
  assert.equal(amb.time, 15);
});

/* --------------------------------------------------------------------- */
/* Berserker — fury (formation)                                           */
/* --------------------------------------------------------------------- */

test("Berserker at full HP entering the boss room saves berserkerTimeSave s", () => {
  const r = S.runDungeon(rooms("boss"), ["knight", "berserker", "rogue", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(counters(room, "berserker"), [
    { kind: "counter", hero: "berserker", ability: "fury", fired: true, effect: "speed", seconds: 15 },
  ]);
  assert.equal(room.time, 25);
  assert.deepEqual(timeEv(room).savings, [{ hero: "berserker", seconds: 15, reason: "fury" }]);
});

test("a hurt Berserker is blocked by HP in the boss room", () => {
  const r = S.runDungeon(rooms("trap", "boss"), ["berserker", "knight", "rogue", "cleric"]);
  const boss = r.rooms[1];
  assert.equal(boss.lineBefore[0].hp, 1);
  assert.deepEqual(counters(boss, "berserker"), [{ kind: "counter", hero: "berserker", ability: "fury", fired: false, blocked: "hp" }]);
  assert.equal(boss.time, 40);
});

test("full HP is checked on entry, after last room's heal: a Cleric can top the Berserker up", () => {
  const tune = S.withTune({ rooms: { trap: { damage: 1 } } });
  const r = S.runDungeon(rooms("trap", "boss"), ["berserker", "cleric", "knight", "mage"], tune);
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), [{ kind: "heal", hero: "berserker", by: "cleric", amount: 1, hpAfter: 3 }]);
  assert.equal(counters(r.rooms[1], "berserker")[0].fired, true);
  assert.equal(r.rooms[1].time, 25);
});

test("Berserker emits nothing outside the boss room", () => {
  const r = S.runDungeon(rooms("trap", "swarm", "elite", "ambush"), ["berserker", "knight", "rogue", "cleric"]);
  for (const room of r.rooms) assert.deepEqual(counters(room, "berserker"), []);
});

/* --------------------------------------------------------------------- */
/* Cleric — heal (formation)                                              */
/* --------------------------------------------------------------------- */

test("Cleric heals the hero directly in front by clericHeal after the room", () => {
  const r = S.runDungeon(rooms("trap"), ["knight", "cleric", "mage", "rogue"]);
  const room = r.rooms[0];
  assert.deepEqual(ofKind(room.events, "heal"), [{ kind: "heal", hero: "knight", by: "cleric", amount: 1, hpAfter: 2 }]);
  assert.equal(room.lineAfter[0].hp, 2);
  assert.equal(room.events[room.events.length - 1].kind, "heal");
});

test("Cleric heals only up to maxHp", () => {
  const tune = S.withTune({ clericHeal: 5 });
  const r = S.runDungeon(rooms("trap"), ["knight", "cleric", "mage", "rogue"], tune);
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), [{ kind: "heal", hero: "knight", by: "cleric", amount: 2, hpAfter: 3 }]);
});

test("no heal event when the hero in front is at full HP", () => {
  const r = S.runDungeon(rooms("ambush"), ["knight", "cleric", "mage", "rogue"]);
  assert.equal(r.rooms[0].damageTaken, 2); // the Rogue in Slot 4
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), []);
});

const BLOCKED_HEAL = { kind: "heal", hero: null, by: "cleric", amount: 0, blocked: "slot" };

test("a Cleric in Slot 1 heals nobody, and says so when someone else is hurt", () => {
  // The Ambush hurts the Rogue in Slot 4; the Cleric in Slot 1 can't reach him.
  const r = S.runDungeon(rooms("ambush"), ["cleric", "knight", "mage", "rogue"]);
  const room = r.rooms[0];
  assert.deepEqual(ofKind(room.events, "heal"), [BLOCKED_HEAL]);
  assert.equal(room.lineAfter[3].hp, 1); // unhealed
  assert.equal(room.events[room.events.length - 1].kind, "heal"); // step 7, last
});

test("a Slot-1 Cleric emits no blocked heal when nobody else is hurt", () => {
  // Only the Cleric herself is hurt (the trap hits Slot 1): nothing to explain.
  const r = S.runDungeon(rooms("trap"), ["cleric", "knight", "mage", "rogue"]);
  assert.equal(r.rooms[0].lineAfter[0].hp, 1);
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), []);
  // Nobody hurt at all.
  const z = S.withTune({ rooms: { elite: { damage: 0 } } });
  const r2 = S.runDungeon(rooms("elite"), ["cleric", "knight", "mage", "rogue"], z);
  assert.deepEqual(ofKind(r2.rooms[0].events, "heal"), []);
});

test("the blocked heal reads the line after rotation: a rotation can put the Cleric in Slot 1", () => {
  // Ambush: the Berserker (Slot 4) drops to 1; the Cleric (Slot 2) faces the
  // full-HP Rogue. Trap: the Rogue disarms from Slot 1 and rotates, leaving
  // the Cleric in front with a hurt Berserker behind her.
  const r = S.runDungeon(rooms("ambush", "trap"), ["rogue", "cleric", "knight", "berserker"]);
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), []);
  const trap = r.rooms[1];
  assert.deepEqual(ids(trap.lineAfter), ["cleric", "knight", "berserker", "rogue"]);
  assert.deepEqual(ofKind(trap.events, "heal"), [BLOCKED_HEAL]);
  assert.deepEqual(trap.events.map((e) => e.kind), ["counter", "time", "exhaust", "rotate", "heal"]);
});

test("the heal reads the line after rotation (step 6 before step 7)", () => {
  // Elite: Knight guards it to 2 → Knight 3→1; the Cleric is behind the
  // (full) Rogue. Trap: the Rogue disarms from Slot 2 and rotates, which puts
  // the Cleric directly behind the Knight, so she heals him.
  const r = S.runDungeon(rooms("elite", "trap"), ["knight", "rogue", "cleric", "mage"]);
  assert.deepEqual(ofKind(r.rooms[0].events, "heal"), []);
  const trap = r.rooms[1];
  assert.deepEqual(ids(trap.lineAfter), ["knight", "cleric", "mage", "rogue"]);
  assert.deepEqual(ofKind(trap.events, "heal"), [{ kind: "heal", hero: "knight", by: "cleric", amount: 1, hpAfter: 2 }]);
  assert.deepEqual(trap.events.map((e) => e.kind), ["counter", "time", "exhaust", "rotate", "heal"]);
});

test("a knocked-out Cleric heals nobody; a wipe room has no exhaust, rotate or heal events", () => {
  const tune = S.withTune({ rooms: { swarm: { damage: 20 } } });
  const r = S.runDungeon(rooms("swarm"), ["knight", "cleric", "rogue", "berserker"], tune);
  const ks = r.rooms[0].events.map((e) => e.kind);
  for (const k of ["exhaust", "rotate", "heal"]) assert.ok(!ks.includes(k));
  assert.equal(ks[ks.length - 1], "wipe");
});

/* --------------------------------------------------------------------- */
/* PRD §7.3 example                                                       */
/* --------------------------------------------------------------------- */

test("PRD §7.3: a Mage that clears room 2 sits exhausted in Slot 4 with 2 HP and takes the room-3 Ambush", () => {
  const r = S.runDungeon(rooms("trap", "swarm", "ambush"), ["knight", "rogue", "mage", "cleric"]);
  const [r1, r2, r3] = r.rooms;
  // Room 1: the Rogue disarms and rotates.
  assert.deepEqual(ids(r1.lineAfter), ["knight", "mage", "cleric", "rogue"]);
  // Room 2: the Mage clears from Slot 2 and rotates; the Rogue is rested.
  assert.equal(counters(r2, "mage")[0].fired, true);
  assert.deepEqual(ofKind(r2.events, "exhaust"), [
    { kind: "exhaust", hero: "rogue", exhausted: false },
    { kind: "exhaust", hero: "mage", exhausted: true },
  ]);
  // Room 3: Mage in Slot 4, exhausted, 2 HP. The Ambush knocks it out.
  assert.deepEqual(r3.lineBefore[3], { id: "mage", hp: 2, maxHp: 2, exhausted: true });
  assert.deepEqual(ofKind(r3.events, "damage"), [
    { kind: "damage", hero: "mage", slot: 4, amount: 2, hpBefore: 2, hpAfter: 0, overkill: 0, overflow: false },
  ]);
  assert.deepEqual(r3.knockouts, ["mage"]);
  // No Ranger, so no ambush counter: nothing could have stopped it.
  assert.deepEqual(counters(r3), []);
  assert.deepEqual(ids(r3.lineAfter), ["knight", "cleric", "rogue"]);
});

/* --------------------------------------------------------------------- */
/* Invariants over every lineup                                           */
/* --------------------------------------------------------------------- */

test("ability invariants hold for all 360 lineups, several dungeons and both Mage modes", () => {
  const tunes = [
    S.TUNE,
    HALVE,
    S.withTune({ rooms: { swarm: { damage: 6 }, boss: { damage: 9 }, ambush: { damage: 3 } } }),
    S.withTune({ mageMode: "halve", clericHeal: 2, rooms: { magic: { damage: 7 } } }),
  ];
  const dungeons = [
    rooms("trap", "swarm", "magic", "ambush", "boss"),
    rooms("trap", "trap", "ambush", "elite", "boss"),
    rooms("swarm", "ambush", "trap", "magic", "boss"),
    rooms("elite", "trap", "swarm", "ambush", "boss"),
  ];
  const fired = {};
  const blocked = {};
  let rotations = 0;
  let blockedHeals = 0;
  for (const tune of tunes)
    for (const d of dungeons)
      for (const lineup of allLineups()) {
        const r = S.runDungeon(d, lineup, tune);
        r.rooms.forEach((room, i) => {
          if (!room.reached) return;
          let step = 0;
          for (const e of room.events) {
            assert.ok(S.EVENT_STEP[e.kind] >= step, `${e.kind} after step ${step}`);
            step = S.EVENT_STEP[e.kind];
          }
          // HP never exceeds maxHp, before or after the room.
          for (const h of [...room.lineBefore, ...room.lineAfter]) assert.ok(h.hp > 0 && h.hp <= h.maxHp);
          // Heals: amount > 0 unless blocked; a blocked heal means the Cleric
          // ended the room in Slot 1 with someone else below max HP.
          for (const e of ofKind(room.events, "heal")) {
            if (e.blocked) {
              assert.deepEqual(e, { kind: "heal", hero: null, by: "cleric", amount: 0, blocked: "slot" });
              assert.equal(room.lineAfter[0].id, "cleric");
              assert.ok(room.lineAfter.slice(1).some((h) => h.hp < h.maxHp));
              blockedHeals++;
              continue;
            }
            const h = room.lineAfter.find((x) => x.id === e.hero);
            assert.ok(e.amount > 0 && e.hpAfter <= h.maxHp && e.hpAfter === h.hp);
          }
          // ...and conversely, such a room always explains the missing heal.
          if (!room.wiped && room.lineAfter[0] && room.lineAfter[0].id === "cleric" &&
              room.lineAfter.slice(1).some((h) => h.hp < h.maxHp))
            assert.ok(ofKind(room.events, "heal").some((e) => e.blocked === "slot"));
          // Counters: the hero stood at room start; slot/HP conditions hold;
          // an exhausted hero never fires.
          const startIdx = (id) => room.lineBefore.findIndex((h) => h.id === id);
          for (const c of counters(room)) {
            const idx = startIdx(c.hero);
            assert.ok(idx >= 0, `${c.hero} countered without standing`);
            const st = room.lineBefore[idx];
            const key = `${c.hero}:${c.fired ? "fired" : c.blocked}`;
            (c.fired ? fired : blocked)[key] = ((c.fired ? fired : blocked)[key] || 0) + 1;
            if (c.fired) {
              assert.equal(st.exhausted, false);
              if (c.hero === "rogue") assert.ok(idx <= 1);
              if (c.hero === "ranger") assert.equal(idx, 3);
              if (c.hero === "knight") assert.equal(idx, 0);
              if (c.hero === "berserker") assert.equal(st.hp, st.maxHp);
            } else if (c.blocked === "exhausted") assert.equal(st.exhausted, true);
          }
          // Ranger speed iff he started literally in Slot 4.
          const t = timeEv(room);
          const rangerSpeed = t.savings.some((s) => s.hero === "ranger");
          assert.equal(rangerSpeed, room.lineBefore.length === 4 && room.lineBefore[3].id === "ranger");
          assert.equal(t.saved, t.savings.reduce((a, s) => a + s.seconds, 0));
          if (room.wiped) return;
          // Every rotate event's hero ends the room last in the line.
          for (const e of ofKind(room.events, "rotate")) {
            assert.equal(room.lineAfter[room.lineAfter.length - 1].id, e.hero);
            assert.equal(room.lineAfter[room.lineAfter.length - 1].exhausted, true);
            rotations++;
          }
          // Exhausted after this room iff its rotating ability fired here
          // (and it survived) — so never two rooms in a row.
          const firedHere = counters(room).filter((c) => c.fired && (c.hero === "rogue" || c.hero === "mage"));
          for (const h of room.lineAfter) {
            assert.equal(h.exhausted, firedHere.some((c) => c.hero === h.id));
            const wasTired = room.lineBefore.find((b) => b.id === h.id).exhausted;
            assert.ok(!(wasTired && h.exhausted), `${h.id} exhausted two rooms in a row`);
          }
          if (i + 1 < r.rooms.length && r.rooms[i + 1].reached)
            assert.deepEqual(r.rooms[i + 1].lineBefore, room.lineAfter);
        });
      }
  // The sweep actually exercises every ability and every block reason.
  for (const k of ["rogue:fired", "mage:fired", "ranger:fired", "knight:fired", "berserker:fired"])
    assert.ok(fired[k] > 0, `sweep never saw ${k}`);
  for (const k of ["rogue:slot", "rogue:exhausted", "mage:exhausted", "ranger:slot", "knight:slot", "berserker:hp"])
    assert.ok(blocked[k] > 0, `sweep never saw ${k}`);
  assert.ok(rotations > 1000);
  assert.ok(blockedHeals > 0, "sweep never saw a blocked heal");
});

test("purity and determinism hold in halve mode too", () => {
  const before = JSON.stringify([S.TUNE, S.HEROES, S.ROOM_TYPES]);
  const d = rooms("trap", "swarm", "magic", "ambush", "boss");
  const dCopy = JSON.stringify(d);
  for (const lineup of allLineups()) {
    const frozen = Object.freeze([...lineup]);
    assert.deepEqual(S.runDungeon(d, frozen, HALVE), S.runDungeon(d, frozen, HALVE));
  }
  assert.equal(JSON.stringify(d), dCopy);
  assert.equal(JSON.stringify([S.TUNE, S.HEROES, S.ROOM_TYPES]), before);
});
