/*
 * Cease & Desist — whack-a-mole for a game publisher.
 *
 * You run the legal desk of a publisher with nine studios. Pirates, knock-off
 * clones and copyright trolls pop out of the studios' desks; tap them to take
 * them down before they escape. But the studios also ship real games out of
 * those same desks, and those are *yours*: tapping a legitimate release is a
 * wrongful takedown (brand hit, fine, combo gone). Leave a release alone and it
 * sells. Revenue is the score; IP Integrity (the brand) is the life bar, and the
 * run ends when it hits zero. Each whack charges the Legal Fund; a full fund
 * unlocks one CLASS ACTION that clears every threat on the board.
 *
 * Structure: Shift is the whole model (no DOM, no Math.random unless you don't
 * pass an rng — tests pass a seeded one) and CeaseDesist is the DOM view on
 * top. Like Greenlit this is a plain HTML/CSS overlay, not a Phaser scene.
 * window.launchCeaseDesist() builds it; window.ceaseDesistGame is the handle,
 * its destroy() takes no arguments, and .game / .model expose the view and the
 * Shift for headless assertions. Best run is in localStorage (BEST_KEY).
 */
(function () {
  "use strict";

  /* ---------- tuning ---------- */

  const BEST_KEY = "cease-desist-best";
  const HOLES = 9;
  const QUARTER_SECS = 30; // a fiscal quarter; each one is a notch harder
  const DIFF_SECS = 210; // time until the main ramp tops out
const LATE_SECS = 270; // then a slower squeeze on top of it
  const STRUCK_SECS = 5; // how long an escaped troll locks a studio

  const SALE_BASE = 60; // a release left alone pays this, +15% per quarter
  const WRONGFUL_BRAND = 12;
  const WRONGFUL_CASH = 200;
  const QUARTER_BONUS_BRAND = 6;
  const SALE_BRAND = 1;

  // hp = whacks to take it down, base = payout at x1, fund = Legal Fund charge,
  // leakBrand/leakCash = what it costs you when it escapes.
  const KIND = {
    release: { threat: false, hp: 1, lifeMult: 1.1 },
    pirate: { threat: true, hp: 1, base: 100, fund: 12, leakBrand: 6, leakCash: 75, lifeMult: 1 },
    clone: { threat: true, hp: 2, base: 250, fund: 20, leakBrand: 9, leakCash: 150, lifeMult: 1.55 },
    troll: { threat: true, hp: 1, base: 175, fund: 14, leakBrand: 4, leakCash: 0, lifeMult: 0.85 },
  };

  const STUDIOS = ["Pixel Forge", "Moonlit", "Gnarly Bits", "Tidepool", "Brass Owl", "Nimbus", "Crumb Co.", "Vector Fox", "Hex & Co."];
  const ADJ = ["Neon", "Crimson", "Tiny", "Hollow", "Turbo", "Velvet", "Cosmic", "Grumpy", "Gilded", "Frozen", "Wobbly", "Midnight"];
  const NOUN = ["Quest", "Racers", "Kingdom", "Blaster", "Farm", "Heist", "Dungeon", "Pals", "Odyssey", "Tactics", "Siege", "Bakery"];
  const SITES = ["FreeGamez.biz", "CrackHub", "TorrentTown", "WarezWharf", "GameLeech", "0daySwap"];
  const CLONE_SUFFIX = ["Lite", "Clone", "Reborn", "Remix", "HD*", "Gold"];
  const TROLL_TAGS = ["BOGUS CLAIM", "DMCA SPAM", "FALSE STRIKE", "“MY LOGO!”"];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* ---------- model ---------- */

  class Shift {
    constructor(rng) {
      this.rng = rng || Math.random;
      this.reset();
    }

    reset() {
      this.t = 0;
      this.revenue = 0;
      this.brand = 100;
      this.combo = 0;
      this.fund = 0;
      this.over = false;
      this.lastQuarter = 1;
      this.spawnT = 0.9;
      this.events = [];
      this.stats = { caught: 0, wrongful: 0, leaks: 0, sales: 0, classActions: 0, bestCombo: 0 };
      this.holes = [];
      for (let i = 0; i < HOLES; i++) {
        this.holes.push({ state: "idle", kind: null, hp: 0, life: 0, maxLife: 1, cd: 0, timer: 0, title: "", tag: "", res: "" });
      }
    }

    pick(arr) {
      return arr[Math.floor(this.rng() * arr.length)];
    }

    quarter() {
      return 1 + Math.floor(this.t / QUARTER_SECS);
    }

    diff() {
      return Math.min(1, this.t / DIFF_SECS);
    }

    mult() {
      return Math.min(4, 1 + 0.5 * Math.floor(this.combo / 5));
    }

    // Past DIFF_SECS the ramp keeps going, slowly, so no run lasts forever.
    late() {
      return Math.min(1, Math.max(0, (this.t - DIFF_SECS) / LATE_SECS));
    }

    maxActive() {
      return 2 + Math.floor(this.diff() * 3) + (this.late() > 0.5 ? 1 : 0); // 2..6
    }

    emit(type, hole, kind, amount) {
      this.events.push({ type: type, hole: hole, kind: kind || null, amount: amount || 0 });
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
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

    checkOver() {
      if (this.brand <= 0 && !this.over) {
        this.brand = 0;
        this.over = true;
        this.emit("over", -1);
      }
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

    classReady() {
      return !this.over && this.fund >= 100;
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
.cd-bar-row{width:min(94vw,520px);display:flex;align-items:center;gap:8px;margin-top:10px;position:relative;}
.cd-bar-label{font-size:11px;font-weight:800;letter-spacing:.12em;color:#ffb4a8;flex:0 0 auto;}
.cd-bar{position:relative;flex:1 1 auto;height:14px;border-radius:8px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.18);overflow:hidden;}
.cd-bar i{position:absolute;inset:0;transform-origin:left;transform:scaleX(1);background:linear-gradient(90deg,#3fd47a,#9bef6a);transition:transform .2s ease;}
.cd-bar.cd-low i{background:linear-gradient(90deg,#e63a3a,#ff8a5a);}
.cd-bar.cd-low{animation:cd-pulse .6s infinite;}
@keyframes cd-pulse{50%{border-color:#ff6b5a;}}
.cd-combo{flex:0 0 auto;min-width:64px;text-align:right;font-weight:800;font-size:14px;color:#ffd96b;font-variant-numeric:tabular-nums;}
.cd-stagewrap{position:relative;margin-top:10px;width:min(94vw,520px);width:min(94vw,520px,calc(100vh - 250px));width:min(94vw,520px,calc(100dvh - 250px));min-width:240px;aspect-ratio:1;flex:0 0 auto;}
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
.cd-foot{width:min(94vw,520px);margin-top:12px;display:flex;align-items:center;gap:10px;}
.cd-bar--fund{height:26px;flex:1 1 auto;}
.cd-bar--fund i{transform:scaleX(0);background:linear-gradient(90deg,#4aa0ff,#a58bff);}
.cd-bar--fund span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.14em;text-shadow:0 1px 2px #000;}
.cd-class{flex:0 0 auto;height:40px;padding:0 12px;border-radius:12px;border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#8890b8;font-weight:900;font-size:13px;letter-spacing:.04em;cursor:pointer;}
.cd-class:not(:disabled){color:#fff;border-color:#a58bff;background:linear-gradient(180deg,#7a5aff,#4a2ad0);animation:cd-glow .8s infinite;}
@keyframes cd-glow{50%{box-shadow:0 0 18px 4px rgba(165,139,255,.7);}}
.cd-panel{position:absolute;inset:-4px;z-index:10;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;border-radius:16px;background:rgba(7,8,16,.9);border:2px solid rgba(255,120,120,.35);}
.cd-panel.cd-show{display:flex;}
.cd-panel h2{margin:0;font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(22px,6.5vw,34px);color:#ff9d8f;letter-spacing:.04em;}
.cd-panel p{margin:0;font-size:clamp(12px,3.4vw,15px);line-height:1.35;color:#c9d0f0;max-width:340px;}
.cd-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;text-align:left;font-size:clamp(12px,3.4vw,14px);color:#dfe4ff;}
.cd-legend b{display:inline-block;width:1.7em;text-align:center;}
.cd-stats{display:grid;grid-template-columns:auto auto;gap:3px 16px;font-size:clamp(12px,3.4vw,15px);text-align:left;font-variant-numeric:tabular-nums;}
.cd-stats span:nth-child(odd){color:#9aa3cf}.cd-stats span:nth-child(even){font-weight:800;text-align:right}
.cd-go{padding:10px 22px;border-radius:14px;border:2px solid #ffb4a8;background:linear-gradient(180deg,#e8554a,#a82a22);color:#fff;font-weight:900;font-size:16px;letter-spacing:.06em;cursor:pointer;}
.cd-go--alt{background:rgba(255,255,255,.07);border-color:rgba(255,214,140,.5);color:#ffe2a3;font-size:13px;padding:7px 16px;}
.cd-go:active{transform:translateY(2px);}
.cd-newbest{color:#ffd96b;font-weight:900;}
#cd-root.cd-shake .cd-stagewrap{animation:cd-shake .3s;}
@keyframes cd-shake{20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@media(max-height:620px){.cd-top{padding:6px 12px;}.cd-bar-row,.cd-stagewrap{margin-top:6px;}.cd-foot{margin-top:6px;}.cd-legend{font-size:12px;gap:3px;}.cd-panel{gap:6px;padding:8px;}}
@media(prefers-reduced-motion:reduce){#cd-root.cd-shake .cd-stagewrap{animation:none;}.cd-class:not(:disabled){animation:none;}}
`;

  const KEYS = { q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 };
  const EMOJI = { release: "🎮", pirate: "🏴‍☠️", clone: "👯", troll: "⚖️" };

  function loadBest() {
    try {
      const b = JSON.parse(localStorage.getItem(BEST_KEY));
      if (b && typeof b.revenue === "number") return b;
    } catch (e) {}
    return { revenue: 0, quarter: 0 };
  }

  function saveBest(b) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(b));
    } catch (e) {}
  }

  function money(n) {
    return "$" + n.toLocaleString("en-US");
  }

  class CeaseDesist {
    constructor(root) {
      this.root = root;
      this.model = new Shift();
      this.mode = "title";
      this.best = loadBest();
      this.timers = [];
      this.muted = false;
      this.audio = null;
      this.dead = false;
      this.sigs = [];
      this.cache = {};
      this.el = {
        board: root.querySelector("#cd-board"),
        panel: root.querySelector("#cd-panel"),
        cash: root.querySelector("#cd-cash"),
        q: root.querySelector("#cd-q"),
        brand: root.querySelector("#cd-brand"),
        brandBar: root.querySelector("#cd-brand").parentNode,
        combo: root.querySelector("#cd-combo"),
        fund: root.querySelector("#cd-fund"),
        cls: root.querySelector("#cd-class"),
        mute: root.querySelector('[data-act="mute"]'),
      };

      this.holeEls = [];
      for (let i = 0; i < HOLES; i++) {
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
        this.el.board.appendChild(b);
        this.holeEls.push({
          btn: b,
          mole: b.querySelector(".cd-mole"),
          emo: b.querySelector(".cd-emo"),
          tag: b.querySelector(".cd-tag"),
          life: b.querySelector(".cd-life i"),
          stamp: b.querySelector(".cd-stamp"),
        });
        this.sigs.push("");
      }

      this.onDown = (e) => {
        const t = e.target.closest ? e.target.closest(".cd-hole") : null;
        if (!t || this.mode !== "play") return;
        e.preventDefault();
        this.ensureAudio();
        this.model.whack(Number(t.dataset.i));
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
            this.model.whack(KEYS[k]);
            this.drain();
          } else if (k === " ") {
            e.preventDefault();
            this.fireClass();
          }
        } else if (k === "enter" || k === " ") {
          e.preventDefault();
          this.start();
        }
      };
      window.addEventListener("keydown", this.onKey);

      this.showTitle();
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

    /* --- screens --- */

    showPanel(html) {
      this.el.panel.innerHTML = html;
      this.el.panel.classList.add("cd-show");
      this.el.panel.querySelectorAll("[data-go]").forEach((b) => {
        b.addEventListener("click", () => {
          if (b.dataset.go === "menu") {
            if (typeof window.returnToMenu === "function") window.returnToMenu();
          } else this.start();
        });
      });
    }

    hidePanel() {
      this.el.panel.classList.remove("cd-show");
    }

    showTitle() {
      this.mode = "title";
      this.showPanel(
        "<h2>Cease &amp; Desist</h2>" +
          "<p>You're the legal desk of a publisher with nine studios. Protect the IP.</p>" +
          '<ul class="cd-legend">' +
          "<li><b>" + EMOJI.pirate + "</b>Pirate — tap it before it leaks</li>" +
          "<li><b>" + EMOJI.clone + "</b>Knockoff — takes two hits</li>" +
          "<li><b>" + EMOJI.troll + "</b>Copyright troll — stop it or it locks a studio</li>" +
          "<li><b>" + EMOJI.release + "</b>Your studios' releases — <u>don't touch</u>, they pay you</li>" +
          "</ul>" +
          '<button class="cd-go" data-go="start">START SHIFT</button>' +
          "<p>Best: " + money(this.best.revenue) + (this.best.quarter ? " · Q" + this.best.quarter : "") +
          "<br>Keys: Q W E / A S D / Z X C, Space = class action</p>"
      );
    }

    start() {
      if (this.mode === "play") return;
      this.ensureAudio();
      this.model.reset();
      for (let i = 0; i < HOLES; i++) this.sigs[i] = "";
      this.mode = "play";
      this.hidePanel();
      this.last = performance.now();
    }

    gameOver() {
      this.mode = "over";
      const m = this.model;
      const q = m.quarter();
      const isBest = m.revenue > this.best.revenue;
      if (isBest) {
        this.best = { revenue: m.revenue, quarter: q };
        saveBest(this.best);
      }
      const why =
        m.stats.wrongful >= m.stats.leaks
          ? "The board fired you for suing your own developers."
          : "Piracy ate the catalogue. The board is pivoting to mobile.";
      this.sfx("over");
      this.later(() => {
        if (this.dead) return;
        this.showPanel(
          "<h2>Brand Bankrupt</h2><p>" + why + "</p>" +
            '<div class="cd-stats">' +
            "<span>Revenue</span><span>" + money(m.revenue) + "</span>" +
            "<span>Quarters survived</span><span>" + q + "</span>" +
            "<span>Threats taken down</span><span>" + m.stats.caught + "</span>" +
            "<span>Releases shipped</span><span>" + m.stats.sales + "</span>" +
            "<span>Wrongful takedowns</span><span>" + m.stats.wrongful + "</span>" +
            "<span>Leaks</span><span>" + m.stats.leaks + "</span>" +
            "<span>Best combo</span><span>" + m.stats.bestCombo + "</span>" +
            "</div>" +
            (isBest ? '<div class="cd-newbest">★ New best revenue ★</div>' : "") +
            '<button class="cd-go" data-go="start">BACK IN BUSINESS</button>' +
            '<button class="cd-go cd-go--alt" data-go="menu">Fantasia Menu</button>'
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
        const h = this.model.holes[ev.hole];
        switch (ev.type) {
          case "spawn":
            this.sfx("spawn", ev.kind);
            break;
          case "kill":
            this.float(ev.hole, "+" + money(ev.amount), "gold");
            this.sfx("kill");
            break;
          case "crack":
            this.holeEls[ev.hole].mole.classList.add("cd-cracked");
            this.float(ev.hole, "C&D served!", "good");
            this.sfx("crack");
            break;
          case "wrongful":
            this.float(ev.hole, "WRONGFUL! -" + ev.amount, "bad");
            this.shake();
            this.sfx("bad");
            break;
          case "escape":
            this.float(ev.hole, ev.kind === "troll" ? "STUDIO LOCKED" : "LEAKED! -" + ev.amount, "bad");
            this.shake();
            this.sfx("bad");
            break;
          case "sale":
            this.float(ev.hole, "SALE +" + money(ev.amount), "good");
            this.sfx("sale");
            break;
          case "quarter":
            this.float(4, "QUARTER " + ev.amount + "!", "gold");
            this.sfx("sale");
            break;
          case "class":
            this.float(4, "CLASS ACTION! ×" + ev.amount, "gold");
            this.sfx("class");
            this.shake();
            break;
          case "miss":
            break;
          case "over":
            this.gameOver();
            break;
        }
        if (h && ev.type === "spawn") this.sigs[ev.hole] = "";
      }
    }

    float(i, text, cls) {
      const b = this.holeEls[i].btn;
      const el = document.createElement("div");
      el.className = "cd-float cd-float--" + cls;
      el.textContent = text;
      el.style.left = b.offsetLeft + b.offsetWidth / 2 + "px";
      el.style.top = b.offsetTop + b.offsetHeight * 0.25 + "px";
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
        case "spawn": if (kind !== "release") this.tone(kind === "troll" ? 330 : 520, 0.04, "sine", 0.025); break;
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

      for (let i = 0; i < HOLES; i++) {
        const h = m.holes[i];
        const v = this.holeEls[i];
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

      if (c.rev !== m.revenue) {
        c.rev = m.revenue;
        this.el.cash.textContent = money(m.revenue);
      }
      const q = m.quarter();
      if (c.q !== q) {
        c.q = q;
        this.el.q.textContent = "Q" + q;
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

  function launchCeaseDesist() {
    if (window.ceaseDesistGame) return window.ceaseDesistGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "cd-root";
    root.innerHTML = HTML;
    document.getElementById("game-container").appendChild(root);

    const game = new CeaseDesist(root);
    const handle = {
      root: root,
      game: game,
      model: game.model,
      destroy: function () {
        game.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.ceaseDesistGame = handle;
    return handle;
  }

  if (typeof window !== "undefined") window.launchCeaseDesist = launchCeaseDesist;
  // Lets a Node script drive the model directly.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Shift, KIND, HOLES, QUARTER_SECS, WRONGFUL_BRAND, WRONGFUL_CASH, STRUCK_SECS };
  }
})();
