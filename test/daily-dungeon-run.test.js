// Unit tests for Daily Dungeon's run engine (runDungeon in src/daily-dungeon/sim.js):
// damage targets, overflow, knockouts, wipes, time and the event log (FAN-10).
// Hero abilities (FAN-11) are tested in daily-dungeon-abilities.test.js; the
// lineups here are picked so no ability changes the mechanic under test.
// Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/daily-dungeon/sim.js");

// HP (PRD §8): everyone 3, Mage 2. Default TUNE damage: trap 2, swarm 3,
// magic 3, elite 4, ambush 2, boss 5. Times: 10, 30, 25, 30, 15, 40.
const ALL4 = ["knight", "rogue", "mage", "cleric"]; // 11 HP total

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const rooms = (...types) => types.map((t) => S.makeRoom(t));
const ids = (line) => line.map((h) => h.id);
const hp = (line) => Object.fromEntries(line.map((h) => [h.id, h.hp]));
const kinds = (events) => events.map((e) => e.kind);
const damages = (events) => events.filter((e) => e.kind === "damage");

// Every ordered lineup of 4 distinct heroes (360 with 6 heroes).
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
/* Damage targets (PRD §7.2)                                              */
/* --------------------------------------------------------------------- */

// The Rogue in Slot 3 can't disarm (FAN-11), so traps land.
const TRAP4 = ["knight", "mage", "rogue", "cleric"];

test("slot1 (trap) hits only the hero in Slot 1", () => {
  const r = S.runDungeon(rooms("trap"), TRAP4);
  const room = r.rooms[0];
  assert.deepEqual(damages(room.events), [
    { kind: "damage", hero: "knight", slot: 1, amount: 2, hpBefore: 3, hpAfter: 1, overkill: 0, overflow: false },
  ]);
  assert.deepEqual(hp(room.lineAfter), { knight: 1, mage: 2, rogue: 3, cleric: 3 });
  assert.deepEqual(room.damageByHero, { knight: 2 });
  assert.equal(room.damageTaken, 2);
});

test("slot1 excess damage is lost, never carried to Slot 2", () => {
  const tune = S.withTune({ rooms: { trap: { damage: 5 } } });
  const r = S.runDungeon(rooms("trap"), ["mage", "knight", "rogue", "cleric"], tune);
  const room = r.rooms[0];
  assert.deepEqual(damages(room.events), [
    { kind: "damage", hero: "mage", slot: 1, amount: 2, hpBefore: 2, hpAfter: 0, overkill: 3, overflow: false },
  ]);
  assert.equal(room.overkill, 3);
  assert.equal(room.damageTaken, 2);
  // Mage is knocked out; the Knight moves up untouched.
  assert.deepEqual(room.lineAfter, [
    { id: "knight", hp: 3, maxHp: 3, exhausted: false },
    { id: "rogue", hp: 3, maxHp: 3, exhausted: false },
    { id: "cleric", hp: 3, maxHp: 3, exhausted: false },
  ]);
});

test("slot1 excess is lost across rooms too: a second trap knocks out the 1-HP hero and stops", () => {
  const r = S.runDungeon(rooms("trap", "trap"), TRAP4);
  const second = r.rooms[1];
  assert.deepEqual(damages(second.events), [
    { kind: "damage", hero: "knight", slot: 1, amount: 1, hpBefore: 1, hpAfter: 0, overkill: 1, overflow: false },
  ]);
  assert.deepEqual(hp(second.lineAfter), { rogue: 3, mage: 2, cleric: 3 });
});

test("front damage that a single hero absorbs does not overflow", () => {
  const r = S.runDungeon(rooms("magic"), ["rogue", "knight", "berserker", "cleric"]);
  const ev = damages(r.rooms[0].events);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { kind: "damage", hero: "rogue", slot: 1, amount: 3, hpBefore: 3, hpAfter: 0, overkill: 0, overflow: false });
});

test("front damage overflows across two heroes", () => {
  // Elite 4 into Mage (2 HP) then Knight: Mage 2→0, Knight 3→1.
  const r = S.runDungeon(rooms("elite"), ["mage", "knight", "rogue", "cleric"]);
  const room = r.rooms[0];
  assert.deepEqual(damages(room.events), [
    { kind: "damage", hero: "mage", slot: 1, amount: 2, hpBefore: 2, hpAfter: 0, overkill: 0, overflow: false },
    { kind: "damage", hero: "knight", slot: 2, amount: 2, hpBefore: 3, hpAfter: 1, overkill: 0, overflow: true },
  ]);
  assert.deepEqual(room.damageByHero, { mage: 2, knight: 2 });
  assert.equal(room.damageTaken, 4);
  assert.equal(room.overkill, 0);
  assert.deepEqual(hp(room.lineAfter), { knight: 1, rogue: 3, cleric: 3 });
});

test("front overflow can wipe the entire line in one room; the rest is overkill", () => {
  const tune = S.withTune({ rooms: { boss: { damage: 20 } } });
  // No Knight in Slot 1, Rogue in Slot 3, and a Slot-1 Cleric heals nobody.
  const r = S.runDungeon(rooms("trap", "boss", "swarm"), ["cleric", "mage", "rogue", "knight"], tune);
  const boss = r.rooms[1];
  // Cleric is at 1 after the trap: 1 + 2 + 3 + 3 = 9 absorbed, 11 lost.
  assert.deepEqual(damages(boss.events), [
    { kind: "damage", hero: "cleric", slot: 1, amount: 1, hpBefore: 1, hpAfter: 0, overkill: 0, overflow: false },
    { kind: "damage", hero: "mage", slot: 2, amount: 2, hpBefore: 2, hpAfter: 0, overkill: 0, overflow: true },
    { kind: "damage", hero: "rogue", slot: 3, amount: 3, hpBefore: 3, hpAfter: 0, overkill: 0, overflow: true },
    { kind: "damage", hero: "knight", slot: 4, amount: 3, hpBefore: 3, hpAfter: 0, overkill: 11, overflow: true },
  ]);
  assert.equal(boss.overkill, 11);
  assert.deepEqual(boss.knockouts, ["cleric", "mage", "rogue", "knight"]);
  assert.equal(boss.wiped, true);
  assert.equal(boss.cleared, false);
  assert.deepEqual(boss.lineAfter, []);
  assert.equal(r.wipedAt, 1);
  assert.equal(r.rooms[2].reached, false);
});

test("slot4 (ambush) hits the hero in Slot 4 when four are standing", () => {
  const r = S.runDungeon(rooms("ambush"), ALL4);
  assert.deepEqual(damages(r.rooms[0].events), [
    { kind: "damage", hero: "cleric", slot: 4, amount: 2, hpBefore: 3, hpAfter: 1, overkill: 0, overflow: false },
  ]);
});

test("slot4 with only 2 heroes standing hits the back-most hero (Slot 2)", () => {
  // Swarm 6 knocks out Berserker (3) and Rogue (3); Knight and Cleric are left.
  const tune = S.withTune({ rooms: { swarm: { damage: 6 } } });
  const r = S.runDungeon(rooms("swarm", "ambush"), ["berserker", "rogue", "knight", "cleric"], tune);
  assert.deepEqual(ids(r.rooms[1].lineBefore), ["knight", "cleric"]);
  assert.deepEqual(damages(r.rooms[1].events), [
    { kind: "damage", hero: "cleric", slot: 2, amount: 2, hpBefore: 3, hpAfter: 1, overkill: 0, overflow: false },
  ]);
  assert.deepEqual(hp(r.rooms[1].lineAfter), { knight: 3, cleric: 1 });
});

test("slot4 excess is lost: it does not carry forward to Slot 3", () => {
  const tune = S.withTune({ rooms: { ambush: { damage: 6 } } });
  const r = S.runDungeon(rooms("ambush"), ["knight", "rogue", "cleric", "mage"], tune);
  const room = r.rooms[0];
  assert.deepEqual(damages(room.events), [
    { kind: "damage", hero: "mage", slot: 4, amount: 2, hpBefore: 2, hpAfter: 0, overkill: 4, overflow: false },
  ]);
  assert.deepEqual(hp(room.lineAfter), { knight: 3, rogue: 3, cleric: 3 });
});

test("slot4 with a single hero standing hits that hero", () => {
  const tune = S.withTune({ rooms: { swarm: { damage: 9 } } });
  const r = S.runDungeon(rooms("swarm", "ambush"), ["berserker", "rogue", "knight", "cleric"], tune);
  assert.deepEqual(ids(r.rooms[1].lineBefore), ["cleric"]);
  assert.deepEqual(damages(r.rooms[1].events)[0].hero, "cleric");
  assert.equal(damages(r.rooms[1].events)[0].slot, 1);
});

/* --------------------------------------------------------------------- */
/* Knockouts, wipes, unreached rooms                                      */
/* --------------------------------------------------------------------- */

test("a knockout leaves the line and everyone behind moves forward", () => {
  const r = S.runDungeon(rooms("magic"), ["rogue", "knight", "berserker", "cleric"]);
  const room = r.rooms[0];
  const ko = room.events.find((e) => e.kind === "ko");
  assert.deepEqual(ko, { kind: "ko", hero: "rogue", slot: 1, line: ["knight", "berserker", "cleric"] });
  assert.deepEqual(ids(room.lineAfter), ["knight", "berserker", "cleric"]);
  assert.deepEqual(room.knockouts, ["rogue"]);
  // The next room's front hero is the Knight.
  const r2 = S.runDungeon(rooms("magic", "trap"), ["rogue", "knight", "berserker", "cleric"]);
  assert.equal(damages(r2.rooms[1].events)[0].hero, "knight");
});

test("ko events in one room come front to back, each with the line after it closed up", () => {
  const tune = S.withTune({ rooms: { swarm: { damage: 6 } } });
  const r = S.runDungeon(rooms("swarm"), ["berserker", "rogue", "knight", "cleric"], tune);
  const kos = r.rooms[0].events.filter((e) => e.kind === "ko");
  assert.deepEqual(kos, [
    { kind: "ko", hero: "berserker", slot: 1, line: ["rogue", "knight", "cleric"] },
    { kind: "ko", hero: "rogue", slot: 1, line: ["knight", "cleric"] },
  ]);
});

test("a wipe mid-run ends the run; later rooms are not reached", () => {
  // Boss 5 three times into 11 HP: Mage+Knight, then Rogue (+2 on Cleric), then Cleric.
  const r = S.runDungeon(rooms("boss", "boss", "boss", "trap", "swarm"), ["mage", "knight", "rogue", "cleric"]);
  assert.equal(r.wipedAt, 2);
  assert.equal(r.cleared, false);
  assert.equal(r.survivors, 0);
  assert.equal(r.knockouts, 4);
  assert.deepEqual(r.knockedOut, ["mage", "knight", "rogue", "cleric"]);
  assert.deepEqual(r.line, []);
  assert.deepEqual(
    r.rooms.map((x) => [x.reached, x.wiped, x.cleared]),
    [
      [true, false, true],
      [true, false, true],
      [true, true, false],
      [false, false, false],
      [false, false, false],
    ]
  );
  const wipeRoom = r.rooms[2];
  assert.deepEqual(kinds(wipeRoom.events), ["damage", "ko", "time", "wipe"]);
  assert.equal(wipeRoom.events[0].overkill, 4);
  // The wipe room was played, so its time counts; unreached rooms take none.
  assert.equal(wipeRoom.time, 40);
  assert.equal(r.totalTime, 120);
  for (const u of r.rooms.slice(3)) {
    assert.equal(u.time, 0);
    assert.deepEqual(u.events, []);
    assert.deepEqual(u.lineBefore, []);
    assert.deepEqual(u.lineAfter, []);
    assert.equal(u.damageTaken, 0);
    assert.deepEqual(u.knockouts, []);
    assert.equal(u.damage, 0);
  }
  // Unreached rooms still say what they were (for the reveal and review).
  assert.equal(r.rooms[3].type, "trap");
  assert.equal(r.rooms[4].name, "Skeleton Horde");
});

test("reached and unreached rooms have the same keys", () => {
  const r = S.runDungeon(rooms("boss", "boss", "boss", "trap"), ["mage", "knight", "rogue", "cleric"]);
  const keys = Object.keys(r.rooms[0]).sort();
  for (const room of r.rooms) assert.deepEqual(Object.keys(room).sort(), keys);
});

test("survivors and knockouts counts", () => {
  const r = S.runDungeon(rooms("elite", "ambush"), ["mage", "knight", "rogue", "cleric"]);
  // Elite: Mage KO, Knight 3→1. Ambush: Cleric 3→1.
  assert.equal(r.knockouts, 1);
  assert.deepEqual(r.knockedOut, ["mage"]);
  assert.equal(r.survivors, 3);
  assert.deepEqual(hp(r.line), { knight: 1, rogue: 3, cleric: 1 });
  assert.equal(r.cleared, true);
  assert.equal(r.wipedAt, null);
});

test("cleared is true iff a hero stands after the last room's step 3", () => {
  // 11 HP: two bosses leave only the Cleric at 1 HP; a 1-damage last room
  // knocks her out (wipe in the last room), a 0-damage one doesn't.
  const lineup = ["mage", "knight", "rogue", "cleric"];
  const wipeLast = S.withTune({ rooms: { trap: { damage: 1 } } });
  const r1 = S.runDungeon(rooms("boss", "boss", "trap"), lineup, wipeLast);
  assert.equal(r1.cleared, false);
  assert.equal(r1.wipedAt, 2);
  assert.equal(r1.rooms[2].reached, true);
  assert.equal(r1.rooms[2].wiped, true);

  const survive = S.withTune({ rooms: { trap: { damage: 0 } } });
  const r2 = S.runDungeon(rooms("boss", "boss", "trap"), lineup, survive);
  assert.equal(r2.cleared, true);
  assert.equal(r2.survivors, 1);
  assert.deepEqual(r2.line, [{ id: "cleric", hp: 1, maxHp: 3, exhausted: false }]);
});

test("a 0-damage room emits no damage events and counts as no damage taken", () => {
  const tune = S.withTune({ rooms: { trap: { damage: 0 } } });
  // No Rogue, so no counter event either.
  const r = S.runDungeon(rooms("trap"), ["knight", "mage", "berserker", "cleric"], tune);
  assert.deepEqual(kinds(r.rooms[0].events), ["time"]);
  assert.equal(r.rooms[0].damageTaken, 0);
  assert.deepEqual(r.rooms[0].damageByHero, {});
});

/* --------------------------------------------------------------------- */
/* Time (PRD §9)                                                          */
/* --------------------------------------------------------------------- */

test("totalTime is the sum of the played rooms' times; time events carry the running total", () => {
  // Light combat damage so this 12-HP party survives all five rooms. No
  // Mage, no Berserker, no Ranger in Slot 4: nothing saves time.
  const tune = S.withTune({ rooms: { swarm: { damage: 1 }, magic: { damage: 1 }, boss: { damage: 1 } } });
  const r = S.runDungeon(rooms("trap", "swarm", "magic", "ambush", "boss"), ["knight", "ranger", "rogue", "cleric"], tune);
  assert.equal(r.cleared, true);
  assert.deepEqual(
    r.rooms.map((x) => x.time),
    [10, 30, 25, 15, 40]
  );
  assert.equal(r.totalTime, 120);
  const t = r.rooms.map((x) => x.events.find((e) => e.kind === "time"));
  assert.deepEqual(t[0], { kind: "time", seconds: 10, base: 10, saved: 0, floored: false, total: 10, savings: [] });
  assert.deepEqual(
    t.map((e) => e.total),
    [10, 40, 65, 80, 120]
  );
});

test("room time is floored at tune.minRoomTime", () => {
  const tune = S.withTune({ rooms: { trap: { time: 2 } }, minRoomTime: 5 });
  const r = S.runDungeon(rooms("trap", "swarm"), ["knight", "berserker", "rogue", "cleric"], tune);
  assert.equal(r.rooms[0].time, 5);
  assert.deepEqual(r.rooms[0].events.find((e) => e.kind === "time"), {
    kind: "time",
    seconds: 5,
    base: 2,
    saved: 0,
    floored: true,
    total: 5,
    savings: [],
  });
  assert.equal(r.totalTime, 35);
});

/* --------------------------------------------------------------------- */
/* Tune drives the numbers, not the room object                           */
/* --------------------------------------------------------------------- */

test("a withTune override changes the result even for rooms built with the default tune", () => {
  const rs = rooms("trap", "elite"); // baked damage 2 / 4, time 10 / 30
  const lineup = ["berserker", "ranger", "rogue", "cleric"]; // no ability touches these rooms
  const base = S.runDungeon(rs, lineup);
  // Default: trap 2 leaves the Berserker at 1; elite 4 overflows 3 onto the Ranger.
  assert.deepEqual(base.rooms[0].knockouts, []);
  assert.deepEqual(base.knockedOut, ["berserker", "ranger"]);
  const tune = S.withTune({ rooms: { trap: { damage: 3, time: 12 } } });
  const over = S.runDungeon(rs, lineup, tune);
  // Trap 3 knocks the Berserker out, so the elite lands on the Ranger.
  assert.deepEqual(over.rooms[0].knockouts, ["berserker"]);
  assert.equal(over.rooms[0].time, 12);
  assert.equal(damages(over.rooms[1].events)[0].hero, "ranger");
  assert.notDeepEqual(over, base);
  // The room's own baked numbers (and target) are display values only.
  const lying = rs.map((r) => ({ ...r, damage: 99, time: 1, target: "slot4" }));
  assert.deepEqual(S.runDungeon(lying, lineup), base);
});

test("the room object's display fields are passed through to the result", () => {
  const r = S.runDungeon([S.makeRoom("trap", "rune-trap")], ALL4);
  const { index, type, variant, name, target, baseDamage } = r.rooms[0];
  assert.deepEqual({ index, type, variant, name, target, baseDamage }, {
    index: 0,
    type: "trap",
    variant: "rune-trap",
    name: "Rune Trap",
    target: "slot1",
    baseDamage: 2,
  });
});

/* --------------------------------------------------------------------- */
/* Event log                                                              */
/* --------------------------------------------------------------------- */

test("events within a room follow the PRD §7.5 step order and use only known kinds", () => {
  const tunes = [S.TUNE, S.withTune({ rooms: { swarm: { damage: 6 }, boss: { damage: 9 } } })];
  const dungeons = [
    rooms("trap", "swarm", "magic", "ambush", "boss"),
    rooms("boss", "elite", "swarm", "trap", "ambush"),
  ];
  let checked = 0;
  let wipes = 0;
  for (const tune of tunes)
    for (const d of dungeons)
      for (const lineup of allLineups()) {
        const r = S.runDungeon(d, lineup, tune);
        r.rooms.forEach((room, i) => {
          let step = 0;
          for (const e of room.events) {
            assert.ok(S.EVENT_KINDS.includes(e.kind), `unknown event kind ${e.kind}`);
            assert.ok(S.EVENT_STEP[e.kind] >= step, `${e.kind} after step ${step}`);
            step = S.EVENT_STEP[e.kind];
          }
          // Exactly one time event per played room, none in unreached ones.
          assert.equal(room.events.filter((e) => e.kind === "time").length, room.reached ? 1 : 0);
          // The wipe is terminal: only in rooms[wipedAt], once, as its last event,
          // right after the time event; no room after it has any events.
          const w = room.events.filter((e) => e.kind === "wipe").length;
          assert.equal(w, i === r.wipedAt ? 1 : 0);
          assert.equal(room.wiped, i === r.wipedAt);
          if (i === r.wipedAt) {
            const ks = kinds(room.events);
            assert.equal(ks[ks.length - 1], "wipe");
            assert.equal(ks[ks.length - 2], "time");
            assert.equal(ks[ks.length - 3], "ko");
          }
          if (r.wipedAt !== null && i > r.wipedAt) assert.deepEqual(room.events, []);
          checked++;
        });
        if (r.wipedAt !== null) wipes++;
        const allWipes = r.rooms.flatMap((room) => room.events).filter((e) => e.kind === "wipe");
        assert.equal(allWipes.length, r.wipedAt === null ? 0 : 1);
      }
  assert.ok(checked > 3000);
  assert.ok(wipes > 100, `the sweep should include wipes (got ${wipes})`);
});

test("event order in a room with damage, knockouts and a wipe: the wipe comes last", () => {
  const tune = S.withTune({ rooms: { swarm: { damage: 20 } } });
  // No Mage or Knight, so no counter event in the swarm.
  const r = S.runDungeon(rooms("swarm", "trap"), ["berserker", "rogue", "ranger", "cleric"], tune);
  assert.deepEqual(kinds(r.rooms[0].events), [
    "damage",
    "damage",
    "damage",
    "damage",
    "ko",
    "ko",
    "ko",
    "ko",
    "time",
    "wipe",
  ]);
  assert.deepEqual(r.rooms[0].events[9], { kind: "wipe" });
  assert.equal(r.rooms[0].time, 30);
  assert.deepEqual(r.rooms[1].events, []);
});

test("hp bookkeeping: damage events, damageByHero and the lines agree (all lineups)", () => {
  const d = rooms("trap", "swarm", "elite", "ambush", "boss");
  for (const lineup of allLineups()) {
    const r = S.runDungeon(d, lineup);
    let sumTime = 0;
    for (const room of r.rooms) {
      sumTime += room.time;
      if (!room.reached) continue;
      const fromEvents = {};
      for (const e of damages(room.events)) {
        assert.equal(e.hpAfter, e.hpBefore - e.amount);
        assert.ok(e.hpAfter >= 0 && e.amount >= 0 && e.overkill >= 0);
        fromEvents[e.hero] = (fromEvents[e.hero] || 0) + e.amount;
      }
      assert.deepEqual(room.damageByHero, fromEvents);
      const total = Object.values(fromEvents).reduce((a, b) => a + b, 0);
      assert.equal(room.damageTaken, total);
      // Damage in = HP lost + overkill.
      assert.equal(room.damage, room.damageTaken + room.overkill);
      // HP before − damage + Cleric heal (FAN-11) = HP after, for heroes still standing.
      const healed = {};
      for (const e of room.events) if (e.kind === "heal") healed[e.hero] = (healed[e.hero] || 0) + e.amount;
      for (const h of room.lineAfter) {
        const before = room.lineBefore.find((b) => b.id === h.id);
        assert.equal(h.hp, before.hp - (fromEvents[h.id] || 0) + (healed[h.id] || 0));
        assert.ok(h.hp > 0 && h.hp <= h.maxHp);
      }
      assert.equal(room.lineAfter.length + room.knockouts.length, room.lineBefore.length);
    }
    assert.equal(r.totalTime, sumTime);
    assert.equal(r.survivors + r.knockouts, 4);
    assert.equal(r.cleared, r.wipedAt === null);
    assert.equal(r.cleared, r.survivors > 0);
    if (r.wipedAt !== null) for (const room of r.rooms.slice(r.wipedAt + 1)) assert.equal(room.reached, false);
  }
});

/* --------------------------------------------------------------------- */
/* Step hooks (for FAN-11)                                                */
/* --------------------------------------------------------------------- */

test("step 2 honours a step-1 damage modifier (floored at 0) and ctx.cancelled", () => {
  const { newRoomContext, stepDamage } = S._internal;
  const freshLine = () => ALL4.map((id) => ({ id, hp: S.heroById(id).hp, maxHp: S.heroById(id).hp, exhausted: false }));

  let ctx = newRoomContext(S.makeRoom("elite"), 0, freshLine(), S.TUNE, 0);
  assert.equal(ctx.damage, 4);
  ctx.damage -= 2; // e.g. a Knight reduction
  stepDamage(ctx);
  assert.deepEqual(damages(ctx.events).map((e) => [e.hero, e.amount]), [["knight", 2]]);
  assert.equal(ctx.damage, 2);

  ctx = newRoomContext(S.makeRoom("elite"), 0, freshLine(), S.TUNE, 0);
  ctx.damage = -3;
  stepDamage(ctx);
  assert.deepEqual(ctx.events, []);
  assert.equal(ctx.damage, 0);

  ctx = newRoomContext(S.makeRoom("trap"), 0, freshLine(), S.TUNE, 0);
  ctx.cancelled = true;
  stepDamage(ctx);
  assert.deepEqual(ctx.events, []);
  assert.equal(ctx.damage, 0);
  assert.equal(ctx.line[0].hp, 3);
});

test("the room context snapshots the line at room start (slot conditions)", () => {
  const { newRoomContext, stepDamage } = S._internal;
  const line = ALL4.map((id) => ({ id, hp: S.heroById(id).hp, maxHp: S.heroById(id).hp, exhausted: false }));
  const ctx = newRoomContext(S.makeRoom("trap"), 0, line, S.TUNE, 0);
  stepDamage(ctx);
  assert.equal(ctx.line[0].hp, 1);
  assert.equal(ctx.lineAtStart[0].hp, 3);
  assert.notEqual(ctx.lineAtStart[0], ctx.line[0]);
});

/* --------------------------------------------------------------------- */
/* Purity and determinism                                                 */
/* --------------------------------------------------------------------- */

test("determinism: the same inputs give deep-equal output", () => {
  const d = rooms("trap", "swarm", "magic", "ambush", "boss");
  for (const lineup of allLineups().slice(0, 60)) {
    assert.deepEqual(S.runDungeon(d, lineup), S.runDungeon(d, lineup));
  }
  const tune = S.withTune({ rooms: { boss: { damage: 7 } } });
  assert.deepEqual(S.runDungeon(d, ALL4, tune), S.runDungeon(d, ALL4, tune));
});

test("purity: frozen inputs are accepted, and TUNE and the tables are untouched", () => {
  const snap = () => JSON.stringify([S.TUNE, S.HEROES, S.ROOM_TYPES, S.HERO_IDS, S.ROOM_TYPE_IDS, S.TARGETS]);
  const before = snap();
  const d = deepFreeze(rooms("trap", "swarm", "elite", "ambush", "boss"));
  const dCopy = JSON.stringify(d);
  const tune = S.withTune({ rooms: { boss: { damage: 30 } } });
  for (const lineup of allLineups()) {
    const frozen = deepFreeze([...lineup]);
    assert.doesNotThrow(() => S.runDungeon(d, frozen));
    assert.doesNotThrow(() => S.runDungeon(d, frozen, tune));
    assert.deepEqual(frozen, lineup);
  }
  assert.equal(JSON.stringify(d), dCopy);
  assert.equal(snap(), before);
});

test("line snapshots are copies, never live references", () => {
  const r = S.runDungeon(rooms("trap", "ambush", "elite"), ALL4);
  assert.deepEqual(r.rooms[0].lineAfter, r.rooms[1].lineBefore);
  assert.notEqual(r.rooms[0].lineAfter, r.rooms[1].lineBefore);
  assert.notEqual(r.rooms[0].lineAfter[0], r.rooms[1].lineBefore[0]);
  assert.notEqual(r.rooms[2].lineAfter[0], r.line[0]);
  // Mutating a snapshot changes nothing else.
  const expected = JSON.stringify(r.rooms[1]);
  r.rooms[0].lineAfter[0].hp = 99;
  r.rooms[0].lineAfter.length = 0;
  r.line[0].hp = 42;
  assert.equal(JSON.stringify(r.rooms[1]), expected);
  // The Rogue disarmed the trap (FAN-11), so the Knight still leads after the
  // elite, guarding it down to 2 damage.
  assert.deepEqual(r.rooms[2].lineAfter[0], { id: "knight", hp: 1, maxHp: 3, exhausted: false });
});

test("hero state starts at maxHp from the HEROES table, not exhausted", () => {
  const r = S.runDungeon(rooms("trap"), ["mage", "ranger", "berserker", "cleric"]);
  assert.deepEqual(r.rooms[0].lineBefore, [
    { id: "mage", hp: 2, maxHp: 2, exhausted: false },
    { id: "ranger", hp: 3, maxHp: 3, exhausted: false },
    { id: "berserker", hp: 3, maxHp: 3, exhausted: false },
    { id: "cleric", hp: 3, maxHp: 3, exhausted: false },
  ]);
});

/* --------------------------------------------------------------------- */
/* Input validation                                                       */
/* --------------------------------------------------------------------- */

test("runDungeon validates its inputs with clear errors", () => {
  const d = rooms("trap");
  assert.throws(() => S.runDungeon([], ALL4), /rooms must be a non-empty array/);
  assert.throws(() => S.runDungeon(null, ALL4), /rooms must be a non-empty array/);
  assert.throws(() => S.runDungeon([null], ALL4), /room 0 must be a room object/);
  assert.throws(() => S.runDungeon([...d, { type: "dragon" }], ALL4), /room 1 has unknown room type 'dragon'/);
  assert.throws(() => S.runDungeon(d, ["knight", "rogue", "mage"]), /exactly 4 hero ids, got 3/);
  assert.throws(() => S.runDungeon(d, [...ALL4, "ranger"]), /exactly 4 hero ids, got 5/);
  assert.throws(() => S.runDungeon(d, "knight"), /exactly 4 hero ids/);
  assert.throws(() => S.runDungeon(d, ["knight", "rogue", "mage", "bard"]), /unknown hero 'bard'/);
  assert.throws(() => S.runDungeon(d, ["knight", "rogue", "knight", "cleric"]), /duplicate hero 'knight'/);
});

test("any number of rooms >= 1 is accepted", () => {
  assert.equal(S.runDungeon(rooms("ambush"), ALL4).rooms.length, 1);
  assert.equal(S.runDungeon(rooms("trap", "trap", "trap", "trap", "trap", "trap", "trap"), ALL4).rooms.length, 7);
});
