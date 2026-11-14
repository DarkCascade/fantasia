/*
 * Daily Dungeon — simulation core (content tables, tuning, run engine).
 *
 * Pure data, small lookup helpers and the run engine (runDungeon), no
 * rendering. It runs unchanged in the browser (window.DailyDungeonSim) and
 * under Node (module.exports), which is what test/daily-dungeon-sim.test.js
 * and test/daily-dungeon-run.test.js drive. Spec: PRD-daily-dungeon.md
 * §6.1 (room types), §6.2 (Rumors), §7 (the line), §8 (heroes), §9 (timing).
 *
 * Two rules keep the balance harness honest:
 *
 *  1. Every number the PRD calls tunable lives in TUNE and ONLY in TUNE. The
 *     room and hero tables hold no damage, times or ability amounts; code
 *     reads them through roomStats()/makeRoom() and fillText(), which take a
 *     tune argument, so a withTune() override really changes behaviour (and
 *     the on-screen text that quotes it).
 *  2. TUNE is deep-frozen. Overrides go through withTune(overrides), which
 *     returns a new deep-merged, frozen copy and never touches the default.
 *
 * Player-facing text (room names, Rumor text, ability descriptions) lives in
 * these tables, not in UI code. Text that quotes a tunable number uses a
 * {placeholder} that fillText() resolves against a tune object.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DailyDungeonSim = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) {
        deepFreeze(o[k]);
      });
    }
    return o;
  }

  function deepClone(o) {
    if (Array.isArray(o)) return o.map(deepClone);
    if (isPlainObject(o)) {
      var out = {};
      Object.keys(o).forEach(function (k) {
        out[k] = deepClone(o[k]);
      });
      return out;
    }
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Tuning (PRD §16 "Tuning values (M1)")                               */
  /* ------------------------------------------------------------------ */

  // Placeholder numbers; M1 (the balance pass) tunes them. Times are seconds.
  var TUNE = deepFreeze({
    // Per room type: damage dealt and base time. Combat rooms (swarm, magic,
    // elite, boss) take longer than traps (PRD §9); so does the ambush.
    rooms: {
      trap: { damage: 2, time: 10 },
      swarm: { damage: 3, time: 30 },
      magic: { damage: 3, time: 25 },
      elite: { damage: 4, time: 30 },
      ambush: { damage: 2, time: 15 },
      boss: { damage: 5, time: 40 },
    },
    mageTimeSave: 20, // Mage clear: −20 s (PRD §6.1, §8)
    mageMode: "cancel", // "cancel" | "halve": what a Mage clear does to damage (spike D1, §16)
    berserkerTimeSave: 15, // Berserker at full HP entering the boss room (PRD §8)
    rangerTimeSave: 5, // Ranger in Slot 4 at the start of any room (PRD §7.5 step 4, §8)
    knightReduction: 2, // Knight in Slot 1, combat room not cleared by the Mage (PRD §6.1)
    clericHeal: 1, // Cleric heals the hero directly in front after each room (PRD §7.4)
    minRoomTime: 5, // floor on a room's time after savings (PRD §7.5 step 4)
    parSlack: 3, // Gold Par = best zero-KO time + slack (PRD §12.5); > 0 so the best run is "under" par
    rumorMin: 0.25, // PRD §12.4: share of a decoy's 3★ lineups that must fail on the real dungeon
    maxReseeds: 50, // getDaily gives up (throws) after date#1 … date#maxReseeds (FAN-14)
  });

  var MAGE_MODES = ["cancel", "halve"];

  // Deep-merge `overrides` onto `base` (default TUNE) and return a frozen
  // copy. Plain objects merge key by key; anything else replaces. Unknown keys
  // throw, so a typo in a harness sweep fails loudly instead of being ignored.
  function withTune(overrides, base) {
    base = base || TUNE;
    var out = deepClone(base);
    if (overrides != null) {
      if (!isPlainObject(overrides)) throw new TypeError("withTune: overrides must be a plain object");
      mergeInto(out, overrides, "");
    }
    validateTune(out);
    return deepFreeze(out);
  }

  function mergeInto(target, src, path) {
    Object.keys(src).forEach(function (k) {
      var p = path ? path + "." + k : k;
      if (!Object.prototype.hasOwnProperty.call(target, k)) throw new Error("withTune: unknown tune key '" + p + "'");
      if (isPlainObject(target[k])) {
        if (!isPlainObject(src[k])) throw new TypeError("withTune: '" + p + "' must be an object");
        mergeInto(target[k], src[k], p);
      } else {
        if (typeof src[k] !== typeof target[k])
          throw new TypeError("withTune: '" + p + "' must be a " + typeof target[k] + ", got " + typeof src[k]);
        target[k] = deepClone(src[k]);
      }
    });
  }

  function validateTune(t) {
    if (MAGE_MODES.indexOf(t.mageMode) < 0)
      throw new Error("withTune: mageMode must be one of " + MAGE_MODES.join(", ") + ", got '" + t.mageMode + "'");
    // Every number is finite and non-negative (times may be fractional).
    (function walk(o, path) {
      Object.keys(o).forEach(function (k) {
        var v = o[k],
          p = path ? path + "." + k : k;
        if (isPlainObject(v)) walk(v, p);
        else if (k !== "mageMode" && (typeof v !== "number" || !isFinite(v) || v < 0))
          throw new Error("withTune: '" + p + "' must be a non-negative number, got " + v);
      });
    })(t, "");
    // HP is an integer, so anything that changes HP must be too: fractional
    // damage would make knockouts depend on float rounding.
    var ints = ["knightReduction", "clericHeal", "maxReseeds"].map(function (k) {
      return [k, t[k]];
    });
    Object.keys(t.rooms).forEach(function (r) {
      ints.push(["rooms." + r + ".damage", t.rooms[r].damage]);
    });
    ints.forEach(function (e) {
      if (!Number.isInteger(e[1])) throw new Error("withTune: '" + e[0] + "' must be an integer, got " + e[1]);
    });
    // "Under par" is strict, so with no slack even the best run misses 3★.
    if (!(t.parSlack > 0)) throw new Error("withTune: 'parSlack' must be > 0, got " + t.parSlack);
    if (t.rumorMin > 1) throw new Error("withTune: 'rumorMin' is a share and must be in [0, 1], got " + t.rumorMin);
    if (t.maxReseeds < 1) throw new Error("withTune: 'maxReseeds' must be >= 1, got " + t.maxReseeds);
  }

  /* ------------------------------------------------------------------ */
  /* Room types (PRD §6.1, §7.2)                                         */
  /* ------------------------------------------------------------------ */

  // Emoji rule: every room and hero emoji must be from Unicode 9 or older, or it
  // renders as tofu on older Android and Windows 10 (this is a phone-first game).

  // Damage targets (PRD §7.2):
  //   slot1 — the hero in Slot 1 on entry; damage beyond its HP is lost.
  //   front — the front of the line; overflow carries to the next hero.
  //   slot4 — the back-most hero in the line; damage beyond its HP is lost.
  var TARGETS = deepFreeze(["slot1", "front", "slot4"]);

  // `combat`: Knight's reduction applies (if the Mage hasn't cleared it).
  // `clearable`: the Mage's room clear applies. `counteredBy`: hero ids in the
  // order of PRD §6.1's "Countered by" column (FAN-14's "each counter in room
  // order" baseline reads the first). `variants`: display names; a variant id
  // is unique across all types so a Rumor option can name one exactly. Damage
  // and time come from TUNE.rooms[id], never from here.
  var ROOM_TYPES = deepFreeze({
    trap: {
      id: "trap",
      name: "Trap",
      emoji: "⚠️",
      target: "slot1",
      combat: false,
      clearable: false,
      counteredBy: ["rogue"],
      counterText: "Rogue in Slot 1 or 2 disarms it: no damage.",
      variants: [
        { id: "spike-trap", name: "Spike Trap" },
        { id: "rune-trap", name: "Rune Trap" },
        { id: "pit-trap", name: "Pit Trap" },
      ],
    },
    swarm: {
      id: "swarm",
      name: "Swarm",
      emoji: "🕷️",
      target: "front",
      combat: true,
      clearable: true,
      counteredBy: ["mage"],
      counterText: "Mage, any slot, clears it: no damage, −{mageTimeSave} s.",
      variants: [
        { id: "skeleton-horde", name: "Skeleton Horde" },
        { id: "rat-swarm", name: "Rat Swarm" },
        { id: "spider-nest", name: "Spider Nest" },
      ],
    },
    magic: {
      id: "magic",
      name: "Magic",
      emoji: "⚡",
      target: "front",
      combat: true,
      clearable: true,
      counteredBy: ["mage"],
      counterText: "Mage, any slot, clears it: no damage, −{mageTimeSave} s.",
      variants: [
        { id: "arcane-storm", name: "Arcane Storm" },
        { id: "haunted-library", name: "Haunted Library" },
        { id: "wisp-circle", name: "Wisp Circle" },
      ],
    },
    elite: {
      id: "elite",
      name: "Elite combat",
      emoji: "👹",
      target: "front",
      combat: true,
      clearable: false,
      counteredBy: ["knight"],
      counterText: "Knight in Slot 1: damage −{knightReduction}.",
      variants: [
        { id: "ogre-brute", name: "Ogre Brute" },
        { id: "minotaur", name: "Minotaur" },
        { id: "bone-golem", name: "Bone Golem" },
      ],
    },
    ambush: {
      id: "ambush",
      name: "Ambush",
      emoji: "👁️",
      target: "slot4",
      combat: false,
      clearable: false,
      counteredBy: ["ranger"],
      counterText: "Ranger in Slot 4 cancels it: no damage.",
      variants: [
        { id: "goblin-ambush", name: "Goblin Ambush" },
        { id: "shadow-stalkers", name: "Shadow Stalkers" },
        { id: "bandit-ambush", name: "Bandit Ambush" },
      ],
    },
    boss: {
      id: "boss",
      name: "Boss",
      emoji: "🐉",
      target: "front",
      combat: true,
      clearable: false,
      counteredBy: ["knight", "berserker"],
      counterText:
        "Knight in Slot 1: damage −{knightReduction}. Berserker at full HP on entry: −{berserkerTimeSave} s.",
      variants: [
        { id: "the-lich", name: "The Lich" },
        { id: "the-bone-dragon", name: "The Bone Dragon" },
        { id: "the-goblin-king", name: "The Goblin King" },
      ],
    },
  });

  var ROOM_TYPE_IDS = deepFreeze(Object.keys(ROOM_TYPES));

  // variant id → { type, variant }
  var VARIANT_INDEX = {};
  ROOM_TYPE_IDS.forEach(function (t) {
    ROOM_TYPES[t].variants.forEach(function (v) {
      if (VARIANT_INDEX[v.id]) throw new Error("duplicate room variant id " + v.id);
      VARIANT_INDEX[v.id] = { type: t, variant: v };
    });
  });

  /* ------------------------------------------------------------------ */
  /* Rumors (PRD §6.2)                                                   */
  /* ------------------------------------------------------------------ */

  // Each option is { type, variant }: `variant` is a specific variant id, or
  // null when any variant of the type will do (the generator picks one).
  // The PRD pins the ozone trap to the Rune Trap. "Bones rattle" pins its
  // swarm to the Skeleton Horde so the reveal matches the Rumor.
  var RUMORS = deepFreeze([
    {
      id: "ozone",
      text: "A whiff of ozone",
      options: [
        { type: "magic", variant: null },
        { type: "trap", variant: "rune-trap" },
      ],
    },
    {
      id: "whispers",
      text: "Whispers in the dark",
      options: [
        { type: "ambush", variant: null },
        { type: "elite", variant: null },
      ],
    },
    {
      id: "bones",
      text: "Bones rattle",
      options: [
        { type: "swarm", variant: "skeleton-horde" },
        { type: "elite", variant: null },
      ],
    },
  ]);

  var RUMOR_IDS = deepFreeze(
    RUMORS.map(function (r) {
      return r.id;
    })
  );

  /* ------------------------------------------------------------------ */
  /* Heroes (PRD §8)                                                     */
  /* ------------------------------------------------------------------ */

  // `hp` is a fixed rule of the PRD (3, Mage 2), not a tuning value.
  // `slots`: the slots where the ability works, or null for any slot. Slot
  // numbers are literal 1-based positions in the line as it stands when the
  // room starts; [4] does NOT mean "back-most": with fewer than 4 heroes
  // standing nobody is in Slot 4 (FAN-11, PRD §8). `rotates`: a one-shot
  // counter that exhausts the hero and sends it to the back (PRD §7.3).
  var HEROES = deepFreeze([
    {
      id: "knight",
      name: "Knight",
      role: "Tank",
      hp: 3,
      emoji: "🛡️",
      rotates: false,
      slots: [1],
      ability: "In Slot 1, combat-room damage −{knightReduction}.",
    },
    {
      id: "rogue",
      name: "Rogue",
      role: "Scout",
      hp: 3,
      emoji: "🗡️",
      rotates: true,
      slots: [1, 2],
      ability: "Disarms traps from Slot 1 or 2. Then exhausted and rotates to the back.",
    },
    {
      id: "mage",
      name: "Mage",
      role: "DPS",
      hp: 2,
      emoji: "🔮",
      rotates: true,
      slots: null,
      ability:
        "Clears Swarm and Magic rooms: {mageEffect}, −{mageTimeSave} s. Then exhausted and rotates to the back. Only 2 HP.",
    },
    {
      id: "cleric",
      name: "Cleric",
      role: "Healer",
      hp: 3,
      emoji: "✨",
      rotates: false,
      slots: null,
      ability: "Restores {clericHeal} HP to the hero directly in front after each room.",
    },
    {
      id: "ranger",
      name: "Ranger",
      role: "Support",
      hp: 3,
      emoji: "🏹",
      rotates: false,
      slots: [4],
      ability: "In Slot 4, cancels Ambushes and saves {rangerTimeSave} s in every room.",
    },
    {
      id: "berserker",
      name: "Berserker",
      role: "Bruiser",
      hp: 3,
      emoji: "💪",
      rotates: false,
      slots: null,
      ability: "At full HP on entering the boss room, −{berserkerTimeSave} s.",
    },
  ]);

  var HERO_IDS = deepFreeze(
    HEROES.map(function (h) {
      return h.id;
    })
  );

  /* ------------------------------------------------------------------ */
  /* Lookups                                                             */
  /* ------------------------------------------------------------------ */

  function roomType(id) {
    var t = ROOM_TYPES[id];
    if (!t) throw new Error("unknown room type '" + id + "'");
    return t;
  }

  // variant id → { type: typeId, variant: { id, name } }
  function roomVariant(variantId) {
    var v = VARIANT_INDEX[variantId];
    if (!v) throw new Error("unknown room variant '" + variantId + "'");
    return v;
  }

  function heroById(id) {
    for (var i = 0; i < HEROES.length; i++) if (HEROES[i].id === id) return HEROES[i];
    throw new Error("unknown hero '" + id + "'");
  }

  function rumorById(id) {
    for (var i = 0; i < RUMORS.length; i++) if (RUMORS[i].id === id) return RUMORS[i];
    throw new Error("unknown rumor '" + id + "'");
  }

  // The tunable numbers of a room type: { damage, time }.
  function roomStats(typeId, tune) {
    roomType(typeId);
    var s = (tune || TUNE).rooms[typeId];
    return { damage: s.damage, time: s.time };
  }

  // A concrete room as the generator (FAN-13) and run engine (FAN-10) use it:
  // { type, variant, name, target, damage, time }. With no variantId the
  // type's first variant is used. Numbers come from `tune` (default TUNE).
  function makeRoom(typeId, variantId, tune) {
    var t = roomType(typeId);
    var v;
    if (variantId == null) v = t.variants[0];
    else {
      var found = roomVariant(variantId);
      if (found.type !== typeId)
        throw new Error("room variant '" + variantId + "' is a " + found.type + ", not a " + typeId);
      v = found.variant;
    }
    var s = roomStats(typeId, tune);
    return { type: typeId, variant: v.id, name: v.name, target: t.target, damage: s.damage, time: s.time };
  }

  // Values a text template may quote: every flat TUNE number, plus derived
  // phrases. `extra` (e.g. { damage: 3 }) takes precedence.
  function textValues(tune) {
    tune = tune || TUNE;
    var vals = {};
    Object.keys(tune).forEach(function (k) {
      if (!isPlainObject(tune[k])) vals[k] = tune[k];
    });
    vals.mageEffect = tune.mageMode === "halve" ? "half damage (rounded down)" : "no damage";
    return vals;
  }

  // Replace each {key} in `template` with its value. Unknown keys throw, so a
  // template that quotes a value TUNE doesn't have fails in tests, not on screen.
  function fillText(template, tune, extra) {
    var vals = textValues(tune);
    return template.replace(/\{(\w+)\}/g, function (_, key) {
      if (extra && Object.prototype.hasOwnProperty.call(extra, key)) return String(extra[key]);
      if (Object.prototype.hasOwnProperty.call(vals, key)) return String(vals[key]);
      throw new Error("fillText: no value for {" + key + "}");
    });
  }

  function heroAbilityText(heroId, tune) {
    return fillText(heroById(heroId).ability, tune);
  }

  function roomCounterText(typeId, tune) {
    return fillText(roomType(typeId).counterText, tune);
  }

  /* ------------------------------------------------------------------ */
  /* Run engine (PRD §7.1–7.5, §9) — FAN-10                              */
  /* ------------------------------------------------------------------ */

  // runDungeon(rooms, lineup, tune) resolves one attempt. It is a pure
  // function: it never mutates `rooms`, `lineup`, `tune` or any table, and the
  // same inputs always produce a deep-equal result.
  //
  //   rooms  — array of >= 1 room objects in the makeRoom() shape. Only `type`
  //            drives the rules; damage, time and target are read from `tune`
  //            and ROOM_TYPES (roomStats), so a withTune() override changes
  //            the outcome even for rooms built with the default tune. The
  //            room's baked `damage`/`time`/`target` are display values only.
  //   lineup — exactly 4 distinct hero ids, Slot 1 (front) first.
  //   tune   — TUNE (default) or a withTune() result.
  //
  // Result:
  //   {
  //     rooms: [RoomResult],  // one per input room, in order (unreached too)
  //     totalTime,            // sum of `time` over the rooms that were played
  //     knockouts,            // number of heroes knocked out
  //     knockedOut: [id],     // who, in knockout order
  //     survivors,            // number of heroes standing at the end
  //     line: [HeroState],    // the line at the end (copies)
  //     cleared,              // true iff someone is standing after the last
  //                           //   room's step 3 (PRD §7.5) — i.e. no wipe
  //     wipedAt,              // 0-based index of the wipe room, or null
  //   }
  //
  // HeroState: { id, hp, maxHp, exhausted }. Every HeroState in a result is a
  // fresh copy, never a reference into the engine's live line.
  //
  // RoomResult (everything FAN-12 needs to derive the §13.2 code):
  //   {
  //     index, type, variant, name, target,
  //     reached,         // false: the run ended before this room (⬜)
  //     cleared,         // reached and not wiped
  //     wiped,           // the party was wiped out in this room (💀)
  //     baseDamage,      // tune damage for the type
  //     damage,          // damage actually aimed at the line after step 1
  //                      //   (0 if cancelled)
  //     damageTaken,     // HP actually lost by heroes in this room
  //     damageByHero,    // { heroId: HP lost } for each hero that lost HP
  //     overkill,        // damage that was lost (slot1/slot4 excess, or front
  //                      //   overflow past the last hero)
  //     knockouts: [id], // heroes knocked out in this room, in order
  //     time,            // seconds this room took (0 if not reached)
  //     events: [Event], // display-ordered log (empty if not reached)
  //     lineBefore,      // [HeroState] as the room started ([] if not reached)
  //     lineAfter,       // [HeroState] after step 7 ([] if not reached)
  //   }
  //
  // Events, in PRD §7.5 step order. Every event is a plain object { kind, … }.
  //   counter { kind, hero, ability, fired, blocked?, effect?, amount?, seconds? }
  //           step 1 (FAN-11). One per ability whose hero is standing at room
  //           start in a room type it targets — fired or not, so the replay
  //           can say "the Rogue was exhausted, so the trap hit". Emitted in
  //           the order Rogue, Mage, Ranger, Knight, Berserker.
  //             hero/ability: rogue/"disarm" (trap), mage/"clear"
  //               (swarm, magic), ranger/"cancel" (ambush), knight/"guard"
  //               (swarm, magic, elite, boss — but no event at all in a room
  //               the Mage cleared in "cancel" mode), berserker/"fury" (boss).
  //             fired: true → `effect` is "disarm" | "clear" (Mage, cancel
  //               mode) | "halve" (Mage, halve mode) | "cancel" (Ranger) |
  //               "reduce" (Knight) | "speed" (Berserker). `amount` is the
  //               damage it prevented (not on "speed"); `seconds` the time it
  //               saves (Mage, Berserker; the same saving is listed again in
  //               the step-4 `time` event's `savings`).
  //             fired: false → `blocked` is "exhausted" (checked first),
  //               "slot" (Rogue not in Slot 1–2, Ranger not literally in
  //               Slot 4, Knight not in Slot 1) or "hp" (Berserker below
  //               full HP on entry). No effect/amount/seconds.
  //   damage  { kind, hero, slot, amount, hpBefore, hpAfter, overkill, overflow }
  //           step 2. `slot` is the hero's 1-based position when hit. `amount`
  //           is HP actually lost. `overkill` is damage lost beyond this hero
  //           (slot1/slot4 excess; for `front`, only on the last hero when the
  //           whole line could not absorb it). `overflow` is true when this
  //           damage carried back from the hero in front (`front` only). A room
  //           whose damage is 0 after step 1 emits no damage events; the
  //           counter event explains why.
  //   ko      { kind, hero, slot, line }
  //           step 3, front to back. `slot` is the hero's 1-based position
  //           in the line as it stood just before this ko (so after any
  //           earlier ko in the same room closed up); `line` is the hero ids
  //           after this ko closed it up.
  //   time    { kind, seconds, base, saved, floored, total, savings }
  //           step 4. `saved` is the sum of savings that fired, `floored` is
  //           true when tune.minRoomTime raised the result, `total` is the
  //           running time after this room. `savings` lists each saving as
  //           { hero, seconds, reason }, in the order: Mage "clear",
  //           Berserker "fury" (both fired at step 1), Ranger "speed" (the
  //           Ranger stood literally in Slot 4 at room start; not a counter).
  //   wipe    { kind }
  //           TERMINAL, not a §7.5 step: nobody is left and the run ends. The
  //           party is wiped at step 3, but the room was still played, so
  //           step 4 runs and its `time` event comes first; steps 5–7 are
  //           skipped. `wipe` is always the LAST event of its room, appears
  //           at most once per run, only in rooms[wipedAt], and every room
  //           after it has no events. (Playback shows 💀 as the final beat.)
  //   exhaust { kind, hero, exhausted }
  //           step 5 (FAN-11). First `exhausted: false` for each hero whose
  //           exhaustion from last room clears (front to back), then
  //           `exhausted: true` for a Rogue/Mage whose ability fired this room
  //           and is still standing (exhausted for the next room).
  //   rotate  { kind, hero, from, line }
  //           step 6 (FAN-11). That Rogue/Mage moved from 1-based slot `from`
  //           to the back; `line` is the hero ids after the move. Emitted
  //           even if it was already last (`from` === line.length).
  //   heal    { kind, hero, by, amount, hpAfter }
  //           step 7 (FAN-11). `hero` (directly in front of the Cleric after
  //           step 6) gained `amount` HP from `by` ("cleric"). Only when
  //           amount > 0, so a full-HP hero or a Slot-1 Cleric emits nothing.
  //   Steps 5–7 never run in a wipe room, so it has no exhaust, rotate or
  //   heal events.
  var EVENT_KINDS = deepFreeze(["counter", "damage", "ko", "time", "exhaust", "rotate", "heal", "wipe"]);

  // The order each event kind belongs to: the §7.5 step for 1–7, and 8 for the
  // terminal `wipe`. Within a room, events never go backwards in this order.
  var EVENT_STEP = deepFreeze({ counter: 1, damage: 2, ko: 3, time: 4, exhaust: 5, rotate: 6, heal: 7, wipe: 8 });

  function copyHero(h) {
    return { id: h.id, hp: h.hp, maxHp: h.maxHp, exhausted: h.exhausted };
  }

  function snapshotLine(line) {
    return line.map(copyHero);
  }

  function lineIds(line) {
    return line.map(function (h) {
      return h.id;
    });
  }

  function validateRun(rooms, lineup) {
    if (!Array.isArray(rooms) || rooms.length < 1) throw new Error("runDungeon: rooms must be a non-empty array");
    rooms.forEach(function (r, i) {
      if (!isPlainObject(r)) throw new TypeError("runDungeon: room " + i + " must be a room object");
      if (!Object.prototype.hasOwnProperty.call(ROOM_TYPES, r.type))
        throw new Error("runDungeon: room " + i + " has unknown room type '" + r.type + "'");
    });
    if (!Array.isArray(lineup) || lineup.length !== 4)
      throw new Error(
        "runDungeon: lineup must be an array of exactly 4 hero ids, got " +
          (Array.isArray(lineup) ? lineup.length : typeof lineup)
      );
    var seen = {};
    lineup.forEach(function (id) {
      if (HERO_IDS.indexOf(id) < 0) throw new Error("runDungeon: unknown hero '" + id + "' in lineup");
      if (seen[id]) throw new Error("runDungeon: duplicate hero '" + id + "' in lineup");
      seen[id] = true;
    });
  }

  // --- The seven §7.5 steps. Each takes the per-room context (see
  // --- resolveRoom) and only reads/writes it. Hero abilities are FAN-11.

  // 1-based slot of hero `id` in the line at room start, or 0 if it is not
  // standing. Slot numbers are literal: with fewer than 4 heroes standing,
  // nobody is in Slot 4 (FAN-11 decision; PRD §8).
  function startSlot(ctx, id) {
    for (var i = 0; i < ctx.lineAtStart.length; i++) if (ctx.lineAtStart[i].id === id) return i + 1;
    return 0;
  }

  // Push a `counter` event; `extra` holds effect/amount/seconds or blocked.
  function counterEvent(ctx, hero, ability, fired, extra) {
    var e = { kind: "counter", hero: hero, ability: ability, fired: fired };
    Object.keys(extra).forEach(function (k) {
      e[k] = extra[k];
    });
    ctx.events.push(e);
  }

  // Step 1 — Counters (PRD §7.5 step 1, §6.1, §8). Slot and HP conditions
  // read ctx.lineAtStart; exhausted heroes skip their ability. Resolved in
  // the PRD's order: Rogue, Mage, Ranger, Knight, Berserker (the Knight must
  // follow the Mage, whose clear switches him off). An ability whose hero is
  // standing in a room type it targets emits exactly one `counter` event:
  // fired, or blocked with a reason (exhaustion is checked before slot/HP).
  // It sets ctx.cancelled (Rogue, Ranger, Mage in "cancel" mode), lowers
  // ctx.damage (Mage "halve", Knight), pushes ctx.savings (Mage, Berserker)
  // and ctx.fired (the rotating Rogue and Mage).
  function stepCounters(ctx) {
    var t = ctx.tune;
    var typeId = ctx.room.type;
    var cleared = false; // the Mage cancelled the room ("cancel" mode only)

    // The hero's start-of-room { slot, state } if it is standing and the room
    // is one its ability targets; otherwise null (and no event at all).
    function eligible(id, applies) {
      if (!applies) return null;
      var slot = startSlot(ctx, id);
      return slot ? { slot: slot, state: ctx.lineAtStart[slot - 1] } : null;
    }

    // Rogue: trap, Slot 1 or 2 → disarmed, no damage. Rotates.
    var rogue = eligible("rogue", typeId === "trap");
    if (rogue) {
      if (rogue.state.exhausted) counterEvent(ctx, "rogue", "disarm", false, { blocked: "exhausted" });
      else if (rogue.slot > 2) counterEvent(ctx, "rogue", "disarm", false, { blocked: "slot" });
      else {
        counterEvent(ctx, "rogue", "disarm", true, { effect: "disarm", amount: ctx.damage });
        ctx.cancelled = true;
        ctx.fired.push("rogue");
      }
    }

    // Mage: swarm/magic, any slot → no damage ("cancel") or half, rounded
    // down ("halve"), and −mageTimeSave s. Rotates. A halved room is not
    // "cleared", so a Slot-1 Knight still reduces it (PRD §6.1 note).
    var mage = eligible("mage", ctx.type.clearable);
    if (mage) {
      if (mage.state.exhausted) counterEvent(ctx, "mage", "clear", false, { blocked: "exhausted" });
      else {
        var before = ctx.damage;
        if (t.mageMode === "halve") ctx.damage = Math.floor(before / 2);
        else {
          ctx.cancelled = true;
          cleared = true;
        }
        counterEvent(ctx, "mage", "clear", true, {
          effect: cleared ? "clear" : "halve",
          amount: cleared ? before : before - ctx.damage,
          seconds: t.mageTimeSave,
        });
        ctx.savings.push({ hero: "mage", seconds: t.mageTimeSave, reason: "clear" });
        ctx.fired.push("mage");
      }
    }

    // Ranger: ambush, literally in Slot 4 → cancelled, no damage. His speed
    // bonus is a step-4 saving (collectTimeSavings), not a counter.
    var ranger = eligible("ranger", typeId === "ambush");
    if (ranger) {
      if (ranger.state.exhausted) counterEvent(ctx, "ranger", "cancel", false, { blocked: "exhausted" });
      else if (ranger.slot !== 4) counterEvent(ctx, "ranger", "cancel", false, { blocked: "slot" });
      else {
        counterEvent(ctx, "ranger", "cancel", true, { effect: "cancel", amount: ctx.damage });
        ctx.cancelled = true;
      }
    }

    // Knight: combat room the Mage didn't clear, Slot 1 → damage −N, min 0.
    var knight = eligible("knight", ctx.type.combat && !cleared);
    if (knight) {
      if (knight.state.exhausted) counterEvent(ctx, "knight", "guard", false, { blocked: "exhausted" });
      else if (knight.slot !== 1) counterEvent(ctx, "knight", "guard", false, { blocked: "slot" });
      else {
        var pre = Math.max(0, ctx.damage);
        ctx.damage = Math.max(0, pre - t.knightReduction);
        counterEvent(ctx, "knight", "guard", true, { effect: "reduce", amount: pre - ctx.damage });
      }
    }

    // Berserker: boss room, full HP on entry → −berserkerTimeSave s.
    var berserker = eligible("berserker", typeId === "boss");
    if (berserker) {
      if (berserker.state.exhausted) counterEvent(ctx, "berserker", "fury", false, { blocked: "exhausted" });
      else if (berserker.state.hp < berserker.state.maxHp)
        counterEvent(ctx, "berserker", "fury", false, { blocked: "hp" });
      else {
        counterEvent(ctx, "berserker", "fury", true, { effect: "speed", seconds: t.berserkerTimeSave });
        ctx.savings.push({ hero: "berserker", seconds: t.berserkerTimeSave, reason: "fury" });
      }
    }
  }

  // Step 2 — Damage. Applies max(0, ctx.damage) to the room's target unless
  // ctx.cancelled. Heroes may drop to 0 HP here; they leave in step 3.
  function stepDamage(ctx) {
    var dmg = ctx.cancelled ? 0 : Math.max(0, ctx.damage);
    ctx.damage = dmg;
    if (dmg === 0) return;
    var line = ctx.line;
    if (ctx.target === "front") {
      var left = dmg;
      for (var i = 0; i < line.length && left > 0; i++) {
        var dealt = Math.min(left, line[i].hp);
        left -= dealt;
        var last = left > 0 && i === line.length - 1;
        hitHero(ctx, line[i], i, dealt, last ? left : 0, i > 0);
      }
    } else {
      // slot1: the front hero; slot4: the back-most hero (PRD §7.2). The
      // excess beyond that hero's HP is lost, never carried.
      var idx = ctx.target === "slot1" ? 0 : line.length - 1;
      var hit = Math.min(dmg, line[idx].hp);
      hitHero(ctx, line[idx], idx, hit, dmg - hit, false);
    }
  }

  function hitHero(ctx, hero, idx, amount, overkill, overflow) {
    var before = hero.hp;
    hero.hp -= amount;
    if (amount > 0) ctx.damageByHero[hero.id] = (ctx.damageByHero[hero.id] || 0) + amount;
    ctx.damageTaken += amount;
    ctx.overkill += overkill;
    ctx.events.push({
      kind: "damage",
      hero: hero.id,
      slot: idx + 1,
      amount: amount,
      hpBefore: before,
      hpAfter: hero.hp,
      overkill: overkill,
      overflow: overflow,
    });
  }

  // Step 3 — Knockouts. Heroes at 0 HP leave, front to back, and the line
  // closes up. An empty line is a wipe: it sets ctx.wiped here, but the
  // `wipe` event is pushed by resolveRoom as the room's last event.
  function stepKnockouts(ctx) {
    var line = ctx.line;
    for (var i = 0; i < line.length; ) {
      if (line[i].hp <= 0) {
        var h = line.splice(i, 1)[0];
        ctx.knockouts.push(h.id);
        ctx.events.push({ kind: "ko", hero: h.id, slot: i + 1, line: lineIds(line) });
      } else i++;
    }
    if (line.length === 0) ctx.wiped = true;
  }

  // Step 4 hook — time savings that PRD §7.5 assigns to step 4 itself rather
  // than step 1: the Ranger speed bonus, in any room, when the Ranger stood
  // literally in Slot 4 of ctx.lineAtStart (so never with < 4 standing). It
  // counts even if the Ranger is knocked out in this room: he started there.
  function collectTimeSavings(ctx) {
    var back = ctx.lineAtStart[3];
    if (back && back.id === "ranger" && !back.exhausted)
      ctx.savings.push({ hero: "ranger", seconds: ctx.tune.rangerTimeSave, reason: "speed" });
  }

  // Step 4 — Time. base − savings, never below tune.minRoomTime. Runs on a
  // wipe too: the room was played, so its time counts.
  function stepTime(ctx) {
    collectTimeSavings(ctx);
    var base = ctx.stats.time;
    var saved = 0;
    ctx.savings.forEach(function (s) {
      saved += s.seconds;
    });
    var seconds = Math.max(ctx.tune.minRoomTime, base - saved);
    ctx.time = seconds;
    ctx.events.push({
      kind: "time",
      seconds: seconds,
      base: base,
      saved: saved,
      floored: seconds > base - saved,
      total: ctx.runTime + seconds,
      savings: ctx.savings.map(function (s) {
        return { hero: s.hero, seconds: s.seconds, reason: s.reason };
      }),
    });
  }

  // Index of hero `id` in the live line, or -1 (knocked out).
  function liveIndex(line, id) {
    for (var i = 0; i < line.length; i++) if (line[i].id === id) return i;
    return -1;
  }

  // Step 5 — Exhaustion. Clear last room's flags (front to back), then mark
  // each hero in ctx.fired that is still standing exhausted for the next
  // room. (A hero exhausted last room cannot have fired this room.)
  function stepExhaustion(ctx) {
    ctx.line.forEach(function (h) {
      if (h.exhausted) {
        h.exhausted = false;
        ctx.events.push({ kind: "exhaust", hero: h.id, exhausted: false });
      }
    });
    ctx.fired.forEach(function (id) {
      var i = liveIndex(ctx.line, id);
      if (i < 0) return;
      ctx.line[i].exhausted = true;
      ctx.events.push({ kind: "exhaust", hero: id, exhausted: true });
    });
  }

  // Step 6 — Rotation. Each hero in ctx.fired that is still standing moves
  // to the back of the line; everyone behind it moves up one slot. The event
  // is emitted even when the hero was already last (`from` = line length),
  // so the replay always shows the rotation the ability causes.
  function stepRotation(ctx) {
    ctx.fired.forEach(function (id) {
      var i = liveIndex(ctx.line, id);
      if (i < 0) return;
      var h = ctx.line.splice(i, 1)[0];
      ctx.line.push(h);
      ctx.events.push({ kind: "rotate", hero: id, from: i + 1, line: lineIds(ctx.line) });
    });
  }

  // Step 7 — Heal. Front to back, each Cleric heals the hero directly in
  // front of her in the line as it stands after step 6 by tune.clericHeal,
  // up to maxHp. A Cleric in Slot 1 heals nobody. Emits `heal` only when
  // the hero actually gains HP.
  function stepHeal(ctx) {
    var line = ctx.line;
    for (var i = 1; i < line.length; i++) {
      if (line[i].id !== "cleric") continue;
      var target = line[i - 1];
      var amount = Math.min(ctx.tune.clericHeal, target.maxHp - target.hp);
      if (amount <= 0) continue;
      target.hp += amount;
      ctx.events.push({ kind: "heal", hero: target.id, by: "cleric", amount: amount, hpAfter: target.hp });
    }
  }

  // The per-room context every step reads and writes. `line` is the run's
  // live line (it belongs to this run only, so mutating it is safe).
  function newRoomContext(room, index, line, tune, runTime) {
    var type = ROOM_TYPES[room.type];
    var stats = roomStats(room.type, tune);
    return {
      index: index,
      room: room, // read-only input
      type: type, // ROOM_TYPES entry (combat, clearable, …)
      tune: tune,
      stats: stats, // { damage, time } from tune
      target: type.target,
      lineAtStart: snapshotLine(line), // slot conditions check this (§7.5)
      line: line, // live line; steps 2, 3, 6 change it
      runTime: runTime, // total time before this room
      damage: stats.damage, // step 1 may lower it; step 2 floors at 0
      cancelled: false, // step 1 may set it: no damage at all
      savings: [], // [{ hero, seconds, reason }]
      fired: [], // ids of heroes whose rotating ability fired (Rogue, Mage)
      events: [],
      damageTaken: 0,
      damageByHero: {},
      overkill: 0,
      knockouts: [],
      wiped: false,
      time: 0,
    };
  }

  // Resolve one room: the seven §7.5 steps in their fixed order. Returns the
  // context, from which the room result is built. On a wipe, steps 5–7 are
  // skipped and the terminal `wipe` event closes the room's log (after step 4's
  // `time`), so playback shows 💀 as the run's final beat.
  function resolveRoom(room, index, line, tune, runTime) {
    var ctx = newRoomContext(room, index, line, tune, runTime);
    stepCounters(ctx); // 1
    stepDamage(ctx); // 2
    stepKnockouts(ctx); // 3
    stepTime(ctx); // 4
    if (ctx.wiped) {
      ctx.events.push({ kind: "wipe" }); // terminal: always last
      return ctx;
    }
    stepExhaustion(ctx); // 5
    stepRotation(ctx); // 6
    stepHeal(ctx); // 7
    return ctx;
  }

  function roomHeader(room, index) {
    return {
      index: index,
      type: room.type,
      variant: room.variant == null ? null : room.variant,
      name: room.name == null ? null : room.name,
      target: ROOM_TYPES[room.type].target,
    };
  }

  function runDungeon(rooms, lineup, tune) {
    tune = tune || TUNE;
    validateRun(rooms, lineup);

    var line = lineup.map(function (id) {
      var h = heroById(id);
      return { id: id, hp: h.hp, maxHp: h.hp, exhausted: false };
    });
    var results = [];
    var totalTime = 0;
    var knockedOut = [];
    var wipedAt = null;

    rooms.forEach(function (room, i) {
      var r = roomHeader(room, i);
      if (wipedAt !== null) {
        r.reached = false;
        r.cleared = false;
        r.wiped = false;
        r.baseDamage = roomStats(room.type, tune).damage;
        r.damage = 0;
        r.damageTaken = 0;
        r.damageByHero = {};
        r.overkill = 0;
        r.knockouts = [];
        r.time = 0;
        r.events = [];
        r.lineBefore = [];
        r.lineAfter = [];
        results.push(r);
        return;
      }
      var lineBefore = snapshotLine(line);
      var ctx = resolveRoom(room, i, line, tune, totalTime);
      totalTime += ctx.time;
      knockedOut = knockedOut.concat(ctx.knockouts);
      if (ctx.wiped) wipedAt = i;
      r.reached = true;
      r.cleared = !ctx.wiped;
      r.wiped = ctx.wiped;
      r.baseDamage = ctx.stats.damage;
      r.damage = ctx.damage;
      r.damageTaken = ctx.damageTaken;
      r.damageByHero = ctx.damageByHero;
      r.overkill = ctx.overkill;
      r.knockouts = ctx.knockouts;
      r.time = ctx.time;
      r.events = ctx.events;
      r.lineBefore = lineBefore;
      r.lineAfter = snapshotLine(line);
      results.push(r);
    });

    return {
      rooms: results,
      totalTime: totalTime,
      knockouts: knockedOut.length,
      knockedOut: knockedOut,
      survivors: line.length,
      line: snapshotLine(line),
      cleared: wipedAt === null,
      wipedAt: wipedAt,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Scoring and share text (PRD §10, §13) — FAN-12 */
  /* ------------------------------------------------------------------ */

  // Everything here reads only documented runDungeon result fields: on the
  // result, `cleared`, `knockouts`, `totalTime` and `rooms`; on each room,
  // `reached`, `wiped`, `damageTaken` and `knockouts`. Nothing reads hero ids,
  // room names or events, so hero abilities (FAN-11) can't change the rules
  // and the share text can't leak a lineup or a room.

  // UI labels for 0–3 stars (PRD §10). Index 0 is a run that did not clear.
  var STAR_NAMES = deepFreeze(["", "Clear", "Unscathed", "Gold Par"]);

  // Per-room codes (PRD §13.2). Written as escapes so an editor can't strip
  // the variation selector: ⚔️ is U+2694 U+FE0F, and without U+FE0F some
  // platforms draw the swords as a narrow text glyph.
  var ROOM_CODES = deepFreeze({
    flawless: "\u2694\uFE0F", // ⚔️ reached, not wiped, no damage taken, no knockouts
    damaged: "\uD83D\uDE2C", // 😬 reached, not wiped, but damage taken or a knockout
    wipe: "\uD83D\uDC80", // 💀 the party was wiped out in this room
    unreached: "\u2B1C", // ⬜ the run ended before this room
  });

  var STAR_ON = "\u2605"; // ★
  var STAR_OFF = "\u2606"; // ☆
  var NO_CLEAR = "\u2717"; // ✗ (header for a day whose best attempt has 0 stars)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function checkResult(result, fn) {
    if (!isPlainObject(result) || !Array.isArray(result.rooms))
      throw new TypeError(fn + ": expected a runDungeon result");
    if (typeof result.cleared !== "boolean") throw new TypeError(fn + ": result.cleared must be a boolean");
    if (!Number.isInteger(result.knockouts) || result.knockouts < 0)
      throw new TypeError(fn + ": result.knockouts must be a non-negative integer");
    if (!isFiniteNumber(result.totalTime) || result.totalTime < 0)
      throw new TypeError(fn + ": result.totalTime must be a non-negative number");
  }

  function checkPar(parTime, fn) {
    if (!isFiniteNumber(parTime) || parTime < 0)
      throw new TypeError(fn + ": parTime must be a non-negative number, got " + parTime);
  }

  // stars(result, parTime) → 0..3 (PRD §10).
  //   0  not cleared (the party was wiped)
  //   1  cleared: at least one hero standing after the last room
  //   2  cleared with zero knockouts
  //   3  zero knockouts AND totalTime strictly under parTime (equal is 2★)
  function stars(result, parTime) {
    checkResult(result, "stars");
    checkPar(parTime, "stars");
    if (!result.cleared) return 0;
    if (result.knockouts > 0) return 1;
    return result.totalTime < parTime ? 3 : 2;
  }

  // roomCode(roomResult) → one of ROOM_CODES (PRD §13.2). Healing is ignored:
  // a hero who lost HP and was healed back still makes the room 😬.
  function roomCode(room) {
    if (!isPlainObject(room)) throw new TypeError("roomCode: expected a room result");
    if (!room.reached) return ROOM_CODES.unreached;
    if (room.wiped) return ROOM_CODES.wipe;
    var kos = Array.isArray(room.knockouts) ? room.knockouts.length : 0;
    return room.damageTaken > 0 || kos > 0 ? ROOM_CODES.damaged : ROOM_CODES.flawless;
  }

  // roomCodes(result) → one code per room, in room order.
  function roomCodes(result) {
    if (!isPlainObject(result) || !Array.isArray(result.rooms))
      throw new TypeError("roomCodes: expected a runDungeon result");
    return result.rooms.map(roomCode);
  }

  function roomsReached(result) {
    var n = 0;
    result.rooms.forEach(function (r) {
      if (r && r.reached) n++;
    });
    return n;
  }

  // bestAttempt(attempts, parTime) → { index, stars, totalTime } | null.
  // `attempts` is runDungeon results in play order; `index` is 0-based. The
  // order (PRD §10 "Best result"): more stars; then, among 0★ attempts only,
  // more rooms reached (otherwise the earliest wipe would have the lowest
  // time and win); then lower totalTime; an exact tie keeps the earlier one.
  function bestAttempt(attempts, parTime) {
    if (!Array.isArray(attempts)) throw new TypeError("bestAttempt: attempts must be an array");
    checkPar(parTime, "bestAttempt");
    var best = null;
    attempts.forEach(function (a, i) {
      var c = { index: i, stars: stars(a, parTime), totalTime: a.totalTime, reached: roomsReached(a) };
      if (best === null || beats(c, best)) best = c;
    });
    return best && { index: best.index, stars: best.stars, totalTime: best.totalTime };
  }

  // True if candidate `a` ranks strictly above `b` (ties keep `b`, the earlier).
  function beats(a, b) {
    if (a.stars !== b.stars) return a.stars > b.stars;
    if (a.stars === 0 && a.reached !== b.reached) return a.reached > b.reached;
    return a.totalTime < b.totalTime;
  }

  // shareText({ dayNumber, attempts, parTime, showTime = true }) → string
  // (PRD §13.3):
  //
  //   Daily Dungeon #142  ★★☆  73s
  //   Attempt 1: ⚔️ 😬 💀 ⬜ ⬜
  //   Attempt 2: ⚔️ ⚔️ 😬 😬 ⚔️
  //
  // Header: the day number as given, then the best attempt's stars as three
  // glyphs (★ earned, ☆ not), or "✗" alone if the best attempt has 0 stars,
  // then its totalTime in whole seconds (rounded down, so a 3★ time never
  // reads as par or more) — omitted when showTime is false or the best attempt
  // has 0 stars. Fields are separated by exactly two spaces. One row per
  // attempt played, codes separated by one space; rows joined by "\n", no
  // trailing newline. It never includes hero names, slot order, room names or
  // Rumors. Throws on anything but 1–3 attempts or an integer dayNumber.
  function shareText(opts) {
    if (!isPlainObject(opts)) throw new TypeError("shareText: expected an options object");
    var dayNumber = opts.dayNumber;
    var attempts = opts.attempts;
    var showTime = opts.showTime === undefined ? true : opts.showTime;
    if (!Number.isInteger(dayNumber)) throw new TypeError("shareText: dayNumber must be an integer, got " + dayNumber);
    if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 3)
      throw new Error(
        "shareText: attempts must be an array of 1-3 runDungeon results, got " +
          (Array.isArray(attempts) ? attempts.length : typeof attempts)
      );
    if (typeof showTime !== "boolean") throw new TypeError("shareText: showTime must be a boolean");
    checkPar(opts.parTime, "shareText");

    var best = bestAttempt(attempts, opts.parTime);
    var header = "Daily Dungeon #" + dayNumber + "  ";
    if (best.stars === 0) header += NO_CLEAR;
    else {
      for (var s = 1; s <= 3; s++) header += s <= best.stars ? STAR_ON : STAR_OFF;
      if (showTime) header += "  " + Math.floor(best.totalTime) + "s";
    }
    var lines = [header];
    attempts.forEach(function (a, i) {
      lines.push("Attempt " + (i + 1) + ": " + roomCodes(a).join(" "));
    });
    return lines.join("\n");
  }

  return {
    TUNE: TUNE,
    MAGE_MODES: MAGE_MODES,
    TARGETS: TARGETS,
    ROOM_TYPES: ROOM_TYPES,
    ROOM_TYPE_IDS: ROOM_TYPE_IDS,
    RUMORS: RUMORS,
    RUMOR_IDS: RUMOR_IDS,
    HEROES: HEROES,
    HERO_IDS: HERO_IDS,
    withTune: withTune,
    roomType: roomType,
    roomVariant: roomVariant,
    heroById: heroById,
    rumorById: rumorById,
    roomStats: roomStats,
    makeRoom: makeRoom,
    fillText: fillText,
    heroAbilityText: heroAbilityText,
    roomCounterText: roomCounterText,
    EVENT_KINDS: EVENT_KINDS,
    EVENT_STEP: EVENT_STEP,
    runDungeon: runDungeon,
    STAR_NAMES: STAR_NAMES,
    ROOM_CODES: ROOM_CODES,
    stars: stars,
    roomCode: roomCode,
    roomCodes: roomCodes,
    bestAttempt: bestAttempt,
    shareText: shareText,
    // Not public API: exposed so tests can drive single steps with a
    // hand-set context (e.g. a step-1 damage modifier before FAN-11 exists).
    _internal: { newRoomContext: newRoomContext, stepDamage: stepDamage },
  };
});
