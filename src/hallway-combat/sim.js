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
      fall: 0, // 0..1 topple progress (dead orc)
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

    spawnOrc() {
      const c = this.cfg;
      this.orc = makeFighter("orc", c.orc, this.knight.x + c.spawnGap);
      this.orc.alpha = 0;
      this.emit({ type: "spawn" });
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
        else {
          this.sinceKill += d;
          if (this.sinceKill >= this.spawnAfter) this.spawnOrc();
        }
        if (this.orc && this.orc.x - k.x <= c.engageGap) this.engage();
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
      const floor = target.id === "knight" ? 1 : 0;
      target.hp = Math.max(floor, target.hp - dmg);
      this.emit({ type: "hit", by: f.id, to: target.id, dmg: dmg, hp: target.hp });
      if (target.id === "orc" && target.hp <= 0) this.killOrc(target);
    }

    killOrc(o) {
      o.alive = false;
      o.swing = null;
      this.phase = "dying";
      this.dyingT = 0;
      this.kills++;
      const k = this.knight;
      const healed = Math.min(k.maxHp - k.hp, Math.round(k.maxHp * this.cfg.healOnKill));
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
      }
    }
  }

  return { CONFIG: CONFIG, World: World, mulberry32: mulberry32 };
});
