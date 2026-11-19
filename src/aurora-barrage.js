/*
 * Aurora Barrage — a vertical arcade shooter built for thumbs.
 *
 * Drag anywhere to fly; the ship fires itself. Every enemy you shoot down spills
 * experience orbs that drift off the bottom of the screen unless you fly into
 * them. Enough experience levels your weapon up, and a weapon level is a BEAM
 * COUNT: level 1 fires one laser, level 2 fires two, level 60 fires sixty. Get
 * hit and you lose hull and a fifth of your levels, so a big weapon is something
 * you have to earn and defend. Play well and the whole screen fills with light.
 *
 * Files:
 *   src/aurora-barrage/sim.js   the pure, seeded game logic (also unit-tested in Node)
 *   src/aurora-barrage.js       this file: Phaser 4 view, input, HUD, FX, WebAudio
 *   src/aurora-barrage/*.webp   the Meshy-generated art (player, 3 enemies, boss, nebula)
 *
 * Everything that is not one of those six pictures is drawn in code at boot:
 * lasers, enemy bullets, XP orbs, engine flame, rings, sparks, star layers, HUD.
 * The Phaser game is created on demand via window.launchAuroraBarrage().
 */
(function () {
  "use strict";

  const SIM = window.AuroraBarrageSim;
  const { W, H, STEP } = SIM;
  const ART = "src/aurora-barrage/";
  const BEST_KEY = "aurora-barrage-best";
  const MUTE_KEY = "aurora-barrage-mute";
  const FONT = "Arial Black, Arial, Helvetica, sans-serif";

  const TIER_COL = [0x5fe6ff, 0x6dff8a, 0xffe45c, 0xff9a3c, 0xff52c8, 0xffffff];
  const EB_COL = [0xff9a3c, 0xff46c8, 0xffdc50, 0xff3c46]; // scout, gunship, bomber, boss bullets
  const ORB_COL = { 1: 0x58f0ff, 5: 0xffd45a, 25: 0xff5ad2, 125: 0xffffff };
  const SHIP_W = { scout: 84, gunship: 116, bomber: 140, boss: 330 };
  const PLAYER_W = 92;

  // Older Safari lacks roundRect; the textures below only need a simple version.
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }

  const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const rgba = (n, a) => { const c = hex(n); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  function readBest() {
    try { const b = JSON.parse(localStorage.getItem(BEST_KEY)); if (b && typeof b.score === "number") return b; } catch (e) {}
    return { score: 0, level: 1, stage: 1 };
  }
  function writeBest(b) { try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) {} }

  // ---------- tiny WebAudio synth (created on the first tap, per autoplay policy) ----------
  class Sfx {
    constructor() {
      this.ctx = null;
      this.muted = false;
      try { this.muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
      this.last = {};
      this.chain = 0;
      this.chainT = 0;
    }
    unlock() {
      if (!this.ctx) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.5;
          this.master.connect(this.ctx.destination);
          const n = this.ctx.sampleRate * 1.2, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
          for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
          this.noiseBuf = buf;
        } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    }
    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch (e) {}
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    }
    ok(name, ms) {
      if (!this.ctx || this.muted) return false;
      const now = performance.now();
      if (now - (this.last[name] || 0) < ms) return false;
      this.last[name] = now;
      return true;
    }
    tone(f, dur, type, vol, slide, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noise(dur, vol, lp, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noiseBuf; f.type = "lowpass";
      f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.02);
    }
    shot(tier, level) { if (this.ok("shot", 85)) this.tone(780 + tier * 140, 0.07, "triangle", 0.012 + Math.min(0.03, level * 0.0004), 300); }
    pick(v) {
      if (!this.ok("pick", 28)) return;
      const now = performance.now();
      this.chain = now - this.chainT < 320 ? Math.min(this.chain + 1, 14) : 0;
      this.chainT = now;
      this.tone(520 * Math.pow(2, this.chain / 12 * 1.4), 0.09, "sine", v > 1 ? 0.05 : 0.032);
    }
    boom(size) {
      if (!this.ok("boom" + (size > 1 ? "b" : ""), size > 1 ? 60 : 55)) return;
      const v = [0.07, 0.12, 0.2, 0.32][size] || 0.1;
      this.noise(0.18 + size * 0.2, v, 1800 + size * 500);
      if (size >= 1) this.tone(120, 0.25 + size * 0.1, "sine", v * 0.8, 40);
    }
    level() { if (this.ok("level", 140)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.07, 0, i * 0.055)); }
    hurt() { if (!this.ok("hurt", 100)) return; this.noise(0.5, 0.3, 2400); this.tone(180, 0.45, "sawtooth", 0.12, 45); }
    warn() { if (!this.ok("warn", 500)) return; for (let i = 0; i < 4; i++) this.tone(i % 2 ? 440 : 330, 0.3, "sawtooth", 0.07, 0, i * 0.32); }
    stage() { if (this.ok("stage", 400)) [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.08, 0, i * 0.09)); }
    over() { if (!this.ok("over", 500)) return; this.noise(1.2, 0.4, 2600); this.tone(220, 1.1, "sawtooth", 0.14, 35); }
  }

  // ---------- pooled additive sprites: thousands of lasers without allocating a frame ----------
  class Pool {
    constructor(scene, key, depth, blend, originY) {
      this.scene = scene; this.key = key; this.depth = depth; this.blend = blend; this.originY = originY;
      this.arr = []; this.n = 0; this.shown = 0;
    }
    begin() { this.n = 0; }
    next() {
      let s = this.arr[this.n];
      if (!s) {
        s = this.scene.add.image(0, 0, this.key).setDepth(this.depth);
        if (this.blend) s.setBlendMode(Phaser.BlendModes.ADD);
        if (this.originY != null) s.setOrigin(0.5, this.originY);
        this.arr.push(s);
      } else if (!s.visible) s.setVisible(true);
      this.n++;
      return s;
    }
    end() {
      for (let i = this.n; i < this.shown; i++) this.arr[i].setVisible(false);
      this.shown = this.n;
    }
    hideAll() { this.n = 0; this.end(); }
  }

  class AuroraScene extends Phaser.Scene {
    constructor() { super("AuroraScene"); }

    preload() {
      this.load.image("ab-bg", ART + "bg.webp");
      for (const k of ["player", "scout", "gunship", "bomber", "boss"]) this.load.image("ab-" + k, ART + k + ".webp");
    }

    create() {
      this.sfx = new Sfx();
      this.best = readBest();
      this.buildTextures();
      this.buildBackdrop();
      this.buildPools();
      this.buildPlayerSprites();
      this.buildFx();
      this.buildHud();
      this.buildInput();

      this.mode = "title";
      this.acc = 0;
      this.slow = 0;
      this.frame = 0;
      this.thin = false;
      this.fpsT = 0;
      this.enemySprites = new Map();
      this.enemyPool = { scout: [], gunship: [], bomber: [], boss: [] };
      this.world = new SIM.World({ seed: 7, level: 46 }); // title-screen showcase fan
      this.buildTitle();
      this.events.once("shutdown", () => this.teardown());
      this.events.once("destroy", () => this.teardown());
    }

    teardown() {
      if (this.sfx && this.sfx.ctx) { try { this.sfx.ctx.close(); } catch (e) {} this.sfx.ctx = null; }
    }

    // ================= textures, all drawn in code =================
    tex(key, w, h, draw) {
      if (this.textures.exists(key)) return;
      const t = this.textures.createCanvas(key, w, h);
      draw(t.getContext(), w, h);
      t.refresh();
    }

    buildTextures() {
      for (let t = 0; t < 6; t++) {
        this.tex("ab-bolt-" + t, 16, 132, (c, w, h) => {
          const col = TIER_COL[t];
          let g = c.createLinearGradient(0, 0, w, 0);
          g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g;
          const v = c.createLinearGradient(0, 0, 0, h);
          v.addColorStop(0, "rgba(0,0,0,1)"); v.addColorStop(0.8, "rgba(0,0,0,.7)"); v.addColorStop(1, "rgba(0,0,0,0)");
          c.beginPath(); c.roundRect(1, 1, w - 2, h - 2, w / 2); c.fill();
          // fade the tail out so a stream of beams reads as one continuous laser
          c.globalCompositeOperation = "destination-in"; c.fillStyle = v; c.fillRect(0, 0, w, h);
          c.globalCompositeOperation = "source-over";
          g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
          c.fillStyle = g;
          c.beginPath(); c.roundRect(w / 2 - 1.5, 3, 3, h - 6, 1.5); c.fill();
        });
      }
      EB_COL.forEach((col, k) => this.tex("ab-eb-" + k, 34, 34, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.28, "rgba(255,255,255,.95)");
        g.addColorStop(0.42, rgba(col, 0.95)); g.addColorStop(0.75, rgba(col, 0.35)); g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      }));
      for (const v of [1, 5, 25, 125]) {
        this.tex("ab-orb-" + v, 44, 44, (c, w, h) => {
          const col = ORB_COL[v];
          let g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
          g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.22, rgba(col, 1));
          g.addColorStop(0.5, rgba(col, 0.45)); g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g; c.fillRect(0, 0, w, h);
          c.strokeStyle = "rgba(255,255,255,.75)"; c.lineWidth = 1.5;
          c.beginPath(); c.arc(w / 2, h / 2, w * 0.2, 0, 7); c.stroke();
        });
      }
      this.tex("ab-flame", 30, 72, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.2, "rgba(120,230,255,.85)");
        g.addColorStop(0.6, "rgba(60,140,255,.35)"); g.addColorStop(1, "rgba(60,140,255,0)");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(w / 2, h); c.quadraticCurveTo(w, h * 0.35, w * 0.8, 0); c.lineTo(w * 0.2, 0); c.quadraticCurveTo(0, h * 0.35, w / 2, h); c.fill();
      });
      this.tex("ab-spark", 16, 16, (c, w, h) => {
        const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      this.tex("ab-glow", 128, 128, (c, w, h) => {
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      this.tex("ab-ring", 128, 128, (c, w, h) => {
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(255,255,255,0)");
        g.addColorStop(0.87, "rgba(255,255,255,.95)"); g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      this.tex("ab-dot", 20, 20, (c, w, h) => {
        c.fillStyle = "rgba(255,70,120,.55)"; c.beginPath(); c.arc(10, 10, 9, 0, 7); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(10, 10, 5, 0, 7); c.fill();
      });
      // two star layers that scroll faster than the nebula, for parallax
      const stars = (key, n, big, streak) => this.tex(key, W, H, (c) => {
        for (let i = 0; i < n; i++) {
          const x = Math.random() * W, y = Math.random() * H, a = 0.25 + Math.random() * 0.7;
          c.fillStyle = `rgba(${200 + (Math.random() * 55) | 0},${210 + (Math.random() * 45) | 0},255,${a})`;
          const s = Math.random() < big ? 2.2 : 1.2;
          c.fillRect(x, y, streak ? 1.6 : s, streak ? 8 + Math.random() * 10 : s);
        }
      });
      stars("ab-stars-far", 110, 0.12, false);
      stars("ab-stars-near", 26, 0, true);
    }

    buildBackdrop() {
      this.add.rectangle(0, 0, W, H, 0x05030f).setOrigin(0, 0).setDepth(-30);
      this.bgs = [0, 1].map((i) => this.add.image(0, i * H, "ab-bg").setOrigin(0, 0).setDisplaySize(W, H + 1).setDepth(-20));
      this.bgOff = 0;
      this.farStars = [0, 1].map((i) => this.add.image(0, i * H, "ab-stars-far").setOrigin(0, 0).setDepth(-15).setAlpha(0.8));
      this.nearStars = [0, 1].map((i) => this.add.image(0, i * H, "ab-stars-near").setOrigin(0, 0).setDepth(-14).setAlpha(0.55));
      this.farOff = 0; this.nearOff = 0;
    }

    scrollBackdrop(dt, speedMul) {
      this.bgOff = (this.bgOff + 42 * dt * speedMul) % H;
      this.farOff = (this.farOff + 110 * dt * speedMul) % H;
      this.nearOff = (this.nearOff + 260 * dt * speedMul) % H;
      for (let i = 0; i < 2; i++) {
        this.bgs[i].y = this.bgOff + (i - 1) * H;
        this.farStars[i].y = this.farOff + (i - 1) * H;
        this.nearStars[i].y = this.nearOff + (i - 1) * H;
      }
    }

    buildPools() {
      this.boltPools = [0, 1, 2, 3, 4, 5].map((t) => new Pool(this, "ab-bolt-" + t, 30, true, 0.1));
      this.ebPools = [0, 1, 2, 3].map((k) => new Pool(this, "ab-eb-" + k, 40, true));
      this.orbPools = { 1: new Pool(this, "ab-orb-1", 35, true), 5: new Pool(this, "ab-orb-5", 35, true), 25: new Pool(this, "ab-orb-25", 35, true), 125: new Pool(this, "ab-orb-125", 35, true) };
      this.hpGfx = this.add.graphics().setDepth(45);
    }

    buildPlayerSprites() {
      const p = this.add.image(W / 2, H - 190, "ab-player").setDepth(50);
      p.setScale(PLAYER_W / p.width);
      this.pShip = p;
      this.pFlame = this.add.image(0, 0, "ab-flame").setDepth(49).setBlendMode(Phaser.BlendModes.ADD);
      this.pDot = this.add.image(0, 0, "ab-dot").setDepth(52);
      this.pShield = this.add.image(0, 0, "ab-ring").setDepth(51).setBlendMode(Phaser.BlendModes.ADD).setTint(0x8fe8ff).setScale(1.1).setVisible(false);
    }

    buildFx() {
      this.fxList = [];
      this.fxFree = [];
      const mk = (tint) => this.add.particles(0, 0, "ab-spark", {
        emitting: false, lifespan: { min: 260, max: 720 }, speed: { min: 70, max: 380 },
        scale: { start: 1.15, end: 0 }, alpha: { start: 1, end: 0 }, tint, blendMode: "ADD",
      }).setDepth(60);
      this.sparkFire = mk(0xffa040);
      this.sparkHot = mk(0xffe9a0);
      this.sparkCool = mk(0x7fe8ff);
    }

    fx(key, x, y, s0, s1, dur, tint, alpha, depth) {
      if (this.fxList.length > 70) return; // never let a screen full of kills pile up overdraw
      let f = this.fxFree.pop();
      if (!f) f = { spr: this.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD) };
      f.spr.setTexture(key).setPosition(x, y).setScale(s0).setTint(tint).setAlpha(alpha).setDepth(depth || 58).setVisible(true);
      f.t = 0; f.dur = dur; f.s0 = s0; f.s1 = s1; f.a = alpha;
      this.fxList.push(f);
    }

    stepFx(dt) {
      for (let i = this.fxList.length - 1; i >= 0; i--) {
        const f = this.fxList[i];
        f.t += dt;
        const k = f.t / f.dur;
        if (k >= 1) { f.spr.setVisible(false); this.fxFree.push(f); this.fxList.splice(i, 1); continue; }
        const e = 1 - (1 - k) * (1 - k);
        f.spr.setScale(f.s0 + (f.s1 - f.s0) * e).setAlpha(f.a * (1 - k));
      }
    }

    // ================= HUD =================
    text(x, y, str, size, color, ox, oy) {
      return this.add.text(x, y, str, { fontFamily: FONT, fontSize: size + "px", color: color || "#ffffff", stroke: "#06061a", strokeThickness: Math.max(3, size / 6) })
        .setOrigin(ox == null ? 0.5 : ox, oy == null ? 0.5 : oy).setDepth(100);
    }

    chip(x, y, label, onClick, bg) {
      const t = this.add.text(x, y, label, { fontFamily: FONT, fontSize: "20px", color: "#ffffff", backgroundColor: bg || "#26325f", padding: { x: 16, y: 9 } })
        .setOrigin(0.5).setDepth(130).setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => { if (e && e.stopPropagation) e.stopPropagation(); this.sfx.unlock(); onClick(); });
      return t;
    }

    buildHud() {
      this.hudGfx = this.add.graphics().setDepth(99);
      this.hullIcons = [];
      for (let i = 0; i < SIM.MAX_HULL; i++) {
        this.hullIcons.push(this.add.image(26 + i * 30, 28, "ab-player").setScale(26 / 192).setDepth(100));
      }
      this.scoreTxt = this.text(W - 118, 28, "0", 26, "#ffffff", 1, 0.5);
      this.stageTxt = this.text(14, 56, "STAGE 1", 15, "#9fb4ff", 0, 0.5);
      this.lvTxt = this.text(14, 84, "LV 1", 22, "#5fe6ff", 0, 0.5);
      this.beamTxt = this.text(W - 14, 84, "1 BEAM", 18, "#cfeaff", 1, 0.5);
      this.bossTxt = this.text(W / 2, 128, "THE DREADNOUGHT", 14, "#ff9aa6").setVisible(false);
      this.banner = this.text(W / 2, 330, "", 54, "#ffffff").setVisible(false).setDepth(120);
      this.bannerSub = this.text(W / 2, 384, "", 22, "#cfd8ff").setVisible(false).setDepth(120);
      this.hint = this.text(W / 2, 600, "", 22, "#e8f0ff").setVisible(false).setDepth(120);
      this.pauseChip = this.chip(W - 28, 28, "II", () => this.togglePause(), "#26325fcc");
      this.muteChip = this.chip(W - 84, 28, this.sfx.muted ? "x" : "♪", () => {
        this.sfx.setMuted(!this.sfx.muted);
        this.muteChip.setText(this.sfx.muted ? "x" : "♪");
      }, "#26325fcc");
      this.pauseChip.setVisible(false); this.muteChip.setVisible(false);
      this.shownScore = -1; this.shownLevel = -1; this.shownStage = -1;
      this.hudObjs = [this.scoreTxt, this.stageTxt, this.lvTxt, this.beamTxt, ...this.hullIcons];
      this.setHudVisible(false);
    }

    setHudVisible(v) { for (const o of this.hudObjs) o.setVisible(v); this.hudGfx.setVisible(v); }

    showBanner(text, sub, color, hold) {
      this.banner.setText(text).setColor(color || "#ffffff").setFontSize(Math.min(54, Math.floor(480 / (text.length * 0.72)))).setVisible(true).setAlpha(0).setScale(1.5);
      this.bannerSub.setText(sub || "").setVisible(!!sub).setAlpha(0);
      this.tweens.killTweensOf([this.banner, this.bannerSub]);
      this.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 260, ease: "Back.Out" });
      this.tweens.add({ targets: this.bannerSub, alpha: 1, duration: 300, delay: 120 });
      this.tweens.add({ targets: [this.banner, this.bannerSub], alpha: 0, duration: 420, delay: hold || 1500, onComplete: () => { this.banner.setVisible(false); this.bannerSub.setVisible(false); } });
    }

    updateHud() {
      const w = this.world, p = w.player;
      const col = TIER_COL[SIM.tierOf(p.level)], css = "#" + col.toString(16).padStart(6, "0");
      if (w.score !== this.shownScore) { this.shownScore = w.score; this.scoreTxt.setText(w.score.toLocaleString("en-US")); }
      if (w.stage !== this.shownStage) { this.shownStage = w.stage; this.stageTxt.setText("STAGE " + w.stage); }
      if (p.level !== this.shownLevel) {
        this.shownLevel = p.level;
        this.lvTxt.setText(p.level >= SIM.MAX_LEVEL ? "LV MAX" : "LV " + p.level).setColor(css);
        this.beamTxt.setText(p.level + (p.level === 1 ? " BEAM" : " BEAMS"));
      }
      for (let i = 0; i < this.hullIcons.length; i++) this.hullIcons[i].setAlpha(i < p.hull ? 1 : 0.18);
      const g = this.hudGfx;
      g.clear();
      // experience bar
      const need = SIM.xpNeed(p.level), f = p.level >= SIM.MAX_LEVEL ? 1 : Math.min(1, p.xp / need);
      g.fillStyle(0x0a0f2e, 0.75); g.fillRoundedRect(14, 100, W - 28, 10, 5);
      g.fillStyle(col, 1); g.fillRoundedRect(14, 100, Math.max(10, (W - 28) * f), 10, 5);
      g.lineStyle(1.5, 0xffffff, 0.35); g.strokeRoundedRect(14, 100, W - 28, 10, 5);
      // boss bar
      const b = w.boss;
      this.bossTxt.setVisible(!!b && b.state !== "in");
      if (b && b.state !== "in") {
        const bf = Math.max(0, b.hp / b.maxHp);
        g.fillStyle(0x2a0a14, 0.85); g.fillRoundedRect(40, 138, W - 80, 14, 7);
        g.fillStyle(b.ph3 === 3 ? 0xff3c46 : b.ph3 === 2 ? 0xff7a3c : 0xff9a5a, 1); g.fillRoundedRect(40, 138, Math.max(8, (W - 80) * bf), 14, 7);
        g.lineStyle(2, 0xffffff, 0.5); g.strokeRoundedRect(40, 138, W - 80, 14, 7);
      }
    }

    // ================= input =================
    buildInput() {
      this.dragging = false;
      this.input.on("pointerdown", (pointer, over) => {
        this.sfx.unlock();
        if (over && over.length) return;
        if (this.mode === "title") { this.startRun(); }
        else if (this.mode === "play") {
          this.dragging = true;
          this.anchor = { px: pointer.x, py: pointer.y, x: this.world.player.tx, y: this.world.player.ty };
          this.hint.setVisible(false);
        }
      });
      this.input.on("pointermove", (pointer) => {
        if (this.mode !== "play" || !this.dragging || !pointer.isDown) return;
        const a = this.anchor, k = 1.3;
        this.world.setTarget(a.x + (pointer.x - a.px) * k, a.y + (pointer.y - a.py) * k);
      });
      const up = () => { this.dragging = false; };
      this.input.on("pointerup", up);
      this.input.on("pointerupoutside", up);
      this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,ENTER,ESC,P");
      this.input.keyboard.on("keydown-ESC", () => this.togglePause());
      this.input.keyboard.on("keydown-P", () => this.togglePause());
      const startKey = () => { this.sfx.unlock(); if (this.mode === "title") this.startRun(); else if (this.mode === "over" && this.overReady) this.startRun(); };
      this.input.keyboard.on("keydown-SPACE", startKey);
      this.input.keyboard.on("keydown-ENTER", startKey);
    }

    keyboardMove(dt) {
      const k = this.keys;
      const dx = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
      const dy = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
      if (dx || dy) {
        const p = this.world.player;
        this.world.setTarget(p.tx + dx * 640 * dt, p.ty + dy * 640 * dt);
      }
    }

    // ================= flow: title -> play -> dying -> over =================
    buildTitle() {
      const t = [];
      t.push(this.text(W / 2, 214, "AURORA", 78, "#7fe9ff").setStyle({ fontFamily: FONT, fontSize: "78px", color: "#7fe9ff", stroke: "#0a1a3a", strokeThickness: 10, shadow: { blur: 28, color: "#36c6ff", fill: true } }));
      t.push(this.text(W / 2, 296, "BARRAGE", 78, "#ff7ad8").setStyle({ fontFamily: FONT, fontSize: "78px", color: "#ff7ad8", stroke: "#2a0a3a", strokeThickness: 10, shadow: { blur: 28, color: "#ff3cc8", fill: true } }));
      t.push(this.text(W / 2, 372, "Every orb you catch adds a beam.", 21, "#d8e4ff"));
      t.push(this.text(W / 2, 402, "How much light can you fly?", 21, "#d8e4ff"));
      this.titleBest = this.text(W / 2, 462, "", 17, "#ffe9a0");
      t.push(this.titleBest);
      this.titleGo = this.text(W / 2, 560, "TAP TO LAUNCH", 34, "#ffffff");
      t.push(this.titleGo);
      t.push(this.text(W / 2, 606, "drag to fly  ·  your ship fires itself", 16, "#9fb4ff"));
      this.titleMenu = this.chip(W / 2, H - 56, "◂ Fantasia Menu", () => this.exitToMenu(), "#26325f");
      t.push(this.titleMenu);
      this.titleObjs = t;
      this.tweens.add({ targets: this.titleGo, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
      this.refreshTitleBest();
    }

    refreshTitleBest() {
      const b = this.best;
      this.titleBest.setText(b.score > 0 ? `BEST  ${b.score.toLocaleString("en-US")}   ·   LV ${b.level}   ·   STAGE ${b.stage}` : "");
    }

    showTitle(v) { for (const o of this.titleObjs) o.setVisible(v); }

    startRun() {
      this.showTitle(false);
      if (this.overObjs) { for (const o of this.overObjs) o.destroy(); this.overObjs = null; }
      this.clearWorldSprites();
      this.world = new SIM.World({ seed: (Date.now() & 0xffffff) || 1 });
      this.mode = "play";
      this.acc = 0; this.slow = 0; this.shownScore = this.shownLevel = this.shownStage = -1;
      this.dragging = false;
      this.setHudVisible(true);
      this.pauseChip.setVisible(true); this.muteChip.setVisible(true);
      this.pShip.setVisible(true).setAlpha(1);
      this.hint.setText("Drag anywhere to fly").setVisible(true).setAlpha(1);
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 600, delay: 4200, onComplete: () => this.hint.setVisible(false) });
      this.cameras.main.fadeIn(250, 5, 3, 15);
    }

    clearWorldSprites() {
      for (const p of this.boltPools) p.hideAll();
      for (const p of this.ebPools) p.hideAll();
      for (const k in this.orbPools) this.orbPools[k].hideAll();
      if (this.enemySprites) for (const [, s] of this.enemySprites) { s.setVisible(false); this.enemyPool[s.kind].push(s); }
      if (this.enemySprites) this.enemySprites.clear();
      this.hpGfx.clear();
    }

    togglePause() {
      if (this.mode === "play") {
        this.mode = "paused";
        this.pauseObjs = [
          this.add.rectangle(0, 0, W, H, 0x02030c, 0.72).setOrigin(0, 0).setDepth(140).setInteractive(),
          this.text(W / 2, 330, "PAUSED", 56, "#ffffff").setDepth(141),
          this.chip(W / 2, 450, "▶  Resume", () => this.togglePause(), "#2d6a4f").setDepth(141),
          this.chip(W / 2, 520, "◂ Fantasia Menu", () => this.exitToMenu(), "#26325f").setDepth(141),
        ];
      } else if (this.mode === "paused") {
        this.mode = "play";
        for (const o of this.pauseObjs) o.destroy();
        this.pauseObjs = null;
        this.dragging = false;
      }
    }

    exitToMenu() {
      if (typeof window.returnToMenu === "function") window.returnToMenu();
    }

    gameOver() {
      this.mode = "dying";
      this.dragging = false;
      this.world.pbolts.length = 0; // no lasers frozen in mid-air behind the wreck
      this.dyingT = 0;
      const p = this.world.player;
      this.pShip.setVisible(false); this.pFlame.setVisible(false); this.pDot.setVisible(false); this.pShield.setVisible(false);
      this.explode(p.x, p.y, 3, true);
      this.sfx.over();
      this.cameras.main.shake(500, 0.02);
    }

    showOver() {
      const w = this.world, p = w.player;
      const prev = this.best;
      const isBest = w.score > prev.score;
      if (isBest) { this.best = { score: w.score, level: w.maxLevel, stage: w.stage }; writeBest(this.best); }
      this.refreshTitleBest();
      this.mode = "over";
      this.overReady = false;
      this.time.delayedCall(500, () => { this.overReady = true; });
      this.pauseChip.setVisible(false); this.muteChip.setVisible(false);
      const o = [];
      o.push(this.add.rectangle(0, 0, W, H, 0x02030c, 0.78).setOrigin(0, 0).setDepth(140).setInteractive());
      o.push(this.text(W / 2, 200, "SHIP LOST", 56, "#ff8a9a").setDepth(141));
      o.push(this.text(W / 2, 276, w.score.toLocaleString("en-US"), 52, "#ffffff").setDepth(141));
      o.push(this.text(W / 2, 322, isBest ? "★ NEW BEST ★" : "BEST " + this.best.score.toLocaleString("en-US"), 20, isBest ? "#ffe45c" : "#9fb4ff").setDepth(141));
      const rows = [["PEAK WEAPON", `LV ${w.maxLevel}  (${w.maxLevel} beams)`], ["STAGE REACHED", String(w.stage)], ["BOSSES DOWN", String(w.bossesDown)], ["ENEMIES DESTROYED", String(w.kills)], ["TIME", `${Math.floor(w.t / 60)}:${String(Math.floor(w.t % 60)).padStart(2, "0")}`]];
      rows.forEach((r, i) => {
        o.push(this.text(90, 392 + i * 36, r[0], 17, "#9fb4ff", 0, 0.5).setDepth(141));
        o.push(this.text(W - 90, 392 + i * 36, r[1], 20, "#ffffff", 1, 0.5).setDepth(141));
      });
      o.push(this.chip(W / 2, 640, "↻  Fly Again", () => this.startRun(), "#2d6a4f").setDepth(141));
      o.push(this.chip(W / 2, 710, "◂ Fantasia Menu", () => this.exitToMenu(), "#26325f").setDepth(141));
      this.overObjs = o;
      for (const x of o) { x.setAlpha(0); this.tweens.add({ targets: x, alpha: 1, duration: 400 }); }
    }

    // ================= per-frame =================
    update(time, delta) {
      const dtReal = Math.min(delta / 1000, 0.05);
      this.frame++;
      this.stepFx(dtReal);
      this.trackPerf(dtReal);
      if (this.slow > 0) this.slow -= dtReal;

      if (this.mode === "title") {
        this.scrollBackdrop(dtReal, 1);
        const w = this.world;
        w.stepPlayer(dtReal);
        w.stepPlayerBolts(dtReal);
        w.drainEvents();
        w.player.tx = W / 2 + Math.sin(this.frame / 90) * 150;
        this.drawWorld(dtReal);
        return;
      }
      if (this.mode === "paused") return;

      if (this.mode === "play") {
        this.keyboardMove(dtReal);
        const scale = this.slow > 0 ? 0.35 : 1;
        this.acc += dtReal * scale;
        let n = 0;
        while (this.acc >= STEP && n++ < 4) { this.world.step(STEP); this.acc -= STEP; }
        if (n >= 4) this.acc = 0;
        this.handleEvents();
        this.scrollBackdrop(dtReal * scale, this.world.phase === "boss" ? 1.6 : 1);
        this.drawWorld(dtReal);
        this.updateHud();
        if (this.world.over) this.gameOver();
      } else if (this.mode === "dying") {
        this.dyingT += dtReal;
        this.scrollBackdrop(dtReal * 0.3, 1);
        this.drawWorld(dtReal);
        if (this.dyingT > 1.5) this.showOver();
      } else if (this.mode === "over") {
        this.scrollBackdrop(dtReal * 0.3, 1);
      }
    }

    trackPerf(dt) {
      this.fpsT += dt;
      this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsT >= 0.6) {
        const fps = this.fpsN / this.fpsT;
        const heavy = this.world && this.world.pbolts.length > 260;
        if (fps < 44 && heavy) this.thin = true;
        else if (fps > 57) this.thin = false;
        this.fpsT = 0; this.fpsN = 0;
      }
    }

    handleEvents() {
      const w = this.world, ev = w.drainEvents(), p = w.player;
      let boomsThisFrame = 0;
      for (const e of ev) {
        switch (e.t) {
          case "shot": this.sfx.shot(SIM.tierOf(p.level), p.level); break;
          case "boom": if (boomsThisFrame++ < 12 || e.s > 1) this.explode(e.x, e.y, e.s, e.kind === "boss"); break;
          case "pick":
            this.sfx.pick(e.v);
            this.fx("ab-glow", e.x, e.y, 0.15, 0.45, 0.2, ORB_COL[e.v] || 0xffffff, 0.8, 55);
            break;
          case "level": this.onLevelUp(e.level); break;
          case "hurt": this.onHurt(e); break;
          case "bossWarn":
            this.showBanner("WARNING", "a dreadnought approaches", "#ff6a7a", 2000);
            this.sfx.warn();
            break;
          case "boss": break;
          case "bossPhase": this.fx("ab-ring", w.boss ? w.boss.x : W / 2, w.boss ? w.boss.y : 200, 1, 6, 0.7, 0xff6a7a, 0.9, 58); this.cameras.main.shake(260, 0.012); break;
          case "bossDown": this.onBossDown(); break;
          case "stage":
            if (e.n > 1) { this.showBanner("STAGE " + e.n, "hull repaired +1", "#ffe45c", 1700); this.sfx.stage(); }
            break;
        }
      }
    }

    onLevelUp(level) {
      const p = this.world.player;
      this.sfx.level();
      const col = TIER_COL[SIM.tierOf(level)];
      this.fx("ab-ring", p.x, p.y, 0.6, 4, 0.5, col, 0.95, 58);
      this.fx("ab-ring", p.x, p.y, 0.4, 2.4, 0.38, 0xffffff, 0.8, 58);
      if (level % 10 === 0 || level === 5 || level === 25) {
        this.showBanner(level + " BEAMS", "weapon level " + level, "#" + col.toString(16).padStart(6, "0"), 900);
        this.cameras.main.flash(180, 120, 200, 255, true);
      }
    }

    onHurt(e) {
      const p = this.world.player;
      this.sfx.hurt();
      this.cameras.main.shake(320, 0.018);
      this.cameras.main.flash(260, 255, 60, 80, true);
      this.fx("ab-ring", p.x, p.y, 0.5, 6, 0.5, 0xff5060, 1, 58);
      this.sparkFire.explode(22, p.x, p.y);
      if (e.lost > 0) this.showBanner("-" + e.lost + " LEVEL" + (e.lost > 1 ? "S" : ""), "orbs spilled — grab them back!", "#ff8a9a", 1200);
    }

    onBossDown() {
      this.slow = 1.1;
      this.sfx.boom(3);
      this.cameras.main.shake(900, 0.02);
      this.cameras.main.flash(500, 255, 240, 220, true);
      const w = this.world;
      this.showBanner("DREADNOUGHT DOWN", "collect the orbs!", "#7fe9ff", 2300);
      for (let i = 0; i < 9; i++) {
        this.time.delayedCall(80 + i * 110, () => {
          if (this.mode === "play") this.explode(W / 2 + (Math.random() - 0.5) * 240, 190 + (Math.random() - 0.5) * 160, 2, false);
        });
      }
      void w;
    }

    explode(x, y, size, big) {
      const rings = [[0.28, 0.9], [0.45, 1.6], [0.8, 2.8], [1.3, 5]][size] || [0.3, 1];
      this.fx("ab-ring", x, y, rings[0] * 0.5, rings[1], 0.3 + size * 0.08, 0xffd9a0, 0.9, 57);
      this.fx("ab-glow", x, y, rings[0], rings[1] * 0.9, 0.22 + size * 0.07, 0xffa050, 0.95, 56);
      const n = this.thin ? 0.5 : 1;
      this.sparkFire.explode(Math.round((6 + size * 9) * n), x, y);
      if (size >= 1) this.sparkHot.explode(Math.round((4 + size * 6) * n), x, y);
      if (size >= 2) this.sparkCool.explode(Math.round(10 * n), x, y);
      this.sfx.boom(size);
      if (size >= 2 && !big) this.cameras.main.shake(180, 0.006);
    }

    // ----- draw the sim world -----
    drawWorld(dt) {
      const w = this.world, p = w.player, t = this.time.now / 1000;

      // player
      if (this.mode !== "dying" && this.mode !== "over") {
        this.pShip.setPosition(p.x, p.y).setVisible(true);
        this.pShip.setRotation((p.tx - p.x) * 0.0016);
        const fl = 0.8 + 0.3 * Math.sin(t * 40) + Math.random() * 0.1;
        this.pFlame.setPosition(p.x, p.y + 52).setScale(0.9, fl * (1 + Math.min(0.5, p.level / 160))).setVisible(true);
        this.pDot.setPosition(p.x, p.y + 6).setVisible(this.mode === "play");
        const blink = p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0;
        this.pShip.setAlpha(blink ? 0.35 : 1);
        this.pShield.setVisible(p.inv > 0).setPosition(p.x, p.y).setAlpha(Math.min(1, p.inv) * 0.9).setScale(1.1 + 0.05 * Math.sin(t * 20));
      }

      // player lasers (one pool per colour tier)
      for (const pl of this.boltPools) pl.begin();
      const bs = w.pbolts, thin = this.thin, lv = this.mode === "title" ? w.player.level : p.level;
      const bsx = lv <= 6 ? 1 : Math.max(0.42, 1 - (lv - 6) / 90), bal = lv <= 10 ? 1 : Math.max(0.5, 1 - (lv - 10) / 140);
      for (let i = 0; i < bs.length; i++) {
        if (thin && (i & 1)) continue;
        const b = bs[i], s = this.boltPools[b.tier].next();
        s.setPosition(b.x, b.y).setRotation(b.ang).setScale(bsx, 1).setAlpha(bal);
      }
      for (const pl of this.boltPools) pl.end();

      // enemy bullets
      for (const pl of this.ebPools) pl.begin();
      const eb = w.ebullets;
      for (let i = 0; i < eb.length; i++) {
        const b = eb[i], s = this.ebPools[b.k].next();
        s.setPosition(b.x, b.y).setScale(0.78 + 0.1 * Math.sin(t * 12 + i));
      }
      for (const pl of this.ebPools) pl.end();

      // xp orbs
      for (const k in this.orbPools) this.orbPools[k].begin();
      const os = w.orbs;
      for (let i = 0; i < os.length; i++) {
        const o = os[i], v = o.v;
        const pool = this.orbPools[v] || this.orbPools[v >= 125 ? 125 : v > 25 ? 25 : v > 5 ? 5 : 1];
        const base = v >= 3125 ? 2.4 : v >= 625 ? 1.95 : v >= 125 ? 1.55 : v > 25 ? 1.15 : v > 5 ? 0.85 : v > 1 ? 0.7 : 0.62;
        pool.next().setPosition(o.x, o.y).setScale(base * (1 + 0.14 * Math.sin(t * 8 + i * 1.7)));
      }
      for (const k in this.orbPools) this.orbPools[k].end();

      // enemies
      this.drawEnemies(w, t);
    }

    drawEnemies(w, t) {
      const f = this.frame, g = this.hpGfx;
      g.clear();
      for (const e of w.enemies) {
        let s = this.enemySprites.get(e.id);
        if (!s) {
          s = this.enemyPool[e.kind].pop();
          if (!s) { s = this.add.image(0, 0, "ab-" + e.kind); s.kind = e.kind; s.setScale(SHIP_W[e.kind] / s.width); }
          s.setVisible(true).setDepth(e.kind === "boss" ? 38 : 36 + (e.kind === "bomber" ? 1 : 0));
          s.lastX = e.x;
          this.enemySprites.set(e.id, s);
        }
        s.seen = f;
        s.setPosition(e.x, e.y);
        if (e.kind === "scout") { s.setRotation(Math.max(-0.5, Math.min(0.5, (e.x - s.lastX) * 0.06))); s.lastX = e.x; }
        // Light ships pop white when hit. Big ships take hits every frame under a beam wall, so
        // they only brighten (additive tint) or they would stay a solid white silhouette.
        const fl = e.flash > 0;
        if (fl !== s.flashing) {
          s.flashing = fl;
          if (!fl) s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
          else if (e.kind === "scout" || e.kind === "gunship") s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
          else s.setTint(e.kind === "boss" ? 0x4a2c2c : 0x4a4a4a).setTintMode(Phaser.TintModes.ADD);
        }
        s.setAlpha(e.immune ? 0.55 + 0.25 * Math.sin(t * 30) : 1);
        if (e.kind !== "scout" && e.kind !== "boss" && e.hp < e.maxHp && e.y > 0) {
          const bw = e.r * 1.5, bx = e.x - bw / 2, by = e.y - e.r - 12, fr = Math.max(0, e.hp / e.maxHp);
          g.fillStyle(0x10141f, 0.8); g.fillRect(bx, by, bw, 5);
          g.fillStyle(0xff7a7a, 1); g.fillRect(bx, by, bw * fr, 5);
        }
      }
      for (const [id, s] of this.enemySprites) {
        if (s.seen !== f) { s.setVisible(false); this.enemyPool[s.kind].push(s); this.enemySprites.delete(id); }
      }
    }
  }

  function launchAuroraBarrage() {
    if (window.auroraBarrageGame) return window.auroraBarrageGame;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#05030f",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { activePointers: 2 },
      scene: [AuroraScene],
    });
    window.auroraBarrageGame = game;
    return game;
  }

  window.launchAuroraBarrage = launchAuroraBarrage;
})();
