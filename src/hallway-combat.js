/*
 * Hall of Blows — a diorama-style action RPG, now a roguelike deck-builder.
 *
 * A knight walks an endless torch-lit hallway and trades in-place swings with
 * whatever he meets. The player never steers him: three room cards are always
 * on offer, and the one you pick appears straight ahead of him. Risky rooms pay
 * more points and add better cards to your deck; if Sir Cleave falls, the run
 * is over. (The sim's classic orc-after-orc loop still exists; this view runs
 * the sim in deck mode.)
 *
 * The rules live in src/hallway-combat/sim.js (pure, unit-tested). This file
 * is the view: three.js imported on demand (like Slopeman / Gloom Hollow 3D)
 * with a DOM HUD laid over it.
 *
 * Diorama look: the hallway is a cutaway slab — a thick stone floor with a
 * brick front edge, a back wall, no ceiling and no front wall — sitting on a
 * dark tabletop under a 3/4 camera, so the hallway recedes to the right where
 * the orc appears. The knight never moves in x: the sim scrolls the world past
 * him, and the floor/wall textures and the recycled props (pillars, torches,
 * banners, beams) are all driven by `world.scroll`.
 *
 * PLACEHOLDER ART: every fighter is built from boxes/spheres/cones in
 * `buildKnight()` / `buildOrc()` behind one small rig interface
 * (root, body, legs[2], armW, armO, mats[]), so swapping in Kenney models
 * later means producing the same handful of pivots — the animation in
 * `pose()` only touches those.
 *
 * Created on demand via window.launchHallwayCombat() so the menu stays first.
 */
(function () {
  "use strict";

  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function resolve(rel) {
    return new URL(rel, SELF_SRC || window.location.href).href;
  }
  var THREE_URL = resolve("../vendor/three.module.min.js");
  var THREE = null;

  const Sim = window.HallwayCombatSim;
  const BEST_KEY = "hall-of-blows-deck-best"; // best score (the old key counted kills)
  const STEP = 1 / 60;

  /* ---------- layout / look ---------- */

  const HALL_LEN = 52; // the slab is far longer than any screen shows
  const HALL_D = 4.8; // floor depth (z): back wall at -D/2, front edge at +D/2
  const WALL_H = 4.2;
  const SLAB_H = 0.9;
  const PERIOD = 6; // prop spacing along the hallway (also the texture tile width)
  const WRAP = PERIOD * 8; // props recycle inside a 48-unit window
  const FIGHT_Z = 0.1;
  const CAM_AZIMUTH_DEG = 42; // camera yaw off the front-on view; 0 = side-on, 90 = straight down the hall
  const WALK_CYCLE = 8; // leg-swing rad/sec while walking
  const REST_ARM = 0.45; // weapon arm resting angle (rad about z, 0 = hanging down)

  /* ---------- HUD ---------- */

  const CSS = `
#hc-root { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none;
  background: radial-gradient(ellipse at 50% 38%, #34304d 0%, #1a1626 55%, #0d0a14 100%); }
#hc-root canvas { display: block; }
#hc-root, #hc-root * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.hc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 20px; color: #d9cfee; }
.hc-hud { position: absolute; inset: 0; pointer-events: none; }
.hc-vignette { position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%); }
.hc-stats { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); text-align: center;
  color: #fff; text-shadow: 0 2px 0 rgba(10,6,20,0.7), 0 3px 12px rgba(0,0,0,0.5); }
.hc-title { font-size: 13px; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: #f0c987; }
.hc-count { font-size: clamp(26px, 6vw, 38px); font-weight: 800; line-height: 1.1; }
.hc-count small { display: block; font-size: 13px; font-weight: 600; opacity: 0.8; letter-spacing: 0.04em; }
.hc-menu { position: absolute; top: 14px; right: 14px; pointer-events: auto; cursor: pointer;
  padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.28);
  background: rgba(20,14,34,0.62); color: #fff; font-size: 14px; font-weight: 700; letter-spacing: 0.03em; }
.hc-menu:hover { background: rgba(60,40,96,0.8); }
.hc-overlay { position: absolute; inset: 0; overflow: hidden; }
.hc-bar { position: absolute; left: 0; top: 0; width: 120px; transform: translate(-50%, -100%);
  text-align: center; will-change: transform, opacity; }
.hc-bar-name { font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 0.06em; text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.6); margin-bottom: 3px; }
.hc-bar-track { height: 9px; border-radius: 5px; background: rgba(8,5,16,0.78); border: 1px solid rgba(255,255,255,0.35);
  overflow: hidden; }
.hc-bar-fill { height: 100%; width: 100%; transition: width 0.18s ease-out; }
.hc-bar--knight .hc-bar-fill { background: linear-gradient(#7fe08a, #2fa84a); }
.hc-bar--orc .hc-bar-fill { background: linear-gradient(#ff8a7a, #d23a2e); }
.hc-dmg { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); font-weight: 900;
  font-size: 30px; letter-spacing: 0.02em; white-space: nowrap;
  -webkit-text-stroke: 4px rgba(20,8,30,0.9); paint-order: stroke fill;
  text-shadow: 0 3px 10px rgba(0,0,0,0.5); animation: hc-float 1s ease-out forwards; }
.hc-dmg--orc { color: #ffd45e; }
.hc-dmg--knight { color: #ff5d5d; font-size: 26px; }
.hc-dmg--heal { color: #6ff08b; font-size: 22px; }
@keyframes hc-float {
  0%   { opacity: 0; margin-top: 8px; scale: 0.4; }
  12%  { opacity: 1; margin-top: -6px; scale: 1.25; }
  30%  { scale: 1; }
  100% { opacity: 0; margin-top: -78px; scale: 0.95; }
}
.hc-fatal { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }
.hc-fatal-card { max-width: 340px; text-align: center; color: #fff; background: rgba(20,14,34,0.9);
  border: 1px solid rgba(255,255,255,0.25); border-radius: 16px; padding: 22px; }
.hc-fatal-card h2 { font-size: 20px; margin-bottom: 8px; }
.hc-fatal-card p { opacity: 0.85; font-size: 15px; margin-bottom: 16px; }
.hc-fatal-card button { padding: 9px 18px; border-radius: 999px; border: 0; cursor: pointer; font-weight: 700;
  font-size: 15px; background: #f0c987; color: #2a1608; }
@media (max-width: 600px) {
  .hc-bar { width: 84px; }
  .hc-bar-name { font-size: 10px; }
  .hc-dmg { font-size: 24px; }
  .hc-dmg--knight { font-size: 21px; }
}
.hc-dmg--score { color: #ffd45e; font-size: 24px; }
.hc-dmg--boon { color: #8fd4ff; font-size: 22px; }
.hc-sub { font-size: 13px; font-weight: 600; opacity: 0.8; letter-spacing: 0.04em; }
.hc-tray { position: absolute; left: 0; right: 0; bottom: max(10px, env(safe-area-inset-bottom)); display: flex;
  flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
.hc-cards { display: flex; gap: 10px; justify-content: center; pointer-events: auto; }
.hc-card { position: relative; width: min(31vw, 134px); padding: 22px 6px 9px; border-radius: 14px; cursor: pointer;
  border: 2px solid #6b5c85; background: linear-gradient(#3b3252, #241d34); color: #fff; text-align: center;
  font: inherit; box-shadow: 0 8px 20px rgba(0,0,0,0.45); animation: hc-deal 0.3s ease-out backwards;
  transition: transform 0.12s, border-color 0.12s; touch-action: manipulation; }
.hc-card:hover, .hc-card:focus-visible { transform: translateY(-7px); border-color: #f0c987; outline: none; }
.hc-card:active { transform: translateY(-2px) scale(0.98); }
.hc-card[data-kind="foe"] { border-color: #6f9a5f; }
.hc-card[data-kind="rest"] { border-color: #4fb98a; }
.hc-card[data-kind="boon"] { border-color: #5aa0d8; }
.hc-card .k { position: absolute; top: 5px; left: 9px; font-size: 11px; font-weight: 800; opacity: 0.5; }
.hc-card .ico { width: 46px; height: 46px; margin: 0 auto 2px; display: block; }
.hc-card .n { font-size: 13px; font-weight: 800; letter-spacing: 0.03em; line-height: 1.1; }
.hc-card .d { display: flex; justify-content: center; gap: 3px; margin: 5px 0 4px; height: 8px; }
.hc-pip { width: 8px; height: 8px; border-radius: 50%; background: #ff5d5d; box-shadow: 0 0 6px rgba(255,93,93,0.7); }
.hc-pip.off { background: #4a4258; box-shadow: none; }
.hc-card .r { font-size: 14px; font-weight: 900; color: #ffd45e; }
.hc-card .r.safe { color: #7fe8b0; font-size: 12.5px; }
.hc-card .x { font-size: 11px; font-weight: 700; color: #b9a8d8; }
.hc-card .b { font-size: 10.5px; opacity: 0.7; line-height: 1.2; margin-top: 3px; }
@keyframes hc-deal { from { opacity: 0; transform: translateY(26px) rotate(-3deg); } }
.hc-ico--frenzied { filter: hue-rotate(-95deg) saturate(1.7); }
.hc-timer { width: min(94vw, 410px); height: 5px; border-radius: 3px; background: rgba(8,5,16,0.7); overflow: hidden; }
.hc-timer i { display: block; height: 100%; width: 100%; background: linear-gradient(#ffd98f, #f0b04f); }
.hc-next { display: none; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; font-size: 14px;
  font-weight: 700; background: rgba(20,14,34,0.74); border: 1px solid rgba(255,255,255,0.28); color: #fff;
  animation: hc-deal 0.25s ease-out; }
.hc-next svg { width: 24px; height: 24px; }
.hc-toast { position: absolute; left: 50%; bottom: 220px; transform: translateX(-50%); white-space: nowrap; font-weight: 800;
  font-size: 15px; color: #fff; padding: 6px 14px; border-radius: 999px; background: rgba(60,36,100,0.85);
  border: 1px solid #b9a8d8; animation: hc-toast 2.2s ease-out forwards; }
@keyframes hc-toast { 0% { opacity: 0; margin-bottom: -10px; } 12% { opacity: 1; margin-bottom: 0; }
  80% { opacity: 1; } 100% { opacity: 0; margin-bottom: 26px; } }
.hc-over { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(8,4,16,0.6); pointer-events: auto; animation: hc-fade 0.5s ease-out; }
.hc-over[hidden] { display: none; }
@keyframes hc-fade { from { opacity: 0; } }
.hc-over-card { width: min(92vw, 340px); text-align: center; color: #fff; padding: 22px 20px 20px; border-radius: 18px;
  background: linear-gradient(#352d4a, #1d1729); border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
.hc-over-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: #f0c987; }
.hc-over-card h2 { margin: 4px 0 6px; font-size: 24px; }
.hc-over-card p { margin: 0 0 12px; font-size: 14px; opacity: 0.8; }
.hc-over-stats { display: flex; justify-content: center; gap: 22px; margin-bottom: 8px; }
.hc-over-stats div { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.85; }
.hc-over-stats b { display: block; font-size: 24px; letter-spacing: 0; }
.hc-over-best { min-height: 20px; font-size: 14px; font-weight: 800; color: #ffd45e; margin-bottom: 12px; }
.hc-btn { padding: 10px 18px; border-radius: 999px; border: 0; cursor: pointer; font: inherit; font-weight: 800; font-size: 15px;
  background: #f0c987; color: #2a1608; margin: 0 4px; }
.hc-btn--ghost { background: rgba(255,255,255,0.14); color: #fff; }
@media (max-width: 600px) { .hc-card .b { display: none; } .hc-card { padding-top: 20px; } .hc-toast { bottom: 190px; font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { .hc-dmg { animation-duration: 1.4s; } .hc-card, .hc-next { animation: none; } }
`;

  // room-card art, drawn in code (shared by the tray and the "next room" chip)
  const HUD_ICONS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="hc-i-orc" viewBox="0 0 48 48"><path d="M9 21 L1 11 L15 16Z M39 21 L47 11 L33 16Z" fill="#558f45"/>' +
    '<ellipse cx="24" cy="26" rx="14.5" ry="15.5" fill="#6fae5a"/><path d="M11 21 Q24 13 37 21 L37 24.5 Q24 18 11 24.5Z" fill="#3f6b33"/>' +
    '<circle cx="18" cy="25" r="2.4" fill="#ffe27a"/><circle cx="30" cy="25" r="2.4" fill="#ffe27a"/>' +
    '<circle cx="18" cy="25" r="1" fill="#2a1608"/><circle cx="30" cy="25" r="1" fill="#2a1608"/>' +
    '<path d="M16 35 Q24 39 32 35" stroke="#2d4a24" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M17.5 35.5 L15.5 42 L21 36.5Z M30.5 35.5 L32.5 42 L27 36.5Z" fill="#f4ecd8"/></symbol>' +
    '<symbol id="hc-i-brute" viewBox="0 0 48 48"><path d="M7 19 L1 5 L17 13Z M41 19 L47 5 L31 13Z" fill="#eadfc4"/>' +
    '<ellipse cx="24" cy="27" rx="18" ry="17" fill="#8c6a4a"/><path d="M6 24 Q24 4 42 24 L42 19 Q24 -1 6 19Z" fill="#59595f"/>' +
    '<path d="M9 22 Q24 11 39 22 L39 27 Q24 17 9 27Z" fill="#3d2a1c"/>' +
    '<circle cx="17.5" cy="27" r="2.6" fill="#ff7a5c"/><circle cx="30.5" cy="27" r="2.6" fill="#ff7a5c"/>' +
    '<path d="M14 20 L21 24 M34 20 L27 24" stroke="#1c120a" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M15 37 Q24 42 33 37" stroke="#2a1a10" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M17 37.5 L15 44 L21 39Z M31 37.5 L33 44 L27 39Z" fill="#f4ecd8"/></symbol>' +
    '<symbol id="hc-i-warchief" viewBox="0 0 48 48"><use href="#hc-i-brute"/>' +
    '<path d="M13 13 L14 3 L19 9 L24 1 L29 9 L34 3 L35 13Z" fill="#f2c14e" stroke="#a8761f" stroke-width="1"/></symbol>' +
    '<symbol id="hc-i-shrine" viewBox="0 0 48 48"><path d="M7 44 V24 Q7 5 24 5 Q41 5 41 24 V44Z" fill="#4d4560"/>' +
    '<path d="M14 44 V25 Q14 14 24 14 Q34 14 34 25 V44Z" fill="#1b1625"/><circle cx="24" cy="32" r="11" fill="#6ff08b" opacity=".22"/>' +
    '<path d="M24 41 C16 35 19 28 24 21 C29 28 32 35 24 41Z" fill="#7ff0b8"/>' +
    '<path d="M24 38 C20 34 22 30 24 27 C26 30 28 34 24 38Z" fill="#e8fff2"/></symbol>' +
    '<symbol id="hc-i-whet" viewBox="0 0 48 48"><path d="M5 31 L33 17 L43 23 L15 38Z" fill="#7b7989"/>' +
    '<path d="M5 31 L33 17 L36 19 L8 33Z" fill="#b9b7c6"/><path d="M15 38 L43 23 L43 27 L15 42Z" fill="#5d5b6b"/>' +
    '<path d="M36 4 l2.2 5.6 5.6 2.2 -5.6 2.2 -2.2 5.6 -2.2 -5.6 -5.6 -2.2 5.6 -2.2z" fill="#ffd45e"/></symbol>' +
    "</svg>";

  const HUD_HTML =
    '<div class="hc-hud">' +
    HUD_ICONS +
    '<div class="hc-vignette"></div>' +
    '<div class="hc-overlay" data-hc="overlay"></div>' +
    '<div class="hc-stats"><div class="hc-title">Hall of Blows</div>' +
    '<div class="hc-count"><span data-hc="score">0</span><small>room <span data-hc="rooms">0</span> &middot; deck <span data-hc="deck">0</span> &middot; best <span data-hc="best">0</span></small></div></div>' +
    '<button class="hc-menu" type="button" data-hc="menu">&#8801; Menu</button>' +
    '<div class="hc-tray"><div class="hc-cards" data-hc="cards"></div>' +
    '<div class="hc-timer" data-hc="timerWrap"><i data-hc="timer"></i></div><div class="hc-next" data-hc="next"></div></div>' +
    '<div class="hc-over" data-hc="over" hidden><div class="hc-over-card">' +
    '<div class="hc-over-eyebrow">The run is over</div><h2>Sir Cleave has fallen</h2><p data-hc="oLine"></p>' +
    '<div class="hc-over-stats"><div>Score<b data-hc="oScore">0</b></div><div>Rooms<b data-hc="oRooms">0</b></div><div>Deck<b data-hc="oDeck">0</b></div></div>' +
    '<div class="hc-over-best" data-hc="oBest"></div>' +
    '<button class="hc-btn" type="button" data-hc="again">Descend again</button>' +
    '<button class="hc-btn hc-btn--ghost" type="button" data-hc="menu2">Menu</button></div></div>' +
    "</div>";

  function readBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function writeBest(n) {
    try {
      localStorage.setItem(BEST_KEY, String(n));
    } catch (e) {
      /* storage may be unavailable; ignore */
    }
  }

  function showFatalError(root, message) {
    root.innerHTML =
      '<div class="hc-fatal"><div class="hc-fatal-card"><h2>The hall is dark</h2><p>' +
      message +
      '</p><button type="button" data-hc-fatal-menu>Menu</button></div></div>';
    const btn = root.querySelector("[data-hc-fatal-menu]");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }
  }

  /* ---------- small helpers ---------- */

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeIn = (t) => t * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const wrap = (v, len) => ((((v + len / 2) % len) + len) % len) - len / 2;

  function lcg(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------- procedural textures (canvas) ---------- */

  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // Running-bond block pattern that tiles seamlessly in x (rows wrap).
  function drawBlocks(g, w, h, rows, cols, base, mortar, seed, jitter) {
    const rnd = lcg(seed);
    const bh = h / rows;
    const bw = w / cols;
    g.fillStyle = mortar;
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c < cols + 1; c++) {
        const x = c * bw + off;
        const v = (rnd() - 0.5) * jitter;
        const col = base.map((ch) => Math.max(0, Math.min(255, Math.round(ch + v))));
        g.fillStyle = "rgb(" + col.join(",") + ")";
        g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
        // top-left bevel highlight, bottom-right shade
        g.fillStyle = "rgba(255,255,255,0.07)";
        g.fillRect(x + 2, r * bh + 2, bw - 4, 3);
        g.fillStyle = "rgba(0,0,0,0.16)";
        g.fillRect(x + 2, r * bh + bh - 6, bw - 4, 4);
      }
    }
    for (let i = 0; i < w * h * 0.012; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  }

  function makeFloorTexture() {
    return canvasTexture(640, 512, (g, w, h) => {
      drawBlocks(g, w, h, 4, 4, [118, 112, 128], "#2b2736", 11, 26);
      // red runner down the middle, gold-edged, with diamonds every 160px
      const y0 = 150;
      const y1 = 362;
      g.fillStyle = "#8c1f2c";
      g.fillRect(0, y0, w, y1 - y0);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(0, y0, w, 8);
      g.fillRect(0, y1 - 8, w, 8);
      g.fillStyle = "#e4b84f";
      g.fillRect(0, y0 + 12, w, 5);
      g.fillRect(0, y1 - 17, w, 5);
      g.fillStyle = "#c28a2b";
      g.fillRect(0, y0 + 24, w, 2);
      g.fillRect(0, y1 - 26, w, 2);
      for (let x = 80; x < w; x += 160) {
        g.fillStyle = "#e4b84f";
        g.beginPath();
        g.moveTo(x, 256 - 52);
        g.lineTo(x + 36, 256);
        g.lineTo(x, 256 + 52);
        g.lineTo(x - 36, 256);
        g.closePath();
        g.fill();
        g.fillStyle = "#6b1420";
        g.beginPath();
        g.moveTo(x, 256 - 30);
        g.lineTo(x + 20, 256);
        g.lineTo(x, 256 + 30);
        g.lineTo(x - 20, 256);
        g.closePath();
        g.fill();
      }
    });
  }

  function makeWallTexture() {
    return canvasTexture(768, 540, (g, w, h) => {
      drawBlocks(g, w, h, 14, 8, [86, 80, 104], "#25222f", 23, 22);
      // torchlight pools low, the cut top falls into shadow
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(10,6,20,0.55)");
      grad.addColorStop(0.55, "rgba(10,6,20,0)");
      grad.addColorStop(1, "rgba(255,150,60,0.10)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }

  function makeGlowTexture(inner, outer) {
    return canvasTexture(128, 128, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, inner);
      grad.addColorStop(1, outer);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }

  /* ---------- placeholder fighters ---------- */

  function stdMat(mats, color, opts) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.78, metalness: 0.04 }, opts || {}));
    m.userData.baseEmissive = m.emissive.clone(); // hit-flash adds to this
    mats.push(m);
    return m;
  }

  function addMesh(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    parent.add(m);
    return m;
  }

  function boxAt(parent, mats, w, h, d, color, x, y, z, opts) {
    return addMesh(parent, new THREE.BoxGeometry(w, h, d), stdMat(mats, color, opts), x, y, z);
  }

  function ballAt(parent, mats, r, color, x, y, z, opts) {
    return addMesh(parent, new THREE.SphereGeometry(r, 14, 10), stdMat(mats, color, opts), x, y, z);
  }

  function pivot(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  // Local frame for every fighter: +x is the way it faces, +y up, z toward
  // the camera for armSide = +1. `root` is yawed by the caller so the orc
  // faces -x; it carries the weapon arm on local -z so that after the yaw
  // the weapon is on the camera's side and the swing reads.
  function newRig(armSide) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    return {
      root: root,
      body: body,
      mats: [],
      legs: [],
      armW: null,
      armO: null,
      side: armSide,
      wp: 0, // walk phase
      legAmp: 0,
      flash: 0,
      recoil: 0,
      seed: Math.random() * 6.28,
      cape: null,
    };
  }

  function buildKnight() {
    const r = newRig(1);
    const M = r.mats;
    const steel = 0x7f93ad;
    const dark = 0x2a2d38;
    const red = 0xc0392b;
    const gold = 0xf2c14e;
    const B = r.body;

    for (const z of [-0.17, 0.17]) {
      const leg = pivot(B, 0, 0.72, z);
      boxAt(leg, M, 0.24, 0.72, 0.24, steel, 0, -0.36, 0);
      boxAt(leg, M, 0.38, 0.18, 0.3, dark, 0.07, -0.66, 0);
      r.legs.push(leg);
    }
    boxAt(B, M, 0.5, 0.72, 0.78, steel, 0, 1.08, 0); // torso
    boxAt(B, M, 0.52, 0.1, 0.8, 0x6b4a2b, 0, 0.78, 0); // belt
    boxAt(B, M, 0.05, 0.52, 0.5, red, 0.27, 1.04, 0); // tabard
    boxAt(B, M, 0.06, 0.16, 0.16, gold, 0.3, 1.1, 0); // emblem
    ballAt(B, M, 0.2, steel, 0, 1.4, 0.5);
    ballAt(B, M, 0.2, steel, 0, 1.4, -0.5);

    r.capeP = pivot(B, -0.26, 1.42, 0);
    boxAt(r.capeP, M, 0.06, 0.95, 0.72, red, 0, -0.48, 0);

    const head = pivot(B, 0, 1.82, 0);
    ballAt(head, M, 0.36, steel, 0, 0, 0);
    boxAt(head, M, 0.06, 0.07, 0.42, dark, 0.33, 0.02, 0); // visor slit
    boxAt(head, M, 0.1, 0.34, 0.12, red, -0.1, 0.46, 0).rotation.z = 0.55; // plume
    r.head = head;

    // weapon arm (camera side) with sword; off arm just hangs
    r.armW = pivot(B, 0, 1.4, 0.5 * r.side);
    boxAt(r.armW, M, 0.18, 0.5, 0.18, steel, 0, -0.25, 0);
    ballAt(r.armW, M, 0.12, gold, 0, -0.52, 0);
    boxAt(r.armW, M, 0.07, 0.24, 0.07, 0x5a3b22, 0, -0.64, 0); // grip
    boxAt(r.armW, M, 0.36, 0.06, 0.08, gold, 0, -0.78, 0); // crossguard
    boxAt(r.armW, M, 0.15, 1.15, 0.04, 0xe3ecf5, 0.0, -1.4, 0, { metalness: 0.55, roughness: 0.3 }); // blade
    r.armO = pivot(B, 0, 1.4, -0.5 * r.side);
    boxAt(r.armO, M, 0.18, 0.5, 0.18, steel, 0, -0.25, 0);
    ballAt(r.armO, M, 0.12, gold, 0, -0.52, 0);

    r.headY = 2.6;
    return r;
  }

  function buildOrc() {
    const r = newRig(-1);
    const M = r.mats;
    const green = 0x6a9a3a;
    const dkGreen = 0x4a7428;
    const leather = 0x7a4b2a;
    const B = r.body;
    B.scale.setScalar(1.18);

    for (const z of [-0.2, 0.2]) {
      const leg = pivot(B, 0, 0.7, z);
      boxAt(leg, M, 0.3, 0.7, 0.3, dkGreen, 0, -0.35, 0);
      boxAt(leg, M, 0.42, 0.16, 0.34, 0x4a3320, 0.08, -0.64, 0);
      r.legs.push(leg);
    }
    const torso = pivot(B, 0, 0.78, 0);
    torso.rotation.z = -0.2; // hunched forward
    boxAt(torso, M, 0.72, 0.85, 0.98, green, 0, 0.42, 0);
    boxAt(torso, M, 0.5, 0.5, 0.2, dkGreen, 0.22, 0.34, 0.0); // belly/chest plate shading
    boxAt(B, M, 0.78, 0.3, 1.02, leather, 0, 0.7, 0); // loincloth/belt
    ballAt(torso, M, 0.24, leather, 0, 0.82, 0.58);
    ballAt(torso, M, 0.24, leather, 0, 0.82, -0.58);

    const head = pivot(torso, 0.3, 1.04, 0);
    head.userData.base = 0.2; // jutting forward; pose() adds the swing nod on top
    boxAt(head, M, 0.52, 0.42, 0.56, green, 0, 0, 0);
    boxAt(head, M, 0.34, 0.14, 0.46, dkGreen, 0.1, -0.2, 0); // jaw
    boxAt(head, M, 0.1, 0.07, 0.56, dkGreen, 0.25, 0.15, 0); // brow
    for (const z of [-0.18, 0.18]) {
      addMesh(head, new THREE.ConeGeometry(0.06, 0.2, 6), stdMat(M, 0xf3ecd2), 0.3, -0.06, z); // tusk
      boxAt(head, M, 0.05, 0.07, 0.09, 0xff3b2a, 0.27, 0.05, z * 0.8, { emissive: 0xff2a1a, emissiveIntensity: 1.4 }).material.userData.baseEmissive.set(0xff2a1a);
      const ear = boxAt(head, M, 0.14, 0.3, 0.07, green, -0.05, 0.2, z * 1.7);
      ear.rotation.x = z > 0 ? -0.5 : 0.5;
    }
    r.head = head;

    // weapon arm on local -z (camera side after the yaw): a crude cleaver
    r.armW = pivot(B, 0.05, 1.42, 0.62 * r.side);
    boxAt(r.armW, M, 0.28, 0.62, 0.28, green, 0, -0.31, 0);
    ballAt(r.armW, M, 0.17, dkGreen, 0, -0.66, 0);
    boxAt(r.armW, M, 0.09, 0.4, 0.09, 0x5a3b22, 0, -0.84, 0);
    boxAt(r.armW, M, 0.42, 0.78, 0.07, 0x8d949c, 0.14, -1.28, 0, { metalness: 0.4, roughness: 0.5 });
    boxAt(r.armW, M, 0.1, 0.78, 0.075, 0x6b7279, 0.32, -1.28, 0, { metalness: 0.4, roughness: 0.5 }); // dull edge
    r.armO = pivot(B, 0.05, 1.42, -0.62 * r.side);
    boxAt(r.armO, M, 0.28, 0.62, 0.28, green, 0, -0.31, 0);
    ballAt(r.armO, M, 0.17, dkGreen, 0, -0.66, 0);

    r.headY = 2.95;
    return r;
  }

  // The animation contract: only these pivots are touched, so a Kenney
  // character with the same handful of pivots drops straight in.
  function pose(r, s, dt, time) {
    r.legAmp += ((s.walking ? 1 : 0) - r.legAmp) * Math.min(1, dt * 10);
    if (s.walking) r.wp += dt * WALK_CYCLE;
    const amp = r.legAmp;
    const sw = Math.sin(r.wp);
    r.legs[0].rotation.z = sw * 0.7 * amp;
    r.legs[1].rotation.z = -sw * 0.7 * amp;
    const breathe = Math.sin(time * 2.2 + r.seed) * 0.02;

    let armA = REST_ARM - sw * 0.45 * amp + breathe * 2;
    let lean = 0;
    if (s.swing !== null) {
      const t = s.swing;
      const rise = s.hitAt * 0.55;
      const UP = 3.3; // sword high and back
      const DOWN = 1.0; // sword out in front and slightly down
      if (t < rise) {
        const p = easeOut(clamp01(t / rise));
        armA = lerp(REST_ARM, UP, p);
        lean = -0.1 * p;
      } else if (t < s.hitAt) {
        const p = easeIn(clamp01((t - rise) / (s.hitAt - rise)));
        armA = lerp(UP, DOWN, p);
        lean = lerp(-0.1, 0.2, p);
      } else {
        const p = easeInOut(clamp01((t - s.hitAt) / (s.dur - s.hitAt)));
        armA = lerp(DOWN, REST_ARM, p);
        lean = lerp(0.2, 0, p);
      }
    }
    r.armW.rotation.z = armA;
    r.armO.rotation.z = sw * 0.5 * amp + 0.1 - breathe;
    if (r.capeP) r.capeP.rotation.z = 0.12 + amp * (0.18 + Math.sin(r.wp * 2) * 0.06) + Math.sin(time * 2.4) * 0.03;
    r.head.rotation.z = (s.swing !== null ? lean * 0.4 : 0) + (r.head.userData.base || 0);

    // hit reaction
    r.flash = Math.max(0, r.flash - dt * 5);
    r.recoil = Math.max(0, r.recoil - dt * 6);

    let bodyY = Math.abs(Math.cos(r.wp)) * 0.09 * amp + breathe;
    let tilt = -lean;
    if (s.fall > 0) {
      const a = easeIn(s.fall) * (Math.PI / 2) * 0.99;
      tilt = a;
      bodyY = Math.sin(a) * 0.4;
    }
    r.body.rotation.z = tilt;
    r.body.position.set(-r.recoil * 0.22, bodyY, 0);

    for (const m of r.mats) {
      m.emissive.copy(m.userData.baseEmissive).addScalar(r.flash * 0.6);
    }
  }

  function setRigAlpha(r, a) {
    const solid = a >= 0.999;
    for (const m of r.mats) {
      m.transparent = !solid;
      m.opacity = a;
    }
    r.root.visible = a > 0.003;
  }

  // A big foe's body is wider than the orc's, so it is drawn a little further
  // down the hall to keep it from sitting inside Sir Cleave. Purely visual: the
  // sim's distances are untouched.
  const foeOff = (o) => ((o.size || 1) - 1) * 0.9;

  /* ---------- the game ---------- */

  class Hall {
    constructor(root) {
      this.root = root;
      this.el = {};
      root.querySelectorAll("[data-hc]").forEach((n) => {
        this.el[n.getAttribute("data-hc")] = n;
      });
      this.listeners = [];
      this.destroyed = false;
      this.props = [];
      this.flames = [];
      this.sparks = [];
      this.numbers = [];
      this.time = 0;
      this.acc = 0;
      this.last = 0;
      this.best = readBest();
      this.bestAtStart = this.best;
      this.trayKey = "";
      this.overPending = null;
      this.overT = 0;
      this.feat = null;
      this.world = this.newWorld();

      this.setupRenderer();
      this.buildHall();
      this.buildFighters();
      this.buildBars();

      this.resetHud();
      const toMenu = () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      };
      this.listen(this.el.menu, "click", toMenu);
      this.listen(this.el.menu2, "click", toMenu);
      this.listen(this.el.again, "click", () => this.restart());
      this.listen(this.el.cards, "click", (e) => {
        const b = e.target.closest("[data-slot]");
        if (b) this.pick(+b.dataset.slot);
      });
      this.listen(window, "keydown", (e) => {
        if (e.key >= "1" && e.key <= "3") this.pick(+e.key - 1);
      });
      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
    }

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    }

    newWorld() {
      return new Sim.World({ seed: (Math.random() * 1e9) | 0, deck: true });
    }

    pick(i) {
      this.world.choose(i);
    }

    resetHud() {
      this.el.score.textContent = "0";
      this.el.rooms.textContent = "0";
      this.el.deck.textContent = this.world.deckSize();
      this.el.best.textContent = this.best;
    }

    restart() {
      this.el.overlay.innerHTML = "";
      for (const sp of this.sparks) this.scene.remove(sp.mesh);
      this.sparks = [];
      this.dropFeature();
      this.world = this.newWorld();
      for (const r of [this.knightRig, this.orcRig]) {
        r.flash = 0;
        r.recoil = 0;
      }
      this.orcRig.root.visible = false;
      this.orcRig.blob.visible = false;
      this.barO.el.style.opacity = "0";
      this.el.over.hidden = true;
      this.overPending = null;
      this.bestAtStart = this.best;
      this.trayKey = "";
      this.resetHud();
    }

    /* ----- the card tray ----- */

    cardIcon(id, cls) {
      const sym = { frenzied: "orc", armory: "whet" }[id] || id;
      return '<svg class="' + cls + " hc-ico--" + id + '" viewBox="0 0 48 48"><use href="#hc-i-' + sym + '"/></svg>';
    }

    cardEl(id, i) {
      const c = Sim.CARDS[id];
      const depth = 1 + this.world.cfg.run.depthScale * this.world.rooms;
      let pips = "";
      for (let n = 0; n < 5; n++) pips += '<i class="hc-pip' + (n < c.danger ? "" : " off") + '"></i>';
      const reward =
        c.kind === "foe"
          ? '<div class="r">+' + Math.round(c.reward * depth) + "</div>" +
            (c.drops ? '<div class="x">+' + c.drops + " card" + (c.drops > 1 ? "s" : "") + "</div>" : "")
          : '<div class="r safe">' + c.tag + "</div>";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hc-card";
      b.dataset.kind = c.kind;
      b.dataset.slot = i;
      b.style.animationDelay = i * 60 + "ms";
      b.innerHTML =
        '<span class="k">' + (i + 1) + "</span>" + this.cardIcon(id, "ico") +
        '<div class="n">' + c.name + '</div><div class="d">' + pips + "</div>" + reward +
        '<div class="b">' + c.blurb + "</div>";
      return b;
    }

    renderTray() {
      const w = this.world;
      this.el.cards.innerHTML = "";
      this.el.next.style.display = "none";
      if (w.phase === "over") return;
      if (w.offer) {
        w.offer.forEach((id, i) => this.el.cards.appendChild(this.cardEl(id, i)));
      } else if (w.queued) {
        this.el.next.innerHTML = this.cardIcon(w.queued, "") + "Next room: " + Sim.CARDS[w.queued].name;
        this.el.next.style.display = "flex";
      }
    }

    syncTray() {
      const w = this.world;
      const key = [w.offer ? w.offer.join(",") : "-", w.queued || "-", w.rooms, w.phase === "over"].join("|");
      if (key !== this.trayKey) {
        this.trayKey = key;
        this.renderTray();
      }
      // an empty hall with cards waiting: the clock is running
      const waiting = !!w.offer && !w.roomCard && w.phase !== "over";
      this.el.timerWrap.style.visibility = waiting ? "visible" : "hidden";
      if (waiting) this.el.timer.style.width = Math.max(0, 100 * (1 - w.offerAge / w.cfg.run.pickTime)).toFixed(1) + "%";
    }

    toast(text) {
      const d = document.createElement("div");
      d.className = "hc-toast";
      d.textContent = text;
      d.addEventListener("animationend", () => d.remove());
      setTimeout(() => d.remove(), 2600);
      this.el.overlay.appendChild(d);
    }

    showOver(e) {
      const by = e.by ? Sim.CARDS[e.by].name : "the dark";
      this.el.oLine.textContent = "Felled by " + (/^[AEIOU]/i.test(by) ? "an " : "a ") + by + " in room " + (e.rooms + 1) + ".";
      this.el.oScore.textContent = e.score;
      this.el.oRooms.textContent = e.rooms;
      this.el.oDeck.textContent = e.deck;
      this.el.oBest.textContent = e.score > this.bestAtStart ? "\u2605 New best!" : "Best: " + this.best;
      this.el.over.hidden = false;
    }

    /* ----- shrine / armory props ----- */

    makeFeature(id) {
      this.dropFeature();
      const g = new THREE.Group();
      const mats = [];
      const gold = id === "armory";
      const glowMat = new THREE.MeshBasicMaterial({
        map: makeGlowTexture(gold ? "rgba(255,210,110,0.85)" : "rgba(120,255,170,0.85)", "rgba(0,0,0,0)"),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
      glow.scale.set(3.2, 3.2, 1);
      glow.position.set(0, 1.5, -0.1);
      g.add(glow);
      if (!gold) {
        const stone = 0x7b7490;
        boxAt(g, mats, 2.1, 0.26, 0.95, 0x4a4458, 0, 0.13, 0);
        for (const x of [-0.8, 0.8]) boxAt(g, mats, 0.3, 2.2, 0.3, stone, x, 1.36, 0);
        boxAt(g, mats, 2.2, 0.32, 0.5, stone, 0, 2.62, 0);
        boxAt(g, mats, 0.5, 0.7, 0.5, 0x5a5470, 0, 0.6, 0.1);
        ballAt(g, mats, 0.3, 0x7ff0b8, 0, 1.35, 0.1, { emissive: 0x3fe08a, emissiveIntensity: 1.5 });
      } else {
        const wood = 0x5a3b22;
        boxAt(g, mats, 2.2, 1.7, 0.14, wood, 0, 1.45, -0.2);
        boxAt(g, mats, 2.4, 0.16, 0.5, 0x3a2616, 0, 0.5, 0.0);
        for (const x of [-0.7, 0, 0.7]) {
          boxAt(g, mats, 0.12, 1.2, 0.05, 0xe3ecf5, x, 1.5, 0.0, { metalness: 0.55, roughness: 0.3 });
          boxAt(g, mats, 0.42, 0.08, 0.1, 0xf2c14e, x, 0.95, 0.0);
        }
        boxAt(g, mats, 0.6, 0.6, 0.08, 0x9c2a35, 0, 0.9, 0.35).rotation.z = Math.PI / 4;
      }
      g.position.set(0, 0, -1.25);
      this.scene.add(g);
      this.feat = { id: id, group: g, mats: mats, glow: glowMat };
    }

    dropFeature() {
      const f = this.feat;
      if (!f) return;
      this.scene.remove(f.group);
      f.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      f.mats.forEach((m) => m.dispose());
      f.glow.map.dispose();
      f.glow.dispose();
      this.feat = null;
    }

    syncFeature() {
      const wf = this.world.feature;
      if (!wf) return this.dropFeature();
      const f = this.feat;
      if (!f) return;
      f.group.position.x = wf.x;
      const a = wf.alpha;
      for (const m of f.mats) {
        m.transparent = a < 0.999;
        m.opacity = a;
      }
      f.glow.opacity = a * (0.7 + 0.25 * Math.sin(this.time * 4));
      f.group.visible = a > 0.003;
    }

    /* ----- renderer ----- */

    setupRenderer() {
      const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
      this.renderer = new THREE.WebGLRenderer({
        antialias: !coarse,
        alpha: true, // the CSS gradient behind the canvas is the void around the diorama
        powerPreference: coarse ? "default" : "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
      if (!this.renderer.getContext()) throw new Error("WebGL context could not be created");
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      this.canvas = this.renderer.domElement;
      this.root.insertBefore(this.canvas, this.root.firstChild);

      this.listen(this.canvas, "webglcontextlost", (e) => {
        e.preventDefault();
        console.error("Hall of Blows: WebGL context lost.", e.statusMessage || "(no statusMessage given)");
        this.onContextLost();
      });

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
      this.camTarget = new THREE.Vector3(0.1, 1.45, 0);

      this.scene.add(new THREE.HemisphereLight(0xb8c0f0, 0x4a3550, 1.0));
      const key = new THREE.DirectionalLight(0xffd9a8, 1.5);
      key.position.set(-4, 9, 7);
      this.scene.add(key);
      this.fightLight = new THREE.PointLight(0xff9a50, 26, 13, 2);
      this.fightLight.position.set(0.1, 3.1, 2.4);
      this.scene.add(this.fightLight);

      this.resize();
      const onResize = () => this.resize();
      this.listen(window, "resize", onResize);
      this.listen(window, "orientationchange", onResize);
    }

    resize() {
      const w = Math.max(1, this.root.clientWidth);
      const h = Math.max(1, this.root.clientHeight);
      this.w = w;
      this.h = h;
      this.camera.aspect = w / h;
      this.renderer.setSize(w, h);

      // Frame a fixed length of hallway (so the orc's fade-in spot is always on
      // screen) but never less than the slab's height, then park the camera on
      // a steep yaw (CAM_AZIMUTH_DEG): the corridor runs diagonally across the
      // screen and recedes to the right. The hallway axis only covers
      // cos(az) of its length on screen, so the framing width shrinks to match.
      const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
      const portrait = this.camera.aspect < 1;
      const az = (CAM_AZIMUTH_DEG * Math.PI) / 180;
      const halfW = (portrait ? 4.5 : 5.8) * Math.cos(az) + 1.3;
      const halfH = 4.0;
      const dist = Math.max(halfW / (tanV * this.camera.aspect), halfH / tanV);
      // a portrait phone has height to spare, so look down on the diorama more
      const pitch = ((portrait ? 26 : 17) * Math.PI) / 180;
      this.camera.position.set(
        this.camTarget.x - Math.sin(az) * Math.cos(pitch) * dist,
        this.camTarget.y + Math.sin(pitch) * dist,
        this.camTarget.z + Math.cos(az) * Math.cos(pitch) * dist
      );
      this.camera.lookAt(this.camTarget);
      this.camera.updateProjectionMatrix();
    }

    /* ----- the diorama hallway ----- */

    buildHall() {
      const S = this.scene;
      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

      const floorTex = makeFloorTexture();
      floorTex.repeat.set(HALL_LEN / PERIOD, 1);
      floorTex.anisotropy = aniso;
      this.floorTex = floorTex;

      const wallTex = makeWallTexture();
      wallTex.repeat.set(HALL_LEN / PERIOD, 1);
      wallTex.anisotropy = aniso;
      this.wallTex = wallTex;

      // the slab's front edge reuses the wall bricks at the same world scale
      const frontTex = wallTex.clone();
      frontTex.needsUpdate = true;
      frontTex.repeat.set(HALL_LEN / PERIOD, SLAB_H / WALL_H);
      frontTex.anisotropy = aniso;
      this.frontTex = frontTex;

      const std = (opts) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, opts));

      // tabletop + plinth
      const table = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), std({ color: 0x1d1728 }));
      table.rotation.x = -Math.PI / 2;
      table.position.y = -1.45;
      S.add(table);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(HALL_LEN + 2, 0.55, HALL_D + 0.7), std({ color: 0x3d2a22 }));
      plinth.position.y = -1.18;
      S.add(plinth);

      // slab body, floor top, brick front edge
      const slab = new THREE.Mesh(new THREE.BoxGeometry(HALL_LEN, SLAB_H, HALL_D), std({ color: 0x4a4458 }));
      slab.position.y = -SLAB_H / 2;
      S.add(slab);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_LEN, HALL_D), std({ map: floorTex }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.002;
      S.add(floor);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(HALL_LEN, SLAB_H), std({ map: frontTex }));
      front.position.set(0, -SLAB_H / 2, HALL_D / 2 + 0.002);
      S.add(front);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(HALL_LEN, 0.1, 0.18), std({ color: 0x6d6580 }));
      lip.position.set(0, 0.04, HALL_D / 2 + 0.02);
      S.add(lip);

      // back wall + cap stones
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALL_LEN, WALL_H), std({ map: wallTex }));
      wall.position.set(0, WALL_H / 2, -HALL_D / 2);
      S.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(HALL_LEN, 0.28, 0.7), std({ color: 0x6d6580 }));
      cap.position.set(0, WALL_H + 0.08, -HALL_D / 2 + 0.1);
      S.add(cap);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(HALL_LEN, 0.3, 0.2), std({ color: 0x3a3548 }));
      skirt.position.set(0, 0.15, -HALL_D / 2 + 0.1);
      S.add(skirt);

      // recycled props, one per PERIOD along the wall
      const stone = std({ color: 0x7b7490 });
      const wood = std({ color: 0x4b3222 });
      const iron = std({ color: 0x2c2a33, metalness: 0.5, roughness: 0.5 });
      const flameOuter = new THREE.MeshBasicMaterial({ color: 0xff7a1c });
      const flameInner = new THREE.MeshBasicMaterial({ color: 0xffd36a });
      // a flat plane laid on the wall: a billboard sprite would slice into the
      // wall at the camera's angle and leave a hard diagonal edge
      const glowMat = new THREE.MeshBasicMaterial({
        map: makeGlowTexture("rgba(255,170,80,0.8)", "rgba(255,120,30,0)"),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const glowGeo = new THREE.PlaneGeometry(1, 1);
      const bannerMats = [std({ color: 0x9c2a35 }), std({ color: 0x2b4f94 })];
      const trimMat = std({ color: 0xe4b84f, metalness: 0.3, roughness: 0.5 });

      const zWall = -HALL_D / 2;
      const slots = WRAP / PERIOD;
      for (let i = 0; i < slots; i++) {
        const base = -WRAP / 2 + i * PERIOD;

        // pillar
        const pil = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.62, WALL_H, 0.5), stone);
        shaft.position.set(0, WALL_H / 2, zWall + 0.25);
        const footB = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.34, 0.66), stone);
        footB.position.set(0, 0.17, zWall + 0.33);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.34, 0.66), stone);
        head.position.set(0, WALL_H - 0.5, zWall + 0.33);
        pil.add(shaft, footB, head);
        this.addProp(pil, base);

        // ceiling beam jutting out of the cutaway
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, HALL_D * 0.62), wood);
        beam.position.set(0, WALL_H - 0.32, zWall + HALL_D * 0.31);
        this.addProp(beam, base);

        // torch (bracket, flame, glow)
        const torch = new THREE.Group();
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), iron);
        bracket.position.set(0, 1.9, zWall + 0.2);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.18, 8), iron);
        cup.position.set(0, 2.2, zWall + 0.26);
        const fo = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), flameOuter);
        fo.position.set(0, 2.5, zWall + 0.26);
        const fi = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 8), flameInner);
        fi.position.set(0, 2.44, zWall + 0.26);
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.scale.set(3.4, 3.4, 1);
        glow.position.set(0, 2.45, zWall + 0.03);
        torch.add(bracket, cup, fo, fi, glow);
        this.addProp(torch, base + PERIOD / 2);
        this.flames.push({ outer: fo, inner: fi, glow: glow, phase: i * 1.7 });

        // banner between torch and the next pillar
        const ban = new THREE.Group();
        const rod = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.07), trimMat);
        rod.position.set(0, 3.45, zWall + 0.12);
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.6, 0.04), bannerMats[i % 2]);
        cloth.position.set(0, 2.62, zWall + 0.1);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.43, 0.4, 3), bannerMats[i % 2]);
        tip.rotation.z = Math.PI;
        tip.scale.set(1, 1, 0.1);
        tip.position.set(0, 1.62, zWall + 0.1);
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), trimMat);
        crest.rotation.z = Math.PI / 4;
        crest.position.set(0, 2.75, zWall + 0.14);
        ban.add(rod, cloth, tip, crest);
        this.addProp(ban, base + PERIOD * 0.8);
      }

      // drifting dust, warm in the torchlight
      const N = 70;
      const pos = new Float32Array(N * 3);
      const rnd = lcg(5);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (rnd() - 0.5) * 14;
        pos[i * 3 + 1] = rnd() * 4;
        pos[i * 3 + 2] = (rnd() - 0.5) * 4.4;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.dust = new THREE.Points(
        dg,
        new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false })
      );
      this.dustPos = pos;
      S.add(this.dust);
    }

    addProp(obj, x0) {
      this.scene.add(obj);
      this.props.push({ obj: obj, x0: x0 });
    }

    /* ----- fighters ----- */

    buildFighters() {
      const S = this.scene;
      const blobTex = makeGlowTexture("rgba(0,0,0,0.65)", "rgba(0,0,0,0)");
      const blobGeo = new THREE.CircleGeometry(1, 20);
      const mkBlob = (radius) => {
        const m = new THREE.Mesh(
          blobGeo,
          new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.scale.setScalar(radius);
        m.position.y = 0.012;
        S.add(m);
        return m;
      };

      this.knightRig = buildKnight();
      this.knightRig.blob = mkBlob(0.95);
      S.add(this.knightRig.root);

      this.orcRig = buildOrc();
      this.orcRig.baseColors = this.orcRig.mats.map((m) => m.color.clone()); // so a card's tint can be undone
      this.orcRig.root.rotation.y = Math.PI; // faces -x, toward the knight
      this.orcRig.blob = mkBlob(1.25);
      S.add(this.orcRig.root);
      setRigAlpha(this.orcRig, 0);
      this.orcRig.blob.visible = false;

      // shared bits for impact sparks
      this.sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
      this.sparkMats = [
        new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c }),
      ];
      this.healMats = [new THREE.MeshBasicMaterial({ color: 0xb8ffd0 }), new THREE.MeshBasicMaterial({ color: 0x4fe08a })];
      this.boonMats = [new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), new THREE.MeshBasicMaterial({ color: 0xffc23c })];
    }

    /* ----- HUD bits ----- */

    buildBars() {
      const mk = (cls, name) => {
        const d = document.createElement("div");
        d.className = "hc-bar " + cls;
        d.innerHTML =
          '<div class="hc-bar-name"></div><div class="hc-bar-track"><div class="hc-bar-fill"></div></div>';
        d.firstChild.textContent = name;
        this.el.overlay.appendChild(d);
        return { el: d, fill: d.querySelector(".hc-bar-fill") };
      };
      // the bars lean away from each other so they don't pile up when the
      // fighters are close together (or small, on a phone)
      this.barK = mk("hc-bar--knight", this.world.knight.name);
      this.barK.shift = -0.3;
      this.barO = mk("hc-bar--orc", this.world.cfg.orc.name);
      this.barO.shift = 0.3;
      this.barO.el.style.opacity = "0";
      this.v = new THREE.Vector3();
    }

    toScreen(x, y, z) {
      this.v.set(x, y, z).project(this.camera);
      return { x: (this.v.x * 0.5 + 0.5) * this.w, y: (-this.v.y * 0.5 + 0.5) * this.h };
    }

    floatNumber(text, cls, x, y, z) {
      const p = this.toScreen(x, y, z);
      const d = document.createElement("div");
      d.className = "hc-dmg " + cls;
      d.textContent = text;
      d.style.left = p.x + (Math.random() - 0.5) * 36 + "px";
      d.style.top = p.y + "px";
      d.addEventListener("animationend", () => d.remove());
      setTimeout(() => d.remove(), 1600); // animationend never fires in a hidden tab
      this.el.overlay.appendChild(d);
    }

    burst(x, y, z, palette) {
      const mats = palette || this.sparkMats;
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(this.sparkGeo, mats[i % 2]);
        m.position.set(x, y, z);
        this.scene.add(m);
        const a = Math.random() * Math.PI * 2;
        const sp = 1.2 + Math.random() * 2.4;
        this.sparks.push({
          mesh: m,
          vx: Math.cos(a) * sp,
          vy: 1.5 + Math.random() * 2.5,
          vz: Math.sin(a) * sp * 0.6,
          life: 0.45 + Math.random() * 0.25,
        });
      }
    }

    /* ----- per-frame ----- */

    handleEvents() {
      const w = this.world;
      for (const e of w.drainEvents()) {
        if (e.type === "hit") {
          const toOrc = e.to === "orc";
          const rig = toOrc ? this.orcRig : this.knightRig;
          const f = toOrc ? w.orc || { x: 0 } : w.knight;
          const fx = toOrc ? f.x + foeOff(f) : f.x;
          rig.flash = 1;
          rig.recoil = 1;
          const hy = (toOrc ? 2.0 : 1.5) * (toOrc && f.size ? f.size : 1);
          this.floatNumber(String(e.dmg), toOrc ? "hc-dmg--orc" : "hc-dmg--knight", fx, hy + 0.9, FIGHT_Z);
          this.burst(fx, hy, FIGHT_Z + 0.4);
        } else if (e.type === "heal") {
          this.floatNumber("+" + e.amount, "hc-dmg--heal", w.knight.x, 2.6, FIGHT_Z);
          this.burst(w.knight.x, 1.6, FIGHT_Z + 0.4, this.healMats);
        } else if (e.type === "boon") {
          this.floatNumber(e.text, "hc-dmg--boon", w.knight.x, 3.1, FIGHT_Z);
          this.burst(w.knight.x, 1.6, FIGHT_Z + 0.4, this.boonMats);
        } else if (e.type === "spawn") {
          // fresh foe: reset its rig so nothing carries over from the last corpse, then dress it as its card
          const o = w.orc;
          const r = this.orcRig;
          r.flash = 0;
          r.recoil = 0;
          r.wp = 0;
          r.root.scale.setScalar(o.size);
          const tint = o.tint == null ? null : new THREE.Color(o.tint);
          r.mats.forEach((m, i) => {
            m.color.copy(r.baseColors[i]);
            if (tint && m.userData.baseEmissive.getHex() === 0) m.color.lerp(tint, 0.5); // leave the glowing eyes red
          });
          r.blob.scale.setScalar(1.25 * o.size);
          this.barO.el.firstChild.textContent = o.name;
        } else if (e.type === "featurespawn") {
          this.makeFeature(e.card);
        } else if (e.type === "roomclear") {
          this.el.score.textContent = e.score;
          this.el.rooms.textContent = e.rooms;
          if (e.score > this.best) {
            this.best = e.score;
            this.el.best.textContent = this.best;
            writeBest(this.best);
          }
          if (e.reward > 0) this.floatNumber("+" + e.reward, "hc-dmg--score", w.knight.x + 1.9, 3.2, FIGHT_Z);
        } else if (e.type === "reward") {
          this.el.deck.textContent = e.deck;
          const names = e.ids.map((id) => Sim.CARDS[id].name);
          this.toast("+ " + names.join(", ") + (names.length > 1 ? " added to your deck" : " card added to your deck"));
        } else if (e.type === "knightdeath") {
          this.overPending = e;
          this.overT = 0;
        }
      }
    }

    syncScenery(dt) {
      const sc = this.world.scroll;
      this.floorTex.offset.x = sc / PERIOD;
      this.wallTex.offset.x = sc / PERIOD;
      this.frontTex.offset.x = sc / PERIOD;
      for (const p of this.props) p.obj.position.x = wrap(p.x0 - sc, WRAP);
      for (const f of this.flames) {
        const k = 1 + 0.16 * Math.sin(this.time * 13 + f.phase) + 0.08 * Math.sin(this.time * 31 + f.phase * 2);
        f.outer.scale.set(1, k, 1);
        f.inner.scale.set(1, 1.1 - (k - 1) * 0.8, 1);
        f.glow.scale.setScalar(3.2 + (k - 1) * 1.6);
      }
      const arr = this.dustPos;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (0.12 + (i % 7) * 0.02);
        arr[i] -= dt * (this.world.phase === "walk" ? 0.9 : 0.05);
        if (arr[i + 1] > 4.2) arr[i + 1] = 0;
        if (arr[i] < -7) arr[i] = 7;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.fightLight.intensity = 26 + Math.sin(this.time * 9) * 1.4 + Math.sin(this.time * 23) * 0.8;
    }

    syncFighters(dt) {
      const w = this.world;
      const k = w.knight;
      const kr = this.knightRig;
      kr.root.position.set(k.x, 0, FIGHT_Z);
      pose(
        kr,
        { walking: w.phase === "walk", swing: k.swing, hitAt: k.hitAt, dur: k.swingDur, fall: k.fall },
        dt,
        this.time
      );
      kr.blob.position.set(k.x, 0.012, FIGHT_Z);

      const o = w.orc;
      const or = this.orcRig;
      if (o) {
        or.root.position.set(o.x + foeOff(o), 0, FIGHT_Z);
        pose(or, { walking: false, swing: o.swing, hitAt: o.hitAt, dur: o.swingDur, fall: o.fall }, dt, this.time);
        setRigAlpha(or, o.alpha);
        or.blob.visible = o.alpha > 0.003;
        or.blob.position.set(o.x + foeOff(o) - o.fall * 0.9, 0.012, FIGHT_Z);
        or.blob.material.opacity = o.alpha;
      } else {
        or.root.visible = false;
        or.blob.visible = false;
      }

      // health bars ride above the heads
      const kp = this.toScreen(k.x, kr.headY, FIGHT_Z);
      this.placeBar(this.barK, kp, k.hp / k.maxHp, 1);
      if (o && o.alive) {
        const op = this.toScreen(o.x + foeOff(o), or.headY * (o.size || 1), FIGHT_Z);
        this.placeBar(this.barO, op, o.hp / o.maxHp, o.alpha);
      } else {
        this.barO.el.style.opacity = "0";
      }
    }

    placeBar(bar, p, frac, alpha) {
      const half = bar.el.offsetWidth / 2;
      bar.el.style.transform =
        "translate(" + (p.x - half + bar.shift * half * 2).toFixed(1) + "px," + p.y.toFixed(1) + "px) translate(0,-100%)";
      bar.el.style.opacity = String(alpha);
      bar.fill.style.width = Math.max(0, frac * 100).toFixed(1) + "%";
    }

    stepSparks(dt) {
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          this.scene.remove(s.mesh);
          this.sparks.splice(i, 1);
          continue;
        }
        s.vy -= 9 * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y = Math.max(0.05, s.mesh.position.y + s.vy * dt);
        s.mesh.position.z += s.vz * dt;
        s.mesh.scale.setScalar(Math.max(0.15, s.life * 2));
      }
    }

    frame(now) {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(this.frame);
      const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0);
      this.last = now;
      this.time += dt;

      this.acc += dt;
      while (this.acc >= STEP) {
        this.world.step(STEP);
        this.acc -= STEP;
      }
      this.handleEvents();
      this.syncScenery(dt);
      this.syncFighters(dt);
      this.syncFeature();
      this.syncTray();
      this.el.deck.textContent = this.world.deckSize();
      if (this.overPending && (this.overT += dt) > 1.1) {
        this.showOver(this.overPending);
        this.overPending = null;
      }
      this.stepSparks(dt);
      this.renderer.render(this.scene, this.camera);
    }

    /* ----- teardown ----- */

    onContextLost() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.listeners.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
      showFatalError(this.root, "This device dropped 3D graphics mid-fight — try closing other tabs/apps, or head back.");
    }

    destroy() {
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      // listeners first so forceContextLoss below doesn't fire onContextLost
      this.listeners.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
      this.dropFeature();
      if (typeof this.renderer.forceContextLoss === "function") this.renderer.forceContextLoss();
      this.renderer.dispose();
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("hc-style")) return;
    const s = document.createElement("style");
    s.id = "hc-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureThree() {
    if (THREE) return Promise.resolve();
    return import(THREE_URL).then((mod) => {
      THREE = mod;
    });
  }

  function launchHallwayCombat() {
    if (window.hallwayCombatGame) return window.hallwayCombatGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "hc-root";
    root.innerHTML = '<div class="hc-loading">Lighting the torches&hellip;</div>' + HUD_HTML;
    document.getElementById("game-container").appendChild(root);

    const handle = {
      root: root,
      game: null,
      cancelled: false,
      destroy: function () {
        this.cancelled = true;
        if (this.game) {
          this.game.destroy();
          this.game = null;
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.hallwayCombatGame = handle;

    ensureThree()
      .then(() => {
        if (handle.cancelled) return;
        const loading = root.querySelector(".hc-loading");
        if (loading) loading.remove();
        handle.game = new Hall(root);
      })
      .catch((err) => {
        if (handle.cancelled) return;
        showFatalError(root, "This device couldn't start 3D graphics for this game.");
        console.error("Hall of Blows failed to start:", err);
      });

    return handle;
  }

  window.launchHallwayCombat = launchHallwayCombat;
})();
