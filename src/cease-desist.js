/*
 * Cease & Desist — a game publisher's legal desk, in two levels.
 *
 * You run the legal desk of a publisher with nine studios. Pirates, knock-off
 * clones and copyright trolls keep turning up; your own studios' real releases
 * are the thing you must NOT hit. Revenue is the score, IP Integrity (the
 * brand) is the life bar, and every level has a revenue goal that ends it as a
 * win. Each takedown charges the Legal Fund; a full fund unlocks one CLASS
 * ACTION that clears every threat on the board.
 *
 *  - Level 1, "Whack Row": whack-a-mole. Threats pop out of the studios' desks;
 *    tapping a legitimate release is a wrongful takedown, leaving it alone
 *    sells it. Goal: $4,000 (a competent player manages it well under a minute).
 *  - Level 2, "Bar Rush": Root Beer Tapper. Each studio is a bartop. Customers
 *    walk in from the door toward the counter at the right; tap the tap handle
 *    to slide a licensed copy down the bar to the first customer. Fans buy it;
 *    a pirate who gets served has pirated it. Tap a pirate/troll/knockoff
 *    itself to bounce it; tapping a fan is a wrongful takedown.
 *
 * Structure: Core holds what both levels share, Shift (level 1) and BarShift
 * (level 2) are pure models (no DOM; tests pass a seeded rng), and
 * CeaseDesist is the DOM view on top. Like Greenlit this is a plain HTML/CSS
 * overlay, not a Phaser scene. window.launchCeaseDesist({level?}) builds it;
 * window.ceaseDesistGame is the handle, its destroy() takes no arguments, and
 * .game / .model expose the view and the live model for headless assertions.
 * Progress (levels cleared, best clear times) is in localStorage (PROGRESS_KEY);
 * level 2 unlocks when level 1 is cleared.
 */
(function () {
  "use strict";

  /* ---------- tuning ---------- */

  const PROGRESS_KEY = "cease-desist-progress";
  const HOLES = 9;
  const QUARTER_SECS = 30; // a fiscal quarter; each one is a notch harder
  const DIFF_SECS = 210; // time until the main ramp tops out (level 1)
  const LATE_SECS = 270; // then a slower squeeze on top of it
  const STRUCK_SECS = 5; // how long an escaped troll locks a studio

  const SALE_BASE = 60; // a release left alone pays this, +15% per quarter
  const WRONGFUL_BRAND = 12;
  const WRONGFUL_CASH = 200;
  const QUARTER_BONUS_BRAND = 6;
  const SALE_BRAND = 1;

  // Level 2 (bar rush).
  const BAR_DIFF_SECS = 120;
  const MUG_SPEED = 1.6; // lane lengths per second
  const ROW_CD = 0.35; // seconds between two serves on the same bartop
  const BAR_LOCK_SECS = 4; // a troll's claim locks a bartop this long
  const FAN_PAY = 70; // a served fan pays this, +15% per quarter
  const FAN_UNSERVED_BRAND = 5;
  const CUST_SPEED = { fan: 1, pirate: 1.1, clone: 0.8, troll: 1 };

  // hp = whacks to take it down, base = payout at x1, fund = Legal Fund charge,
  // leakBrand/leakCash = what it costs you when it gets away with it.
  const KIND = {
    release: { threat: false, hp: 1, lifeMult: 1.1 },
    fan: { threat: false, hp: 1 },
    pirate: { threat: true, hp: 1, base: 100, fund: 12, leakBrand: 6, leakCash: 75, lifeMult: 1 },
    clone: { threat: true, hp: 2, base: 250, fund: 20, leakBrand: 9, leakCash: 150, lifeMult: 1.55 },
    troll: { threat: true, hp: 1, base: 175, fund: 14, leakBrand: 4, leakCash: 0, lifeMult: 0.85 },
  };

  // The campaign. Targets were set with throwaway bots (see CLAUDE.md).
  const LEVELS = [
    { id: 1, name: "Whack Row", target: 4000 },
    { id: 2, name: "Bar Rush", target: 8000 },
  ];

  const STUDIOS = ["Pixel Forge", "Moonlit", "Gnarly Bits", "Tidepool", "Brass Owl", "Nimbus", "Crumb Co.", "Vector Fox", "Hex & Co."];
  const ADJ = ["Neon", "Crimson", "Tiny", "Hollow", "Turbo", "Velvet", "Cosmic", "Grumpy", "Gilded", "Frozen", "Wobbly", "Midnight"];
  const NOUN = ["Quest", "Racers", "Kingdom", "Blaster", "Farm", "Heist", "Dungeon", "Pals", "Odyssey", "Tactics", "Siege", "Bakery"];
  const SITES = ["FreeGamez.biz", "CrackHub", "TorrentTown", "WarezWharf", "GameLeech", "0daySwap"];
  const CLONE_SUFFIX = ["Lite", "Clone", "Reborn", "Remix", "HD*", "Gold"];
  const TROLL_TAGS = ["BOGUS CLAIM", "DMCA SPAM", "FALSE STRIKE", "“MY LOGO!”"];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* ---------- models ---------- */

  // What both levels share: the bars, the combo, the Legal Fund, the win test.
  class Core {
    constructor(rng, opts) {
      this.rng = rng || Math.random;
      this.target = (opts && opts.target) || Infinity;
      this.reset();
    }

    resetCore() {
      this.t = 0;
      this.revenue = 0;
      this.brand = 100;
      this.combo = 0;
      this.fund = 0;
      this.over = false;
      this.won = false;
      this.lastQuarter = 1;
      this.spawnT = 0.9;
      this.events = [];
      this.stats = { caught: 0, wrongful: 0, leaks: 0, sales: 0, unserved: 0, classActions: 0, bestCombo: 0 };
    }

    pick(arr) {
      return arr[Math.floor(this.rng() * arr.length)];
    }

    quarter() {
      return 1 + Math.floor(this.t / QUARTER_SECS);
    }

    mult() {
      return Math.min(4, 1 + 0.5 * Math.floor(this.combo / 5));
    }

    emit(type, hole, kind, amount, x) {
      this.events.push({ type: type, hole: hole, kind: kind || null, amount: amount || 0, x: x === undefined ? 0.5 : x });
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }

    checkOver() {
      if (this.brand <= 0 && !this.over) {
        this.brand = 0;
        this.over = true;
        this.emit("over", -1);
      }
    }

    // Hitting the revenue goal ends the level as a win.
    checkWin() {
      if (!this.over && this.revenue >= this.target) {
        this.won = true;
        this.over = true;
        this.emit("win", -1);
      }
    }

    classReady() {
      return !this.over && this.fund >= 100;
    }
  }

  // Level 1: whack-a-mole over nine studio desks.
  class Shift extends Core {
    reset() {
      this.resetCore();
      this.holes = [];
      for (let i = 0; i < HOLES; i++) {
        this.holes.push({ state: "idle", kind: null, hp: 0, life: 0, maxLife: 1, cd: 0, timer: 0, title: "", tag: "", res: "" });
      }
    }

    diff() {
      return Math.min(1, this.t / DIFF_SECS);
    }

    // Past DIFF_SECS the ramp keeps going, slowly, so no run lasts forever.
    late() {
      return Math.min(1, Math.max(0, (this.t - DIFF_SECS) / LATE_SECS));
    }

    maxActive() {
      return 2 + Math.floor(this.diff() * 3) + (this.late() > 0.5 ? 1 : 0); // 2..6
    }

    pickKind() {
      const q = this.quarter();
      const w = [
        ["release", 0.3],
        ["pirate", 1],
        ["clone", q >= 2 ? 0.35 : 0],
        ["troll", q >= 3 ? 0.3 : 0],
      ];
      let sum = 0;
      for (const [, x] of w) sum += x;
      let r = this.rng() * sum;
      for (const [k, x] of w) {
        r -= x;
        if (r < 0) return k;
      }
      return "pirate";
    }

    spawn() {
      const free = [];
      let active = 0;
      this.holes.forEach((h, i) => {
        if (h.state === "up") active++;
        else if (h.state === "idle" && h.cd <= 0) free.push(i);
      });
      if (!free.length || active >= this.maxActive()) return;
      const i = this.pick(free);
      const h = this.holes[i];
      const kind = this.pickKind();
      const d = this.diff();
      h.state = "up";
      h.kind = kind;
      h.hp = KIND[kind].hp;
      h.res = "";
      h.maxLife = h.life = lerp(2.0, 0.9, d) * lerp(1, 0.62, this.late()) * KIND[kind].lifeMult;
      const title = this.pick(ADJ) + " " + this.pick(NOUN);
      h.title = title;
      if (kind === "pirate") h.tag = this.pick(SITES);
      else if (kind === "clone") h.tag = title + " " + this.pick(CLONE_SUFFIX);
      else if (kind === "troll") h.tag = this.pick(TROLL_TAGS);
      else h.tag = title;
      this.emit("spawn", i, kind);
    }

    step(dt) {
      if (this.over) return;
      this.t += dt;
      const q = this.quarter();
      if (q > this.lastQuarter) {
        this.lastQuarter = q;
        this.brand = Math.min(100, this.brand + QUARTER_BONUS_BRAND);
        this.emit("quarter", -1, null, q);
      }

      for (let i = 0; i < HOLES; i++) {
        const h = this.holes[i];
        if (h.state === "up") {
          h.life -= dt;
          if (h.life <= 0) this.leave(i);
        } else if (h.state === "hit" || h.state === "struck") {
          h.timer -= dt;
          if (h.timer <= 0) {
            h.state = "idle";
            h.kind = null;
            h.res = "";
            h.cd = 0.3;
          }
        } else if (h.cd > 0) {
          h.cd -= dt;
        }
        if (this.over) return;
      }

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawn();
        this.spawnT = lerp(1.05, 0.38, this.diff()) * lerp(1, 0.75, this.late()) * (0.7 + 0.6 * this.rng());
      }
    }

    // A mole's time ran out on its own.
    leave(i) {
      const h = this.holes[i];
      const kind = h.kind;
      const k = KIND[kind];
      if (!k.threat) {
        const amount = Math.round(SALE_BASE * (1 + 0.15 * (this.quarter() - 1)));
        this.revenue += amount;
        this.brand = Math.min(100, this.brand + SALE_BRAND);
        this.stats.sales++;
        h.state = "idle";
        h.kind = null;
        h.cd = 0.4;
        this.emit("sale", i, kind, amount);
        this.checkWin();
        return;
      }
      this.brand -= k.leakBrand;
      this.revenue = Math.max(0, this.revenue - k.leakCash);
      this.combo = 0;
      this.stats.leaks++;
      if (kind === "troll") {
        h.state = "struck";
        h.timer = STRUCK_SECS;
        h.res = "struck";
      } else {
        h.state = "idle";
        h.kind = null;
        h.cd = 0.4;
      }
      this.emit("escape", i, kind, k.leakBrand);
      this.checkOver();
    }

    kill(i, useCombo) {
      const h = this.holes[i];
      const k = KIND[h.kind];
      let amount = k.base;
      if (useCombo) {
        this.combo++;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
        amount = Math.round(k.base * this.mult());
      }
      this.revenue += amount;
      this.fund = Math.min(100, this.fund + k.fund);
      this.stats.caught++;
      const kind = h.kind;
      h.state = "hit";
      h.timer = 0.45;
      h.res = "kill";
      this.emit("kill", i, kind, amount);
      this.checkWin();
    }

    whack(i) {
      if (this.over) return;
      const h = this.holes[i];
      if (!h || h.state !== "up") {
        if (h && h.state === "idle") {
          this.combo = 0;
          this.emit("miss", i);
        }
        return;
      }
      if (!KIND[h.kind].threat) {
        this.brand -= WRONGFUL_BRAND;
        this.revenue = Math.max(0, this.revenue - WRONGFUL_CASH);
        this.combo = 0;
        this.stats.wrongful++;
        h.state = "hit";
        h.timer = 0.6;
        h.res = "wrong";
        this.emit("wrongful", i, h.kind, WRONGFUL_BRAND);
        this.checkOver();
        return;
      }
      h.hp--;
      if (h.hp > 0) {
        this.emit("crack", i, h.kind);
        return;
      }
      this.kill(i, true);
    }

    // Clears every threat on the board (releases are left alone). Returns how many.
    classAction() {
      if (!this.classReady()) return 0;
      let n = 0;
      for (let i = 0; i < HOLES; i++) {
        const h = this.holes[i];
        if (h.state === "up" && KIND[h.kind].threat) {
          this.kill(i, false);
          n++;
        }
      }
      this.fund = 0;
      this.stats.classActions++;
      this.emit("class", -1, null, n);
      return n;
    }
  }

  // Level 2: nine bartops. Customers (x: 0 = door .. 1 = counter) walk right;
  // mugs (x: 1 .. 0) slide left from the tap handle and hit the first one.
  class BarShift extends Core {
    reset() {
      this.resetCore();
      this.rows = [];
      for (let i = 0; i < HOLES; i++) this.rows.push({ cd: 0, lock: 0 });
      this.custs = [];
      this.mugs = [];
      this.nextId = 1;
    }

    diff() {
      return Math.min(1, this.t / BAR_DIFF_SECS);
    }

    maxCusts() {
      return 4 + Math.floor(this.diff() * 4); // 4..8
    }

    pickKind() {
      const w = [
        ["fan", 1.1],
        ["pirate", 0.8],
        ["clone", this.t >= 15 ? 0.3 : 0],
        ["troll", this.t >= 30 ? 0.25 : 0],
      ];
      let sum = 0;
      for (const [, x] of w) sum += x;
      let r = this.rng() * sum;
      for (const [k, x] of w) {
        r -= x;
        if (r < 0) return k;
      }
      return "fan";
    }

    spawn() {
      if (this.custs.length >= this.maxCusts()) return;
      const free = [];
      for (let i = 0; i < HOLES; i++) {
        if (!this.custs.some((c) => c.row === i && c.x < 0.16)) free.push(i);
      }
      if (!free.length) return;
      const kind = this.pickKind();
      const row = this.pick(free);
      const speed = lerp(0.13, 0.2, this.diff()) * CUST_SPEED[kind] * (0.9 + 0.2 * this.rng());
      this.custs.push({ id: this.nextId++, row: row, kind: kind, hp: KIND[kind].hp, maxHp: KIND[kind].hp, x: 0, speed: speed });
      this.emit("spawn", row, kind);
    }

    step(dt) {
      if (this.over) return;
      this.t += dt;
      const q = this.quarter();
      if (q > this.lastQuarter) {
        this.lastQuarter = q;
        this.brand = Math.min(100, this.brand + QUARTER_BONUS_BRAND);
        this.emit("quarter", -1, null, q);
      }
      for (const r of this.rows) {
        if (r.cd > 0) r.cd -= dt;
        if (r.lock > 0) r.lock -= dt;
      }

      // Customers walk to the counter.
      for (const c of this.custs.slice()) {
        c.x += c.speed * dt;
        if (c.x >= 1) {
          this.atCounter(c);
          if (this.over) return;
        }
      }

      // Mugs slide to the door; each one stops at the first customer it meets.
      for (const m of this.mugs.slice()) {
        const ox = m.x;
        const nx = ox - MUG_SPEED * dt;
        let hit = null;
        for (const c of this.custs) {
          if (c.row === m.row && c.x <= ox + 0.03 && c.x >= nx - 0.03 && (!hit || c.x > hit.x)) hit = c;
        }
        if (hit) {
          this.mugs.splice(this.mugs.indexOf(m), 1);
          this.served(hit);
          if (this.over) return;
        } else if (nx <= 0) {
          this.mugs.splice(this.mugs.indexOf(m), 1);
        } else {
          m.x = nx;
        }
      }

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawn();
        this.spawnT = lerp(0.95, 0.42, this.diff()) * (0.7 + 0.6 * this.rng());
      }
    }

    removeCust(c) {
      const i = this.custs.indexOf(c);
      if (i >= 0) this.custs.splice(i, 1);
    }

    // A threat got what it came for (a free copy, or the counter).
    leak(c, type) {
      const k = KIND[c.kind];
      this.brand -= k.leakBrand;
      this.revenue = Math.max(0, this.revenue - k.leakCash);
      this.combo = 0;
      this.stats.leaks++;
      if (c.kind === "troll") this.rows[c.row].lock = BAR_LOCK_SECS;
      this.removeCust(c);
      this.emit(type, c.row, c.kind, k.leakBrand, Math.min(1, c.x));
      this.checkOver();
    }

    atCounter(c) {
      if (KIND[c.kind].threat) {
        this.leak(c, "escape");
        return;
      }
      this.brand -= FAN_UNSERVED_BRAND;
      this.combo = 0;
      this.stats.unserved++;
      this.removeCust(c);
      this.emit("unserved", c.row, "fan", FAN_UNSERVED_BRAND, 1);
      this.checkOver();
    }

    // A mug reached customer c.
    served(c) {
      if (KIND[c.kind].threat) {
        this.leak(c, "steal"); // they pirated the copy you handed them
        return;
      }
      this.combo++;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      const amount = Math.round(FAN_PAY * (1 + 0.15 * (this.quarter() - 1)) * this.mult());
      this.revenue += amount;
      this.brand = Math.min(100, this.brand + SALE_BRAND);
      this.stats.sales++;
      this.removeCust(c);
      this.emit("sale", c.row, "fan", amount, c.x);
      this.checkWin();
    }

    // Tap on a bartop's tap handle: send a licensed copy down the bar.
    serve(row) {
      const r = this.rows[row];
      if (this.over || !r || r.cd > 0 || r.lock > 0) return false;
      r.cd = ROW_CD;
      this.mugs.push({ id: this.nextId++, row: row, x: 1 });
      this.emit("serve", row);
      return true;
    }

    frontCust(row) {
      let best = null;
      for (const c of this.custs) if (c.row === row && (!best || c.x > best.x)) best = c;
      return best;
    }

    // Tap on a customer: bounce a threat, or commit a wrongful takedown on a fan.
    whackCust(id) {
      if (this.over) return;
      const c = this.custs.find((x) => x.id === id);
      if (!c) return;
      if (!KIND[c.kind].threat) {
        this.brand -= WRONGFUL_BRAND;
        this.revenue = Math.max(0, this.revenue - WRONGFUL_CASH);
        this.combo = 0;
        this.stats.wrongful++;
        this.removeCust(c);
        this.emit("wrongful", c.row, "fan", WRONGFUL_BRAND, c.x);
        this.checkOver();
        return;
      }
      c.hp--;
      if (c.hp > 0) {
        this.emit("crack", c.row, c.kind, 0, c.x);
        return;
      }
      this.kill(c, true);
    }

    kill(c, useCombo) {
      const k = KIND[c.kind];
      let amount = k.base;
      if (useCombo) {
        this.combo++;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
        amount = Math.round(k.base * this.mult());
      }
      this.revenue += amount;
      this.fund = Math.min(100, this.fund + k.fund);
      this.stats.caught++;
      this.removeCust(c);
      this.emit("kill", c.row, c.kind, amount, c.x);
      this.checkWin();
    }

    classAction() {
      if (!this.classReady()) return 0;
      let n = 0;
      for (const c of this.custs.slice()) {
        if (KIND[c.kind].threat) {
          this.kill(c, false);
          n++;
        }
      }
      this.fund = 0;
      this.stats.classActions++;
      this.emit("class", -1, null, n);
      return n;
    }
  }

  /* ---------- view ---------- */

  const HTML =
    '<div class="cd-app">' +
    '<div class="cd-top">' +
    '<button class="cd-btn" data-act="menu" aria-label="Back to menu">≡</button>' +
    '<div class="cd-title">Cease &amp; Desist</div>' +
    '<div class="cd-chips">' +
    '<div class="cd-chip cd-chip--cash" id="cd-cash">$0</div>' +
    '<div class="cd-chip" id="cd-q">Q1</div>' +
    '<button class="cd-btn cd-btn--sm" data-act="mute" aria-label="Toggle sound">🔊</button>' +
    "</div></div>" +
    '<div class="cd-bar-row">' +
    '<div class="cd-bar-label">IP INTEGRITY</div>' +
    '<div class="cd-bar"><i id="cd-brand"></i></div>' +
    '<div class="cd-combo" id="cd-combo"></div>' +
    "</div>" +
    '<div class="cd-bar-row cd-bar-row--goal">' +
    '<div class="cd-bar-label cd-bar-label--goal">GOAL</div>' +
    '<div class="cd-bar cd-bar--goal"><i id="cd-goal"></i></div>' +
    '<div class="cd-combo cd-combo--goal" id="cd-goaltxt"></div>' +
    "</div>" +
    '<div class="cd-stagewrap"><div class="cd-board" id="cd-board"></div>' +
    '<div class="cd-panel" id="cd-panel"></div></div>' +
    '<div class="cd-foot">' +
    '<div class="cd-bar cd-bar--fund"><i id="cd-fund"></i><span>LEGAL FUND</span></div>' +
    '<button class="cd-class" id="cd-class" disabled>⚖️ CLASS ACTION</button>' +
    "</div></div>";

  const CSS = `
#cd-root{position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:manipulation;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#eef2ff;
background:radial-gradient(ellipse at 50% -10%,rgba(224,80,80,.22),transparent 60%),linear-gradient(180deg,#171a30 0%,#0e1020 60%,#07080f 100%);}
#cd-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
.cd-app{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:0 0 10px;}
.cd-top{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:rgba(5,6,12,.55);border-bottom:2px solid rgba(255,120,120,.25);}
.cd-btn{flex:0 0 auto;width:36px;height:36px;border-radius:10px;border:2px solid rgba(255,214,140,.6);background:rgba(255,255,255,.06);color:#ffe2a3;font-size:18px;cursor:pointer;}
.cd-btn--sm{width:32px;height:32px;font-size:15px;}
.cd-btn:active{transform:translateY(2px);}
.cd-title{font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(16px,4.4vw,24px);letter-spacing:.06em;white-space:nowrap;
background:linear-gradient(180deg,#fff0f0 0%,#ff9d8f 45%,#d9453a 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
.cd-chips{display:flex;gap:6px;align-items:center;}
.cd-chip{padding:5px 10px;border-radius:16px;border:2px solid rgba(255,214,140,.45);background:rgba(255,255,255,.06);font-weight:700;font-size:clamp(12px,3.3vw,15px);white-space:nowrap;font-variant-numeric:tabular-nums;}
.cd-chip--cash{color:#9bf0b4;border-color:rgba(120,240,160,.5);}
.cd-bar-row{width:min(94vw,520px);display:flex;align-items:center;gap:8px;margin-top:8px;position:relative;}
.cd-bar-row--goal{margin-top:5px;}
.cd-bar-label{font-size:11px;font-weight:800;letter-spacing:.12em;color:#ffb4a8;flex:0 0 auto;width:92px;}
.cd-bar-label--goal{color:#ffe08a;}
.cd-bar{position:relative;flex:1 1 auto;height:14px;border-radius:8px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.18);overflow:hidden;}
.cd-bar i{position:absolute;inset:0;transform-origin:left;transform:scaleX(1);background:linear-gradient(90deg,#3fd47a,#9bef6a);transition:transform .2s ease;}
.cd-bar--goal{height:10px;}
.cd-bar--goal i{transform:scaleX(0);background:linear-gradient(90deg,#f0b94a,#ffe08a);}
.cd-bar.cd-low i{background:linear-gradient(90deg,#e63a3a,#ff8a5a);}
.cd-bar.cd-low{animation:cd-pulse .6s infinite;}
@keyframes cd-pulse{50%{border-color:#ff6b5a;}}
.cd-combo{flex:0 0 auto;min-width:64px;text-align:right;font-weight:800;font-size:14px;color:#ffd96b;font-variant-numeric:tabular-nums;}
.cd-combo--goal{font-size:12px;color:#ffe08a;}
.cd-stagewrap{position:relative;margin-top:10px;width:min(94vw,520px);width:min(94vw,520px,calc(100vh - 280px));width:min(94vw,520px,calc(100dvh - 280px));min-width:240px;aspect-ratio:1;flex:0 0 auto;}
.cd-board{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:2.5%;}
.cd-hole{position:relative;border:0;padding:0;border-radius:14px;cursor:pointer;color:inherit;font:inherit;overflow:hidden;
background:linear-gradient(180deg,#2c3354 0%,#1b2038 70%,#12152a 100%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.08),0 4px 0 rgba(0,0,0,.4);}
.cd-hole[data-state=struck]{background:linear-gradient(180deg,#4a2a2a,#2a1515);}
.cd-stage{position:absolute;left:0;right:0;top:0;bottom:24%;overflow:hidden;}
.cd-mole{position:absolute;left:8%;right:8%;bottom:-6%;top:12%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:14px 14px 4px 4px;
transform:translateY(110%);transition:transform .14s cubic-bezier(.2,1.4,.4,1);padding:3px;min-width:0;}
.cd-hole[data-state=up] .cd-mole{transform:translateY(0);}
.cd-hole[data-state=hit] .cd-mole{transform:translateY(60%) rotate(-6deg);filter:grayscale(.8) brightness(.8);transition:transform .25s ease;}
.cd-emo{font-size:clamp(26px,9vw,52px);line-height:1;}
.cd-tag{max-width:100%;padding:0 4px;font-size:clamp(8px,2.3vw,12px);font-weight:800;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cd-k-pirate{background:linear-gradient(180deg,#3a3f52,#1c2030);border:2px solid #8a93b5;color:#e6ebff;}
.cd-k-clone{background:linear-gradient(180deg,#8a5a2a,#4a2c10);border:2px solid #ffb35a;color:#ffe9c8;}
.cd-k-troll{background:linear-gradient(180deg,#6a3a8a,#34174d);border:2px solid #d79bff;color:#f6e6ff;}
.cd-k-release{background:linear-gradient(180deg,#2c9a5a,#0f5a30);border:2px solid #8bf0b0;color:#eafff2;}
.cd-k-clone.cd-cracked{filter:saturate(1.6);animation:cd-wob .18s 2;}
@keyframes cd-wob{25%{rotate:-6deg}75%{rotate:6deg}}
.cd-rim{position:absolute;left:0;right:0;bottom:0;height:30%;background:linear-gradient(180deg,#0a0c18,#171b30);border-top:3px solid #3a4268;}
.cd-name{position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:clamp(8px,2.4vw,12px);font-weight:700;color:#a9b2d9;letter-spacing:.04em;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 3px;}
.cd-life{position:absolute;left:8%;right:8%;bottom:26%;height:4px;border-radius:2px;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;}
.cd-life i{display:block;height:100%;border-radius:2px;background:#ffd96b;transform-origin:left;}
.cd-hole[data-state=up] .cd-life{opacity:1;}
.cd-stamp{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) rotate(-12deg) scale(0);padding:2px 8px;border:3px solid #ff4a4a;border-radius:6px;color:#ff4a4a;font-weight:900;font-size:clamp(10px,3.1vw,16px);letter-spacing:.06em;white-space:nowrap;pointer-events:none;background:rgba(0,0,0,.35);}
.cd-hole[data-res=kill] .cd-stamp,.cd-hole[data-res=wrong] .cd-stamp,.cd-hole[data-res=struck] .cd-stamp{animation:cd-stampin .2s forwards;}
.cd-hole[data-res=wrong] .cd-stamp{color:#ffb84a;border-color:#ffb84a;}
.cd-hole[data-res=struck] .cd-stamp{color:#ff7a7a;border-color:#ff7a7a;}
@keyframes cd-stampin{0%{transform:translate(-50%,-50%) rotate(-12deg) scale(2.2);opacity:0}100%{transform:translate(-50%,-50%) rotate(-12deg) scale(1);opacity:1}}
.cd-float{position:absolute;z-index:5;transform:translate(-50%,0);font-weight:900;font-size:clamp(13px,4vw,20px);white-space:nowrap;pointer-events:none;text-shadow:0 2px 0 rgba(0,0,0,.7);animation:cd-rise .9s ease-out forwards;}
@keyframes cd-rise{0%{opacity:0;margin-top:0}15%{opacity:1}100%{opacity:0;margin-top:-52px}}
.cd-float--good{color:#9bf0b4}.cd-float--bad{color:#ff8a7a}.cd-float--gold{color:#ffd96b}
/* level 2: nine bartops */
#cd-root.cd-lv2 .cd-stagewrap{aspect-ratio:auto;width:min(94vw,520px);height:min(calc(100vh - 280px),620px);height:min(calc(100dvh - 280px),620px);min-height:340px;}
.cd-board.cd-bars{display:flex;flex-direction:column;gap:3px;}
.cd-row{position:relative;flex:1 1 0;min-height:0;border-radius:8px;overflow:hidden;
background:linear-gradient(180deg,#9a6532 0%,#6e4521 55%,#4a2c14 100%);box-shadow:inset 0 2px 0 rgba(255,225,170,.4),inset 0 -3px 0 rgba(0,0,0,.4);}
.cd-lane{position:absolute;left:0;top:0;bottom:0;right:25%;}
.cd-lane::before{content:'';position:absolute;left:0;top:0;bottom:0;width:7px;background:linear-gradient(90deg,#120a1a,#2a1838);}
.cd-tap{position:absolute;right:0;top:0;bottom:0;width:25%;border:0;border-left:3px solid #2a1808;padding:0 7px;display:flex;align-items:center;justify-content:space-between;gap:2px;
background:linear-gradient(180deg,#4a3470,#2a1a46);color:#efe6ff;font:inherit;cursor:pointer;}
.cd-tap:active{filter:brightness(1.5);}
.cd-tapname{min-width:0;font-size:clamp(8px,2.3vw,11px);font-weight:800;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cd-tapicon{flex:0 0 auto;font-size:clamp(16px,5vw,24px);line-height:1;}
.cd-row[data-cd="1"] .cd-tap{filter:brightness(.7);}
.cd-row[data-lock="1"] .cd-tap{background:linear-gradient(180deg,#6a2a2a,#3a1212);}
.cd-row[data-lock="1"] .cd-tapicon{display:none;}
.cd-row[data-lock="1"] .cd-tapname::after{content:' ⛔ CLAIMED';color:#ff9a9a;}
.cd-cust{position:absolute;top:7%;bottom:7%;width:clamp(36px,11vw,50px);transform:translateX(-50%);display:flex;align-items:center;justify-content:center;border-radius:12px;}
.cd-cust .cd-emo{font-size:clamp(20px,6.4vw,30px);animation:cd-bob .45s ease-in-out infinite alternate;pointer-events:none;}
.cd-cust.cd-k-release::after{content:'🎮';position:absolute;top:-3px;right:-5px;font-size:12px;pointer-events:none;}
@keyframes cd-bob{to{transform:translateY(-2px);}}
.cd-mug{position:absolute;top:50%;transform:translate(-50%,-50%);font-size:clamp(16px,5vw,22px);line-height:1;pointer-events:none;filter:drop-shadow(0 2px 0 rgba(0,0,0,.4));}
.cd-foot{width:min(94vw,520px);margin-top:12px;display:flex;align-items:center;gap:10px;}
.cd-bar--fund{height:26px;flex:1 1 auto;}
.cd-bar--fund i{transform:scaleX(0);background:linear-gradient(90deg,#4aa0ff,#a58bff);}
.cd-bar--fund span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.14em;text-shadow:0 1px 2px #000;}
.cd-class{flex:0 0 auto;height:40px;padding:0 12px;border-radius:12px;border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#8890b8;font-weight:900;font-size:13px;letter-spacing:.04em;cursor:pointer;}
.cd-class:not(:disabled){color:#fff;border-color:#a58bff;background:linear-gradient(180deg,#7a5aff,#4a2ad0);animation:cd-glow .8s infinite;}
@keyframes cd-glow{50%{box-shadow:0 0 18px 4px rgba(165,139,255,.7);}}
.cd-panel{position:absolute;inset:-4px;z-index:10;display:none;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:16px;text-align:center;border-radius:16px;background:rgba(7,8,16,.92);border:2px solid rgba(255,120,120,.35);overflow:auto;}
.cd-panel.cd-show{display:flex;}
.cd-panel>:first-child{margin-top:auto;}
.cd-panel>:last-child{margin-bottom:auto;}
.cd-btnrow{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.cd-panel h2{margin:0;font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(22px,6.5vw,34px);color:#ff9d8f;letter-spacing:.04em;}
.cd-panel h2.cd-win{color:#9bf0b4;}
.cd-panel p{margin:0;font-size:clamp(12px,3.4vw,15px);line-height:1.35;color:#c9d0f0;max-width:340px;}
.cd-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;text-align:left;font-size:clamp(12px,3.4vw,14px);color:#dfe4ff;max-width:340px;}
.cd-legend li{padding-left:2em;position:relative;}
.cd-legend b{position:absolute;left:0;top:0;width:1.7em;text-align:center;}
.cd-stats{display:grid;grid-template-columns:auto auto;gap:3px 16px;font-size:clamp(12px,3.4vw,15px);text-align:left;font-variant-numeric:tabular-nums;}
.cd-stats span:nth-child(odd){color:#9aa3cf}.cd-stats span:nth-child(even){font-weight:800;text-align:right}
.cd-go{padding:10px 22px;border-radius:14px;border:2px solid #ffb4a8;background:linear-gradient(180deg,#e8554a,#a82a22);color:#fff;font-weight:900;font-size:16px;letter-spacing:.06em;cursor:pointer;}
.cd-go--alt{background:rgba(255,255,255,.07);border-color:rgba(255,214,140,.5);color:#ffe2a3;font-size:13px;padding:7px 16px;}
.cd-go:active{transform:translateY(2px);}
.cd-lvls{display:flex;flex-direction:column;gap:8px;width:min(100%,320px);}
.cd-lvl{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 14px;border-radius:14px;border:2px solid #ffb4a8;background:linear-gradient(180deg,#3a2230,#241420);color:#fff;font:inherit;text-align:left;cursor:pointer;}
.cd-lvl b{font-size:clamp(14px,4vw,17px);letter-spacing:.03em;}
.cd-lvl small{font-size:clamp(11px,3vw,13px);color:#c9d0f0;}
.cd-lvl:disabled{opacity:.5;border-color:rgba(255,255,255,.25);cursor:default;}
.cd-lvl:not(:disabled):active{transform:translateY(2px);}
.cd-newbest{color:#ffd96b;font-weight:900;}
#cd-root.cd-shake .cd-stagewrap{animation:cd-shake .3s;}
@keyframes cd-shake{20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@media(max-height:660px){.cd-top{padding:6px 12px;}.cd-bar-row,.cd-stagewrap{margin-top:5px;}.cd-foot{margin-top:6px;}.cd-legend{font-size:12px;gap:3px;}.cd-panel{gap:6px;padding:8px;}}
@media(prefers-reduced-motion:reduce){#cd-root.cd-shake .cd-stagewrap{animation:none;}.cd-class:not(:disabled){animation:none;}.cd-cust .cd-emo{animation:none;}}
`;

  const KEYS = { q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 };
  const EMOJI = { release: "🎮", pirate: "🏴‍☠️", clone: "👯", troll: "⚖️" };
  const FACES = ["🙂", "😄", "😎", "🧑", "👩", "👨", "🧒", "😊"];

  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      if (p && p.cleared && p.best) return p;
    } catch (e) {}
    return { cleared: {}, best: {} };
  }

  function saveProgress(p) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch (e) {}
  }

  function money(n) {
    return "$" + n.toLocaleString("en-US");
  }

  function clock(secs) {
    const s = Math.floor(secs);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  class CeaseDesist {
    constructor(root, opts) {
      this.root = root;
      this.level = (opts && opts.level) || 1;
      this.unlocked = !!(opts && opts.level); // a direct launch skips the unlock gate
      this.model = new Shift(null, { target: LEVELS[0].target });
      this.mode = "title";
      this.progress = loadProgress();
      this.timers = [];
      this.muted = false;
      this.audio = null;
      this.dead = false;
      this.sigs = [];
      this.cache = {};
      this.holeEls = [];
      this.rowEls = [];
      this.custEls = new Map();
      this.mugEls = new Map();
      this.el = {
        board: root.querySelector("#cd-board"),
        panel: root.querySelector("#cd-panel"),
        cash: root.querySelector("#cd-cash"),
        q: root.querySelector("#cd-q"),
        brand: root.querySelector("#cd-brand"),
        brandBar: root.querySelector("#cd-brand").parentNode,
        goal: root.querySelector("#cd-goal"),
        goalTxt: root.querySelector("#cd-goaltxt"),
        combo: root.querySelector("#cd-combo"),
        fund: root.querySelector("#cd-fund"),
        cls: root.querySelector("#cd-class"),
        mute: root.querySelector('[data-act="mute"]'),
      };

      this.buildBoard();

      this.onDown = (e) => {
        if (this.mode !== "play") return;
        const t = e.target;
        if (!t.closest) return;
        if (this.level === 1) {
          const h = t.closest(".cd-hole");
          if (!h) return;
          e.preventDefault();
          this.ensureAudio();
          this.model.whack(Number(h.dataset.i));
        } else {
          const c = t.closest(".cd-cust");
          const z = c ? null : t.closest(".cd-tap");
          if (!c && !z) return;
          e.preventDefault();
          this.ensureAudio();
          if (c) this.model.whackCust(Number(c.dataset.id));
          else this.model.serve(Number(z.dataset.row));
        }
        this.drain();
      };
      this.el.board.addEventListener("pointerdown", this.onDown);

      root.querySelector('[data-act="menu"]').addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
      this.el.mute.addEventListener("click", () => {
        this.muted = !this.muted;
        this.el.mute.textContent = this.muted ? "🔇" : "🔊";
      });
      this.el.cls.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.fireClass();
      });
      this.onKey = (e) => {
        const k = e.key.toLowerCase();
        if (this.mode === "play") {
          if (k in KEYS) {
            this.ensureAudio();
            const i = KEYS[k];
            if (this.level === 1) this.model.whack(i);
            else if (e.shiftKey) {
              const c = this.model.frontCust(i);
              if (c) this.model.whackCust(c.id);
            } else this.model.serve(i);
            this.drain();
          } else if (k === " ") {
            e.preventDefault();
            this.fireClass();
          }
        }
      };
      window.addEventListener("keydown", this.onKey);

      if (opts && opts.level) this.start(this.level);
      else this.showTitle();
      this.last = performance.now();
      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
    }

    later(fn, ms) {
      const id = setTimeout(() => {
        this.timers = this.timers.filter((x) => x !== id);
        fn();
      }, ms);
      this.timers.push(id);
    }

    /* --- board --- */

    buildBoard() {
      const board = this.el.board;
      board.innerHTML = "";
      this.holeEls = [];
      this.rowEls = [];
      this.sigs = [];
      this.custEls.clear();
      this.mugEls.clear();
      const bars = this.level === 2;
      this.root.classList.toggle("cd-lv2", bars);
      board.classList.toggle("cd-bars", bars);
      for (let i = 0; i < HOLES; i++) {
        if (!bars) {
          const b = document.createElement("button");
          b.className = "cd-hole";
          b.type = "button";
          b.dataset.i = String(i);
          b.dataset.state = "idle";
          b.setAttribute("aria-label", STUDIOS[i]);
          b.innerHTML =
            '<span class="cd-stage"><span class="cd-mole"><span class="cd-emo"></span><span class="cd-tag"></span></span></span>' +
            '<span class="cd-life"><i></i></span><span class="cd-rim"></span><span class="cd-stamp"></span>' +
            '<span class="cd-name">' + STUDIOS[i] + "</span>";
          board.appendChild(b);
          this.holeEls.push({
            btn: b,
            mole: b.querySelector(".cd-mole"),
            emo: b.querySelector(".cd-emo"),
            tag: b.querySelector(".cd-tag"),
            life: b.querySelector(".cd-life i"),
            stamp: b.querySelector(".cd-stamp"),
          });
          this.sigs.push("");
        } else {
          const r = document.createElement("div");
          r.className = "cd-row";
          r.dataset.cd = "0";
          r.dataset.lock = "0";
          r.innerHTML =
            '<div class="cd-lane"></div>' +
            '<button class="cd-tap" type="button" data-row="' + i + '" aria-label="Serve a copy at ' + STUDIOS[i] + '">' +
            '<span class="cd-tapname">' + STUDIOS[i] + '</span><span class="cd-tapicon">🍺</span></button>';
          board.appendChild(r);
          this.rowEls.push({ row: r, lane: r.querySelector(".cd-lane") });
        }
      }
    }

    /* --- screens --- */

    showPanel(html) {
      this.el.panel.innerHTML = html;
      this.el.panel.classList.add("cd-show");
      this.el.panel.querySelectorAll("[data-go]").forEach((b) => {
        b.addEventListener("click", () => {
          const lvl = Number(b.dataset.lvl) || this.level;
          switch (b.dataset.go) {
            case "menu":
              if (typeof window.returnToMenu === "function") window.returnToMenu();
              break;
            case "title": this.showTitle(); break;
            case "brief": this.showBrief(lvl); break;
            case "play": this.start(lvl); break;
            case "retry": this.start(this.level); break;
            case "next": this.showBrief(Math.min(LEVELS.length, this.level + 1)); break;
          }
        });
      });
    }

    hidePanel() {
      this.el.panel.classList.remove("cd-show");
    }

    isUnlocked(id) {
      return this.unlocked || id === 1 || !!this.progress.cleared[id - 1];
    }

    // A fresh, idle board for a level, so nothing stale shows behind a panel.
    prep(level) {
      this.level = level;
      const L = LEVELS[level - 1];
      this.model = level === 1 ? new Shift(null, { target: L.target }) : new BarShift(null, { target: L.target });
      this.cache = {};
      this.buildBoard();
    }

    showTitle() {
      this.mode = "title";
      this.prep(1);
      const cards = LEVELS.map((L) => {
        const open = this.isUnlocked(L.id);
        const best = this.progress.best[L.id];
        const sub = open
          ? "Goal " + money(L.target) + (best !== undefined ? " · best " + clock(best) : "")
          : "🔒 Clear Level " + (L.id - 1) + " to unlock";
        return '<button class="cd-lvl" data-go="brief" data-lvl="' + L.id + '"' + (open ? "" : " disabled") + "><b>Level " + L.id + " · " + L.name + "</b><small>" + sub + "</small></button>";
      }).join("");
      this.showPanel(
        "<h2>Cease &amp; Desist</h2>" +
          "<p>You're the legal desk of a publisher with nine studios. Protect the IP.</p>" +
          '<div class="cd-lvls">' + cards + "</div>" +
          "<p>Keys: Q W E / A S D / Z X C (Shift = bounce in Level 2), Space = class action</p>"
      );
    }

    showBrief(level) {
      this.mode = "title";
      this.prep(level);
      const L = LEVELS[level - 1];
      let legend;
      let blurb;
      if (level === 1) {
        blurb = "Whack the threats as they pop out of the studios' desks. Reach " + money(L.target) + " before your brand runs out.";
        legend =
          "<li><b>" + EMOJI.pirate + "</b>Pirate — tap it before it leaks</li>" +
          "<li><b>" + EMOJI.clone + "</b>Knockoff — takes two hits</li>" +
          "<li><b>" + EMOJI.troll + "</b>Copyright troll — stop it or it locks a studio</li>" +
          "<li><b>" + EMOJI.release + "</b>Your studios' releases — <u>don't touch</u>, they pay you</li>";
      } else {
        blurb = "Every studio is a bartop. Serve the fans, bounce the rest. Reach " + money(L.target) + ".";
        legend =
          "<li><b>🍺</b>Tap a bartop's tap handle (right) to slide a licensed copy down it</li>" +
          "<li><b>🙂</b>Fan — serve them. Tapping a fan is a wrongful takedown</li>" +
          "<li><b>" + EMOJI.pirate + "</b>Pirate — <u>don't serve</u>! Tap it to bounce it</li>" +
          "<li><b>" + EMOJI.clone + "</b>Knockoff — two bounces</li>" +
          "<li><b>" + EMOJI.troll + "</b>Troll — locks the bartop if it gets served or reaches the counter</li>";
      }
      const best = this.progress.best[level];
      this.showPanel(
        "<h2>Level " + level + " · " + L.name + "</h2><p>" + blurb + "</p>" +
          '<ul class="cd-legend">' + legend + "</ul>" +
          '<button class="cd-go" data-go="play" data-lvl="' + level + '">START SHIFT</button>' +
          '<button class="cd-go cd-go--alt" data-go="title">◂ Levels</button>' +
          (best !== undefined ? "<p>Best clear: " + clock(best) + "</p>" : "")
      );
    }

    start(level) {
      this.ensureAudio();
      this.prep(level);
      this.mode = "play";
      this.hidePanel();
      this.last = performance.now();
    }

    statsHtml(m, compact) {
      const L = LEVELS[this.level - 1];
      if (compact) {
        return (
          '<div class="cd-stats">' +
          "<span>Revenue</span><span>" + money(m.revenue) + "</span>" +
          "<span>Time</span><span>" + clock(m.t) + "</span>" +
          "<span>Best combo</span><span>" + m.stats.bestCombo + "</span>" +
          "</div>"
        );
      }
      return (
        '<div class="cd-stats">' +
        "<span>Revenue</span><span>" + money(m.revenue) + " / " + money(L.target) + "</span>" +
        "<span>Time</span><span>" + clock(m.t) + "</span>" +
        "<span>Threats taken down</span><span>" + m.stats.caught + "</span>" +
        "<span>" + (this.level === 1 ? "Releases shipped" : "Fans served") + "</span><span>" + m.stats.sales + "</span>" +
        "<span>Wrongful takedowns</span><span>" + m.stats.wrongful + "</span>" +
        "<span>Leaks</span><span>" + m.stats.leaks + "</span>" +
        (this.level === 2 ? "<span>Fans left unserved</span><span>" + m.stats.unserved + "</span>" : "") +
        "<span>Best combo</span><span>" + m.stats.bestCombo + "</span>" +
        "</div>"
      );
    }

    levelCleared() {
      this.mode = "cleared";
      const m = this.model;
      const level = this.level;
      const secs = Math.round(m.t * 10) / 10;
      const prev = this.progress.best[level];
      const isBest = prev === undefined || secs < prev;
      this.progress.cleared[level] = true;
      if (isBest) this.progress.best[level] = secs;
      saveProgress(this.progress);
      const last = level >= LEVELS.length;
      this.sfx("win");
      this.later(() => {
        if (this.dead) return;
        this.showPanel(
          '<h2 class="cd-win">Level ' + level + " Cleared!</h2>" +
            (last ? "<p>Campaign complete. The IP is safe, the board is thrilled.</p>" : "") +
            this.statsHtml(m, true) +
            (isBest ? '<div class="cd-newbest">★ New best time ★</div>' : "") +
            (last
              ? '<button class="cd-go" data-go="retry">PLAY AGAIN</button>'
              : '<button class="cd-go" data-go="next">NEXT: ' + LEVELS[level].name.toUpperCase() + " ▶</button>") +
            '<div class="cd-btnrow">' +
            (last ? "" : '<button class="cd-go cd-go--alt" data-go="retry">Replay</button>') +
            '<button class="cd-go cd-go--alt" data-go="title">Levels</button>' +
            '<button class="cd-go cd-go--alt" data-go="menu">Menu</button></div>'
        );
      }, 700);
    }

    gameOver() {
      this.mode = "over";
      const m = this.model;
      const why =
        m.stats.wrongful >= m.stats.leaks + m.stats.unserved
          ? "The board fired you for suing your own customers."
          : "Piracy ate the catalogue. The board is pivoting to mobile.";
      this.sfx("over");
      this.later(() => {
        if (this.dead) return;
        this.showPanel(
          "<h2>Brand Bankrupt</h2><p>" + why + "</p>" +
            this.statsHtml(m) +
            '<button class="cd-go" data-go="retry">TRY AGAIN</button>' +
            '<div class="cd-btnrow"><button class="cd-go cd-go--alt" data-go="title">Levels</button>' +
            '<button class="cd-go cd-go--alt" data-go="menu">Fantasia Menu</button></div>'
        );
      }, 700);
    }

    fireClass() {
      if (this.mode !== "play") return;
      this.ensureAudio();
      this.model.classAction();
      this.drain();
    }

    /* --- events, fx --- */

    drain() {
      const evs = this.model.drainEvents();
      for (const ev of evs) {
        switch (ev.type) {
          case "spawn":
            this.sfx("spawn", ev.kind);
            break;
          case "serve":
            this.sfx("serve");
            break;
          case "kill":
            this.float(ev.hole, "+" + money(ev.amount), "gold", ev.x);
            this.sfx("kill");
            break;
          case "crack":
            if (this.level === 1) this.holeEls[ev.hole].mole.classList.add("cd-cracked");
            this.float(ev.hole, "C&D served!", "good", ev.x);
            this.sfx("crack");
            break;
          case "wrongful":
            this.float(ev.hole, "WRONGFUL! -" + ev.amount, "bad", ev.x);
            this.shake();
            this.sfx("bad");
            break;
          case "escape":
            this.float(ev.hole, ev.kind === "troll" ? "STUDIO LOCKED" : "LEAKED! -" + ev.amount, "bad", ev.x);
            this.shake();
            this.sfx("bad");
            break;
          case "steal":
            this.float(ev.hole, ev.kind === "troll" ? "CLAIMED!" : "PIRATED! -" + ev.amount, "bad", ev.x);
            this.shake();
            this.sfx("bad");
            break;
          case "unserved":
            this.float(ev.hole, "UNSERVED -" + ev.amount, "bad", ev.x);
            this.sfx("bad");
            break;
          case "sale":
            this.float(ev.hole, "SALE +" + money(ev.amount), "good", ev.x);
            this.sfx("sale");
            break;
          case "quarter":
            this.float(4, "QUARTER " + ev.amount + "!", "gold", 0.5);
            this.sfx("sale");
            break;
          case "class":
            this.float(4, "CLASS ACTION! ×" + ev.amount, "gold", 0.5);
            this.sfx("class");
            this.shake();
            break;
          case "miss":
            break;
          case "win":
            this.levelCleared();
            break;
          case "over":
            this.gameOver();
            break;
        }
      }
    }

    float(i, text, cls, x) {
      let left;
      let top;
      if (this.level === 2) {
        const r = this.rowEls[i];
        if (!r) return;
        left = r.row.offsetLeft + r.lane.offsetWidth * Math.min(1, Math.max(0.12, x));
        top = r.row.offsetTop;
      } else {
        const b = this.holeEls[i].btn;
        left = b.offsetLeft + b.offsetWidth / 2;
        top = b.offsetTop + b.offsetHeight * 0.25;
      }
      const el = document.createElement("div");
      el.className = "cd-float cd-float--" + cls;
      el.textContent = text;
      el.style.left = left + "px";
      el.style.top = top + "px";
      this.el.board.appendChild(el);
      this.later(() => el.remove(), 950);
    }

    shake() {
      this.root.classList.remove("cd-shake");
      void this.root.offsetWidth;
      this.root.classList.add("cd-shake");
      this.later(() => this.root.classList.remove("cd-shake"), 350);
    }

    /* --- audio --- */

    ensureAudio() {
      if (this.audio || this.muted) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.audio = new AC();
      } catch (e) {}
    }

    tone(f, dur, type, vol, slide, delay) {
      const a = this.audio;
      if (!a || this.muted) return;
      const t0 = a.currentTime + (delay || 0);
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t0 + dur);
      g.gain.setValueAtTime(vol || 0.05, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    sfx(name, kind) {
      switch (name) {
        case "kill": this.tone(420, 0.12, "square", 0.06, 2.2); break;
        case "crack": this.tone(240, 0.06, "square", 0.05); break;
        case "bad": this.tone(180, 0.28, "sawtooth", 0.06, 0.4); break;
        case "sale": this.tone(880, 0.09, "triangle", 0.06); this.tone(1320, 0.14, "triangle", 0.06, 1, 0.08); break;
        case "class": this.tone(200, 0.5, "sawtooth", 0.07, 5); this.tone(600, 0.4, "triangle", 0.06, 2, 0.1); break;
        case "serve": this.tone(300, 0.07, "triangle", 0.04, 1.8); break;
        case "spawn": if (kind !== "release" && kind !== "fan") this.tone(kind === "troll" ? 330 : 520, 0.04, "sine", 0.025); break;
        case "win": [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "triangle", 0.06, 1, i * 0.12)); break;
        case "over": this.tone(300, 0.9, "sawtooth", 0.07, 0.25); break;
      }
    }

    /* --- loop --- */

    frame(now) {
      if (this.dead) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.mode === "play") {
        this.model.step(dt);
        this.drain();
      }
      this.sync();
      this.raf = requestAnimationFrame(this.frame);
    }

    sync() {
      const m = this.model;
      const c = this.cache;
      if (this.level === 1) this.syncHoles(m);
      else this.syncBars(m);

      if (c.rev !== m.revenue) {
        c.rev = m.revenue;
        this.el.cash.textContent = money(m.revenue);
        const tgt = m.target;
        this.el.goal.style.transform = "scaleX(" + Math.min(1, m.revenue / tgt).toFixed(3) + ")";
        this.el.goalTxt.textContent = money(tgt);
      }
      const q = "Q" + m.quarter() + " · " + clock(m.t);
      if (c.q !== q) {
        c.q = q;
        this.el.q.textContent = q;
      }
      const b = Math.max(0, m.brand);
      if (c.b !== b) {
        c.b = b;
        this.el.brand.style.transform = "scaleX(" + b / 100 + ")";
        this.el.brandBar.classList.toggle("cd-low", b <= 30);
      }
      const cmb = m.combo >= 2 ? "×" + m.mult().toFixed(1) + " · " + m.combo : "";
      if (c.cmb !== cmb) {
        c.cmb = cmb;
        this.el.combo.textContent = cmb;
      }
      if (c.f !== m.fund) {
        c.f = m.fund;
        this.el.fund.style.transform = "scaleX(" + m.fund / 100 + ")";
      }
      const ready = m.classReady() && this.mode === "play";
      if (c.r !== ready) {
        c.r = ready;
        this.el.cls.disabled = !ready;
      }
    }

    syncHoles(m) {
      for (let i = 0; i < HOLES; i++) {
        const h = m.holes[i];
        const v = this.holeEls[i];
        if (!v) return;
        const sig = h.state + "|" + h.kind + "|" + h.tag + "|" + h.res;
        if (sig !== this.sigs[i]) {
          this.sigs[i] = sig;
          v.btn.dataset.state = h.state;
          v.btn.dataset.res = h.res;
          if (h.kind) {
            v.mole.className = "cd-mole cd-k-" + h.kind;
            v.emo.textContent = EMOJI[h.kind];
            v.tag.textContent = h.tag;
          }
          const stamp = h.res === "kill" ? "TAKEN DOWN" : h.res === "wrong" ? "OOPS!" : h.res === "struck" ? "⛔ CLAIMED" : "";
          v.stamp.textContent = stamp;
          // restart the stamp animation each time
          v.stamp.style.animation = "none";
          void v.stamp.offsetWidth;
          v.stamp.style.animation = "";
        }
        if (h.state === "up") v.life.style.transform = "scaleX(" + Math.max(0, h.life / h.maxLife).toFixed(3) + ")";
      }
    }

    syncBars(m) {
      for (let i = 0; i < HOLES; i++) {
        const r = this.rowEls[i];
        if (!r) return;
        const cd = m.rows[i].cd > 0 ? "1" : "0";
        const lock = m.rows[i].lock > 0 ? "1" : "0";
        if (r.row.dataset.cd !== cd) r.row.dataset.cd = cd;
        if (r.row.dataset.lock !== lock) r.row.dataset.lock = lock;
      }
      const seen = new Set();
      for (const cu of m.custs) {
        seen.add(cu.id);
        let el = this.custEls.get(cu.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "cd-cust cd-k-" + (cu.kind === "fan" ? "release" : cu.kind);
          el.dataset.id = String(cu.id);
          el.innerHTML = '<span class="cd-emo">' + (cu.kind === "fan" ? FACES[cu.id % FACES.length] : EMOJI[cu.kind]) + "</span>";
          this.rowEls[cu.row].lane.appendChild(el);
          this.custEls.set(cu.id, el);
        }
        el.style.left = (cu.x * 100).toFixed(2) + "%";
        if (cu.hp < cu.maxHp && !el.classList.contains("cd-cracked")) el.classList.add("cd-cracked");
      }
      for (const [id, el] of this.custEls) {
        if (!seen.has(id)) {
          el.remove();
          this.custEls.delete(id);
        }
      }
      const seenM = new Set();
      for (const mg of m.mugs) {
        seenM.add(mg.id);
        let el = this.mugEls.get(mg.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "cd-mug";
          el.textContent = "🍺";
          this.rowEls[mg.row].lane.appendChild(el);
          this.mugEls.set(mg.id, el);
        }
        el.style.left = (mg.x * 100).toFixed(2) + "%";
      }
      for (const [id, el] of this.mugEls) {
        if (!seenM.has(id)) {
          el.remove();
          this.mugEls.delete(id);
        }
      }
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      window.removeEventListener("keydown", this.onKey);
      if (this.audio) {
        try {
          this.audio.close();
        } catch (e) {}
      }
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("cd-style")) return;
    const s = document.createElement("style");
    s.id = "cd-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // opts.level (1 or 2) skips the title and starts that level (tests, tools).
  function launchCeaseDesist(opts) {
    if (window.ceaseDesistGame) return window.ceaseDesistGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "cd-root";
    root.innerHTML = HTML;
    document.getElementById("game-container").appendChild(root);

    const game = new CeaseDesist(root, opts);
    const handle = {
      root: root,
      game: game,
      get model() {
        return game.model;
      },
      destroy: function () {
        game.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.ceaseDesistGame = handle;
    return handle;
  }

  if (typeof window !== "undefined") window.launchCeaseDesist = launchCeaseDesist;
  // Lets a Node script drive the models directly.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Shift, BarShift, KIND, LEVELS, HOLES, QUARTER_SECS, WRONGFUL_BRAND, WRONGFUL_CASH, STRUCK_SECS, ROW_CD, MUG_SPEED, BAR_LOCK_SECS, FAN_UNSERVED_BRAND };
  }
})();
