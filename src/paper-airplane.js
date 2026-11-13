/*
 * Paper Airplane — a "Kinda Hard Golf"-style flick game.
 *
 * Drag anywhere to pull back, release to launch a paper plane through three
 * office levels (cork boards stick, glass bounces, desks slide, coffee spills
 * soak, fans push). Land it in the bin in as few throws as you can. Everything
 * is drawn from primitives; sound is a tiny Web Audio synth.
 *
 * Created on demand via window.launchPaperAirplane() so the Fantasia menu
 * stays the first screen.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // ART DIRECTION: "ink on notebook paper".
  // Every object is a flat fill from PALETTE with the same INK outline, drawn
  // on ruled paper that sits on a desk. A future art pass should only need to
  // touch PALETTE, INK_W and the draw*() helpers in the rendering section.
  // ---------------------------------------------------------------------------
  const PALETTE = {
    desk: 0x2b221d, // the tabletop behind the sheet of paper (page background)
    paper: 0xfbf7ee,
    rule: 0xd3e3ec, // blue ruled lines
    margin: 0xefb3b3, // red margin line
    ink: 0x2b2f3a, // all outlines, text and the bin
    pencil: 0x4a6fa5, // flight trails + wind marks
    wood: 0xc99a6b,
    woodLight: 0xdcb48a,
    woodGrain: 0xb4855a,
    cork: 0xd9a066,
    corkDot: 0xb97d3f,
    glass: 0xbfe6f2,
    glassShine: 0xffffff,
    coffee: 0x6b4226,
    coffeeLight: 0x8a5a38,
    bin: 0xe6e1d3,
    plane: 0xffffff,
    planeShade: 0xd7dce6,
    pullLo: 0x2a9d8f,
    pullHi: 0xe76f51,
  };
  const INK_W = 2.5; // the one outline weight
  // Physics runs on a FIXED step so the aim preview matches the real flight
  // exactly, whatever the display refresh rate (iPads run at 120 Hz).
  const STEP = 1 / 60;
  const PREVIEW_SECONDS = 1.0; // how much of the flight the dotted arc shows
  const PREVIEW_DOT_EVERY = 4; // one dot per N physics steps
  const UI_FONT = "ui-monospace, Menlo, Consolas, monospace";
  const css = (n) => "#" + n.toString(16).padStart(6, "0");
  // Portrait sheet (9:16-ish): phone-first. FIT-scales onto iPads / desktops.
  const W = 450;
  const H = 800;

  class PaperAirplaneScene extends Phaser.Scene {
    constructor() {
      super({ key: 'PaperAirplaneScene' });
    }

    create() {
      // --- CONFIGURATION & STATE ---
      this.levelIndex = 0;
      this.strokes = 0;
      this.isDragging = false;
      this.dragStart = new Phaser.Math.Vector2();
      this.dragCurrent = new Phaser.Math.Vector2();
      this.ghostTrails = []; // Stores past flight paths
      this.currentTrail = [];
      this.trailTimer = 0;
      this.accum = 0; // fixed-step time accumulator

      // Aerodynamic constants (tuned for tactile "Kinda Hard Golf" feel)
      this.GRAVITY = 480;
      // Lift is LINEAR in forward speed (a steady glide), not speed-squared:
      // fast throws no longer loop, slow ones still sink. Accel = LIFT * speed.
      this.LIFT_COEFF = 0.6;
      this.DRAG = 0.993;
      this.MAX_PULL = 110; // finger travel for a full-power throw (kept short: thumbs run out of screen)
      this.LAUNCH_POWER = 5.55; // max launch speed = MAX_PULL * this (~610 px/s)

      // Plane kinematic state
      this.planeState = 'IDLE'; // 'IDLE' | 'FLYING' | 'WIN'
      this.pos = new Phaser.Math.Vector2();
      this.vel = new Phaser.Math.Vector2();
      this.angle = 0;
      this.safePos = new Phaser.Math.Vector2();

      // Graphics layers
      this.bgGraphics = this.add.graphics();
      this.trailGraphics = this.add.graphics();
      this.envGraphics = this.add.graphics();
      this.uiGraphics = this.add.graphics();
      this.planeGraphics = this.add.graphics();

      // HUD (top band, y < ~90, kept clear of level geometry): level name and
      // throw count on two lines, plus a hint that fades after the first throw.
      this.hudText = this.add.text(16, 14, "", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: css(PALETTE.ink),
        fontStyle: "bold",
        lineSpacing: 4,
      });
      this.hudText.setStroke(css(PALETTE.paper), 5);
      this.hintText = this.add.text(
        16,
        62,
        "Drag back to aim: the dots show your first second of flight.",
        {
          fontFamily: UI_FONT,
          fontSize: "11px",
          color: css(PALETTE.pencil),
          wordWrap: { width: W - 32 },
        }
      );
      this.hintText.setStroke(css(PALETTE.paper), 4);
      this.labelTexts = []; // per-level doodle labels (hazards), rebuilt on load

      // Level Definitions (450x800 portrait reference space)
      this.levels = [
        {
          name: "1. The Cubicle Hop",
          start: { x: 115, y: 560 },
          goal: { x: 345, y: 524, w: 84, h: 56 },
          solids: [
            { x: 0, y: 580, w: W, h: 220, type: "desk" }, // Floor desk (raised: room to pull down)
            { x: 245, y: 450, w: 24, h: 130, type: "cork" }, // Cubicle divider
            { x: 275, y: 190, w: 150, h: 18, type: "glass" }, // Overhead shelf
          ],
          fans: [],
          hazards: [{ x: 175, y: 556, w: 34, h: 24, label: "COFFEE" }],
        },
        {
          name: "2. Updraft Atrium",
          start: { x: 115, y: 560 },
          goal: { x: 355, y: 268, w: 84, h: 52 },
          solids: [
            { x: 0, y: 600, w: W, h: 200, type: "desk" },
            { x: 305, y: 320, w: 145, h: 22, type: "desk" }, // High ledge
            { x: 315, y: 420, w: 24, h: 180, type: "glass" }, // Glass barrier
          ],
          fans: [
            // Floor vent updraft
            { x: 175, y: 190, w: 110, h: 410, forceX: 0, forceY: -760 },
          ],
          hazards: [{ x: 350, y: 576, w: 70, h: 24, label: "SPILL" }],
        },
        {
          name: "3. Corner Office Bank Shot",
          start: { x: 60, y: 200 },
          goal: { x: 30, y: 664, w: 84, h: 56 },
          solids: [
            { x: 0, y: 720, w: W, h: 80, type: "desk" },
            { x: 0, y: 250, w: 280, h: 24, type: "desk" }, // Mezzanine floor
            { x: 418, y: 100, w: 22, h: 620, type: "glass" }, // Bouncy glass back wall
            { x: 160, y: 610, w: 24, h: 110, type: "cork" }, // Guard wall before bin
          ],
          fans: [
            // AC crosswind pushing left
            { x: 250, y: 440, w: 160, h: 100, forceX: -480, forceY: 0 },
          ],
          hazards: [{ x: 190, y: 226, w: 45, h: 24, label: "COFFEE" }],
        },
      ];

      // Input handlers (Zero-delay pull-back even mid-flight)
      this.input.on('pointerdown', (pointer) => {
        if (this.planeState === 'WIN') return;
        if (this.planeState === 'FLYING') {
          this.resetToSafeSpot();
        }
        this.isDragging = true;
        this.dragStart.set(pointer.x, pointer.y);
        this.dragCurrent.set(pointer.x, pointer.y);
      });

      this.input.on('pointermove', (pointer) => {
        if (this.isDragging) {
          this.dragCurrent.set(pointer.x, pointer.y);
        }
      });

      this.input.on('pointerup', () => {
        if (!this.isDragging) return;
        this.isDragging = false;

        const pull = this.dragStart.clone().subtract(this.dragCurrent);
        if (pull.length() < 14) return; // Ignore accidental taps

        pull.limit(this.MAX_PULL);
        this.launchPlane(pull);
      });

      // "Menu" chip (top-right) back to the Fantasia selector.
      const menuBtn = this.add
        .text(W - 14, 14, "≡ Menu", {
          fontFamily: UI_FONT,
          fontSize: "14px",
          color: css(PALETTE.paper),
          backgroundColor: css(PALETTE.ink),
          padding: { x: 10, y: 6 },
        })
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true });
      menuBtn.on("pointerdown", (pointer, lx, ly, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.exiting = true;
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });

      this.loadLevel(0);
    }

    loadLevel(idx) {
      this.levelIndex = idx % this.levels.length;
      const lvl = this.levels[this.levelIndex];
      this.strokes = 0;
      this.ghostTrails = [];
      this.currentTrail = [];
      this.safePos.set(lvl.start.x, lvl.start.y);
      this.resetToSafeSpot();
      this.drawStaticEnvironment();
      this.updateHUD();
    }

    resetToSafeSpot() {
      if (this.currentTrail.length > 2) {
        this.ghostTrails.push([...this.currentTrail]);
        if (this.ghostTrails.length > 6) this.ghostTrails.shift();
      }
      this.currentTrail = [];
      this.pos.copy(this.safePos);
      this.vel.set(0, 0);
      this.angle = -0.15;
      this.planeState = 'IDLE';
      this.drawGhostTrails();
    }

    launchPlane(pullVector) {
      this.strokes++;
      if (this.hintText.alpha === 1) this.tweens.add({ targets: this.hintText, alpha: 0, duration: 600 });
      this.updateHUD();
      this.planeState = 'FLYING';
      this.accum = 0;
      this.vel.copy(pullVector).scale(this.LAUNCH_POWER);
      this.angle = this.vel.angle();
      this.currentTrail = [{ x: this.pos.x, y: this.pos.y }];
      this.playSound('whoosh', 260 + pullVector.length() * 1.8);
    }

    update(time, delta) {
      if (this.planeState === 'FLYING') {
        // Fixed-step physics: same dt every step, so flights are repeatable and
        // predictPath() below can reproduce them exactly.
        this.accum = Math.min(this.accum + delta / 1000, 0.1);
        while (this.accum >= STEP && this.planeState === 'FLYING') {
          this.stepFlight(STEP);
          this.accum -= STEP;
        }
      }
      this.drawDynamicFrame(time);
    }

    // Forces on the plane for one step. Shared by the real flight and the aim
    // preview, so the two can never disagree. Mutates vel; returns the new angle.
    applyForces(vel, angle, pos, dt, lvl) {
      // 1. Gravity & air drag
      vel.y += this.GRAVITY * dt;
      vel.scale(Math.pow(this.DRAG, dt * 60));

      // 2. Environmental wind / fan zones
      for (const fan of lvl.fans) {
        if (this.pointInRect(pos.x, pos.y, fan)) {
          vel.x += fan.forceX * dt;
          vel.y += fan.forceY * dt;
        }
      }

      // 3. Wing lift: perpendicular to the nose, proportional to forward speed
      const forward = new Phaser.Math.Vector2(Math.cos(angle), Math.sin(angle));
      const forwardSpeed = Math.max(0, vel.dot(forward));
      const upWing = new Phaser.Math.Vector2(-Math.sin(angle), Math.cos(angle));
      // Ensure lift opposes gravity regardless of left/right orientation
      if (upWing.y > 0) upWing.negate();
      vel.add(upWing.scale(forwardSpeed * this.LIFT_COEFF * dt));

      // 4. Weathervane: the nose turns toward the direction of travel
      if (vel.length() > 25) {
        angle = Phaser.Math.Angle.RotateTo(angle, vel.angle(), 3.8 * dt);
      }
      return angle;
    }

    stepFlight(dt) {
      const lvl = this.levels[this.levelIndex];
      this.angle = this.applyForces(this.vel, this.angle, this.pos, dt, lvl);

      // Sub-stepped movement & collision
      const steps = 3;
      const subDt = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.pos.x += this.vel.x * subDt;
        this.pos.y += this.vel.y * subDt;

        // Sheet edges (sides, bottom and top)
        if (this.pos.x < 10 || this.pos.x > W - 10 || this.pos.y < -10 || this.pos.y > H + 10) {
          this.playSound('crumple', 120);
          this.resetToSafeSpot();
          break;
        }

        // Hazards (coffee spills soak the plane)
        for (const haz of lvl.hazards) {
          if (this.pointInRect(this.pos.x, this.pos.y, haz)) {
            this.playSound('splash', 160);
            this.resetToSafeSpot();
            break;
          }
        }
        if (this.planeState !== 'FLYING') break;

        // Goal (inbox / bin)
        if (this.pointInRect(this.pos.x, this.pos.y, lvl.goal)) {
          this.handleWin();
          break;
        }

        // Solid surfaces
        for (const wall of lvl.solids) {
          if (this.resolveWallCollision(wall)) break;
        }
        if (this.planeState !== 'FLYING') break;
      }

      // Record breadcrumb trail
      this.trailTimer += dt;
      if (this.trailTimer >= 0.04) {
        this.trailTimer = 0;
        this.currentTrail.push({ x: this.pos.x, y: this.pos.y });
      }
    }

    // What the plane would touch at pos (same tests as stepFlight), or null.
    contactAt(pos, lvl) {
      if (pos.x < 10 || pos.x > W - 10 || pos.y < -10 || pos.y > H + 10) return 'edge';
      for (const haz of lvl.hazards) if (this.pointInRect(pos.x, pos.y, haz)) return 'hazard';
      if (this.pointInRect(pos.x, pos.y, lvl.goal)) return 'goal';
      const pad = 8;
      for (const r of lvl.solids) {
        if (pos.x + pad >= r.x && pos.x - pad <= r.x + r.w && pos.y + pad >= r.y && pos.y - pad <= r.y + r.h) {
          return 'solid';
        }
      }
      return null;
    }

    // The first PREVIEW_SECONDS of a launch with this pull, using the real force
    // code and fixed step; stops at the first contact. Returns dots + how it ended.
    predictPath(pull) {
      const lvl = this.levels[this.levelIndex];
      const pos = this.pos.clone();
      const vel = pull.clone().scale(this.LAUNCH_POWER);
      let angle = vel.angle();
      const dots = [];
      const total = Math.round(PREVIEW_SECONDS / STEP);
      for (let i = 0; i < total; i++) {
        angle = this.applyForces(vel, angle, pos, STEP, lvl);
        for (let k = 0; k < 3; k++) {
          pos.x += (vel.x * STEP) / 3;
          pos.y += (vel.y * STEP) / 3;
          const hit = this.contactAt(pos, lvl);
          if (hit) return { dots, end: { x: pos.x, y: pos.y }, hit };
        }
        if (i % PREVIEW_DOT_EVERY === PREVIEW_DOT_EVERY - 1) dots.push({ x: pos.x, y: pos.y });
      }
      return { dots, end: null, hit: null };
    }

    resolveWallCollision(rect) {
      const pad = 8;
      if (
        this.pos.x + pad < rect.x ||
        this.pos.x - pad > rect.x + rect.w ||
        this.pos.y + pad < rect.y ||
        this.pos.y - pad > rect.y + rect.h
      ) {
        return false;
      }

      // Determine shallowest penetration axis
      const overlapLeft = this.pos.x + pad - rect.x;
      const overlapRight = rect.x + rect.w - (this.pos.x - pad);
      const overlapTop = this.pos.y + pad - rect.y;
      const overlapBottom = rect.y + rect.h - (this.pos.y - pad);
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      // Corkboard = nose sticks immediately on impact
      if (rect.type === 'cork') {
        if (minOverlap === overlapLeft) this.pos.x = rect.x - pad - 2;
        else if (minOverlap === overlapRight) this.pos.x = rect.x + rect.w + pad + 2;
        else if (minOverlap === overlapTop) this.pos.y = rect.y - pad - 2;
        else this.pos.y = rect.y + rect.h + pad + 2;

        this.safePos.copy(this.pos);
        this.playSound('thud', 140);
        this.resetToSafeSpot();
        return true;
      }

      // Glass = high restitution deflection; Desk = medium slide/settle
      const bounce = rect.type === 'glass' ? 0.78 : 0.35;
      const friction = rect.type === 'glass' ? 0.94 : 0.72;

      if (minOverlap === overlapTop) {
        this.pos.y = rect.y - pad;
        this.vel.y = -Math.abs(this.vel.y) * bounce;
        this.vel.x *= friction;
        this.playSound(
          rect.type === 'glass' ? 'ting' : 'thud',
          rect.type === 'glass' ? 680 : 180
        );

        // Come to rest on top of a desk
        if (this.vel.length() < 55) {
          this.safePos.set(this.pos.x, rect.y - 10);
          this.resetToSafeSpot();
          return true;
        }
      } else if (minOverlap === overlapBottom) {
        this.pos.y = rect.y + rect.h + pad;
        this.vel.y = Math.abs(this.vel.y) * bounce;
        this.playSound('ting', 540);
      } else if (minOverlap === overlapLeft) {
        this.pos.x = rect.x - pad;
        this.vel.x = -Math.abs(this.vel.x) * bounce;
        this.playSound('ting', 600);
      } else if (minOverlap === overlapRight) {
        this.pos.x = rect.x + rect.w + pad;
        this.vel.x = Math.abs(this.vel.x) * bounce;
        this.playSound('ting', 600);
      }

      this.angle = this.vel.angle();
      return true;
    }

    handleWin() {
      this.planeState = 'WIN';
      this.vel.set(0, 0);
      this.playSound('win', 520);
      this.hudText.setText(
        `${this.levels[this.levelIndex].name}\nSunk in ${this.strokes} throws!`
      );
      this.time.delayedCall(1400, () => {
        this.loadLevel(this.levelIndex + 1);
      });
    }

    // --- PROCEDURAL RENDERING ---
    // Shared look: flat PALETTE fill + INK outline. One helper per object type.

    inkRect(g, x, y, w, h, fill, alpha = 1) {
      g.fillStyle(fill, alpha);
      g.fillRect(x, y, w, h);
      g.lineStyle(INK_W, PALETTE.ink, 1);
      g.strokeRect(x, y, w, h);
    }

    drawPaper(g) {
      g.fillStyle(PALETTE.paper, 1);
      g.fillRect(0, 0, W, H);
      g.lineStyle(1, PALETTE.rule, 1);
      for (let y = 96; y < H; y += 32) g.lineBetween(0, y, W, y);
      g.lineStyle(2, PALETTE.margin, 1);
      g.lineBetween(40, 0, 40, H);
    }

    drawDesk(g, s) {
      this.inkRect(g, s.x, s.y, s.w, s.h, PALETTE.wood);
      g.fillStyle(PALETTE.woodLight, 1);
      g.fillRect(s.x + INK_W / 2, s.y + INK_W / 2, s.w - INK_W, 6);
      // wood grain: a few short strokes, deterministic so it never shimmers
      g.lineStyle(1.5, PALETTE.woodGrain, 1);
      for (let gx = s.x + 40; gx < s.x + s.w - 30; gx += 110) {
        const gy = s.y + 16 + ((gx * 7) % Math.max(8, s.h - 24));
        g.lineBetween(gx, gy, gx + 34, gy);
      }
    }

    drawCork(g, s) {
      this.inkRect(g, s.x, s.y, s.w, s.h, PALETTE.cork);
      g.fillStyle(PALETTE.corkDot, 1);
      for (let cy = s.y + 14; cy < s.y + s.h - 6; cy += 22) {
        g.fillCircle(s.x + s.w / 2 + ((cy * 5) % 9) - 4, cy, 2);
      }
    }

    drawGlass(g, s) {
      this.inkRect(g, s.x, s.y, s.w, s.h, PALETTE.glass, 0.6);
      // diagonal shine strokes
      g.lineStyle(2, PALETTE.glassShine, 0.9);
      const long = s.w > s.h;
      const n = Math.max(1, Math.floor((long ? s.w : s.h) / 70));
      for (let i = 0; i < n; i++) {
        if (long) g.lineBetween(s.x + 14 + i * 70, s.y + s.h - 4, s.x + 26 + i * 70, s.y + 4);
        else g.lineBetween(s.x + 4, s.y + 16 + i * 70, s.x + s.w - 4, s.y + 4 + i * 70);
      }
    }

    drawHazard(g, h) {
      g.fillStyle(PALETTE.coffee, 1);
      g.fillRoundedRect(h.x, h.y, h.w, h.h, 8);
      g.lineStyle(INK_W, PALETTE.ink, 1);
      g.strokeRoundedRect(h.x, h.y, h.w, h.h, 8);
      g.fillStyle(PALETTE.coffeeLight, 1);
      g.fillRoundedRect(h.x + 6, h.y + 4, Math.max(8, h.w * 0.35), 5, 2);
      if (h.label) {
        this.labelTexts.push(
          this.add
            .text(h.x + h.w / 2, h.y - 4, h.label, {
              fontFamily: UI_FONT,
              fontSize: "10px",
              color: css(PALETTE.ink),
            })
            .setOrigin(0.5, 1)
        );
      }
    }

    drawGoal(g, r) {
      g.fillStyle(PALETTE.bin, 1);
      g.fillRect(r.x + 4, r.y, r.w - 8, r.h);
      // wire-mesh crosshatch
      g.lineStyle(1, PALETTE.ink, 0.35);
      for (let x = r.x + 12; x < r.x + r.w - 6; x += 12) g.lineBetween(x, r.y + 4, x - 2, r.y + r.h - 3);
      for (let y = r.y + 12; y < r.y + r.h - 4; y += 12) g.lineBetween(r.x + 6, y, r.x + r.w - 6, y);
      g.lineStyle(INK_W, PALETTE.ink, 1);
      g.beginPath();
      g.moveTo(r.x, r.y);
      g.lineTo(r.x + 6, r.y + r.h);
      g.lineTo(r.x + r.w - 6, r.y + r.h);
      g.lineTo(r.x + r.w, r.y);
      g.strokePath();
    }

    drawStaticEnvironment() {
      const lvl = this.levels[this.levelIndex];
      this.bgGraphics.clear();
      this.envGraphics.clear();
      this.labelTexts.forEach((t) => t.destroy());
      this.labelTexts = [];

      this.drawPaper(this.bgGraphics);
      for (const s of lvl.solids) {
        if (s.type === "desk") this.drawDesk(this.envGraphics, s);
        else if (s.type === "cork") this.drawCork(this.envGraphics, s);
        else if (s.type === "glass") this.drawGlass(this.envGraphics, s);
      }
      for (const h of lvl.hazards) this.drawHazard(this.envGraphics, h);
      this.drawGoal(this.envGraphics, lvl.goal);
    }

    drawGhostTrails() {
      this.trailGraphics.clear();
      this.ghostTrails.forEach((trail, idx) => {
        const alpha = 0.12 + (idx / this.ghostTrails.length) * 0.18;
        this.trailGraphics.lineStyle(2, PALETTE.pencil, alpha);
        this.trailGraphics.beginPath();
        trail.forEach((pt, i) => {
          if (i === 0) this.trailGraphics.moveTo(pt.x, pt.y);
          else this.trailGraphics.lineTo(pt.x, pt.y);
        });
        this.trailGraphics.strokePath();
      });
    }

    drawWind(g, time, fans) {
      g.lineStyle(1.5, PALETTE.pencil, 0.45);
      for (const fan of fans) {
        const offset = (time * 0.12) % 30;
        if (fan.forceY < 0) {
          for (let x = fan.x + 15; x < fan.x + fan.w; x += 25) {
            for (let y = fan.y + fan.h - offset; y > fan.y; y -= 30) {
              g.lineBetween(x, y, x, Math.max(fan.y, y - 14));
            }
          }
        } else {
          for (let y = fan.y + 15; y < fan.y + fan.h; y += 22) {
            for (let x = fan.x + fan.w - offset; x > fan.x; x -= 30) {
              g.lineBetween(x, y, Math.max(fan.x, x - 14), y);
            }
          }
        }
      }
    }

    drawPullIndicator(g) {
      const pull = this.dragStart.clone().subtract(this.dragCurrent).limit(this.MAX_PULL);
      const ratio = pull.length() / this.MAX_PULL;
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(PALETTE.pullLo),
        Phaser.Display.Color.ValueToColor(PALETTE.pullHi),
        100,
        Math.floor(ratio * 100)
      );
      const hex = Phaser.Display.Color.GetColor(c.r, c.g, c.b);

      // Pull-back band
      g.lineStyle(3, hex, 0.9);
      g.lineBetween(this.pos.x, this.pos.y, this.pos.x - pull.x * 0.55, this.pos.y - pull.y * 0.55);

      // Short aim stub in front of the nose
      const tip = pull.clone().normalize().scale(36 + ratio * 28);
      g.lineStyle(2, PALETTE.ink, 0.6);
      g.lineBetween(this.pos.x, this.pos.y, this.pos.x + tip.x, this.pos.y + tip.y);

      // Dotted preview of the first second of flight (exact, same physics).
      if (pull.length() >= 14) {
        const path = this.predictPath(pull);
        path.dots.forEach((d, i) => {
          g.fillStyle(PALETTE.ink, 0.8 - 0.5 * (i / Math.max(1, path.dots.length)));
          g.fillCircle(d.x, d.y, 2.4);
        });
        if (path.hit) {
          // End marker: where this throw would first touch something.
          const c = path.hit === 'goal' ? PALETTE.pullLo : path.hit === 'solid' ? PALETTE.ink : PALETTE.pullHi;
          g.lineStyle(2.5, c, 0.95);
          g.strokeCircle(path.end.x, path.end.y, 7);
        }
      }

      this.angle = pull.angle();
    }

    drawPlane(g) {
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);
      const rot = (lx, ly) => ({
        x: this.pos.x + lx * cos - ly * sin,
        y: this.pos.y + lx * sin + ly * cos,
      });
      const nose = rot(16, 0);
      const topWing = rot(-12, -9);
      const crease = rot(-8, 0);
      const keel = rot(-11, 6);

      const tri = (a, b, c, fill) => {
        g.fillStyle(fill, 1);
        g.lineStyle(INK_W * 0.6, PALETTE.ink, 1);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineTo(c.x, c.y);
        g.closePath();
        g.fillPath();
        g.strokePath();
      };
      tri(nose, topWing, crease, PALETTE.plane); // upper wing
      tri(nose, crease, keel, PALETTE.planeShade); // shaded under-fold
    }

    drawDynamicFrame(time) {
      const lvl = this.levels[this.levelIndex];
      this.uiGraphics.clear();
      this.planeGraphics.clear();

      this.drawWind(this.uiGraphics, time, lvl.fans);

      // Active flight trail
      if (this.currentTrail.length > 1) {
        this.uiGraphics.lineStyle(2, PALETTE.pencil, 0.6);
        this.uiGraphics.beginPath();
        this.currentTrail.forEach((pt, i) => {
          if (i === 0) this.uiGraphics.moveTo(pt.x, pt.y);
          else this.uiGraphics.lineTo(pt.x, pt.y);
        });
        this.uiGraphics.strokePath();
      }

      if (this.isDragging) this.drawPullIndicator(this.uiGraphics);
      this.drawPlane(this.planeGraphics);
    }

    updateHUD() {
      const lvl = this.levels[this.levelIndex];
      this.hudText.setText(`${lvl.name}\nThrows: ${this.strokes}`);
    }

    pointInRect(px, py, r) {
      return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }

    // Zero-dependency Web Audio synth for crisp tactile feedback
    playSound(type, freq = 300) {
      const ctx = this.sound.context;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      if (type === 'whoosh') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 0.6, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + 0.14);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      } else if (type === 'ting') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      } else if (type === 'thud' || type === 'crumple' || type === 'splash') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      } else if (type === 'win') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(660, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    }
  }

  function launchPaperAirplane() {
    if (window.paperAirplaneGame) return window.paperAirplaneGame;
    // Window: the sheet of paper sits on a desk-coloured page (no stark
    // letterbox bars), with a soft shadow. Both are undone on exit.
    const host = document.getElementById("game-container");
    if (host) host.style.background = css(PALETTE.desk);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-container",
      backgroundColor: css(PALETTE.paper),
      width: W,
      height: H,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [PaperAirplaneScene],
    });
    if (game.canvas) game.canvas.style.boxShadow = "0 10px 40px rgba(0, 0, 0, 0.55)";
    game.events.once("destroy", () => {
      if (host) host.style.background = "";
    });
    window.paperAirplaneGame = game;
    return game;
  }

  window.launchPaperAirplane = launchPaperAirplane;
})();
