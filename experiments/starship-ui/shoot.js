// Regenerates shots/<skin>-<screen>.png (1280x720) with headless Chromium.
//   python3 -m http.server 8123   (from the repo root, in another shell)
//   node experiments/starship-ui/shoot.js [skin ...]      e.g. node shoot.js hologlass
// Uses the globally installed playwright (see CLAUDE.md); no npm install needed.
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright/index.js")); }

const BASE = process.env.BASE || "http://localhost:8123/experiments/starship-ui";
const skins = process.argv.slice(2).length ? process.argv.slice(2) : ["hologlass", "cartographer", "pixel"];
const screens = ["ship", "market", "explore"];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 762 } }); // 42px page bar + 16:9 stage
  page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("CONSOLE", m.text()));
  for (const skin of skins) {
    for (const screen of screens) {
      await page.goto(`${BASE}/${skin}/index.html#${screen}`);
      await page.waitForTimeout(700);
      const el = await page.$("#stage");
      const out = path.join(__dirname, "shots", `${skin}-${screen}.png`);
      await el.screenshot({ path: out });
      console.log("wrote", path.relative(process.cwd(), out));
    }
  }
  await browser.close();
})();
