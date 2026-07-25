/*
 * Cosmic Dash — a minimalist endless runner.
 *
 * A gold cube auto-runs across a starlit night. Tap / click / press Space (or
 * ↑) to jump; a second press while airborne is a double jump. Obstacles scroll
 * in from the right — clear them. The world speeds up the longer you last, and
 * the obstacle spacing scales with speed so reaction time stays fair. Score is
 * the distance travelled; the best run is kept in localStorage.
 *
 * Kept deliberately minimalist: flat geometric shapes, a near-monochrome
 * indigo/gold palette, and a single accent colour for obstacles. Everything is
 * drawn from primitives at runtime, like the rest of the project.
 *
 * Created on demand via window.launchCosmicDash() so the Fantasia menu stays
 * the first screen.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 600;

  const GROUND_Y = H - 96; // top surface the cube rests on
  const PLAYER_X = 84;
  const SIZE = 30; // cube side

  const GRAVITY = 2400;
  const JUMP_V = -770; // apex ≈ 124px, clears every obstacle on a single jump
  const MAX_JUMPS = 2; // ground jump + one air (double) jump

  const SPEED_START = 232;
  const SPEED_MAX = 560;
  const SPEED_RAMP = 7; // px/s gained per second survived

  // Obstacle spacing is measured in *time* so it stays fair as speed climbs.
  const GAP_MIN = 0.95; // seconds of headroom before the next obstacle
  const GAP_MAX = 1.7;

  const OBST_W_MIN = 20;
  const OBST_W_MAX = 52;
  const OBST_H_MIN = 26;
  const OBST_H_MAX = 70;

  const ACCENT = 0xf0b94a; // player gold (matches the Fantasia title)
  const OBSTACLE = 0x8f86ea; // soft violet
  const GROUND = 0x2a2350;

  const HS_KEY = "cosmic-dash-highscore";

  class CosmicDashScene extends Phaser.Scene {
    constructor() {
      super("CosmicDashScene");
    }

    create() {
      this.buildTextures();

      this.add.image(0, 0, "cd-bg").setOrigin(0, 0).setDepth(-20);

      // Ground band + a top edge line for a crisp horizon.
      this.add.rectangle(0, GROUND_Y, W, H - GROUND_Y, GROUND).setOrigin(0, 0).setDepth(-10);
      this.groundGfx = this.add.graphics().setDepth(-9); // scrolling speed ticks

      this.trail = this.add.graphics().setDepth(4);
      this.player = this.add.image(PLAYER_X, GROUND_Y - SIZE / 2, "cd-cube").setDepth(6);

      this.startBest = this.loadHigh();
      this.reset();

      this.buildUI();
      this.bindInput();
    }

    reset() {
      this.speed = SPEED_START;
      this.distance = 0;
      this.score = 0;
      this.best = this.startBest;
      this.playing = true;
      this.started = false; // grace period until the first jump

      this.vy = 0;
      this.jumps = 0;
      this.onGround = true;
      this.player.setY(GROUND_Y - SIZE / 2).setRotation(0);

      this.obstacles = [];
      this.nextIn = 0.6; // seconds until the first obstacle
      this.tickOffset = 0;
    }

    /* ---------- textures ---------- */

    buildTextures() {
      if (this.textures.exists("cd-bg")) return;
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Vertical indigo gradient.
      const top = Phaser.Display.Color.ValueToColor(0x1b1440);
      const bot = Phaser.Display.Color.ValueToColor(0x0a0722);
      const strips = 48;
      const sh = Math.ceil(H / strips);
      for (let i = 0; i < strips; i++) {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
        g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
        g.fillRect(0, i * sh, W, sh + 1);
      }
      // A sparse, static dusting of stars.
      const rng = new Phaser.Math.RandomDataGenerator(["cosmic-dash"]);
      for (let i = 0; i < 60; i++) {
        const x = rng.between(0, W);
        const y = rng.between(0, GROUND_Y - 20);
        const r = rng.pick([0.6, 0.8, 1, 1.2, 1.6]);
        g.fillStyle(0xffffff, rng.pick([0.35, 0.5, 0.7, 0.9]));
        g.fillCircle(x, y, r);
      }
      g.generateTexture("cd-bg", W, H);

      // Player cube: rounded gold square with a subtle inner highlight.
      g.clear();
      g.fillStyle(ACCENT, 1);
      g.fillRoundedRect(0, 0, SIZE, SIZE, 7);
      g.fillStyle(0xffffff, 0.28);
      g.fillRoundedRect(4, 4, SIZE - 8, (SIZE - 8) * 0.42, 4);
      g.generateTexture("cd-cube", SIZE, SIZE);

      g.destroy();
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.scoreText = this.add
        .text(16, 14, "0", {
          fontFamily: "Arial, sans-serif",
          fontSize: "40px",
          color: "#ffffff",
          stroke: "#1b1440",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setDepth(30);

      this.bestText = this.add
        .text(W - 16, 20, "BEST " + this.best, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#d8cdff",
          stroke: "#1b1440",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setOrigin(1, 0)
        .setDepth(30);

      this.hint = this.add
        .text(W / 2, H * 0.4, "TAP TO JUMP", {
          fontFamily: "Arial, sans-serif",
          fontSize: "24px",
          color: "#ffe7a3",
          stroke: "#1b1440",
          strokeThickness: 5,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);
      this.tweens.add({
        targets: this.hint,
        alpha: 0.35,
        duration: 620,
        yoyo: true,
        repeat: -1,
      });
    }

    /* ---------- input ---------- */

    bindInput() {
      this.input.on("pointerdown", () => this.jump());
      this.input.keyboard.on("keydown-SPACE", () => this.jump());
      this.input.keyboard.on("keydown-UP", () => this.jump());
    }

    jump() {
      if (!this.playing) return;
      if (!this.started) {
        this.started = true;
        if (this.hint) {
          this.tweens.killTweensOf(this.hint);
          this.tweens.add({ targets: this.hint, alpha: 0, duration: 180, onComplete: () => this.hint.destroy() });
        }
      }
      if (this.jumps >= MAX_JUMPS) return;
      this.vy = JUMP_V;
      this.jumps += 1;
      this.onGround = false;
    }

    /* ---------- obstacles ---------- */

    spawnObstacle() {
      const w = Phaser.Math.Between(OBST_W_MIN, OBST_W_MAX);
      const h = Phaser.Math.Between(OBST_H_MIN, OBST_H_MAX);
      const rect = this.add
        .rectangle(W + w, GROUND_Y - h, w, h, OBSTACLE)
        .setOrigin(0, 0)
        .setDepth(5);
      this.obstacles.push(rect);

      // Space the next one out by a time gap that shrinks slightly as you speed
      // up but never below GAP_MIN, so runs stay clearable.
      const t = Phaser.Math.Clamp((this.speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
      const lo = Phaser.Math.Linear(GAP_MAX, GAP_MIN + 0.15, t);
      this.nextIn = Phaser.Math.FloatBetween(lo, lo + 0.6);
    }

    hitsPlayer(rect) {
      // Slightly inset the player box so grazes feel fair.
      const pad = 4;
      const px = PLAYER_X + pad;
      const py = this.player.y - SIZE / 2 + pad;
      const pw = SIZE - pad * 2;
      const ph = SIZE - pad * 2;
      return (
        px < rect.x + rect.width &&
        px + pw > rect.x &&
        py < rect.y + rect.height &&
        py + ph > rect.y
      );
    }

    /* ---------- per-frame ---------- */

    update(time, delta) {
      const dt = Math.min(delta, 50) / 1000; // clamp big frames after a stall
      if (!this.playing) return;

      if (this.started) {
        this.speed = Math.min(SPEED_MAX, this.speed + SPEED_RAMP * dt);
        this.distance += this.speed * dt;
        const s = Math.floor(this.distance / 10);
        if (s !== this.score) {
          this.score = s;
          this.scoreText.setText(String(s));
          if (s > this.best) {
            this.best = s;
            this.bestText.setText("BEST " + s);
          }
        }
      }

      // Player kinematics.
      this.vy += GRAVITY * dt;
      let py = this.player.y + this.vy * dt;
      const rest = GROUND_Y - SIZE / 2;
      if (py >= rest) {
        py = rest;
        this.vy = 0;
        this.jumps = 0;
        this.onGround = true;
      }
      this.player.setY(py);
      // Gentle tilt while airborne for a bit of life.
      this.player.setRotation(this.onGround ? 0 : Phaser.Math.Clamp(this.vy / 2600, -0.4, 0.4));
      this.drawTrail();

      // Scrolling ground ticks.
      this.tickOffset = (this.tickOffset + this.speed * dt) % 40;
      this.drawGround();

      if (!this.started) return;

      // Obstacles.
      this.nextIn -= dt;
      if (this.nextIn <= 0) this.spawnObstacle();

      const dx = this.speed * dt;
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        o.x -= dx;
        if (o.x + o.width < -4) {
          o.destroy();
          this.obstacles.splice(i, 1);
          continue;
        }
        if (this.hitsPlayer(o)) {
          this.gameOver();
          return;
        }
      }
    }

    drawTrail() {
      const g = this.trail;
      g.clear();
      for (let i = 1; i <= 3; i++) {
        g.fillStyle(ACCENT, 0.16 - i * 0.03);
        g.fillRoundedRect(PLAYER_X - i * 9, this.player.y - SIZE / 2 + 3, SIZE - 6, SIZE - 6, 6);
      }
    }

    drawGround() {
      const g = this.groundGfx;
      g.clear();
      g.lineStyle(2, 0x6b5fae, 0.9);
      g.lineBetween(0, GROUND_Y, W, GROUND_Y);
      g.fillStyle(0x4b4088, 0.7);
      for (let x = -this.tickOffset; x < W; x += 40) {
        g.fillRect(x, GROUND_Y + 16, 14, 3);
      }
    }

    /* ---------- end / persistence ---------- */

    gameOver() {
      if (!this.playing) return;
      this.playing = false;
      this.saveHigh();

      // A brief flash + shake for impact.
      this.cameras.main.shake(160, 0.012);
      const flash = this.add.rectangle(0, 0, W, H, 0xffffff, 0.5).setOrigin(0, 0).setDepth(50);
      this.tweens.add({ targets: flash, alpha: 0, duration: 220, onComplete: () => flash.destroy() });

      this.showFinal();
    }

    showFinal() {
      const dim = this.add.rectangle(0, 0, W, H, 0x0a0722, 0.62).setOrigin(0, 0).setDepth(60);

      this.add
        .text(W / 2, H * 0.28, "CRASH!", {
          fontFamily: "Arial, sans-serif",
          fontSize: "48px",
          color: "#ffffff",
          stroke: "#1b1440",
          strokeThickness: 8,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(61);

      const isBest = this.score > this.startBest;
      this.add
        .text(
          W / 2,
          H * 0.45,
          "SCORE  " + this.score + "\nBEST   " + this.best + (isBest ? "   ★NEW!" : ""),
          {
            fontFamily: "Arial, sans-serif",
            fontSize: "24px",
            color: "#d8cdff",
            align: "center",
            fontStyle: "bold",
          }
        )
        .setOrigin(0.5)
        .setDepth(61);

      this.makeButton(W / 2, H * 0.63, "▸ Play Again", () => this.scene.restart());
      this.makeButton(W / 2, H * 0.63 + 54, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }

    makeButton(x, y, label, onClick) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          color: "#3a2500",
          backgroundColor: "#f0b94a",
          padding: { x: 16, y: 9 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(62)
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

  function launchCosmicDash() {
    if (window.cosmicDashGame) return window.cosmicDashGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#0a0722",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [CosmicDashScene],
    };
    const game = new Phaser.Game(config);
    window.cosmicDashGame = game;
    return game;
  }

  window.launchCosmicDash = launchCosmicDash;
})();
