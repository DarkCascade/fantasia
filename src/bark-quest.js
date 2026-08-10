/*
 * Bark Quest — Miles the red doberman vs. an endless line of foes.
 *
 * A Puzzle-Quest-style match-3 battler. The bottom two thirds of the screen is
 * a 6x6 gem board; drag (or tap) a gem onto a neighbour to swap them and line
 * up three or more. Nobody has hit points here — every combatant has a
 * COURAGE meter, and the only weapon is a bark.
 *
 * Each of the four gem colours charges one of Miles' bark meters (the four
 * tubes under his paws). Gold gems are wild fuel: every gold gem matched adds
 * to all four meters at once, and gold has no meter of its own. When a meter
 * tops out Miles drops into his barking stance and lets rip an anime energy
 * beam in that colour; the foe loses Courage, and at zero Courage it turns tail
 * and runs. The foe barks back on a fuse of its own — and when Miles' Courage
 * hits zero it isn't a death or a defeat: supper gets called, and he trots home
 * with his tally. That's the run's only ending.
 *
 * All art is generated at runtime from primitives, like the rest of Fantasia.
 * Created on demand via window.launchBarkQuest() so the menu stays first.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 680;

  /* ---------- board geometry ---------- */

  const COLS = 6;
  const ROWS = 6;
  const CELL = 62;
  const GX = 14; // board left edge
  const GY = 218; // board top edge
  const GEM = 56; // gem texture size

  const GROUND_Y = 168;

  /* ---------- gems, meters and attacks ----------
   * The first four entries are the meter colours (index === meter index); gold
   * is index 4 and deliberately has no meter — it feeds all of them.
   */
  const GEMS = [
    {
      key: "red",
      label: "FURY BARK",
      tile: 0xd8362f,
      edge: 0x6d1512,
      hi: 0xff8f76,
      beam: 0xff3b2f,
      css: "#ff6b5a",
      need: 14,
      dmg: 30,
    },
    {
      key: "brown",
      label: "THUNDER YAP",
      tile: 0x8c5a2e,
      edge: 0x3f2210,
      hi: 0xd7a06a,
      beam: 0xd08a45,
      css: "#e0a86a",
      need: 11,
      dmg: 20,
    },
    {
      key: "green",
      label: "BRAVE GROWL",
      tile: 0x46b357,
      edge: 0x155c25,
      hi: 0x9cf0a8,
      beam: 0x4de06a,
      css: "#6ce87f",
      need: 6,
      dmg: 9,
    },
    {
      key: "blue",
      label: "SONIC WOOF",
      tile: 0x3a7fd5,
      edge: 0x12386e,
      hi: 0x9ad0ff,
      beam: 0x49b6ff,
      css: "#79c6ff",
      need: 8,
      dmg: 14,
    },
    {
      key: "gold",
      label: "GOLD",
      tile: 0xf2c14a,
      edge: 0x8a5c0c,
      hi: 0xfff3c0,
      beam: 0xffe27a,
      css: "#ffe27a",
      need: 0,
      dmg: 0,
    },
  ];
  const GOLD = 4;
  const METERS = 4;

  // Gold is the rare one; the four meter colours are equally likely.
  const GEM_WEIGHTS = [22, 22, 22, 22, 11];
  const GEM_TOTAL = GEM_WEIGHTS.reduce((a, b) => a + b, 0);

  /* ---------- special gems ----------
   * A run of 4 leaves a LINE gem behind, a run of 5+ leaves a BURST. Both keep
   * their colour and feed the normal meters — the special is a second axis on
   * the cell (`kind`), not a sixth colour. Gold is excluded: it already feeds
   * all four meters, so a gold line clear would chain a wall of beams.
   */
  const PLAIN = 0;
  const LINE = 1; // clears its whole row or column when cleared
  const BURST = 2; // swap it onto a gem to clear every tile of that colour
  const RUN_FOR_LINE = 4;
  const RUN_FOR_BURST = 5;
  const QUEUE_CAP = 2; // barks in flight at once — the rest wait their turn
  const METER_CAP_BARKS = 2; // a tube holds two barks; overflow is lost

  function canSpecial(color) {
    return color !== GOLD;
  }

  function gemTex(color, kind) {
    const key = "bq-gem-" + GEMS[color].key;
    if (kind === LINE) return key + "-line";
    if (kind === BURST) return key + "-burst";
    return key;
  }

  const GREEN_HEAL = 8; // Brave Growl steadies Miles' own nerve
  const BLUE_STALL = 2400; // Sonic Woof shoves the foe's bark fuse back (ms)

  /* ---------- combatants ---------- */

  const MILES_COURAGE = 100;
  const MILES_RECOVER = 12; // nerve regained after each foe is routed

  const FOES = {
    fox: { name: "FOX", tex: "bq-fox", half: 40, courage: 88, bark: 9, fuse: 7200 },
    wolf: { name: "WOLF", tex: "bq-wolf", half: 44, courage: 150, bark: 14, fuse: 6400 },
  };

  const MILES_X = 80;
  const MILES_Y = GROUND_Y - 48; // texture is 96 tall
  const FOE_X = 300;

  const BEST_KEY = "bark-quest-best";

  /* ---------- little helpers ---------- */

  function font(size, color, thickness) {
    return {
      fontFamily: "Arial, sans-serif",
      fontSize: size + "px",
      color: color,
      stroke: "#000000",
      strokeThickness: thickness === undefined ? 4 : thickness,
      fontStyle: "bold",
    };
  }

  function poly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
  }

  function starPoints(cx, cy, outer, inner, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function randomGem() {
    let roll = Math.random() * GEM_TOTAL;
    for (let i = 0; i < GEM_WEIGHTS.length; i++) {
      roll -= GEM_WEIGHTS[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  class BarkQuestScene extends Phaser.Scene {
    constructor() {
      super("BarkQuestScene");
    }

    create() {
      this.state = "intro";
      this.busy = false;
      this.routed = 0;
      this.wave = 0;
      this.queue = [];
      this.forced = []; // burst gems fired by a swap, pending the next resolve
      this.lastSwap = null; // where a run of 4+ should leave its special
      this.selected = null;
      this.dragFrom = null;
      this.best = this.loadBest();

      this.buildTextures();
      this.buildStage();
      this.buildMiles();
      this.buildHud();
      this.buildBoard();
      this.bindInput();

      this.nextFoe();
    }

    loadBest() {
      try {
        return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
      } catch (e) {
        return 0;
      }
    }

    saveBest() {
      if (this.routed <= this.best) return;
      this.best = this.routed;
      try {
        window.localStorage.setItem(BEST_KEY, String(this.best));
      } catch (e) {
        /* private mode: just keep it in memory */
      }
      this.bestText.setText("BEST " + this.best);
    }

    /* ================================================================== */
    /*  Textures                                                          */
    /* ================================================================== */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      this.buildBackdrop(g);
      this.buildBowl(g);
      this.buildGems(g);
      this.buildMilesTextures(g);
      this.buildFoxTexture(g);
      this.buildWolfTexture(g);

      g.destroy();
    }

    buildBackdrop(g) {
      if (this.textures.exists("bq-bg")) return;
      const top = Phaser.Display.Color.ValueToColor(0x2b1f52);
      const bot = Phaser.Display.Color.ValueToColor(0x0a0718);
      const strips = 48;
      const sh = Math.ceil(H / strips);
      for (let i = 0; i < strips; i++) {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
        g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
        g.fillRect(0, i * sh, W, sh + 1);
      }
      // A pale moon behind the duel so the silhouettes read.
      g.fillStyle(0xfff2c4, 0.1);
      g.fillCircle(300, 84, 62);
      g.fillStyle(0xfff2c4, 0.14);
      g.fillCircle(300, 84, 44);
      g.generateTexture("bq-bg", W, H);
      g.clear();
    }

    // Miles' supper bowl, for the end-of-run panel.
    buildBowl(g) {
      if (this.textures.exists("bq-bowl")) return;
      g.clear();
      // Heaped food first, so the bowl rim overlaps it.
      g.fillStyle(0x8a4a22, 1);
      g.fillEllipse(44, 26, 52, 22);
      g.fillStyle(0xa8632f, 1);
      g.fillEllipse(38, 23, 20, 11);
      g.fillEllipse(54, 25, 16, 9);
      // Bowl: bevel, body, rim, and a pale foot.
      g.fillStyle(0x1d3a63, 1);
      poly(g, [
        { x: 12, y: 26 },
        { x: 76, y: 26 },
        { x: 66, y: 56 },
        { x: 22, y: 56 },
      ]);
      g.fillStyle(0x2f5a8a, 1);
      poly(g, [
        { x: 16, y: 30 },
        { x: 72, y: 30 },
        { x: 63, y: 53 },
        { x: 25, y: 53 },
      ]);
      g.fillStyle(0x4d84c4, 0.75);
      g.fillEllipse(44, 27, 64, 13);
      g.fillStyle(0x1d3a63, 1);
      g.fillEllipse(44, 27, 52, 8);
      g.fillStyle(0xd7e6f5, 0.85);
      g.fillRoundedRect(22, 44, 10, 5, 2.5);
      g.fillStyle(0x16294a, 1);
      g.fillRoundedRect(18, 55, 52, 6, 3);
      g.generateTexture("bq-bowl", 88, 64);
      g.clear();
    }

    buildGems(g) {
      for (let i = 0; i < GEMS.length; i++) {
        const def = GEMS[i];
        // Plain tile, plus the two special variants for every colour but gold.
        const kinds = canSpecial(i) ? [PLAIN, LINE, BURST] : [PLAIN];
        for (let k = 0; k < kinds.length; k++) {
          const kind = kinds[k];
          const key = gemTex(i, kind);
          if (this.textures.exists(key)) continue;
          g.clear();
          this.gemFace(g, def, kind);

          // Every colour carries its own silhouette, so the board is readable
          // without relying on hue alone.
          if (i === 0) this.iconBone(g);
          else if (i === 1) this.iconBell(g);
          else if (i === 2) this.iconPaw(g);
          else if (i === 3) this.iconBall(g);
          else this.iconStar(g);

          if (kind === LINE) this.markLine(g, def);
          else if (kind === BURST) this.markBurst(g, def);

          g.generateTexture(key, GEM, GEM);
        }
      }
      g.clear();
    }

    // Tile: dark bevel, colour face, glossy corner. Specials get a brighter
    // face and a pale rim so they stand out from the plain tiles at 62px.
    gemFace(g, def, kind) {
      g.fillStyle(kind === PLAIN ? def.edge : 0xfff6e0, 1);
      g.fillRoundedRect(0, 0, GEM, GEM, 15);
      g.fillStyle(def.tile, 1);
      g.fillRoundedRect(3, 3, GEM - 6, GEM - 6, 13);
      if (kind !== PLAIN) {
        g.fillStyle(def.hi, 0.28);
        g.fillRoundedRect(3, 3, GEM - 6, GEM - 6, 13);
      }
      g.fillStyle(def.hi, 0.5);
      g.fillRoundedRect(8, 7, 24, 12, 6);
      g.fillStyle(0x000000, 0.16);
      g.fillRoundedRect(8, GEM - 16, GEM - 16, 8, 4);
    }

    // LINE: a cross with arrowheads on all four sides — it sweeps both axes.
    markLine(g, def) {
      const mid = GEM / 2;
      // Kept thin on purpose: the colour's own silhouette has to stay legible
      // underneath, since that is the board's colour-blind cue.
      g.fillStyle(0x000000, 0.28);
      g.fillRect(4, mid - 3, GEM - 8, 6);
      g.fillRect(mid - 3, 4, 6, GEM - 8);
      g.fillStyle(0xffffff, 0.95);
      g.fillRect(4, mid - 1, GEM - 8, 2);
      g.fillRect(mid - 1, 4, 2, GEM - 8);
      g.fillStyle(0xffffff, 1);
      const head = [
        [{ x: 11, y: mid - 6 }, { x: 3, y: mid }, { x: 11, y: mid + 6 }],
        [{ x: GEM - 11, y: mid - 6 }, { x: GEM - 3, y: mid }, { x: GEM - 11, y: mid + 6 }],
        [{ x: mid - 6, y: 11 }, { x: mid, y: 3 }, { x: mid + 6, y: 11 }],
        [{ x: mid - 6, y: GEM - 11 }, { x: mid, y: GEM - 3 }, { x: mid + 6, y: GEM - 11 }],
      ];
      for (let i = 0; i < head.length; i++) poly(g, head[i]);
    }

    // BURST: a radiant star behind the icon — "this one takes the whole colour".
    markBurst(g, def) {
      g.fillStyle(0xffffff, 0.85);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const x = GEM / 2 + Math.cos(a) * 20;
        const y = GEM / 2 + Math.sin(a) * 20;
        poly(g, [
          { x: GEM / 2 + Math.cos(a - 0.16) * 12, y: GEM / 2 + Math.sin(a - 0.16) * 12 },
          { x: x, y: y },
          { x: GEM / 2 + Math.cos(a + 0.16) * 12, y: GEM / 2 + Math.sin(a + 0.16) * 12 },
        ]);
      }
      g.lineStyle(2.5, 0xffffff, 0.95);
      g.strokeRoundedRect(4, 4, GEM - 8, GEM - 8, 12);
      g.fillStyle(def.hi, 0.5);
      g.fillCircle(GEM / 2, GEM / 2, 9);
    }

    iconBone(g) {
      g.fillStyle(0xfff2e2, 1);
      g.fillRoundedRect(16, 24, 24, 9, 4);
      g.fillCircle(17, 22, 6.5);
      g.fillCircle(17, 34, 6.5);
      g.fillCircle(39, 22, 6.5);
      g.fillCircle(39, 34, 6.5);
      g.fillStyle(0xd7b9a3, 0.5);
      g.fillRoundedRect(18, 31, 20, 3, 1.5);
    }

    iconBell(g) {
      g.fillStyle(0xfff4cf, 1);
      poly(g, [
        { x: 17, y: 38 },
        { x: 21, y: 21 },
        { x: 35, y: 21 },
        { x: 39, y: 38 },
      ]);
      g.fillRoundedRect(15, 36, 26, 6, 3);
      g.fillCircle(28, 45, 4);
      g.fillCircle(28, 18, 3.4);
      g.fillStyle(0x7a4a1e, 0.5);
      g.fillRoundedRect(24, 24, 4, 13, 2);
    }

    iconPaw(g) {
      g.fillStyle(0xf0fff0, 1);
      g.fillEllipse(28, 35, 24, 19);
      g.fillCircle(17, 22, 5);
      g.fillCircle(24, 17, 5);
      g.fillCircle(33, 17, 5);
      g.fillCircle(40, 22, 5);
      g.fillStyle(0x2d7a3b, 0.35);
      g.fillEllipse(28, 37, 12, 8);
    }

    iconBall(g) {
      g.fillStyle(0xf2f8ff, 1);
      g.fillCircle(28, 29, 13);
      g.lineStyle(3, 0x2a6bb5, 1);
      g.beginPath();
      g.arc(28, 15, 13, 0.5, 2.64);
      g.strokePath();
      g.beginPath();
      g.arc(28, 43, 13, 3.64, 5.78);
      g.strokePath();
      g.fillStyle(0xffffff, 0.7);
      g.fillCircle(23, 24, 3);
    }

    iconStar(g) {
      g.fillStyle(0xfff6d0, 1);
      poly(g, starPoints(28, 29, 17, 7.4, 5));
      g.fillStyle(0xffdc70, 0.85);
      poly(g, starPoints(28, 29, 10, 4.4, 5));
    }

    /* ---- Miles: a red (rust) doberman in profile, facing right ---- */

    buildMilesTextures(g) {
      const COAT = 0x94401f;
      const DARK = 0x6c2b13;
      const TAN = 0xd79b5e;
      const EAR = 0xb96a4a;
      const NOSE = 0x241309;
      const GUM = 0x51101d;

      // Shared body: a short-coupled, deep-chested dog standing square. Only
      // the head and the front paw differ between the two stances.
      const drawBody = () => {
        // Far legs first, shaded, so the near pair reads as closer.
        g.fillStyle(DARK, 1);
        g.fillRoundedRect(42, 62, 10, 32, 5);
        g.fillRoundedRect(60, 62, 10, 32, 5);

        g.fillStyle(COAT, 1);
        g.fillRoundedRect(20, 40, 58, 28, 13); // barrel
        g.fillCircle(32, 54, 15); // haunch
        g.fillCircle(68, 54, 15); // chest

        // Docked tail, cocked up over the rump.
        poly(g, [
          { x: 14, y: 46 },
          { x: 18, y: 22 },
          { x: 27, y: 24 },
          { x: 25, y: 48 },
        ]);

        // Tan belly and chest markings.
        g.fillStyle(TAN, 1);
        g.fillEllipse(48, 66, 32, 8);
        g.fillEllipse(76, 56, 10, 18);
      };

      const drawNearLegs = () => {
        g.fillStyle(COAT, 1);
        g.fillRoundedRect(26, 62, 11, 32, 5);
        g.fillRoundedRect(70, 62, 11, 32, 5);
        g.fillStyle(TAN, 1);
        g.fillRoundedRect(26, 84, 11, 10, 5);
        g.fillRoundedRect(70, 84, 11, 10, 5);
        g.fillRoundedRect(42, 84, 10, 10, 5);
        g.fillRoundedRect(60, 84, 10, 10, 5);
      };

      /* --- idle: head level, mouth shut, watching --- */
      if (!this.textures.exists("bq-miles")) {
        g.clear();
        drawBody();

        // Narrow neck; the head sits down on the shoulders and is clearly
        // wider than the neck, so he reads as a dog rather than a deer.
        g.fillStyle(COAT, 1);
        poly(g, [
          { x: 66, y: 50 },
          { x: 76, y: 30 },
          { x: 86, y: 34 },
          { x: 80, y: 54 },
        ]);
        g.fillRoundedRect(70, 22, 32, 22, 9); // skull

        // Cropped ears: tall, narrow, close together.
        poly(g, [
          { x: 74, y: 25 },
          { x: 77, y: 6 },
          { x: 85, y: 23 },
        ]);
        poly(g, [
          { x: 87, y: 24 },
          { x: 93, y: 6 },
          { x: 98, y: 23 },
        ]);
        g.fillStyle(EAR, 1);
        poly(g, [
          { x: 76, y: 23 },
          { x: 78, y: 11 },
          { x: 83, y: 22 },
        ]);
        poly(g, [
          { x: 89, y: 22 },
          { x: 92.5, y: 11 },
          { x: 96, y: 22 },
        ]);

        // Long tapering muzzle.
        g.fillStyle(TAN, 1);
        poly(g, [
          { x: 96, y: 30 },
          { x: 112, y: 33 },
          { x: 112, y: 42 },
          { x: 96, y: 43 },
        ]);
        g.fillStyle(NOSE, 1);
        g.fillCircle(109, 35, 3.8);
        g.lineStyle(1.6, 0x8a5a30, 1);
        g.lineBetween(100, 42, 109, 41); // closed mouth

        // Tan brow spot and amber eye.
        g.fillStyle(TAN, 1);
        g.fillEllipse(84, 27, 9, 4);
        g.fillStyle(0xffd07a, 1);
        g.fillCircle(84, 32, 3.4);
        g.fillStyle(NOSE, 1);
        g.fillCircle(85, 32, 2.1);

        drawNearLegs();
        g.generateTexture("bq-miles", 112, 96);
      }

      /* --- barking: head thrown up and back, jaw cracked wide --- */
      if (!this.textures.exists("bq-miles-bark")) {
        g.clear();
        drawBody();

        // Neck extended and rocked back, head lifted clear of the shoulders.
        g.fillStyle(COAT, 1);
        poly(g, [
          { x: 64, y: 50 },
          { x: 70, y: 24 },
          { x: 82, y: 28 },
          { x: 76, y: 54 },
        ]);
        g.fillRoundedRect(64, 14, 32, 22, 9); // skull

        // Ears swept back with the effort.
        poly(g, [
          { x: 68, y: 17 },
          { x: 62, y: 3 },
          { x: 76, y: 14 },
        ]);
        poly(g, [
          { x: 78, y: 16 },
          { x: 75, y: 2 },
          { x: 87, y: 14 },
        ]);
        g.fillStyle(EAR, 1);
        poly(g, [
          { x: 69, y: 15 },
          { x: 66, y: 7 },
          { x: 75, y: 14 },
        ]);
        poly(g, [
          { x: 79, y: 14 },
          { x: 77.5, y: 6 },
          { x: 84, y: 14 },
        ]);

        // Upper jaw, angled up; gullet; lolling tongue; lower jaw dropped away.
        g.fillStyle(TAN, 1);
        poly(g, [
          { x: 90, y: 20 },
          { x: 112, y: 22 },
          { x: 112, y: 30 },
          { x: 90, y: 32 },
        ]);
        g.fillStyle(NOSE, 1);
        g.fillCircle(109, 25, 3.8);
        g.fillStyle(GUM, 1);
        poly(g, [
          { x: 90, y: 30 },
          { x: 111, y: 30 },
          { x: 112, y: 42 },
          { x: 90, y: 39 },
        ]);
        g.fillStyle(0xd0455f, 1);
        poly(g, [
          { x: 94, y: 34 },
          { x: 108, y: 37 },
          { x: 106, y: 41 },
          { x: 94, y: 39 },
        ]);
        g.fillStyle(0xfff4e4, 1);
        poly(g, [
          { x: 94, y: 30 },
          { x: 99, y: 30 },
          { x: 96, y: 36 },
        ]);
        poly(g, [
          { x: 95, y: 39 },
          { x: 100, y: 40 },
          { x: 97, y: 34 },
        ]);
        g.fillStyle(TAN, 1);
        poly(g, [
          { x: 89, y: 37 },
          { x: 109, y: 42 },
          { x: 107, y: 50 },
          { x: 88, y: 45 },
        ]);

        // Snarling brow and a hot eye.
        g.fillStyle(TAN, 1);
        g.fillEllipse(78, 18, 9, 4);
        g.fillStyle(0xffd07a, 1);
        g.fillCircle(78, 23, 3.4);
        g.fillStyle(NOSE, 1);
        g.fillCircle(79, 23, 2.1);
        g.fillStyle(DARK, 1);
        poly(g, [
          { x: 71, y: 17 },
          { x: 85, y: 21 },
          { x: 85, y: 17 },
        ]);

        drawNearLegs();
        // Braced front paw, reaching forward mid-bark.
        g.fillStyle(COAT, 1);
        g.fillRoundedRect(70, 76, 20, 12, 6);
        g.fillStyle(TAN, 1);
        g.fillRoundedRect(74, 82, 16, 6, 3);
        g.generateTexture("bq-miles-bark", 112, 96);
      }

      g.clear();
    }

    /* ---- Fox: facing left, towards Miles ---- */

    buildFoxTexture(g) {
      if (this.textures.exists("bq-fox")) return;
      const FUR = 0xd9682a;
      const DARK = 0xa54718;
      const CREAM = 0xffeacf;
      const SOCK = 0x40241a;
      g.clear();

      // Bushy tail sweeping out behind (to the right).
      g.fillStyle(FUR, 1);
      g.fillEllipse(74, 44, 40, 26);
      g.fillStyle(CREAM, 1);
      g.fillCircle(90, 40, 9);

      // Far legs.
      g.fillStyle(DARK, 1);
      g.fillRoundedRect(38, 58, 8, 22, 4);
      g.fillRoundedRect(56, 58, 8, 22, 4);

      // Body.
      g.fillStyle(FUR, 1);
      g.fillRoundedRect(24, 38, 44, 26, 12);
      g.fillCircle(60, 50, 15);
      g.fillCircle(32, 50, 13);

      // Neck into the head, on the left.
      poly(g, [
        { x: 34, y: 40 },
        { x: 20, y: 24 },
        { x: 8, y: 34 },
        { x: 26, y: 52 },
      ]);
      g.fillRoundedRect(8, 20, 26, 20, 8);
      // Snout.
      g.fillStyle(CREAM, 1);
      poly(g, [
        { x: 14, y: 28 },
        { x: 14, y: 38 },
        { x: 0, y: 34 },
      ]);
      g.fillStyle(0x1c1108, 1);
      g.fillCircle(2, 33, 3);

      // Big ears.
      g.fillStyle(FUR, 1);
      poly(g, [
        { x: 12, y: 22 },
        { x: 8, y: 2 },
        { x: 22, y: 18 },
      ]);
      poly(g, [
        { x: 24, y: 21 },
        { x: 28, y: 2 },
        { x: 34, y: 20 },
      ]);
      g.fillStyle(0x2b1a12, 1);
      poly(g, [
        { x: 13, y: 20 },
        { x: 10.5, y: 8 },
        { x: 18, y: 18 },
      ]);
      poly(g, [
        { x: 25.5, y: 19 },
        { x: 27.5, y: 8 },
        { x: 31, y: 18 },
      ]);

      // Cheek ruff, eye, chest.
      g.fillStyle(CREAM, 1);
      g.fillEllipse(20, 40, 14, 10);
      g.fillEllipse(26, 56, 12, 16);
      g.fillStyle(0xfff0b0, 1);
      g.fillCircle(21, 28, 3.4);
      g.fillStyle(0x1c1108, 1);
      g.fillCircle(20, 28, 2.1);

      // Near legs with dark socks.
      g.fillStyle(FUR, 1);
      g.fillRoundedRect(26, 58, 9, 22, 4);
      g.fillRoundedRect(60, 58, 9, 22, 4);
      g.fillStyle(SOCK, 1);
      g.fillRoundedRect(26, 71, 9, 9, 4);
      g.fillRoundedRect(60, 71, 9, 9, 4);
      g.fillRoundedRect(38, 71, 8, 9, 4);
      g.fillRoundedRect(56, 71, 8, 9, 4);

      g.generateTexture("bq-fox", 96, 80);
      g.clear();
    }

    /* ---- Wolf: facing left, bigger and greyer ---- */

    buildWolfTexture(g) {
      if (this.textures.exists("bq-wolf")) return;
      const FUR = 0x7c8794;
      const DARK = 0x525c68;
      const PALE = 0xd9e0e8;
      g.clear();

      // Heavy tail, hanging low behind.
      g.fillStyle(FUR, 1);
      g.fillEllipse(88, 56, 38, 24);
      g.fillStyle(DARK, 1);
      g.fillCircle(102, 60, 9);

      // Far legs.
      g.fillStyle(DARK, 1);
      g.fillRoundedRect(44, 62, 10, 26, 5);
      g.fillRoundedRect(66, 62, 10, 26, 5);

      // Deep chest and barrel.
      g.fillStyle(FUR, 1);
      g.fillRoundedRect(26, 38, 52, 30, 14);
      g.fillCircle(70, 52, 18);
      g.fillCircle(34, 52, 16);

      // Lowered head, shoulders up.
      poly(g, [
        { x: 38, y: 40 },
        { x: 22, y: 26 },
        { x: 8, y: 38 },
        { x: 28, y: 56 },
      ]);
      g.fillRoundedRect(8, 22, 30, 22, 9);
      g.fillStyle(PALE, 1);
      poly(g, [
        { x: 16, y: 30 },
        { x: 16, y: 42 },
        { x: -2, y: 38 },
      ]);
      g.fillStyle(0x14181d, 1);
      g.fillCircle(1, 36, 3.2);
      // A hint of bared teeth.
      g.fillStyle(0xfdfdfd, 1);
      poly(g, [
        { x: 6, y: 39 },
        { x: 10, y: 39 },
        { x: 8, y: 44 },
      ]);

      // Ears: shorter and rounder than the fox's.
      g.fillStyle(FUR, 1);
      poly(g, [
        { x: 14, y: 24 },
        { x: 12, y: 8 },
        { x: 24, y: 21 },
      ]);
      poly(g, [
        { x: 26, y: 23 },
        { x: 31, y: 8 },
        { x: 36, y: 22 },
      ]);
      g.fillStyle(0x39414b, 1);
      poly(g, [
        { x: 15, y: 22 },
        { x: 14, y: 13 },
        { x: 20, y: 21 },
      ]);
      poly(g, [
        { x: 27.5, y: 21 },
        { x: 30, y: 13 },
        { x: 33, y: 21 },
      ]);

      // Yellow eye, pale ruff.
      g.fillStyle(PALE, 1);
      g.fillEllipse(24, 44, 14, 10);
      g.fillEllipse(30, 60, 12, 18);
      g.fillStyle(0xffe066, 1);
      g.fillCircle(24, 31, 3.6);
      g.fillStyle(0x14181d, 1);
      g.fillCircle(23, 31, 2.2);

      // Near legs.
      g.fillStyle(FUR, 1);
      g.fillRoundedRect(30, 62, 11, 26, 5);
      g.fillRoundedRect(70, 62, 11, 26, 5);
      g.fillStyle(DARK, 1);
      g.fillRoundedRect(30, 79, 11, 9, 4);
      g.fillRoundedRect(70, 79, 11, 9, 4);

      g.generateTexture("bq-wolf", 108, 88);
      g.clear();
    }

    /* ================================================================== */
    /*  Stage, Miles, HUD                                                 */
    /* ================================================================== */

    buildStage() {
      this.add.image(0, 0, "bq-bg").setOrigin(0, 0).setDepth(-30);
      this.add.rectangle(0, GROUND_Y, W, 3, 0x6a5aa8, 0.8).setOrigin(0, 0).setDepth(-20);
      this.add.rectangle(0, GROUND_Y + 3, W, 46, 0x120c26, 0.55).setOrigin(0, 0).setDepth(-21);
    }

    buildMiles() {
      this.miles = this.add.image(MILES_X, MILES_Y, "bq-miles").setDepth(10);
      this.milesCourage = MILES_COURAGE;
      // A slow breathing bob so he never looks like a decal.
      this.tweens.add({
        targets: this.miles,
        y: MILES_Y - 3,
        duration: 1300,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    buildHud() {
      this.add.text(W / 2, 18, "BARK QUEST", font(17, "#ffe7a3", 5)).setOrigin(0.5).setDepth(30);

      this.makeButton(30, 18, "≡", 0x4a4270, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }, 15);

      this.add.text(14, 40, "MILES", font(11, "#ffd7b0", 3)).setOrigin(0, 0.5).setDepth(30);
      this.foeLabel = this.add.text(386, 40, "", font(11, "#cfe0ff", 3)).setOrigin(1, 0.5).setDepth(30);

      this.courageG = this.add.graphics().setDepth(30);
      this.fuseG = this.add.graphics().setDepth(30);

      // Four bark meters, stacked under Miles' paws.
      this.meters = [0, 0, 0, 0];
      this.meterG = this.add.graphics().setDepth(28);
      this.meterFlash = [0, 0, 0, 0];

      this.bannerText = this.add.text(W / 2, 300, "", font(34, "#ffffff", 8)).setOrigin(0.5).setDepth(70).setAlpha(0);

      this.routedText = this.add.text(14, 610, "ROUTED 0", font(15, "#ffe7a3", 4)).setOrigin(0, 0.5).setDepth(30);
      this.bestText = this.add
        .text(386, 610, "BEST " + this.best, font(15, "#cfe0ff", 4))
        .setOrigin(1, 0.5)
        .setDepth(30);
      this.hintText = this.add
        .text(W / 2, 644, "Drag a gem onto a neighbour — match 3+", font(12, "#b6a8e6", 3))
        .setOrigin(0.5)
        .setDepth(30);

      this.drawCourage();
      this.drawMeters();
    }

    makeButton(x, y, label, color, onClick, size) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: (size || 20) + "px",
          color: "#ffffff",
          backgroundColor: "#" + color.toString(16).padStart(6, "0"),
          padding: { x: 14, y: 7 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(95)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    /* ---------- HUD painting ---------- */

    drawCourage() {
      const g = this.courageG;
      g.clear();
      this.courageBar(g, 14, 48, 150, 14, this.milesCourage / MILES_COURAGE, 0x5ad46a);
      if (this.foe) {
        this.courageBar(g, 236, 48, 150, 14, this.foe.courage / this.foe.maxCourage, 0xe0665a);
      }
    }

    courageBar(g, x, y, w, h, ratio, color) {
      const r = Phaser.Math.Clamp(ratio, 0, 1);
      g.fillStyle(0x000000, 0.55);
      g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 5);
      g.fillStyle(0x2c2350, 1);
      g.fillRoundedRect(x, y, w, h, 4);
      if (r > 0) {
        g.fillStyle(color, 1);
        g.fillRoundedRect(x, y, Math.max(4, w * r), h, 4);
        g.fillStyle(0xffffff, 0.25);
        g.fillRoundedRect(x + 2, y + 2, Math.max(2, w * r - 4), 4, 2);
      }
    }

    drawFuse() {
      const g = this.fuseG;
      g.clear();
      if (!this.foe || this.foe.courage <= 0) return;
      const ratio = Phaser.Math.Clamp(this.foe.fuse / this.foe.fuseMax, 0, 1);
      g.fillStyle(0x000000, 0.5);
      g.fillRect(236, 66, 150, 6);
      g.fillStyle(ratio > 0.75 ? 0xffae3b : 0x8a7fd0, 1);
      g.fillRect(236, 66, 150 * ratio, 6);
    }

    drawMeters() {
      const g = this.meterG;
      g.clear();
      const x0 = 24;
      const tw = 22;
      const gap = 10;
      const top = 172;
      const hgt = 42;
      for (let i = 0; i < METERS; i++) {
        const def = GEMS[i];
        const x = x0 + i * (tw + gap);
        const ratio = Phaser.Math.Clamp(this.meters[i] / def.need, 0, 1);
        const ready = ratio >= 1;
        // Casing. The empty track keeps a wash of its own colour so you can
        // tell the four tubes apart at a glance.
        g.fillStyle(0x000000, 0.6);
        g.fillRoundedRect(x - 3, top - 3, tw + 6, hgt + 6, 7);
        g.fillStyle(def.edge, 0.85);
        g.fillRoundedRect(x, top, tw, hgt, 5);
        g.fillStyle(0x000000, 0.35);
        g.fillRoundedRect(x + 2, top + 2, tw - 4, hgt - 4, 4);
        // Fill, rising from the bottom.
        if (ratio > 0) {
          const fh = Math.max(4, (hgt - 4) * ratio);
          g.fillStyle(def.tile, 1);
          g.fillRoundedRect(x + 2, top + hgt - 2 - fh, tw - 4, fh, 4);
          g.fillStyle(def.hi, 0.6);
          g.fillRect(x + 4, top + hgt - fh, 4, Math.max(2, fh - 4));
        }
        // Rim: bright and thick once the meter is ready to fire.
        g.lineStyle(ready ? 3 : 1.5, ready ? 0xffffff : def.hi, ready ? 1 : 0.65);
        g.strokeRoundedRect(x, top, tw, hgt, 5);
      }
    }

    /* ================================================================== */
    /*  Board                                                             */
    /* ================================================================== */

    cellX(c) {
      return GX + c * CELL + CELL / 2;
    }

    cellY(r) {
      return GY + r * CELL + CELL / 2;
    }

    buildBoard() {
      // Board frame.
      const frame = this.add.graphics().setDepth(2);
      frame.fillStyle(0x000000, 0.45);
      frame.fillRoundedRect(GX - 8, GY - 8, COLS * CELL + 16, ROWS * CELL + 16, 14);
      frame.lineStyle(2, 0x6a5aa8, 0.8);
      frame.strokeRoundedRect(GX - 8, GY - 8, COLS * CELL + 16, ROWS * CELL + 16, 14);
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          frame.fillStyle((c + r) % 2 ? 0x1d1740 : 0x231b4c, 1);
          frame.fillRoundedRect(GX + c * CELL + 2, GY + r * CELL + 2, CELL - 4, CELL - 4, 9);
        }
      }

      this.selectG = this.add.graphics().setDepth(9);

      this.grid = [];
      for (let c = 0; c < COLS; c++) {
        this.grid[c] = [];
        for (let r = 0; r < ROWS; r++) this.grid[c][r] = null;
      }
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          this.grid[c][r] = this.makeGem(c, r, this.safeColor(c, r));
        }
      }
      if (!this.hasAnyMove()) this.shuffleBoard();
    }

    // Pick a colour that can't already be part of a run when the board is dealt.
    safeColor(c, r) {
      for (let guard = 0; guard < 40; guard++) {
        const col = randomGem();
        const twoLeft =
          c >= 2 && this.grid[c - 1][r] && this.grid[c - 2][r] && this.grid[c - 1][r].color === col && this.grid[c - 2][r].color === col;
        const twoUp =
          r >= 2 && this.grid[c][r - 1] && this.grid[c][r - 2] && this.grid[c][r - 1].color === col && this.grid[c][r - 2].color === col;
        if (!twoLeft && !twoUp) return col;
      }
      return 0;
    }

    makeGem(c, r, color, spawnAbove, kind) {
      const y = spawnAbove === undefined ? this.cellY(r) : spawnAbove;
      const k = kind || PLAIN;
      const spr = this.add.image(this.cellX(c), y, gemTex(color, k)).setDepth(5);
      return { color: color, kind: k, spr: spr };
    }

    /* ---- matching ---- */

    // Every run of 3+ on the board, as {cells, len, dir, color}. Runs are kept
    // whole (rather than flattened straight to cells) because their length is
    // what decides whether a special gem is left behind.
    findRuns() {
      const runs = [];
      const take = (cells, dir) => {
        runs.push({ cells: cells, len: cells.length, dir: dir, color: this.grid[cells[0].c][cells[0].r].color });
      };

      for (let r = 0; r < ROWS; r++) {
        let run = 1;
        for (let c = 1; c <= COLS; c++) {
          const a = c < COLS ? this.grid[c][r] : null;
          const b = this.grid[c - 1][r];
          if (a && b && a.color === b.color) {
            run++;
          } else {
            if (run >= 3) {
              const cells = [];
              for (let k = c - run; k < c; k++) cells.push({ c: k, r: r });
              take(cells, "h");
            }
            run = 1;
          }
        }
      }
      for (let c = 0; c < COLS; c++) {
        let run = 1;
        for (let r = 1; r <= ROWS; r++) {
          const a = r < ROWS ? this.grid[c][r] : null;
          const b = this.grid[c][r - 1];
          if (a && b && a.color === b.color) {
            run++;
          } else {
            if (run >= 3) {
              const cells = [];
              for (let k = r - run; k < r; k++) cells.push({ c: c, r: k });
              take(cells, "v");
            }
            run = 1;
          }
        }
      }
      return runs;
    }

    // Flat, deduped cell list — an L or T shape shares cells between two runs.
    findMatches() {
      const hit = [];
      const seen = {};
      const runs = this.findRuns();
      for (let i = 0; i < runs.length; i++) {
        const cells = runs[i].cells;
        for (let j = 0; j < cells.length; j++) {
          const k = cells[j].c + "," + cells[j].r;
          if (seen[k]) continue;
          seen[k] = 1;
          hit.push(cells[j]);
        }
      }
      return hit;
    }

    // Would any single adjacent swap produce a run? Works on a plain colour
    // copy so nothing on screen has to move.
    hasAnyMove() {
      // A burst gem is always a legal move — without this check a board could
      // be called dead and reshuffled out from under the player's burst.
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          if (this.grid[c][r] && this.grid[c][r].kind === BURST) return true;
        }
      }
      const a = [];
      for (let c = 0; c < COLS; c++) {
        a[c] = [];
        for (let r = 0; r < ROWS; r++) a[c][r] = this.grid[c][r] ? this.grid[c][r].color : -1;
      }
      const run3 = (c, r) => {
        const v = a[c][r];
        if (v < 0) return false;
        let n = 1;
        for (let i = c - 1; i >= 0 && a[i][r] === v; i--) n++;
        for (let i = c + 1; i < COLS && a[i][r] === v; i++) n++;
        if (n >= 3) return true;
        n = 1;
        for (let i = r - 1; i >= 0 && a[c][i] === v; i--) n++;
        for (let i = r + 1; i < ROWS && a[c][i] === v; i++) n++;
        return n >= 3;
      };
      const test = (c1, r1, c2, r2) => {
        const t = a[c1][r1];
        a[c1][r1] = a[c2][r2];
        a[c2][r2] = t;
        const ok = run3(c1, r1) || run3(c2, r2);
        a[c2][r2] = a[c1][r1];
        a[c1][r1] = t;
        return ok;
      };
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          if (c + 1 < COLS && test(c, r, c + 1, r)) return true;
          if (r + 1 < ROWS && test(c, r, c, r + 1)) return true;
        }
      }
      return false;
    }

    // Deal a fresh set of colours into the existing gems (no dead boards).
    shuffleBoard() {
      for (let guard = 0; guard < 60; guard++) {
        for (let c = 0; c < COLS; c++) {
          for (let r = 0; r < ROWS; r++) {
            const cell = this.grid[c][r];
            cell.color = randomGem();
            // A reshuffle re-deals colours but never destroys a special the
            // player earned; gold can't hold one, so drop the kind if it lands.
            if (!canSpecial(cell.color)) cell.kind = PLAIN;
            cell.spr.setTexture(gemTex(cell.color, cell.kind));
          }
        }
        if (!this.findMatches().length && this.hasAnyMove()) return;
      }
    }

    /* ---- input ---- */

    bindInput() {
      const zone = this.add
        .zone(GX, GY, COLS * CELL, ROWS * CELL)
        .setOrigin(0, 0)
        .setInteractive();

      zone.on("pointerdown", (p) => {
        if (!this.canPlay()) return;
        const cell = this.cellAt(p.x, p.y);
        if (!cell) return;
        if (this.selected && this.adjacent(this.selected, cell)) {
          const from = this.selected;
          this.clearSelection();
          this.trySwap(from, cell);
          return;
        }
        this.selected = cell;
        this.dragFrom = cell;
        this.drawSelection();
      });

      zone.on("pointermove", (p) => {
        if (!p.isDown || !this.dragFrom || !this.canPlay()) return;
        const cell = this.cellAt(p.x, p.y);
        if (!cell || !this.adjacent(this.dragFrom, cell)) return;
        const from = this.dragFrom;
        this.dragFrom = null;
        this.clearSelection();
        this.trySwap(from, cell);
      });

      this.input.on("pointerup", () => {
        this.dragFrom = null;
      });

      this.input.keyboard.on("keydown-ESC", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }

    canPlay() {
      return this.state === "fight" && !this.busy;
    }

    cellAt(x, y) {
      const c = Math.floor((x - GX) / CELL);
      const r = Math.floor((y - GY) / CELL);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
      return { c: c, r: r };
    }

    adjacent(a, b) {
      return Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
    }

    drawSelection() {
      const g = this.selectG;
      g.clear();
      if (!this.selected) return;
      const x = GX + this.selected.c * CELL;
      const y = GY + this.selected.r * CELL;
      g.lineStyle(3, 0xffe7a3, 1);
      g.strokeRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 10);
      g.fillStyle(0xffffff, 0.12);
      g.fillRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 10);
    }

    clearSelection() {
      this.selected = null;
      this.selectG.clear();
    }

    /* ---- swapping and cascades ---- */

    trySwap(a, b) {
      this.busy = true;
      this.clearSelection();
      const ca = this.grid[a.c][a.r];
      const cb = this.grid[b.c][b.r];
      this.grid[a.c][a.r] = cb;
      this.grid[b.c][b.r] = ca;

      // A run of 4+ leaves its special on the cell the player actually moved,
      // which is what makes a big match feel aimed rather than incidental.
      this.lastSwap = [a, b];

      // Swapping a burst gem is the one move that needs no match: it fires on
      // the colour of whatever it was swapped with.
      this.forced = [];
      if (ca.kind === BURST) this.forced.push({ c: b.c, r: b.r, color: cb.color });
      if (cb.kind === BURST) this.forced.push({ c: a.c, r: a.r, color: ca.color });

      const done = () => {
        if (this.forced.length || this.findMatches().length) {
          this.resolve(1);
        } else {
          // Illegal move: put both back where they were.
          this.grid[a.c][a.r] = ca;
          this.grid[b.c][b.r] = cb;
          this.lastSwap = null;
          this.tweens.add({ targets: ca.spr, x: this.cellX(a.c), y: this.cellY(a.r), duration: 130 });
          this.tweens.add({
            targets: cb.spr,
            x: this.cellX(b.c),
            y: this.cellY(b.r),
            duration: 130,
            onComplete: () => {
              this.busy = false;
            },
          });
        }
      };

      this.tweens.add({ targets: ca.spr, x: this.cellX(b.c), y: this.cellY(b.r), duration: 130, ease: "Quad.easeOut" });
      this.tweens.add({
        targets: cb.spr,
        x: this.cellX(a.c),
        y: this.cellY(a.r),
        duration: 130,
        ease: "Quad.easeOut",
        onComplete: done,
      });
    }

    resolve(cascade) {
      const runs = this.findRuns();
      const forced = this.forced || [];
      this.forced = [];
      if (!runs.length && !forced.length) {
        this.afterResolve();
        return;
      }

      // 1. Everything a run wants gone, deduped across overlapping runs.
      const clear = {};
      const key = (c, r) => c + "," + r;
      const mark = (c, r) => {
        clear[key(c, r)] = { c: c, r: r };
      };
      for (let i = 0; i < runs.length; i++) {
        for (let j = 0; j < runs[i].cells.length; j++) mark(runs[i].cells[j].c, runs[i].cells[j].r);
      }
      // A swapped burst takes the colour it was swapped ONTO, match or no
      // match. It counts as already spent so step 2 doesn't also fire it on
      // its own colour.
      const spent = {};
      for (let i = 0; i < forced.length; i++) {
        mark(forced[i].c, forced[i].r);
        spent[key(forced[i].c, forced[i].r)] = 1;
        this.markColor(clear, mark, forced[i].color);
        const at = this.grid[forced[i].c][forced[i].r];
        if (at) this.detonateFx(at, forced[i].c, forced[i].r, BURST);
      }

      // 2. Detonate specials caught in the clear, to a fixed point — a line
      //    sweep can uncover another special, which sweeps in turn.
      this.expandDetonations(clear, mark, spent);

      // 3. Big runs leave a special behind, so that cell survives the clear.
      const spawns = this.planSpawns(runs, clear);

      // 4. Award and pop everything that is actually going.
      const mult = 1 + 0.3 * (cascade - 1); // later links in a cascade are worth more
      const gains = [0, 0, 0, 0];
      const going = Object.keys(clear);
      for (let i = 0; i < going.length; i++) {
        const m = clear[going[i]];
        const cell = this.grid[m.c][m.r];
        if (!cell) continue;
        if (cell.color === GOLD) {
          // Gold is wild fuel: it feeds every meter and has none of its own.
          for (let k = 0; k < METERS; k++) gains[k] += mult;
        } else {
          gains[cell.color] += mult;
        }
        this.popGem(cell, m.c, m.r);
        this.grid[m.c][m.r] = null;
      }
      // A tube holds two barks and no more. Detonations routinely clear a
      // dozen gems at once, and without a ceiling that charge banks up
      // forever — the tubes sit pegged and the surplus never means anything.
      // Capping it is the Puzzle Quest mana rule: a full meter is a signal to
      // spend, and overflow is the price of sitting on it.
      for (let k = 0; k < METERS; k++) {
        this.meters[k] = Math.min(this.meters[k] + gains[k], GEMS[k].need * METER_CAP_BARKS);
      }
      this.drawMeters();

      for (let i = 0; i < spawns.length; i++) this.makeSpecial(spawns[i]);
      this.lastSwap = null;

      if (cascade > 1) this.floatText(W / 2, GY + 40, "COMBO x" + cascade, "#ffe7a3", 22);

      this.time.delayedCall(140, () => {
        const ms = this.applyGravity();
        this.time.delayedCall(ms + 40, () => this.resolve(cascade + 1));
      });
    }

    // Add every cell of one colour to the clear set (a burst's payload).
    markColor(clear, mark, color) {
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          if (this.grid[c][r] && this.grid[c][r].color === color) mark(c, r);
        }
      }
    }

    // Walk the clear set; every special inside it drags in its own payload,
    // and anything newly dragged in is walked too. `fired` keeps chains finite.
    expandDetonations(clear, mark, spent) {
      const fired = {};
      if (spent) for (const k in spent) fired[k] = 1;
      for (let guard = 0; guard < COLS * ROWS; guard++) {
        const keys = Object.keys(clear);
        let grew = false;
        for (let i = 0; i < keys.length; i++) {
          if (fired[keys[i]]) continue;
          const m = clear[keys[i]];
          const cell = this.grid[m.c][m.r];
          if (!cell || cell.kind === PLAIN) {
            fired[keys[i]] = 1;
            continue;
          }
          fired[keys[i]] = 1;
          grew = true;
          if (cell.kind === LINE) {
            // Both axes: one rule, no hidden orientation for the player to
            // guess, and it matches the cross the texture advertises.
            for (let c = 0; c < COLS; c++) if (this.grid[c][m.r]) mark(c, m.r);
            for (let r = 0; r < ROWS; r++) if (this.grid[m.c][r]) mark(m.c, r);
            this.detonateFx(cell, m.c, m.r, LINE);
          } else {
            this.markColor(clear, mark, cell.color);
            this.detonateFx(cell, m.c, m.r, BURST);
          }
        }
        if (!grew) break;
      }
    }

    // Which cells get to become specials, and of what kind. Runs of 4+ only,
    // never gold, one special per cell even where two runs cross.
    planSpawns(runs, clear) {
      const spawns = [];
      const taken = {};
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (run.len < RUN_FOR_LINE || !canSpecial(run.color)) continue;
        const at = this.spawnCell(run);
        const k = at.c + "," + at.r;
        if (taken[k]) continue;
        taken[k] = 1;
        delete clear[k]; // it survives; it is the reward
        spawns.push({ c: at.c, r: at.r, color: run.color, kind: run.len >= RUN_FOR_BURST ? BURST : LINE });
      }
      return spawns;
    }

    // Prefer the cell the player just moved, so the special lands where they
    // aimed; otherwise the middle of the run.
    spawnCell(run) {
      const swap = this.lastSwap;
      if (swap) {
        for (let i = 0; i < run.cells.length; i++) {
          for (let j = 0; j < swap.length; j++) {
            if (run.cells[i].c === swap[j].c && run.cells[i].r === swap[j].r) return run.cells[i];
          }
        }
      }
      return run.cells[Math.floor(run.cells.length / 2)];
    }

    makeSpecial(spawn) {
      const cell = this.grid[spawn.c][spawn.r];
      if (!cell) return;
      cell.kind = spawn.kind;
      cell.color = spawn.color;
      cell.spr.setTexture(gemTex(cell.color, cell.kind));
      cell.spr.setScale(0.1);
      this.tweens.add({ targets: cell.spr, scale: 1, duration: 260, ease: "Back.easeOut" });
      const ring = this.add.circle(this.cellX(spawn.c), this.cellY(spawn.r), 16, 0xffffff, 0).setDepth(7);
      ring.setStrokeStyle(3, GEMS[spawn.color].hi, 0.95);
      this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 340, onComplete: () => ring.destroy() });
    }

    // A line gem throws a bar down its row and column; a burst throws a ring.
    detonateFx(cell, c, r, kind) {
      const x = this.cellX(c);
      const y = this.cellY(r);
      const tint = GEMS[cell.color].beam;
      if (kind === BURST) {
        const ring = this.add.circle(x, y, 18, tint, 0.6).setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
        return;
      }
      const bars = [
        this.add.rectangle(GX + (COLS * CELL) / 2, y, COLS * CELL, 12, tint, 0.85),
        this.add.rectangle(x, GY + (ROWS * CELL) / 2, 12, ROWS * CELL, tint, 0.85),
      ];
      bars.forEach((b) => {
        b.setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: b, alpha: 0, duration: 320, onComplete: () => b.destroy() });
      });
    }

    popGem(cell, c, r) {
      const x = this.cellX(c);
      const y = this.cellY(r);
      const ring = this.add.circle(x, y, 14, GEMS[cell.color].tile, 0.75).setDepth(6);
      this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 240, onComplete: () => ring.destroy() });
      this.tweens.add({
        targets: cell.spr,
        scale: 0,
        angle: 160,
        alpha: 0,
        duration: 170,
        ease: "Back.easeIn",
        onComplete: () => cell.spr.destroy(),
      });
    }

    // Drop survivors into the holes, then rain fresh gems in from above.
    applyGravity() {
      let maxMs = 180;
      for (let c = 0; c < COLS; c++) {
        let write = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          const cell = this.grid[c][r];
          if (!cell) continue;
          if (write !== r) {
            this.grid[c][write] = cell;
            this.grid[c][r] = null;
            const ms = Math.min(300, 90 + 34 * (write - r));
            maxMs = Math.max(maxMs, ms);
            this.tweens.add({ targets: cell.spr, y: this.cellY(write), duration: ms, ease: "Quad.easeIn" });
          }
          write--;
        }
        let n = 1;
        for (let r = write; r >= 0; r--) {
          const color = randomGem();
          const cell = this.makeGem(c, r, color, this.cellY(r) - n * CELL - 40);
          this.grid[c][r] = cell;
          const ms = Math.min(340, 130 + 34 * n);
          maxMs = Math.max(maxMs, ms);
          this.tweens.add({ targets: cell.spr, y: this.cellY(r), duration: ms, ease: "Quad.easeIn" });
          n++;
        }
      }
      return maxMs;
    }

    afterResolve() {
      if (!this.hasAnyMove()) {
        this.floatText(W / 2, GY + 40, "NO MOVES — RESHUFFLE", "#b6a8e6", 18);
        this.shuffleBoard();
      }
      this.queueBarks();
      this.drawMeters();
      if (this.queue.length) this.processQueue();
      else this.busy = false;
    }

    // Turn full meters into queued barks, remainder carried over. Only
    // QUEUE_CAP may be in flight at once so a single big move can't chain a
    // wall of beams; whatever is left stays charged and goes out as the queue
    // drains, so nothing under the meter cap is wasted.
    queueBarks() {
      for (let i = 0; i < METERS; i++) {
        while (this.meters[i] >= GEMS[i].need && this.queue.length < QUEUE_CAP) {
          this.meters[i] -= GEMS[i].need;
          this.queue.push(i);
        }
      }
    }

    processQueue() {
      if (this.state !== "fight" || !this.foe || this.foe.courage <= 0) {
        this.queue.length = 0;
        this.busy = false;
        return;
      }
      if (!this.queue.length) {
        // Room in the queue again — let anything still charged go out now
        // rather than making the player spend a move to release it.
        this.queueBarks();
        this.drawMeters();
      }
      if (!this.queue.length) {
        this.busy = false;
        return;
      }
      this.busy = true;
      this.fireBeam(this.queue.shift());
    }

    /* ================================================================== */
    /*  Barking: the beam                                                 */
    /* ================================================================== */

    fireBeam(colorIdx) {
      const def = GEMS[colorIdx];
      this.state = "attack";
      this.clearSelection();

      this.miles.setTexture("bq-miles-bark");
      this.tweens.add({ targets: this.miles, x: MILES_X + 8, duration: 110, yoyo: true, hold: 300 });

      const mx = MILES_X + 45;
      const my = MILES_Y - 13;
      const tx = this.foe.spr.x - 14;
      const ty = this.foe.spr.y - 6;
      const ang = Math.atan2(ty - my, tx - mx);
      const len = Math.hypot(tx - mx, ty - my) + 30;

      // Attack name, hurled across the board.
      this.bannerText.setText(def.label).setColor(def.css).setAlpha(1).setScale(0.5);
      this.tweens.add({ targets: this.bannerText, scale: 1, duration: 200, ease: "Back.easeOut" });
      this.tweens.add({ targets: this.bannerText, alpha: 0, delay: 420, duration: 220 });

      // Charge orb at the muzzle.
      const orb = this.add.circle(mx, my, 4, 0xffffff, 1).setDepth(45).setBlendMode(Phaser.BlendModes.ADD);
      const halo = this.add.circle(mx, my, 8, def.beam, 0.8).setDepth(44).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: [orb, halo], scale: 1.9, duration: 150, ease: "Quad.easeOut" });

      // Three concentric bark rings, the classic wind-up.
      for (let i = 0; i < 3; i++) {
        const ring = this.add.circle(mx, my, 12, def.beam, 0).setDepth(43);
        ring.setStrokeStyle(3, def.beam, 0.9);
        this.tweens.add({
          targets: ring,
          scale: 3.2,
          alpha: 0,
          duration: 340,
          delay: i * 70,
          onComplete: () => ring.destroy(),
        });
      }

      this.time.delayedCall(150, () => {
        if (this.state !== "attack") return;

        // The beam itself: a glow sheath, a coloured body and a white-hot core,
        // all additive, laid along the muzzle→foe axis.
        const beam = this.add.container(mx, my).setDepth(46).setRotation(ang);
        const glow = this.add.rectangle(0, 0, len, 52, def.beam, 0.22).setOrigin(0, 0.5);
        const body = this.add.rectangle(0, 0, len, 28, def.beam, 1).setOrigin(0, 0.5);
        const core = this.add.rectangle(0, 0, len, 7, 0xffffff, 0.95).setOrigin(0, 0.5);
        [glow, body, core].forEach((r) => r.setBlendMode(Phaser.BlendModes.ADD));
        beam.add([glow, body, core]);
        beam.setScale(0, 1);
        this.tweens.add({ targets: beam, scaleX: 1, duration: 90, ease: "Quad.easeOut" });
        // Crackle: the sheath breathes while the beam is held.
        this.tweens.add({ targets: glow, scaleY: 1.5, duration: 70, yoyo: true, repeat: 3 });
        this.tweens.add({ targets: body, scaleY: 0.7, duration: 55, yoyo: true, repeat: 5 });

        // Speed lines streaking along the beam.
        for (let i = 0; i < 7; i++) {
          const off = Phaser.Math.Between(-16, 16);
          const bolt = this.add.rectangle(0, off, 40, 3, 0xffffff, 0.9).setOrigin(0, 0.5);
          bolt.setBlendMode(Phaser.BlendModes.ADD);
          beam.add(bolt);
          this.tweens.add({
            targets: bolt,
            x: len,
            duration: 240,
            delay: i * 55,
            repeat: 1,
            onComplete: () => bolt.destroy(),
          });
        }

        // Impact.
        const burst = this.add.circle(tx, ty, 9, 0xffffff, 0.9).setDepth(47).setBlendMode(Phaser.BlendModes.ADD);
        const burstGlow = this.add.circle(tx, ty, 16, def.beam, 0.5).setDepth(46).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: [burst, burstGlow], scale: 1.7, duration: 130, yoyo: true, repeat: 2 });
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const shard = this.add.rectangle(tx, ty, 16, 3, def.beam, 1).setDepth(47).setRotation(a);
          shard.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({
            targets: shard,
            x: tx + Math.cos(a) * Phaser.Math.Between(40, 90),
            y: ty + Math.sin(a) * Phaser.Math.Between(40, 90),
            alpha: 0,
            duration: 420,
            onComplete: () => shard.destroy(),
          });
        }

        this.cameras.main.shake(320, 0.007);
        this.applyAttack(colorIdx);

        this.time.delayedCall(300, () => {
          this.tweens.add({
            targets: [beam, orb, halo, burst, burstGlow],
            alpha: 0,
            duration: 140,
            onComplete: () => {
              beam.destroy();
              orb.destroy();
              halo.destroy();
              burst.destroy();
              burstGlow.destroy();
            },
          });
          this.miles.setTexture("bq-miles");
          this.time.delayedCall(110, () => this.endAttack());
        });
      });
    }

    applyAttack(colorIdx) {
      const def = GEMS[colorIdx];
      const foe = this.foe;
      const dmg = Math.round(def.dmg * (1 + 0.05 * this.wave));
      foe.courage = Math.max(0, foe.courage - dmg);
      this.drawCourage();
      this.floatText(foe.spr.x, foe.spr.y - 6, "-" + dmg, def.css, 26, 34);

      // Knockback + flinch.
      this.tweens.add({ targets: foe.spr, x: foe.spr.x + 22, duration: 90, yoyo: true, ease: "Quad.easeOut" });
      this.tweens.add({ targets: foe.spr, alpha: 0.35, duration: 60, yoyo: true, repeat: 3 });

      // Per-colour flavour: green steadies Miles, blue shoves the foe's fuse
      // back, brown resets it outright, red is pure damage.
      if (colorIdx === 2) {
        const before = this.milesCourage;
        this.milesCourage = Math.min(MILES_COURAGE, this.milesCourage + GREEN_HEAL);
        if (this.milesCourage > before) {
          this.floatText(MILES_X - 20, MILES_Y - 26, "+" + (this.milesCourage - before), "#6ce87f", 22, 26);
        }
        this.drawCourage();
      } else if (colorIdx === 3) {
        foe.fuse = Math.max(0, foe.fuse - BLUE_STALL);
      } else if (colorIdx === 1) {
        foe.fuse = 0;
        this.floatText(foe.spr.x, foe.spr.y + 22, "STUNNED", "#ffd23f", 16, 24);
      }
      this.drawFuse();
    }

    endAttack() {
      if (this.foe && this.foe.courage <= 0) {
        this.queue.length = 0;
        this.foeFlees();
        return;
      }
      this.state = "fight";
      if (this.queue.length) this.processQueue();
      else this.busy = false;
    }

    /* ================================================================== */
    /*  Foes                                                              */
    /* ================================================================== */

    nextFoe() {
      this.wave++;
      // Every third challenger is a wolf; the rest are foxes.
      const kind = this.wave % 3 === 0 ? "wolf" : "fox";
      const base = FOES[kind];
      const step = this.wave - 1;

      const spr = this.add.image(W + 90, GROUND_Y - base.half, base.tex).setDepth(10);
      this.foe = {
        kind: kind,
        name: base.name,
        half: base.half,
        spr: spr,
        maxCourage: Math.round(base.courage * (1 + 0.16 * step)),
        fuse: 0,
        fuseMax: Math.max(3600, base.fuse - 220 * step),
        bark: base.bark + 1.2 * step,
      };
      this.foe.courage = this.foe.maxCourage;

      this.foeLabel.setText(base.name + "  #" + this.wave);
      this.drawCourage();
      this.drawFuse();

      this.state = "intro";
      this.busy = true;
      // Trot in from the right, with a little four-legged bounce.
      this.tweens.add({
        targets: spr,
        x: FOE_X,
        duration: 620,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: spr,
            y: spr.y - 4,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
          this.state = "fight";
          this.busy = false;
          this.processQueue();
        },
      });
    }

    foeBarks() {
      const foe = this.foe;
      foe.fuse = 0;
      this.state = "attack";
      this.busy = true;
      this.clearSelection();

      const shout = foe.kind === "wolf" ? "AWOOO!" : "YIP YIP!";
      this.floatText(foe.spr.x, foe.spr.y - 8, shout, "#ff9b8a", 20, 34);
      this.tweens.add({ targets: foe.spr, x: foe.spr.x - 26, duration: 130, yoyo: true, ease: "Quad.easeOut" });

      // Sound rings rolling towards Miles.
      for (let i = 0; i < 3; i++) {
        const ring = this.add.circle(foe.spr.x - foe.half, foe.spr.y - 6, 10, 0xffffff, 0);
        ring.setStrokeStyle(3, 0xff8a7a, 0.85).setDepth(43);
        this.tweens.add({
          targets: ring,
          x: MILES_X + 40,
          scale: 2.4,
          alpha: 0,
          duration: 420,
          delay: i * 110,
          onComplete: () => ring.destroy(),
        });
      }

      this.time.delayedCall(420, () => {
        const dmg = Math.round(foe.bark);
        this.milesCourage = Math.max(0, this.milesCourage - dmg);
        this.drawCourage();
        this.floatText(MILES_X - 20, MILES_Y - 26, "-" + dmg, "#ff6b5a", 24, 26);
        this.tweens.add({ targets: this.miles, alpha: 0.4, duration: 60, yoyo: true, repeat: 2 });
        this.cameras.main.shake(160, 0.004);

        this.time.delayedCall(320, () => {
          if (this.milesCourage <= 0) {
            this.dinnerTime();
            return;
          }
          this.state = "fight";
          if (this.queue.length) this.processQueue();
          else this.busy = false;
        });
      });
    }

    foeFlees() {
      const foe = this.foe;
      this.state = "flee";
      this.busy = true;
      this.routed++;
      this.routedText.setText("ROUTED " + this.routed);
      this.saveBest();
      this.fuseG.clear();

      this.floatText(foe.spr.x, foe.spr.y - 10, foe.name + " FLEES!", "#ffe7a3", 22, 34);
      this.tweens.killTweensOf(foe.spr);
      foe.spr.setFlipX(true);
      this.tweens.add({
        targets: foe.spr,
        x: W + 140,
        y: foe.spr.y - 10,
        angle: 12,
        alpha: 0.2,
        duration: 760,
        ease: "Quad.easeIn",
        onComplete: () => foe.spr.destroy(),
      });

      // Miles gets a moment to catch his breath before the next challenger.
      this.milesCourage = Math.min(MILES_COURAGE, this.milesCourage + MILES_RECOVER);
      this.drawCourage();

      this.time.delayedCall(900, () => {
        this.foe = null;
        this.nextFoe();
      });
    }

    /* ================================================================== */
    /*  Misc                                                              */
    /* ================================================================== */

    floatText(x, y, msg, color, size, rise) {
      const t = this.add.text(x, y, msg, font(size || 20, color || "#ffffff", 5)).setOrigin(0.5).setDepth(75);
      this.tweens.add({
        targets: t,
        y: y - (rise === undefined ? 42 : rise),
        alpha: 0,
        duration: 900,
        ease: "Quad.easeOut",
        onComplete: () => t.destroy(),
      });
    }

    update(time, delta) {
      if (this.state !== "fight" || !this.foe || this.foe.courage <= 0) return;
      this.foe.fuse += delta;
      if (this.foe.fuse >= this.foe.fuseMax) {
        this.drawFuse();
        this.foeBarks();
        return;
      }
      this.drawFuse();
    }

    // The run's end. Mechanically this is still "Miles' Courage hit zero", but
    // nobody dies in this game and nobody loses: his nerve goes, and right on
    // cue supper is called, so he gets a face-saving reason to trot home. The
    // outro plays first and the panel lands after it, or the dim would cover
    // the only part worth watching.
    dinnerTime() {
      this.state = "over";
      this.busy = true;
      this.clearSelection();
      this.saveBest();

      this.floatText(MILES_X, MILES_Y - 30, "DINNER!", "#ffe7a3", 24, 30);

      // Ears up, a delighted hop, then about-turn and off home at a trot.
      this.tweens.killTweensOf(this.miles);
      this.miles.setTexture("bq-miles-bark");
      this.tweens.add({
        targets: this.miles,
        y: MILES_Y - 16,
        duration: 200,
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.miles.setTexture("bq-miles").setFlipX(true);
          this.tweens.add({
            targets: this.miles,
            x: -80,
            duration: 620,
            ease: "Quad.easeIn",
          });
          this.tweens.add({
            targets: this.miles,
            y: MILES_Y - 8,
            duration: 155,
            yoyo: true,
            repeat: 3,
            ease: "Sine.easeOut",
          });
        },
      });

      this.time.delayedCall(900, () => this.dinnerPanel());
    }

    dinnerPanel() {
      this.add.rectangle(0, 0, W, H, 0x000000, 0.62).setOrigin(0, 0).setDepth(90);
      // Everything sits inside the board area, clear of the meter tubes and
      // the board frame, so the dim behind it is even.
      const bowl = this.add.image(W / 2, 252, "bq-bowl").setDepth(91).setScale(0.9);
      this.tweens.add({ targets: bowl, y: 244, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.add
        .text(W / 2, 316, "DINNER TIME!", font(32, "#ffd23f", 8))
        .setOrigin(0.5)
        .setDepth(91);
      this.add
        .text(W / 2, 356, "Miles' nerve runs out — and right then,\nthe back door opens and supper calls.", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#cfe0ff",
          align: "center",
          fontStyle: "italic",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(91);
      this.add
        .text(W / 2, 412, "Foes routed: " + this.routed + "\nBest: " + this.best, {
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
          color: "#ffe7a3",
          align: "center",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(91);

      this.makeButton(W / 2, 476, "▸ Back Out", 0x2f5a8a, () => this.scene.restart());
      this.makeButton(W / 2, 538, "≡ Menu", 0x4a4270, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }
  }

  function launchBarkQuest() {
    if (window.barkQuestGame) return window.barkQuestGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#0a0718",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BarkQuestScene],
    };
    const game = new Phaser.Game(config);
    window.barkQuestGame = game;
    return game;
  }

  window.launchBarkQuest = launchBarkQuest;
})();
