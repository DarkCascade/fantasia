/*
 * Combat Sim — a basic turn-based battle.
 *
 * A hero on the left faces a row of enemies on the right. On the hero's turn
 * you pick Attack (deal 1–5 damage to the active enemy) or Block (halve the
 * next damage you take until your next turn). The enemies then take their
 * turn — each living one attacks or blocks by the same rules. Health bars sit
 * above every combatant and deplete as damage lands. Clear the enemies to win;
 * fall to 0 HP and it's over.
 *
 * All art is generated at runtime from primitives, like the rest of Fantasia.
 * Created on demand via window.launchCombatSim() so the menu stays first.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 600;

  const HERO_HP = 40;
  const ENEMY_HP = 8;
  const ENEMY_COUNT = 3;
  const DMG_MIN = 1;
  const DMG_MAX = 5;
  const ENEMY_ATTACK_CHANCE = 0.65; // else it blocks
  const STEP_MS = 620; // pacing between enemy actions

  const ENEMY_TINTS = [0x8fd94f, 0xe0913b, 0xd0596a];

  // Block halves incoming damage (rounded up so a hit never fully whiffs).
  function halved(dmg) {
    return Math.ceil(dmg / 2);
  }

  class CombatScene extends Phaser.Scene {
    constructor() {
      super("CombatScene");
    }

    create() {
      this.busy = false;
      this.over = false;

      this.buildTextures();
      this.buildBackground();
      this.buildHero();
      this.buildEnemies();
      this.buildUI();

      this.startHeroTurn();
    }

    /* ---------- textures ---------- */

    buildTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      if (!this.textures.exists("cs-bg")) {
        const top = Phaser.Display.Color.ValueToColor(0x2a2350);
        const bot = Phaser.Display.Color.ValueToColor(0x120e28);
        const strips = 40;
        const sh = Math.ceil(H / strips);
        for (let i = 0; i < strips; i++) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 100, (i / (strips - 1)) * 100);
          g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
          g.fillRect(0, i * sh, W, sh + 1);
        }
        g.generateTexture("cs-bg", W, H);
      }

      // Hero: a small blue knight with a sword.
      if (!this.textures.exists("cs-hero")) {
        g.clear();
        // body
        g.fillStyle(0x3a6ea5, 1);
        g.fillRoundedRect(14, 34, 34, 44, 8);
        g.fillStyle(0x5a8fd0, 1);
        g.fillRoundedRect(18, 38, 14, 36, 5); // highlight
        // head
        g.fillStyle(0xf2c79a, 1);
        g.fillCircle(31, 24, 14);
        g.lineStyle(2, 0x27456b, 1);
        g.strokeCircle(31, 24, 14);
        // eyes
        g.fillStyle(0x1a2530, 1);
        g.fillCircle(27, 24, 2);
        g.fillCircle(36, 24, 2);
        // sword
        g.fillStyle(0xd7dde3, 1);
        g.fillRect(52, 6, 5, 46);
        g.fillStyle(0x9aa2ab, 1);
        g.fillRect(48, 50, 13, 5);
        g.generateTexture("cs-hero", 66, 90);
      }

      // Enemy: a neutral-toned goblin, tinted per instance.
      if (!this.textures.exists("cs-enemy")) {
        g.clear();
        g.fillStyle(0xcfd6c2, 1);
        g.fillRoundedRect(8, 18, 40, 44, 12);
        g.fillStyle(0xe6ecdd, 1);
        g.fillRoundedRect(12, 22, 15, 30, 7); // highlight
        // ears
        g.fillStyle(0xcfd6c2, 1);
        g.fillTriangle(6, 24, 0, 14, 14, 22);
        g.fillTriangle(50, 24, 56, 14, 42, 22);
        g.lineStyle(2, 0x3a3f30, 1);
        g.strokeRoundedRect(8, 18, 40, 44, 12);
        // eyes
        g.fillStyle(0x201a10, 1);
        g.fillCircle(22, 34, 3.2);
        g.fillCircle(34, 34, 3.2);
        // scowl
        g.lineStyle(2, 0x201a10, 1);
        g.lineBetween(20, 46, 36, 46);
        g.generateTexture("cs-enemy", 56, 66);
      }

      g.destroy();
    }

    /* ---------- combatants ---------- */

    buildBackground() {
      this.add.image(0, 0, "cs-bg").setOrigin(0, 0).setDepth(-20);
      this.add.rectangle(0, H - 150, W, 4, 0x4a4270).setOrigin(0, 0).setDepth(-10);
    }

    makeBars(entity, halfH) {
      entity.halfH = halfH;
      entity.bar = this.add.graphics().setDepth(15);
      entity.hpText = this.add
        .text(entity.sprite.x, entity.sprite.y - halfH - 30, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(16);
      entity.shield = this.add
        .text(entity.sprite.x + halfH * 0.7, entity.sprite.y - halfH - 8, "🛡", {
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
        })
        .setOrigin(0.5)
        .setDepth(16)
        .setVisible(false);
      this.drawBar(entity);
    }

    drawBar(entity) {
      const g = entity.bar;
      g.clear();
      const w = 58;
      const h = 8;
      const x = entity.sprite.x - w / 2;
      const y = entity.sprite.y - entity.halfH - 20;
      g.fillStyle(0x000000, 0.5);
      g.fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle(0x5a1a1a, 1);
      g.fillRect(x, y, w, h);
      const ratio = Phaser.Math.Clamp(entity.hp / entity.maxHp, 0, 1);
      const col = ratio > 0.5 ? 0x4fc84f : ratio > 0.25 ? 0xf0c020 : 0xe23b3b;
      g.fillStyle(col, 1);
      g.fillRect(x, y, w * ratio, h);
      entity.hpText.setText(Math.max(0, entity.hp) + "/" + entity.maxHp);
    }

    buildHero() {
      const spr = this.add.image(84, 330, "cs-hero").setDepth(10);
      this.hero = { sprite: spr, hp: HERO_HP, maxHp: HERO_HP, blocking: false };
      this.makeBars(this.hero, 45);
    }

    buildEnemies() {
      this.enemies = [];
      const ys = [180, 322, 464];
      for (let i = 0; i < ENEMY_COUNT; i++) {
        const spr = this.add.image(314, ys[i], "cs-enemy").setDepth(10).setTint(ENEMY_TINTS[i % ENEMY_TINTS.length]);
        const e = { sprite: spr, hp: ENEMY_HP, maxHp: ENEMY_HP, blocking: false, alive: true, idx: i };
        this.makeBars(e, 33);
        this.enemies.push(e);
      }
      // Target marker for the active enemy.
      this.marker = this.add
        .text(0, 0, "▶", {
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          color: "#ffd23f",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(17);
      this.updateMarker();
    }

    activeEnemy() {
      return this.enemies.find((e) => e.alive) || null;
    }

    updateMarker() {
      const a = this.activeEnemy();
      if (!a) {
        this.marker.setVisible(false);
        return;
      }
      this.marker.setVisible(true);
      this.marker.setPosition(a.sprite.x - a.halfH - 22, a.sprite.y);
    }

    /* ---------- UI ---------- */

    buildUI() {
      this.add
        .text(W / 2, 26, "COMBAT SIM", {
          fontFamily: "Arial, sans-serif",
          fontSize: "24px",
          color: "#ffffff",
          stroke: "#2a2350",
          strokeThickness: 6,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.statusText = this.add
        .text(W / 2, H - 104, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#ffe7a3",
          stroke: "#000000",
          strokeThickness: 3,
          align: "center",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30);

      this.attackBtn = this.makeButton(116, H - 52, "Attack", 0x8a2f2f, () => this.heroAttack());
      this.blockBtn = this.makeButton(284, H - 52, "Block", 0x2f5a8a, () => this.heroBlock());

      this.makeButton(44, 24, "≡", 0x4a4270, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      }, 18);
    }

    makeButton(x, y, label, color, onClick, size) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: (size || 22) + "px",
          color: "#ffffff",
          backgroundColor: "#" + color.toString(16).padStart(6, "0"),
          padding: { x: 16, y: 8 },
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

    setActionsEnabled(on) {
      [this.attackBtn, this.blockBtn].forEach((b) => {
        b.setAlpha(on ? 1 : 0.4);
        if (on) b.setInteractive({ useHandCursor: true });
        else b.disableInteractive();
      });
    }

    /* ---------- turn flow ---------- */

    startHeroTurn() {
      if (this.over) return;
      this.hero.blocking = false; // block only lasts through the enemies' turn
      this.hero.shield.setVisible(false);
      this.busy = false;
      this.setActionsEnabled(true);
      this.setStatus("Your move: Attack or Block");
    }

    heroAttack() {
      if (this.busy || this.over) return;
      const target = this.activeEnemy();
      if (!target) return;
      this.busy = true;
      this.setActionsEnabled(false);

      let dmg = Phaser.Math.Between(DMG_MIN, DMG_MAX);
      let note = "Hero attacks for " + dmg;
      if (target.blocking) {
        dmg = halved(dmg);
        note = "Hero attacks — blocked! " + dmg + " dmg";
      }
      this.applyDamage(target, dmg);
      this.flash(target.sprite);
      this.setStatus(note);

      if (!target.alive) {
        this.killEnemy(target);
        this.updateMarker();
      }

      if (this.enemies.every((e) => !e.alive)) {
        this.time.delayedCall(500, () => this.endGame(true));
        return;
      }
      this.time.delayedCall(STEP_MS, () => this.enemyTurn());
    }

    heroBlock() {
      if (this.busy || this.over) return;
      this.busy = true;
      this.setActionsEnabled(false);
      this.hero.blocking = true;
      this.hero.shield.setVisible(true);
      this.setStatus("Hero braces to block");
      this.time.delayedCall(STEP_MS, () => this.enemyTurn());
    }

    enemyTurn() {
      if (this.over) return;
      const living = this.enemies.filter((e) => e.alive);
      let i = 0;

      const step = () => {
        if (this.over) return;
        if (i >= living.length) {
          if (this.hero.hp <= 0) this.endGame(false);
          else this.startHeroTurn();
          return;
        }
        const e = living[i++];
        e.blocking = false; // clear this enemy's stale block at its turn
        e.shield.setVisible(false);

        if (Math.random() < ENEMY_ATTACK_CHANCE) {
          let dmg = Phaser.Math.Between(DMG_MIN, DMG_MAX);
          let note = "Enemy " + (e.idx + 1) + " attacks for " + dmg;
          if (this.hero.blocking) {
            dmg = halved(dmg);
            note = "Enemy " + (e.idx + 1) + " attacks — blocked! " + dmg + " dmg";
          }
          this.applyDamage(this.hero, dmg);
          this.flash(this.hero.sprite);
          this.setStatus(note);
        } else {
          e.blocking = true;
          e.shield.setVisible(true);
          this.setStatus("Enemy " + (e.idx + 1) + " blocks");
        }

        if (this.hero.hp <= 0) {
          this.time.delayedCall(400, () => this.endGame(false));
          return;
        }
        this.time.delayedCall(STEP_MS, step);
      };

      this.setStatus("Enemies act...");
      this.time.delayedCall(400, step);
    }

    applyDamage(entity, dmg) {
      entity.hp = Math.max(0, entity.hp - dmg);
      this.drawBar(entity);
      if (entity !== this.hero && entity.hp <= 0) entity.alive = false;
    }

    killEnemy(e) {
      e.bar.setVisible(false);
      e.hpText.setVisible(false);
      e.shield.setVisible(false);
      this.tweens.add({ targets: e.sprite, alpha: 0.18, angle: 90, duration: 300 });
    }

    flash(sprite) {
      this.tweens.add({ targets: sprite, alpha: 0.3, duration: 70, yoyo: true });
    }

    setStatus(msg) {
      this.statusText.setText(msg);
    }

    /* ---------- end ---------- */

    endGame(won) {
      if (this.over) return;
      this.over = true;
      this.setActionsEnabled(false);

      const panel = this.add.container(0, 0).setDepth(60);
      const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0);
      const msg = this.add
        .text(W / 2, H * 0.32, won ? "VICTORY!" : "DEFEAT", {
          fontFamily: "Arial, sans-serif",
          fontSize: "46px",
          color: won ? "#ffd23f" : "#e23b3b",
          stroke: "#000000",
          strokeThickness: 8,
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      panel.add([dim, msg]);

      this.makeButton(W / 2, H * 0.5, "▸ Fight Again", 0x2f5a8a, () => this.scene.restart());
      this.makeButton(W / 2, H * 0.5 + 56, "≡ Menu", 0x4a4270, () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }
  }

  function launchCombatSim() {
    if (window.combatGame) return window.combatGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#120e28",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [CombatScene],
    };
    const game = new Phaser.Game(config);
    window.combatGame = game;
    return game;
  }

  window.launchCombatSim = launchCombatSim;
})();
