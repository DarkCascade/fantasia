/*
 * Hall of Blows — simulation core (no rendering, no DOM).
 *
 * UMD: `window.HallwayCombatSim` in the browser, `module.exports` under Node
 * (test/hallway-combat.test.js drives it with a seeded RNG).
 *
 * The loop is a tiny state machine:
 *
 *   walk  -> the knight strides down the hallway. The world scrolls past him
 *            (he never moves in x); once enough hallway has gone by an orc
 *            fades in far down the corridor, and the scroll carries it toward
 *            him until the two are inside melee reach of each other.
 *   fight -> both fighters run their OWN swing timers. A fighter swings only
 *            when its cooldown is up and the target is inside `range`; the
 *            swing is a fixed windup, the damage lands at `hitAt`, then a
 *            recovery. Nobody dashes, teleports or closes the gap by
 *            attacking: swings are strictly in place.
 *   dying -> the orc topples, lingers, fades out. Then back to `walk`.
 *
 * The knight is overpowered on purpose. `CONFIG` is the one place to turn
 * that dial; the test asserts he never gets near death with these numbers.
 *
 * The view reads `knight` / `orc` / `phase` / `scroll` each frame and drains
 * `events` for one-shot effects (damage numbers, hit flashes, sparks).
 *
 * DECK MODE (`new World({ deck: true })`) is the roguelike format: the hallway
 * is endless and the player never steers. There is always an `offer` of three
 * room cards drawn from a deck; `choose(i)` spawns that room straight ahead of
 * Sir Cleave (or queues it if he is still busy with the last one). Riskier
 * rooms pay more points and grow the deck with better cards. Foes toughen with
 * every room cleared, and if the knight falls the run is over (`phase` "over").
 * The classic loop above is untouched when `deck` is off.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HallwayCombatSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CONFIG = {
    knight: {
      name: "Sir Cleave",
      maxHp: 100,
      dmg: [14, 22],
      interval: 0.8, // seconds between swing starts
      swingDur: 0.5, // whole swing animation
      hitAt: 0.28, // damage lands this far into the swing
      range: 1.9,
    },
    orc: {
      name: "Orc",
      maxHp: 80,
      dmg: [5, 11],
      interval: 1.5,
      swingDur: 0.8,
      hitAt: 0.5,
      range: 1.9,
    },
    knightX: -0.95, // fixed world x of the knight (the hallway scrolls instead)
    walkSpeed: 2.4, // hallway units per second
    spawnGap: 5.2, // how far down the hallway the orc fades in
    engageGap: 1.9, // the walk stops once the gap is this small (<= range)
    spawnAfter: [2.2, 4.0], // hallway walked after a kill before the next orc appears
    fadeIn: 1.2,
    orcOpenDelay: 0.6, // the orc's first swing is this far into the fight
    fallTime: 0.55, // orc topples
    holdTime: 0.15, // ...lies there
    vanishTime: 0.4, // ...fades away
    healOnKill: 0.4, // fraction of the knight's max life restored per orc
    // deck mode only
    fallTime: 0.55, // (shared) knight topples this fast when he dies
    run: {
      offerSize: 3,
      pickTime: 7, // seconds the hall may stay empty before a card is picked for you
      depthScale: 0.04, // foes (and their points) grow by this per room cleared
      healOnKill: 0.3, // gentler than the classic 0.4: a run has to be able to end
      featureGap: 2.3, // how near the knight walks to a shrine / armory before it triggers (so he doesn't hide it)
      featureHold: 0.9, // he lingers this long, then the room fades
      startDeck: { orc: 4, frenzied: 1, brute: 1, shrine: 2, armory: 1 },
    },
  };

  // Room cards. `foe` multiplies the base orc (hp / dmg / swing interval) and
  // tells the view how big and what colour to make it. `drops` cards are drawn
  // at random from `pool` and added to the deck when the room is cleared.
  const CARDS = {
    orc: {
      id: "orc", name: "Orc", kind: "foe", danger: 1, reward: 10, drops: 0, pool: [],
      foe: { hp: 1, dmg: 1, interval: 1, size: 1, tint: null }, blurb: "A plain orc.",
    },
    frenzied: {
      id: "frenzied", name: "Frenzied Orc", kind: "foe", danger: 2, reward: 25, drops: 1,
      pool: ["orc", "frenzied", "shrine"],
      foe: { hp: 0.8, dmg: 0.9, interval: 0.55, size: 0.95, tint: 0xd8452c }, blurb: "Swings almost twice as fast.",
    },
    brute: {
      id: "brute", name: "Brute", kind: "foe", danger: 3, reward: 45, drops: 1,
      pool: ["brute", "armory", "shrine", "frenzied", "warchief"],
      foe: { hp: 2, dmg: 1.5, interval: 1.25, size: 1.3, tint: 0x8a6a4a }, blurb: "Slow, heavy, and tough.",
    },
    warchief: {
      id: "warchief", name: "Warchief", kind: "foe", danger: 5, reward: 120, drops: 2,
      pool: ["armory", "warchief", "brute", "shrine"],
      foe: { hp: 2.6, dmg: 1.9, interval: 1.1, size: 1.55, tint: 0xc0302a }, blurb: "Could end the run on the spot.",
    },
    shrine: {
      id: "shrine", name: "Shrine", kind: "rest", danger: 0, reward: 0, heal: 0.3,
      tag: "Heal 30%", blurb: "A moment's peace.",
    },
    armory: {
      id: "armory", name: "Armory", kind: "boon", danger: 0, reward: 0, boon: { dmg: 3 },
      tag: "+3 damage", blurb: "Sharpen the blade, for good.",
    },
  };

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(rng, a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // Draw pile + discard pile. Cards on offer are in neither (the World holds
  // them); played and passed-over cards go to the discard, which is shuffled
  // back in when the draw pile runs dry. New cards join the discard.
  class Deck {
    constructor(rng, counts) {
      this.rng = rng;
      this.draw = [];
      this.discard = [];
      for (const id of Object.keys(counts)) for (let i = 0; i < counts[id]; i++) this.draw.push(id);
      shuffle(rng, this.draw);
    }
    drawN(n) {
      const out = [];
      while (out.length < n) {
        if (!this.draw.length) {
          if (!this.discard.length) break;
          this.draw = shuffle(this.rng, this.discard);
          this.discard = [];
        }
        out.push(this.draw.pop());
      }
      return out;
    }
    size() {
      return this.draw.length + this.discard.length;
    }
  }

  function makeFighter(id, spec, x) {
    return {
      id: id,
      name: spec.name,
      maxHp: spec.maxHp,
      hp: spec.maxHp,
      x: x,
      dmg: spec.dmg,
      interval: spec.interval,
      swingDur: spec.swingDur,
      hitAt: spec.hitAt,
      range: spec.range,
      cd: 0, // seconds until this fighter may start another swing
      swing: null, // seconds into the current swing, or null when not swinging
      hitDone: false,
      alive: true,
      alpha: 1, // visibility 0..1 (the orc fades in and out)
      fall: 0, // 0..1 topple progress (dead orc, or the fallen knight)
      size: 1, // view scale (deck-mode foes)
      tint: null,
    };
  }

  class World {
    constructor(opts) {
      opts = opts || {};
      this.cfg = opts.config || CONFIG;
      this.rng = mulberry32(opts.seed == null ? 1 : opts.seed);
      this.time = 0;
      this.scroll = 0; // total hallway walked; the view scrolls scenery by this
      this.kills = 0;
      this.phase = "walk";
      this.events = [];
      this.knight = makeFighter("knight", this.cfg.knight, this.cfg.knightX);
      this.orc = null;
      this.dyingT = 0;
      this.sinceKill = 0;
      this.spawnAfter = this.rollSpawnAfter();

      // deck mode state
      this.deckMode = !!opts.deck;
      if (this.deckMode) {
        this.deck = new Deck(this.rng, this.cfg.run.startDeck);
        this.score = 0;
        this.rooms = 0; // rooms cleared this run
        this.offer = null; // array of card ids the player may choose from, or null
        this.offerAge = 0; // seconds the offer has been waiting on an empty hall
        this.queued = null; // a card picked while the last room was still in play
        this.roomCard = null; // id of the room currently in play (null = hall is empty)
        this.feature = null; // a shrine / armory standing in the hall
        this.offerNext();
      }
    }

    // cards in the deck, including any currently on offer
    deckSize() {
      return this.deck.size() + (this.offer ? this.offer.length : 0);
    }

    rollSpawnAfter() {
      const r = this.cfg.spawnAfter;
      return r[0] + this.rng() * (r[1] - r[0]);
    }

    emit(e) {
      this.events.push(e);
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }

    spawnOrc(card) {
      const c = this.cfg;
      let spec = c.orc;
      if (card) {
        // a deck-mode foe: the base orc times the card, times how deep we are
        const f = card.foe;
        const depth = 1 + c.run.depthScale * this.rooms;
        const dmg = (v) => Math.max(1, Math.round(v * f.dmg * depth));
        spec = {
          name: card.name,
          maxHp: Math.round(c.orc.maxHp * f.hp * depth),
          dmg: [dmg(c.orc.dmg[0]), dmg(c.orc.dmg[1])],
          interval: c.orc.interval * f.interval,
          swingDur: c.orc.swingDur,
          hitAt: c.orc.hitAt,
          range: c.orc.range,
        };
      }
      this.orc = makeFighter("orc", spec, this.knight.x + c.spawnGap);
      this.orc.alpha = 0;
      if (card) {
        this.orc.size = card.foe.size;
        this.orc.tint = card.foe.tint;
      }
      this.emit({ type: "spawn", card: card ? card.id : null });
    }

    /* ----- deck mode: offers, rooms, rewards ----- */

    offerNext() {
      if (this.offer || this.queued || this.phase === "over") return;
      this.offer = this.deck.drawN(this.cfg.run.offerSize);
      this.offerAge = 0;
      this.emit({ type: "offer", cards: this.offer.slice() });
    }

    // Pick card `i` of the current offer. Returns false if there is nothing to pick.
    choose(i, auto) {
      if (!this.deckMode || this.phase === "over" || !this.offer || !this.offer[i]) return false;
      const id = this.offer[i];
      for (const o of this.offer) this.deck.discard.push(o); // played and passed-over cards both rest
      this.offer = null;
      this.offerAge = 0;
      const free = !this.roomCard;
      this.emit({ type: "choose", card: id, slot: i, auto: !!auto, queued: !free });
      if (free) this.startRoom(id);
      else this.queued = id; // the knight is still busy: it appears the moment he is done
      return true;
    }

    startRoom(id) {
      const card = CARDS[id];
      this.roomCard = id;
      if (card.kind === "foe") this.spawnOrc(card);
      else {
        this.feature = { id: id, x: this.knight.x + this.cfg.spawnGap, alpha: 0, used: false, t: 0 };
        this.emit({ type: "featurespawn", card: id });
      }
      // No new offer until this room is finished: the tray stays empty for the whole
      // room and the next three cards are dealt in roomDone().
    }

    useFeature() {
      const f = this.feature;
      const card = CARDS[f.id];
      const k = this.knight;
      f.used = true;
      f.t = 0;
      this.phase = "feature";
      if (card.kind === "rest") {
        const amount = Math.min(k.maxHp - k.hp, Math.round(k.maxHp * card.heal));
        k.hp += amount;
        if (amount > 0) this.emit({ type: "heal", amount: amount, hp: k.hp });
      } else if (card.kind === "boon") {
        k.dmg = [k.dmg[0] + card.boon.dmg, k.dmg[1] + card.boon.dmg]; // new array: CONFIG stays untouched
        this.emit({ type: "boon", text: card.tag });
      }
      this.emit({ type: "feature", card: f.id });
    }

    stepFeature(dt) {
      const f = this.feature;
      const hold = this.cfg.run.featureHold;
      const fade = 0.4;
      f.t += dt;
      f.alpha = f.t < hold ? 1 : Math.max(0, 1 - (f.t - hold) / fade);
      if (f.t >= hold + fade) {
        this.feature = null;
        this.phase = "walk";
        this.emit({ type: "resume" });
        this.roomDone();
      }
    }

    roomDone() {
      const card = CARDS[this.roomCard];
      this.roomCard = null;
      const depth = 1 + this.cfg.run.depthScale * this.rooms;
      this.rooms++;
      const added = [];
      let reward = 0;
      if (card.kind === "foe") {
        reward = Math.round(card.reward * depth);
        this.score += reward;
        for (let n = 0; n < card.drops; n++) {
          const id = card.pool[Math.floor(this.rng() * card.pool.length)];
          this.deck.discard.push(id);
          added.push(id);
        }
      }
      this.emit({ type: "roomclear", card: card.id, reward: reward, score: this.score, rooms: this.rooms });
      if (added.length) this.emit({ type: "reward", ids: added, deck: this.deckSize() });
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.startRoom(q);
      } else {
        this.offerAge = 0;
        this.offerNext(); // the room is over: deal the next three cards
      }
    }

    knightDie() {
      const k = this.knight;
      k.alive = false;
      k.swing = null;
      this.phase = "over";
      this.offer = null;
      this.queued = null;
      this.emit({ type: "knightdeath", rooms: this.rooms, score: this.score, deck: this.deckSize(), by: this.roomCard });
    }

    engage() {
      this.phase = "fight";
      this.knight.cd = 0;
      this.orc.cd = this.cfg.orcOpenDelay;
      this.emit({ type: "engage" });
    }

    step(dt) {
      const c = this.cfg;
      const k = this.knight;
      const o = this.orc;
      this.time += dt;

      if (this.phase === "walk") {
        const d = c.walkSpeed * dt;
        this.scroll += d;
        if (o) o.x -= d; // the orc stands still in the hallway; the hallway moves
        else if (!this.deckMode) {
          this.sinceKill += d;
          if (this.sinceKill >= this.spawnAfter) this.spawnOrc();
        }
        const f = this.feature;
        if (f && !f.used) {
          f.x -= d;
          f.alpha = Math.min(1, f.alpha + dt / c.fadeIn);
          if (f.x - k.x <= c.run.featureGap) this.useFeature();
        }
        if (this.orc && this.orc.x - k.x <= c.engageGap) this.engage();
      }

      if (this.deckMode) {
        // an empty hall with an offer waiting: the clock runs, then the hall chooses for you
        if (this.offer && !this.roomCard && this.phase !== "over") {
          this.offerAge += dt;
          if (this.offerAge >= c.run.pickTime) this.choose(Math.floor(this.rng() * this.offer.length), true);
        }
        if (this.phase === "over") k.fall = Math.min(1, k.fall + dt / c.fallTime);
        if (this.phase === "feature") this.stepFeature(dt);
      }

      if (this.orc && this.orc.alive && this.orc.alpha < 1) {
        this.orc.alpha = Math.min(1, this.orc.alpha + dt / c.fadeIn);
      }

      this.tickFighter(k, this.orc, dt);
      if (this.orc) this.tickFighter(this.orc, k, dt);

      if (this.phase === "dying") this.stepDying(dt);
    }

    tickFighter(f, target, dt) {
      if (f.cd > 0) f.cd -= dt;

      if (f.swing !== null) {
        f.swing += dt;
        if (!f.hitDone && f.swing >= f.hitAt) {
          f.hitDone = true;
          // A fighter that fell mid-swing never lands the blow.
          if (f.alive && target && target.alive) this.strike(f, target);
        }
        if (f.swing >= f.swingDur) f.swing = null;
        return;
      }

      if (
        this.phase === "fight" &&
        f.alive &&
        target &&
        target.alive &&
        f.cd <= 0 &&
        Math.abs(target.x - f.x) <= f.range
      ) {
        f.swing = 0;
        f.hitDone = false;
        f.cd = f.interval;
        this.emit({ type: "swing", by: f.id });
      }
    }

    strike(f, target) {
      const dmg = f.dmg[0] + Math.floor(this.rng() * (f.dmg[1] - f.dmg[0] + 1));
      // Safety net only: with CONFIG as shipped the knight cannot be reduced
      // to 0 (the test asserts it), so this floor is never what saves him.
      const floor = target.id === "knight" && !this.deckMode ? 1 : 0;
      target.hp = Math.max(floor, target.hp - dmg);
      this.emit({ type: "hit", by: f.id, to: target.id, dmg: dmg, hp: target.hp });
      if (target.id === "orc" && target.hp <= 0) this.killOrc(target);
      else if (target.id === "knight" && target.hp <= 0) this.knightDie();
    }

    killOrc(o) {
      o.alive = false;
      o.swing = null;
      this.phase = "dying";
      this.dyingT = 0;
      this.kills++;
      const k = this.knight;
      const frac = this.deckMode ? this.cfg.run.healOnKill : this.cfg.healOnKill;
      const healed = Math.min(k.maxHp - k.hp, Math.round(k.maxHp * frac));
      k.hp += healed;
      this.emit({ type: "death", kills: this.kills });
      if (healed > 0) this.emit({ type: "heal", amount: healed, hp: k.hp });
    }

    stepDying(dt) {
      const c = this.cfg;
      const o = this.orc;
      this.dyingT += dt;
      o.fall = Math.min(1, this.dyingT / c.fallTime);
      const fadeStart = c.fallTime + c.holdTime;
      o.alpha = this.dyingT < fadeStart ? 1 : Math.max(0, 1 - (this.dyingT - fadeStart) / c.vanishTime);
      if (this.dyingT >= fadeStart + c.vanishTime) {
        this.orc = null;
        this.phase = "walk";
        this.sinceKill = 0;
        this.spawnAfter = this.rollSpawnAfter();
        this.emit({ type: "resume" });
        if (this.deckMode) this.roomDone();
      }
    }
  }

  return { CONFIG: CONFIG, CARDS: CARDS, Deck: Deck, World: World, mulberry32: mulberry32 };
});
