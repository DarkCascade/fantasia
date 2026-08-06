/*
 * Gloom Hollow — a small isometric action RPG in the Path of Exile mould.
 *
 * A square stone arena drawn on an isometric diamond grid. You are the exile.
 * Three ways to move: WASD or the arrow keys drive you directly in
 * screen-space directions (and swing at whatever you walk into, since a key
 * press has no way to pick a target) — hold two at once and they combine into
 * a diagonal, no slower than a straight line; the virtual stick in the
 * bottom-left does the same thing by touch; or tap/click the ground to walk
 * there — holding keeps you walking toward the finger or cursor — and tap a
 * monster to chase and auto-attack it. The frost nova goes off by tapping the
 * NOVA orb (or pressing Space / right-clicking) once its cooldown is up. Life
 * and nova orbs stack in the bottom-right, clear of the stick. Everything is
 * reachable by touch alone, with the keyboard there for desktop. Five
 * monsters roam the hollow — three quick grunts and two heavy brutes; they
 * aggro on sight, chase, and swing when they reach you. Slain monsters
 * sometimes leave a life flask you can walk over to heal. Clear the room to
 * win, hit 0 life and the hollow claims you.
 *
 * All art is generated at runtime from primitives, like the rest of Fantasia.
 * Created on demand via window.launchGloomHollow() so the menu stays first.
 */
(function () {
  "use strict";

  const W = 480;
  const H = 640;

  /* ---------- isometric grid ---------- */

  const GRID = 9; // GRID x GRID square level
  const TW = 48; // tile width on screen (full diamond)
  const TH = 24; // tile height on screen
  const WALL_H = 26; // how far a wall block rises above its tile
  const OX = W / 2; // screen x of grid corner (0, 0)
  const OY = 205; // screen y of grid corner (0, 0)

  // Blocked interior tiles (pillars). Keys are "i,j" tile indices.
  const PILLARS = [
    [2, 2],
    [6, 2],
    [2, 6],
    [6, 6],
  ];

  /* ---------- tuning ---------- */

  const BODY_R = 0.34; // collision radius, in tiles
  const MOVE_SLACK = 1.5; // how far off the floor a walk order may land, in tiles
  const SPREAD = 1.0; // how far apart monsters keep from each other, in tiles
  const PLAYER_SPREAD = 0.85; // ...and from the player, so nobody hides the exile

  const PLAYER_HP = 120;
  const PLAYER_SPEED = 3.4; // tiles / second
  const PLAYER_RANGE = 0.95;
  const PLAYER_CD = 500; // ms between swings
  const PLAYER_DMG = [9, 15];

  const NOVA_CD = 6000;
  const NOVA_RADIUS = 2.4;
  const NOVA_DMG = [18, 26];

  // Screen size of the blast. A circle of radius R in grid space projects to an
  // ellipse with semi-axes R*TW/sqrt(2) and R*TH/sqrt(2) — the widest points
  // are the diagonals (R/sqrt(2), -R/sqrt(2)) and (R/sqrt(2), R/sqrt(2)) — so
  // the drawn ring covers exactly the tiles the blast damages.
  const NOVA_RX = (NOVA_RADIUS * TW) / Math.SQRT2;
  const NOVA_RY = (NOVA_RADIUS * TH) / Math.SQRT2;
  const NOVA_FX_MS = 520;
  const NOVA_SHARDS = 12;
  const NOVA_FX_DEPTH = -10; // on the floor (tiles sit at -50), under every body

  const FLASK_CHANCE = 0.4;
  const FLASK_HEAL = 22;

  // range is a notch wider than pre-wind-up tuning: PLAYER_SPREAD (0.85) is
  // the distance separate() settles combat at, so a player who never reacts
  // to a tell needs to sit inside range at all — a too-tight range would let
  // "never move" escape hits it shouldn't. The wider range doesn't touch how
  // often a *standing* player gets hit (still always, once in range), it
  // only makes a *dodging* player cover more ground to clear it.
  const MONSTERS = {
    grunt: {
      key: "gh-grunt",
      name: "Grunt",
      hp: 30,
      speed: 2.0,
      range: 1.0,
      cd: 1200,
      dmg: [4, 7],
      aggro: 5.0,
      halfH: 26,
    },
    brute: {
      key: "gh-brute",
      name: "Brute",
      hp: 62,
      speed: 1.35,
      range: 1.15,
      cd: 1800,
      dmg: [8, 12],
      aggro: 5.5,
      halfH: 32,
    },
  };

  const SPAWNS = [
    ["grunt", 1.5, 1.5],
    ["grunt", 7.5, 1.5],
    ["grunt", 1.5, 7.5],
    ["brute", 7.5, 7.5],
    ["brute", 4.5, 1.5],
  ];

  // Monster blows are telegraphed rather than instant: a short wind-up with a
  // clear tell gives the player a real window to step out of range. The
  // attack cadence (nextAttack) still ticks from the moment the monster
  // *decides* to swing, not from when the wind-up finishes, so a monster that
  // keeps landing hits keeps exactly the rhythm it always had — the wind-up
  // doesn't slow monsters down, it only gives a reactive player something to
  // dodge.
  const MONSTER_WINDUP_MS = 350;
  const MONSTER_WINDUP_SCALE = 1.16; // how much a winding-up monster visibly swells
  const SWING_LUNGE_PX = 9; // forward lunge distance swing() uses for every attack, player or monster
  const MONSTER_PULLBACK_PX = 5; // screen-px pull-back during the wind-up (smaller than SWING_LUNGE_PX's forward lunge)
  const MONSTER_TELL_COLOR = 0xff5a3c; // warning red — still lands if you're here when it resolves
  const MONSTER_TELL_SAFE_COLOR = 0x6fe08a; // green once you've stepped outside its range
  const KNOCKBACK_DIST = 0.4; // tiles the player is shoved back on a landed hit

  function isoX(gx, gy) {
    return OX + (gx - gy) * (TW / 2);
  }

  function isoY(gx, gy) {
    return OY + (gx + gy) * (TH / 2);
  }

  // Screen point -> grid coordinates (inverse of the projection above).
  function screenToGrid(px, py) {
    return screenDirToGrid(px - OX, py - OY);
  }

  // Screen-space direction -> grid-space direction: the same inverse
  // projection, minus the origin, since a direction has nothing to
  // translate. This is what turns "up on the screen" into whatever grid
  // heading that actually is on an isometric board — shared by the virtual
  // stick and the keyboard, the two controls that drive the player straight
  // from a screen-space vector instead of a clicked point.
  function screenDirToGrid(dx, dy) {
    return {
      gx: (dx / (TW / 2) + dy / (TH / 2)) / 2,
      gy: (dy / (TH / 2) - dx / (TW / 2)) / 2,
    };
  }

  // World objects are depth-sorted by their projected screen y (roughly
  // 150-450), so the HUD lives in a band comfortably above all of it.
  const UI_DEPTH = 1000;

  // The two orbs stack in the bottom-right corner — life above nova — leaving
  // the bottom-left free for the stick. The nova orb doubles as the skill
  // button on touch, where there's no Space bar or right mouse button.
  const ORB_R = 34;
  const ORB_TAP_R = 46; // forgiving touch radius around the nova orb
  const NOVA_ORB_X = W - 62;
  const NOVA_ORB_Y = H - 62;
  const LIFE_ORB_X = W - 62;
  const LIFE_ORB_Y = H - 140;

  // Virtual stick, anchored bottom-left for a left thumb.
  const JOY_X = 78;
  const JOY_Y = H - 78;
  const JOY_BASE_R = 52; // ring the knob travels inside
  const JOY_KNOB_R = 22;
  const JOY_THROW_R = 34; // how far the knob's centre travels = full deflection
  const JOY_GRAB_R = 76; // press this close to the centre and the stick takes it
  const JOY_DEAD = 0.25; // fraction of the throw treated as centred (~8px)

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  class HollowScene extends Phaser.Scene {
    constructor() {
      super("HollowScene");
    }

    create() {
      this.over = false;
      this.kills = 0;
      this.blocked = Object.create(null);
      PILLARS.forEach((p) => {
        this.blocked[p[0] + "," + p[1]] = true;
      });

      this.buildTextures();
      this.buildLevel();
      this.buildPlayer();
      this.spawnMonsters();
      this.flasks = [];
      this.buildUI();
      this.bindInput();
    }

    /* ---------- textures ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Backdrop: a dark vignette-ish gradient.
      if (!this.textures.exists("gh-bg")) {
        const top = Phaser.Display.Color.ValueToColor(0x181428);
        const bot = Phaser.Display.Color.ValueToColor(0x07060f);
        const strips = 40;
        const sh = Math.ceil(H / strips);
        for (let i = 0; i < strips; i++) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
          g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
          g.fillRect(0, i * sh, W, sh + 1);
        }
        g.generateTexture("gh-bg", W, H);
      }

      // Two floor tiles (checker) drawn as diamonds.
      const tile = (key, fill, edge) => {
        if (this.textures.exists(key)) return;
        g.clear();
        g.fillStyle(fill, 1);
        g.fillPoints(
          [
            { x: TW / 2, y: 0 },
            { x: TW, y: TH / 2 },
            { x: TW / 2, y: TH },
            { x: 0, y: TH / 2 },
          ],
          true
        );
        g.lineStyle(1, edge, 1);
        g.strokePoints(
          [
            { x: TW / 2, y: 0 },
            { x: TW, y: TH / 2 },
            { x: TW / 2, y: TH },
            { x: 0, y: TH / 2 },
          ],
          true,
          true
        );
        g.generateTexture(key, TW, TH);
      };
      tile("gh-tile-a", 0x3b3a56, 0x2a2940);
      tile("gh-tile-b", 0x343352, 0x2a2940);

      // Wall / pillar block: a diamond top with two shaded side faces.
      if (!this.textures.exists("gh-wall")) {
        const wh = WALL_H;
        g.clear();
        // left face
        g.fillStyle(0x2d2c46, 1);
        g.fillPoints(
          [
            { x: 0, y: TH / 2 },
            { x: TW / 2, y: TH },
            { x: TW / 2, y: TH + wh },
            { x: 0, y: TH / 2 + wh },
          ],
          true
        );
        // right face
        g.fillStyle(0x201f36, 1);
        g.fillPoints(
          [
            { x: TW, y: TH / 2 },
            { x: TW / 2, y: TH },
            { x: TW / 2, y: TH + wh },
            { x: TW, y: TH / 2 + wh },
          ],
          true
        );
        // top
        g.fillStyle(0x4a4869, 1);
        g.fillPoints(
          [
            { x: TW / 2, y: 0 },
            { x: TW, y: TH / 2 },
            { x: TW / 2, y: TH },
            { x: 0, y: TH / 2 },
          ],
          true
        );
        g.generateTexture("gh-wall", TW, TH + wh);
      }

      // Player: a hooded exile in a blue cloak with a glowing blade.
      if (!this.textures.exists("gh-player")) {
        g.clear();
        // shadow
        g.fillStyle(0x000000, 0.28);
        g.fillEllipse(21, 54, 26, 12);
        // cloak
        g.fillStyle(0x2f5fa8, 1);
        g.fillPoints(
          [
            { x: 21, y: 16 },
            { x: 33, y: 34 },
            { x: 30, y: 52 },
            { x: 12, y: 52 },
            { x: 9, y: 34 },
          ],
          true
        );
        g.fillStyle(0x4b83d6, 1);
        g.fillPoints(
          [
            { x: 21, y: 18 },
            { x: 27, y: 34 },
            { x: 21, y: 50 },
            { x: 15, y: 34 },
          ],
          true
        );
        // hood + face
        g.fillStyle(0x27508c, 1);
        g.fillCircle(21, 15, 10);
        g.fillStyle(0x120f1e, 1);
        g.fillCircle(21, 17, 6.5);
        g.fillStyle(0x9fd8ff, 1);
        g.fillCircle(18.5, 17, 1.7);
        g.fillCircle(23.5, 17, 1.7);
        // blade
        g.fillStyle(0xbfe6ff, 1);
        g.fillRect(35, 14, 3, 30);
        g.fillStyle(0x6f7c8c, 1);
        g.fillRect(32, 42, 9, 4);
        g.generateTexture("gh-player", 44, 58);
      }

      // Grunt: a lean bone-pale monster with red eyes.
      if (!this.textures.exists("gh-grunt")) {
        g.clear();
        g.fillStyle(0x000000, 0.28);
        g.fillEllipse(19, 46, 24, 11);
        g.fillStyle(0x8f9b7e, 1);
        g.fillRoundedRect(8, 16, 22, 28, 8);
        g.fillStyle(0xa9b596, 1);
        g.fillRoundedRect(11, 19, 8, 20, 4);
        // head
        g.fillStyle(0xc3ceae, 1);
        g.fillCircle(19, 12, 9);
        g.lineStyle(1.5, 0x3d4432, 1);
        g.strokeCircle(19, 12, 9);
        // ears
        g.fillStyle(0xa9b596, 1);
        g.fillTriangle(11, 11, 3, 4, 14, 7);
        g.fillTriangle(27, 11, 35, 4, 24, 7);
        // eyes
        g.fillStyle(0xff4a3d, 1);
        g.fillCircle(15.5, 12, 2.1);
        g.fillCircle(22.5, 12, 2.1);
        // claws
        g.fillStyle(0xdfe6d2, 1);
        g.fillTriangle(6, 30, 1, 40, 9, 36);
        g.fillTriangle(32, 30, 37, 40, 29, 36);
        g.generateTexture("gh-grunt", 38, 50);
      }

      // Brute: a bulky horned demon.
      if (!this.textures.exists("gh-brute")) {
        g.clear();
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(25, 58, 34, 14);
        g.fillStyle(0x8c3327, 1);
        g.fillRoundedRect(8, 20, 34, 36, 11);
        g.fillStyle(0xa8493a, 1);
        g.fillRoundedRect(12, 24, 12, 26, 6);
        g.lineStyle(2, 0x4a1a13, 1);
        g.strokeRoundedRect(8, 20, 34, 36, 11);
        // head
        g.fillStyle(0x9c3b2d, 1);
        g.fillCircle(25, 14, 11);
        g.lineStyle(2, 0x4a1a13, 1);
        g.strokeCircle(25, 14, 11);
        // horns
        g.fillStyle(0xe8dcc0, 1);
        g.fillTriangle(16, 8, 8, -2, 21, 3);
        g.fillTriangle(34, 8, 42, -2, 29, 3);
        // eyes + maw
        g.fillStyle(0xffd23f, 1);
        g.fillCircle(20.5, 14, 2.6);
        g.fillCircle(29.5, 14, 2.6);
        g.fillStyle(0x2a0d09, 1);
        g.fillRect(19, 20, 12, 4);
        g.fillStyle(0xe8dcc0, 1);
        g.fillTriangle(20, 20, 23, 20, 21.5, 24);
        g.fillTriangle(27, 20, 30, 20, 28.5, 24);
        g.generateTexture("gh-brute", 50, 62);
      }

      // Life flask pickup.
      if (!this.textures.exists("gh-flask")) {
        g.clear();
        g.fillStyle(0x8fd0e8, 0.9);
        g.fillRoundedRect(6, 6, 12, 18, 4);
        g.fillStyle(0xe2394c, 1);
        g.fillRoundedRect(7, 12, 10, 11, 3);
        g.fillStyle(0xd8c48a, 1);
        g.fillRect(8, 1, 8, 6);
        g.generateTexture("gh-flask", 24, 26);
      }

      g.destroy();
    }

    /* ---------- level ---------- */

    isBlocked(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return true;
      return !!this.blocked[Math.floor(gx) + "," + Math.floor(gy)];
    }

    // A body of radius r can stand here only if none of its corners overlap
    // a wall or leave the arena.
    canStand(gx, gy, r) {
      return (
        !this.isBlocked(gx - r, gy - r) &&
        !this.isBlocked(gx + r, gy - r) &&
        !this.isBlocked(gx - r, gy + r) &&
        !this.isBlocked(gx + r, gy + r)
      );
    }

    buildLevel() {
      this.add.image(0, 0, "gh-bg").setOrigin(0, 0).setDepth(-100);

      // Floor.
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          if (this.blocked[i + "," + j]) continue;
          const key = (i + j) % 2 === 0 ? "gh-tile-a" : "gh-tile-b";
          this.add
            .image(isoX(i + 0.5, j + 0.5), isoY(i + 0.5, j + 0.5), key)
            .setOrigin(0.5, 0.5)
            .setDepth(-50);
        }
      }

      // Perimeter wall ring plus the interior pillars. Depth follows screen y
      // so characters walking in front of a block overlap it correctly.
      const walls = [];
      for (let i = -1; i <= GRID; i++) {
        walls.push([i, -1], [i, GRID], [-1, i], [GRID, i]);
      }
      PILLARS.forEach((p) => walls.push(p));
      // The block texture is TW x (TH + WALL_H) with its diamond top occupying
      // the first TH rows, so the tile's centre sits at TH/2 down the image.
      const originY = TH / 2 / (TH + WALL_H);
      walls.forEach((p) => {
        const cx = p[0] + 0.5;
        const cy = p[1] + 0.5;
        this.add
          .image(isoX(cx, cy), isoY(cx, cy), "gh-wall")
          .setOrigin(0.5, originY)
          .setDepth(isoY(cx, cy));
      });
    }

    /* ---------- entities ---------- */

    place(entity) {
      const y = isoY(entity.gx, entity.gy);
      entity.sprite.setPosition(isoX(entity.gx, entity.gy) + entity.lunge.x, y + entity.lunge.y);
      // The bias keeps the player on top of a monster standing at the same
      // screen row, so the exile is never swallowed by the pack.
      entity.sprite.setDepth(y + (entity.depthBias || 0));
      if (entity.bar) this.drawBar(entity);
    }

    buildPlayer() {
      const spr = this.add.image(0, 0, "gh-player").setOrigin(0.5, 0.9);
      this.player = {
        sprite: spr,
        gx: 4.5,
        gy: 4.5,
        hp: PLAYER_HP,
        maxHp: PLAYER_HP,
        speed: PLAYER_SPEED,
        range: PLAYER_RANGE,
        cd: PLAYER_CD,
        nextAttack: 0,
        dmg: PLAYER_DMG,
        moveTo: null,
        target: null,
        halfH: 40,
        lunge: { x: 0, y: 0 },
        depthBias: 1,
      };
      this.place(this.player);
      this.novaReadyAt = 0;

      // Ring drawn on the ground under whatever the player is attacking.
      this.targetRing = this.add
        .ellipse(0, 0, TW * 0.8, TH * 0.8, 0x000000, 0)
        .setStrokeStyle(2, 0xffd23f, 0.9)
        .setVisible(false);
    }

    spawnMonsters() {
      this.monsters = [];
      SPAWNS.forEach((s) => {
        const def = MONSTERS[s[0]];
        const spr = this.add.image(0, 0, def.key).setOrigin(0.5, 0.9);
        const m = {
          def: def,
          sprite: spr,
          gx: s[1],
          gy: s[2],
          hp: def.hp,
          maxHp: def.hp,
          speed: def.speed,
          range: def.range,
          cd: def.cd,
          nextAttack: 0,
          dmg: def.dmg,
          alive: true,
          halfH: def.halfH,
          lunge: { x: 0, y: 0 },
          windingUp: false,
          windupEndsAt: 0,
        };
        m.bar = this.add.graphics();
        m.telegraphGfx = this.add.graphics();
        this.place(m);
        this.monsters.push(m);
      });
    }

    drawBar(m) {
      const g = m.bar;
      g.clear();
      if (!m.alive) return;
      const w = 34;
      const h = 5;
      const x = m.sprite.x - w / 2;
      const y = m.sprite.y - m.halfH - 10;
      g.setDepth(m.sprite.depth + 1);
      g.fillStyle(0x000000, 0.6);
      g.fillRect(x - 1, y - 1, w + 2, h + 2);
      const ratio = Phaser.Math.Clamp(m.hp / m.maxHp, 0, 1);
      g.fillStyle(0x5a1a1a, 1);
      g.fillRect(x, y, w, h);
      g.fillStyle(ratio > 0.4 ? 0xd4453f : 0xf0a020, 1);
      g.fillRect(x, y, w * ratio, h);
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.joy = { active: false, pointerId: -1, dx: 0, dy: 0, kx: JOY_X, ky: JOY_Y };
      this.directUsed = false;

      this.add
        .text(W / 2, 26, "GLOOM HOLLOW", {
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          color: "#ffffff",
          stroke: "#241c3a",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH);

      this.hintText = this.add
        .text(W / 2, 58, "WASD/arrows or stick to walk • tap floor to move, a monster to attack\nTap the NOVA orb (or press Space) to blast", {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          lineSpacing: 2,
          color: "#b9c4e8",
          stroke: "#000000",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH);

      this.killText = this.add
        .text(W - 14, 86, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#ffe7a3",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(1, 0.5)
        .setDepth(UI_DEPTH);

      // PoE-style orbs: life on the left, skill charge on the right.
      this.lifeOrb = this.add.graphics().setDepth(UI_DEPTH);
      this.novaOrb = this.add.graphics().setDepth(UI_DEPTH);
      this.lifeText = this.add
        .text(LIFE_ORB_X, LIFE_ORB_Y, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH + 1);
      this.novaText = this.add
        .text(NOVA_ORB_X, NOVA_ORB_Y, "NOVA", {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH + 1);
      this.drawOrbs();

      // The nova orb is the cast button on touch. An invisible circle over it
      // takes the tap, sized generously so a fingertip doesn't have to be
      // precise. Space and right-click still work for mouse and keyboard.
      this.novaButton = this.add
        .circle(NOVA_ORB_X, NOVA_ORB_Y, ORB_TAP_R, 0x000000, 0)
        .setDepth(UI_DEPTH + 2)
        .setInteractive({ useHandCursor: true });
      this.novaButton.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.castNova();
      });

      this.joyGfx = this.add.graphics().setDepth(UI_DEPTH);
      this.drawJoystick();

      this.makeButton(42, 26, "≡", 0x3a3358, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }, 18);
    }

    /* ---------- virtual stick ---------- */

    drawJoystick() {
      const j = this.joy;
      const g = this.joyGfx;
      g.clear();
      g.fillStyle(0x0d1020, j.active ? 0.6 : 0.4);
      g.fillCircle(JOY_X, JOY_Y, JOY_BASE_R);
      g.lineStyle(3, j.active ? 0xffd23f : 0x4a5570, 0.9);
      g.strokeCircle(JOY_X, JOY_Y, JOY_BASE_R);
      g.fillStyle(0x2f5fa8, j.active ? 1 : 0.75);
      g.fillCircle(j.kx, j.ky, JOY_KNOB_R);
      g.lineStyle(2, 0x9fd8ff, 0.9);
      g.strokeCircle(j.kx, j.ky, JOY_KNOB_R);
    }

    // Move the knob to a touch point, clamped inside the base ring, and store
    // the throw as a -1..1 screen-space vector.
    updateJoystick(px, py) {
      const j = this.joy;
      let dx = px - JOY_X;
      let dy = py - JOY_Y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_THROW_R) {
        dx = (dx / len) * JOY_THROW_R;
        dy = (dy / len) * JOY_THROW_R;
      }
      j.kx = JOY_X + dx;
      j.ky = JOY_Y + dy;
      j.dx = dx / JOY_THROW_R;
      j.dy = dy / JOY_THROW_R;
      this.drawJoystick();
    }

    releaseJoystick() {
      const j = this.joy;
      j.active = false;
      j.pointerId = -1;
      j.dx = 0;
      j.dy = 0;
      j.kx = JOY_X;
      j.ky = JOY_Y;
      this.drawJoystick();
    }

    // True when a screen point lands on the HUD orbs or the stick, so a drag
    // across them never doubles as a walk order.
    overHud(px, py) {
      return (
        dist(px, py, NOVA_ORB_X, NOVA_ORB_Y) <= ORB_TAP_R ||
        dist(px, py, LIFE_ORB_X, LIFE_ORB_Y) <= ORB_R + 6 ||
        dist(px, py, JOY_X, JOY_Y) <= JOY_GRAB_R
      );
    }

    // Fill a circular "globe" bottom-up by stacking chords of the circle.
    fillOrb(g, cx, cy, r, ratio, color) {
      const top = cy + r - 2 * r * Phaser.Math.Clamp(ratio, 0, 1);
      g.fillStyle(color, 1);
      for (let y = Math.ceil(top); y <= cy + r; y += 2) {
        const dy = y - cy;
        const half = Math.sqrt(Math.max(0, r * r - dy * dy));
        g.fillRect(cx - half, y, half * 2, 2);
      }
    }

    drawOrbs() {
      const r = ORB_R;
      const lg = this.lifeOrb;
      lg.clear();
      lg.fillStyle(0x1a0d0d, 1);
      lg.fillCircle(LIFE_ORB_X, LIFE_ORB_Y, r);
      this.fillOrb(lg, LIFE_ORB_X, LIFE_ORB_Y, r, this.player.hp / this.player.maxHp, 0xc42f36);
      lg.lineStyle(3, 0x6b5a2f, 1);
      lg.strokeCircle(LIFE_ORB_X, LIFE_ORB_Y, r);
      this.lifeText.setText(Math.max(0, Math.round(this.player.hp)) + "/" + this.player.maxHp);

      const charge = this.novaCharge();
      const ng = this.novaOrb;
      ng.clear();
      ng.fillStyle(0x0d1420, 1);
      ng.fillCircle(NOVA_ORB_X, NOVA_ORB_Y, r);
      this.fillOrb(ng, NOVA_ORB_X, NOVA_ORB_Y, r, charge, 0x2f7fc4);
      // A ready nova gets a gold rim; while charging it stays muted.
      ng.lineStyle(3, charge >= 1 ? 0xffd23f : 0x4a5570, 1);
      ng.strokeCircle(NOVA_ORB_X, NOVA_ORB_Y, r);
      this.novaText.setText(charge >= 1 ? "NOVA" : Math.ceil(((this.novaReadyAt - this.time.now) / 1000) * 10) / 10 + "s");

      this.killText.setText("Slain " + this.kills + " / " + this.monsters.length);
    }

    novaCharge() {
      const left = this.novaReadyAt - this.time.now;
      if (left <= 0) return 1;
      return 1 - left / NOVA_CD;
    }

    makeButton(x, y, label, color, onClick, size) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: (size || 22) + "px",
          color: "#ffffff",
          backgroundColor: "#" + color.toString(16).padStart(6, "0"),
          padding: { x: 14, y: 7 },
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH + 10)
        .setInteractive({ useHandCursor: true });
      // Grow the hit area past the text box so the buttons clear a fingertip
      // once the canvas is scaled down on a phone.
      try {
        const pad = 12;
        t.input.hitArea.setTo(-pad, -pad, t.width + pad * 2, t.height + pad * 2);
      } catch (e) {
        /* no hit area to widen — the default box still works */
      }
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    /* ---------- input ---------- */

    bindInput() {
      try {
        this.input.mouse.disableContextMenu();
      } catch (e) {
        /* headless / touch — nothing to disable */
      }

      this.holdMove = false;
      this.holdPointerId = -1;

      // Two extra touch pointers, so the stick and the nova orb can be worked
      // by two thumbs at once — Phaser tracks only one touch by default.
      this.input.addPointer(2);

      this.input.on("pointerdown", (pointer, currentlyOver) => {
        if (this.over) return;

        // The stick claims presses near its base before anything else.
        if (!this.joy.active && dist(pointer.x, pointer.y, JOY_X, JOY_Y) <= JOY_GRAB_R) {
          this.joy.active = true;
          this.joy.pointerId = pointer.id;
          this.directUsed = true;
          this.player.target = null;
          this.player.moveTo = null;
          this.holdMove = false;
          this.updateJoystick(pointer.x, pointer.y);
          return;
        }

        // A tap the HUD already claimed (nova orb, menu button) is not a
        // walk order.
        if (currentlyOver && currentlyOver.length) return;
        if (this.overHud(pointer.x, pointer.y)) return;

        if (pointer.rightButtonDown && pointer.rightButtonDown()) {
          this.castNova();
          return;
        }

        // Tapping a living monster targets it; otherwise walk there, and keep
        // walking toward the finger for as long as it stays down.
        const hit = this.monsterAtScreen(pointer.x, pointer.y);
        if (hit) {
          this.player.target = hit;
          this.player.moveTo = null;
          this.holdMove = false;
          return;
        }
        if (this.setMoveTarget(pointer.x, pointer.y)) {
          this.holdMove = true;
          this.holdPointerId = pointer.id;
        }
      });

      this.input.on("pointermove", (pointer) => {
        if (this.joy.active && pointer.id === this.joy.pointerId) {
          this.updateJoystick(pointer.x, pointer.y);
        }
      });

      // Only the finger that started a gesture ends it — releasing the nova
      // thumb must not drop the stick, or vice versa.
      const endGesture = (pointer) => {
        if (this.joy.active && pointer.id === this.joy.pointerId) this.releaseJoystick();
        if (this.holdMove && pointer.id === this.holdPointerId) {
          this.holdMove = false;
          this.holdPointerId = -1;
        }
      };
      this.input.on("pointerup", endGesture);
      this.input.on("pointerupoutside", endGesture);

      this.input.keyboard.on("keydown-SPACE", () => this.castNova());

      // WASD and the arrow keys are read as held state every frame (see
      // keysHeading()), not as discrete key events — movement needs to know
      // what's down right now, the same way the stick reads a live position
      // rather than a one-off gesture.
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    }

    // Screen-space direction implied by whichever movement keys are held
    // right now, WASD and the arrow keys both working and freely mixable.
    // Returns null with nothing held, so update() can fall through to
    // click-to-move. Two keys on the same axis (e.g. A and D) cancel out
    // rather than fight — a real hand can hold both by accident.
    keysHeading() {
      const up = this.wasd.W.isDown || this.cursors.up.isDown;
      const down = this.wasd.S.isDown || this.cursors.down.isDown;
      const left = this.wasd.A.isDown || this.cursors.left.isDown;
      const right = this.wasd.D.isDown || this.cursors.right.isDown;
      const dx = (right ? 1 : 0) - (left ? 1 : 0);
      const dy = (down ? 1 : 0) - (up ? 1 : 0);
      if (dx === 0 && dy === 0) return null;
      return { dx: dx, dy: dy };
    }

    // Order a walk to a screen point. Returns false if that point isn't
    // somewhere the player could stand. A point just off the floor is pulled
    // back onto it — that keeps dragging along the rim working — but a tap out
    // in the backdrop is ignored rather than clamped all the way to a corner.
    setMoveTarget(px, py) {
      const g = screenToGrid(px, py);
      if (
        g.gx < -MOVE_SLACK ||
        g.gy < -MOVE_SLACK ||
        g.gx > GRID + MOVE_SLACK ||
        g.gy > GRID + MOVE_SLACK
      ) {
        return false;
      }
      const gx = Phaser.Math.Clamp(g.gx, BODY_R, GRID - BODY_R);
      const gy = Phaser.Math.Clamp(g.gy, BODY_R, GRID - BODY_R);
      if (!this.canStand(gx, gy, BODY_R)) return false;
      this.player.target = null;
      this.player.moveTo = { gx: gx, gy: gy };
      return true;
    }

    monsterAtScreen(px, py) {
      let best = null;
      let bestD = 30;
      this.monsters.forEach((m) => {
        if (!m.alive) return;
        const d = dist(px, py - m.halfH * 0.5, m.sprite.x, m.sprite.y - m.halfH * 0.5);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      });
      return best;
    }

    /* ---------- nova shockwave ---------- */

    // The blast is drawn as a stack of ground layers redrawn each frame from a
    // single 0..1 progress value: a bloom of light under the exile, the
    // shockwave ring itself (thick and white-hot at the start, a thin cyan
    // thread by the end), a slower ring chasing it, and frost shards thrown
    // out along the floor.
    spawnNovaFx(cx, cy) {
      const g = this.add.graphics().setDepth(NOVA_FX_DEPTH);
      // Fixed shard angles per cast, so the burst doesn't crawl as it expands.
      const shards = [];
      for (let i = 0; i < NOVA_SHARDS; i++) {
        shards.push(((i + Math.random() * 0.6) / NOVA_SHARDS) * Math.PI * 2);
      }
      const fx = { t: 0 };
      this.tweens.add({
        targets: fx,
        t: 1,
        duration: NOVA_FX_MS,
        ease: "Linear", // the shaping is done per-curve in drawNovaFx
        onUpdate: () => this.drawNovaFx(g, cx, cy, fx.t, shards),
        onComplete: () => g.destroy(),
      });
    }

    drawNovaFx(g, cx, cy, t, shards) {
      g.clear();
      // Radius and opacity ride separate curves: the wave springs out fast and
      // is near full size early, while the light holds and only drops away at
      // the end. Easing the tween itself would tie them together and blink the
      // whole thing out in the first fifth of its life.
      const grow = 1 - Math.pow(1 - t, 3);
      const fade = 1 - Math.pow(t, 2.2);
      const rx = NOVA_RX * grow;
      const ry = NOVA_RY * grow;

      // Bloom of light on the floor, gone well before the ring is.
      const bloom = Math.max(0, 1 - t * 2.4);
      if (bloom > 0) {
        g.fillStyle(0x8fd8ff, 0.34 * bloom);
        g.fillEllipse(cx, cy, rx * 2, ry * 2);
      }

      // Trailing ring, lagging a fifth of the way behind the leading edge.
      const lagT = Math.max(0, (t - 0.2) / 0.8);
      if (lagT > 0) {
        const lag = 1 - Math.pow(1 - lagT, 3);
        g.lineStyle(4 * (1 - lag) + 1.5, 0x4aa8e0, (1 - Math.pow(lagT, 2)) * 0.6);
        g.strokeEllipse(cx, cy, NOVA_RX * lag * 2, NOVA_RY * lag * 2);
      }

      // Leading shockwave: fat at the start, a thread by the end.
      const wide = 14 * (1 - grow) + 3;
      g.lineStyle(wide, 0x9fe8ff, Math.min(1, fade * 1.4));
      g.strokeEllipse(cx, cy, rx * 2, ry * 2);
      // White-hot inner lip, just inside the wave.
      g.lineStyle(Math.max(1.5, wide * 0.4), 0xffffff, fade * 0.9);
      g.strokeEllipse(cx, cy, Math.max(0, rx * 2 - wide), Math.max(0, ry * 2 - wide * 0.5));

      // Frost shards flung out ahead of the wave.
      g.lineStyle(2.5, 0xdff4ff, fade);
      const len = 13 * (1 - grow) + 5;
      shards.forEach((a) => {
        const px = cx + Math.cos(a) * rx * 1.06;
        const py = cy + Math.sin(a) * ry * 1.06;
        const dx = px - cx;
        const dy = py - cy;
        const l = Math.hypot(dx, dy) || 1;
        g.lineBetween(px, py, px + (dx / l) * len, py + (dy / l) * len);
      });
    }

    /* ---------- combat ---------- */

    castNova() {
      if (this.over || this.time.now < this.novaReadyAt) return;
      this.novaReadyAt = this.time.now + NOVA_CD;

      this.spawnNovaFx(isoX(this.player.gx, this.player.gy), isoY(this.player.gx, this.player.gy));
      this.cameras.main.shake(140, 0.008);

      this.monsters.forEach((m) => {
        if (!m.alive) return;
        if (dist(m.gx, m.gy, this.player.gx, this.player.gy) <= NOVA_RADIUS) {
          this.hurtMonster(m, Phaser.Math.Between(NOVA_DMG[0], NOVA_DMG[1]), "#8fd8ff");
        }
      });
      this.drawOrbs();
    }

    playerAttack(m) {
      this.player.nextAttack = this.time.now + this.player.cd;
      this.swing(this.player, m);
      this.hurtMonster(m, Phaser.Math.Between(PLAYER_DMG[0], PLAYER_DMG[1]), "#ffe7a3");
    }

    // A monster commits to a swing: it locks in place (see update()'s early
    // return for winding-up monsters — constraint is it can't also be closing
    // distance while it winds up) and telegraphs for MONSTER_WINDUP_MS before
    // landMonsterAttack() decides whether the blow actually connects. Guarded
    // like castNova() — a wind-up started after the fight is already over
    // would never get resolved, since update() (the only thing that calls
    // landMonsterAttack) bails out the moment `over` is true.
    monsterAttack(m) {
      if (this.over) return;
      m.windingUp = true;
      m.windupEndsAt = this.time.now + MONSTER_WINDUP_MS;
      m.nextAttack = this.time.now + m.cd;

      // Pull back away from the target and swell up — a tell big enough to
      // read from across the room, against the dark floor.
      this.tweens.killTweensOf(m.lunge);
      m.lunge.x = 0;
      m.lunge.y = 0;
      const dx = isoX(this.player.gx, this.player.gy) - isoX(m.gx, m.gy);
      const dy = isoY(this.player.gx, this.player.gy) - isoY(m.gx, m.gy);
      const len = Math.hypot(dx, dy) || 1;
      this.tweens.add({
        targets: m.lunge,
        x: (-dx / len) * MONSTER_PULLBACK_PX,
        y: (-dy / len) * MONSTER_PULLBACK_PX,
        duration: MONSTER_WINDUP_MS,
        ease: "Sine.easeOut",
      });
      this.tweens.killTweensOf(m.sprite);
      this.tweens.add({
        targets: m.sprite,
        scale: MONSTER_WINDUP_SCALE,
        duration: MONSTER_WINDUP_MS,
        ease: "Sine.easeOut",
      });
    }

    // Ground tell for a wind-up in progress: a ring at the monster's actual
    // reach (same circle-to-ellipse projection the nova ring uses, just
    // per-monster radius) plus a beam toward the player that flips from
    // warning-red to safe-green the instant they step outside it. Redrawn
    // every frame so the beam — and the hit/miss read it gives — tracks the
    // player's live position even though the monster itself holds still.
    // The typical fight distance (PLAYER_SPREAD) sits close to the ring, so
    // there's a dark outline under the colored stroke — otherwise the ring
    // gets lost right where it matters most: under the overlapping sprites
    // at melee range.
    drawTelegraph(m) {
      const g = m.telegraphGfx;
      g.clear();
      const started = m.windupEndsAt - MONSTER_WINDUP_MS;
      const t = Phaser.Math.Clamp((this.time.now - started) / MONSTER_WINDUP_MS, 0, 1);
      const mx = isoX(m.gx, m.gy);
      const my = isoY(m.gx, m.gy);
      const rx = (m.range * TW) / Math.SQRT2;
      const ry = (m.range * TH) / Math.SQRT2;
      const inRange = dist(m.gx, m.gy, this.player.gx, this.player.gy) <= m.range;
      const color = inRange ? MONSTER_TELL_COLOR : MONSTER_TELL_SAFE_COLOR;

      g.setDepth(my - 2);
      g.lineStyle(4.5 + t * 3, 0x000000, 0.3 + t * 0.3);
      g.strokeEllipse(mx, my, rx * 2, ry * 2);
      g.lineStyle(2.5 + t * 3, color, 0.55 + t * 0.45);
      g.strokeEllipse(mx, my, rx * 2, ry * 2);
      g.lineStyle(3 + t * 2, color, 0.55 + t * 0.45);
      g.lineBetween(mx, my, isoX(this.player.gx, this.player.gy), isoY(this.player.gx, this.player.gy));
    }

    // The wind-up is over. The blow only lands if the player is still inside
    // range at this exact moment — otherwise it's a clean whiff, no damage.
    // The monster follows through on the swing motion either way; only the
    // outcome differs.
    landMonsterAttack(m) {
      m.windingUp = false;
      m.telegraphGfx.clear();
      this.tweens.killTweensOf(m.sprite);
      this.tweens.add({ targets: m.sprite, scale: 1, duration: 90 });
      this.swing(m, this.player);

      if (dist(m.gx, m.gy, this.player.gx, this.player.gy) > m.range) {
        this.popNumber(this.player.sprite.x, this.player.sprite.y - this.player.halfH, "MISS", "#9fb4d8");
        return;
      }

      const dmg = Phaser.Math.Between(m.dmg[0], m.dmg[1]);
      this.player.hp = Math.max(0, this.player.hp - dmg);
      this.popNumber(this.player.sprite.x, this.player.sprite.y - this.player.halfH, dmg, "#ff6b6b");
      this.flash(this.player.sprite);
      this.knockback(this.player, m);
      this.cameras.main.shake(90, 0.006);
      this.drawOrbs();
      if (this.player.hp <= 0) this.endGame(false);
    }

    // Shove `entity` a short distance straight away from `attacker` on a
    // landed hit. Clamped through canStand exactly like pushApart — if the
    // shove would land in a wall or pillar, it's dropped rather than clamped
    // into the obstacle.
    knockback(entity, attacker) {
      const dx = entity.gx - attacker.gx;
      const dy = entity.gy - attacker.gy;
      const len = Math.hypot(dx, dy);
      let ux, uy;
      if (len > 0.0001) {
        ux = dx / len;
        uy = dy / len;
      } else {
        // (Near-)coincident with the attacker — no attacker-to-victim line
        // to push along. Fall back to shoving away from the arena centre
        // (and if even that's degenerate, an arbitrary fixed direction)
        // rather than silently pushing nobody.
        const cx = entity.gx - GRID / 2;
        const cy = entity.gy - GRID / 2;
        const clen = Math.hypot(cx, cy);
        ux = clen > 0.0001 ? cx / clen : 1;
        uy = clen > 0.0001 ? cy / clen : 0;
      }
      const nx = Phaser.Math.Clamp(entity.gx + ux * KNOCKBACK_DIST, BODY_R, GRID - BODY_R);
      const ny = Phaser.Math.Clamp(entity.gy + uy * KNOCKBACK_DIST, BODY_R, GRID - BODY_R);
      if (this.canStand(nx, ny, BODY_R)) {
        entity.gx = nx;
        entity.gy = ny;
      }
    }

    // A short lunge toward the victim, standing in for a swing animation. The
    // offset lives on the entity (not the sprite) so per-frame re-projection in
    // place() and the tween never fight over the sprite's position.
    swing(attacker, victim) {
      const dx = isoX(victim.gx, victim.gy) - isoX(attacker.gx, attacker.gy);
      const dy = isoY(victim.gx, victim.gy) - isoY(attacker.gx, attacker.gy);
      const len = Math.hypot(dx, dy) || 1;
      this.tweens.killTweensOf(attacker.lunge);
      attacker.lunge.x = 0;
      attacker.lunge.y = 0;
      this.tweens.add({
        targets: attacker.lunge,
        x: (dx / len) * SWING_LUNGE_PX,
        y: (dy / len) * SWING_LUNGE_PX,
        duration: 90,
        yoyo: true,
      });
    }

    hurtMonster(m, dmg, color) {
      m.hp -= dmg;
      this.popNumber(m.sprite.x, m.sprite.y - m.halfH, dmg, color);
      this.flash(m.sprite);
      if (m.hp <= 0) {
        m.hp = 0;
        this.killMonster(m);
      }
      this.drawBar(m);
    }

    // Drop a monster's wind-up (tell, swell, pull-back) without resolving it
    // — for a monster that dies before its blow lands, or one left hanging
    // when the fight itself ends. Both need identical cleanup, or the tell
    // or the swelled scale outlives whatever stopped the swing.
    cancelWindup(m) {
      m.windingUp = false;
      m.telegraphGfx.clear();
      this.tweens.killTweensOf(m.sprite);
      this.tweens.killTweensOf(m.lunge);
      m.sprite.setScale(1);
      m.lunge.x = 0;
      m.lunge.y = 0;
    }

    killMonster(m) {
      m.alive = false;
      m.bar.clear();
      // A monster can die mid-wind-up (nova, or the player finishing it off
      // first) — drop the tell and the swell so neither outlives the corpse.
      this.cancelWindup(m);
      this.kills++;
      if (this.player.target === m) this.player.target = null;
      this.tweens.add({
        targets: m.sprite,
        alpha: 0,
        angle: 80,
        y: m.sprite.y + 6,
        duration: 320,
      });
      if (Math.random() < FLASK_CHANCE) this.dropFlask(m.gx, m.gy);
      this.drawOrbs();
      if (this.monsters.every((e) => !e.alive)) {
        this.time.delayedCall(500, () => this.endGame(true));
      }
    }

    dropFlask(gx, gy) {
      const spr = this.add
        .image(isoX(gx, gy), isoY(gx, gy) - 6, "gh-flask")
        .setOrigin(0.5, 1)
        .setDepth(isoY(gx, gy) - 1);
      this.tweens.add({ targets: spr, y: spr.y - 4, duration: 700, yoyo: true, repeat: -1 });
      this.flasks.push({ sprite: spr, gx: gx, gy: gy });
    }

    popNumber(x, y, value, color) {
      const t = this.add
        .text(x, y, "" + value, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: color,
          stroke: "#000000",
          strokeThickness: 4,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH - 100);
      this.tweens.add({
        targets: t,
        y: y - 26,
        alpha: 0,
        duration: 620,
        onComplete: () => t.destroy(),
      });
    }

    flash(sprite) {
      this.tweens.add({ targets: sprite, alpha: 0.35, duration: 60, yoyo: true });
    }

    /* ---------- movement ---------- */

    // Step toward (tx, ty). If the straight line is blocked, fan out to wider
    // headings until one is walkable — a cheap stand-in for pathfinding that is
    // enough to round the pillars instead of grinding against a corner. The
    // side that worked is remembered so the entity commits to one way around
    // rather than jittering between them.
    // Returns true when the destination is reached (or is unreachable).
    stepToward(entity, tx, ty, dt) {
      const dx = tx - entity.gx;
      const dy = ty - entity.gy;
      const d = Math.hypot(dx, dy);
      if (d < 0.02) return true;

      const step = Math.min(entity.speed * dt, d);
      const base = Math.atan2(dy, dx);
      const side = entity.detour || 1;
      const offsets = [0];
      [0.5, 1.05, 1.6, 2.2].forEach((a) => offsets.push(a * side, -a * side));

      let moved = false;
      for (let i = 0; i < offsets.length; i++) {
        const ang = base + offsets[i];
        const nx = entity.gx + Math.cos(ang) * step;
        const ny = entity.gy + Math.sin(ang) * step;
        if (!this.canStand(nx, ny, BODY_R)) continue;
        entity.gx = nx;
        entity.gy = ny;
        if (offsets[i] !== 0) entity.detour = offsets[i] > 0 ? 1 : -1;
        moved = true;
        break;
      }

      // Face the way we're heading (screen-space left/right).
      const facing = dx - dy;
      if (Math.abs(facing) > 0.001) entity.sprite.setFlipX(facing < 0);
      return !moved || d - step < 0.02;
    }

    // Keep bodies from stacking into a single unreadable sprite: monsters push
    // each other apart, and they never crowd inside the player's sprite (they
    // still stop well within their attack range, so this doesn't stall them).
    separate() {
      const living = this.monsters.filter((m) => m.alive);
      for (let i = 0; i < living.length; i++) {
        for (let j = i + 1; j < living.length; j++) {
          this.pushApart(living[i], living[j], SPREAD, 0.5);
        }
      }
      living.forEach((m) => this.pushApart(this.player, m, PLAYER_SPREAD, 0));
    }

    // Separate a and b to `min` tiles apart. `aShare` is how much of the
    // correction a takes (0 = b moves the whole way). A winding-up entity
    // holds its exact spot — it committed to the swing, and being shoved
    // could push a monster out of its own range for a whiff the player
    // didn't earn — but the *guarantee* (nobody ends up closer than `min`)
    // must still hold, so its share is handed to the other side rather than
    // just dropped: e.g. the player keeps their PLAYER_SPREAD clearance from
    // a frozen monster by moving themself, since the monster can't. If both
    // sides are winding up, neither moves — a rare, purely cosmetic
    // monster-monster overlap, not a guarantee this function makes to begin
    // with (only the player-facing spacing matters for readability).
    pushApart(a, b, min, aShare) {
      const dx = b.gx - a.gx;
      const dy = b.gy - a.gy;
      const d = Math.hypot(dx, dy);
      if (d < 0.0001 || d >= min) return;
      const gap = min - d;
      const ux = dx / d;
      const uy = dy / d;

      let shareA = a.windingUp ? 0 : aShare;
      let shareB = b.windingUp ? 0 : 1 - aShare;
      if (a.windingUp && !b.windingUp) shareB = 1;
      if (b.windingUp && !a.windingUp) shareA = 1;

      if (shareA > 0) {
        const ax = a.gx - ux * gap * shareA;
        const ay = a.gy - uy * gap * shareA;
        if (this.canStand(ax, ay, BODY_R)) {
          a.gx = ax;
          a.gy = ay;
        }
      }
      if (shareB > 0) {
        const bx = b.gx + ux * gap * shareB;
        const by = b.gy + uy * gap * shareB;
        if (this.canStand(bx, by, BODY_R)) {
          b.gx = bx;
          b.gy = by;
        }
      }
    }

    // Walk the player along a screen-space direction (dx, dy) at up to
    // `scale` (0..1) of full speed — shared by the stick (an analog throw,
    // scale tracking how far it's pushed) and the keyboard (all-or-nothing,
    // always scale 1). The direction goes through screenDirToGrid since a
    // screen-space vector isn't a grid axis on an isometric board; aiming far
    // past the player lets stepToward just walk the heading, keeping its
    // wall-collision and detour handling.
    driveHeading(p, dt, dx, dy, scale) {
      const g = screenDirToGrid(dx, dy);
      const len = Math.hypot(g.gx, g.gy);
      if (len < 0.0001) return;
      this.stepToward(p, p.gx + (g.gx / len) * 10, p.gy + (g.gy / len) * 10, dt * scale);
    }

    // Push the player along the stick's heading. A short throw walks slower
    // than a full one.
    driveWithStick(p, dt, throwLen) {
      const scale = Math.min(1, (throwLen - JOY_DEAD) / (1 - JOY_DEAD));
      this.driveHeading(p, dt, this.joy.dx, this.joy.dy, scale);
    }

    // Swing at the closest monster already within reach.
    autoAttack(time) {
      const p = this.player;
      if (time < p.nextAttack) return;
      let best = null;
      let bestD = p.range;
      this.monsters.forEach((m) => {
        if (!m.alive) return;
        const d = dist(m.gx, m.gy, p.gx, p.gy);
        if (d <= bestD) {
          bestD = d;
          best = m;
        }
      });
      if (best) this.playerAttack(best);
    }

    update(time, delta) {
      if (this.over) return;
      const dt = Math.min(delta, 50) / 1000;
      const p = this.player;

      // Hold to keep walking toward the pointer — the main way to move on a
      // touchscreen, where repeated taps are awkward.
      if (this.holdMove) {
        const ptr = this.input.manager.pointers[this.holdPointerId] || this.input.activePointer;
        if (!ptr.isDown) {
          this.holdMove = false;
          this.holdPointerId = -1;
        } else if (!this.overHud(ptr.x, ptr.y)) {
          this.setMoveTarget(ptr.x, ptr.y);
        }
      }

      // The stick outranks any walk order while it's pushed; the keyboard
      // does the same whenever a movement key is down, deferring to the
      // stick if — implausibly — both are active at once, since a real hand
      // only drives one of them at a time.
      const throwLen = this.joy.active ? Math.hypot(this.joy.dx, this.joy.dy) : 0;
      const onStick = throwLen > JOY_DEAD;
      const keysDir = onStick ? null : this.keysHeading();
      const onKeys = !!keysDir;
      if (onStick) {
        p.target = null;
        p.moveTo = null;
        this.driveWithStick(p, dt, throwLen);
      } else if (onKeys) {
        p.target = null;
        p.moveTo = null;
        this.directUsed = true;
        this.driveHeading(p, dt, keysDir.dx, keysDir.dy, 1);
      }

      // Player: chase-and-attack a target, or walk to the clicked point.
      if (p.target && !p.target.alive) p.target = null;
      if (onStick || onKeys) {
        // Swing at whatever we've walked into — direct-drive input has no
        // way to pick a target the way a click can.
        this.autoAttack(time);
      } else if (p.target) {
        const d = dist(p.gx, p.gy, p.target.gx, p.target.gy);
        if (d > p.range) {
          this.stepToward(p, p.target.gx, p.target.gy, dt);
        } else if (time >= p.nextAttack) {
          this.playerAttack(p.target);
        }
      } else if (this.directUsed) {
        // Standing still after driving directly (stick or keyboard) still
        // fights back.
        this.autoAttack(time);
      }
      if (!onStick && !onKeys && !p.target && p.moveTo) {
        if (this.stepToward(p, p.moveTo.gx, p.moveTo.gy, dt)) p.moveTo = null;
      }

      // Monsters: aggro, chase, swing.
      this.monsters.forEach((m) => {
        // A monster earlier in this same pass can land the killing blow and
        // call endGame() mid-forEach — re-check here (update()'s own
        // this.over guard only ran once, at the top of the frame) so a later
        // monster can't start a fresh wind-up that no future frame will ever
        // resolve (nothing runs update()'s monster loop again once over).
        if (this.over || !m.alive) return;
        if (m.windingUp) {
          // Committed to the swing — it holds its ground instead of closing
          // distance (constraint 4), so the tell is the only thing moving.
          this.drawTelegraph(m);
          if (time >= m.windupEndsAt) this.landMonsterAttack(m);
          return;
        }
        const d = dist(m.gx, m.gy, p.gx, p.gy);
        if (d > m.def.aggro) return;
        if (d > m.range) {
          this.stepToward(m, p.gx, p.gy, dt);
        } else if (time >= m.nextAttack) {
          this.monsterAttack(m);
        }
      });
      this.separate();

      // Flask pickups.
      for (let i = this.flasks.length - 1; i >= 0; i--) {
        const f = this.flasks[i];
        if (dist(f.gx, f.gy, p.gx, p.gy) < 0.55) {
          p.hp = Math.min(p.maxHp, p.hp + FLASK_HEAL);
          this.popNumber(f.sprite.x, f.sprite.y - 10, "+" + FLASK_HEAL, "#7dd87d");
          f.sprite.destroy();
          this.flasks.splice(i, 1);
          this.drawOrbs();
        }
      }

      // Re-project everything and re-sort by screen depth.
      this.place(p);
      this.monsters.forEach((m) => {
        if (m.alive) this.place(m);
      });

      if (p.target) {
        const ty = isoY(p.target.gx, p.target.gy);
        this.targetRing.setVisible(true).setPosition(isoX(p.target.gx, p.target.gy), ty).setDepth(ty - 1);
      } else {
        this.targetRing.setVisible(false);
      }
      this.drawOrbs();
    }

    /* ---------- end ---------- */

    endGame(won) {
      if (this.over) return;
      this.over = true;
      this.player.target = null;
      this.player.moveTo = null;
      // update() bails out the instant `over` is true (its very first line),
      // so a monster that was mid-wind-up — typically another monster's blow
      // landing the killing hit while this one had already committed to its
      // own swing — would otherwise be stuck: frozen scale, frozen pull-back,
      // a telegraph ring stuck on its last frame, forever, with no tween left
      // running to ever clear it. killMonster() only cleans up *its own*
      // monster on death; this is the other half, for whichever monsters are
      // still alive and winding up when the fight itself ends.
      this.monsters.forEach((m) => {
        if (m.windingUp) this.cancelWindup(m);
      });

      this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0, 0).setDepth(UI_DEPTH + 20);
      this.add
        .text(W / 2, H * 0.3, won ? "HOLLOW CLEARED" : "YOU DIED", {
          fontFamily: "Arial, sans-serif",
          fontSize: won ? "36px" : "44px",
          color: won ? "#ffd23f" : "#d43b3b",
          stroke: "#000000",
          strokeThickness: 8,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH + 21);
      this.add
        .text(W / 2, H * 0.3 + 44, "Monsters slain: " + this.kills, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#e6ecff",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(UI_DEPTH + 21);

      // Above the dimming overlay, so the end-screen buttons stay crisp.
      this.makeButton(W / 2, H * 0.5, "▸ Enter Again", 0x2f5a8a, () => this.scene.restart()).setDepth(UI_DEPTH + 22);
      this.makeButton(W / 2, H * 0.5 + 58, "≡ Menu", 0x3a3358, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }).setDepth(UI_DEPTH + 22);
    }
  }

  function launchGloomHollow() {
    if (window.gloomGame) return window.gloomGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#07060f",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [HollowScene],
    };
    const game = new Phaser.Game(config);
    window.gloomGame = game;
    return game;
  }

  window.launchGloomHollow = launchGloomHollow;
})();
