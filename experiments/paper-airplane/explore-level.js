#!/usr/bin/env node
/*
 * Paper Airplane near-miss explorer (a level-design aid).
 *
 *   node experiments/paper-airplane/explore-level.js --level N [--url http://localhost:8130] [--top 10]
 *
 * Sweeps single throws on a level and lists the throws that came closest to the
 * bin (and any that won), with the mechanics each one touched (spring boing,
 * bumper ting, tube whoop, thud/ting bounces, splash, crumple). Use it to see
 * which way to nudge geometry so near-misses become hits.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright/index.js");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1]; };
const URL = arg("url", "http://localhost:8130");
const LEVEL = Number(arg("level", 1)) - 1;
const TOP = Number(arg("top", 10));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/index.html`);
  await page.waitForTimeout(500);
  await page.evaluate((lv) => window.launchPaperAirplane({ level: lv }), LEVEL);
  await page.waitForFunction(() => { const g = window.paperAirplaneGame; const sc = g && g.scene.getScene("PaperAirplaneScene"); return sc && sc.sys.isActive() && sc.levels; }, null, { timeout: 15000 });
  const res = await page.evaluate(({ LEVEL, TOP }) => {
    const sc = paperAirplaneGame.scene.getScene("PaperAirplaneScene");
    sc.drawDynamicFrame = () => {}; sc.noteToPlayer = () => {};
    sc.handleWin = function () { this.planeState = "WIN"; };
    let events = [];
    sc.playSound = (type) => { events.push(type); };
    sc.loadLevel(LEVEL);
    const lvl = sc.levels[LEVEL], st = lvl.start, g = lvl.goal, gc = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
    const rows = [];
    for (let ang = 0; ang < 360; ang += 2) for (let pw = 20; pw <= 110; pw += 5) {
      sc.safePos.set(st.x, st.y); sc.resetToSafeSpot(); events = []; sc.lastEnd = null;
      const r = (ang * Math.PI) / 180;
      sc.launchPlane(new Phaser.Math.Vector2(Math.cos(r) * pw, Math.sin(r) * pw));
      let minD = 1e9, apex = 1e9, apexX = 0;
      for (let t = 0; t < 60 * 12 && sc.planeState === "FLYING"; t++) {
        sc.update(t * 16.667, 16.667);
        const d = Math.hypot(sc.pos.x - gc.x, sc.pos.y - gc.y);
        if (d < minD) minD = d;
        if (sc.pos.y < apex) { apex = sc.pos.y; apexX = sc.pos.x; }
      }
      const won = sc.planeState === "WIN";
      const ev = events.filter((e) => e !== "whoosh").join(",");
      rows.push({ ang, pw, won, minD: Math.round(minD), apex: Math.round(apex), apexX: Math.round(apexX), end: won ? "WIN" : sc.lastEnd || "rest@" + Math.round(sc.safePos.x) + "," + Math.round(sc.safePos.y), ev });
      if (won) sc.planeState = "IDLE";
    }
    rows.sort((a, b) => Number(b.won) - Number(a.won) || a.minD - b.minD);
    const sig = {}; rows.forEach((r) => { const k = r.ev.split(",").filter((e) => ["boing", "ting", "whoop"].includes(e)).join(","); sig[k] = (sig[k] || 0) + 1; });
    return { wins: rows.filter((r) => r.won).length, total: rows.length, goal: gc, top: rows.slice(0, TOP), signatures: sig };
  }, { LEVEL, TOP });
  console.log(`Level ${LEVEL + 1}: ${res.wins}/${res.total} throws win. Goal centre (${res.goal.x}, ${res.goal.y}).`);
  console.log("Mechanic mix across all throws:", JSON.stringify(res.signatures));
  console.log("\n ang  pw  won  minDist  apex(y@x)     ends        events");
  res.top.forEach((r) => console.log(String(r.ang).padStart(4) + String(r.pw).padStart(4) + (r.won ? "  YES" : "   no") + String(r.minD).padStart(8) + ("  " + r.apex + "@" + r.apexX).padEnd(14) + r.end.padEnd(12) + r.ev));
  await browser.close();
})();
