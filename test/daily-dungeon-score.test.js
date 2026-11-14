// Unit tests for Daily Dungeon's scoring and share text (src/daily-dungeon/sim.js):
// stars, best attempt, per-room codes and the share grid (FAN-12, PRD §10, §13).
//
// Two kinds of input:
//  - Hand-built results in the documented runDungeon shape (`fake`). Every
//    exact-string share-text snapshot uses these: they test the format, not
//    the engine, so ability changes (FAN-11 and later) can't break them.
//  - Real runDungeon results with hero abilities live. Their lineups are
//    picked so that no ability can change anyone's HP (see the fixtures), and
//    times are always read from the result, never hard-coded. The property
//    sweep and the leak sweep run every lineup and derive what they expect.
// Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/daily-dungeon/sim.js");

// HP (PRD §8): everyone 3, Mage 2. Default TUNE damage: trap 2 (slot1),
// swarm 3, magic 3, elite 4 (front), ambush 2 (slot4), boss 5 (front).
const rooms = (...types) => types.map((t) => S.makeRoom(t));
const FIVE_TRAPS = rooms("trap", "trap", "trap", "trap", "trap");
const FIVE_BOSSES = rooms("boss", "boss", "boss", "boss", "boss");

// No room deals damage: every room is flawless, nobody is knocked out.
const SAFE = S.withTune({
  rooms: {
    trap: { damage: 0 },
    swarm: { damage: 0 },
    magic: { damage: 0 },
    elite: { damage: 0 },
    ambush: { damage: 0 },
    boss: { damage: 0 },
  },
});

// Lineups where no ability touches HP (checked against FAN-11's rules):
//  - TRAP_LINEUP in trap rooms: no Rogue (the only trap counter) and no
//    Cleric (the only healer). The Knight's reduction is for combat rooms,
//    the Mage clears only Swarm/Magic, the Berserker saves time in the boss
//    room only, and the Ranger only saves time here (no Ambush).
//  - BOSS_LINEUP in boss rooms: no Knight (the boss's damage reduction) and
//    no Cleric. The boss can't be cleared by the Mage, the Rogue only counters
//    traps, and the Berserker and Ranger only save time.
const TRAP_LINEUP = ["knight", "berserker", "mage", "ranger"];
const BOSS_LINEUP = ["berserker", "rogue", "mage", "ranger"];

// Real runs used throughout. The codes in the comments follow from HP alone.
// Cleared, no knockouts, all ⚔️:
const clean = () => S.runDungeon(FIVE_TRAPS, TRAP_LINEUP, SAFE);
// Traps hit Slot 1 for 2: knight 3 → 1 → KO, berserker 3 → 1 → KO, mage
// 2 → KO in room 5; the ranger is left standing. Cleared, 3 KOs, all 😬:
const koClear = () => S.runDungeon(FIVE_TRAPS, TRAP_LINEUP);
// The boss hits the front for 5, overflowing, against 11 HP: KOs in rooms 1
// and 2, wiped in room 3. 😬 😬 💀 ⬜ ⬜:
const wipeLate = () => S.runDungeon(FIVE_BOSSES, BOSS_LINEUP);
// The same with an 11-damage boss: wiped in room 1. 💀 ⬜ ⬜ ⬜ ⬜:
const wipeEarly = () => S.runDungeon(FIVE_BOSSES, BOSS_LINEUP, S.withTune({ rooms: { boss: { damage: 11 } } }));

// The literal glyphs the snapshots use. The first test proves these literals
// still carry the right code points (an editor can silently strip U+FE0F).
const F = "⚔️"; // flawless
const D = "😬"; // damaged
const W = "💀"; // wipe
const U = "⬜"; // unreached

// A hand-built result in the documented shape, from a string of codes.
// `kos` is the run's knockout count; damaged rooms take 1 damage.
function fake(codes, { totalTime, kos = 0 } = {}) {
  const list = [...codes.matchAll(/⚔️|😬|💀|⬜/gu)].map((m) => m[0]);
  const wipedAt = list.indexOf(W);
  const roomsOut = list.map((c, i) => ({
    index: i,
    reached: c !== U,
    cleared: c === F || c === D,
    wiped: c === W,
    damageTaken: c === D || c === W ? 1 : 0,
    knockouts: [],
  }));
  return {
    rooms: roomsOut,
    totalTime,
    knockouts: kos,
    cleared: wipedAt < 0,
    wipedAt: wipedAt < 0 ? null : wipedAt,
  };
}

// Hand-built stand-ins for the share snapshots.
const fClean = (t = 50) => fake("⚔️⚔️⚔️⚔️⚔️", { totalTime: t });
const fKoClear = (t = 50) => fake("😬😬😬😬😬", { totalTime: t, kos: 3 });
const fWipeLate = () => fake("😬😬💀⬜⬜", { totalTime: 120, kos: 4 });
const fWipeEarly = () => fake("💀⬜⬜⬜⬜", { totalTime: 40, kos: 4 });

/* --------------------------------------------------------------------- */
/* Glyphs                                                                 */
/* --------------------------------------------------------------------- */

const cps = (s) => [...s].map((c) => c.codePointAt(0));

test("⚔️ keeps its variation selector (U+2694 U+FE0F), in the table and in this file", () => {
  assert.deepEqual(cps(S.ROOM_CODES.flawless), [0x2694, 0xfe0f]);
  assert.deepEqual(cps(F), [0x2694, 0xfe0f]);
  assert.equal(S.ROOM_CODES.flawless, F);
  assert.equal(S.ROOM_CODES.damaged, D);
  assert.equal(S.ROOM_CODES.wipe, W);
  assert.equal(S.ROOM_CODES.unreached, U);
  const text = S.shareText({ dayNumber: 1, attempts: [fClean()], parTime: 99 });
  assert.ok(text.includes("\u2694\uFE0F"));
  assert.doesNotMatch(text, /\u2694(?!\uFE0F)/u, "every ⚔️ must be followed by U+FE0F");
});

test("STAR_NAMES labels 0–3 stars for the UI", () => {
  assert.deepEqual([...S.STAR_NAMES], ["", "Clear", "Unscathed", "Gold Par"]);
  assert.ok(Object.isFrozen(S.STAR_NAMES));
  assert.ok(Object.isFrozen(S.ROOM_CODES));
});

/* --------------------------------------------------------------------- */
/* Stars (PRD §10)                                                        */
/* --------------------------------------------------------------------- */

test("0★: a wiped run, whatever its time", () => {
  const r = wipeLate();
  assert.equal(r.cleared, false);
  assert.equal(S.stars(r, 1e9), 0);
  assert.equal(S.stars(wipeEarly(), 1e9), 0);
});

test("1★: cleared with a knockout, even far under par", () => {
  const r = koClear();
  assert.equal(r.cleared, true);
  assert.equal(r.knockouts, 3);
  assert.equal(S.stars(r, 1e9), 1);
});

test("2★: zero knockouts, time over par", () => {
  const r = clean();
  assert.equal(r.knockouts, 0);
  assert.equal(S.stars(r, r.totalTime - 1), 2);
});

test("time equal to par is 2★, not 3★ (under par is strict)", () => {
  const r = clean();
  assert.equal(S.stars(r, r.totalTime), 2);
});

test("3★: zero knockouts and time strictly under par", () => {
  const r = clean();
  assert.equal(S.stars(r, r.totalTime + 1), 3);
  assert.equal(S.stars(r, r.totalTime + 0.001), 3);
});

test("stars validates its inputs", () => {
  assert.throws(() => S.stars(clean()), /parTime/);
  assert.throws(() => S.stars(clean(), NaN), /parTime/);
  assert.throws(() => S.stars(null, 50), /runDungeon result/);
  assert.throws(() => S.stars({ rooms: [] }, 50), /cleared/);
});

/* --------------------------------------------------------------------- */
/* Room codes (PRD §13.2)                                                 */
/* --------------------------------------------------------------------- */

test("codes from real runs: flawless, damaged, wipe, unreached", () => {
  assert.deepEqual(S.roomCodes(clean()), [F, F, F, F, F]);
  assert.deepEqual(S.roomCodes(koClear()), [D, D, D, D, D]);
  assert.deepEqual(S.roomCodes(wipeLate()), [D, D, W, U, U]);
  assert.deepEqual(S.roomCodes(wipeEarly()), [W, U, U, U, U]);
});

test("a mixed run: only rooms that cost HP are 😬", () => {
  // Only the trap deals damage (2 to Slot 1). The Mage clears room 1 and
  // rotates to the back, so the knight is still in Slot 1 for the trap. With
  // no Rogue and no Cleric, nothing cancels or heals it.
  const tune = S.withTune({ rooms: { swarm: { damage: 0 }, magic: { damage: 0 }, boss: { damage: 0 } } });
  const r = S.runDungeon(rooms("swarm", "trap", "magic", "magic", "boss"), TRAP_LINEUP, tune);
  assert.deepEqual(S.roomCodes(r), [F, D, F, F, F]);
  assert.equal(S.roomCode(r.rooms[1]), D);
});

test("roomCode: a knockout makes 😬 even with no damage recorded; healing doesn't help", () => {
  const base = { reached: true, wiped: false, damageTaken: 0, knockouts: [] };
  assert.equal(S.roomCode(base), F);
  assert.equal(S.roomCode({ ...base, knockouts: ["mage"] }), D);
  // Lost 1 HP and healed back to full (lineAfter is irrelevant): still 😬.
  assert.equal(
    S.roomCode({ ...base, damageTaken: 1, lineAfter: [{ id: "knight", hp: 3, maxHp: 3, exhausted: false }] }),
    D,
  );
  assert.equal(S.roomCode({ ...base, wiped: true, damageTaken: 5 }), W);
  assert.equal(S.roomCode({ ...base, reached: false }), U);
  assert.throws(() => S.roomCode(null), /room result/);
  assert.throws(() => S.roomCodes({}), /runDungeon result/);
});

/* --------------------------------------------------------------------- */
/* End to end, abilities live: every lineup, expectations derived         */
/* --------------------------------------------------------------------- */

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

// Five distinct room types. `harsh` makes traps and ambushes lethal so the
// sweeps see knockouts and wipes as well as clears.
const DUNGEON = [
  S.makeRoom("trap", "pit-trap"),
  S.makeRoom("swarm"),
  S.makeRoom("ambush"),
  S.makeRoom("elite"),
  S.makeRoom("boss", "the-lich"),
];
const HARSH = S.withTune({ rooms: { trap: { damage: 3 }, ambush: { damage: 3 } } });

test("every lineup: codes and stars agree with the room results (abilities live)", () => {
  const seenCodes = new Set();
  const seenStars = new Set();
  for (const lineup of allLineups()) {
    for (const tune of [S.TUNE, HARSH, SAFE]) {
      const r = S.runDungeon(DUNGEON, lineup, tune);
      // Codes, derived independently from each room's documented fields.
      const expected = r.rooms.map((room) =>
        !room.reached ? U : room.wiped ? W : room.damageTaken > 0 || room.knockouts.length > 0 ? D : F,
      );
      const codes = S.roomCodes(r);
      assert.deepEqual(codes, expected, lineup.join(","));
      codes.forEach((c) => seenCodes.add(c));
      // A wipe is the last room played: at most one 💀, and only ⬜ after it.
      const w = codes.indexOf(W);
      assert.equal(w < 0, r.cleared);
      if (w >= 0) assert.ok(codes.slice(w + 1).every((c) => c === U));
      else assert.ok(!codes.includes(U));
      // Stars, from the rooms: wiped → 0, any KO → 1, else par decides.
      const kos = r.rooms.reduce((n, room) => n + room.knockouts.length, 0);
      const base = codes.includes(W) ? 0 : kos > 0 ? 1 : null;
      for (const par of [r.totalTime, r.totalTime + 1]) {
        const s = S.stars(r, par);
        assert.equal(s, base !== null ? base : par > r.totalTime ? 3 : 2, `${lineup.join(",")} par ${par}`);
        seenStars.add(s);
      }
    }
  }
  // The sweep isn't vacuous: it saw every code and every star count.
  assert.deepEqual([...seenCodes].sort(), [F, D, W, U].sort());
  assert.deepEqual([...seenStars].sort(), [0, 1, 2, 3]);
});

test("end to end: three real attempts through shareText", () => {
  const attempts = [wipeLate(), koClear(), clean()];
  const par = 1; // nothing is under par, so the clean run is the 2★ best
  assert.deepEqual(S.bestAttempt(attempts, par), { index: 2, stars: 2, totalTime: attempts[2].totalTime });
  assert.equal(
    S.shareText({ dayNumber: 37, attempts, parTime: par }),
    `Daily Dungeon #37  ★★☆  ${Math.floor(attempts[2].totalTime)}s\n` +
      "Attempt 1: 😬 😬 💀 ⬜ ⬜\n" +
      "Attempt 2: 😬 😬 😬 😬 😬\n" +
      "Attempt 3: ⚔️ ⚔️ ⚔️ ⚔️ ⚔️",
  );
});

/* --------------------------------------------------------------------- */
/* Best attempt (PRD §10 "Best result")                                   */
/* --------------------------------------------------------------------- */

test("an empty list has no best attempt", () => {
  assert.equal(S.bestAttempt([], 60), null);
});

test("more stars beats faster", () => {
  const slow2 = fake("⚔️⚔️⚔️⚔️⚔️", { totalTime: 90 }); // 2★ at par 60
  const fast1 = fake("😬😬😬😬😬", { totalTime: 20, kos: 1 }); // 1★
  assert.deepEqual(S.bestAttempt([fast1, slow2], 60), { index: 1, stars: 2, totalTime: 90 });
  // Real runs: a cleared run beats a wipe, and 2★ beats 1★, whatever the times.
  const [early, ko, ok] = [wipeEarly(), koClear(), clean()];
  assert.deepEqual(S.bestAttempt([early, ko, ok], 1), { index: 2, stars: 2, totalTime: ok.totalTime });
  assert.deepEqual(S.bestAttempt([early, ko], 1), { index: 1, stars: 1, totalTime: ko.totalTime });
});

test("3★ beats a faster run that missed par only through a knockout", () => {
  const gold = fake("⚔️⚔️⚔️⚔️⚔️", { totalTime: 59 });
  const fastKo = fake("😬⚔️⚔️⚔️⚔️", { totalTime: 30, kos: 1 });
  assert.equal(S.bestAttempt([fastKo, gold], 60).index, 1);
});

test("equal stars: the faster attempt wins", () => {
  const a = fake("😬⚔️⚔️⚔️⚔️", { totalTime: 80, kos: 1 });
  const b = fake("😬😬⚔️⚔️⚔️", { totalTime: 70, kos: 2 });
  assert.deepEqual(S.bestAttempt([a, b], 60), { index: 1, stars: 1, totalTime: 70 });
  assert.deepEqual(S.bestAttempt([b, a], 60), { index: 0, stars: 1, totalTime: 70 });
});

test("an exact tie keeps the earlier attempt", () => {
  assert.equal(S.bestAttempt([clean(), clean()], 60).index, 0);
  assert.equal(S.bestAttempt([koClear(), clean(), clean()], 60).index, 1);
  assert.equal(S.bestAttempt([wipeLate(), wipeLate(), wipeLate()], 60).index, 0);
});

test("0★: reaching more rooms beats dying sooner (a deliberate PRD §10 rule)", () => {
  // The room-1 wipe has the lower total time; time alone would rank it best.
  const early = wipeEarly(); // reached 1 room
  const late = wipeLate(); // reached 3 rooms
  assert.ok(early.totalTime < late.totalTime, "precondition: the early wipe is faster");
  assert.deepEqual(S.bestAttempt([early, late], 60), { index: 1, stars: 0, totalTime: late.totalTime });
  assert.deepEqual(S.bestAttempt([late, early], 60), { index: 0, stars: 0, totalTime: late.totalTime });
});

test("0★ with equal rooms reached: lower time, then the earlier attempt", () => {
  const slow = fake("😬😬💀⬜⬜", { totalTime: 100, kos: 4 });
  const fast = fake("⚔️😬💀⬜⬜", { totalTime: 70, kos: 4 });
  assert.equal(S.bestAttempt([slow, fast], 60).index, 1);
  assert.equal(S.bestAttempt([fast, slow, fast], 60).index, 0);
});

test("rooms reached only breaks ties at 0★, not at 1★ or more", () => {
  // Both are 1★ and reach all five rooms; it's time that decides.
  const a = fake("😬😬😬😬😬", { totalTime: 90, kos: 1 });
  const b = fake("😬⚔️⚔️⚔️⚔️", { totalTime: 85, kos: 1 });
  assert.equal(S.bestAttempt([a, b], 60).index, 1);
});

test("bestAttempt validates its inputs", () => {
  assert.throws(() => S.bestAttempt(null, 60), /array/);
  assert.throws(() => S.bestAttempt([clean()]), /parTime/);
  assert.throws(() => S.bestAttempt([{}], 60), /runDungeon result/);
});

/* --------------------------------------------------------------------- */
/* Share text (PRD §13.3) — full exact-string snapshots, hand-built input */
/* --------------------------------------------------------------------- */

test("snapshot: the PRD §13.3 example", () => {
  const a1 = fake("⚔️😬💀⬜⬜", { totalTime: 55, kos: 4 });
  const a2 = fake("⚔️⚔️😬😬⚔️", { totalTime: 73 });
  assert.equal(
    S.shareText({ dayNumber: 142, attempts: [a1, a2], parTime: 80 }),
    "Daily Dungeon #142  ★★★  73s\n" + "Attempt 1: ⚔️ 😬 💀 ⬜ ⬜\n" + "Attempt 2: ⚔️ ⚔️ 😬 😬 ⚔️",
  );
});

test("snapshot: 3★ on attempt 1 (one row)", () => {
  assert.equal(
    S.shareText({ dayNumber: 1, attempts: [fClean()], parTime: 53 }),
    "Daily Dungeon #1  ★★★  50s\nAttempt 1: ⚔️ ⚔️ ⚔️ ⚔️ ⚔️",
  );
});

test("snapshot: three attempts, best is the 2★ third", () => {
  assert.equal(
    S.shareText({ dayNumber: 37, attempts: [fWipeLate(), fKoClear(), fClean()], parTime: 45 }),
    "Daily Dungeon #37  ★★☆  50s\n" +
      "Attempt 1: 😬 😬 💀 ⬜ ⬜\n" +
      "Attempt 2: 😬 😬 😬 😬 😬\n" +
      "Attempt 3: ⚔️ ⚔️ ⚔️ ⚔️ ⚔️",
  );
});

test("snapshot: a 1★ best shows one filled star and two hollow", () => {
  assert.equal(
    S.shareText({ dayNumber: 8, attempts: [fWipeEarly(), fKoClear()], parTime: 45 }),
    "Daily Dungeon #8  ★☆☆  50s\nAttempt 1: 💀 ⬜ ⬜ ⬜ ⬜\nAttempt 2: 😬 😬 😬 😬 😬",
  );
});

test("snapshot: no clear at all shows ✗ and no time", () => {
  assert.equal(
    S.shareText({ dayNumber: 200, attempts: [fWipeEarly(), fWipeLate(), fWipeEarly()], parTime: 300 }),
    "Daily Dungeon #200  ✗\n" +
      "Attempt 1: 💀 ⬜ ⬜ ⬜ ⬜\n" +
      "Attempt 2: 😬 😬 💀 ⬜ ⬜\n" +
      "Attempt 3: 💀 ⬜ ⬜ ⬜ ⬜",
  );
});

test("snapshot: showTime: false drops the time", () => {
  assert.equal(
    S.shareText({ dayNumber: 142, attempts: [fKoClear(), fClean()], parTime: 53, showTime: false }),
    "Daily Dungeon #142  ★★★\nAttempt 1: 😬 😬 😬 😬 😬\nAttempt 2: ⚔️ ⚔️ ⚔️ ⚔️ ⚔️",
  );
  // showTime defaults to true; false with no clear is still just ✗.
  assert.equal(
    S.shareText({ dayNumber: 3, attempts: [fWipeEarly()], parTime: 60, showTime: false }),
    "Daily Dungeon #3  ✗\nAttempt 1: 💀 ⬜ ⬜ ⬜ ⬜",
  );
});

test("the time is the best attempt's, in whole seconds rounded down", () => {
  const r = fClean(53.5);
  assert.equal(
    S.shareText({ dayNumber: 9, attempts: [r], parTime: 53.6 }).split("\n")[0],
    "Daily Dungeon #9  ★★★  53s",
  );
  assert.equal(S.shareText({ dayNumber: 9, attempts: [r], parTime: 40 }).split("\n")[0], "Daily Dungeon #9  ★★☆  53s");
  // It's the best attempt's time, not the fastest attempt's.
  assert.equal(
    S.shareText({ dayNumber: 9, attempts: [fKoClear(20), fClean(61.9)], parTime: 40 }).split("\n")[0],
    "Daily Dungeon #9  ★★☆  61s",
  );
});

test("no trailing newline, two-space separators, one row per attempt played", () => {
  const text = S.shareText({ dayNumber: 5, attempts: [fWipeLate(), fClean()], parTime: 60 });
  assert.ok(!text.endsWith("\n"));
  assert.equal(text.split("\n").length, 3);
  assert.equal(text.split("\n")[0], "Daily Dungeon #5  ★★★  50s");
});

test("shareText validates its inputs", () => {
  const ok = { dayNumber: 1, attempts: [fClean()], parTime: 60 };
  assert.throws(() => S.shareText(), /options object/);
  assert.throws(() => S.shareText({ ...ok, attempts: [] }), /1-3/);
  assert.throws(() => S.shareText({ ...ok, attempts: [fClean(), fClean(), fClean(), fClean()] }), /1-3/);
  assert.throws(() => S.shareText({ ...ok, attempts: fClean() }), /1-3/);
  assert.throws(() => S.shareText({ ...ok, dayNumber: 1.5 }), /dayNumber/);
  assert.throws(() => S.shareText({ ...ok, dayNumber: "142" }), /dayNumber/);
  assert.throws(() => S.shareText({ ...ok, dayNumber: undefined }), /dayNumber/);
  assert.throws(() => S.shareText({ ...ok, parTime: undefined }), /parTime/);
  assert.throws(() => S.shareText({ ...ok, showTime: "no" }), /showTime/);
  assert.throws(() => S.shareText({ ...ok, attempts: [{}] }), /runDungeon result/);
});

/* --------------------------------------------------------------------- */
/* Spoiler-free (PRD §13.3)                                               */
/* --------------------------------------------------------------------- */

test("share text never contains a hero, room or Rumor from the data tables", () => {
  const banned = [];
  for (const h of S.HEROES) banned.push(h.id, h.name, h.emoji, h.role);
  for (const id of S.ROOM_TYPE_IDS) {
    const t = S.ROOM_TYPES[id];
    banned.push(t.id, t.name, t.emoji);
    for (const v of t.variants) banned.push(v.id, v.name);
  }
  for (const r of S.RUMORS) banned.push(r.id, r.text);
  const lower = banned.map((s) => s.toLowerCase());

  // Every lineup with abilities live, across clears, knockouts and wipes.
  const code = "(?:⚔️|😬|💀|⬜)";
  const shape = new RegExp(
    `^Daily Dungeon #\\d+  (?:[★☆]{3}(?:  \\d+s)?|✗)(?:\\nAttempt [1-3]: ${code}(?: ${code}){4})+$`,
    "u",
  );
  let checked = 0;
  for (const lineup of allLineups()) {
    const attempts = [
      S.runDungeon(DUNGEON, lineup, HARSH),
      S.runDungeon(DUNGEON, lineup),
      S.runDungeon(DUNGEON, lineup, SAFE),
    ];
    for (const n of [1, 2, 3]) {
      for (const showTime of [true, false]) {
        const text = S.shareText({ dayNumber: 142, attempts: attempts.slice(0, n), parTime: 200, showTime });
        assert.match(text, shape);
        const t = text.toLowerCase();
        for (const b of lower) assert.ok(!t.includes(b), `share text leaked "${b}": ${text}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 360 * 6);
});
