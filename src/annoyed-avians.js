/*
 * Annoyed Avians — a tiny Angry-Birds-style slingshot game.
 *
 * Uses Phaser's Matter physics: a random stack of crates sits on the right,
 * a bird waits on the left. Tap-and-hold the bird to pull back a launch
 * vector (billiards-style aim line + predicted arc), release to fling it at
 * the stack. All art is generated at runtime from primitives, like the rest
 * of the project — no external assets.
 *
 * The Phaser game is created on demand via window.launchAnnoyedAvians(), so
 * the Fantasia menu stays the first screen.
 */
(function () {
  "use strict";

  const A_WIDTH = 400;
  const A_HEIGHT = 600;
  const GROUND_H = 64;
  const FLOOR_Y = A_HEIGHT - GROUND_H; // top of the ground

  const BOX = 34; // crate side length
  const BIRD_R = 16; // bird radius
  const BIRD_X = 92; // far enough from the left edge to leave room to pull back
  const BIRD_Y = FLOOR_Y - 84; // resting height on the "slingshot"

  const MIN_BOXES = 3;
  const MAX_BOXES = 7;

  // Launch tuning. The launch vector points from the pointer back to the bird
  // (pull-back slingshot); power scales with how far you pull, capped so the
  // bird never moves more than a crate per physics step (no tunnelling).
  const MAX_PULL = 150;
  const VEL_SCALE = 0.12;
  const MAX_VEL = 17;
  // Per-step gravity for the guide arc, matched to Matter's effective gravity
  // so the predicted path lines up with where the bird actually lands.
  const PREVIEW_G = 0.68;

  class AviansScene extends Phaser.Scene {
    constructor() {
      super("AviansScene");
    }

    create() {
      this.launched = false;
      this.aiming = false;

      this.buildTextures();
      this.buildWorld();
      this.spawnStack();
      this.buildBird();

      this.aimGfx = this.add.graphics().setDepth(20);
      this.buildUI();
      this.bindInput();
    }

    /* ---------- procedural textures (generated once) ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Sky (simple vertical gradient via interpolated strips).
      if (!this.textures.exists("av-sky")) {
        const top = Phaser.Display.Color.ValueToColor(0x7ec8f0);
        const bot = Phaser.Display.Color.ValueToColor(0xd8f0ff);
        const strips = 48;
        const sh = Math.ceil(A_HEIGHT / strips);
        for (let i = 0; i < strips; i++) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
          g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
          g.fillRect(0, i * sh, A_WIDTH, sh + 1);
        }
        g.generateTexture("av-sky", A_WIDTH, A_HEIGHT);
      }

      // Ground strip (grass on dirt).
      if (!this.textures.exists("av-ground")) {
        g.clear();
        g.fillStyle(0xd8c887, 1);
        g.fillRect(0, 0, A_WIDTH, GROUND_H);
        g.fillStyle(0x74c53f, 1);
        g.fillRect(0, 0, A_WIDTH, 14);
        g.fillStyle(0x5aa82f, 1);
        g.fillRect(0, 12, A_WIDTH, 4);
        g.fillStyle(0xccbd6f, 1);
        for (let x = 8; x < A_WIDTH; x += 46) g.fillRect(x, 34, 5, 5);
        g.generateTexture("av-ground", A_WIDTH, GROUND_H);
      }

      // Wooden crate.
      if (!this.textures.exists("crate")) {
        g.clear();
        g.fillStyle(0xc98b3a, 1);
        g.fillRect(0, 0, BOX, BOX);
        g.fillStyle(0xb5772c, 1);
        g.fillRect(3, 3, BOX - 6, BOX - 6);
        g.lineStyle(3, 0x7c4a17, 1);
        g.strokeRect(1.5, 1.5, BOX - 3, BOX - 3);
        // diagonal braces
        g.lineStyle(2.5, 0x7c4a17, 1);
        g.lineBetween(3, 3, BOX - 3, BOX - 3);
        g.lineBetween(BOX - 3, 3, 3, BOX - 3);
        g.generateTexture("crate", BOX, BOX);
      }

      // Bird (round, angry-red with a beak and brow).
      if (!this.textures.exists("avian")) {
        const d = BIRD_R * 2 + 8;
        const cx = d / 2;
        const cy = BIRD_R + 2;
        g.clear();
        g.fillStyle(0xd23b2e, 1);
        g.fillCircle(cx, cy, BIRD_R);
        g.fillStyle(0xef6a55, 1);
        g.fillCircle(cx - 3, cy + 3, BIRD_R - 6); // belly highlight
        g.lineStyle(2, 0x8f2018, 1);
        g.strokeCircle(cx, cy, BIRD_R);
        // eye
        g.fillStyle(0xffffff, 1);
        g.fillCircle(cx + 5, cy - 4, 5);
        g.fillStyle(0x000000, 1);
        g.fillCircle(cx + 7, cy - 4, 2.4);
        // angry brow
        g.lineStyle(3, 0x000000, 1);
        g.lineBetween(cx + 1, cy - 10, cx + 11, cy - 6);
        // beak
        g.fillStyle(0xffb02e, 1);
        g.fillTriangle(cx + BIRD_R - 3, cy - 2, cx + BIRD_R + 7, cy + 2, cx + BIRD_R - 3, cy + 6);
        g.generateTexture("avian", d, d);
      }

      g.destroy();
    }

    /* ---------- world ---------- */

    buildWorld() {
      this.add.image(0, 0, "av-sky").setOrigin(0, 0).setDepth(-20);

      // Left/right walls (tall, so a hard launch stays in play); no top/bottom.
      this.matter.world.setBounds(0, -400, A_WIDTH, A_HEIGHT + 400, 60, true, true, false, false);

      // Visible ground with a matching static body.
      this.add.image(0, FLOOR_Y, "av-ground").setOrigin(0, 0).setDepth(-5);
      this.matter.add.rectangle(A_WIDTH / 2, FLOOR_Y + GROUND_H / 2, A_WIDTH, GROUND_H, {
        isStatic: true,
        friction: 0.9,
        label: "ground",
      });

      // A little perch under the bird, purely decorative.
      const perch = this.add.graphics().setDepth(-4);
      perch.fillStyle(0x8a5a2b, 1);
      perch.fillRect(BIRD_X - 6, BIRD_Y + BIRD_R, 12, FLOOR_Y - (BIRD_Y + BIRD_R));
    }

    spawnStack() {
      const n = Phaser.Math.Between(MIN_BOXES, MAX_BOXES);
      const stackX = A_WIDTH - 70;
      this.boxes = [];
      for (let i = 0; i < n; i++) {
        // Small gap so freshly-placed crates settle instead of overlapping.
        const y = FLOOR_Y - BOX / 2 - i * (BOX + 1);
        const box = this.matter.add.image(stackX, y, "crate");
        box.setFriction(0.6, 0.02);
        box.setBounce(0.03);
        box.setDepth(5);
        this.boxes.push(box);
      }
      this.boxCount = n;
    }

    buildBird() {
      this.bird = this.matter.add.image(BIRD_X, BIRD_Y, "avian");
      this.bird.setCircle(BIRD_R);
      this.bird.setFriction(0.4, 0.02);
      // Very low air friction so the flight is a clean parabola that matches
      // the predicted guide arc (and gentle shots still carry to the stack).
      this.bird.setFrictionAir(0.001);
      this.bird.setBounce(0.35);
      this.bird.setDepth(10);
      // Rest on the slingshot until launched.
      this.bird.setStatic(true);
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.add
        .text(A_WIDTH / 2, 30, "ANNOYED AVIANS", {
          fontFamily: "Arial, sans-serif",
          fontSize: "26px",
          color: "#ffffff",
          stroke: "#7c3a12",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.hint = this.add
        .text(A_WIDTH / 2, 64, "Drag the bird back, then release to launch", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#ffffff",
          stroke: "#7c3a12",
          strokeThickness: 4,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.makeButton(46, A_HEIGHT - 26, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
      this.makeButton(A_WIDTH - 46, A_HEIGHT - 26, "↺ Reset", () => this.scene.restart());
    }

    makeButton(x, y, label, onClick) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          backgroundColor: "#7c3a12",
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

    /* ---------- aiming & launch ---------- */

    bindInput() {
      this.input.on("pointerdown", (p) => {
        if (this.launched) return;
        const d = Phaser.Math.Distance.Between(p.x, p.y, this.bird.x, this.bird.y);
        if (d <= 44) {
          this.aiming = true;
          this.updateAim(p);
        }
      });

      this.input.on("pointermove", (p) => {
        if (this.aiming) this.updateAim(p);
      });

      this.input.on("pointerup", (p) => {
        if (this.aiming) this.release(p);
      });
    }

    // Compute the current launch vector from a pointer position: pull the bird
    // back and it fires the opposite way, power scaling with pull distance.
    computeLaunch(p) {
      const pullX = p.x - this.bird.x;
      const pullY = p.y - this.bird.y;
      let len = Math.sqrt(pullX * pullX + pullY * pullY);
      if (len < 0.0001) len = 0.0001;
      const clamped = Math.min(len, MAX_PULL);
      const dirX = -pullX / len;
      const dirY = -pullY / len;
      const speed = Math.min(clamped * VEL_SCALE, MAX_VEL);
      return { dirX, dirY, speed, pull: clamped };
    }

    updateAim(p) {
      const L = this.computeLaunch(p);
      this.launchVec = L;

      const g = this.aimGfx;
      g.clear();

      // Faint "pull" line from the bird to the pointer.
      g.lineStyle(2, 0xffffff, 0.35);
      g.lineBetween(this.bird.x, this.bird.y, p.x, p.y);

      // Predicted trajectory: a dotted arc using the launch velocity + gravity.
      let px = this.bird.x;
      let py = this.bird.y;
      let vx = L.dirX * L.speed;
      let vy = L.dirY * L.speed;
      g.fillStyle(0xffffff, 0.9);
      for (let i = 0; i < 60; i++) {
        vy += PREVIEW_G;
        px += vx;
        py += vy;
        if (py > FLOOR_Y - 2 || px < 0 || px > A_WIDTH || py < -60) break;
        if (i % 3 === 0) g.fillCircle(px, py, 2.2);
      }

      // Billiards-style aim arrow in the launch direction, length ∝ power.
      const arrowLen = 24 + L.pull * 0.7;
      const ax = this.bird.x + L.dirX * arrowLen;
      const ay = this.bird.y + L.dirY * arrowLen;
      g.lineStyle(3, 0xffd23f, 1);
      g.lineBetween(this.bird.x, this.bird.y, ax, ay);
      const ang = Math.atan2(L.dirY, L.dirX);
      const head = 9;
      g.fillStyle(0xffd23f, 1);
      g.fillTriangle(
        ax,
        ay,
        ax - head * Math.cos(ang - 0.4),
        ay - head * Math.sin(ang - 0.4),
        ax - head * Math.cos(ang + 0.4),
        ay - head * Math.sin(ang + 0.4)
      );
    }

    release(p) {
      const L = this.computeLaunch(p);
      this.aiming = false;
      this.aimGfx.clear();

      // Don't fire on an accidental tap with no pull.
      if (L.pull < 8) return;

      this.launched = true;
      if (this.hint) this.hint.setText("Nice shot! Tap ↺ Reset to play again");
      this.bird.setStatic(false);
      this.bird.setVelocity(L.dirX * L.speed, L.dirY * L.speed);
      this.bird.setAngularVelocity(0.2);
    }
  }

  function launchAnnoyedAvians() {
    if (window.aviansGame) return window.aviansGame;
    const config = {
      type: Phaser.AUTO,
      width: A_WIDTH,
      height: A_HEIGHT,
      parent: "game-container",
      backgroundColor: "#7ec8f0",
      physics: {
        default: "matter",
        matter: {
          gravity: { y: 1 },
          debug: false,
        },
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [AviansScene],
    };
    const game = new Phaser.Game(config);
    window.aviansGame = game;
    return game;
  }

  window.launchAnnoyedAvians = launchAnnoyedAvians;
})();
