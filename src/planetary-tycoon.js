/*
 * Planetary Manufacturing Tycoon — an incremental factory-builder.
 *
 * Start with a handful of empty production slots on a nondescript home
 * planet. Tap an empty (unlocked) slot to drop a device on it; each device
 * cranks out a product on its own timer, which travels to the crate at the
 * selling dock. A market tick sells off everything waiting in the crate
 * every few seconds — there's no manual "sell" button, sales just happen on
 * a clock, same as the original design note. Slots beyond the planet's
 * starting count are locked behind a padlock until bought. Research (money,
 * permanent, carries across planets) makes devices produce faster, the
 * market tick fire faster, and every sale worth more.
 *
 * Once the bank crosses the next planet's land cost, "Relocate" cashes out
 * the current plot (it's sold off — devices and progress on it don't come
 * along) and buys a foothold on a new, more lucrative world. Later planets
 * have a type (mining / combat / forestry) and a rare bonus item their
 * devices occasionally turn out for a big multiplier on top of the usual
 * per-unit price, e.g. a mining world's ore run occasionally kicks out a
 * Star Crystal instead.
 *
 * Everything on screen is drawn from primitives at runtime (Graphics ->
 * generateTexture for the reusable pad/machine/product/crate icons, plain
 * rectangles for the sky/ground backdrop) — no external image assets, same
 * as the rest of Fantasia. Created on demand via
 * window.launchPlanetaryTycoon() so the menu stays the first screen; the
 * handle is window.tycoonGame.
 */
(function () {
  "use strict";

  const W = 400;
  const H = 600;

  const BEST_KEY = "planetary-tycoon-best-money";

  // Six pad slots laid out as a 3x2 grid on every planet; how many start
  // unlocked (and how much the world is worth) is what varies.
  const GRID_COLS = 3;
  const GRID_ROWS = 2;
  const MAX_SLOTS = GRID_COLS * GRID_ROWS;
  const PAD_X = [50, 120, 190];
  const PAD_Y = [278, 348];

  const DEVICE_COST_MULT = 9;
  const DEVICE_COST_GROWTH = 1.55;
  const SLOT_COST_MULT = 42;
  const SLOT_COST_GROWTH = 1.9;

  const BASE_PRODUCE_TIME = 4.2; // seconds per device, before research
  const MIN_PRODUCE_TIME = 1.1;
  const BASE_SELL_INTERVAL = 6; // seconds between market ticks
  const MIN_SELL_INTERVAL = 2.2;

  // Three permanent research tracks, five tiers each, shared cost ladder.
  // Costs are independent of the current planet so they stay a meaningful
  // long-term investment through relocations.
  const RESEARCH_TIER_COSTS = [90, 320, 1100, 4200, 16000];
  const RESEARCH_TRACKS = [
    {
      id: "speed",
      label: "Automation",
      desc: "-8% device time / tier",
      perTier: 0.92,
    },
    {
      id: "sales",
      label: "Logistics",
      desc: "-8% market tick / tier",
      perTier: 0.92,
    },
    {
      id: "quality",
      label: "Machining",
      desc: "+15% sale value / tier",
      perTier: 1.15,
    },
  ];

  const PLANETS = [
    {
      id: "dustpatch",
      name: "Dustpatch",
      kindLabel: "Nondescript World",
      landCost: 0,
      baseSlots: 3,
      resourceName: "Widget",
      resourceColor: 0x9fb4c7,
      baseValue: 4,
      rareName: null,
      rareChance: 0,
      rareMult: 1,
      sky: [0x353a4a, 0x1d2030],
      ground: 0x4a4238,
    },
    {
      id: "ferrous",
      name: "Ferrous Hollow",
      kindLabel: "Mining World",
      landCost: 600,
      baseSlots: 4,
      resourceName: "Ore",
      resourceColor: 0xb0763a,
      baseValue: 9,
      rareName: "Star Crystal",
      rareChance: 0.1,
      rareMult: 9,
      sky: [0x4a3420, 0x241609],
      ground: 0x5a4530,
    },
    {
      id: "bastion",
      name: "Bastion Prime",
      kindLabel: "Combat World",
      landCost: 4000,
      baseSlots: 4,
      resourceName: "Drone Part",
      resourceColor: 0x8a969f,
      baseValue: 22,
      rareName: "Combat Drone",
      rareChance: 0.08,
      rareMult: 11,
      sky: [0x3a1818, 0x1a0b0b],
      ground: 0x3a2222,
    },
    {
      id: "verdance",
      name: "Verdance",
      kindLabel: "Forestry World",
      landCost: 22000,
      baseSlots: 5,
      resourceName: "Lumber",
      resourceColor: 0x5c8a3a,
      baseValue: 55,
      rareName: "Ironwood Heart",
      rareChance: 0.07,
      rareMult: 13,
      sky: [0x143621, 0x081b10],
      ground: 0x2c4020,
    },
    {
      id: "auric",
      name: "Auric Reach",
      kindLabel: "Deep Mining World",
      landCost: 120000,
      baseSlots: 5,
      resourceName: "Rare Ore",
      resourceColor: 0xd4af37,
      baseValue: 140,
      rareName: "Auric Core",
      rareChance: 0.06,
      rareMult: 15,
      sky: [0x2e2308, 0x161002],
      ground: 0x4a3a10,
    },
  ];

  function fmtNum(n) {
    const sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return sign + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return sign + (n / 1e3).toFixed(1) + "k";
    return sign + Math.floor(n).toString();
  }
  function fmtMoney(n) {
    return "$" + fmtNum(n);
  }

  class TycoonScene extends Phaser.Scene {
    constructor() {
      super("TycoonScene");
    }

    create() {
      this.buildTextures();

      this.money = 60;
      this.best = this.loadBest();
      this.planetIndex = 0;
      this.researchOpen = false;
      this.research = { speed: 0, sales: 0, quality: 0 };

      this.buildBackdrop();
      this.buildHud();
      this.buildFactoryState();
      this.buildFactoryVisuals();
      this.buildControls();
      this.buildResearchPanel();

      this.refreshAll();
    }

    /* ---------------- textures (baked once from primitives) ---------------- */

    buildTextures() {
      const g = this.add.graphics();

      // Slot pad: rounded square, subtle inner bevel.
      g.clear();
      g.fillStyle(0x2a2f45, 1);
      g.fillRoundedRect(0, 0, 56, 56, 10);
      g.lineStyle(2, 0x4d5578, 1);
      g.strokeRoundedRect(1, 1, 54, 54, 10);
      g.generateTexture("ty-pad", 56, 56);

      // Locked pad: darker, with a padlock glyph.
      g.clear();
      g.fillStyle(0x1c2030, 1);
      g.fillRoundedRect(0, 0, 56, 56, 10);
      g.lineStyle(2, 0x33384f, 1);
      g.strokeRoundedRect(1, 1, 54, 54, 10);
      g.fillStyle(0x6a7290, 1);
      g.fillRoundedRect(21, 27, 14, 12, 3);
      g.lineStyle(3, 0x6a7290, 1);
      g.strokeCircle(28, 24, 7);
      g.generateTexture("ty-pad-locked", 56, 56);

      // Machine icon: body + vent + two lights. Tinted per-planet at runtime.
      g.clear();
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(6, 14, 32, 24, 4);
      g.fillRect(14, 4, 12, 12);
      g.fillStyle(0xffffff, 0.55);
      g.fillRect(9, 18, 26, 4);
      g.generateTexture("ty-machine", 44, 40);

      // Small blinking light dot used on active machines.
      g.clear();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture("ty-light", 8, 8);

      // Product: small rounded square, tinted per-planet / gold for rares.
      g.clear();
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(0, 0, 16, 16, 4);
      g.lineStyle(2, 0x000000, 0.25);
      g.strokeRoundedRect(1, 1, 14, 14, 4);
      g.generateTexture("ty-product", 16, 16);

      // Selling crate.
      g.clear();
      g.fillStyle(0x8a5a2b, 1);
      g.fillRoundedRect(0, 6, 60, 40, 5);
      g.fillStyle(0x6b4420, 1);
      g.fillRect(0, 6, 60, 8);
      g.fillRect(0, 38, 60, 8);
      g.lineStyle(3, 0x4a2e14, 1);
      g.strokeRoundedRect(1, 7, 58, 38, 5);
      g.generateTexture("ty-crate", 60, 46);

      g.destroy();
    }

    /* ---------------- static-ish backdrop (swapped on relocate) ---------------- */

    buildBackdrop() {
      this.skyGfx = this.add.graphics().setDepth(-20);
      this.sunGfx = this.add.graphics().setDepth(-19);
      this.groundGfx = this.add.graphics().setDepth(-19);
      this.dockPlate = this.add.graphics().setDepth(-18);
      this.repaintBackdrop();
    }

    repaintBackdrop() {
      const p = this.planet();
      this.skyGfx.clear();
      this.skyGfx.fillGradientStyle(p.sky[0], p.sky[0], p.sky[1], p.sky[1], 1);
      this.skyGfx.fillRect(0, 56, W, 194);

      // A soft glowing sun/moon in the planet's resource colour, plus a
      // couple of sibling worlds on the horizon — keeps the factory's sky
      // from reading as dead space between the money bar and the ground.
      this.sunGfx.clear();
      this.sunGfx.fillStyle(p.resourceColor, 0.16);
      this.sunGfx.fillCircle(320, 100, 64);
      this.sunGfx.fillStyle(p.resourceColor, 0.32);
      this.sunGfx.fillCircle(320, 100, 30);
      this.sunGfx.fillStyle(0xffffff, 0.5);
      this.sunGfx.fillCircle(320, 100, 14);
      this.sunGfx.fillStyle(0xffffff, 0.5);
      this.sunGfx.fillCircle(56, 90, 6);
      this.sunGfx.fillStyle(0xffffff, 0.3);
      this.sunGfx.fillCircle(96, 130, 3);
      this.sunGfx.fillStyle(0xffffff, 0.22);
      this.sunGfx.fillCircle(150, 78, 2.4);

      this.groundGfx.clear();
      this.groundGfx.fillStyle(p.ground, 1);
      this.groundGfx.fillRect(0, 250, W, 150);
      this.groundGfx.fillStyle(0xffffff, 0.08);
      this.groundGfx.fillRect(0, 250, W, 4);

      this.dockPlate.clear();
      this.dockPlate.fillStyle(0x000000, 0.18);
      this.dockPlate.fillRoundedRect(228, 258, 150, 110, 10);
    }

    /* ---------------- HUD ---------------- */

    buildHud() {
      this.add.rectangle(0, 0, W, 56, 0x0d0f1c).setOrigin(0, 0).setDepth(-1);

      this.moneyText = this.add
        .text(14, 8, "", { fontFamily: "Arial, sans-serif", fontSize: "22px", color: "#ffe7a3", fontStyle: "bold" })
        .setDepth(10);
      this.bestText = this.add
        .text(14, 32, "", { fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#9aa0c0" })
        .setDepth(10);
      this.planetText = this.add
        .text(6, 60, "", { fontFamily: "Arial, sans-serif", fontSize: "13px", color: "#d8cdff", fontStyle: "bold" })
        .setDepth(10);

      const menuBtn = this.add
        .text(386, 10, "≡ Menu", {
          fontFamily: "Arial, sans-serif",
          fontSize: "13px",
          color: "#ffe7a3",
          backgroundColor: "#2a2f45",
          padding: { x: 8, y: 5 },
        })
        .setOrigin(1, 0)
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      menuBtn.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });

      // Selling dock label + crate + pending counter + market-tick bar.
      this.add.image(303, 288, "ty-crate").setDepth(1);
      this.pendingText = this.add
        .text(303, 340, "", { fontFamily: "Arial, sans-serif", fontSize: "13px", color: "#ffe7a3", fontStyle: "bold" })
        .setOrigin(0.5)
        .setDepth(10);
      this.add
        .text(303, 356, "in crate", { fontFamily: "Arial, sans-serif", fontSize: "10px", color: "#9aa0c0" })
        .setOrigin(0.5)
        .setDepth(10);
      this.add
        .text(303, 260, "MARKET", { fontFamily: "Arial, sans-serif", fontSize: "10px", color: "#9aa0c0" })
        .setOrigin(0.5)
        .setDepth(10);
      this.sellBarBg = this.add.rectangle(303, 365, 130, 8, 0x14172a).setDepth(2);
      this.sellBarFg = this.add.rectangle(238, 365, 4, 8, 0xf0b94a).setOrigin(0, 0.5).setDepth(3);

      this.floaterLayer = this.add.container(0, 0).setDepth(20);
    }

    /* ---------------- factory economic state ---------------- */

    buildFactoryState() {
      const p = this.planet();
      this.slotCount = p.baseSlots;
      this.devicesOwned = 0;
      // slots[i] = null (locked, i >= slotCount), false (unlocked & empty), or
      // { timer } (a placed device counting down to its next product).
      this.slots = new Array(MAX_SLOTS).fill(null);
      for (let i = 0; i < this.slotCount; i++) this.slots[i] = false;
      this.pending = 0;
      this.sellTimer = this.sellInterval();
    }

    /* ---------------- factory visuals ---------------- */

    buildFactoryVisuals() {
      this.padSprites = [];
      this.machineSprites = [];
      this.barBgs = [];
      this.barFgs = [];
      this.costLabels = [];

      for (let i = 0; i < MAX_SLOTS; i++) {
        const x = PAD_X[i % GRID_COLS];
        const y = PAD_Y[Math.floor(i / GRID_COLS)];

        const pad = this.add.image(x, y, "ty-pad").setDepth(1).setInteractive({ useHandCursor: true });
        pad.on("pointerdown", (pointer, lx, ly, e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          this.onPadTapped(i);
        });
        this.padSprites.push(pad);

        const machine = this.add.image(x, y - 2, "ty-machine").setDepth(2).setVisible(false);
        this.machineSprites.push(machine);

        const barBg = this.add.rectangle(x, y + 24, 40, 5, 0x14172a).setDepth(2).setVisible(false);
        const barFg = this.add.rectangle(x - 20, y + 24, 1, 5, 0x6ee06e).setOrigin(0, 0.5).setDepth(3).setVisible(false);
        this.barBgs.push(barBg);
        this.barFgs.push(barFg);

        const costLabel = this.add
          .text(x, y + 20, "", { fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#ffe7a3", fontStyle: "bold" })
          .setOrigin(0.5)
          .setDepth(3);
        this.costLabels.push(costLabel);
      }
    }

    /* ---------------- bottom control panel ---------------- */

    buildControls() {
      // Stacked full-width so a long "Relocate -> <planet> $<cost>" label
      // never collides with its neighbour — a side-by-side layout did.
      this.researchBtn = this.makeButton(200, 420, "Research", () => this.openResearch());
      this.relocateBtn = this.makeButton(200, 468, "", () => this.tryRelocate());
      this.researchSummary = this.add
        .text(200, 510, "", { fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#9aa0c0" })
        .setOrigin(0.5)
        .setDepth(10);

      this.add
        .text(200, 536, "Tap an unlocked pad to place a device.\nTap a locked pad to buy the slot.", {
          fontFamily: "Arial, sans-serif",
          fontSize: "11px",
          color: "#6a7090",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(10);
    }

    makeButton(x, y, label, onClick) {
      const t = this.add
        .text(x, y, label, {
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          color: "#3a2500",
          backgroundColor: "#f0b94a",
          padding: { x: 12, y: 8 },
          fontStyle: "bold",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onClick();
      });
      return t;
    }

    /* ---------------- research modal ---------------- */

    buildResearchPanel() {
      const c = this.add.container(0, 0).setDepth(50).setVisible(false);
      const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x04030f, 0.72).setInteractive();
      backdrop.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.closeResearch();
      });
      const card = this.add.rectangle(W / 2, H / 2, 336, 320, 0x14173a).setStrokeStyle(3, 0xffd23f);
      const title = this.add
        .text(W / 2, H / 2 - 138, "RESEARCH", { fontFamily: "Georgia, serif", fontSize: "22px", color: "#ffe7a3", fontStyle: "bold" })
        .setOrigin(0.5);
      c.add([backdrop, card, title]);

      this.researchRows = [];
      RESEARCH_TRACKS.forEach((track, i) => {
        const rowY = H / 2 - 88 + i * 76;
        const name = this.add
          .text(W / 2 - 152, rowY, "", { fontFamily: "Arial, sans-serif", fontSize: "15px", color: "#ffe7a3", fontStyle: "bold" })
          .setOrigin(0, 0.5);
        const desc = this.add
          .text(W / 2 - 152, rowY + 18, track.desc, { fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#9aa0c0" })
          .setOrigin(0, 0.5);
        const buyBtn = this.add
          .text(W / 2 + 130, rowY + 9, "", {
            fontFamily: "Arial, sans-serif",
            fontSize: "13px",
            color: "#3a2500",
            backgroundColor: "#f0b94a",
            padding: { x: 10, y: 6 },
            fontStyle: "bold",
          })
          .setOrigin(1, 0.5)
          .setInteractive({ useHandCursor: true });
        buyBtn.on("pointerdown", (p, lx, ly, e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          this.buyResearch(track.id);
        });
        c.add([name, desc, buyBtn]);
        this.researchRows.push({ name, desc, buyBtn, track });
      });

      const closeBtn = this.add
        .text(W / 2, H / 2 + 138, "Close", {
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#ffe7a3",
          backgroundColor: "#2a2f45",
          padding: { x: 14, y: 7 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      closeBtn.on("pointerdown", (p, lx, ly, e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.closeResearch();
      });
      c.add(closeBtn);

      this.researchContainer = c;
    }

    openResearch() {
      this.researchOpen = true;
      this.researchContainer.setVisible(true);
      this.refreshResearchPanel();
    }
    closeResearch() {
      this.researchOpen = false;
      this.researchContainer.setVisible(false);
    }

    /* ---------------- economy helpers ---------------- */

    planet() {
      return PLANETS[this.planetIndex];
    }
    nextPlanet() {
      return PLANETS[this.planetIndex + 1] || null;
    }

    deviceCost() {
      return Math.round(this.planet().baseValue * DEVICE_COST_MULT * Math.pow(DEVICE_COST_GROWTH, this.devicesOwned));
    }
    slotCost() {
      const extra = this.slotCount - this.planet().baseSlots;
      return Math.round(this.planet().baseValue * SLOT_COST_MULT * Math.pow(SLOT_COST_GROWTH, extra));
    }
    produceTime() {
      return Math.max(MIN_PRODUCE_TIME, BASE_PRODUCE_TIME * Math.pow(RESEARCH_TRACKS[0].perTier, this.research.speed));
    }
    sellInterval() {
      return Math.max(MIN_SELL_INTERVAL, BASE_SELL_INTERVAL * Math.pow(RESEARCH_TRACKS[1].perTier, this.research.sales));
    }
    qualityMult() {
      return Math.pow(RESEARCH_TRACKS[2].perTier, this.research.quality);
    }
    researchCost(trackId) {
      const tier = this.research[trackId];
      if (tier >= RESEARCH_TIER_COSTS.length) return null;
      return RESEARCH_TIER_COSTS[tier];
    }

    addMoney(delta) {
      this.money += delta;
      if (this.money > this.best) {
        this.best = this.money;
        this.saveBest();
      }
    }

    /* ---------------- interactions ---------------- */

    onPadTapped(i) {
      if (this.researchOpen) return;
      if (i < this.slotCount) {
        // Unlocked: buy a device here if it's empty.
        if (this.slots[i] === false) {
          const cost = this.deviceCost();
          if (this.money >= cost) {
            this.money -= cost;
            this.devicesOwned++;
            this.slots[i] = { timer: this.produceTime() };
            this.refreshAll();
          } else {
            this.flashUnaffordable(this.padSprites[i]);
          }
        }
      } else if (i === this.slotCount) {
        // Next locked pad in reading order: buy the slot.
        const cost = this.slotCost();
        if (this.money >= cost) {
          this.money -= cost;
          this.slots[this.slotCount] = false;
          this.slotCount++;
          this.refreshAll();
        } else {
          this.flashUnaffordable(this.padSprites[i]);
        }
      }
    }

    buyResearch(trackId) {
      const cost = this.researchCost(trackId);
      if (cost === null) return;
      if (this.money < cost) return;
      this.money -= cost;
      this.research[trackId]++;
      this.refreshAll();
      this.refreshResearchPanel();
    }

    tryRelocate() {
      const np = this.nextPlanet();
      if (!np) return;
      if (this.money < np.landCost) {
        this.flashUnaffordable(this.relocateBtn);
        return;
      }
      this.money -= np.landCost;
      this.planetIndex++;
      this.repaintBackdrop();
      this.buildFactoryState();
      // Reset per-slot visuals to the fresh planet's starting layout.
      for (let i = 0; i < MAX_SLOTS; i++) {
        this.machineSprites[i].setVisible(false);
        this.barBgs[i].setVisible(false);
        this.barFgs[i].setVisible(false);
      }
      this.showFloater(W / 2, 200, "Relocated to " + np.name + "!", "#a6ffd8");
      this.refreshAll();
    }

    flashUnaffordable(target) {
      this.tweens.add({
        targets: target,
        alpha: { from: 1, to: 0.35 },
        yoyo: true,
        duration: 90,
        repeat: 1,
      });
    }

    /* ---------------- per-frame simulation ---------------- */

    update(time, delta) {
      const dt = delta / 1000;

      for (let i = 0; i < this.slotCount; i++) {
        const s = this.slots[i];
        if (!s) continue;
        s.timer -= dt;
        if (s.timer <= 0) {
          s.timer += this.produceTime();
          this.pending++;
          this.spawnProductTravel(i);
        }
      }

      this.sellTimer -= dt;
      if (this.sellTimer <= 0) {
        this.sellTimer += this.sellInterval();
        this.runMarketTick();
      }

      this.updateProgressBars();
      this.sellBarFg.width = Math.max(2, 130 * (1 - this.sellTimer / this.sellInterval()));

      // Cheap text/affordability refresh; costs and the relocate button's
      // enabled look need to track money as it climbs between clicks, not
      // just right after a purchase.
      this.hudRefreshAccum = (this.hudRefreshAccum || 0) + dt;
      if (this.hudRefreshAccum >= 0.25) {
        this.hudRefreshAccum = 0;
        this.refreshAll();
        if (this.researchOpen) this.refreshResearchPanel();
      }
    }

    updateProgressBars() {
      for (let i = 0; i < this.slotCount; i++) {
        const s = this.slots[i];
        if (!s) continue;
        const frac = 1 - Math.max(0, s.timer) / this.produceTime();
        this.barFgs[i].width = Math.max(1, 40 * frac);
      }
    }

    spawnProductTravel(slotIndex) {
      const x = PAD_X[slotIndex % GRID_COLS];
      const y = PAD_Y[Math.floor(slotIndex / GRID_COLS)] - 2;
      const p = this.planet();
      const img = this.add.image(x, y, "ty-product").setDepth(5).setTint(p.resourceColor);
      this.tweens.add({
        targets: img,
        x: 303,
        y: 288,
        scale: { from: 1, to: 0.6 },
        duration: 520,
        ease: "Cubic.easeIn",
        onComplete: () => img.destroy(),
      });
    }

    runMarketTick() {
      if (this.pending <= 0) return;
      const p = this.planet();
      const count = this.pending;
      this.pending = 0;
      let revenue = 0;
      let rareHits = 0;
      for (let i = 0; i < count; i++) {
        const isRare = p.rareName && Math.random() < p.rareChance;
        if (isRare) {
          rareHits++;
          revenue += p.baseValue * p.rareMult;
        } else {
          revenue += p.baseValue;
        }
      }
      revenue *= this.qualityMult();
      revenue = Math.round(revenue);
      this.addMoney(revenue);

      const label = rareHits > 0 ? "+" + fmtMoney(revenue) + " (" + rareHits + "★)" : "+" + fmtMoney(revenue);
      this.showFloater(303, 288, label, rareHits > 0 ? "#ffe27a" : "#a6ffd8");
      this.tweens.add({ targets: [this.dockPlate], alpha: { from: 0.5, to: 0.18 }, duration: 260 });
    }

    showFloater(x, y, text, color) {
      const t = this.add
        .text(x, y, text, { fontFamily: "Arial, sans-serif", fontSize: "15px", color: color, fontStyle: "bold" })
        .setOrigin(0.5)
        .setDepth(30);
      this.tweens.add({
        targets: t,
        y: y - 34,
        alpha: { from: 1, to: 0 },
        duration: 900,
        onComplete: () => t.destroy(),
      });
    }

    /* ---------------- HUD / label refresh ---------------- */

    refreshAll() {
      const p = this.planet();
      this.moneyText.setText(fmtMoney(this.money));
      this.bestText.setText("Best " + fmtMoney(this.best));
      this.planetText.setText(p.name + " — " + p.kindLabel);
      this.pendingText.setText(String(this.pending));

      for (let i = 0; i < MAX_SLOTS; i++) {
        const locked = i >= this.slotCount;
        const occupied = !locked && this.slots[i] !== false;
        this.padSprites[i].setTexture(locked ? "ty-pad-locked" : "ty-pad");
        this.machineSprites[i].setVisible(occupied).setTint(p.resourceColor);
        this.barBgs[i].setVisible(occupied);
        this.barFgs[i].setVisible(occupied);

        if (locked && i === this.slotCount) {
          this.costLabels[i].setText("🔒 " + fmtMoney(this.slotCost()));
        } else if (!locked && !occupied) {
          this.costLabels[i].setText("+ " + fmtMoney(this.deviceCost()));
        } else {
          this.costLabels[i].setText("");
        }
      }

      const np = this.nextPlanet();
      if (np) {
        this.relocateBtn.setText("Relocate → " + np.name + "\n" + fmtMoney(np.landCost));
        this.relocateBtn.setAlpha(this.money >= np.landCost ? 1 : 0.55);
      } else {
        this.relocateBtn.setText("Max World\nReached");
        this.relocateBtn.setAlpha(0.55);
      }

      this.researchSummary.setText(
        "Automation L" + this.research.speed + " · Logistics L" + this.research.sales + " · Machining L" + this.research.quality
      );
    }

    refreshResearchPanel() {
      this.researchRows.forEach((row) => {
        const tier = this.research[row.track.id];
        row.name.setText(row.track.label + "  (L" + tier + "/" + RESEARCH_TIER_COSTS.length + ")");
        const cost = this.researchCost(row.track.id);
        if (cost === null) {
          row.buyBtn.setText("MAXED");
          row.buyBtn.setAlpha(0.6);
        } else {
          row.buyBtn.setText(fmtMoney(cost));
          row.buyBtn.setAlpha(this.money >= cost ? 1 : 0.55);
        }
      });
    }

    /* ---------------- persistence ---------------- */

    loadBest() {
      try {
        const v = parseFloat(localStorage.getItem(BEST_KEY));
        return Number.isFinite(v) ? v : 60;
      } catch (e) {
        return 60;
      }
    }
    saveBest() {
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch (e) {
        /* storage may be unavailable; ignore */
      }
    }
  }

  function launchPlanetaryTycoon() {
    if (window.tycoonGame) return window.tycoonGame;
    const config = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: "game-container",
      backgroundColor: "#0d0f1c",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [TycoonScene],
    };
    const game = new Phaser.Game(config);
    window.tycoonGame = game;
    return game;
  }

  window.launchPlanetaryTycoon = launchPlanetaryTycoon;
})();
