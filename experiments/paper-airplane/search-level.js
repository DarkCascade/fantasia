#!/usr/bin/env node
/*
 * Paper Airplane level design search (a level-design aid).
 *
 *   node experiments/paper-airplane/search-level.js --level N [--trials 60] [--seed 1] [--url ...] [--top 5]
 *
 * Randomly samples layouts for a level (generators below, one per level that
 * needs tuning), scores each with the REAL physics, and prints the best as JSON
 * you can paste into src/paper-airplane/levels.js. A layout qualifies when
 *   - a modest number of grid throws win (WIN_MIN..WIN_MAX of the grid),
 *   - with the level's key mechanic DISABLED, zero throws win (so it is needed),
 *   - >= MECH_SHARE of the winning throws actually use that mechanic,
 *   - almost no flights stall or time out.
 * Generators mutate a copy of the level; `disable` strips the key mechanic.
 * Add/modify generators here when designing a new level.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright/index.js");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1]; };
const URL = arg("url", "http://localhost:8130");
const LEVEL = Number(arg("level", 5)) - 1;
const TRIALS = Number(arg("trials", 60));
const SEED = Number(arg("seed", 1));
const TOP = Number(arg("top", 5));
const WIN_MIN = Number(arg("winmin", 4)), WIN_MAX = Number(arg("winmax", 40)), MECH_SHARE = Number(arg("mechshare", 0.7)), STUCK = Number(arg("stuck", 0.03));
const ANG_STEP = Number(arg("angstep", 3)); // finer = slower but sees narrow windows
const PWS = String(arg("pws", "30,45,60,75,90,100,110")).split(",").map(Number);

// Generators/disablers are passed to the page as source strings. `r()` is a seeded uniform [0,1).
const FLOOR = "{ x: 0, y: 600, w: 450, h: 200, type: 'desk' }";
const GEN = {
  // 4. Spring Break: the spring is required (the bin is higher than any throw reaches);
  // the bin's shelf is one-way so the spring's rise passes up through it.
  3: {
    mech: "boing",
    gen: `
      const ledgeX = 330 + r() * 40, ledgeY = 265 + r() * 65;
      const sx = ledgeX - 30 + r() * 70;
      lvl.solids = [${FLOOR}, { x: sx, y: 582, w: 64, h: 18, type: 'spring' }, { x: ledgeX, y: ledgeY, w: 450 - ledgeX, h: 14, type: 'shelf' }];
      lvl.goal = { x: Math.min(ledgeX + 4, 366), y: ledgeY - 56, w: 84, h: 56 };
      lvl.hazards = [{ x: 175 + r() * 20, y: 576, w: 55, h: 24, label: 'SPILL' }];`,
    disable: `lvl.solids = lvl.solids.filter(s => s.type !== 'spring');`,
  },
  // 5. Pinball Desk: kicking bumpers are required (the bin is higher than any throw reaches).
  // A local search around a known-working funnel (a launcher bumper low, one under the bin shelf).
  4: {
    mech: "bump",
    gen: `
      const ledgeY = 290 + r() * 18, ledgeX = 338 + r() * 18;
      lvl.solids = [${FLOOR}, { x: ledgeX, y: ledgeY, w: 450 - ledgeX, h: 14, type: 'shelf' }];
      lvl.goal = { x: Math.min(ledgeX + 6, 366), y: ledgeY - 56, w: 84, h: 56 };
      lvl.bumpers = [
        { x: 268 + r() * 44, y: 412 + r() * 40, r: 34 + Math.floor(r() * 10) },
        { x: 338 + r() * 44, y: 346 + r() * 44, r: 26 + Math.floor(r() * 12) },
      ];
      lvl.hazards = [{ x: 150, y: 576, w: 70, h: 24, label: 'COFFEE' }];`,
    disable: `lvl.bumpers = [];`,
  },
  // 8. Draft Day: a funnel of winds is required (updraft, then a crosswind carries the plane
  // over a cork wall, then a downdraft drops it into the bin). Flights must not hover.
  7: {
    mech: "",
    gen: `
      const wallX = 280 + r() * 20, wallTop = 295 + r() * 30;
      lvl.solids = [${FLOOR}, { x: wallX, y: wallTop, w: 24, h: 600 - wallTop, type: 'cork' }];
      const ux = 125 + r() * 30, uy = 280 + r() * 50;
      const cy = 170 + r() * 80, dx = wallX + 28;
      lvl.fans = [
        { x: ux, y: uy, w: 90 + r() * 30, h: 600 - uy, forceX: 0, forceY: -(560 + r() * 100) },
        { x: ux, y: cy, w: wallX + 28 - ux, h: uy - cy + 40 + r() * 60, forceX: 150 + r() * 130, forceY: 0 },
        { x: dx, y: 130, w: 440 - dx, h: 410, forceX: 0, forceY: 480 + r() * 260 },
      ];
      lvl.goal = { x: Math.min(dx + 10 + r() * 40, 360), y: 544, w: 84, h: 56 };
      lvl.hazards = [{ x: 205, y: 576, w: 50, h: 24, label: 'SPILL' }];`,
    disable: `lvl.fans = [];`,
  },
  // 9. Switchboard: the tube is required.
  8: {
    mech: "whoop",
    gen: `
      const wallX = 190 + r() * 40, wallTop = 220 + r() * 150;
      lvl.solids = [${FLOOR}, { x: wallX, y: wallTop, w: 24, h: 600 - wallTop, type: 'cork' }];
      const ax = 130 + r() * 50, ay = 400 + r() * 120;
      const bx = 70 + r() * 80, by = 140 + r() * 120;
      lvl.tubes = [{ a: { x: ax, y: ay, dir: -90 + Math.round((r() - 0.5) * 60) }, b: { x: bx, y: by, dir: Math.round((r() - 0.5) * 70) } }];
      lvl.bumpers = [{ x: 280 + r() * 90, y: 110 + r() * 150, r: 22 + Math.floor(r() * 8) }];
      lvl.goal = { x: 345, y: 544, w: 84, h: 56 };
      lvl.hazards = [{ x: wallX + 40, y: 576, w: 70, h: 24, label: 'COFFEE' }];`,
    disable: `lvl.tubes = [];`,
  },
  // 10. The Boss's Desk: spring + updraft + bumper + one-way shelf; the spring is required.
  9: {
    mech: "boing",
    gen: `
      const sx = 170 + r() * 80, shelfY = 240 + r() * 90;
      lvl.solids = [${FLOOR}, { x: sx, y: 582, w: 64, h: 18, type: 'spring' },
        { x: 0, y: shelfY, w: 150, h: 14, type: 'shelf' },
        { x: 150 + r() * 20, y: shelfY - 150, w: 22, h: 164, type: 'glass' },
        { x: 330, y: 330 + r() * 80, w: 120, h: 20, type: 'desk' }];
      lvl.bumpers = [{ x: 230 + r() * 90, y: 360 + r() * 100, r: 22 + Math.floor(r() * 8) }];
      lvl.fans = [{ x: 20 + r() * 40, y: shelfY + 30, w: 100, h: 570 - shelfY, forceX: 0, forceY: -(600 + r() * 180) }];
      lvl.goal = { x: 30, y: shelfY - 56, w: 84, h: 56 };
      lvl.hazards = [{ x: 300, y: 576, w: 120, h: 24, label: 'COFFEE' }];`,
    disable: `lvl.solids = lvl.solids.filter(s => s.type !== 'spring');`,
  },
};

(async () => {
  const g = GEN[LEVEL];
  if (!g) { console.error("No generator for level " + (LEVEL + 1) + ". Add one to GEN in search-level.js."); process.exit(2); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/index.html`);
  await page.waitForTimeout(500);
  await page.evaluate((lv) => window.launchPaperAirplane({ level: lv }), LEVEL);
  await page.waitForFunction(() => { const gm = window.paperAirplaneGame; const sc = gm && gm.scene.getScene("PaperAirplaneScene"); return sc && sc.sys.isActive() && sc.levels; }, null, { timeout: 15000 });

  const out = await page.evaluate(({ LEVEL, TRIALS, SEED, g, WIN_MIN, WIN_MAX, MECH_SHARE, STUCK, ANG_STEP, PWS }) => {
    const sc = paperAirplaneGame.scene.getScene("PaperAirplaneScene");
    sc.drawDynamicFrame = () => {}; sc.noteToPlayer = () => {}; sc.spawnFx = () => {};
    sc.handleWin = function () { this.planeState = "WIN"; };
    let events = [];
    sc.playSound = (type, freq) => { events.push(type === "ting" && freq === 760 ? "bump" : type); };
    const base = JSON.parse(JSON.stringify(sc.levels[LEVEL]));
    const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rnd = mulberry(SEED);
    const gen = new Function("lvl", "r", g.gen), disable = new Function("lvl", g.disable);
    const angs = []; for (let a = 0; a < 360; a += ANG_STEP) angs.push(a);
    const pws = PWS;
    const sweep = (lvl) => {
      sc.levels[LEVEL] = lvl; sc.levelIndex = LEVEL;
      let wins = 0, withMech = 0, bad = 0, n = 0;
      for (const a of angs) for (const pw of pws) {
        sc.safePos.set(lvl.start.x, lvl.start.y); sc.resetToSafeSpot(); events = []; sc.lastEnd = null; n++;
        const r = (a * Math.PI) / 180;
        sc.launchPlane(new Phaser.Math.Vector2(Math.cos(r) * pw, Math.sin(r) * pw));
        for (let t = 0; t < 60 * 12 && sc.planeState === "FLYING"; t++) sc.update(t * 16.667, 16.667);
        if (sc.lastEnd === "stall" || sc.lastEnd === "timeout") bad++;
        if (sc.planeState === "WIN") { wins++; if (!g.mech || events.includes(g.mech)) withMech++; sc.planeState = "IDLE"; }
      }
      return { wins, withMech, bad, n };
    };
    const results = [];
    const why = { noWins: 0, tooManyWins: 0, mechNotUsed: 0, stuck: 0, winsWithoutMechanic: 0 };
    for (let i = 0; i < TRIALS; i++) {
      const lvl = JSON.parse(JSON.stringify(base)); gen(lvl, rnd);
      const w = sweep(lvl);
      if (w.wins < WIN_MIN) { why.noWins++; continue; }
      if (w.wins > WIN_MAX) { why.tooManyWins++; continue; }
      if (g.mech && w.withMech / w.wins < MECH_SHARE) { why.mechNotUsed++; continue; }
      if (w.bad / w.n > STUCK) { why.stuck++; continue; }
      const dis = JSON.parse(JSON.stringify(lvl)); disable(dis);
      const wo = sweep(dis);
      if (wo.wins > 0) { why.winsWithoutMechanic++; continue; }
      results.push({ score: w.wins, wins: w.wins, mechShare: w.withMech / w.wins, bad: w.bad, n: w.n, lvl: { goal: lvl.goal, solids: lvl.solids, fans: lvl.fans, bumpers: lvl.bumpers, tubes: lvl.tubes, hazards: lvl.hazards } });
    }
    sc.levels[LEVEL] = base;
    return { results, why };
  }, { LEVEL, TRIALS, SEED, g, WIN_MIN, WIN_MAX, MECH_SHARE, STUCK, ANG_STEP, PWS });

  console.log(`Level ${LEVEL + 1}: ${out.results.length} of ${TRIALS} sampled layouts qualify (wins ${WIN_MIN}-${WIN_MAX}, mechanic required). Rejections: ${JSON.stringify(out.why)}`);
  const list = out.results;
  list.sort((a, b) => Math.abs(a.wins - 12) - Math.abs(b.wins - 12)); // prefer a moderate window
  list.slice(0, TOP).forEach((r, i) => console.log(`\n#${i + 1}: ${r.wins} winning throws, ${(r.mechShare * 100).toFixed(0)}% use the mechanic, ${r.bad} stuck\n` + JSON.stringify(r.lvl)));
  await browser.close();
})();
