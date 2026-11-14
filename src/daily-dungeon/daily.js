/*
 * Daily plumbing — game-agnostic helpers for a once-a-day puzzle.
 *
 * Knows nothing about rooms, heroes or stars beyond "an integer score where
 * 1+ counts as a win", so another daily (Party Line, PRD §19) can reuse it.
 * It runs unchanged in the browser (window.DailyPlumbing) and under Node
 * (module.exports), which is what test/daily-dungeon-daily.test.js drives.
 * Nothing touches the DOM, localStorage or navigator at load time: every
 * environment access happens inside a function call, wrapped in try/catch.
 *
 *   Days        dayKey, parseDayKey, shiftDayKey, dayNumber, dayKeyForNumber,
 *               msUntilReset, formatCountdown, LAUNCH_DATE
 *   Seeds       seedString, hashString, mulberry32, createRng
 *   Storage     createStore(prefix, storage?)
 *   Stats       emptyStats, normalizeStats, recordResult, liveStreak
 *   Clipboard   copyText
 *
 * Decisions where the PRD was silent (documented again at each function):
 *  - A "day" is always the UTC calendar date (PRD §5.1). No local-time Date
 *    method is used anywhere in this file.
 *  - dayNumber is NOT clamped: the launch day is 1, the day before is 0, the
 *    one before that -1, and so on. Callers treat < 1 as "pre-launch". Keeping
 *    it unclamped keeps "consecutive days differ by exactly 1" true everywhere,
 *    which the streak rules rely on.
 *  - msUntilReset at exactly 00:00:00.000 UTC returns a full day (86400000),
 *    never 0: the new day has just begun.
 *  - A streak is consecutive day numbers with a win (1+ stars), Wordle-style.
 *    A 0-star day or a skipped day ends it.
 *  - recordResult is idempotent per day: stats remember the last recorded day
 *    (lastDay), its stars (lastStars) and the streak before it (streakBefore).
 *    Recording the same day again replaces that day's contribution with the
 *    better of the two results, so it can be called after every attempt and
 *    never double-counts. A day older than lastDay is ignored (there is no
 *    per-day history to insert it into).
 *  - When storage is unusable, saves land in an in-memory fallback so the
 *    current session keeps working; nothing throws.
 *  - copyText resolves to true/false and never rejects.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DailyPlumbing = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY_MS = 86400000;

  // Placeholder: the real launch date is set in FAN-34. It sits in the past
  // so development builds show positive day numbers.
  var LAUNCH_DATE = "2026-11-01";

  /* ------------------------------------------------------------------ */
  /* Days (always UTC)                                                   */
  /* ------------------------------------------------------------------ */

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  // Accepts a Date, a millisecond timestamp, or nothing (now). Returns ms.
  function toMs(date) {
    if (date === undefined || date === null) return Date.now();
    var ms = date instanceof Date ? date.getTime() : Number(date);
    if (!isFinite(ms)) throw new RangeError("Invalid date: " + date);
    return ms;
  }

  var KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // "YYYY-MM-DD" -> ms of that date's 00:00 UTC. Throws on a malformed or
  // impossible date ("2026-02-30").
  function parseDayKey(key) {
    var m = KEY_RE.exec(String(key));
    if (!m) throw new RangeError("Invalid day key: " + key);
    var y = +m[1], mo = +m[2], d = +m[3];
    var ms = Date.UTC(y, mo - 1, d);
    var back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
      throw new RangeError("Invalid day key: " + key);
    return ms;
  }

  // ms of 00:00 UTC on the day containing `date`. A "YYYY-MM-DD" string is
  // read as a day key.
  function utcMidnight(date) {
    if (typeof date === "string") return parseDayKey(date);
    var ms = toMs(date);
    return ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
  }

  /** dayKey(date = now) -> "YYYY-MM-DD" of the UTC date. */
  function dayKey(date) {
    var d = new Date(toMs(date));
    return pad(d.getUTCFullYear(), 4) + "-" + pad(d.getUTCMonth() + 1, 2) + "-" + pad(d.getUTCDate(), 2);
  }

  /** shiftDayKey("2026-12-31", 1) -> "2027-01-01". */
  function shiftDayKey(key, days) {
    return dayKey(parseDayKey(key) + Math.round(days) * DAY_MS);
  }

  /**
   * dayNumber(date = now, launchDate = LAUNCH_DATE) -> integer.
   * The launch date's UTC day is 1. Not clamped: earlier days give 0, -1, …
   * `launchDate` may be a "YYYY-MM-DD" string, a Date or a timestamp.
   */
  function dayNumber(date, launchDate) {
    var launch = utcMidnight(launchDate === undefined ? LAUNCH_DATE : launchDate);
    return Math.round((utcMidnight(date) - launch) / DAY_MS) + 1;
  }

  /** Inverse of dayNumber: dayKeyForNumber(1) -> the launch date's key. */
  function dayKeyForNumber(n, launchDate) {
    var launch = utcMidnight(launchDate === undefined ? LAUNCH_DATE : launchDate);
    return dayKey(launch + (Math.round(n) - 1) * DAY_MS);
  }

  /**
   * msUntilReset(date = now) -> ms until the next 00:00 UTC, in (0, 86400000].
   * Exactly at midnight it returns a full day, never 0.
   */
  function msUntilReset(date) {
    var ms = toMs(date);
    return utcMidnight(ms) + DAY_MS - ms;
  }

  /** formatCountdown(ms) -> "HH:MM:SS", rounding partial seconds up. */
  function formatCountdown(ms) {
    var s = Math.max(0, Math.ceil(Number(ms) / 1000) || 0);
    return pad(Math.floor(s / 3600), 2) + ":" + pad(Math.floor(s / 60) % 60, 2) + ":" + pad(s % 60, 2);
  }

  /* ------------------------------------------------------------------ */
  /* Seeded PRNG                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * seedString("2026-11-14") -> "2026-11-14"; seedString("2026-11-14", 2) ->
   * "2026-11-14#2" (PRD §12 reseeds). Reseed 0 is the base seed.
   */
  function seedString(key, reseed) {
    return reseed ? key + "#" + reseed : String(key);
  }

  // xmur3-style 32-bit string hash (with a final avalanche), so similar
  // strings ("…#1", "…#2") give unrelated seeds.
  function hashString(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** mulberry32(seed32) -> function returning floats in [0, 1). */
  function mulberry32(a) {
    a = a >>> 0;
    var next = function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.getState = function () { return a >>> 0; };
    next.setState = function (s) { a = s >>> 0; };
    return next;
  }

  /**
   * createRng(seed) -> generator driven only by its own seeded stream.
   * `seed` is a string (hashed) or a 32-bit integer (used as is).
   *   float()          in [0, 1)
   *   int(min, max)    integer in [min, max], both inclusive
   *   chance(p)        true with probability p
   *   pick(arr)        one element (undefined for an empty array)
   *   shuffle(arr)     a new, Fisher–Yates-shuffled copy (input untouched)
   *   state            get/set the 32-bit state, to snapshot and resume
   */
  function createRng(seed) {
    var next = mulberry32(typeof seed === "number" ? seed : hashString(seed));
    var rng = {
      seed: seed,
      float: next,
      next: next,
      int: function (min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        if (max < min) throw new RangeError("int(min, max): max < min");
        return min + Math.floor(next() * (max - min + 1));
      },
      chance: function (p) {
        return next() < p;
      },
      pick: function (arr) {
        return arr.length ? arr[Math.floor(next() * arr.length)] : undefined;
      },
      shuffle: function (arr) {
        var out = Array.prototype.slice.call(arr);
        for (var i = out.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = out[i];
          out[i] = out[j];
          out[j] = tmp;
        }
        return out;
      },
    };
    Object.defineProperty(rng, "state", {
      get: function () { return next.getState(); },
      set: function (s) { next.setState(s); },
      enumerable: true,
    });
    return rng;
  }

  /* ------------------------------------------------------------------ */
  /* Lifetime stats (pure)                                               */
  /* ------------------------------------------------------------------ */

  var MAX_STARS = 10; // sanity cap for the distribution array

  /**
   * emptyStats() -> { played, wins, stars: [n0, n1, n2, n3], currentStreak,
   * maxStreak, lastDay, lastStars, streakBefore }. `stars[i]` counts days whose
   * best result was i stars. lastDay/lastStars/streakBefore are bookkeeping
   * for idempotent re-recording (null before the first record).
   */
  function emptyStats() {
    return {
      played: 0,
      wins: 0,
      stars: [0, 0, 0, 0],
      currentStreak: 0,
      maxStreak: 0,
      lastDay: null,
      lastStars: null,
      streakBefore: 0,
    };
  }

  function count(v) {
    v = Number(v);
    return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  function intOrNull(v) {
    return typeof v === "number" && isFinite(v) ? Math.round(v) : null;
  }

  /** Repairs anything (corrupt storage, an old shape) into valid stats. */
  function normalizeStats(raw) {
    var s = emptyStats();
    if (!raw || typeof raw !== "object") return s;
    s.played = count(raw.played);
    s.wins = count(raw.wins);
    if (Array.isArray(raw.stars)) {
      for (var i = 0; i < raw.stars.length && i <= MAX_STARS; i++) s.stars[i] = count(raw.stars[i]);
    }
    s.currentStreak = count(raw.currentStreak);
    s.maxStreak = Math.max(count(raw.maxStreak), s.currentStreak);
    s.lastDay = intOrNull(raw.lastDay);
    s.lastStars = s.lastDay === null ? null : intOrNull(raw.lastStars);
    s.streakBefore = count(raw.streakBefore);
    return s;
  }

  /**
   * recordResult(stats, dayNum, stars) -> new stats (input untouched).
   *  - A new day (dayNum > lastDay): played += 1, the star bucket += 1, a win
   *    (stars >= 1) adds 1 to wins and extends the streak only if
   *    dayNum === lastDay + 1 (otherwise it restarts at 1); a 0-star day sets
   *    the current streak to 0.
   *  - The same day again: replaces that day's contribution with the better of
   *    the old and new star counts. Nothing is double-counted.
   *  - An older day (dayNum < lastDay): ignored, stats returned unchanged.
   */
  function recordResult(stats, dayNum, stars) {
    var s = normalizeStats(stats);
    dayNum = Math.round(Number(dayNum));
    if (!isFinite(dayNum)) throw new RangeError("recordResult: bad day number");
    stars = Math.min(MAX_STARS, count(stars));
    while (s.stars.length <= stars) s.stars.push(0);

    if (s.lastDay !== null && dayNum < s.lastDay) return s;

    if (s.lastDay !== null && dayNum === s.lastDay) {
      var old = s.lastStars === null ? 0 : s.lastStars;
      if (stars <= old) return s;
      while (s.stars.length <= old) s.stars.push(0);
      s.stars[old] = Math.max(0, s.stars[old] - 1);
      s.stars[stars] += 1;
      if (old < 1) s.wins += 1; // stars > old >= 0, so this is now a win
      s.lastStars = stars;
      s.currentStreak = s.streakBefore + 1;
      s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
      return s;
    }

    var base = s.lastDay !== null && dayNum === s.lastDay + 1 ? s.currentStreak : 0;
    s.played += 1;
    s.stars[stars] += 1;
    s.streakBefore = base;
    if (stars >= 1) {
      s.wins += 1;
      s.currentStreak = base + 1;
    } else {
      s.currentStreak = 0;
    }
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    s.lastDay = dayNum;
    s.lastStars = stars;
    return s;
  }

  /**
   * liveStreak(stats, todayNum) -> the streak to display today. The stored
   * currentStreak only changes when a result is recorded, so if the player
   * skipped yesterday it is stale; this returns 0 in that case. (Today not yet
   * played but yesterday won still shows the running streak.)
   */
  function liveStreak(stats, todayNum) {
    var s = normalizeStats(stats);
    if (s.lastDay === null) return 0;
    return todayNum - s.lastDay <= 1 ? s.currentStreak : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  // The ambient localStorage, or null. Merely reading window.localStorage
  // throws (SecurityError) in some sandboxed or cookie-blocked contexts.
  function ambientStorage() {
    try {
      var g = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : null;
      var ls = g && g.localStorage;
      return ls && typeof ls.getItem === "function" ? ls : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * createStore(prefix, storage?) -> {
   *   dayStorageKey(key), statsStorageKey,
   *   loadDay(key) -> state | null,   saveDay(key, state) -> bool,
   *   loadStats() -> stats,           saveStats(stats) -> bool,
   *   recordResult(dayNum, stars) -> stats (loads, records, saves),
   * }
   * Keys: `<prefix>-day-YYYY-MM-DD` and `<prefix>-stats`. `storage` defaults
   * to the ambient localStorage, looked up on every call (never at load). Any
   * failure — no storage, a throwing getter, setItem refusing (quota, private
   * mode), corrupt JSON — is swallowed: loads return null / empty stats, saves
   * return false and keep the value in memory so this session still sees it.
   * Pass `null` as `storage` to force memory-only.
   */
  function createStore(prefix, storage) {
    if (!prefix) throw new TypeError("createStore: prefix required");
    var memory = {}; // storage key -> JSON, for writes storage refused
    var explicit = arguments.length >= 2;

    function backend() {
      if (!explicit) return ambientStorage();
      return storage && typeof storage.getItem === "function" ? storage : null;
    }

    function read(k) {
      if (Object.prototype.hasOwnProperty.call(memory, k)) return parse(memory[k]);
      var ls = backend();
      if (!ls) return null;
      try {
        return parse(ls.getItem(k));
      } catch (e) {
        return null;
      }
    }

    function parse(json) {
      if (json === null || json === undefined) return null;
      try {
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function write(k, value) {
      var json;
      try {
        json = JSON.stringify(value);
      } catch (e) {
        return false;
      }
      if (json === undefined) return false;
      var ls = backend();
      if (ls) {
        try {
          ls.setItem(k, json);
          delete memory[k];
          return true;
        } catch (e) {
          /* fall through to memory */
        }
      }
      memory[k] = json;
      return false;
    }

    var statsKey = prefix + "-stats";
    function dayStorageKey(key) {
      parseDayKey(key); // validate
      return prefix + "-day-" + key;
    }

    var store = {
      prefix: prefix,
      statsStorageKey: statsKey,
      dayStorageKey: dayStorageKey,
      loadDay: function (key) {
        return read(dayStorageKey(key));
      },
      saveDay: function (key, state) {
        return write(dayStorageKey(key), state);
      },
      loadStats: function () {
        return normalizeStats(read(statsKey));
      },
      saveStats: function (stats) {
        return write(statsKey, normalizeStats(stats));
      },
      recordResult: function (dayNum, stars) {
        var next = recordResult(store.loadStats(), dayNum, stars);
        store.saveStats(next);
        return next;
      },
    };
    return store;
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard                                                           */
  /* ------------------------------------------------------------------ */

  function execCommandCopy(text, doc) {
    if (!doc || !doc.body || typeof doc.createElement !== "function") return false;
    var ta, prevFocus;
    try {
      prevFocus = doc.activeElement;
      ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      ta.style.fontSize = "16px"; // stops iOS zooming in on focus
      doc.body.appendChild(ta);
      ta.focus();
      ta.select();
      if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, text.length); // iOS
      return !!doc.execCommand("copy");
    } catch (e) {
      return false;
    } finally {
      try {
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
        if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /**
   * copyText(text, env?) -> Promise<boolean>. Tries navigator.clipboard
   * .writeText, then falls back to a hidden textarea + execCommand("copy").
   * Resolves true on success, false if both fail; never rejects. `env`
   * ({navigator, document}) overrides the globals, for tests.
   */
  function copyText(text, env) {
    text = String(text);
    var nav, doc;
    try {
      nav = env && "navigator" in env ? env.navigator : typeof navigator !== "undefined" ? navigator : null;
      doc = env && "document" in env ? env.document : typeof document !== "undefined" ? document : null;
    } catch (e) {
      /* leave unset */
    }
    var fallback = function () {
      return execCommandCopy(text, doc);
    };
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
        return Promise.resolve(nav.clipboard.writeText(text)).then(
          function () { return true; },
          fallback
        );
      }
    } catch (e) {
      /* writeText threw synchronously: use the fallback */
    }
    return Promise.resolve(fallback());
  }

  return {
    LAUNCH_DATE: LAUNCH_DATE,
    DAY_MS: DAY_MS,
    dayKey: dayKey,
    parseDayKey: parseDayKey,
    shiftDayKey: shiftDayKey,
    dayNumber: dayNumber,
    dayKeyForNumber: dayKeyForNumber,
    msUntilReset: msUntilReset,
    formatCountdown: formatCountdown,
    seedString: seedString,
    hashString: hashString,
    mulberry32: mulberry32,
    createRng: createRng,
    emptyStats: emptyStats,
    normalizeStats: normalizeStats,
    recordResult: recordResult,
    liveStreak: liveStreak,
    createStore: createStore,
    copyText: copyText,
  };
});
