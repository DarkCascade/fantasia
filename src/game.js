/*
 * Flappy Bird — a Phaser 3 clone.
 *
 * Every visual asset in this game is generated at runtime from colored
 * primitives (Phaser Graphics -> generateTexture). There are no external
 * image files, so the whole thing is self-contained.
 *
 * Features:
 *   - Tap / click / spacebar / on-screen button to flap.
 *   - A dedicated JUMP button pinned to the bottom for phone play.
 *   - Live score and a high score persisted to localStorage.
 */

const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;

// Where the ground sits (top edge of the ground strip).
const GROUND_HEIGHT = 96;
const FLOOR_Y = GAME_HEIGHT - GROUND_HEIGHT;

// Gameplay tuning.
const FLAP_VELOCITY = -320;
const GRAVITY = 1000;
const PIPE_SPEED = 160;
const PIPE_GAP = 165; // vertical opening the bird flies through
const PIPE_SPACING = 220; // horizontal distance between pipe pairs
const PIPE_WIDTH = 64;

const HIGH_SCORE_KEY = "flappy-bird-highscore";

// Pipe colour variants. The game cycles through these column by column, so
// consecutive pipes alternate — every other pipe comes out purple.
const PIPE_PALETTES = [
  {
    key: "green",
    base: 0x5aa02c,
    highlight: 0x74c945,
    shadow: 0x3f7a1e,
    stroke: 0x2f5f16,
  },
  {
    key: "purple",
    base: 0x8a2ca0,
    highlight: 0xb45fd0,
    shadow: 0x5e1c74,
    stroke: 0x3d1050,
  },
];

// A rarer red pipe that shows up at random, on top of the green/purple
// alternation. RED_PIPE_CHANCE is the odds any given column comes out red.
const RED_PIPE_PALETTE = {
  key: "red",
  base: 0xd0342c,
  highlight: 0xef5b52,
  shadow: 0x991f1a,
  stroke: 0x6d1410,
};
const RED_PIPE_CHANCE = 0.3; // ~3 in 10 columns
const RED_PIPE_POINTS = 2; // red columns are worth double

// Every pipe column the bird passes permanently speeds the whole world up by
// this fraction — so the game gets relentlessly faster the further you get.
const SPEED_INCREASE_PER_PIPE = 0.01; // +1% per pipe passed

// Little background houses. Three colour variants are baked as textures; the
// background layer cycles through them at random as houses scroll past.
const HOUSE_KEYS = ["house-1", "house-2", "house-3"];
const HOUSE_PALETTES = [
  // Red roof, cream walls.
  { wall: 0xf2e4c9, wallDark: 0xd8c6a2, roof: 0xc0392b, roofDark: 0x7d2419, door: 0x8a5a2b, window: 0x9fd3e0 },
  // Blue roof, tan walls.
  { wall: 0xe9dcc0, wallDark: 0xccbd98, roof: 0x2c6fa0, roofDark: 0x1c4a6e, door: 0x6b4423, window: 0xfff2b0 },
  // Teal roof, warm-white walls.
  { wall: 0xf5ead6, wallDark: 0xdccdb0, roof: 0x3f8f7a, roofDark: 0x276152, door: 0x7a4a2b, window: 0xbfe3ea },
];

/* ------------------------------------------------------------------ */
/*  Boot scene: build all textures from primitives, then start play.   */
/* ------------------------------------------------------------------ */

class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create() {
    generateTextures(this);
    this.scene.start("GameScene");
  }
}

/**
 * Draw every sprite the game needs into cached textures.
 * Called once at boot.
 */
function generateTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  // --- Sky background (vertical gradient) ---
  // Graphics.fillGradientStyle doesn't rasterize reliably into a generated
  // texture, so paint the gradient as a stack of interpolated strips instead.
  g.clear();
  const skyTop = Phaser.Display.Color.ValueToColor(0x4ec0ca);
  const skyBot = Phaser.Display.Color.ValueToColor(0xdff6f2);
  const strips = 60;
  const stripH = Math.ceil(GAME_HEIGHT / strips);
  for (let i = 0; i < strips; i++) {
    const t = i / (strips - 1);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(skyTop, skyBot, 100, t * 100);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    g.fillRect(0, i * stripH, GAME_WIDTH, stripH + 1);
  }
  g.generateTexture("sky", GAME_WIDTH, GAME_HEIGHT);

  // --- Cloud (soft white blob) ---
  g.clear();
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(26, 26, 22);
  g.fillCircle(54, 30, 26);
  g.fillCircle(84, 26, 20);
  g.fillRoundedRect(20, 30, 70, 22, 11);
  g.generateTexture("cloud", 110, 56);

  // --- Ground strip (tileable) ---
  const gw = 32;
  g.clear();
  // dirt base
  g.fillStyle(0xded895, 1);
  g.fillRect(0, 0, gw, GROUND_HEIGHT);
  // grass top band
  g.fillStyle(0x73c53f, 1);
  g.fillRect(0, 0, gw, 16);
  g.fillStyle(0x5aa82f, 1);
  g.fillRect(0, 14, gw, 4);
  // little grass tufts
  g.fillStyle(0x8fd94f, 1);
  g.fillTriangle(4, 16, 8, 6, 12, 16);
  g.fillTriangle(20, 16, 24, 8, 28, 16);
  // dirt speckles
  g.fillStyle(0xcdc06f, 1);
  g.fillRect(6, 40, 5, 5);
  g.fillRect(22, 62, 5, 5);
  g.fillRect(12, 80, 5, 5);
  g.generateTexture("ground", gw, GROUND_HEIGHT);

  // --- Pipe body + cap textures, in each colour variant. ---
  // The game alternates pipe colours column by column, so we bake a texture
  // set (body + cap) for every palette in PIPE_PALETTES.
  for (const palette of PIPE_PALETTES) {
    buildPipeTextures(g, palette);
  }
  // The random red variant needs its texture set baked too.
  buildPipeTextures(g, RED_PIPE_PALETTE);

  // --- Little background houses (one texture per colour variant) ---
  HOUSE_PALETTES.forEach((palette, i) => buildHouse(g, HOUSE_KEYS[i], palette));

  // --- Bird (three frames for a flap animation) ---
  buildBird(g, "bird-up", -8);
  buildBird(g, "bird-mid", 0);
  buildBird(g, "bird-down", 8);

  // --- Round button base for the on-screen JUMP control ---
  const btnR = 44;
  g.clear();
  g.fillStyle(0x000000, 0.18);
  g.fillCircle(btnR + 3, btnR + 5, btnR);
  g.fillStyle(0xffce3d, 1);
  g.fillCircle(btnR + 3, btnR + 3, btnR);
  g.fillStyle(0xffe08a, 1);
  g.fillCircle(btnR + 3, btnR - 6, btnR - 14);
  g.lineStyle(4, 0xe8a71c, 1);
  g.strokeCircle(btnR + 3, btnR + 3, btnR);
  g.generateTexture("jump-btn", (btnR + 3) * 2, (btnR + 5) * 2);

  g.destroy();
}

/**
 * Bake the body + cap textures for a single pipe colour palette.
 * Produces keys like "pipe-body-green" / "pipe-cap-purple".
 */
function buildPipeTextures(g, palette) {
  // --- Pipe body (tileable vertically). ---
  const pipeBodyH = 32;
  g.clear();
  g.fillStyle(palette.base, 1); // base colour
  g.fillRect(0, 0, PIPE_WIDTH, pipeBodyH);
  g.fillStyle(palette.highlight, 1); // left highlight
  g.fillRect(4, 0, 10, pipeBodyH);
  g.fillStyle(palette.shadow, 1); // right shadow
  g.fillRect(PIPE_WIDTH - 12, 0, 12, pipeBodyH);
  g.lineStyle(2, palette.stroke, 1);
  g.strokeRect(1, 0, PIPE_WIDTH - 2, pipeBodyH);
  g.generateTexture("pipe-body-" + palette.key, PIPE_WIDTH, pipeBodyH);

  // --- Pipe cap (the lip at the mouth of each pipe). ---
  const capW = PIPE_WIDTH + 10;
  const capH = 26;
  g.clear();
  g.fillStyle(palette.base, 1);
  g.fillRoundedRect(0, 0, capW, capH, 6);
  g.fillStyle(palette.highlight, 1);
  g.fillRoundedRect(5, 3, 12, capH - 6, 4);
  g.fillStyle(palette.shadow, 1);
  g.fillRect(capW - 14, 3, 10, capH - 6);
  g.lineStyle(2, palette.stroke, 1);
  g.strokeRoundedRect(1, 1, capW - 2, capH - 2, 6);
  g.generateTexture("pipe-cap-" + palette.key, capW, capH);
}

/**
 * Bake one little house texture (walls + gabled roof + door + windows) for a
 * single colour palette. Drawn with its base at the bottom edge so it can be
 * placed origin-bottom, resting on the ground line.
 */
function buildHouse(g, key, c) {
  const W = 84;
  const roofH = 30; // triangular roof height
  const wallH = 50; // wall block height
  const H = roofH + wallH;
  const eave = 6; // wall inset so the roof overhangs the walls

  g.clear();

  // Walls.
  g.fillStyle(c.wall, 1);
  g.fillRect(eave, roofH, W - eave * 2, wallH);
  // Right-side shading.
  g.fillStyle(c.wallDark, 1);
  g.fillRect(W - eave - 12, roofH, 12, wallH);
  g.lineStyle(2, c.roofDark, 1);
  g.strokeRect(eave, roofH, W - eave * 2, wallH);

  // Gabled roof (overhangs the walls on both sides).
  g.fillStyle(c.roof, 1);
  g.fillTriangle(0, roofH, W / 2, 0, W, roofH);
  g.lineStyle(2, c.roofDark, 1);
  g.strokeTriangle(0, roofH, W / 2, 0, W, roofH);
  // Eave shadow line under the roof.
  g.fillStyle(c.roofDark, 1);
  g.fillRect(eave, roofH - 3, W - eave * 2, 3);

  // Door, centered on the bottom edge.
  const doorW = 16;
  const doorH = 26;
  g.fillStyle(c.door, 1);
  g.fillRect(W / 2 - doorW / 2, H - doorH, doorW, doorH);
  g.lineStyle(1.5, c.roofDark, 1);
  g.strokeRect(W / 2 - doorW / 2, H - doorH, doorW, doorH);
  g.fillStyle(0xffe08a, 1);
  g.fillCircle(W / 2 + 4, H - doorH / 2, 1.8); // doorknob

  // A window in each upper corner, with a little cross frame.
  const win = 13;
  const winY = roofH + 12;
  const winL = eave + 8;
  const winR = W - eave - 8 - win;
  [winL, winR].forEach((wx) => {
    g.fillStyle(c.window, 1);
    g.fillRect(wx, winY, win, win);
    g.lineStyle(1.5, c.roofDark, 1);
    g.strokeRect(wx, winY, win, win);
    g.lineBetween(wx + win / 2, winY, wx + win / 2, winY + win);
    g.lineBetween(wx, winY + win / 2, wx + win, winY + win / 2);
  });

  g.generateTexture(key, W, H);
}

/**
 * Draw one bird frame. `wingY` shifts the wing to fake a flap.
 */
function buildBird(g, key, wingY) {
  const w = 44;
  const h = 34;
  g.clear();

  // body
  g.fillStyle(0xf7d51d, 1);
  g.fillEllipse(w / 2, h / 2, w - 6, h - 6);
  // belly highlight
  g.fillStyle(0xfce96a, 1);
  g.fillEllipse(w / 2 - 2, h / 2 + 4, w - 18, h - 16);
  // outline
  g.lineStyle(2, 0xd9a300, 1);
  g.strokeEllipse(w / 2, h / 2, w - 6, h - 6);

  // wing
  g.fillStyle(0xffffff, 1);
  g.fillEllipse(w / 2 - 6, h / 2 + 3 + wingY, 16, 10);
  g.lineStyle(2, 0xd9a300, 1);
  g.strokeEllipse(w / 2 - 6, h / 2 + 3 + wingY, 16, 10);

  // eye
  g.fillStyle(0xffffff, 1);
  g.fillCircle(w - 12, 12, 7);
  g.fillStyle(0x000000, 1);
  g.fillCircle(w - 10, 12, 3);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(w - 11, 11, 1.2);

  // beak
  g.fillStyle(0xff9b28, 1);
  g.fillTriangle(w - 4, 9, w + 6, 15, w - 4, 21);
  g.lineStyle(1.5, 0xe07a12, 1);
  g.strokeTriangle(w - 4, 9, w + 6, 15, w - 4, 21);

  g.generateTexture(key, w + 8, h);
}

/* ------------------------------------------------------------------ */
/*  Main game scene.                                                   */
/* ------------------------------------------------------------------ */

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  create() {
    this.gameState = "ready"; // 'ready' | 'playing' | 'dead'
    this.score = 0;
    this.highScore = this.loadHighScore();

    this.buildBackground();
    this.buildHouses();
    this.buildBird();
    this.buildPipes();
    this.buildGround();
    this.buildUI();
    this.buildJumpButton();
    this.bindInput();

    this.showReady();
  }

  /* -------- world construction -------- */

  buildBackground() {
    this.add.image(0, 0, "sky").setOrigin(0, 0).setDepth(-20);

    // A few parallax clouds drifting left.
    this.clouds = [];
    for (let i = 0; i < 4; i++) {
      const c = this.add
        .image(
          Phaser.Math.Between(0, GAME_WIDTH),
          Phaser.Math.Between(40, 220),
          "cloud"
        )
        .setDepth(-15)
        .setAlpha(0.85)
        .setScale(Phaser.Math.FloatBetween(0.6, 1.1));
      c.driftSpeed = Phaser.Math.FloatBetween(8, 22);
      this.clouds.push(c);
    }
  }

  buildHouses() {
    // Three little houses on a background layer at the bottom of the play
    // area. They sit behind the pipes (depth < pipe depth) so the bird flies
    // past them, and scroll left at PIPE_SPEED while playing — the same speed
    // the world moves under the bird — so it reads as flying past them.
    // Each is a random variant at a random size/gap, and recycles off the
    // left edge as a fresh random house, so houses keep appearing at random.
    this.houses = [];
    let x = Phaser.Math.Between(30, 120);
    for (let i = 0; i < 3; i++) {
      const h = this.add
        .image(x, FLOOR_Y + 1, Phaser.Utils.Array.GetRandom(HOUSE_KEYS))
        .setOrigin(0.5, 1)
        .setDepth(-8)
        .setScale(Phaser.Math.FloatBetween(0.8, 1.1));
      this.houses.push(h);
      x += Phaser.Math.Between(150, 250);
    }
  }

  buildBird() {
    this.bird = this.physics.add.sprite(GAME_WIDTH * 0.28, GAME_HEIGHT * 0.42, "bird-mid");
    this.bird.setDepth(10);
    this.bird.body.setAllowGravity(false);
    this.bird.setCollideWorldBounds(false);
    // A slightly forgiving circular hitbox.
    this.bird.body.setCircle(14, 6, 3);

    this.anims.create({
      key: "flap",
      frames: [{ key: "bird-up" }, { key: "bird-mid" }, { key: "bird-down" }],
      frameRate: 12,
      repeat: -1,
    });
    this.bird.play("flap");

    // Gentle idle bob while waiting to start.
    this.idleTween = this.tweens.add({
      targets: this.bird,
      y: this.bird.y - 12,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  buildPipes() {
    this.pipes = this.physics.add.group({ allowGravity: false, immovable: true });
    this.pipeColumns = []; // track scoring per column
    this.pipeTimer = 0;
    this.pipesSpawned = 0; // running count, used to alternate pipe colour
    // Multiplies the world scroll speed; grows by SPEED_INCREASE_PER_PIPE
    // each time a pipe is passed (see addScore path) and never resets.
    this.speedScale = 1;

    this.physics.add.overlap(this.bird, this.pipes, this.hitObstacle, null, this);
  }

  buildGround() {
    // Scrolling ground via a tileSprite so it can loop seamlessly.
    this.ground = this.add
      .tileSprite(0, FLOOR_Y, GAME_WIDTH, GROUND_HEIGHT, "ground")
      .setOrigin(0, 0)
      .setDepth(15);

    // Physics floor (invisible static body aligned with the ground top).
    this.floor = this.physics.add.staticImage(GAME_WIDTH / 2, FLOOR_Y).setVisible(false);
    this.floor.body.setSize(GAME_WIDTH, GROUND_HEIGHT);
    this.floor.body.position.set(0, FLOOR_Y);
    this.physics.add.collider(this.bird, this.floor, this.hitObstacle, null, this);
  }

  buildUI() {
    // Big live score, centered near the top.
    this.scoreText = this.add
      .text(GAME_WIDTH / 2, 70, "0", {
        fontFamily: "Arial, sans-serif",
        fontSize: "56px",
        color: "#ffffff",
        stroke: "#3a5a1b",
        strokeThickness: 8,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(30);

    // High-score label, top-left.
    this.highText = this.add
      .text(12, 10, "BEST  " + this.highScore, {
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
        color: "#ffffff",
        stroke: "#3a5a1b",
        strokeThickness: 4,
        fontStyle: "bold",
      })
      .setDepth(30);
  }

  buildJumpButton() {
    // A large, thumb-friendly JUMP button anchored at the bottom center —
    // ideal for one-handed phone play. Lives above the ground strip.
    const bx = GAME_WIDTH / 2;
    const by = GAME_HEIGHT - GROUND_HEIGHT / 2;

    this.jumpButton = this.add
      .image(bx, by, "jump-btn")
      .setDepth(40)
      .setScale(0.92)
      .setInteractive({ useHandCursor: true });

    this.jumpLabel = this.add
      .text(bx, by, "JUMP", {
        fontFamily: "Arial, sans-serif",
        fontSize: "20px",
        color: "#7a4a00",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(41);

    const press = () => {
      this.jumpButton.setScale(0.84);
      this.flap();
    };
    const release = () => this.jumpButton.setScale(0.92);

    this.jumpButton.on("pointerdown", (p, x, y, e) => {
      // Stop this tap from also triggering the global "tap anywhere" flap.
      if (e && e.stopPropagation) e.stopPropagation();
      press();
    });
    this.jumpButton.on("pointerup", release);
    this.jumpButton.on("pointerout", release);
  }

  bindInput() {
    // Tap / click anywhere flaps too (classic Flappy feel).
    this.input.on("pointerdown", () => this.flap());

    // Keyboard: space or up arrow.
    this.input.keyboard.on("keydown-SPACE", () => this.flap());
    this.input.keyboard.on("keydown-UP", () => this.flap());
  }

  /* -------- game states -------- */

  showReady() {
    this.readyGroup = this.add.container(0, 0).setDepth(35);

    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.24, "FLAPPY BIRD", {
        fontFamily: "Arial, sans-serif",
        fontSize: "40px",
        color: "#ffffff",
        stroke: "#3a5a1b",
        strokeThickness: 8,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.6, "Tap, press SPACE,\nor use the JUMP button", {
        fontFamily: "Arial, sans-serif",
        fontSize: "20px",
        color: "#ffffff",
        stroke: "#3a5a1b",
        strokeThickness: 5,
        align: "center",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: hint,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.readyGroup.add([title, hint]);
  }

  startPlaying() {
    if (this.gameState !== "ready") return;
    this.gameState = "playing";

    if (this.idleTween) this.idleTween.stop();
    if (this.readyGroup) this.readyGroup.destroy();

    this.bird.body.setAllowGravity(true);
    this.flap();
  }

  flap() {
    if (this.gameState === "ready") {
      this.startPlaying();
      return;
    }
    if (this.gameState !== "playing") return;

    this.bird.setVelocityY(FLAP_VELOCITY);
    // Nose up on flap.
    this.tweens.add({
      targets: this.bird,
      angle: -22,
      duration: 120,
      ease: "Quad.easeOut",
    });
  }

  /* -------- pipes -------- */

  // The world's current scroll speed, scaled up as pipes are passed.
  currentPipeSpeed() {
    return PIPE_SPEED * this.speedScale;
  }

  // Re-apply the current speed to every live pipe body, so already-spawned
  // pipes accelerate along with the rest of the world.
  updatePipeSpeeds() {
    const v = -this.currentPipeSpeed();
    this.pipes.getChildren().forEach((p) => p.body.setVelocityX(v));
  }

  spawnPipeColumn() {
    const margin = 60;
    const minCenter = margin + PIPE_GAP / 2;
    const maxCenter = FLOOR_Y - margin - PIPE_GAP / 2;
    const gapCenter = Phaser.Math.Between(minCenter, maxCenter);

    const x = GAME_WIDTH + PIPE_WIDTH;
    const topEnd = gapCenter - PIPE_GAP / 2;
    const bottomStart = gapCenter + PIPE_GAP / 2;

    // Occasionally a whole column comes out red, at random. Otherwise fall
    // back to the usual green/purple alternation (only advancing that counter
    // for non-red columns, so the alternation stays intact between reds).
    let palette;
    if (Phaser.Math.FloatBetween(0, 1) < RED_PIPE_CHANCE) {
      palette = RED_PIPE_PALETTE;
    } else {
      palette = PIPE_PALETTES[this.pipesSpawned % PIPE_PALETTES.length];
      this.pipesSpawned += 1;
    }
    const isRed = palette === RED_PIPE_PALETTE;

    const top = this.createPipe(x, topEnd, "up", palette.key);
    const bottom = this.createPipe(x, bottomStart, "down", palette.key);

    // Use one invisible scoring sensor per column, riding with the pipes.
    // Red columns are worth double.
    const scorer = {
      x: x,
      scored: false,
      top: top,
      bottom: bottom,
      points: isRed ? RED_PIPE_POINTS : 1,
    };
    this.pipeColumns.push(scorer);
  }

  /**
   * Build a single pipe out of a stretched body + a cap, then wrap the
   * whole thing in one physics sprite for collision.
   *
   * dir 'up'   -> pipe hangs from the top, mouth pointing DOWN at `edgeY`.
   * dir 'down' -> pipe rises from the bottom, mouth pointing UP at `edgeY`.
   */
  createPipe(x, edgeY, dir, colorKey) {
    const container = this.add.container(x, 0).setDepth(5);

    let bodyTop, bodyHeight;
    if (dir === "up") {
      bodyTop = 0;
      bodyHeight = edgeY;
    } else {
      bodyTop = edgeY;
      bodyHeight = FLOOR_Y - edgeY;
    }

    const body = this.add
      .tileSprite(0, bodyTop, PIPE_WIDTH, Math.max(bodyHeight, 1), "pipe-body-" + colorKey)
      .setOrigin(0.5, 0);

    const cap = this.add.image(0, dir === "up" ? edgeY : edgeY, "pipe-cap-" + colorKey);
    cap.setOrigin(0.5, dir === "up" ? 1 : 0);

    container.add([body, cap]);

    // Wrap the container in an arcade body covering the drawn pipe.
    this.pipes.add(container);
    container.body.setAllowGravity(false);
    container.body.setImmovable(true);
    container.body.setSize(PIPE_WIDTH, bodyHeight);
    // The container's transform sits at (x, 0); offset the body to the
    // drawn region so collisions line up with what's on screen.
    container.body.setOffset(-PIPE_WIDTH / 2, bodyTop);
    container.body.setVelocityX(-this.currentPipeSpeed());
    return container;
  }

  /* -------- collisions & scoring -------- */

  hitObstacle() {
    if (this.gameState !== "playing") return;
    this.die();
  }

  die() {
    this.gameState = "dead";
    this.cameras.main.shake(220, 0.012);
    this.cameras.main.flash(120, 255, 255, 255);

    // Freeze pipes.
    this.pipes.getChildren().forEach((p) => p.body.setVelocityX(0));
    this.bird.anims.stop();

    // Little death arc.
    this.bird.setVelocityY(-160);
    this.tweens.add({ targets: this.bird, angle: 90, duration: 500 });

    this.saveHighScore();
    this.showGameOver();
  }

  saveHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try {
        localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
      } catch (e) {
        /* storage may be unavailable (private mode); ignore */
      }
      this.highText.setText("BEST  " + this.highScore);
    }
  }

  loadHighScore() {
    try {
      const v = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10);
      return Number.isFinite(v) ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  showGameOver() {
    const panel = this.add.container(0, 0).setDepth(45);

    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.35)
      .setOrigin(0, 0);

    const over = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.3, "GAME OVER", {
        fontFamily: "Arial, sans-serif",
        fontSize: "44px",
        color: "#ffffff",
        stroke: "#8a2020",
        strokeThickness: 8,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const isBest = this.score > 0 && this.score >= this.highScore;
    const stats = this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT * 0.45,
        "SCORE   " + this.score + "\nBEST    " + this.highScore + (isBest ? "   ★NEW!" : ""),
        {
          fontFamily: "Arial, sans-serif",
          fontSize: "24px",
          color: "#ffffff",
          stroke: "#3a5a1b",
          strokeThickness: 5,
          align: "center",
          fontStyle: "bold",
        }
      )
      .setOrigin(0.5);

    const restart = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.62, "TAP TO RESTART", {
        fontFamily: "Arial, sans-serif",
        fontSize: "22px",
        color: "#ffffff",
        stroke: "#3a5a1b",
        strokeThickness: 5,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: restart, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    panel.add([dim, over, stats, restart]);

    // Allow a short delay so the death tap doesn't instantly restart.
    this.time.delayedCall(450, () => {
      this.input.once("pointerdown", () => this.scene.restart());
      this.input.keyboard.once("keydown-SPACE", () => this.scene.restart());
    });
  }

  /* -------- main loop -------- */

  update(time, delta) {
    const dt = delta / 1000;

    // Drift clouds always.
    this.clouds.forEach((c) => {
      c.x -= c.driftSpeed * dt;
      if (c.x < -c.displayWidth) {
        c.x = GAME_WIDTH + c.displayWidth;
        c.y = Phaser.Math.Between(40, 220);
      }
    });

    if (this.gameState === "ready") return;

    if (this.gameState === "playing") {
      const speed = this.currentPipeSpeed();

      // Scroll the ground.
      this.ground.tilePositionX += speed * dt;

      // Scroll the background houses left at the same speed the world moves
      // under the bird, so it looks like we're flying past them. Recycle any
      // house that leaves the left edge to the right of the rightmost one, as
      // a fresh random variant with a random gap.
      for (const h of this.houses) {
        h.x -= speed * dt;
      }
      for (const h of this.houses) {
        if (h.x < -h.displayWidth) {
          const rightmost = Math.max(...this.houses.map((o) => o.x));
          h.setTexture(Phaser.Utils.Array.GetRandom(HOUSE_KEYS));
          h.setScale(Phaser.Math.FloatBetween(0.8, 1.1));
          h.x = rightmost + Phaser.Math.Between(150, 260);
        }
      }

      // Rotate the bird toward its velocity for that diving feel.
      const targetAngle = Phaser.Math.Clamp(this.bird.body.velocity.y * 0.08, -22, 90);
      this.bird.angle = Phaser.Math.Linear(this.bird.angle, targetAngle, 0.1);

      // Spawn pipes on a fixed horizontal cadence. Using the scaled speed here
      // keeps the on-screen spacing constant even as the world speeds up.
      this.pipeTimer += speed * dt;
      if (this.pipeColumns.length === 0 || this.pipeTimer >= PIPE_SPACING) {
        this.pipeTimer = 0;
        this.spawnPipeColumn();
      }

      // Move scorers with the pipes, tally passes, and clean up.
      for (let i = this.pipeColumns.length - 1; i >= 0; i--) {
        const col = this.pipeColumns[i];
        col.x -= speed * dt;

        if (!col.scored && col.x < this.bird.x) {
          col.scored = true;
          this.addScore(col.points);
          // Passing a pipe permanently ratchets the world speed up.
          this.speedScale *= 1 + SPEED_INCREASE_PER_PIPE;
          this.updatePipeSpeeds();
        }

        if (col.x < -PIPE_WIDTH * 2) {
          col.top.destroy();
          col.bottom.destroy();
          this.pipeColumns.splice(i, 1);
        }
      }

      // Ceiling clamp (don't let the bird escape the top).
      if (this.bird.y < 0) {
        this.bird.y = 0;
        this.bird.setVelocityY(0);
      }
    }

    // While dead the bird keeps falling; stop it at the floor.
    if (this.gameState === "dead") {
      if (this.bird.y > FLOOR_Y - 10) {
        this.bird.y = FLOOR_Y - 10;
        this.bird.setVelocityY(0);
      }
    }
  }

  addScore(points = 1) {
    this.score += points;
    this.scoreText.setText(String(this.score));
    // Pop the score text — a bigger pop when a red pipe scores double.
    this.tweens.add({
      targets: this.scoreText,
      scale: points > 1 ? 1.5 : 1.25,
      duration: 90,
      yoyo: true,
      ease: "Quad.easeOut",
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Boot Phaser.                                                       */
/* ------------------------------------------------------------------ */

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game-container",
  backgroundColor: "#4ec0ca",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: GRAVITY },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// Expose for debugging / automated checks.
window.game = game;
