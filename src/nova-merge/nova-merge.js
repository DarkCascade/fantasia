/*
 * Nova Merge — a physics stacking/merging puzzle-arcade game (my own design).
 *
 * Drag to aim, release to drop a small celestial body into a glass silo.
 * Two bodies of the same kind that touch fuse into the next, bigger kind
 * (Asteroid -> Moon -> Comet -> ... -> Nova), scoring points. Merges that
 * land in quick succession chain into a rising combo multiplier, so a single
 * well-aimed drop that cascades through several pairs is worth far more than
 * the same merges spread out — the "hard to master" layer on top of a game
 * anyone can play by just tapping. A limited stock of swaps (trade the
 * current drop for the next one in the queue) rewards banking a swap for the
 * right moment instead of spending it on reflex. Let the pile settle above
 * the danger line and the run ends.
 *
 * Design goals, matched to the rest of Fantasia:
 *   - one input (drag + release), readable in ten seconds
 *   - a real skill ceiling: queue planning, chain setups, swap banking
 *   - short, replayable runs (~5 minutes), no timers, no idle/management loop
 *   - all art generated at runtime from primitives (no external assets)
 *   - works with mouse or touch
 *
 * The Phaser game is created on demand via window.launchNovaMerge(), so the
 * Fantasia menu stays the first screen.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 600;

  // The silo: a glass jar the orbs stack up inside. SILO_TOP is where the
  // walls start and the run's initial danger line sits — a resting orb whose
  // top pokes above the CURRENT line (see dangerLineY(), which creeps below
  // SILO_TOP over a long run) for too long ends the run. RAIL_Y is where the
  // "current" orb hovers while you aim it.
  const SILO_LEFT = 75;
  const SILO_RIGHT = 325;
  const SILO_TOP = 210;
  const FLOOR_Y = 540;
  const RAIL_Y = 118;

  const CHAIN_WINDOW = 700; // ms between merges to keep a chain alive
  const CHAIN_MULT_STEP = 0.5; // + per chain link
  const CHAIN_MULT_CAP = 5;
  const OVER_MS = 1500; // ms a settled orb may poke above the line before losing
  const SETTLE_EPS = 0.12; // matter body speed considered "at rest"
  const DROP_COOLDOWN = 260; // ms debounce so a double-tap can't stack two drops
  const SWAP_CHARGES_START = 3;
  const SWAP_CHARGES_MAX = 4;
  const SWAP_REGEN_EVERY = 6; // merges between earning a fresh swap charge
  const SUPERNOVA_RADIUS = 80;

  // A "match tiers, never stack tall" strategy keeps total occupied area
  // roughly constant forever (merging two same-tier bodies barely shrinks
  // their combined footprint), so without this, a sufficiently disciplined
  // run has no natural end. Past DANGER_CREEP_START merges the loss line
  // creeps down toward the floor. DANGER_CREEP_MAX deliberately exceeds the
  // full SILO_TOP-to-FLOOR_Y span: a cap that only *shrinks* the safe zone
  // to a smaller-but-still-sustainable height just lets flawless play find
  // a new equilibrium there and run forever again one level down (confirmed
  // by testing -- a capped creep bought a higher ceiling, not a real one).
  // Only a creep that can reach/exceed the floor guarantees termination
  // regardless of how well a run is played.
  const DANGER_CREEP_START = 150;
  const DANGER_CREEP_PER_MERGE = 3.0;
  const DANGER_CREEP_MAX = 400;

  const HS_KEY = "nova-merge-best";

  // Only the first three tiers are ever handed to the player to drop; every
  // bigger body only ever appears as the result of a merge. Early on the
  // weights favor the smallest so the board doesn't fill with mid-size
  // bodies too fast; they drift toward SPAWN_WEIGHTS_LATE as merges pile up
  // over a run, so a run that's going well (merging efficiently, never
  // approaching the danger line) still runs into rising space pressure
  // instead of coasting indefinitely -- without this, a simple "match tiers,
  // don't stack tall" strategy has no natural end.
  const SPAWN_POOL = [0, 1, 2];
  const SPAWN_WEIGHTS_EARLY = [55, 30, 15];
  const SPAWN_WEIGHTS_LATE = [30, 40, 30];
  const SPAWN_RAMP_MERGES = 150; // merges over which the ramp completes

  // Seven tiers, not nine: reaching the top tier takes 2^(N-1) small bodies
  // merged all the way up, so every tier cut roughly halves how many drops a
  // run needs before two top-tier bodies (a supernova) are actually in reach.
  // At nine tiers that ceiling was well past what a ~150-300 drop run could
  // realistically produce; at seven it's a real, if still rare, payoff.
  const TIERS = [
    { name: "Asteroid", r: 13, color: 0x9a97a6, dark: 0x716f7c, value: 10 },
    { name: "Moon", r: 18, color: 0xd7d6e6, dark: 0xa9a8bd, value: 20 },
    { name: "Comet", r: 24, color: 0xbdeeff, dark: 0x8fd0ee, value: 40 },
    { name: "Ocean Planet", r: 32, color: 0x2f8fd1, dark: 0x2f9e52, value: 80 },
    { name: "Ringed Planet", r: 38, color: 0xd9b877, dark: 0xb08f52, value: 160 },
    { name: "Gas Giant", r: 44, color: 0xe08a3c, dark: 0xb5651f, value: 320 },
    { name: "Nova", r: 50, color: 0xffffff, dark: 0xfff2a8, value: 640 },
  ];
  const MAX_TIER = TIERS.length - 1;

  function hex(n) {
    return "#" + n.toString(16).padStart(6, "0");
  }


  // A tiny cartoon face — only bodies big enough to read one get it, so the
  // smallest asteroids stay plain rubble.
  function drawFace(g, cx, cy, r) {
    if (r < 16) return;
    const eyeR = Math.max(1.6, r * 0.11);
    const eyeDX = r * 0.3;
    const eyeDY = r * 0.12;
    g.fillStyle(0x1a1626, 1);
    g.fillCircle(cx - eyeDX, cy - eyeDY, eyeR);
    g.fillCircle(cx + eyeDX, cy - eyeDY, eyeR);
    g.lineStyle(Math.max(1.4, r * 0.05), 0x1a1626, 1);
    g.beginPath();
    g.arc(cx, cy + r * 0.08, r * 0.32, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155), false);
    g.strokePath();
  }

  class NovaMergeScene extends Phaser.Scene {
    constructor() {
      super("NovaMergeScene");
    }

    create() {
      this.score = 0;
      this.startBest = this.loadHigh();
      this.chainCount = 0;
      this.lastMergeAt = -99999;
      this.swapCharges = SWAP_CHARGES_START;
      this.mergeCount = 0;
      this.activeOrbs = [];
      this.aiming = false;
      this.aimX = W / 2;
      this.lastDropAt = -99999;
      this.over = false;

      this.buildTextures();
      this.add.image(0, 0, "nm-bg").setOrigin(0, 0).setDepth(-20);
      this.buildSilo();
      this.buildUI();

      this.sparks = this.add
        .particles(0, 0, "nm-spark", {
          lifespan: 420,
          speed: { min: 60, max: 220 },
          angle: { min: 0, max: 360 },
          scale: { start: 1, end: 0 },
          alpha: { start: 1, end: 0 },
          emitting: false,
        })
        .setDepth(40);

      this.queue = [this.rollTier(), this.rollTier(), this.rollTier()];
      this.spawnCurrentOrb();
      this.refreshQueueDisplay();
      this.updateScoreText();
      this.updateSwapButton();

      this.bindInput();

      this.matter.world.on("collisionstart", (event) => {
        for (const pair of event.pairs) {
          const a = pair.bodyA.gameObject;
          const b = pair.bodyB.gameObject;
          if (!a || !b || a.tier === undefined || b.tier === undefined) continue;
          if (a.merging || b.merging) continue;
          if (a.tier !== b.tier) continue;
          a.merging = true;
          b.merging = true;
          this.time.delayedCall(0, () => this.processMerge(a, b));
        }
      });
    }

    /* ---------- procedural textures (generated once) ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      if (!this.textures.exists("nm-bg")) {
        g.clear();
        g.fillStyle(0x0a0730, 1);
        g.fillRect(0, 0, W, H);
        g.fillStyle(0x241c66, 0.45);
        g.fillRect(0, 0, W, H * 0.55);
        for (let i = 0; i < 80; i++) {
          const x = Math.random() * W;
          const y = Math.random() * H;
          const s = Math.random() < 0.15 ? 1.6 : 0.9;
          g.fillStyle(0xffffff, Math.random() * 0.5 + 0.35);
          g.fillCircle(x, y, s);
        }
        g.generateTexture("nm-bg", W, H);
      }

      for (let i = 0; i < TIERS.length; i++) {
        const key = "nm-orb-" + i;
        if (this.textures.exists(key)) continue;
        const t = TIERS[i];
        const pad = Math.ceil(t.r * 0.85);
        const size = (t.r + pad) * 2;
        const c = t.r + pad;
        g.clear();
        this.drawTier(g, i, t, c);
        g.generateTexture(key, size, size);
      }

      if (!this.textures.exists("nm-spark")) {
        g.clear();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(6, 6, 6);
        g.generateTexture("nm-spark", 12, 12);
      }

      g.destroy();
    }

    drawTier(g, idx, t, c) {
      const r = t.r;
      switch (idx) {
        case 0: // Asteroid
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          g.fillStyle(t.dark, 0.6);
          for (let k = 0; k < 4; k++) {
            const a = k * 1.7;
            g.fillCircle(c + Math.cos(a) * r * 0.45, c + Math.sin(a) * r * 0.45, r * 0.14);
          }
          g.lineStyle(1.5, t.dark, 0.8);
          g.strokeCircle(c, c, r);
          break;
        case 1: // Moon
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          g.fillStyle(t.dark, 0.5);
          for (let k = 0; k < 5; k++) {
            const a = k * 1.3 + 0.4;
            g.fillCircle(c + Math.cos(a) * r * 0.5, c + Math.sin(a) * r * 0.5, r * 0.12);
          }
          drawFace(g, c, c, r);
          break;
        case 2: // Comet
          g.fillStyle(0x7fd0ee, 0.5);
          g.fillCircle(c, c, r * 1.15);
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          g.fillStyle(0xffffff, 0.7);
          g.fillCircle(c - r * 0.25, c - r * 0.25, r * 0.35);
          drawFace(g, c, c, r);
          break;
        case 3: // Ocean Planet
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          g.fillStyle(t.dark, 0.85);
          g.fillEllipse(c - r * 0.25, c - r * 0.3, r * 0.8, r * 0.45);
          g.fillEllipse(c + r * 0.3, c + r * 0.25, r * 0.6, r * 0.5);
          drawFace(g, c, c, r);
          break;
        case 4: // Ringed Planet
          g.lineStyle(Math.max(2, r * 0.12), t.dark, 0.9);
          g.strokeEllipse(c, c, r * 2.7, r * 0.9);
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          g.fillStyle(t.dark, 0.4);
          g.fillEllipse(c, c - r * 0.1, r * 1.6, r * 0.5);
          drawFace(g, c, c, r);
          break;
        case 5: // Gas Giant
          g.fillStyle(t.color, 1);
          g.fillCircle(c, c, r);
          for (let by = -1; by <= 1; by++) {
            const dy = by * r * 0.35;
            const halfw = Math.sqrt(Math.max(0, r * r - dy * dy));
            g.fillStyle(by % 2 === 0 ? t.dark : 0xffcf8a, by === 0 ? 0.5 : 0.4);
            g.fillEllipse(c, c + dy, halfw * 1.9, r * 0.28);
          }
          g.fillStyle(0xb5401f, 0.7);
          g.fillEllipse(c + r * 0.3, c - r * 0.15, r * 0.4, r * 0.24);
          drawFace(g, c, c, r);
          break;
        case 6: // Nova
          g.fillStyle(0xfff2a8, 0.2);
          g.fillCircle(c, c, r * 1.55);
          g.fillStyle(0xffe08a, 0.4);
          g.fillCircle(c, c, r * 1.25);
          g.fillStyle(0xffffff, 1);
          g.fillCircle(c, c, r);
          for (let k = 0; k < 10; k++) {
            const a = (k * Math.PI) / 5;
            g.fillStyle(0xfff2a8, 0.7);
            g.fillTriangle(
              c + Math.cos(a) * r * 1.6,
              c + Math.sin(a) * r * 1.6,
              c + Math.cos(a + 0.06) * r * 0.85,
              c + Math.sin(a + 0.06) * r * 0.85,
              c + Math.cos(a - 0.06) * r * 0.85,
              c + Math.sin(a - 0.06) * r * 0.85
            );
          }
          drawFace(g, c, c, r * 0.9);
          break;
      }
    }

    /* ---------- silo & world ---------- */

    buildSilo() {
      const wallH = FLOOR_Y - SILO_TOP + 40;
      const wallCy = SILO_TOP + wallH / 2;
      this.matter.add.rectangle(SILO_LEFT - 6, wallCy, 12, wallH, { isStatic: true, friction: 0.2, label: "wall" });
      this.matter.add.rectangle(SILO_RIGHT + 6, wallCy, 12, wallH, { isStatic: true, friction: 0.2, label: "wall" });
      this.matter.add.rectangle(
        (SILO_LEFT + SILO_RIGHT) / 2,
        FLOOR_Y + 10,
        SILO_RIGHT - SILO_LEFT + 12,
        20,
        { isStatic: true, friction: 0.4, label: "floor" }
      );

      const g = this.add.graphics().setDepth(2);
      g.fillStyle(0x241c55, 0.2);
      g.fillRoundedRect(SILO_LEFT - 8, SILO_TOP - 4, SILO_RIGHT - SILO_LEFT + 16, FLOOR_Y - SILO_TOP + 30, 18);
      g.lineStyle(4, 0x6a5acd, 0.9);
      g.strokeRoundedRect(SILO_LEFT - 8, SILO_TOP - 4, SILO_RIGHT - SILO_LEFT + 16, FLOOR_Y - SILO_TOP + 30, 18);

      // Drawn at local y=0 so animating the line later (see dangerLineY()) is
      // just moving this object's y, not re-drawing the dashes each time.
      // Depth 9 (above orbs at depth 8): the line creeps down into pile
      // height over a long run, and must stay visible once it gets there —
      // sitting behind the orbs would hide it exactly when it matters most.
      const dl = this.add.graphics().setDepth(9);
      dl.y = SILO_TOP;
      dl.lineStyle(2, 0xff5555, 0.85);
      for (let x = SILO_LEFT; x < SILO_RIGHT; x += 14) dl.lineBetween(x, 0, x + 7, 0);
      this.dangerLineGfx = dl;

      this.hint = this.add
        .text(
          (SILO_LEFT + SILO_RIGHT) / 2,
          (SILO_TOP + FLOOR_Y) / 2,
          "Drag to aim\nRelease to drop\nMatch 2 to merge!",
          {
            fontFamily: "Arial, sans-serif",
            fontSize: "16px",
            color: "#ffffff",
            align: "center",
            fontStyle: "bold",
          }
        )
        .setOrigin(0.5)
        .setAlpha(0.35)
        .setDepth(4);
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.scoreText = this.add
        .text(W / 2, 20, "SCORE 0", {
          fontFamily: "Arial, sans-serif",
          fontSize: "24px",
          color: "#ffffff",
          stroke: "#241c55",
          strokeThickness: 5,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.bestText = this.add
        .text(W / 2, 44, "BEST 0", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#d8cdff",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.add
        .text(W / 2 - 78, 70, "NEXT", {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          color: "#b9aeff",
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5)
        .setDepth(30);

      this.previewImgs = [
        this.add.image(W / 2 - 24, 70, "nm-orb-0").setDisplaySize(28, 28).setDepth(30),
        this.add.image(W / 2 + 14, 70, "nm-orb-0").setDisplaySize(24, 24).setDepth(30),
      ];

      this.swapButton = this.makeButton(W - 10, H - 26, "⇄ SWAP ×3", () => this.doSwap(), 1);
      this.makeButton(10, H - 26, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }, 0);
    }

    // originX lets a button anchor to a screen edge (0 = left, 1 = right)
    // instead of assuming its label is short enough to fit centered — a
    // longer label (e.g. "⇄ SWAP ×3") can otherwise run past the canvas edge.
    makeButton(x, y, label, onClick, originX) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          backgroundColor: "#3a2c8a",
          padding: { x: 10, y: 6 },
          fontStyle: "bold",
        })
        .setOrigin(originX === undefined ? 0.5 : originX, 0.5)
        .setDepth(31)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    refreshQueueDisplay() {
      this.previewImgs[0].setTexture("nm-orb-" + this.queue[1]);
      this.previewImgs[1].setTexture("nm-orb-" + this.queue[2]);
    }

    updateSwapButton() {
      this.swapButton.setText("⇄ SWAP ×" + this.swapCharges);
      const enabled = this.swapCharges > 0 && !this.over;
      this.swapButton.setAlpha(enabled ? 1 : 0.4);
    }

    updateScoreText() {
      this.scoreText.setText("SCORE " + this.score);
      this.bestText.setText("BEST " + Math.max(this.startBest, this.score));
    }

    /* ---------- current orb & input ---------- */

    // Weights drift from SPAWN_WEIGHTS_EARLY toward SPAWN_WEIGHTS_LATE as
    // mergeCount climbs, so a long, well-played run faces rising space
    // pressure instead of coasting on an unchanging supply of small bodies.
    rollTier() {
      const t = Math.min(this.mergeCount / SPAWN_RAMP_MERGES, 1);
      const roll = Math.random() * 100;
      let acc = 0;
      for (let i = 0; i < SPAWN_POOL.length; i++) {
        acc += SPAWN_WEIGHTS_EARLY[i] + (SPAWN_WEIGHTS_LATE[i] - SPAWN_WEIGHTS_EARLY[i]) * t;
        if (roll < acc) return SPAWN_POOL[i];
      }
      return SPAWN_POOL[SPAWN_POOL.length - 1];
    }

    spawnCurrentOrb() {
      this.currentOrb = this.add.image(this.aimX, RAIL_Y, "nm-orb-" + this.queue[0]).setDepth(9);
    }

    bindInput() {
      this.input.on("pointerdown", (p) => {
        if (this.over) return;
        if (this.time.now - this.lastDropAt < DROP_COOLDOWN) return;
        this.aiming = true;
        this.updateAimX(p.x);
      });
      this.input.on("pointermove", (p) => {
        if (this.aiming) this.updateAimX(p.x);
      });
      this.input.on("pointerup", () => {
        if (this.aiming) {
          this.aiming = false;
          this.doDrop();
        }
      });
    }

    updateAimX(x) {
      const r = TIERS[this.queue[0]].r;
      this.aimX = Phaser.Math.Clamp(x, SILO_LEFT + r, SILO_RIGHT - r);
      if (this.currentOrb) this.currentOrb.x = this.aimX;
    }

    doSwap() {
      if (this.over || this.swapCharges <= 0) return;
      const tmp = this.queue[0];
      this.queue[0] = this.queue[1];
      this.queue[1] = tmp;
      this.swapCharges--;
      this.currentOrb.destroy();
      this.spawnCurrentOrb();
      this.refreshQueueDisplay();
      this.updateSwapButton();
      this.tweens.add({
        targets: this.currentOrb,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 90,
        yoyo: true,
        ease: "Quad.easeOut",
      });
    }

    doDrop() {
      if (this.over) return;
      this.lastDropAt = this.time.now;
      const tier = this.queue[0];
      const x = this.currentOrb.x;
      const r = TIERS[tier].r;
      this.currentOrb.destroy();

      const orb = this.matter.add.image(x, RAIL_Y, "nm-orb-" + tier);
      orb.setCircle(r);
      orb.setBounce(0.15);
      orb.setFriction(0.35, 0.01);
      orb.tier = tier;
      orb.setDepth(8);
      this.activeOrbs.push(orb);

      this.queue.shift();
      this.queue.push(this.rollTier());
      this.spawnCurrentOrb();
      this.refreshQueueDisplay();
      this.updateSwapButton();

      if (this.hint) {
        this.hint.destroy();
        this.hint = null;
      }
    }

    /* ---------- merging ---------- */

    removeFromActive(orb) {
      const i = this.activeOrbs.indexOf(orb);
      if (i >= 0) this.activeOrbs.splice(i, 1);
    }

    processMerge(a, b) {
      // A merge whose collision was already queued (via delayedCall) the
      // instant the run ended must not still land after the game-over panel
      // has frozen and displayed a score -- guard it here rather than trust
      // every call site to check first.
      if (this.over) return;

      const tier = a.tier;
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      this.removeFromActive(a);
      this.removeFromActive(b);
      a.destroy();
      b.destroy();

      const now = this.time.now;
      if (now - this.lastMergeAt <= CHAIN_WINDOW) this.chainCount++;
      else this.chainCount = 1;
      this.lastMergeAt = now;

      this.mergeCount++;
      if (this.mergeCount % SWAP_REGEN_EVERY === 0 && this.swapCharges < SWAP_CHARGES_MAX) {
        this.swapCharges++;
        this.updateSwapButton();
        this.floatingText(this.swapButton.x - 60, this.swapButton.y - 22, "+1 SWAP", 0x7fffd4, false);
      }

      if (tier === MAX_TIER) {
        this.triggerSupernova(x, y);
        return;
      }

      const mult = Math.min(1 + CHAIN_MULT_STEP * (this.chainCount - 1), CHAIN_MULT_CAP);
      const newTier = tier + 1;
      const awarded = Math.round(TIERS[newTier].value * mult);
      this.score += awarded;
      this.updateScoreText();
      this.spawnMergedOrb(newTier, x, y);
      this.burst(x, y, 8 + tier * 2);
      this.floatingText(x, y - 10, "+" + awarded, TIERS[newTier].color, false);
      if (this.chainCount >= 2) this.showCombo(x, y - 34, this.chainCount, mult);
    }

    spawnMergedOrb(tier, x, y) {
      const r = TIERS[tier].r;
      const orb = this.matter.add.image(x, y, "nm-orb-" + tier);
      orb.setCircle(r);
      orb.setBounce(0.1);
      orb.setFriction(0.35, 0.01);
      orb.tier = tier;
      orb.setDepth(8);
      orb.setVelocity(0, -2);
      orb.setAngularVelocity(Phaser.Math.FloatBetween(-0.05, 0.05));
      this.activeOrbs.push(orb);
    }

    triggerSupernova(x, y) {
      let bonus = TIERS[MAX_TIER].value * 2;
      for (const orb of this.activeOrbs.slice()) {
        if (orb.merging) continue;
        const d = Phaser.Math.Distance.Between(orb.x, orb.y, x, y);
        if (d <= SUPERNOVA_RADIUS) {
          bonus += Math.round(TIERS[orb.tier].value * 0.5);
          orb.merging = true;
          this.removeFromActive(orb);
          orb.destroy();
        }
      }
      this.score += bonus;
      this.updateScoreText();
      this.cameras.main.shake(220, 0.012);
      this.burst(x, y, 40);
      const ring = this.add.circle(x, y, 30, 0xfff2a8, 0.5).setDepth(41).setScale(0.2);
      this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 480, onComplete: () => ring.destroy() });
      this.floatingText(x, y - 16, "SUPERNOVA! +" + bonus, 0xfff2a8, true);
    }

    burst(x, y, count) {
      this.sparks.explode(Math.min(count, 40), x, y);
    }

    floatingText(x, y, str, colorNum, big) {
      const t = this.add
        .text(x, y, str, {
          fontFamily: "Arial, sans-serif",
          fontSize: big ? "22px" : "16px",
          color: hex(colorNum),
          stroke: "#241c55",
          strokeThickness: big ? 4 : 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.tweens.add({
        targets: t,
        y: y - 40,
        alpha: 0,
        duration: 750,
        ease: "Cubic.easeOut",
        onComplete: () => t.destroy(),
      });
    }

    showCombo(x, y, chain, mult) {
      const label = chain >= 5 ? "MEGA CHAIN" : chain >= 3 ? "SUPER CHAIN" : "COMBO";
      const col = chain >= 5 ? 0xff5040 : chain >= 3 ? 0xff9a3c : 0xffe066;
      const multStr = (Math.round(mult * 10) / 10).toString();
      const t = this.add
        .text(x, y, label + " ×" + multStr, {
          fontFamily: "Arial, sans-serif",
          fontSize: 16 + chain * 2 + "px",
          color: hex(col),
          stroke: "#3a1400",
          strokeThickness: 4,
          fontStyle: "bold italic",
        })
        .setOrigin(0.5)
        .setDepth(51)
        .setScale(0.6);
      this.tweens.add({ targets: t, scale: 1, duration: 120, ease: "Back.easeOut" });
      this.tweens.add({ targets: t, y: y - 46, alpha: 0, delay: 260, duration: 520, onComplete: () => t.destroy() });
    }

    /* ---------- danger line & game over ---------- */

    dangerLineY() {
      const over = Math.max(this.mergeCount - DANGER_CREEP_START, 0);
      return SILO_TOP + Math.min(over * DANGER_CREEP_PER_MERGE, DANGER_CREEP_MAX);
    }

    update(time) {
      if (this.over) return;
      const lineY = this.dangerLineY();
      this.dangerLineGfx.y = lineY;
      for (const orb of this.activeOrbs) {
        if (orb.merging) continue;
        const body = orb.body;
        const speed = Math.abs(body.velocity.x) + Math.abs(body.velocity.y);
        const topY = orb.y - TIERS[orb.tier].r;
        if (speed < SETTLE_EPS && topY < lineY) {
          if (orb.overSince == null) orb.overSince = time;
          else if (time - orb.overSince > OVER_MS) {
            this.gameOver();
            return;
          }
        } else {
          orb.overSince = null;
        }
      }
    }

    gameOver() {
      if (this.over) return;
      this.over = true;
      this.matter.world.pause(); // freeze the pile exactly as shown on the panel
      this.saveHigh();
      this.updateSwapButton();
      const isBest = this.score > this.startBest;

      this.add.rectangle(W / 2, H / 2, W, H, 0x05030f, 0.72).setDepth(60);
      this.add
        .text(W / 2, H * 0.36, "RUN COMPLETE", {
          fontFamily: "Arial, sans-serif",
          fontSize: "34px",
          color: "#ffe7a3",
          stroke: "#3a2500",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(61);
      this.add
        .text(
          W / 2,
          H * 0.36 + 46,
          "SCORE  " + this.score + "\nBEST   " + Math.max(this.score, this.startBest) + (isBest ? "   ★NEW!" : ""),
          {
            fontFamily: "Arial, sans-serif",
            fontSize: "22px",
            color: "#ffffff",
            stroke: "#241c55",
            strokeThickness: 4,
            align: "center",
            fontStyle: "bold",
          }
        )
        .setOrigin(0.5)
        .setDepth(61);

      this.makeButton(W / 2, H * 0.62, "▸ Play Again", () => this.scene.restart());
      this.makeButton(W / 2, H * 0.62 + 54, "≡ Menu", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
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

  function launchNovaMerge() {
    if (window.novaMergeGame) return window.novaMergeGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#0a0730",
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
      scene: [NovaMergeScene],
    };
    const game = new Phaser.Game(config);
    window.novaMergeGame = game;
    return game;
  }

  window.launchNovaMerge = launchNovaMerge;
})();
