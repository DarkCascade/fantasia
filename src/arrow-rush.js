/*
 * Arrow Rush — a 20-second archery accuracy game.
 *
 * Targets pop up every couple of seconds and only last 3–5 seconds. Press and
 * hold to aim: a reticle starts large & red, tightens to medium & yellow, then
 * small & green — the longer you hold, the tighter the shot scatter. Release to
 * loose an arrow. Hit targets for points (100 base, scaled by how short-lived
 * the target was and by your consecutive-hit combo). Miss, or let a target
 * expire, and the combo resets. All art is generated at runtime from
 * primitives, like the rest of the project.
 *
 * Created on demand via window.launchArrowRush() so the Fantasia menu stays
 * the first screen.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 600;

  const GAME_TIME = 20; // seconds
  const SPAWN_EVERY = 1500; // ms between new targets
  const LIFE_MIN = 3; // target lifespan range (seconds)
  const LIFE_MAX = 5;
  const TARGET_R = 26; // target hit radius
  const BASE_POINTS = 100;

  // Reticle: radius doubles as the shot's scatter spread. Charging shrinks it
  // from large/red through medium/yellow to small/green over CHARGE_MS.
  const R_LARGE = 48;
  const R_SMALL = 9;
  const CHARGE_MS = 900;

  const HS_KEY = "arrow-rush-highscore";

  // Shorter-lived targets are worth more: 3s -> 1.5x, 5s -> 0.75x (linear).
  function durationMult(life) {
    return 1.5 - 0.375 * (life - 3);
  }

  class ArrowRushScene extends Phaser.Scene {
    constructor() {
      super("ArrowRushScene");
    }

    create() {
      this.score = 0;
      this.combo = 0;
      this.startBest = this.loadHigh();
      this.best = this.startBest;
      this.timeLeft = GAME_TIME;
      this.playing = true;

      this.charging = false;
      this.aim = { x: W / 2, y: H / 2 };
      this.pressAt = 0;
      this.targets = [];

      this.buildTextures();
      this.buildBackground();
      this.buildUI();

      this.reticleGfx = this.add.graphics().setDepth(40);

      this.bindInput();

      this.spawnEvent = this.time.addEvent({
        delay: SPAWN_EVERY,
        loop: true,
        callback: () => this.spawnTarget(),
      });
      this.spawnTarget();
    }

    /* ---------- textures ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      if (!this.textures.exists("ar-bg")) {
        const top = Phaser.Display.Color.ValueToColor(0x9fd0f0);
        const bot = Phaser.Display.Color.ValueToColor(0xeaf7e0);
        const strips = 48;
        const sh = Math.ceil(H / strips);
        for (let i = 0; i < strips; i++) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
          g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
          g.fillRect(0, i * sh, W, sh + 1);
        }
        g.generateTexture("ar-bg", W, H);
      }

      if (!this.textures.exists("ar-target")) {
        const R = TARGET_R;
        const d = R * 2 + 4;
        const c = d / 2;
        g.clear();
        const rings = [
          [R, 0xffffff],
          [R * 0.82, 0x2b2b2b],
          [R * 0.64, 0x2f7ec8],
          [R * 0.46, 0xd23b2e],
          [R * 0.28, 0xffd23f],
        ];
        for (const [rr, col] of rings) {
          g.fillStyle(col, 1);
          g.fillCircle(c, c, rr);
        }
        g.lineStyle(2, 0x222222, 1);
        g.strokeCircle(c, c, R);
        g.generateTexture("ar-target", d, d);
      }

      g.destroy();
    }

    /* ---------- world & UI ---------- */

    buildBackground() {
      this.add.image(0, 0, "ar-bg").setOrigin(0, 0).setDepth(-20);
      // grass band
      this.add.rectangle(0, H - 40, W, 40, 0x7ac04a).setOrigin(0, 0).setDepth(-19);
    }

    buildUI() {
      this.scoreText = this.add
        .text(14, 12, "0", {
          fontFamily: "Arial, sans-serif",
          fontSize: "40px",
          color: "#ffffff",
          stroke: "#2c5a1e",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setDepth(30);

      this.bestText = this.add
        .text(16, 58, "BEST " + this.best, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          stroke: "#2c5a1e",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setDepth(30);

      this.timeText = this.add
        .text(W - 14, 12, String(GAME_TIME), {
          fontFamily: "Arial, sans-serif",
          fontSize: "40px",
          color: "#ffffff",
          stroke: "#8a3a12",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setOrigin(1, 0)
        .setDepth(30);

      this.comboText = this.add
        .text(W / 2, 74, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "24px",
          color: "#ffd23f",
          stroke: "#8a3a12",
          strokeThickness: 5,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30)
        .setVisible(false);
    }

    /* ---------- targets ---------- */

    spawnTarget() {
      if (!this.playing) return;
      const life = Phaser.Math.FloatBetween(LIFE_MIN, LIFE_MAX);
      const x = Phaser.Math.Between(46, W - 46);
      const y = Phaser.Math.Between(118, H - 74);
      const spr = this.add.image(x, y, "ar-target").setDepth(10).setScale(0);
      this.tweens.add({ targets: spr, scale: 1, duration: 170, ease: "Back.easeOut" });
      const ring = this.add.graphics().setDepth(11);
      this.targets.push({
        spr: spr,
        ring: ring,
        x: x,
        y: y,
        life: life,
        born: this.time.now,
        mult: durationMult(life),
        alive: true,
      });
    }

    drawCountdown(t, frac) {
      const g = t.ring;
      g.clear();
      g.lineStyle(3, frac < 0.34 ? 0xe23b3b : 0xffffff, 0.9);
      g.beginPath();
      g.arc(t.x, t.y, TARGET_R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
      g.strokePath();
    }

    expireTarget(t) {
      if (!t.alive) return;
      t.alive = false;
      this.combo = 0; // a target expiring breaks the combo
      this.removeTarget(t, false);
      this.updateUI();
    }

    removeTarget(t, wasHit) {
      const idx = this.targets.indexOf(t);
      if (idx >= 0) this.targets.splice(idx, 1);
      t.ring.destroy();
      if (wasHit) {
        this.tweens.add({ targets: t.spr, scale: 1.6, alpha: 0, duration: 170, onComplete: () => t.spr.destroy() });
      } else {
        this.tweens.add({ targets: t.spr, scale: 0.7, alpha: 0, duration: 220, onComplete: () => t.spr.destroy() });
      }
    }

    /* ---------- input & firing ---------- */

    bindInput() {
      this.input.on("pointerdown", (pt) => {
        if (!this.playing) return;
        this.charging = true;
        this.pressAt = this.time.now;
        this.aim = { x: pt.x, y: pt.y };
      });
      this.input.on("pointermove", (pt) => {
        if (this.charging) this.aim = { x: pt.x, y: pt.y };
      });
      this.input.on("pointerup", (pt) => {
        if (!this.charging) return;
        this.aim = { x: pt.x, y: pt.y };
        this.fire();
      });
    }

    chargeProgress() {
      return Phaser.Math.Clamp((this.time.now - this.pressAt) / CHARGE_MS, 0, 1);
    }

    reticleRadius(p) {
      return R_LARGE + (R_SMALL - R_LARGE) * p;
    }

    fire() {
      this.charging = false;
      if (!this.playing) return;

      const p = this.chargeProgress();
      const spread = this.reticleRadius(p);

      // Scatter uniformly within the reticle disk.
      const ang = Math.random() * Math.PI * 2;
      const dist = spread * Math.sqrt(Math.random());
      const sx = this.aim.x + Math.cos(ang) * dist;
      const sy = this.aim.y + Math.sin(ang) * dist;

      this.impactMark(sx, sy);

      // Nearest target whose hit disk contains the shot.
      let hit = null;
      let hd = Infinity;
      for (const t of this.targets) {
        if (!t.alive) continue;
        const d = Math.hypot(sx - t.x, sy - t.y);
        if (d <= TARGET_R && d < hd) {
          hd = d;
          hit = t;
        }
      }

      if (hit) this.onHit(hit);
      else this.onMiss(sx, sy);
    }

    onHit(t) {
      t.alive = false;
      this.combo += 1;
      const pts = Math.round(BASE_POINTS * t.mult * this.combo);
      this.score += pts;
      this.floatText(t.x, t.y - 6, "+" + pts, 0x36c15a);
      this.removeTarget(t, true);
      this.updateUI();
    }

    onMiss(sx, sy) {
      this.combo = 0;
      this.floatText(sx, sy, "MISS", 0xe23b3b);
      this.updateUI();
    }

    /* ---------- feedback ---------- */

    impactMark(x, y) {
      const dot = this.add.circle(x, y, 4, 0x333333, 0.8).setDepth(35);
      this.tweens.add({ targets: dot, alpha: 0, scale: 1.8, duration: 260, onComplete: () => dot.destroy() });
    }

    floatText(x, y, msg, color) {
      const t = this.add
        .text(x, y, msg, {
          fontFamily: "Arial, sans-serif",
          fontSize: "20px",
          color: Phaser.Display.Color.IntegerToColor(color).rgba,
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(36);
      this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 620, onComplete: () => t.destroy() });
    }

    updateUI() {
      this.scoreText.setText(String(this.score));
      if (this.score > this.best) {
        this.best = this.score;
        this.bestText.setText("BEST " + this.best);
      }
      if (this.combo >= 2) {
        this.comboText.setText("COMBO x" + this.combo).setVisible(true);
        this.comboText.setScale(1.3);
        this.tweens.add({ targets: this.comboText, scale: 1, duration: 120, ease: "Quad.easeOut" });
      } else {
        this.comboText.setVisible(false);
      }
    }

    /* ---------- per-frame ---------- */

    update(time, delta) {
      if (this.playing) {
        this.timeLeft -= delta / 1000;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.endGame();
        }
        this.timeText.setText(String(Math.ceil(this.timeLeft)));

        for (let i = this.targets.length - 1; i >= 0; i--) {
          const t = this.targets[i];
          if (!t.alive) continue;
          const left = t.life - (this.time.now - t.born) / 1000;
          this.drawCountdown(t, Math.max(left, 0) / t.life);
          if (left <= 0) this.expireTarget(t);
        }
      }

      this.drawReticle();
    }

    drawReticle() {
      const g = this.reticleGfx;
      g.clear();
      if (!this.charging || !this.playing) return;
      const p = this.chargeProgress();
      const r = this.reticleRadius(p);
      const color = p < 0.4 ? 0xe23b3b : p < 0.8 ? 0xffd23f : 0x36c15a;
      g.lineStyle(3, color, 1);
      g.strokeCircle(this.aim.x, this.aim.y, r);
      // crosshair ticks
      const tk = 7;
      g.lineBetween(this.aim.x - r - tk, this.aim.y, this.aim.x - r + 2, this.aim.y);
      g.lineBetween(this.aim.x + r - 2, this.aim.y, this.aim.x + r + tk, this.aim.y);
      g.lineBetween(this.aim.x, this.aim.y - r - tk, this.aim.x, this.aim.y - r + 2);
      g.lineBetween(this.aim.x, this.aim.y + r - 2, this.aim.x, this.aim.y + r + tk);
      g.fillStyle(color, 1);
      g.fillCircle(this.aim.x, this.aim.y, 2);
    }

    /* ---------- end / persistence ---------- */

    endGame() {
      if (!this.playing) return;
      this.playing = false;
      if (this.spawnEvent) this.spawnEvent.remove();
      this.charging = false;
      this.reticleGfx.clear();

      // Fade any remaining targets (no combo penalty once time is up).
      this.targets.slice().forEach((t) => {
        if (!t.alive) return;
        t.alive = false;
        t.ring.destroy();
        this.tweens.add({ targets: t.spr, alpha: 0, duration: 200, onComplete: () => t.spr.destroy() });
      });
      this.targets = [];

      this.saveHigh();
      this.showFinal();
    }

    showFinal() {
      const panel = this.add.container(0, 0).setDepth(60);
      const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0);
      const over = this.add
        .text(W / 2, H * 0.26, "TIME!", {
          fontFamily: "Arial, sans-serif",
          fontSize: "48px",
          color: "#ffffff",
          stroke: "#8a3a12",
          strokeThickness: 8,
          fontStyle: "bold",
        })
        .setOrigin(0.5);

      const isBest = this.score > this.startBest;
      const stats = this.add
        .text(
          W / 2,
          H * 0.44,
          "SCORE  " + this.score + "\nBEST   " + this.best + (isBest ? "   ★NEW!" : ""),
          {
            fontFamily: "Arial, sans-serif",
            fontSize: "24px",
            color: "#ffffff",
            stroke: "#2c5a1e",
            strokeThickness: 5,
            align: "center",
            fontStyle: "bold",
          }
        )
        .setOrigin(0.5);

      panel.add([dim, over, stats]);

      this.makeButton(W / 2, H * 0.62, "▸ Play Again", () => this.scene.restart());
      this.makeButton(W / 2, H * 0.62 + 54, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }

    makeButton(x, y, label, onClick) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          color: "#ffffff",
          backgroundColor: "#8a3a12",
          padding: { x: 16, y: 9 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(61)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    loadHigh() {
      try {
        const v = parseInt(localStorage.getItem(HS_KEY), 10);
        return Number.isFinite(v) ? v : 0;
      } catch (e) {
        return 0;
      }
    }

    saveHigh() {
      try {
        if (this.score > this.startBest) localStorage.setItem(HS_KEY, String(this.score));
      } catch (e) {
        /* storage may be unavailable; ignore */
      }
    }
  }

  function launchArrowRush() {
    if (window.arrowGame) return window.arrowGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#9fd0f0",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [ArrowRushScene],
    };
    const game = new Phaser.Game(config);
    window.arrowGame = game;
    return game;
  }

  window.launchArrowRush = launchArrowRush;
})();
