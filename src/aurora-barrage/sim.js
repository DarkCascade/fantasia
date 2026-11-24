/*
 * Aurora Barrage — simulation core (no rendering, no Phaser).
 *
 * UMD: `window.AuroraBarrageSim` in the browser, `module.exports` under Node, so
 * the unit tests and the balance bot (experiments/aurora-barrage-balance) drive
 * exactly the code the game runs. The Phaser view in src/aurora-barrage.js only
 * reads this world and feeds it a target position for the ship.
 *
 * The one big idea: WEAPON LEVEL = BEAMS PER VOLLEY. Level 1 fires one laser,
 * level 2 fires two, level 4 fires four. At the levels in MISSILE.levels (5, 10)
 * the ship also gains a homing-missile battery and the beam count restarts at
 * one (see `loadout`), then climbs a beam per level again. Experience orbs dropped by
 * dead enemies must be *flown into* (they drift off the bottom if you ignore
 * them), and getting hit costs hull AND weapon levels, so a high level is
 * something you earn and have to defend. Play well and the screen fills with
 * lasers; play badly and you never get there.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuroraBarrageSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 540;
  const H = 960;
  const STEP = 1 / 60;

  const MAX_LEVEL = 120;
  const START_HULL = 3;
  const MAX_HULL = 5;
  const PLAYER_R = 6; // the (tiny) hurtbox; the view draws it as a dot
  const PLAYER_SPEED = 1200; // px/s the ship may chase its target at
  const BOLT_SPEED = 1250;
  const MAX_PBOLTS = 1500;
  const MAX_EBULLETS = 520;
  const MAX_ENEMIES = 38;
  const MAX_ORBS = 320;
  const INVULN = 2.2;

  const DEFS = {
    scout: { hp: 3, r: 22, xp: 2, score: 100 },
    gunship: { hp: 16, r: 32, xp: 7, score: 300 },
    bomber: { hp: 80, r: 50, xp: 26, score: 900 },
    boss: { hp: 950, r: 105, xp: 420, score: 8000 },
  };

  /**
   * HOMING MISSILES — every knob lives here and is read live (never copied), so it can be
   * tweaked at runtime: `AuroraBarrageSim.MISSILE.interval = 0.6` in the console, or by the
   * balance bot. Units: px, seconds, radians.
   */
  const MISSILE = {
    levels: [5, 10],      // weapon levels that add one battery; the beam count restarts at 1 on each
    interval: 0.85,       // seconds between launches, PER BATTERY (cadence; lower = more missiles)
    stagger: true,        // spread batteries' launch timers across one interval instead of salvoing
    damage: 4,            // direct hit (x boltDamage(level), same tiers as beams)
    splash: 34,           // blast radius that also hurts neighbours (0 = none)
    splashMul: 0.5,       // fraction of the hit damage dealt to those neighbours
    launchSpeed: 300,     // px/s as it leaves the rail
    accel: 1500,          // px/s^2 along its heading
    topSpeed: 820,        // px/s cap
    turnRate: 7.5,        // rad/s the heading may swing toward its target (turning speed)
    kick: 0.5,            // launch angle outward from straight up (radians), per mount side
    lockDelay: 0.07,      // seconds after launch before it starts steering
    life: 2.6,            // seconds of fuel
    hitR: 7,              // missile's own radius added to the enemy's when testing a hit
    spread: 120,          // px of "already claimed" penalty per missile on a target (spreads salvos)
    maxLive: 90,          // hard cap on missiles in flight
  };

  // ---------- pure helpers (exported, unit-tested) ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** XP needed to climb from `level` to `level + 1`. Gentle at first, steep late. */
  function xpNeed(level) {
    return Math.round(5 + 2.4 * level + 0.04 * level * level);
  }

  /**
   * What the ship carries at `level`: {beams, missiles}. Levels 1-4 are 1-4 beams; at each level in
   * MISSILE.levels a battery is added and the beams restart at one, then gain one per level again
   * (5 -> 1 beam + 1 missile, 6-9 -> 2..5 beams + 1 missile, 10 -> 1 beam + 2 missiles, 11 -> 2 beams...).
   */
  function loadout(level) {
    const n = Math.max(1, Math.min(MAX_LEVEL, level | 0));
    let missiles = 0, base = 1;
    for (const l of MISSILE.levels) if (n >= l) { missiles++; base = l; }
    return { beams: missiles ? n - base + 1 : n, missiles };
  }

  /** One volley of beams: [{dx, ang}] (offset px, angle from straight up, radians). */
  function volley(level) {
    const n = loadout(level).beams;
    if (n === 1) return [{ dx: 0, ang: 0 }];
    const spacing = (Math.min(1.6, 40 / ((n - 1) / 2)) * Math.PI) / 180; // fan tops out at +-40deg
    const dxStep = Math.min(12, 120 / (n - 1)); // and the muzzle line at ~120px wide
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      out.push({ dx: k * dxStep, ang: k * spacing });
    }
    return out;
  }

  /** Seconds between volleys: faster with level, floored so 100+ beams stay renderable. */
  function fireInterval(level) {
    return Math.max(0.1, 0.17 - level * 0.0012);
  }

  function boltDamage(level) {
    return 1 + Math.floor(level / 30);
  }

  /** Beam colour tier 0..5 (cyan, green, yellow, orange, magenta, white). */
  function tierOf(level) {
    return level >= 86 ? 5 : level >= 56 ? 4 : level >= 32 ? 3 : level >= 16 ? 2 : level >= 6 ? 1 : 0;
  }

  /** Split `xp` into orb values (1/5/25/125/625/3125), using the smallest denomination that keeps the count <= maxN. */
  function splitXp(xp, maxN) {
    xp = Math.max(0, Math.round(xp));
    if (xp <= 0) return [];
    const dens = [1, 5, 25, 125, 625, 3125];
    let d = dens[dens.length - 1];
    for (const c of dens) if (Math.ceil(xp / c) <= maxN) { d = c; break; }
    const out = [];
    while (xp >= d) { out.push(d); xp -= d; }
    if (xp > 0) out.push(xp);
    return out;
  }

  function stageDuration(stage) {
    return 52 + Math.min(20, 3 * (stage - 1));
  }

  function bossHp(stage) {
    return Math.round(DEFS.boss.hp * (1 + 0.7 * (stage - 1)));
  }

  /** Level after taking a hit: lose a fifth of your levels (at least one), never below 1. */
  function levelAfterHit(level) {
    return level <= 1 ? 1 : Math.max(1, level - Math.max(1, Math.ceil(level * 0.2)));
  }

  // ---------- the world ----------

  class World {
    constructor(opts) {
      opts = opts || {};
      this.seed = opts.seed == null ? 1 : opts.seed;
      this.rand = mulberry32(this.seed);
      this.t = 0;
      this.nid = 0;
      this.over = false;
      this.score = 0;
      this.kills = 0;
      this.maxLevel = 1;
      this.bossesDown = 0;
      this.orbsLost = 0;
      this.hitsTaken = 0;
      this.events = [];

      this.player = {
        x: W / 2, y: H - 190, r: PLAYER_R,
        hull: START_HULL, inv: 0, level: opts.level || 1, xp: 0, fireT: 0.2,
        tx: W / 2, ty: H - 190,
      };
      this.maxLevel = this.player.level;
      this.pbolts = [];
      this.missiles = [];
      this.mT = []; // per-battery launch timers
      this.ebullets = [];
      this.enemies = [];
      this.orbs = [];
      this.boss = null;

      this.stage = opts.stage || 1;
      this.phase = "waves"; // waves -> warn -> boss -> clear -> waves ...
      this.phaseT = 0;
      this.spawnT = 1.5;
      this.minionT = 4;
      this.events.push({ t: "stage", n: this.stage });
    }

    // ----- difficulty knobs, all derived from stage / level -----
    get bulletMul() { return Math.min(1.5, 1 + 0.06 * (this.stage - 1)); }
    get fireMul() { return Math.max(0.55, 1 - 0.05 * (this.stage - 1)); }
    get density() { return 1 + this.player.level / 70; }
    get magnetR() { return 56 + Math.min(100, this.player.level * 1.0); }

    setTarget(x, y) {
      const p = this.player;
      p.tx = Math.max(22, Math.min(W - 22, x));
      p.ty = Math.max(90, Math.min(H - 40, y));
    }

    step(dt) {
      if (this.over) return;
      this.t += dt;
      this.stepPlayer(dt);
      this.stepDirector(dt);
      this.stepEnemies(dt);
      this.stepPlayerBolts(dt);
      this.stepMissiles(dt);
      this.stepEnemyBullets(dt);
      this.stepOrbs(dt);
      this.stepContacts();
      if (this.player.hull <= 0 && !this.over) {
        this.over = true;
        this.events.push({ t: "over" });
      }
    }

    // ----- player -----
    stepPlayer(dt) {
      const p = this.player;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy), m = PLAYER_SPEED * dt;
      if (d > m) { p.x += (dx / d) * m; p.y += (dy / d) * m; } else { p.x = p.tx; p.y = p.ty; }
      if (p.inv > 0) p.inv = Math.max(0, p.inv - dt);
      p.fireT -= dt;
      let guard = 0;
      while (p.fireT <= 0 && guard++ < 3) {
        this.fireVolley();
        p.fireT += fireInterval(p.level);
      }
    }

    fireVolley() {
      const p = this.player, v = volley(p.level);
      const dmg = boltDamage(p.level), tier = tierOf(p.level);
      for (const b of v) {
        if (this.pbolts.length >= MAX_PBOLTS) break;
        this.pbolts.push({
          x: p.x + b.dx, y: p.y - 34,
          vx: Math.sin(b.ang) * BOLT_SPEED, vy: -Math.cos(b.ang) * BOLT_SPEED,
          ang: b.ang, dmg, tier,
        });
      }
      this.events.push({ t: "shot" });
    }

    stepPlayerBolts(dt) {
      const bs = this.pbolts, es = this.enemies;
      let w = 0;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -40 || b.x < -60 || b.x > W + 60) continue;
        let hit = false;
        for (let j = 0; j < es.length; j++) {
          const e = es[j];
          if (e.dead || e.immune) continue;
          const rr = e.r + 5, dx = b.x - e.x, dy = b.y - e.y;
          if (dx * dx + dy * dy < rr * rr) {
            e.hp -= b.dmg; e.flash = 0.07; hit = true;
            if (e.hp <= 0) this.kill(e);
            break;
          }
        }
        if (!hit) bs[w++] = b;
      }
      bs.length = w;
    }

    // ----- homing missiles -----
    /** Launch timers follow the battery count; new batteries are phased so they don't fire as one salvo. */
    stepBatteries(dt) {
      const p = this.player, n = loadout(p.level).missiles, M = MISSILE;
      while (this.mT.length < n) this.mT.push(M.stagger ? (this.mT.length * M.interval) / Math.max(2, n) : 0);
      this.mT.length = n;
      for (let i = 0; i < n; i++) {
        this.mT[i] -= dt;
        if (this.mT[i] <= 0) { this.launchMissile(i); this.mT[i] += M.interval; if (this.mT[i] < 0) this.mT[i] = 0; }
      }
    }

    /** Battery i sits on alternating wings: 0 left, 1 right, 2 further out left... */
    launchMissile(i) {
      if (this.missiles.length >= MISSILE.maxLive) return;
      const p = this.player, M = MISSILE;
      const side = i % 2 ? 1 : -1, ang = side * M.kick;
      const mount = 22 + 12 * (i >> 1);
      this.missiles.push({
        id: ++this.nid, x: p.x + side * mount, y: p.y - 8, ang,
        vx: Math.sin(ang) * M.launchSpeed, vy: -Math.cos(ang) * M.launchSpeed,
        spd: M.launchSpeed, t: 0, tgt: 0, dmg: M.damage * boltDamage(p.level),
      });
      this.events.push({ t: "missile" });
    }

    /** Nearest live target, with a penalty per missile already chasing it so a salvo fans out. */
    pickTarget(m) {
      const claims = new Map();
      for (const o of this.missiles) if (o !== m && o.tgt) claims.set(o.tgt, (claims.get(o.tgt) || 0) + 1);
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (e.dead || e.immune || e.y < -30) continue;
        const d = Math.hypot(e.x - m.x, e.y - m.y) + MISSILE.spread * (claims.get(e.id) || 0);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    stepMissiles(dt) {
      this.stepBatteries(dt);
      const ms = this.missiles, M = MISSILE;
      let w = 0;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        m.t += dt;
        if (m.t > M.life) continue;
        let tgt = null;
        if (m.t >= M.lockDelay) {
          if (m.tgt) tgt = this.enemies.find((e) => e.id === m.tgt && !e.dead && !e.immune) || null;
          if (!tgt) { tgt = this.pickTarget(m); m.tgt = tgt ? tgt.id : 0; }
        }
        // steer: swing the heading toward the target at no more than turnRate; with no target ease back to straight up
        const want = tgt ? Math.atan2(tgt.x - m.x, -(tgt.y - m.y)) : 0;
        let d = want - m.ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = M.turnRate * dt * (tgt ? 1 : 0.35);
        m.ang += Math.max(-turn, Math.min(turn, d));
        m.spd = Math.min(M.topSpeed, m.spd + M.accel * dt);
        m.vx = Math.sin(m.ang) * m.spd; m.vy = -Math.cos(m.ang) * m.spd;
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.y < -50 || m.y > H + 50 || m.x < -50 || m.x > W + 50) continue;
        let hit = null;
        for (const e of this.enemies) {
          if (e.dead || e.immune) continue;
          const rr = e.r + M.hitR, dx = m.x - e.x, dy = m.y - e.y;
          if (dx * dx + dy * dy < rr * rr) { hit = e; break; }
        }
        if (hit) { this.missileHit(m, hit); continue; }
        ms[w++] = m;
      }
      ms.length = w;
    }

    missileHit(m, e) {
      const M = MISSILE;
      this.events.push({ t: "mhit", x: m.x, y: m.y, r: M.splash });
      e.hp -= m.dmg; e.flash = 0.07;
      if (e.hp <= 0) this.kill(e);
      if (M.splash > 0 && M.splashMul > 0) {
        for (const o of this.enemies) {
          if (o === e || o.dead || o.immune) continue;
          const rr = o.r + M.splash, dx = m.x - o.x, dy = m.y - o.y;
          if (dx * dx + dy * dy < rr * rr) { o.hp -= m.dmg * M.splashMul; o.flash = 0.07; if (o.hp <= 0) this.kill(o); }
        }
      }
    }

    // ----- enemies -----
    make(kind, x, y, o) {
      const d = DEFS[kind], s = this.stage;
      const hp = kind === "boss" ? bossHp(s) : Math.ceil(d.hp * (1 + 0.5 * (s - 1)));
      const e = Object.assign({
        id: ++this.nid, kind, x, y, x0: x, y0: y, vx: 0, vy: 0, amp: 0, freq: 0, ph: 0, t: 0,
        hp, maxHp: hp, r: d.r, flash: 0, cd: 1 + this.rand(), state: "in", xp: Math.round(d.xp * (1 + 0.2 * (s - 1))),
        score: d.score, dead: false, immune: false,
      }, o || {});
      this.enemies.push(e);
      return e;
    }

    aim(x, y) {
      const p = this.player;
      return Math.atan2(p.x - x, p.y - y); // 0 = straight down
    }

    ebullet(x, y, ang, speed, k) {
      if (this.ebullets.length >= MAX_EBULLETS) return;
      this.ebullets.push({ x, y, vx: Math.sin(ang) * speed, vy: Math.cos(ang) * speed, r: 5.5, k });
    }

    spread(x, y, n, total, speed, k, base) {
      const a0 = base == null ? this.aim(x, y) : base;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : i / (n - 1) - 0.5;
        this.ebullet(x, y, a0 + f * total, speed, k);
      }
    }

    ring(x, y, n, speed, k, off) {
      for (let i = 0; i < n; i++) this.ebullet(x, y, off + (i / n) * Math.PI * 2, speed, k);
    }

    stepEnemies(dt) {
      const es = this.enemies;
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        e.t += dt;
        if (e.flash > 0) e.flash -= dt;
        if (e.kind === "scout") this.stepScout(e, dt);
        else if (e.kind === "gunship") this.stepGunship(e, dt);
        else if (e.kind === "bomber") this.stepBomber(e, dt);
        else this.stepBoss(e, dt);
      }
      let w = 0;
      for (let i = 0; i < es.length; i++) if (!es[i].dead) es[w++] = es[i];
      es.length = w;
    }

    stepScout(e) {
      e.x = e.x0 + e.vx * e.t + e.amp * Math.sin(e.freq * e.t + e.ph);
      e.y = e.y0 + e.vy * e.t;
      if (e.shoots && !e.shot && e.t > e.fireAt && e.y > 60 && e.y < 520) {
        e.shot = true;
        this.ebullet(e.x, e.y + 14, this.aim(e.x, e.y), 215 * this.bulletMul, 0);
      }
      if (e.y > H + 60 || e.x < -140 || e.x > W + 140) e.dead = true;
    }

    stepGunship(e, dt) {
      if (e.state === "in") {
        e.y += 150 * dt;
        if (e.y >= e.hy) e.state = "hover", e.t0 = e.t;
      } else if (e.state === "hover") {
        const h = e.t - e.t0;
        e.x = Math.max(60, Math.min(W - 60, e.x0 + 70 * Math.sin(0.8 * h + e.ph)));
        e.y = e.hy + 10 * Math.sin(1.3 * h);
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = (1.9 + this.rand() * 0.8) * this.fireMul;
          this.spread(e.x, e.y + 20, this.stage >= 3 ? 5 : 3, 0.5, 235 * this.bulletMul, 1);
        }
        if (h > 11) e.state = "leave";
      } else {
        e.y -= 230 * dt;
        if (e.y < -120) e.dead = true;
      }
    }

    stepBomber(e, dt) {
      if (e.state === "in") {
        e.y += 90 * dt;
        if (e.y >= e.hy) e.state = "hover", e.t0 = e.t;
      } else if (e.state === "hover") {
        const h = e.t - e.t0;
        e.x = Math.max(80, Math.min(W - 80, e.x0 + 55 * Math.sin(0.5 * h + e.ph)));
        e.y = e.hy + 8 * Math.sin(0.9 * h);
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = 2.5 * this.fireMul;
          e.n = (e.n || 0) + 1;
          this.ring(e.x, e.y + 20, 9 + Math.min(9, this.stage * 2), 150 * this.bulletMul, 2, this.rand() * 6.28);
          if (e.n % 2 === 0) this.spread(e.x, e.y + 30, 3, 0.36, 250 * this.bulletMul, 2);
        }
        if (h > 17) e.state = "leave";
      } else {
        e.y -= 160 * dt;
        if (e.y < -160) e.dead = true;
      }
    }

    stepBoss(e, dt) {
      const s = this.stage, bm = this.bulletMul, fm = this.fireMul;
      if (e.state === "in") {
        const k = Math.min(1, e.t / 2.8);
        e.y = -170 + (190 + 170) * (1 - (1 - k) * (1 - k));
        e.immune = true;
        if (k >= 1) { e.state = "fight"; e.immune = false; e.t0 = e.t; }
        return;
      }
      const h = e.t - e.t0;
      const frac = e.hp / e.maxHp;
      const ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
      if (ph !== e.ph3) {
        if (e.ph3) { this.ebullets.length = 0; this.events.push({ t: "bossPhase", n: ph }); }
        e.ph3 = ph;
      }
      const sway = ph === 3 ? 0.8 : 0.55;
      e.x = W / 2 + 125 * Math.sin(h * sway);
      e.y = 190 + 18 * Math.sin(h * 1.1);
      const mx = e.x, my = e.y + 70;
      e.cdFan = (e.cdFan == null ? 0.8 : e.cdFan) - dt;
      e.cdRing = (e.cdRing == null ? 2.5 : e.cdRing) - dt;
      e.cdSpin = (e.cdSpin == null ? 0 : e.cdSpin) - dt;
      e.spin = e.spin || 0;
      if (e.cdFan <= 0) {
        const n = ph === 1 ? 5 : ph === 2 ? 3 : 7;
        e.cdFan = (ph === 1 ? 1.15 : ph === 2 ? 1.5 : 1.1) * fm;
        this.spread(mx, my, Math.min(11, n + 2 * Math.floor(s / 3)), ph === 3 ? 1.2 : 0.95, 255 * bm, 3);
        // side cannons
        this.ebullet(mx - 105, my - 20, this.aim(mx - 105, my - 20), 270 * bm, 3);
        this.ebullet(mx + 105, my - 20, this.aim(mx + 105, my - 20), 270 * bm, 3);
      }
      if (e.cdRing <= 0) {
        e.cdRing = (ph === 3 ? 2.3 : ph === 2 ? 4 : 3.3) * fm;
        e.flip = !e.flip;
        this.ring(mx, my, Math.min(30, 14 + 2 * s + (ph === 3 ? 6 : 0)), 165 * bm, 3, e.flip ? 0.2 : 0);
      }
      if (ph >= 2 && e.cdSpin <= 0) {
        e.cdSpin = (ph === 2 ? 0.12 : 0.13) * fm;
        e.spin += 0.27;
        const arms = ph === 2 ? 2 : 3;
        for (let a = 0; a < arms; a++) this.ebullet(mx, my, e.spin + (a / arms) * Math.PI * 2, 190 * bm, 3);
      }
      e.cdMinion = (e.cdMinion == null ? 5 : e.cdMinion) - dt;
      if (e.cdMinion <= 0 && this.enemies.length < MAX_ENEMIES - 6) {
        e.cdMinion = 5.5;
        this.pattern("rain");
      }
    }

    kill(e) {
      if (e.dead) return;
      e.dead = true;
      this.kills++;
      this.score += e.score;
      const big = e.kind === "boss" ? 3 : e.kind === "bomber" ? 2 : e.kind === "gunship" ? 1 : 0;
      this.events.push({ t: "boom", x: e.x, y: e.y, s: big, kind: e.kind });
      this.dropOrbs(e.x, e.y, e.xp, e.kind === "boss" ? 16 : e.kind === "bomber" ? 7 : 4, e.kind === "boss" ? 320 : 120);
      if (e.kind === "boss") this.bossDown(e);
    }

    dropOrbs(x, y, xp, maxN, burst) {
      for (const v of splitXp(xp, maxN)) {
        if (this.orbs.length >= MAX_ORBS) { this.gainXp(v, true); continue; }
        const a = this.rand() * Math.PI * 2, sp = (0.3 + 0.7 * this.rand()) * burst;
        this.orbs.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, v });
      }
    }

    bossDown() {
      this.bossesDown++;
      this.boss = null;
      this.phase = "clear";
      this.phaseT = 0;
      this.score += 2000 * this.stage;
      this.player.hull = Math.min(MAX_HULL, this.player.hull + 1);
      // the rest of the fleet goes down with the flagship; their wreckage is plain scenery
      for (const o of this.enemies) if (o.kind !== "boss" && !o.dead) { o.dead = true; this.events.push({ t: "boom", x: o.x, y: o.y, s: 1, kind: o.kind }); }
      this.ebullets.length = 0;
      this.events.push({ t: "bossDown" });
    }

    // ----- enemy bullets, orbs, contacts -----
    stepEnemyBullets(dt) {
      const bs = this.ebullets, p = this.player;
      let w = 0;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -50 || b.y > H + 50 || b.x < -50 || b.x > W + 50) continue;
        if (p.inv <= 0 && p.hull > 0) {
          const rr = p.r + b.r, dx = b.x - p.x, dy = b.y - p.y;
          if (dx * dx + dy * dy < rr * rr) { this.hurt(b.k); continue; }
        }
        bs[w++] = b;
      }
      bs.length = w;
    }

    stepOrbs(dt) {
      const p = this.player, os = this.orbs, mr = this.magnetR;
      let w = 0;
      for (let i = 0; i < os.length; i++) {
        const o = os[i];
        const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
        if (d < 26) { this.gainXp(o.v, false); this.events.push({ t: "pick", v: o.v, x: o.x, y: o.y }); continue; }
        if (d < mr && p.hull > 0) {
          const sp = 360 + (mr - d) * 6;
          o.x += (dx / d) * sp * dt; o.y += (dy / d) * sp * dt;
          o.vx *= 0.9; o.vy *= 0.9;
        } else {
          o.vx *= Math.pow(0.05, dt);
          o.vy += (92 - o.vy) * Math.min(1, dt * 2);
          o.x += o.vx * dt; o.y += o.vy * dt;
          if (o.x < 14) { o.x = 14; o.vx = Math.abs(o.vx); }
          if (o.x > W - 14) { o.x = W - 14; o.vx = -Math.abs(o.vx); }
        }
        if (o.y > H + 30) { this.orbsLost += o.v; continue; }
        os[w++] = o;
      }
      os.length = w;
    }

    stepContacts() {
      const p = this.player;
      if (p.inv > 0 || p.hull <= 0) return;
      for (const e of this.enemies) {
        if (e.dead || e.state === "in" && e.kind === "boss") continue;
        const rr = e.r * 0.8 + p.r, dx = e.x - p.x, dy = e.y - p.y;
        if (dx * dx + dy * dy < rr * rr) {
          e.hp -= 25; e.flash = 0.1;
          if (e.hp <= 0) this.kill(e);
          this.hurt(-1);
          return;
        }
      }
    }

    gainXp(v, silent) {
      const p = this.player;
      this.score += v * 5;
      if (p.level >= MAX_LEVEL) return;
      p.xp += v;
      let up = false;
      while (p.level < MAX_LEVEL && p.xp >= xpNeed(p.level)) {
        p.xp -= xpNeed(p.level);
        p.level++;
        up = true;
      }
      if (p.level >= MAX_LEVEL) p.xp = 0;
      if (up) {
        if (p.level > this.maxLevel) this.maxLevel = p.level;
        if (!silent) this.events.push({ t: "level", level: p.level });
      }
    }

    hurt(by) {
      const p = this.player;
      if (p.inv > 0 || p.hull <= 0) return;
      p.hull--;
      this.hitsTaken++;
      p.inv = INVULN;
      const before = p.level, after = levelAfterHit(before);
      let spill = p.xp * 0.5;
      for (let l = after; l < before; l++) spill += xpNeed(l) * 0.5; // half the lost levels spill as orbs
      p.level = after;
      p.xp = 0;
      // mercy: wipe the bullets crowding the ship
      this.ebullets = this.ebullets.filter((b) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 170 * 170);
      this.dropOrbs(p.x, p.y - 30, spill, 12, 260);
      this.events.push({ t: "hurt", lost: before - after, hull: p.hull, by });
    }

    // ----- the director: waves, a warning, a boss, a breather -----
    stepDirector(dt) {
      this.phaseT += dt;
      if (this.phase === "waves") {
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.enemies.length < MAX_ENEMIES - 12) {
          this.pattern(this.pickPattern());
          const gap = Math.max(0.85, 2.7 - 0.09 * (this.stage - 1)) / this.density;
          this.spawnT = gap * (0.8 + 0.4 * this.rand());
        }
        if (this.phaseT >= stageDuration(this.stage)) { this.phase = "warn"; this.phaseT = 0; this.events.push({ t: "bossWarn" }); }
      } else if (this.phase === "warn") {
        if (this.phaseT >= 2.6) {
          this.phase = "boss"; this.phaseT = 0;
          this.boss = this.make("boss", W / 2, -170, { immune: true });
          this.boss.x0 = W / 2;
          this.events.push({ t: "boss" });
        }
      } else if (this.phase === "clear") {
        if (this.phaseT >= 3.8) {
          this.stage++; this.phase = "waves"; this.phaseT = 0; this.spawnT = 1.2;
          this.events.push({ t: "stage", n: this.stage });
        }
      }
    }

    pickPattern() {
      const s = this.stage, t = this.phaseT;
      const opts = [["line", 3], ["stagger", 2], ["vee", 3], ["snake", 2], ["rain", 2]];
      if (s > 1 || t > 14) opts.push(["gunships", 2.2]);
      if ((s > 1 && t > 10) || t > 36) opts.push(["bomber", 1.2]);
      let sum = 0;
      for (const o of opts) sum += o[1];
      let r = this.rand() * sum;
      for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
      return "line";
    }

    scout(x, y, o) {
      const s = this.stage;
      const shoots = s >= 2 && this.rand() < Math.min(0.75, 0.2 + 0.1 * s);
      return this.make("scout", x, y, Object.assign({ vy: 190 * Math.min(1.35, 1 + 0.04 * s), shoots, fireAt: 0.6 + this.rand() * 1.4 }, o));
    }

    pattern(name) {
      const s = this.stage, R = () => this.rand();
      if (name === "line") {
        const n = 5 + Math.min(3, Math.floor(s / 2));
        for (let i = 0; i < n; i++) this.scout(55 + (i * (W - 110)) / (n - 1), -40);
      } else if (name === "stagger") {
        const n = 6, dir = R() < 0.5 ? 1 : -1;
        for (let i = 0; i < n; i++) this.scout(dir > 0 ? 60 + i * 70 : W - 60 - i * 70, -40 - i * 55, { vy: 210 });
      } else if (name === "vee") {
        const m = s >= 3 ? 3 : 2, cx = 120 + R() * (W - 240);
        for (let i = -m; i <= m; i++) this.scout(cx + i * 52, -40 - Math.abs(i) * 52, { amp: 40, freq: 1.4 });
      } else if (name === "snake") {
        const n = 8 + Math.min(4, s), x0 = 110 + R() * (W - 220), amp = 90 + R() * 50, freq = 1.7, vy = 200;
        const sgn = R() < 0.5 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const lag = i * 0.24;
          this.scout(x0, -40 - vy * lag, { vy, amp: amp * sgn, freq, ph: -freq * lag });
        }
      } else if (name === "rain") {
        const n = 4 + Math.min(4, s);
        for (let i = 0; i < n; i++) this.scout(40 + R() * (W - 80), -40 - i * 75, { vy: 250 });
      } else if (name === "gunships") {
        const n = Math.min(4, 1 + Math.floor((s + 1) / 2));
        for (let i = 0; i < n; i++) {
          const x = 110 + ((i + 0.5) * (W - 220)) / n;
          this.make("gunship", x, -50 - i * 30, { hy: 150 + R() * 90, ph: R() * 6.28 });
        }
      } else if (name === "bomber") {
        this.make("bomber", 140 + R() * (W - 280), -80, { hy: 175, ph: R() * 6.28 });
      }
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  return {
    W, H, STEP, MAX_LEVEL, START_HULL, MAX_HULL, DEFS, MISSILE, World,
    xpNeed, loadout, volley, fireInterval, boltDamage, tierOf, splitXp, stageDuration, bossHp, levelAfterHit, mulberry32,
  };
});
