/*
 * Star Catcher — a tiny catch-and-dodge arcade game (my own design).
 *
 * Slide a glowing crescent scoop along the bottom of a starry night sky and
 * catch the falling stars for points. Consecutive catches build a combo
 * multiplier; let a star slip past and the combo resets. Meteors fall too —
 * scoop one by mistake and you lose a life. Three lost lives ends the run.
 * The longer you last, the faster (and meaner) the sky gets.
 *
 * Design goals, matched to the rest of Fantasia:
 *   - short, one-input, instantly repeatable
 *   - all art generated at runtime from primitives (no external assets)
 *   - works with mouse, touch, or arrow keys
 *
 * The Phaser game is created on demand via window.launchStarCatcher(), so the
 * Fantasia menu stays the first screen.
 */
(function () {
  "use strict";

  const S_WIDTH = 400;
  const S_HEIGHT = 600;

  const CATCHER_Y = S_HEIGHT - 74; // vertical line the scoop rides on
  const CATCHER_W = 96; // scoop texture width
  const CATCH_HALF = 46; // half-width of the catch zone (a touch wider than art)
  const CATCHER_MARGIN = 30; // keep the scoop clear of the side walls
  const CATCHER_KEY_SPEED = 620; // px/s when steering with the arrow keys
  const CATCHER_LERP = 20; // how snappily the scoop chases its target x

  const STAR_R = 15;
  const METEOR_R = 15;

  const START_LIVES = 3;

  // Difficulty ramps with score: things fall faster, spawn sooner, and turn
  // meaner (more meteors) the higher you climb. Everything is clamped so a long
  // run stays hard-but-fair rather than impossible.
  const BASE_FALL = 135; // px/s at score 0
  const FALL_PER_POINT = 3.4; // added fall speed per point
  const MAX_FALL = 430;

  const BASE_SPAWN = 820; // ms between drops at score 0
  const SPAWN_PER_POINT = 9; // ms shaved per point
  const MIN_SPAWN = 340;

  const BASE_METEOR_CHANCE = 0.16;
  const METEOR_CHANCE_PER_POINT = 0.006;
  const MAX_METEOR_CHANCE = 0.42;

  class StarCatcherScene extends Phaser.Scene {
    constructor() {
      super("StarCatcherScene");
    }

    create() {
      this.buildTextures();

      this.add.image(0, 0, "sc-sky").setOrigin(0, 0).setDepth(-20);

      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.lives = START_LIVES;
      this.gameOver = false;
      this.spawnTimer = 0;
      this.falling = []; // { sprite, type: "star" | "meteor", vy, done }

      // The scoop. It lives on a fixed y and only slides horizontally.
      this.catcherX = S_WIDTH / 2;
      this.targetX = S_WIDTH / 2;
      this.catcher = this.add.image(this.catcherX, CATCHER_Y, "sc-scoop").setDepth(10);

      // Sparkle burst played whenever a star is caught (juice).
      this.sparkles = this.add
        .particles(0, 0, "sc-spark", {
          lifespan: 460,
          speed: { min: 60, max: 190 },
          angle: { min: 0, max: 360 },
          scale: { start: 1, end: 0 },
          gravityY: 320,
          emitting: false,
        })
        .setDepth(12);

      this.buildUI();
      this.bindInput();
    }

    /* ---------- procedural textures (generated once) ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Night sky: a vertical gradient dusted with faint stars and a moon.
      if (!this.textures.exists("sc-sky")) {
        const top = Phaser.Display.Color.ValueToColor(0x1b1440);
        const bot = Phaser.Display.Color.ValueToColor(0x05030f);
        const strips = 60;
        const sh = Math.ceil(S_HEIGHT / strips);
        for (let i = 0; i < strips; i++) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
          g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
          g.fillRect(0, i * sh, S_WIDTH, sh + 1);
        }
        // A calm crescent moon in the upper-left, carved by overdrawing sky.
        g.fillStyle(0xf6e6a8, 1);
        g.fillCircle(70, 92, 34);
        g.fillStyle(0x140f33, 1);
        g.fillCircle(84, 82, 32); // the carve gives the crescent its bite
        // Scattered background stars (fixed positions, purely decorative).
        const rng = new Phaser.Math.RandomDataGenerator(["fantasia-stars"]);
        for (let i = 0; i < 90; i++) {
          const x = rng.between(0, S_WIDTH);
          const y = rng.between(0, S_HEIGHT - 90);
          const a = rng.realInRange(0.25, 0.9);
          const r = rng.realInRange(0.6, 1.7);
          g.fillStyle(0xffffff, a);
          g.fillCircle(x, y, r);
        }
        g.generateTexture("sc-sky", S_WIDTH, S_HEIGHT);
        g.clear();
      }

      // Gold five-point star (the thing to catch).
      if (!this.textures.exists("sc-star")) {
        this.drawStar(g, STAR_R + 4, STAR_R + 4, STAR_R, STAR_R * 0.42, 0xffe27a, 0xb87f18);
        g.generateTexture("sc-star", (STAR_R + 4) * 2, (STAR_R + 4) * 2);
        g.clear();
      }

      // Meteor: a jagged dark-red rock with a warm rim (the thing to dodge).
      if (!this.textures.exists("sc-meteor")) {
        const cx = METEOR_R + 4;
        const cy = METEOR_R + 4;
        const pts = [];
        const spikes = 9;
        for (let i = 0; i < spikes * 2; i++) {
          const rad = i % 2 === 0 ? METEOR_R : METEOR_R * 0.74;
          const ang = (Math.PI * i) / spikes - Math.PI / 2;
          pts.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
        }
        g.fillStyle(0x8f2d1f, 1);
        g.fillPoints(pts, true);
        g.fillStyle(0xc9452c, 1);
        g.fillCircle(cx - 3, cy - 3, METEOR_R * 0.5); // hot highlight
        g.fillStyle(0x5c1a12, 1);
        g.fillCircle(cx + 4, cy + 4, METEOR_R * 0.26); // crater
        g.generateTexture("sc-meteor", cx * 2, cy * 2);
        g.clear();
      }

      // The scoop: a thick upward-opening crescent with a soft glow and horn
      // tips, reading clearly as a catcher.
      if (!this.textures.exists("sc-scoop")) {
        const cx = CATCHER_W / 2;
        const cy = 12;
        const r = 40;
        const a0 = Math.PI * 0.16; // arc spans the bottom of the circle → a cup
        const a1 = Math.PI * 0.84;
        // Outer glow.
        g.lineStyle(16, 0xffe27a, 0.18);
        g.beginPath();
        g.arc(cx, cy, r, a0, a1, false);
        g.strokePath();
        // Main gold band.
        g.lineStyle(8, 0xffd766, 1);
        g.beginPath();
        g.arc(cx, cy, r, a0, a1, false);
        g.strokePath();
        // Inner bright edge.
        g.lineStyle(3, 0xfff4c8, 1);
        g.beginPath();
        g.arc(cx, cy, r, a0, a1, false);
        g.strokePath();
        // Horn tips (crescent-moon flourish).
        g.fillStyle(0xfff4c8, 1);
        g.fillCircle(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 5);
        g.fillCircle(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 5);
        g.generateTexture("sc-scoop", CATCHER_W, r + cy + 8);
        g.clear();
      }

      // Sparkle chip for the catch burst.
      if (!this.textures.exists("sc-spark")) {
        g.fillStyle(0xfff4c8, 1);
        g.fillCircle(4, 4, 4);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 2);
        g.generateTexture("sc-spark", 8, 8);
        g.clear();
      }

      g.destroy();
    }

    // Draw a filled star with an outline into a graphics object.
    drawStar(g, cx, cy, outer, inner, fill, stroke) {
      const pts = [];
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const ang = (Math.PI * i) / points - Math.PI / 2;
        pts.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
      }
      g.fillStyle(fill, 1);
      g.fillPoints(pts, true);
      g.lineStyle(2, stroke, 1);
      g.strokePath();
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.scoreText = this.add
        .text(S_WIDTH / 2, 18, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
          color: "#ffffff",
          stroke: "#1b1440",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setOrigin(0.5, 0)
        .setDepth(30);

      this.livesText = this.add
        .text(S_WIDTH - 14, 18, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
          color: "#ffffff",
          stroke: "#1b1440",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setOrigin(1, 0)
        .setDepth(30);

      this.comboText = this.add
        .text(S_WIDTH / 2, 46, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#ffe27a",
          stroke: "#1b1440",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setOrigin(0.5, 0)
        .setDepth(30);

      this.hint = this.add
        .text(S_WIDTH / 2, S_HEIGHT - 34, "Slide to catch stars — dodge the meteors!", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#d8cdff",
          stroke: "#1b1440",
          strokeThickness: 4,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.makeButton(14, 16, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }).setOrigin(0, 0);

      this.refreshHud();
    }

    makeButton(x, y, labelText, onClick) {
      const t = this.add
        .text(x, y, labelText, {
          fontFamily: "Arial, sans-serif",
          fontSize: "15px",
          color: "#ffffff",
          backgroundColor: "#3a2f6e",
          padding: { x: 10, y: 6 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(31)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    refreshHud() {
      this.scoreText.setText("Score  " + this.score);
      this.livesText.setText("Lives  " + "★".repeat(this.lives) + "·".repeat(START_LIVES - this.lives));
      const mult = this.multiplier();
      this.comboText.setText(this.combo >= 2 ? "Combo x" + mult + "  (" + this.combo + ")" : "");
    }

    /* ---------- input ---------- */

    bindInput() {
      // Pointer / touch: steer the scoop toward wherever you point.
      this.input.on("pointerdown", (p) => this.aimAt(p));
      this.input.on("pointermove", (p) => {
        if (p.isDown || this.sys.game.device.input.touch === false) this.aimAt(p);
      });
      // Keyboard: arrow keys / A-D nudge the target left and right.
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keyA = this.input.keyboard.addKey("A");
      this.keyD = this.input.keyboard.addKey("D");
    }

    aimAt(p) {
      if (this.gameOver) return;
      this.targetX = Phaser.Math.Clamp(p.x, CATCHER_MARGIN, S_WIDTH - CATCHER_MARGIN);
    }

    /* ---------- difficulty ---------- */

    fallSpeed() {
      return Math.min(BASE_FALL + this.score * FALL_PER_POINT, MAX_FALL);
    }
    spawnInterval() {
      return Math.max(BASE_SPAWN - this.score * SPAWN_PER_POINT, MIN_SPAWN);
    }
    meteorChance() {
      return Math.min(BASE_METEOR_CHANCE + this.score * METEOR_CHANCE_PER_POINT, MAX_METEOR_CHANCE);
    }
    multiplier() {
      return Math.min(1 + Math.floor(this.combo / 4), 5);
    }

    /* ---------- spawning ---------- */

    spawnDrop() {
      const isMeteor = Math.random() < this.meteorChance();
      const x = Phaser.Math.Between(24, S_WIDTH - 24);
      const key = isMeteor ? "sc-meteor" : "sc-star";
      const sprite = this.add.image(x, -20, key).setDepth(6);
      // Stars twinkle-spin; meteors tumble faster.
      const drop = {
        sprite,
        type: isMeteor ? "meteor" : "star",
        vy: this.fallSpeed() * Phaser.Math.FloatBetween(0.9, 1.12),
        spin: isMeteor ? Phaser.Math.FloatBetween(-4, 4) : Phaser.Math.FloatBetween(-1.5, 1.5),
        done: false,
      };
      this.falling.push(drop);
    }

    /* ---------- per-frame update ---------- */

    update(time, delta) {
      if (this.gameOver) return;
      const dt = delta / 1000;

      // Keyboard steering nudges the target position.
      let dir = 0;
      if (this.cursors.left.isDown || this.keyA.isDown) dir -= 1;
      if (this.cursors.right.isDown || this.keyD.isDown) dir += 1;
      if (dir !== 0) {
        this.targetX = Phaser.Math.Clamp(
          this.targetX + dir * CATCHER_KEY_SPEED * dt,
          CATCHER_MARGIN,
          S_WIDTH - CATCHER_MARGIN
        );
      }

      // Ease the scoop toward its target for a smooth glide.
      this.catcherX += (this.targetX - this.catcherX) * Math.min(1, dt * CATCHER_LERP);
      this.catcher.x = this.catcherX;

      // Spawn on a difficulty-scaled cadence.
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.spawnDrop();
        this.spawnTimer = this.spawnInterval();
      }

      // Advance every falling object and resolve catches / misses.
      for (const d of this.falling) {
        if (d.done) continue;
        d.sprite.y += d.vy * dt;
        d.sprite.rotation += d.spin * dt;

        const inBand = d.sprite.y >= CATCHER_Y - 20 && d.sprite.y <= CATCHER_Y + 20;
        const overlaps = Math.abs(d.sprite.x - this.catcherX) <= CATCH_HALF;

        if (inBand && overlaps) {
          d.done = true;
          if (d.type === "star") this.onCatchStar(d);
          else this.onCatchMeteor(d);
        } else if (d.sprite.y > S_HEIGHT + 24) {
          d.done = true;
          if (d.type === "star") this.onMissStar(); // meteors falling past are fine
          d.sprite.destroy();
        }
      }

      // Drop resolved objects from the list.
      if (this.falling.some((d) => d.done && !d.sprite.active)) {
        this.falling = this.falling.filter((d) => d.sprite.active);
      }
    }

    /* ---------- outcomes ---------- */

    onCatchStar(d) {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const gained = this.multiplier();
      this.score += gained;

      this.sparkles.explode(12, d.sprite.x, d.sprite.y);
      // A little pop on the caught star before it vanishes.
      this.tweens.add({
        targets: d.sprite,
        scale: 1.6,
        alpha: 0,
        duration: 160,
        ease: "Quad.easeOut",
        onComplete: () => d.sprite.destroy(),
      });
      this.flashScoop(0xfff4c8);
      if (this.hint) this.hint.setText("");
      this.refreshHud();
    }

    onMissStar() {
      // Missing a star only breaks the combo — no life lost.
      if (this.combo > 0) {
        this.combo = 0;
        this.refreshHud();
      }
    }

    onCatchMeteor(d) {
      this.combo = 0;
      this.lives -= 1;
      d.sprite.destroy();

      this.cameras.main.shake(180, 0.012);
      this.cameras.main.flash(160, 120, 20, 20);
      this.flashScoop(0xff6a55);
      this.refreshHud();

      if (this.lives <= 0) this.endGame();
    }

    flashScoop(tint) {
      this.catcher.setTint(tint);
      this.time.delayedCall(120, () => this.catcher.clearTint());
    }

    /* ---------- game over ---------- */

    endGame() {
      this.gameOver = true;

      // Fade the still-falling objects out of the way.
      for (const d of this.falling) {
        if (d.sprite.active) {
          this.tweens.add({ targets: d.sprite, alpha: 0, duration: 260, onComplete: () => d.sprite.destroy() });
        }
      }

      const panel = this.add.rectangle(S_WIDTH / 2, S_HEIGHT / 2, 300, 250, 0x140f33, 0.92).setDepth(40);
      panel.setStrokeStyle(3, 0xffd766, 0.9);

      this.add
        .text(S_WIDTH / 2, S_HEIGHT / 2 - 84, "Game Over", {
          fontFamily: "Georgia, serif",
          fontSize: "34px",
          color: "#ffe27a",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(41);

      this.add
        .text(
          S_WIDTH / 2,
          S_HEIGHT / 2 - 30,
          "Score  " + this.score + "\nBest combo  x" + Math.min(1 + Math.floor(this.bestCombo / 4), 5),
          {
            fontFamily: "Arial, sans-serif",
            fontSize: "18px",
            color: "#ffffff",
            align: "center",
            lineSpacing: 6,
          }
        )
        .setOrigin(0.5)
        .setDepth(41);

      this.makeMenuButton(S_WIDTH / 2, S_HEIGHT / 2 + 34, "▶  Play Again", "#2f8f4f", () => this.scene.restart());
      this.makeMenuButton(S_WIDTH / 2, S_HEIGHT / 2 + 84, "≡  Fantasia Menu", "#3a2f6e", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }

    makeMenuButton(x, y, labelText, bg, onClick) {
      const t = this.add
        .text(x, y, labelText, {
          fontFamily: "Arial, sans-serif",
          fontSize: "20px",
          color: "#ffffff",
          backgroundColor: bg,
          padding: { x: 18, y: 9 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(42)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }
  }

  function launchStarCatcher() {
    if (window.starCatcherGame) return window.starCatcherGame;
    const config = {
      type: Phaser.AUTO,
      width: S_WIDTH,
      height: S_HEIGHT,
      parent: "game-container",
      backgroundColor: "#05030f",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [StarCatcherScene],
    };
    const game = new Phaser.Game(config);
    window.starCatcherGame = game;
    return game;
  }

  window.launchStarCatcher = launchStarCatcher;
})();
