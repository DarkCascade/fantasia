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
  // Safety nets so a flight can never run forever (e.g. hovering at the top edge
  // of an updraft): a plane that stays within STALL_RADIUS for STALL_SECONDS, or
  // any flight past MAX_FLIGHT_SECONDS, is reset like a crash. Real flights last
  // ~5s at most, so these never cut off a legitimate throw.
  // Mechanics shared by the real flight and the aim preview (so the preview stays exact).
  const PAD = 8; // the plane's collision radius
  const SPRING_SPEED = 700; // upward kick off a spring pad, px/s (more than any throw: a spring reaches heights you can't)
  const BUMPER_BOUNCE = 1.35; // bumper restitution (> 1: pinball bumpers KICK, adding energy)
  const BUMPER_MIN_SPEED = 300; // a bumper never leaves the plane slower than this
  const BUMPER_MAX_SPEED = 820; // ...nor faster than this (keeps collision sub-steps honest)
  const TUBE_R = 20; // mail-tube mouth radius
  const TUBE_MIN_SPEED = 380; // a tube never lets the plane out slower than this
  const SHELF_DEPTH = 12; // a one-way shelf only catches a falling plane within this many px of its top
  const CAM_LEAD = 150; // scrolling levels: the resting plane sits this far from the left screen edge
  const CAM_AHEAD = 0.36; // ...and in flight the camera keeps it this fraction of the screen from the left
  const CAM_RATE = 6; // camera ease (1/s)
  const STALL_RADIUS = 40;
  const STALL_SECONDS = 2;
  const MAX_FLIGHT_SECONDS = 10;
  const UI_FONT = "ui-monospace, Menlo, Consolas, monospace";
  const css = (n) => "#" + n.toString(16).padStart(6, "0");
  const BEST_KEY = "paper-airplane-best"; // localStorage: { [levelIndex]: fewest throws }
  function loadBest() {
    try {
      return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveBest(best) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch (e) {
      /* private mode / blocked storage: bests just don't persist */
    }
  }
  // Golf-style label for a score against par.
  function scoreLabel(throws, par) {
    if (throws === 1) return "Hole in one!";
    const d = throws - par;
    if (d <= -2) return "Eagle!";
    if (d === -1) return "Birdie!";
    if (d === 0) return "Par";
    if (d === 1) return "Bogey";
    if (d === 2) return "Double bogey";
    return "+" + d;
  }
  // ---- mechanics: pure helpers on {x, y} position / velocity objects ----
  function springKick(vel) {
    vel.y = -SPRING_SPEED;
    vel.x *= 0.95;
  }
  // Circle bumper: push the plane out and reflect it. Returns true on contact.
  function bumperBounce(pos, vel, b) {
    const dx = pos.x - b.x, dy = pos.y - b.y;
    const d = Math.hypot(dx, dy), rr = b.r + PAD;
    if (d >= rr || d === 0) return false;
    const nx = dx / d, ny = dy / d;
    pos.x = b.x + nx * rr;
    pos.y = b.y + ny * rr;
    const vn = vel.x * nx + vel.y * ny;
    if (vn < 0) {
      vel.x -= (1 + BUMPER_BOUNCE) * vn * nx;
      vel.y -= (1 + BUMPER_BOUNCE) * vn * ny;
    }
    const sp = Math.hypot(vel.x, vel.y);
    if (sp < BUMPER_MIN_SPEED) {
      if (sp === 0) { vel.x = nx * BUMPER_MIN_SPEED; vel.y = ny * BUMPER_MIN_SPEED; }
      else { vel.x *= BUMPER_MIN_SPEED / sp; vel.y *= BUMPER_MIN_SPEED / sp; }
    } else if (sp > BUMPER_MAX_SPEED) {
      vel.x *= BUMPER_MAX_SPEED / sp;
      vel.y *= BUMPER_MAX_SPEED / sp;
    }
    return true;
  }
  // Mail tubes: a pair of mouths; enter one, leave the other along its `dir`
  // (degrees) at no less than TUBE_MIN_SPEED. `lock` is the mouth just exited
  // (tubeIndex * 2 + 0/1) and stops the plane re-entering until it moves clear.
  function tubeMouth(lvl, lock) {
    const t = lvl.tubes[lock >> 1];
    return lock & 1 ? t.b : t.a;
  }
  function tubeStep(pos, vel, lvl, lock) {
    const tubes = lvl.tubes || [];
    if (lock >= 0) {
      const m = tubeMouth(lvl, lock);
      if (Math.hypot(pos.x - m.x, pos.y - m.y) > TUBE_R + 6) lock = -1;
    }
    if (lock < 0) {
      for (let i = 0; i < tubes.length; i++) {
        for (let k = 0; k < 2; k++) {
          const m = k ? tubes[i].b : tubes[i].a;
          if (Math.hypot(pos.x - m.x, pos.y - m.y) < TUBE_R) {
            const o = k ? tubes[i].a : tubes[i].b;
            const rad = (o.dir * Math.PI) / 180;
            const sp = Math.max(Math.hypot(vel.x, vel.y), TUBE_MIN_SPEED);
            pos.x = o.x + Math.cos(rad) * (TUBE_R + 4);
            pos.y = o.y + Math.sin(rad) * (TUBE_R + 4);
            vel.x = Math.cos(rad) * sp;
            vel.y = Math.sin(rad) * sp;
            return { lock: i * 2 + (k ? 0 : 1), teleported: true, from: m, to: o };
          }
        }
      }
    }
    return { lock, teleported: false };
  }
  // Overlap depths of the plane against a rect, or null when not touching.
  function solidOverlap(pos, r) {
    if (pos.x + PAD < r.x || pos.x - PAD > r.x + r.w || pos.y + PAD < r.y || pos.y - PAD > r.y + r.h) return null;
    return { l: pos.x + PAD - r.x, r: r.x + r.w - (pos.x - PAD), t: pos.y + PAD - r.y, b: r.y + r.h - (pos.y - PAD) };
  }
  // The shallowest penetration side ('l' | 'r' | 't' | 'b'); ties resolve in `order`.
  function minSide(o, order) {
    const m = Math.min(o.l, o.r, o.t, o.b);
    for (const k of order) if (o[k] === m) return k;
    return 't';
  }
  const SIDE_ORDER = { cork: ['l', 'r', 't', 'b'], other: ['t', 'b', 'l', 'r'] };

  // Portrait sheet (9:16-ish): phone-first. FIT-scales onto iPads / desktops.
  // Level data lives in src/paper-airplane/levels.js (loaded first by index.html).
  const { W, H, LEVELS } = window.PaperAirplaneLevels;
  // ---- sound effects: CC0 samples (src/paper-airplane/sfx/, see CREDITS.md) with the synth as fallback ----
  // Each game sound maps to a few variants; one is picked at random with a touch of pitch variation.
  const SFX_VARIANTS = {
    whoosh: ['whoosh1', 'whoosh2', 'whoosh3'],
    thud: ['thud1', 'thud2', 'thud3'],
    ting: ['ting1', 'ting2'], // glass / sides / bottoms
    bump: ['bump1', 'bump2'], // bumpers (playSound('ting', 760))
    crumple: ['crumple1', 'crumple2'],
    splash: ['splash1', 'splash2', 'splash3'],
    boing: ['boing'],
    whoop: ['whoop'],
    win: ['win'],
    click: ['click'],
    back: ['back'],
  };
  // Per-sound loudness (the files are peak-normalised, so balance them here).
  const SFX_VOLUME = { whoosh: 0.5, thud: 0.75, ting: 0.55, bump: 0.6, crumple: 0.65, splash: 0.6, boing: 0.55, whoop: 0.4, win: 0.35, click: 0.5, back: 0.5 };
  const SFX_FILES = [].concat(...Object.values(SFX_VARIANTS));
  // ?sfx=0 forces the built-in synth (handy for comparing, or if a file is ever missing).
  const USE_SAMPLES = !/[?&]sfx=0\b/.test((typeof location !== 'undefined' && location.search) || '');
  // Play a UI sample from any scene (no-op until the files are loaded).
  function playUi(scene, name) {
    const key = 'sfx-' + name;
    if (USE_SAMPLES && scene.cache.audio.exists(key)) scene.sound.play(key, { volume: SFX_VOLUME[name] || 0.5 });
  }

  const D = window.PaperAirplaneDoodle; // seeded hand-drawn line helpers (src/paper-airplane/doodle.js)
  const DOODLE_FONT = '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive';
  let pendingStartLevel = null; // set by launchPaperAirplane({ level }) to skip the select screen

  // Ruled notebook page, shared by the level-select and game scenes. The ruling
  // and margin are hand-drawn (seeded wobble), and the page has punched holes
  // unless opts.holes === false.
  function drawPaperBackground(g, opts) {
    const width = (opts && opts.width) || W; // scrolling levels draw a long strip of paper
    g.fillStyle(PALETTE.paper, 1);
    g.fillRect(0, 0, width, H);
    for (let y = 96, i = 0; y < H; y += 32, i++) {
      D.line(g, -4, y, width + 4, y, { seed: 1000 + i, amp: 0.9, width: 1.3, color: PALETTE.rule, alpha: 0.95, double: false });
    }
    D.line(g, 40, -4, 40, H + 4, { seed: 77, amp: 1.1, width: 2, color: PALETTE.margin, alpha: 0.95 });
    // Long strips are several sheets taped edge to edge: a faint seam and tape at each join.
    for (let sx = W, k = 0; sx < width - 1; sx += W, k++) {
      D.line(g, sx, -4, sx, H + 4, { seed: 500 + k, amp: 1.2, width: 1.4, color: PALETTE.pencil, alpha: 0.35, double: false });
      [130, 420, 690].forEach((ty, j) => {
        const tx = sx, tw = 11, th = 26, a = ((k * 3 + j * 5) % 7 - 3) * 0.04;
        const pts = [[-tw, -th], [tw, -th], [tw, th], [-tw, th]].map(([lx, ly]) => ({ x: tx + lx * Math.cos(a) - ly * Math.sin(a), y: ty + lx * Math.sin(a) + ly * Math.cos(a) }));
        g.fillStyle(0xf2dc8a, 0.7);
        g.fillPoints(pts, true);
        D.polyline(g, pts.concat([pts[0]]), 1, PALETTE.ink, 0.3);
      });
    }
    if (!opts || opts.holes !== false) {
      [150, 400, 650].forEach((hy, i) => {
        g.fillStyle(0x6b5a4c, 1);
        g.fillCircle(16, hy, 6);
        D.circle(g, 16, hy, 6, { seed: 90 + i, color: PALETTE.ink, width: 1, alpha: 0.3, amp: 0.4, double: false });
      });
    }
  }

  class PaperAirplaneScene extends Phaser.Scene {
    constructor() {
      super({ key: 'PaperAirplaneScene' });
    }

    init(data) {
      this.startLevel = data && Number.isInteger(data.level) ? data.level : 0;
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
      this.best = loadBest(); // fewest throws per level, persisted
      this.runScores = []; // throws per completed level in this run of the course

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
      this.fx = []; // particles: crash scraps, coffee drops, puffs, win confetti
      this.bgGraphics = this.add.graphics();
      this.trailGraphics = this.add.graphics();
      this.envGraphics = this.add.graphics();
      this.uiGraphics = this.add.graphics();
      this.planeGraphics = this.add.graphics();
      this.fxGraphics = this.add.graphics();
      // paper grain over everything (below the HUD chips' hit areas, which don't use depth)
      D.makePaperGrain(this, 'pa-grain', W, H);
      this.add.image(0, 0, 'pa-grain').setOrigin(0).setDepth(100).setScrollFactor(0);
      this.worldW = W; // the level's width in px (> W = a scrolling level; set in loadLevel)
      this.introT = null; // seconds into the opening fly-over of a scrolling level (null = not playing)

      // HUD (top band, y < ~90, kept clear of level geometry): level name and
      // throw count on two lines, plus a hint that fades after the first throw.
      this.hudText = this.add.text(16, 14, "", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: css(PALETTE.ink),
        fontStyle: "bold",
        lineSpacing: 4,
      });
      this.hudText.setStroke(css(PALETTE.paper), 5).setScrollFactor(0).setDepth(101);
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
      this.hintText.setStroke(css(PALETTE.paper), 4).setScrollFactor(0).setDepth(101);
      this.labelTexts = []; // per-level doodle labels (hazards), rebuilt on load

      this.levels = LEVELS; // data: src/paper-airplane/levels.js

      // Input handlers (Zero-delay pull-back even mid-flight)
      this.input.on('pointerdown', (pointer) => {
        if (this.planeState === 'WIN') return;
        this.introT = null; // a touch cuts the opening fly-over short
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

      // "Levels" chip (top-right) back to the level-select screen.
      const levelsBtn = this.add
        .text(W - 14, 14, "≡ Levels", {
          fontFamily: UI_FONT,
          fontSize: "14px",
          color: css(PALETTE.paper),
          backgroundColor: css(PALETTE.ink),
          padding: { x: 10, y: 6 },
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(101)
        .setInteractive({ useHandCursor: true });
      levelsBtn.on("pointerdown", (pointer, lx, ly, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.exiting = true;
        playUi(this, "back");
        this.scene.start("LevelSelectScene");
      });

      this.loadLevel(this.startLevel);
    }

    // "3. Corner Office Bank Shot"
    title(idx) {
      return `${idx + 1}. ${LEVELS[idx].name}`;
    }

    loadLevel(idx) {
      this.levelIndex = idx % this.levels.length;
      const lvl = this.levels[this.levelIndex];
      this.worldW = lvl.width || W;
      this.cameras.main.setScroll(0, 0);
      // Scrolling levels open with a fly-over to the bin and back, so you know where you are going.
      this.introT = this.worldW > W ? 0 : null;
      this.strokes = 0;
      this.ghostTrails = [];
      this.currentTrail = [];
      this.hintText.setText(this.worldW > W ? 'Long level: the ruler shows where the bin is. Ride the thermals.' : (lvl.preview > 1 ? 'Drag back to aim: the dots follow the bounces.' : 'Drag back to aim: the dots show your first second of flight.'));
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
      this.flightTime = 0;
      this.stallTime = 0;
      this.stallAnchor = this.pos.clone();
      this.tubeLock = -1;
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
      this.stepFx(delta / 1000);
      this.updateCamera(delta / 1000);
      this.drawDynamicFrame(time);
    }

    // Scrolling levels: where the camera wants to be. Resting, the plane sits CAM_LEAD
    // from the left edge (finger room to pull back); in flight the camera leads it so
    // most of the screen shows what is ahead.
    cameraTarget() {
      const maxScroll = Math.max(0, this.worldW - W);
      const follow = this.planeState === 'FLYING' || this.planeState === 'WIN'; // a win holds on the bin
      const want = follow ? this.pos.x - W * CAM_AHEAD : this.safePos.x - CAM_LEAD;
      return Math.max(0, Math.min(maxScroll, want));
    }

    updateCamera(dt) {
      const cam = this.cameras.main;
      const maxScroll = Math.max(0, this.worldW - W);
      if (maxScroll <= 0) { cam.scrollX = 0; return; }
      if (this.introT !== null) {
        // out to the bin (1.3 s, eased), hold, and home again (1.1 s)
        this.introT += dt;
        const t = this.introT, out = 1.3, hold = 0.5, back = 1.1;
        const ease = (u) => u * u * (3 - 2 * u);
        const home = this.cameraTarget();
        let f;
        if (t < out) f = ease(t / out);
        else if (t < out + hold) f = 1;
        else if (t < out + hold + back) f = 1 - ease((t - out - hold) / back);
        else { this.introT = null; f = 0; }
        cam.scrollX = home + (maxScroll - home) * f;
        return;
      }
      const target = this.cameraTarget();
      cam.scrollX += (target - cam.scrollX) * (1 - Math.exp(-CAM_RATE * dt));
      if (Math.abs(target - cam.scrollX) < 0.05) cam.scrollX = target;
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
        if (this.pos.x < 10 || this.pos.x > this.worldW - 10 || this.pos.y < -10 || this.pos.y > H + 10) {
          this.playSound('crumple', 120);
          this.spawnFx('scrap', this.pos.x, this.pos.y, 9);
          this.resetToSafeSpot();
          break;
        }

        // Hazards (coffee spills soak the plane)
        for (const haz of lvl.hazards) {
          if (this.pointInRect(this.pos.x, this.pos.y, haz)) {
            this.playSound('splash', 160);
            this.spawnFx('drop', this.pos.x, haz.y, 16);
            this.spawnFx('scrap', this.pos.x, this.pos.y, 4);
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

        // Bumpers (pinball-style round rebounders)
        for (const b of lvl.bumpers || []) {
          if (bumperBounce(this.pos, this.vel, b)) {
            this.playSound('ting', 760);
            this.spawnFx('poof', this.pos.x, this.pos.y, 3);
            this.angle = this.vel.angle();
          }
        }

        // Mail tubes
        if (lvl.tubes) {
          const t = tubeStep(this.pos, this.vel, lvl, this.tubeLock);
          this.tubeLock = t.lock;
          if (t.teleported) {
            this.playSound('whoop', 300);
            this.spawnFx('poof', t.from.x, t.from.y, 3);
            this.spawnFx('poof', t.to.x, t.to.y, 3);
            this.angle = this.vel.angle();
            this.currentTrail.push({ x: this.pos.x, y: this.pos.y, jump: true });
          }
        }
      }

      // Safety nets: never let a flight run forever (see constants above).
      if (this.planeState === 'FLYING') {
        this.flightTime += dt;
        if (this.pos.distance(this.stallAnchor) > STALL_RADIUS) {
          this.stallAnchor.copy(this.pos);
          this.stallTime = 0;
        } else {
          this.stallTime += dt;
        }
        if (this.stallTime >= STALL_SECONDS || this.flightTime >= MAX_FLIGHT_SECONDS) {
          this.lastEnd = this.stallTime >= STALL_SECONDS ? 'stall' : 'timeout';
          this.playSound('crumple', 120);
          this.noteToPlayer('That one ran out of puff. Try again.');
          this.spawnFx('poof', this.pos.x, this.pos.y, 5);
          this.resetToSafeSpot();
          return;
        }
      }

      // Record breadcrumb trail
      this.trailTimer += dt;
      if (this.trailTimer >= 0.04) {
        this.trailTimer = 0;
        this.currentTrail.push({ x: this.pos.x, y: this.pos.y });
      }
    }

    // Brief message in the hint slot (the opening hint has already faded by then).
    noteToPlayer(text) {
      this.hintText.setText(text);
      this.tweens.killTweensOf(this.hintText);
      this.hintText.setAlpha(1);
      this.tweens.add({ targets: this.hintText, alpha: 0, delay: 1500, duration: 600 });
    }

    // What the plane would touch at pos (same tests as stepFlight): null, or
    // { kind: 'edge' | 'hazard' | 'goal' | 'solid' | 'spring', rect?, side? }.
    contactAt(pos, vel, lvl) {
      if (pos.x < 10 || pos.x > this.worldW - 10 || pos.y < -10 || pos.y > H + 10) return { kind: 'edge' };
      for (const haz of lvl.hazards) if (this.pointInRect(pos.x, pos.y, haz)) return { kind: 'hazard' };
      if (this.pointInRect(pos.x, pos.y, lvl.goal)) return { kind: 'goal' };
      for (const r of lvl.solids) {
        const o = solidOverlap(pos, r);
        if (!o) continue;
        if (r.type === 'shelf') {
          if (!(vel.y > 0 && o.t <= SHELF_DEPTH)) continue; // one-way: passes through from below / the side
          return { kind: 'solid', rect: r, side: 't' };
        }
        const side = minSide(o, r.type === 'cork' ? SIDE_ORDER.cork : SIDE_ORDER.other);
        return { kind: r.type === 'spring' ? 'spring' : 'solid', rect: r, side };
      }
      return null;
    }

    // The first PREVIEW_SECONDS (or the level's `preview`) of a launch with this pull, using the real force
    // code and fixed step. Springs, bumpers and tubes are followed exactly (same
    // helpers as the real flight); it stops at the first other contact.
    predictPath(pull) {
      const lvl = this.levels[this.levelIndex];
      const pos = this.pos.clone();
      const vel = pull.clone().scale(this.LAUNCH_POWER);
      let angle = vel.angle();
      let lock = -1;
      const dots = [];
      const total = Math.round((lvl.preview || PREVIEW_SECONDS) / STEP); // levels with long chaotic flights (bumpers) show more
      for (let i = 0; i < total; i++) {
        angle = this.applyForces(vel, angle, pos, STEP, lvl);
        for (let k = 0; k < 3; k++) {
          pos.x += (vel.x * STEP) / 3;
          pos.y += (vel.y * STEP) / 3;
          const hit = this.contactAt(pos, vel, lvl);
          if (hit) {
            if (hit.kind === 'spring' && hit.side === 't') {
              pos.y = hit.rect.y - PAD;
              springKick(vel);
              angle = vel.angle();
              continue;
            }
            return { dots, end: { x: pos.x, y: pos.y }, hit: hit.kind };
          }
          for (const b of lvl.bumpers || []) if (bumperBounce(pos, vel, b)) angle = vel.angle();
          if (lvl.tubes) {
            const t = tubeStep(pos, vel, lvl, lock);
            lock = t.lock;
            if (t.teleported) angle = vel.angle();
          }
        }
        if (i % PREVIEW_DOT_EVERY === PREVIEW_DOT_EVERY - 1) dots.push({ x: pos.x, y: pos.y });
      }
      return { dots, end: null, hit: null };
    }

    resolveWallCollision(rect) {
      const o = solidOverlap(this.pos, rect);
      if (!o) return false;
      const pad = PAD;

      // Corkboard = nose sticks immediately on impact
      if (rect.type === 'cork') {
        const cs = minSide(o, SIDE_ORDER.cork);
        if (cs === 'l') this.pos.x = rect.x - pad - 2;
        else if (cs === 'r') this.pos.x = rect.x + rect.w + pad + 2;
        else if (cs === 't') this.pos.y = rect.y - pad - 2;
        else this.pos.y = rect.y + rect.h + pad + 2;

        this.safePos.copy(this.pos);
        this.playSound('thud', 140);
        this.spawnFx('poof', this.pos.x, this.pos.y, 4);
        this.resetToSafeSpot();
        return true;
      }

      let side = minSide(o, SIDE_ORDER.other);
      // One-way shelf: catches only a falling plane that is just reaching its top.
      if (rect.type === 'shelf') {
        if (!(this.vel.y > 0 && o.t <= SHELF_DEPTH)) return false;
        side = 't';
      }
      // Spring pad: landing on top kicks the plane back up (other sides act like a desk).
      if (rect.type === 'spring' && side === 't') {
        this.pos.y = rect.y - pad;
        springKick(this.vel);
        this.playSound('boing', 320);
        this.spawnFx('poof', this.pos.x, rect.y, 3);
        this.angle = this.vel.angle();
        return true;
      }

      // Glass = high restitution deflection; Desk/shelf/spring-side = medium slide/settle
      const bounce = rect.type === 'glass' ? 0.78 : 0.35;
      const friction = rect.type === 'glass' ? 0.94 : 0.72;

      if (side === 't') {
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
      } else if (side === 'b') {
        this.pos.y = rect.y + rect.h + pad;
        this.vel.y = Math.abs(this.vel.y) * bounce;
        this.playSound('ting', 540);
      } else if (side === 'l') {
        this.pos.x = rect.x - pad;
        this.vel.x = -Math.abs(this.vel.x) * bounce;
        this.playSound('ting', 600);
      } else {
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
      this.spawnFx('confetti', this.levels[this.levelIndex].goal.x + this.levels[this.levelIndex].goal.w / 2, this.levels[this.levelIndex].goal.y, 34);

      const idx = this.levelIndex;
      const lvl = this.levels[idx];
      const throws = this.strokes;
      const isBest = this.best[idx] === undefined || throws < this.best[idx];
      if (isBest) {
        this.best[idx] = throws;
        saveBest(this.best);
      }
      this.runScores[idx] = throws;
      this.hudText.setText(
        `${this.title(idx)}\n${throws} ${throws === 1 ? "throw" : "throws"}: ${scoreLabel(throws, lvl.par)}${isBest ? "  ★ best" : ""}`
      );

      const toSelect = () => this.scene.start("LevelSelectScene");
      if (idx < LEVELS.length - 1) {
        this.time.delayedCall(1700, () => this.loadLevel(idx + 1));
      } else {
        // Last level: if the whole course was played in one sitting show the
        // course card, then return to the level-select screen.
        this.time.delayedCall(1700, () => {
          if (!LEVELS.every((_, i) => this.runScores[i] !== undefined)) return toSelect();
          const total = this.runScores.reduce((a, b) => a + b, 0);
          const par = LEVELS.reduce((a, l) => a + l.par, 0);
          const d = total - par;
          this.hudText.setText(
            `Course complete!\n${total} throws, par ${par} (${d === 0 ? "even" : d > 0 ? "+" + d : d})`
          );
          this.time.delayedCall(3000, toSelect);
        });
      }
    }

    // --- PROCEDURAL RENDERING ---
    // "Ink pen on notebook paper": everything goes through PaperAirplaneDoodle, so
    // lines wobble (seeded, so they never shimmer), fills are jittered and shading
    // is hatching. Static art is drawn once per level; only the plane, trails,
    // wind and particles are redrawn each frame.

    drawPaper(g) {
      drawPaperBackground(g, { width: this.worldW });
    }

    drawDesk(g, s) {
      const seed = D.hash(s.x, s.y, s.w, s.h);
      const topH = Math.min(16, s.h * 0.4);
      D.rect(g, s.x, s.y, s.w, s.h, { seed, fill: PALETTE.wood, color: PALETTE.ink, width: INK_W });
      g.fillStyle(PALETTE.woodLight, 1);
      g.fillRect(s.x + 2, s.y + 2, s.w - 4, topH - 2); // lit top surface
      D.line(g, s.x + 3, s.y + topH, s.x + s.w - 3, s.y + topH, { seed: seed + 3, width: 1.5, color: PALETTE.ink, alpha: 0.7, amp: 1 });
      const r = D.rng(seed + 5); // wood grain
      const grains = Math.max(3, Math.min(24, Math.round((s.w * s.h) / 2500)));
      for (let i = 0; i < grains; i++) {
        const len = 20 + r() * 50;
        const gx = s.x + 8 + r() * Math.max(1, s.w - len - 16);
        const gy = s.y + topH + 6 + r() * Math.max(1, s.h - topH - 12);
        D.line(g, gx, gy, gx + len, gy + (r() - 0.5) * 3, { seed: seed + 9 + i, width: 1.4, color: PALETTE.woodGrain, alpha: 0.85, amp: 0.8, double: false });
      }
      if (s.h > 60) D.hatch(g, s.x + 4, s.y + s.h - 26, s.w - 8, 22, { gap: 8, color: PALETTE.ink, alpha: 0.22 });
    }

    drawCork(g, s) {
      const seed = D.hash(s.x, s.y, s.w, s.h);
      D.rect(g, s.x, s.y, s.w, s.h, { seed, fill: PALETTE.cork, color: PALETTE.ink, width: INK_W });
      const r = D.rng(seed + 2);
      g.fillStyle(PALETTE.corkDot, 1);
      const dots = Math.max(4, Math.min(34, Math.round((s.w * s.h) / 260)));
      for (let i = 0; i < dots; i++) g.fillCircle(s.x + 4 + r() * (s.w - 8), s.y + 4 + r() * (s.h - 8), 1.2 + r() * 1.2);
      // a few pushpins
      const pins = [PALETTE.pullHi, PALETTE.pullLo, PALETTE.pencil];
      const count = Math.max(1, Math.min(3, Math.round(s.h / 70)));
      for (let i = 0; i < count; i++) {
        const px = s.x + s.w / 2 + (r() - 0.5) * Math.min(8, s.w * 0.3);
        const py = s.y + 14 + ((s.h - 28) * (i + r() * 0.5)) / count;
        D.circle(g, px, py, 3.4, { seed: seed + 20 + i, fill: pins[i % 3], color: PALETTE.ink, width: 1.3, amp: 0.3, double: false });
      }
    }

    drawGlass(g, s) {
      const seed = D.hash(s.x, s.y, s.w, s.h);
      D.rect(g, s.x, s.y, s.w, s.h, { seed, fill: PALETTE.glass, fillAlpha: 0.6, color: PALETTE.ink, width: INK_W });
      const long = s.w > s.h;
      const n = Math.max(1, Math.floor((long ? s.w : s.h) / 70));
      for (let i = 0; i < n; i++) {
        if (long) D.line(g, s.x + 14 + i * 70, s.y + s.h - 4, s.x + 28 + i * 70, s.y + 4, { seed: seed + i, width: 2, color: PALETTE.glassShine, alpha: 0.95, amp: 0.5, double: false });
        else D.line(g, s.x + 4, s.y + 18 + i * 70, s.x + s.w - 4, s.y + 4 + i * 70, { seed: seed + i, width: 2, color: PALETTE.glassShine, alpha: 0.95, amp: 0.5, double: false });
      }
    }

    drawSpring(g, s) {
      const seed = D.hash(s.x, s.y, s.w, s.h);
      D.rect(g, s.x, s.y + s.h - 5, s.w, 5, { seed, fill: PALETTE.woodLight, color: PALETTE.ink, width: 2, amp: 0.5 });
      D.coil(g, s.x + 8, s.y + 4, s.w - 16, s.h - 9, 4, { color: PALETTE.ink, width: 2.2 });
      D.rect(g, s.x + 2, s.y, s.w - 4, 5, { seed: seed + 1, fill: PALETTE.pullHi, color: PALETTE.ink, width: 2, amp: 0.4 });
    }

    // One-way shelf: a thin plank with pencil ticks and up-chevrons below it ("pass through from underneath").
    drawShelf(g, s) {
      const seed = D.hash(s.x, s.y, s.w, s.h);
      D.rect(g, s.x, s.y, s.w, s.h, { seed, fill: PALETTE.woodLight, color: PALETTE.ink, width: 2, amp: 0.7 });
      for (let x = s.x + 8; x < s.x + s.w - 14; x += 16) {
        D.line(g, x, s.y + s.h + 5, x + 8, s.y + s.h + 5, { seed: seed + x, width: 1.5, color: PALETTE.pencil, alpha: 0.7, amp: 0.4, double: false });
      }
      for (let k = 0; k < 3; k++) {
        const cx = s.x + s.w * (0.2 + 0.3 * k);
        D.polyline(g, [{ x: cx - 4, y: s.y + s.h + 17 }, { x: cx, y: s.y + s.h + 11 }, { x: cx + 4, y: s.y + s.h + 17 }], 1.6, PALETTE.pencil, 0.7);
      }
    }

    drawBumper(g, b) {
      const seed = D.hash(b.x, b.y, b.r);
      D.circle(g, b.x, b.y, b.r, { seed, fill: PALETTE.pullHi, fillAlpha: 0.28, color: PALETTE.ink, width: INK_W, amp: 1.2 });
      D.circle(g, b.x, b.y, b.r * 0.62, { seed: seed + 1, color: PALETTE.pullHi, width: 2, alpha: 0.9, amp: 0.8, double: false });
      D.star(g, b.x, b.y, b.r * 0.3, { seed: seed + 2, fill: PALETTE.pullHi, color: PALETTE.ink, width: 1.2, double: false });
    }

    drawTubes(g, tubes) {
      tubes.forEach((t, i) => {
        const col = i % 2 ? PALETTE.pencil : PALETTE.pullLo;
        // faint dashed hose between the two mouths
        const hose = D.wobble(t.a.x, t.a.y, t.b.x, t.b.y, 500 + i, 7);
        for (let k = 1; k < hose.length; k += 2) D.polyline(g, [hose[k - 1], hose[k]], 2, col, 0.28);
        [t.a, t.b].forEach((m, j) => {
          D.circle(g, m.x, m.y, TUBE_R, { seed: 600 + i * 2 + j, fill: col, fillAlpha: 0.25, color: PALETTE.ink, width: INK_W, amp: 0.9 });
          D.circle(g, m.x, m.y, TUBE_R * 0.58, { seed: 700 + i * 2 + j, fill: PALETTE.ink, fillAlpha: 0.32, outline: false });
          // arrow showing the exit direction
          const rad = (m.dir * Math.PI) / 180, c = Math.cos(rad), sn = Math.sin(rad);
          const x1 = m.x + c * (TUBE_R + 6), y1 = m.y + sn * (TUBE_R + 6), x2 = m.x + c * (TUBE_R + 22), y2 = m.y + sn * (TUBE_R + 22);
          D.line(g, x1, y1, x2, y2, { seed: 800 + i * 2 + j, width: 2.2, color: col, alpha: 0.95, amp: 0.6 });
          [0.5, -0.5].forEach((da, q) => D.line(g, x2, y2, x2 - Math.cos(rad + da) * 7, y2 - Math.sin(rad + da) * 7, { seed: 900 + q, width: 2.2, color: col, alpha: 0.95, amp: 0.3, double: false }));
        });
      });
    }

    drawHazard(g, h) {
      const seed = D.hash(h.x, h.y, h.w, h.h);
      D.blob(g, h.x + h.w / 2, h.y + h.h / 2, h.w / 2, h.h / 2, { seed, fill: PALETTE.coffee, color: PALETTE.ink, width: 2, amp: 1.6 });
      D.blob(g, h.x + h.w * 0.35, h.y + h.h * 0.38, h.w * 0.16, h.h * 0.12, { seed: seed + 1, fill: PALETTE.coffeeLight, outline: false, amp: 0.8 });
      if (h.label === 'COFFEE') {
        for (let k = 0; k < 2; k++) {
          const steam = [];
          for (let i = 0; i <= 8; i++) steam.push({ x: h.x + h.w * (k ? 0.62 : 0.34) + Math.sin(i * 0.9 + k) * 3, y: h.y - 2 - i * 2.4 });
          D.polyline(g, steam, 1.6, PALETTE.ink, 0.45);
        }
      }
      if (h.label) {
        this.labelTexts.push(
          this.add.text(h.x + h.w / 2, h.y - (h.label === 'COFFEE' ? 24 : 4), h.label.toLowerCase(), {
            fontFamily: DOODLE_FONT, fontSize: '12px', color: css(PALETTE.ink),
          }).setOrigin(0.5, 1).setAlpha(0.8)
        );
      }
    }

    drawGoal(g, r) {
      const seed = D.hash(r.x, r.y, r.w, r.h);
      // bin: filled trapezoid, open top, wire-mesh scribble, a few crumpled balls
      D.polygon(g, [{ x: r.x, y: r.y }, { x: r.x + 6, y: r.y + r.h }, { x: r.x + r.w - 6, y: r.y + r.h }, { x: r.x + r.w, y: r.y }], {
        seed, fill: PALETTE.bin, color: PALETTE.ink, width: INK_W, amp: 1.2, closed: false,
      });
      const rr = D.rng(seed + 3);
      for (let i = 0; i < 3; i++) {
        D.circle(g, r.x + 14 + rr() * (r.w - 28), r.y + r.h - 9 - rr() * 6, 6 + rr() * 2, { seed: seed + 10 + i, fill: PALETTE.paper, color: PALETTE.ink, width: 1.3, amp: 0.8, double: false });
      }
      D.hatch(g, r.x + 6, r.y + 4, r.w - 12, r.h - 8, { gap: 11, color: PALETTE.ink, alpha: 0.3, width: 1 });
      // arrow pointing into the bin
      const ax = r.x + r.w / 2, ay = r.y - 24;
      D.line(g, ax, ay, ax, ay + 16, { seed: seed + 30, width: 2, color: PALETTE.pullLo, alpha: 0.9, amp: 0.8 });
      D.line(g, ax - 6, ay + 10, ax, ay + 17, { seed: seed + 31, width: 2, color: PALETTE.pullLo, alpha: 0.9, amp: 0.4, double: false });
      D.line(g, ax + 6, ay + 10, ax, ay + 17, { seed: seed + 32, width: 2, color: PALETTE.pullLo, alpha: 0.9, amp: 0.4, double: false });
    }

    drawStaticEnvironment() {
      const lvl = this.levels[this.levelIndex];
      this.bgGraphics.clear();
      this.envGraphics.clear();
      this.labelTexts.forEach((t) => t.destroy());
      this.labelTexts = [];

      this.drawPaper(this.bgGraphics);
      const worldW = this.worldW;
      // Desk doodles in the free areas of the page (never over gameplay objects).
      const avoid = [...lvl.solids, ...lvl.fans, ...lvl.hazards, { x: lvl.goal.x - 10, y: lvl.goal.y - 40, w: lvl.goal.w + 20, h: lvl.goal.h + 40 }, { x: lvl.start.x - 50, y: lvl.start.y - 50, w: 100, h: 100 }];
      for (const b of lvl.bumpers || []) avoid.push({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 });
      for (const t of lvl.tubes || []) for (const m of [t.a, t.b]) avoid.push({ x: m.x - 44, y: m.y - 44, w: 88, h: 88 });
      const decor = D.placeDecor(D.hash(this.levelIndex, 7), avoid, worldW, H, Math.round(5 * worldW / W));
      D.drawDecor(this.bgGraphics, decor, { ink: PALETTE.ink, alpha: 0.2, coffee: PALETTE.coffee });

      for (const s of lvl.solids) {
        if (s.type === 'desk') this.drawDesk(this.envGraphics, s);
        else if (s.type === 'cork') this.drawCork(this.envGraphics, s);
        else if (s.type === 'glass') this.drawGlass(this.envGraphics, s);
        else if (s.type === 'spring') this.drawSpring(this.envGraphics, s);
        else if (s.type === 'shelf') this.drawShelf(this.envGraphics, s);
      }
      for (const b of lvl.bumpers || []) this.drawBumper(this.envGraphics, b);
      if (lvl.tubes) this.drawTubes(this.envGraphics, lvl.tubes);
      for (const h of lvl.hazards) this.drawHazard(this.envGraphics, h);
      this.drawGoal(this.envGraphics, lvl.goal);
    }

    // Pencil-dash a path (every other segment).
    dashPath(g, pts, width, alpha) {
      for (let i = 1; i < pts.length; i += 2) {
        if (pts[i].jump || pts[i - 1].jump) continue; // don't draw a dash across a tube hop
        D.line(g, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, { seed: i * 31, width, color: PALETTE.pencil, alpha, amp: 0.5, double: false });
      }
    }

    drawGhostTrails() {
      this.trailGraphics.clear();
      this.ghostTrails.forEach((trail, idx) => {
        this.dashPath(this.trailGraphics, trail, 1.8, 0.12 + (idx / this.ghostTrails.length) * 0.2);
      });
    }

    drawWind(g, time, fans) {
      fans.forEach((fan, fi) => {
        const offset = (time * 0.12) % 30;
        const seed = D.hash(fan.x, fan.y, fi);
        let k = 0;
        const lo = Math.min(Math.abs(fan.forceX), Math.abs(fan.forceY)), hi = Math.max(Math.abs(fan.forceX), Math.abs(fan.forceY));
        if (lo > 0.15 * hi) {
          // Tilted wind (thermals): short streaks along the push direction, drifting with it.
          const len = Math.hypot(fan.forceX, fan.forceY), dx = fan.forceX / len, dy = fan.forceY / len;
          const SX = 26, SY = 34; // lattice spacing (the lattice slides along the wind)
          const slide = offset % SY;
          for (let gx = fan.x + 10; gx < fan.x + fan.w; gx += SX) {
            for (let gy = fan.y - SY; gy < fan.y + fan.h + SY; gy += SY) {
              const t = dy < 0 ? -slide : slide; // upwind-to-downwind drift
              const x1 = gx + (t * dx) / Math.abs(dy || 1), y1 = gy + t;
              const x2 = x1 + dx * 16, y2 = y1 + dy * 16;
              if (x1 < fan.x || x2 > fan.x + fan.w || y1 < fan.y || y1 > fan.y + fan.h || y2 < fan.y || y2 > fan.y + fan.h) continue;
              D.polyline(g, D.wobble(x1, y1, x2, y2, seed + k++ * 5, 1.4), 1.6, PALETTE.pencil, 0.5);
            }
          }
        } else if (Math.abs(fan.forceY) >= Math.abs(fan.forceX)) {
          const dir = fan.forceY < 0 ? -1 : 1; // -1 = up
          for (let x = fan.x + 15; x < fan.x + fan.w; x += 25) {
            for (let y = dir < 0 ? fan.y + fan.h - offset : fan.y + offset; dir < 0 ? y > fan.y : y < fan.y + fan.h; y += dir * 30) {
              const y2 = Math.max(fan.y, Math.min(fan.y + fan.h, y + dir * 14));
              D.polyline(g, D.wobble(x, y, x, y2, seed + k++ * 5, 1.8), 1.6, PALETTE.pencil, 0.5);
            }
          }
        } else {
          const dir = fan.forceX < 0 ? -1 : 1;
          for (let y = fan.y + 15; y < fan.y + fan.h; y += 22) {
            for (let x = dir < 0 ? fan.x + fan.w - offset : fan.x + offset; dir < 0 ? x > fan.x : x < fan.x + fan.w; x += dir * 30) {
              const x2 = Math.max(fan.x, Math.min(fan.x + fan.w, x + dir * 14));
              D.polyline(g, D.wobble(x, y, x2, y, seed + k++ * 5, 1.8), 1.6, PALETTE.pencil, 0.5);
            }
          }
        }
      });
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

      // Pull-back band (rubber band, drawn with a pen)
      D.line(g, this.pos.x, this.pos.y, this.pos.x - pull.x * 0.55, this.pos.y - pull.y * 0.55, { seed: 5, width: 3.2, color: hex, alpha: 0.9, amp: 0.8 });

      // Short aim stub in front of the nose
      const tip = pull.clone().normalize().scale(36 + ratio * 28);
      D.line(g, this.pos.x, this.pos.y, this.pos.x + tip.x, this.pos.y + tip.y, { seed: 6, width: 2, color: PALETTE.ink, alpha: 0.6, amp: 0.6, double: false });

      // Dotted preview of the first second of flight (exact, same physics).
      if (pull.length() >= 14) {
        const path = this.predictPath(pull);
        path.dots.forEach((d, i) => {
          g.fillStyle(PALETTE.ink, 0.8 - 0.5 * (i / Math.max(1, path.dots.length)));
          g.fillCircle(d.x, d.y, 2.4);
        });
        if (path.hit) {
          // End marker: where this throw would first touch something.
          const mc = path.hit === 'goal' ? PALETTE.pullLo : path.hit === 'solid' || path.hit === 'spring' ? PALETTE.ink : PALETTE.pullHi;
          D.circle(g, path.end.x, path.end.y, 7, { seed: 8, outline: true, color: mc, width: 2.5, alpha: 0.95, amp: 0.6 });
        }
      }

      this.angle = pull.angle();
    }

    // The paper plane: two wing panels, a centre fold, and a flutter when flying.
    drawPlane(g, time) {
      const flying = this.planeState === 'FLYING';
      const flap = flying
        ? Math.sin(time * 0.03) * 1.6 + Phaser.Math.Clamp(this.vel.y / 220, -1, 1) * 1.8
        : Math.sin(time * 0.004) * 0.7;
      const bob = flying ? 0 : Math.sin(time * 0.004) * 1.2;
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);
      const rot = (lx, ly) => ({
        x: this.pos.x + lx * cos - ly * sin,
        y: this.pos.y + bob + lx * sin + ly * cos,
      });
      const nose = rot(16, 0);
      const topWing = rot(-12, -9 - flap);
      const crease = rot(-8, 0);
      const keel = rot(-11, 6 + flap * 0.5);
      const ink = { color: PALETTE.ink, width: INK_W * 0.6, amp: 0.3, seed: 5, double: false };
      D.polygon(g, [nose, topWing, crease], Object.assign({ fill: PALETTE.plane }, ink)); // upper wing
      D.polygon(g, [nose, crease, keel], Object.assign({ fill: PALETTE.planeShade }, ink, { seed: 6 })); // shaded under-fold
      D.line(g, nose.x, nose.y, crease.x, crease.y, { seed: 7, width: 1.2, color: PALETTE.ink, alpha: 0.7, amp: 0.2, double: false }); // centre fold
      const t1 = rot(-3, 2), t2 = rot(-9, 4);
      D.line(g, t1.x, t1.y, t2.x, t2.y, { seed: 8, width: 1, color: PALETTE.ink, alpha: 0.4, amp: 0.2, double: false }); // under-fold shading
    }

    // --- particles ---
    spawnFx(kind, x, y, n) {
      const r = D.rng(Math.floor(x * 7 + y * 13 + this.fx.length * 31 + n));
      const colors = [PALETTE.pullLo, PALETTE.pullHi, PALETTE.pencil, PALETTE.wood, PALETTE.coffeeLight, PALETTE.paper];
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        if (kind === 'scrap') {
          const sp = 60 + r() * 130;
          this.fx.push({ kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, rot: r() * 6, vr: (r() - 0.5) * 14, life: 0.7 + r() * 0.5, max: 1.2, size: 3 + r() * 3, grav: 420 });
        } else if (kind === 'drop') {
          const sp = 70 + r() * 150;
          this.fx.push({ kind, x, y, vx: Math.cos(a) * sp * 0.6, vy: -Math.abs(Math.sin(a)) * sp - 40, life: 0.5 + r() * 0.4, max: 0.9, size: 1.6 + r() * 2.2, grav: 520 });
        } else if (kind === 'poof') {
          this.fx.push({ kind, x: x + (r() - 0.5) * 14, y: y + (r() - 0.5) * 14, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18 - 10, life: 0.45 + r() * 0.2, max: 0.65, size: 4, grav: 0 });
        } else if (kind === 'confetti') {
          const ca = -Math.PI / 2 + (r() - 0.5) * 1.9;
          const sp = 140 + r() * 220;
          this.fx.push({ kind, x, y, vx: Math.cos(ca) * sp, vy: Math.sin(ca) * sp, rot: r() * 6, vr: (r() - 0.5) * 16, life: 1.0 + r() * 0.8, max: 1.8, size: 3 + r() * 2, grav: 420, color: colors[Math.floor(r() * colors.length)] });
        }
      }
    }

    stepFx(dt) {
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const p = this.fx[i];
        p.life -= dt;
        if (p.life <= 0) { this.fx.splice(i, 1); continue; }
        p.vy += (p.grav || 0) * dt;
        if (p.kind === 'confetti') { p.vx *= 1 - 1.4 * dt; p.vy *= 1 - 0.6 * dt; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.rot !== undefined) p.rot += p.vr * dt;
      }
    }

    drawFx(g) {
      for (const p of this.fx) {
        const t = Math.max(0, p.life / p.max);
        if (p.kind === 'drop') {
          g.fillStyle(PALETTE.coffee, Math.min(1, t * 2));
          g.fillCircle(p.x, p.y, p.size);
        } else if (p.kind === 'poof') {
          g.lineStyle(1.6, PALETTE.ink, t * 0.5);
          g.strokeCircle(p.x, p.y, p.size + (1 - t) * 11);
        } else {
          const c = Math.cos(p.rot), sn = Math.sin(p.rot);
          const w = p.size * 1.4, h = p.size;
          const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([lx, ly]) => ({ x: p.x + lx * c - ly * sn, y: p.y + lx * sn + ly * c }));
          g.fillStyle(p.kind === 'scrap' ? PALETTE.plane : p.color, Math.min(1, t * 2.2));
          g.fillPoints(pts, true);
          if (p.kind === 'scrap') D.polyline(g, pts.concat([pts[0]]), 1, PALETTE.ink, Math.min(1, t * 2.2));
        }
      }
    }

    drawDynamicFrame(time) {
      const lvl = this.levels[this.levelIndex];
      this.uiGraphics.clear();
      this.planeGraphics.clear();
      this.fxGraphics.clear();

      this.drawWind(this.uiGraphics, time, lvl.fans);

      // Active flight trail (pencil dashes)
      if (this.currentTrail.length > 1) this.dashPath(this.uiGraphics, this.currentTrail, 2, 0.6);

      if (this.isDragging) this.drawPullIndicator(this.uiGraphics);
      if (this.worldW > W) this.drawProgressRuler(this.uiGraphics);
      this.drawPlane(this.planeGraphics, time);
      this.drawFx(this.fxGraphics);
    }

    // Scrolling levels: a pencil ruler under the HUD (screen-fixed) showing the whole
    // strip, the part on screen, the plane and the bin.
    drawProgressRuler(g) {
      const sx = this.cameras.main.scrollX, y = 88, x0 = 16, x1 = W - 16, span = x1 - x0;
      const at = (wx) => sx + x0 + (Math.max(0, Math.min(this.worldW, wx)) / this.worldW) * span;
      const lvl = this.levels[this.levelIndex];
      g.fillStyle(PALETTE.pullHi, 0.22);
      g.fillRect(at(sx), y - 6, (W / this.worldW) * span, 12); // what is on screen now
      D.line(g, at(0), y, at(this.worldW), y, { seed: 61, width: 1.6, color: PALETTE.pencil, alpha: 0.9, amp: 0.5, double: false });
      for (let k = 0; k <= this.worldW; k += W) D.line(g, at(k), y - 4, at(k), y + 4, { seed: 62 + k, width: 1.2, color: PALETTE.pencil, alpha: 0.8, amp: 0.2, double: false });
      const bx = at(lvl.goal.x + lvl.goal.w / 2); // bin flag
      D.line(g, bx, y, bx, y - 11, { seed: 70, width: 1.6, color: PALETTE.ink, alpha: 0.9, amp: 0.2, double: false });
      D.polygon(g, [{ x: bx, y: y - 11 }, { x: bx + 8, y: y - 8 }, { x: bx, y: y - 5 }], { seed: 71, fill: PALETTE.pullLo, color: PALETTE.ink, width: 1, amp: 0.2, double: false });
      g.fillStyle(PALETTE.ink, 0.9);
      g.fillCircle(at(this.pos.x), y, 3.4); // the plane
    }

    updateHUD() {
      const lvl = this.levels[this.levelIndex];
      const best = this.best[this.levelIndex];
      this.hudText.setText(
        `${this.title(this.levelIndex)}\nThrows: ${this.strokes}  Par: ${lvl.par}${best !== undefined ? "  Best: " + best : ""}`
      );
    }

    pointInRect(px, py, r) {
      return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }

    // Zero-dependency Web Audio synth for crisp tactile feedback
    // Try a CC0 sample first; the synth below is the fallback.
    playSample(type, freq) {
      if (!USE_SAMPLES) return false;
      const kind = type === 'ting' && freq === 760 ? 'bump' : type;
      const list = SFX_VARIANTS[kind];
      if (!list) return false;
      const key = 'sfx-' + list[Math.floor(Math.random() * list.length)];
      if (!this.cache.audio.exists(key)) return false;
      let rate = 1 + (Math.random() - 0.5) * 0.08; // a touch of pitch variation so repeats don't sound identical
      if (kind === 'whoosh') rate = 0.9 + Math.min(0.3, Math.max(0, (freq - 260) / 200) * 0.3); // harder pull = higher whoosh
      this.sound.play(key, { volume: SFX_VOLUME[kind] || 0.5, rate });
      return true;
    }

    playSound(type, freq = 300) {
      if (this.playSample(type, freq)) return;
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
      } else if (type === 'boing') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 0.7, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.9, now + 0.16);
        gain.gain.setValueAtTime(0.13, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      } else if (type === 'whoop') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 1.8, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.16);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
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

  // Level-select: a notebook page with one card per level (par, personal best).
  class LevelSelectScene extends Phaser.Scene {
    constructor() {
      super({ key: "LevelSelectScene" });
    }

    // The sound effects load here once; both scenes use them (any that fail to load fall back to the synth).
    preload() {
      if (!USE_SAMPLES) return;
      SFX_FILES.forEach((n) => this.load.audio('sfx-' + n, 'src/paper-airplane/sfx/' + n + '.mp3'));
    }

    create() {
      // Dev/test hook: launchPaperAirplane({ level }) skips this screen.
      if (pendingStartLevel !== null) {
        const level = pendingStartLevel;
        pendingStartLevel = null;
        this.scene.start("PaperAirplaneScene", { level });
        return;
      }

      const bg = this.add.graphics();
      drawPaperBackground(bg, { holes: false });
      D.makePaperGrain(this, 'pa-grain', W, H);
      this.add.image(0, 0, 'pa-grain').setOrigin(0).setDepth(100);
      const best = loadBest();

      this.add.text(W / 2, 30, "Paper Airplane", {
        fontFamily: UI_FONT, fontSize: "28px", fontStyle: "bold", color: css(PALETTE.ink),
      }).setOrigin(0.5, 0);
      D.line(bg, W / 2 - 108, 62, W / 2 + 108, 62, { seed: 5, width: 2, color: PALETTE.pullHi, alpha: 0.85, amp: 1.4 }); // pen underline
      this.add.text(W / 2, 70, "Pick a level. Beat par for a star.", {
        fontFamily: DOODLE_FONT, fontSize: "13px", color: css(PALETTE.pencil),
      }).setOrigin(0.5, 0);

      // 2-column grid that fits however many levels there are.
      const cols = 2, gapX = 16, gapY = 12, left = 20, top = 104, bottom = H - 64;
      const rows = Math.ceil(LEVELS.length / cols);
      const cw = (W - left * 2 - gapX * (cols - 1)) / cols;
      const ch = Math.min(112, (bottom - top - gapY * (rows - 1)) / rows);
      const g = this.add.graphics();
      let stars = 0;
      LEVELS.forEach((lvl, i) => {
        const x = left + (i % cols) * (cw + gapX);
        const y = top + Math.floor(i / cols) * (ch + gapY);
        const b = best[i];
        const beatPar = b !== undefined && b <= lvl.par;
        if (beatPar) stars++;
        // a taped-on note card
        D.rect(g, x, y, cw, ch, { seed: 300 + i, fill: 0xfffdf6, color: PALETTE.ink, width: INK_W, amp: 1.5 });
        D.hatch(g, x + 4, y + ch - 14, cw - 8, 10, { gap: 8, color: PALETTE.ink, alpha: 0.12 });
        const tapeAngle = ((i * 37) % 7 - 3) * 0.05;
        const tcx = x + cw - 40, tcy = y + 1, tw = 26, th = 8;
        const tape = [[-tw, -th], [tw, -th], [tw, th], [-tw, th]].map(([lx, ly]) => ({
          x: tcx + lx * Math.cos(tapeAngle) - ly * Math.sin(tapeAngle),
          y: tcy + lx * Math.sin(tapeAngle) + ly * Math.cos(tapeAngle),
        }));
        g.fillStyle(0xf2dc8a, 0.78);
        g.fillPoints(tape, true);
        D.polyline(g, tape.concat([tape[0]]), 1, PALETTE.ink, 0.35);
        this.add.text(x + 12, y + 8, String(i + 1), {
          fontFamily: UI_FONT, fontSize: "30px", fontStyle: "bold", color: css(PALETTE.ink),
        });
        const nameX = x + (i >= 9 ? 70 : 52); // leave room for a two-digit number
        this.add.text(nameX, y + 14, lvl.name, {
          fontFamily: UI_FONT, fontSize: "12px", color: css(PALETTE.ink), wordWrap: { width: cw - (nameX - x) - 10 },
        });
        this.add.text(x + 12, y + ch - 24, `Par ${lvl.par}` + (b !== undefined ? `  Best ${b}` : ""), {
          fontFamily: UI_FONT, fontSize: "12px", color: css(PALETTE.pencil),
        });
        if (beatPar) D.star(g, x + cw - 24, y + ch - 24, 12, { seed: 400 + i, fill: PALETTE.pullHi, color: PALETTE.ink, width: 1.5, double: false });
        const hit = this.add.zone(x, y, cw, ch).setOrigin(0).setInteractive({ useHandCursor: true });
        hit.on("pointerup", () => {
          playUi(this, "click");
          this.scene.start("PaperAirplaneScene", { level: i });
        });
      });

      const back = this.add.text(16, H - 16, "◂ Fantasia Menu", {
        fontFamily: UI_FONT, fontSize: "14px", color: css(PALETTE.paper),
        backgroundColor: css(PALETTE.ink), padding: { x: 10, y: 6 },
      }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
      back.on("pointerup", () => {
        playUi(this, "back");
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
      this.add.text(W - 16, H - 22, `${stars}/${LEVELS.length} ★`, {
        fontFamily: UI_FONT, fontSize: "14px", fontStyle: "bold", color: css(PALETTE.ink),
      }).setOrigin(1, 1);
    }
  }

  function launchPaperAirplane(opts) {
    if (window.paperAirplaneGame) return window.paperAirplaneGame;
    pendingStartLevel = opts && Number.isInteger(opts.level) ? opts.level : null;
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
      scene: [LevelSelectScene, PaperAirplaneScene],
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
