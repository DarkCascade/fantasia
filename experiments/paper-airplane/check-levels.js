#!/usr/bin/env node
/*
 * Paper Airplane level checker.
 *
 *   node experiments/paper-airplane/check-levels.js [--url http://localhost:8130] [--level N] [--quick]
 *
 * Serve the repo first (e.g. `python3 -m http.server 8130`). Playwright is
 * imported from the global install (see CLAUDE.md). For every level it:
 *   1. lints the data against the phone ergonomics rules (static, in Node);
 *   2. runs the REAL game physics headless (playSound / drawing / handleWin
 *      stubbed) over a grid of launches to measure
 *        - the single-throw success rate,
 *        - the fewest throws that can win (BFS over resting spots, <= 3 throws),
 *        - flight durations, and how many flights hit the stall/timeout guards.
 * It prints a table, then FAIL / WARN lines, and exits 1 if anything FAILed.
 *
 * Thresholds live in LIMITS below; tune them as the game's feel evolves.
 */
const path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright/index.js");
const { W, H, LEVELS } = require(path.join(__dirname, "../../src/paper-airplane/levels.js"));

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const URL = arg("url", "http://localhost:8130");
const ONLY = arg("level", null) === null ? null : Number(arg("level")) - 1; // 1-based on the CLI
const QUICK = !!arg("quick", false);

const LIMITS = {
  minStartX: 105, // finger room to the left of the plane
  maxStartY: 620, // finger room below the plane
  hudBand: 90, // top px kept clear of level geometry
  minRate: 0.15, // % of grid launches that win in one throw (warn below)
  maxRate: 8, //  (warn above)
  maxFlight: 10, // must match MAX_FLIGHT_SECONDS in the game
};

// ---------- 1. static lint ----------
function lint(lvl, i) {
  const out = [];
  const rects = [
    ...lvl.solids.map((r) => ["solid", r]),
    ...lvl.fans.map((r) => ["fan", r]),
    ...lvl.hazards.map((r) => ["hazard", r]),
    ["goal", lvl.goal],
    ...(lvl.springs || []).map((r) => ["spring", r]),
    ...(lvl.oneWays || []).map((r) => ["oneWay", r]),
  ];
  if (lvl.start.x < LIMITS.minStartX) out.push(["FAIL", `start.x ${lvl.start.x} < ${LIMITS.minStartX}: finger runs off the left edge when pulling back`]);
  if (lvl.start.y > LIMITS.maxStartY) out.push(["FAIL", `start.y ${lvl.start.y} > ${LIMITS.maxStartY}: finger runs off the bottom when pulling down`]);
  for (const [kind, r] of rects) {
    if (r.y < LIMITS.hudBand && !(kind === "solid" && r.y + r.h < 0)) out.push(["WARN", `${kind} at y=${r.y} intrudes into the HUD band (y<${LIMITS.hudBand})`]);
    if (r.x < 0 || r.y < 0 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) out.push(["WARN", `${kind} {${r.x},${r.y},${r.w},${r.h}} extends past the ${W}x${H} sheet`]);
  }
  for (const b of lvl.bumpers || []) {
    if (b.y - b.r < LIMITS.hudBand) out.push(["WARN", `bumper at y=${b.y} intrudes into the HUD band`]);
    if (b.x - b.r < 0 || b.x + b.r > W || b.y + b.r > H) out.push(["WARN", `bumper at (${b.x},${b.y}) extends past the sheet`]);
  }
  for (const t of lvl.tubes || []) {
    for (const [name, m] of [["a", t.a], ["b", t.b]]) {
      if (m.y - 26 < LIMITS.hudBand) out.push(["WARN", `tube mouth ${name} at y=${m.y} (with its arrow) intrudes into the HUD band`]);
      if (m.x - 26 < 0 || m.x + 26 > W || m.y + 26 > H) out.push(["WARN", `tube mouth ${name} at (${m.x},${m.y}) is too close to the sheet edge`]);
    }
  }
  return out;
}

// ---------- 2. in-page sweep ----------
async function sweep(page, levelCount) {
  return page.evaluate(
    ({ QUICK, LIMITS, only }) => {
      const sc = paperAirplaneGame.scene.getScene("PaperAirplaneScene");
      sc.drawDynamicFrame = () => {};
      sc.playSound = () => {};
      sc.noteToPlayer = () => {};
      sc.handleWin = function () { this.planeState = "WIN"; };
      const CAP = 60 * 120; // 120 s, far past the 10 s guard
      const angStep = QUICK ? 4 : 2;
      const pws = []; for (let p = 20; p <= 110; p += QUICK ? 10 : 5) pws.push(p);

      const fly = (from, ang, pw) => {
        sc.safePos.set(from.x, from.y); sc.resetToSafeSpot();
        sc.lastEnd = null;
        const r = (ang * Math.PI) / 180;
        sc.launchPlane(new Phaser.Math.Vector2(Math.cos(r) * pw, Math.sin(r) * pw));
        let t = 0;
        for (; t < CAP && sc.planeState === "FLYING"; t++) sc.update(t * 16.667, 16.667);
        const res = { t: t / 60, state: sc.planeState, won: sc.planeState === "WIN", end: sc.lastEnd };
        if (sc.planeState === "WIN") sc.planeState = "IDLE";
        return res;
      };

      const out = [];
      for (let li = 0; li < sc.levels.length; li++) {
        if (only !== null && li !== only) continue;
        sc.loadLevel(li);
        const start = { x: sc.levels[li].start.x, y: sc.levels[li].start.y };
        // single-throw grid: rate + durations + guard counts
        let n = 0, wins = 0, neverEnded = 0, stalls = 0, timeouts = 0; const durs = [];
        for (let ang = 0; ang < 360; ang += angStep) for (const pw of pws) {
          n++;
          const r = fly(start, ang, pw);
          if (r.state === "FLYING") { neverEnded++; continue; }
          durs.push(r.t);
          if (r.end === "stall") stalls++;
          if (r.end === "timeout") timeouts++;
          if (r.won) wins++;
        }
        durs.sort((a, b) => a - b);
        const q = (p) => (durs.length ? durs[Math.floor(p * (durs.length - 1))] : 0);

        // fewest throws: BFS over resting spots, coarse grid, depth <= 3
        let minThrows = wins > 0 ? 1 : null; const seen = new Set([Math.round(start.x / 15) + "," + Math.round(start.y / 15)]);
        let frontier = [start];
        for (let depth = 1; depth <= 3 && minThrows === null; depth++) { // (skipped when the fine sweep above already won)
          const next = [];
          for (const st of frontier) {
            for (let ang = 0; ang < 360; ang += 4) for (const pw of [40, 70, 90, 110]) {
              sc.safePos.set(st.x, st.y); sc.resetToSafeSpot();
              const r = (ang * Math.PI) / 180;
              sc.launchPlane(new Phaser.Math.Vector2(Math.cos(r) * pw, Math.sin(r) * pw));
              for (let t = 0; t < 60 * 15 && sc.planeState === "FLYING"; t++) sc.update(t * 16.667, 16.667);
              if (sc.planeState === "WIN") { if (minThrows === null) minThrows = depth; sc.planeState = "IDLE"; continue; }
              const k = Math.round(sc.safePos.x / 15) + "," + Math.round(sc.safePos.y / 15);
              if (sc.planeState === "IDLE" && !seen.has(k) && (sc.safePos.x !== st.x || sc.safePos.y !== st.y)) { seen.add(k); next.push({ x: sc.safePos.x, y: sc.safePos.y }); }
            }
          }
          frontier = next;
        }
        out.push({
          index: li, name: sc.levels[li].name, par: sc.levels[li].par, launches: n,
          ratePct: (100 * wins) / n, minThrows,
          p50: q(0.5), p90: q(0.9), max: durs.length ? durs[durs.length - 1] : 0,
          neverEnded, stalls, timeouts,
        });
      }
      return out;
    },
    { QUICK, LIMITS, only: ONLY }
  );
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${URL}/index.html`);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.launchPaperAirplane({ level: 0 }));
  await page.waitForFunction(() => {
    const g = window.paperAirplaneGame;
    const sc = g && g.scene.getScene("PaperAirplaneScene");
    return sc && sc.sys.isActive() && sc.levels;
  }, null, { timeout: 15000 });

  const rows = await sweep(page);
  let failed = false;
  console.log("\n #  level                      par  min  1-throw%  p50s  p90s  maxs  stall  tmout  stuck");
  for (const r of rows) {
    console.log(
      String(r.index + 1).padStart(2) + "  " + r.name.padEnd(26).slice(0, 26) +
      String(r.par).padStart(4) + String(r.minThrows === null ? "?" : r.minThrows).padStart(5) +
      r.ratePct.toFixed(2).padStart(10) + r.p50.toFixed(1).padStart(6) + r.p90.toFixed(1).padStart(6) +
      r.max.toFixed(1).padStart(6) + String(r.stalls).padStart(7) + String(r.timeouts).padStart(7) + String(r.neverEnded).padStart(7)
    );
  }
  console.log();
  const report = (lvl, kind, msg) => { if (kind === "FAIL") failed = true; console.log(`${kind}  L${lvl + 1}: ${msg}`); };
  LEVELS.forEach((lvl, i) => { if (ONLY === null || ONLY === i) lint(lvl, i).forEach(([k, m]) => report(i, k, m)); });
  for (const r of rows) {
    if (r.minThrows === null) report(r.index, "FAIL", "no winning sequence found within 3 throws (unsolvable, or the search grid is too coarse)");
    if (r.neverEnded > 0) report(r.index, "FAIL", `${r.neverEnded} flights never ended (guards missing/broken)`);
    if (r.max > LIMITS.maxFlight + 0.2) report(r.index, "FAIL", `a flight lasted ${r.max.toFixed(1)}s (> ${LIMITS.maxFlight}s cap)`);
    if (r.minThrows === 1 && r.ratePct < LIMITS.minRate) report(r.index, "WARN", `single-throw success ${r.ratePct.toFixed(2)}% is very low (< ${LIMITS.minRate}%): maybe too fiddly (a 1-throw solution exists but the window is tiny)`);
    if (r.ratePct > LIMITS.maxRate) report(r.index, "WARN", `single-throw success ${r.ratePct.toFixed(2)}% is high (> ${LIMITS.maxRate}%): maybe too easy`);
    if (r.minThrows !== null && r.par < r.minThrows) report(r.index, "WARN", `par ${r.par} is below the minimum ${r.minThrows}`);
    if (r.minThrows !== null && r.par > r.minThrows + 3) report(r.index, "WARN", `par ${r.par} is generous (minimum ${r.minThrows})`);
  }
  for (const e of pageErrors) report(0, "FAIL", "page error: " + e);
  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: ok");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
