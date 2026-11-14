// Unit tests for the game-agnostic daily plumbing (src/daily-dungeon/daily.js).
// Run with: node --test test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const D = require("../src/daily-dungeon/daily.js");

const MODULE = path.join(__dirname, "..", "src", "daily-dungeon", "daily.js");

/* ---------------------------------------------------------------- days */

test("dayKey uses the UTC date on both sides of 00:00 UTC", () => {
  assert.equal(D.dayKey(new Date("2026-11-13T23:59:59.999Z")), "2026-11-13");
  assert.equal(D.dayKey(new Date("2026-11-14T00:00:00.000Z")), "2026-11-14");
  // An instant written with a local offset is still keyed by its UTC date.
  assert.equal(D.dayKey(new Date("2026-11-13T18:30:00-08:00")), "2026-11-14"); // 02:30Z
  assert.equal(D.dayKey(new Date("2026-11-14T09:00:00+14:00")), "2026-11-13"); // 19:00Z
  assert.equal(D.dayKey(Date.UTC(2026, 11, 31, 23, 59)), "2026-12-31"); // timestamp
  assert.equal(D.dayKey(Date.UTC(2027, 0, 1)), "2027-01-01");
  assert.match(D.dayKey(), /^\d{4}-\d{2}-\d{2}$/); // defaults to now
  assert.throws(() => D.dayKey(new Date("nope")), RangeError);
});

test("parseDayKey / shiftDayKey handle month, year and leap boundaries", () => {
  assert.equal(D.parseDayKey("2026-11-14"), Date.UTC(2026, 10, 14));
  assert.throws(() => D.parseDayKey("2026-02-30"), RangeError);
  assert.throws(() => D.parseDayKey("2026-1-01"), RangeError);
  assert.equal(D.shiftDayKey("2026-12-31", 1), "2027-01-01");
  assert.equal(D.shiftDayKey("2028-02-28", 1), "2028-02-29");
  assert.equal(D.shiftDayKey("2026-03-01", -1), "2026-02-28");
  assert.equal(D.shiftDayKey("2026-11-14", 365), "2027-11-14");
});

const SPAWN_SCRIPT = `
const D = require(${JSON.stringify(MODULE)});
const probe = new Date("2026-11-13T23:30:00Z");
const keys = [
  "2026-11-13T23:59:59.999Z", "2026-11-14T00:00:00.000Z",
  "2026-03-08T09:59:59Z", "2026-03-08T10:00:01Z",   // US spring-forward (02:00 PST = 10:00Z)
  "2026-11-01T08:59:59Z", "2026-11-01T09:00:01Z",   // US fall-back (02:00 PDT = 09:00Z)
].map((s) => D.dayKey(new Date(s)));
// Noon-UTC on each day across both DST changes and a year boundary.
const nums = [];
for (const k of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01",
                 "2026-11-02", "2026-12-31", "2027-01-01"])
  nums.push(D.dayNumber(new Date(k + "T12:00:00Z"), "2026-01-01"));
let stats = D.emptyStats();
for (const k of ["2026-03-07", "2026-03-08", "2026-03-09"])
  stats = D.recordResult(stats, D.dayNumber(new Date(k + "T23:30:00Z")), 1);
process.stdout.write(JSON.stringify({
  tzOffset: probe.getTimezoneOffset(),
  localDate: probe.getDate(),
  keys,
  nums,
  reset: D.msUntilReset(new Date("2026-11-13T23:00:00Z")),
  streak: stats.currentStreak,
}));
`;

for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
  test(`no local-time methods: identical results under TZ=${tz}`, () => {
    const r = spawnSync(process.execPath, ["-e", SPAWN_SCRIPT], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    // Prove the child really runs in that zone (23:30Z is the 13th in LA and
    // already the 14th in Kiritimati, UTC+14).
    const expected = { UTC: [0, 13], "America/Los_Angeles": [480, 13], "Pacific/Kiritimati": [-840, 14] }[tz];
    assert.deepEqual([out.tzOffset, out.localDate], expected);
    assert.deepEqual(out.keys, [
      "2026-11-13", "2026-11-14", "2026-03-08", "2026-03-08", "2026-11-01", "2026-11-01",
    ]);
    assert.deepEqual(out.nums, [66, 67, 68, 304, 305, 306, 365, 366]);
    assert.equal(out.reset, 3600000);
    assert.equal(out.streak, 3, "streak survives the DST change");
  });
}

test("dayNumber counts from the launch date (1-based, unclamped before launch)", () => {
  const L = "2026-12-01";
  assert.equal(D.dayNumber(new Date("2026-12-01T00:00:00Z"), L), 1);
  assert.equal(D.dayNumber(new Date("2026-12-01T23:59:59.999Z"), L), 1);
  assert.equal(D.dayNumber(new Date("2026-12-02T00:00:00Z"), L), 2);
  assert.equal(D.dayNumber(new Date("2027-12-01T12:00:00Z"), L), 366);
  assert.equal(D.dayNumber(new Date("2026-11-30T23:59:59Z"), L), 0);
  assert.equal(D.dayNumber(new Date("2026-11-29T12:00:00Z"), L), -1);
  // launch may be a Date or a timestamp anywhere within the launch day
  assert.equal(D.dayNumber(new Date("2026-12-05T01:00:00Z"), new Date("2026-12-01T22:00:00Z")), 5);
  assert.equal(D.dayNumber("2026-12-10", Date.UTC(2026, 11, 1, 5)), 10);
  // default launch is the LAUNCH_DATE placeholder
  assert.match(D.LAUNCH_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(D.dayNumber(new Date(D.LAUNCH_DATE + "T08:00:00Z")), 1);
  // inverse
  for (const n of [-3, 0, 1, 2, 31, 365, 1000])
    assert.equal(D.dayNumber(D.dayKeyForNumber(n, L), L), n);
  assert.equal(D.dayKeyForNumber(32, L), "2027-01-01");
});

test("msUntilReset counts down to the next 00:00 UTC", () => {
  assert.equal(D.msUntilReset(new Date("2026-11-13T23:59:59.999Z")), 1);
  assert.equal(D.msUntilReset(new Date("2026-11-13T23:00:00Z")), 3600000);
  assert.equal(D.msUntilReset(new Date("2026-11-13T12:00:00Z")), 12 * 3600000);
  // exactly midnight: a full day remains, never 0
  assert.equal(D.msUntilReset(new Date("2026-11-14T00:00:00.000Z")), D.DAY_MS);
  assert.equal(D.msUntilReset(new Date("2026-11-14T00:00:00.001Z")), D.DAY_MS - 1);
  // year boundary
  assert.equal(D.msUntilReset(new Date("2026-12-31T23:59:00Z")), 60000);
  const now = D.msUntilReset();
  assert.ok(now > 0 && now <= D.DAY_MS);
});

test("every date function accepts Date | ms | day key | nothing", () => {
  const key = "2026-11-14";
  const inputs = [key, new Date("2026-11-14T00:00:00Z"), Date.UTC(2026, 10, 14)];
  for (const d of inputs) {
    assert.equal(D.dayKey(d), key);
    assert.equal(D.msUntilReset(d), D.DAY_MS);
    assert.equal(D.dayNumber(d, "2026-11-01"), 14);
    assert.equal(D.dayNumber("2026-11-20", d), 7);
    assert.equal(D.dayKeyForNumber(2, d), "2026-11-15");
  }
  assert.equal(D.dayKey("2028-02-29"), "2028-02-29");
  for (const fn of [() => D.dayKey(), () => D.msUntilReset(), () => D.dayNumber()]) assert.doesNotThrow(fn);
  // any other string is still a RangeError, including ISO timestamps and numbers-as-strings
  for (const bad of ["2026-11-14T12:00:00Z", "2026-02-30", "14/11/2026", "1763078400000", "", "today"]) {
    assert.throws(() => D.dayKey(bad), RangeError, bad);
    assert.throws(() => D.msUntilReset(bad), RangeError, bad);
    assert.throws(() => D.dayNumber(bad, "2026-11-01"), RangeError, bad);
    assert.throws(() => D.dayNumber("2026-11-14", bad), RangeError, bad);
  }
  for (const bad of [NaN, Infinity, new Date("nope"), {}, true])
    assert.throws(() => D.dayKey(bad), RangeError, String(bad));
});

test("formatCountdown renders HH:MM:SS", () => {
  assert.equal(D.formatCountdown(D.DAY_MS), "24:00:00");
  assert.equal(D.formatCountdown(3600000 + 61000), "01:01:01");
  assert.equal(D.formatCountdown(1), "00:00:01"); // partial second rounds up
  assert.equal(D.formatCountdown(0), "00:00:00");
  assert.equal(D.formatCountdown(-5), "00:00:00");
});

/* ---------------------------------------------------------------- PRNG */

test("seedString builds reseed suffixes", () => {
  assert.equal(D.seedString("2026-11-14"), "2026-11-14");
  assert.equal(D.seedString("2026-11-14", 0), "2026-11-14");
  assert.equal(D.seedString("2026-11-14", 1), "2026-11-14#1");
  assert.equal(D.seedString("2026-11-14", 12), "2026-11-14#12");
});

function seq(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rng.float());
  return out;
}

test("PRNG: same seed gives the same sequence; #1 differs from the base", () => {
  const a = seq(D.createRng("2026-11-14"), 50);
  assert.deepEqual(seq(D.createRng("2026-11-14"), 50), a);
  assert.notDeepEqual(seq(D.createRng("2026-11-14#1"), 50), a);
  assert.notDeepEqual(seq(D.createRng("2026-11-14#1"), 50), seq(D.createRng("2026-11-14#2"), 50));
  assert.notDeepEqual(seq(D.createRng("2026-11-15"), 50), a);
  for (const x of a) assert.ok(x >= 0 && x < 1);
  assert.notEqual(D.hashString("2026-11-14"), D.hashString("2026-11-14#1"));
});

// GOLDEN VALUES. These literals ARE the published dailies: after launch they
// must never change (see the CONTRACT comment in daily.js). If this test
// fails, revert the change to the PRNG; do not update the numbers unless a
// versioned seed scheme is being introduced on purpose.
test("PRNG golden values: the seed stream is frozen", () => {
  assert.equal(D.hashString("2026-11-14"), 3531210512);
  assert.equal(D.hashString("2026-11-14#1"), 3108761153);
  assert.equal(D.hashString("2026-11-14#2"), 2000587118);
  assert.equal(D.hashString("daily-dungeon"), 1300006016);
  assert.equal(D.hashString(""), 167010153);

  let r = D.createRng("2026-11-14");
  assert.deepEqual(seq(r, 5), [
    0.1472262698225677, 0.2652731165289879, 0.006300171837210655, 0.8590412640478462,
    0.46450928947888315,
  ]);

  r = D.createRng("2026-11-14");
  assert.deepEqual([1, 2, 3, 4, 5].map(() => r.int(1, 6)), [1, 2, 1, 6, 3]);

  r = D.createRng("2026-11-14#1");
  const heroes = ["knight", "rogue", "mage", "cleric", "ranger", "berserker"];
  assert.deepEqual([1, 2, 3].map(() => r.pick(heroes)), ["knight", "knight", "mage"]);

  r = D.createRng("2026-11-14#2");
  assert.deepEqual(r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [8, 5, 4, 7, 9, 1, 2, 0, 6, 3]);

  r = D.createRng(42); // integer seeds skip the hash
  assert.deepEqual([r.float(), r.int(1, 6)], [0.6011037519201636, 3]);
});

test("PRNG helpers: int, pick, shuffle, chance, state", () => {
  const r = D.createRng("helpers");
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = r.int(-2, 3);
    assert.ok(Number.isInteger(v) && v >= -2 && v <= 3);
    seen.add(v);
  }
  assert.equal(seen.size, 6, "int covers both inclusive ends");
  assert.equal(r.int(7, 7), 7);
  assert.throws(() => r.int(3, 2), RangeError);

  const arr = ["a", "b", "c", "d", "e", "f"];
  const frozen = arr.slice();
  const picks = new Set();
  for (let i = 0; i < 500; i++) picks.add(r.pick(arr));
  assert.equal(picks.size, arr.length);
  assert.equal(r.pick([]), undefined);

  const sh = r.shuffle(arr);
  assert.deepEqual(arr, frozen, "shuffle does not mutate its input");
  assert.deepEqual(sh.slice().sort(), frozen);
  assert.deepEqual(D.createRng("s").shuffle(arr), D.createRng("s").shuffle(arr));

  assert.equal(r.chance(0), false);
  assert.equal(r.chance(1), true);

  // state snapshot / resume
  const s = r.state;
  const after = seq(r, 5);
  r.state = s;
  assert.deepEqual(seq(r, 5), after);
  // integer seeds are used as is
  assert.deepEqual(seq(D.createRng(42), 5), seq(D.createRng(42), 5));
});

test("PRNG is driven only by its own stream (Math.random is not used)", () => {
  const orig = Math.random;
  Math.random = () => {
    throw new Error("Math.random used");
  };
  try {
    const r = D.createRng("isolated");
    r.float();
    r.int(1, 6);
    r.pick([1, 2, 3]);
    r.shuffle([1, 2, 3, 4]);
    r.chance(0.5);
  } finally {
    Math.random = orig;
  }
});

/* --------------------------------------------------------------- stats */

test("stats: played, wins and star distribution", () => {
  let s = D.emptyStats();
  s = D.recordResult(s, 1, 3);
  s = D.recordResult(s, 2, 0);
  s = D.recordResult(s, 3, 1);
  s = D.recordResult(s, 4, 2);
  assert.equal(s.played, 4);
  assert.equal(s.wins, 3);
  assert.deepEqual(s.stars, [1, 1, 1, 1]);
});

test("streaks continue only on consecutive day numbers", () => {
  let s = D.emptyStats();
  s = D.recordResult(s, 10, 1);
  s = D.recordResult(s, 11, 2);
  s = D.recordResult(s, 12, 3);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.maxStreak, 3);
  // skipped day 13: the streak restarts
  s = D.recordResult(s, 14, 1);
  assert.equal(s.currentStreak, 1);
  assert.equal(s.maxStreak, 3);
  s = D.recordResult(s, 15, 1);
  assert.equal(s.currentStreak, 2);
  // a 0-star day breaks it too
  s = D.recordResult(s, 16, 0);
  assert.equal(s.currentStreak, 0);
  s = D.recordResult(s, 17, 2);
  assert.equal(s.currentStreak, 1);
  assert.equal(s.maxStreak, 3);
  assert.equal(s.played, 7);
  assert.equal(s.wins, 6);
});

test("streaks across month, year and DST boundaries (via day numbers)", () => {
  const L = "2026-01-01";
  const run = (keys) => {
    let s = D.emptyStats();
    for (const k of keys) s = D.recordResult(s, D.dayNumber(new Date(k + "T23:59:59Z"), L), 1);
    return s.currentStreak;
  };
  assert.equal(run(["2026-01-30", "2026-01-31", "2026-02-01"]), 3); // month
  assert.equal(run(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]), 4); // year
  assert.equal(run(["2026-03-07", "2026-03-08", "2026-03-09"]), 3); // US spring DST
  assert.equal(run(["2026-03-28", "2026-03-29", "2026-03-30"]), 3); // EU spring DST
  assert.equal(run(["2026-10-31", "2026-11-01", "2026-11-02"]), 3); // US fall DST
  assert.equal(run(["2027-02-27", "2027-02-28", "2027-03-01"]), 3); // non-leap Feb
  assert.equal(run(["2026-12-31", "2027-01-02"]), 1); // skip across the year
});

test("recordResult is idempotent per day and upgrades to the better result", () => {
  let s = D.recordResult(D.emptyStats(), 5, 2);
  const once = D.recordResult(s, 6, 1);
  const twice = D.recordResult(once, 6, 1);
  assert.deepEqual(twice, once, "same day + same stars is a no-op");
  assert.equal(twice.played, 2);
  assert.equal(twice.currentStreak, 2);

  // recording after each attempt: 0★ then 1★ then 3★ on the same day
  let t = D.recordResult(once, 7, 0);
  assert.equal(t.currentStreak, 0);
  assert.equal(t.wins, 2);
  t = D.recordResult(t, 7, 1);
  assert.equal(t.currentStreak, 3, "an upgrade from a loss restores the streak");
  assert.equal(t.wins, 3);
  t = D.recordResult(t, 7, 3);
  assert.equal(t.played, 3);
  assert.equal(t.wins, 3);
  assert.deepEqual(t.stars, [0, 1, 1, 1]);
  assert.equal(t.currentStreak, 3);
  assert.equal(t.maxStreak, 3);
  // a worse result for a recorded day changes nothing
  assert.deepEqual(D.recordResult(t, 7, 1), t);
  // an older day is ignored
  assert.deepEqual(D.recordResult(t, 3, 3), t);
  // the input object is never mutated
  const frozen = JSON.stringify(once);
  D.recordResult(once, 7, 3);
  assert.equal(JSON.stringify(once), frozen);
});

test("stats invariants hold over a random walk of recordResult calls", () => {
  const r = D.createRng("stats-invariants");
  let s = D.emptyStats();
  let day = 1;
  const kinds = { next: 0, skip: 0, same: 0, stale: 0 };
  const check = (step, what) => {
    const sum = s.stars.reduce((a, b) => a + b, 0);
    const where = `step ${step} (${what}): ${JSON.stringify(s)}`;
    assert.equal(s.played, sum, "played === sum(stars) at " + where);
    assert.equal(s.wins, s.played - s.stars[0], "wins === played - stars[0] at " + where);
    assert.ok(s.maxStreak >= s.currentStreak, "maxStreak >= currentStreak at " + where);
    assert.ok(s.currentStreak <= s.played, "currentStreak <= played at " + where);
    assert.ok(s.stars.every((n) => Number.isInteger(n) && n >= 0), "non-negative buckets at " + where);
  };
  for (let step = 0; step < 500; step++) {
    const roll = r.float();
    let what;
    if (roll < 0.4) {
      what = "next"; // consecutive day
      day += 1;
    } else if (roll < 0.55) {
      what = "skip"; // skip 1-3 days
      day += r.int(2, 4);
    } else if (roll < 0.9) {
      what = "same"; // same-day re-record: upgrade, repeat or downgrade
    } else {
      what = "stale"; // a day before the last recorded one
    }
    kinds[what]++;
    const target = what === "stale" ? day - r.int(1, 5) : day;
    const before = s;
    s = D.recordResult(s, target, r.int(0, 3));
    if (what === "stale") assert.deepEqual(s, D.normalizeStats(before), "stale day ignored");
    check(step, what);
    // round-trip through JSON (what storage does) must not change anything
    assert.deepEqual(D.normalizeStats(JSON.parse(JSON.stringify(s))), s);
  }
  for (const k of Object.keys(kinds)) assert.ok(kinds[k] > 20, `walk exercised "${k}"`);
});

test("liveStreak goes to 0 once a day has been skipped", () => {
  const s = D.recordResult(D.recordResult(D.emptyStats(), 1, 1), 2, 1);
  assert.equal(D.liveStreak(s, 2), 2); // played today
  assert.equal(D.liveStreak(s, 3), 2); // today not yet played
  assert.equal(D.liveStreak(s, 4), 0); // missed day 3
  assert.equal(D.liveStreak(D.emptyStats(), 1), 0);
});

test("normalizeStats repairs corrupt shapes", () => {
  assert.deepEqual(D.normalizeStats(null), D.emptyStats());
  assert.deepEqual(D.normalizeStats("garbage"), D.emptyStats());
  const s = D.normalizeStats({ played: "x", wins: -3, stars: [1, "2", null], currentStreak: 4, maxStreak: 2 });
  assert.equal(s.played, 0);
  assert.equal(s.wins, 0);
  assert.deepEqual(s.stars, [1, 2, 0, 0]);
  assert.equal(s.maxStreak, 4);
  assert.equal(s.lastDay, null);
});

/* ------------------------------------------------------------- storage */

function memStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("store round-trips day state and stats under prefixed keys", () => {
  const ls = memStorage();
  const st = D.createStore("daily-dungeon", ls);
  assert.equal(st.dayStorageKey("2026-11-14"), "daily-dungeon-day-2026-11-14");
  assert.equal(st.statsStorageKey, "daily-dungeon-stats");
  assert.equal(st.loadDay("2026-11-14"), null);
  assert.equal(st.saveDay("2026-11-14", { attempts: [1, 2] }), true);
  assert.deepEqual(JSON.parse(ls.m.get("daily-dungeon-day-2026-11-14")), { attempts: [1, 2] });
  assert.deepEqual(st.loadDay("2026-11-14"), { attempts: [1, 2] });
  assert.throws(() => st.dayStorageKey("14/11/2026"), RangeError);

  assert.deepEqual(st.loadStats(), D.emptyStats());
  st.recordResult(1, 2);
  st.recordResult(1, 2); // idempotent through the store too
  const s = st.recordResult(2, 3);
  assert.equal(s.played, 2);
  assert.deepEqual(D.createStore("daily-dungeon", ls).loadStats(), s, "persisted");
  // another prefix does not collide
  assert.deepEqual(D.createStore("party-line", ls).loadStats(), D.emptyStats());
});

test("store never throws when localStorage is missing (memory fallback)", () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    // Node 26 may expose a localStorage global; remove it for this test.
    if (had) delete globalThis.localStorage;
    assert.equal(globalThis.localStorage, undefined);
    const st = D.createStore("dd");
    assert.equal(st.loadDay("2026-11-14"), null);
    assert.deepEqual(st.loadStats(), D.emptyStats());
    assert.equal(st.saveDay("2026-11-14", { a: 1 }), false, "reports it did not persist");
    assert.deepEqual(st.loadDay("2026-11-14"), { a: 1 }, "but the session still sees it");
    assert.equal(st.recordResult(1, 1).played, 1);
    assert.equal(st.loadStats().played, 1);
    // explicit null storage = memory only
    const nul = D.createStore("dd", null);
    assert.equal(nul.saveStats(D.emptyStats()), false);
    assert.equal(nul.recordResult(4, 2).wins, 1);
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", had);
  }
});

test("store survives a localStorage getter that throws (SecurityError)", () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: access denied");
    },
  });
  try {
    const st = D.createStore("dd");
    assert.equal(st.loadDay("2026-11-14"), null);
    assert.equal(st.saveDay("2026-11-14", { a: 1 }), false);
    assert.deepEqual(st.loadDay("2026-11-14"), { a: 1 });
    assert.equal(st.recordResult(1, 3).stars[3], 1);
  } finally {
    delete globalThis.localStorage;
    if (had) Object.defineProperty(globalThis, "localStorage", had);
  }
});

test("store survives getItem/setItem throwing and corrupt JSON", () => {
  const throwing = {
    getItem() {
      throw new Error("boom");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  const st = D.createStore("dd", throwing);
  assert.equal(st.loadDay("2026-11-14"), null);
  assert.deepEqual(st.loadStats(), D.emptyStats());
  assert.equal(st.saveDay("2026-11-14", { x: 1 }), false);
  assert.deepEqual(st.loadDay("2026-11-14"), { x: 1 });

  // quota only: reads work, writes fail, memory holds the newer value
  const ls = memStorage();
  ls.m.set("dd-day-2026-11-14", JSON.stringify({ old: true }));
  ls.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const q = D.createStore("dd", ls);
  assert.deepEqual(q.loadDay("2026-11-14"), { old: true });
  assert.equal(q.saveDay("2026-11-14", { fresh: true }), false);
  assert.deepEqual(q.loadDay("2026-11-14"), { fresh: true });

  const bad = memStorage();
  bad.m.set("dd-day-2026-11-14", "{not json");
  bad.m.set("dd-stats", "[[[");
  const c = D.createStore("dd", bad);
  assert.equal(c.loadDay("2026-11-14"), null);
  assert.deepEqual(c.loadStats(), D.emptyStats());
  bad.m.set("dd-stats", JSON.stringify({ played: 3, wins: 2, stars: [1, 1, 1], lastDay: 9, lastStars: 2 }));
  assert.equal(c.recordResult(10, 1).currentStreak, 1);

  // unserialisable state does not throw either
  const cyc = {};
  cyc.self = cyc;
  assert.equal(D.createStore("dd", memStorage()).saveDay("2026-11-14", cyc), false);
  assert.throws(() => D.createStore(""), TypeError);
});

/* ----------------------------------------------------------- clipboard */

test("copyText prefers navigator.clipboard", async () => {
  let got = null;
  const ok = await D.copyText("grid", {
    navigator: { clipboard: { writeText: async (t) => { got = t; } } },
    document: null,
  });
  assert.equal(ok, true);
  assert.equal(got, "grid");
});

function fakeDocument(execResult) {
  const log = { appended: 0, removed: 0, copied: null };
  const body = {
    appendChild(el) {
      log.appended++;
      el.parentNode = { removeChild: () => { log.removed++; el.parentNode = null; } };
    },
  };
  const doc = {
    body,
    activeElement: null,
    createElement: () => ({
      style: {},
      setAttribute() {},
      focus() {},
      select() { log.copied = this.value; },
      setSelectionRange() {},
    }),
    execCommand: (cmd) => {
      if (execResult instanceof Error) throw execResult;
      return cmd === "copy" && execResult;
    },
  };
  return { doc, log };
}

test("copyText falls back to a hidden textarea + execCommand", async () => {
  const { doc, log } = fakeDocument(true);
  assert.equal(await D.copyText("no clipboard api", { navigator: {}, document: doc }), true);
  assert.equal(log.copied, "no clipboard api");
  assert.equal(log.appended, 1);
  assert.equal(log.removed, 1, "textarea is cleaned up");

  // clipboard API rejects (permissions, insecure context) -> fallback
  const f2 = fakeDocument(true);
  const rejecting = { clipboard: { writeText: () => Promise.reject(new Error("denied")) } };
  assert.equal(await D.copyText("x", { navigator: rejecting, document: f2.doc }), true);
  assert.equal(f2.log.copied, "x");

  // both fail -> resolves false, never rejects
  const f3 = fakeDocument(new Error("execCommand gone"));
  assert.equal(await D.copyText("x", { navigator: rejecting, document: f3.doc }), false);
  assert.equal(f3.log.removed, 1);
  assert.equal(await D.copyText("x", { navigator: null, document: null }), false);
  // under plain Node (no document) it still resolves
  assert.equal(typeof (await D.copyText("x")), "boolean");
});

test("module load touches no DOM or storage globals", () => {
  const script = `
    for (const k of ["window", "document", "navigator", "localStorage"]) {
      Object.defineProperty(globalThis, k, { configurable: true, get() { throw new Error("touched " + k); } });
    }
    const D = require(${JSON.stringify(MODULE)});
    process.stdout.write(typeof D.dayKey);
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "function");
});

test("browser global is DailyPlumbing when there is no module system", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const ctx = { self: {} };
  ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(MODULE, "utf8"), ctx);
  assert.equal(typeof ctx.DailyPlumbing.createRng, "function");
  assert.equal(ctx.DailyPlumbing.dayKey(Date.UTC(2026, 10, 14)), "2026-11-14");
});
