#!/usr/bin/env node
/*
 * Paper Airplane aim-preview exactness check.
 *
 *   node experiments/paper-airplane/check-preview.js [--url http://localhost:8130]
 *
 * For every level and a grid of throws, compares the dots the aim preview would
 * draw (predictPath) with where the plane really is on the same steps of a real
 * flight. They must agree to well under a pixel; if this fails, a mechanic was
 * added to the flight without going through the shared helpers (applyForces,
 * contactAt, springKick, bumperBounce, tubeStep).
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright/index.js");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1]; };
const URL = arg("url", "http://localhost:8130");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${URL}/index.html`);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.launchPaperAirplane({ level: 0 }));
  await page.waitForFunction(() => { const g = window.paperAirplaneGame; const sc = g && g.scene.getScene("PaperAirplaneScene"); return sc && sc.sys.isActive() && sc.levels; }, null, { timeout: 15000 });

  const rows = await page.evaluate(() => {
    const sc = paperAirplaneGame.scene.getScene("PaperAirplaneScene");
    sc.drawDynamicFrame = () => {}; sc.noteToPlayer = () => {};
    let ev = []; sc.playSound = (type, freq) => { ev.push(type === "ting" && freq === 760 ? "bump" : type); };
    const out = [];
    for (let li = 0; li < sc.levels.length; li++) {
      sc.loadLevel(li);
      const st = sc.levels[li].start;
      let compared = 0, maxErr = 0, worst = null, throws = 0; const used = { boing: 0, bump: 0, whoop: 0 };
      for (let ang = 0; ang < 360; ang += 12) for (const pw of [30, 60, 90, 110]) {
        sc.safePos.set(st.x, st.y); sc.resetToSafeSpot();
        const r = (ang * Math.PI) / 180;
        const pull = new Phaser.Math.Vector2(Math.cos(r) * pw, Math.sin(r) * pw);
        const pred = sc.predictPath(pull);
        ev = []; sc.launchPlane(pull); throws++;
        const real = [];
        for (let t = 0; t < 60 && sc.planeState === "FLYING"; t++) {
          sc.update(t * 16.667, 16.667);
          if (t % 4 === 3 && sc.planeState === "FLYING") real.push({ x: sc.pos.x, y: sc.pos.y });
        }
        for (const k of Object.keys(used)) if (ev.includes(k)) used[k]++;
        const n = Math.min(real.length, pred.dots.length);
        for (let i = 0; i < n; i++) {
          const e = Math.hypot(real[i].x - pred.dots[i].x, real[i].y - pred.dots[i].y);
          compared++;
          if (e > maxErr) { maxErr = e; worst = { ang, pw, i }; }
        }
      }
      out.push({ index: li, name: sc.levels[li].name, throws, compared, maxErr, worst, used });
    }
    return out;
  });

  let failed = false;
  console.log("\n #  level                      throws  dots compared  max error (px)   flights using spring/bumper/tube");
  for (const r of rows) {
    const bad = r.maxErr > 0.01;
    if (bad) failed = true;
    console.log(String(r.index + 1).padStart(2) + "  " + r.name.padEnd(26).slice(0, 26) + String(r.throws).padStart(7) + String(r.compared).padStart(15) + r.maxErr.toExponential(2).padStart(16) + "   " + r.used.boing + "/" + r.used.bump + "/" + r.used.whoop + (bad ? "   <-- FAIL " + JSON.stringify(r.worst) : ""));
  }
  for (const e of errs) { failed = true; console.log("page error:", e); }
  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: ok (preview matches the real flight)");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
