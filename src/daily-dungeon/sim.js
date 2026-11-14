/*
 * Daily Dungeon — simulation core (content tables + tuning).
 *
 * Pure data and small lookup helpers, no rendering. It runs unchanged in the
 * browser (window.DailyDungeonSim) and under Node (module.exports), which is
 * what test/daily-dungeon-sim.test.js drives. Spec: PRD-daily-dungeon.md
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
  // room starts; [4] does NOT mean "back-most". How "Slot 4" works with
  // fewer than 4 heroes standing is decided in FAN-11. `rotates`: a one-shot
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
  };
});
