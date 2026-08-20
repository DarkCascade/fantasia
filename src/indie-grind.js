/*
 * Indie Grind — an incremental game about being a professional developer
 * trying to break into the games industry.
 *
 * Each GameObject is written in one of four categories (Gameplay, Audio,
 * Visual, Juice) — pick a category card to start that write; a fill bar
 * paces it at that category's own base time. Every category also carries a
 * Caliber bonus, and a game's total Caliber (the sum of every banked
 * GameObject's category bonus, plus a 1.0 base) is a flat multiplier on the
 * sale. Once at least three GameObjects are banked, "Create Game!" sells the
 * whole inventory in one go through a modal that breaks the payout down:
 * base value, each category's contribution, the combined Caliber, and the
 * final total. Money buys permanent upgrade tiers (faster writes, better
 * polish, junior hires that auto-write a random category, QA that improves
 * reviews) and temporary shop buffs (coffee, energy drinks, an investor
 * pitch, a one-shot lucky commit).
 *
 * Unlike the Phaser games, this is a DOM overlay (like Gloom Hollow 3D's
 * HUD) — the whole "game" is numbers, buttons and panels, so a canvas buys
 * nothing. window.launchIndieGrind() builds it; window.indieGrindGame is
 * the handle, and destroy() takes no arguments (same convention as
 * gloom3DGame) since there's no Phaser instance underneath.
 */
(function () {
  "use strict";

  /* ---------- tuning ---------- */

  const BASE_VALUE = 8; // $ per GameObject before upgrades
  const BASE_CALIBER = 1.0; // every game starts at this multiplier before category bonuses
  const BASE_REVIEW = { min: 35, max: 90 };
  const SELL_MIN_OBJECTS = 3;
  const TICK_MS = 100;
  const MAX_ICONS_SHOWN = 10;
  const LOG_MAX = 6;

  // Base creation time (seconds) and Caliber bonus per category. Coding
  // Speed / Coffee scale all four proportionally via speedMult().
  const CATEGORIES = [
    { id: "gameplay", label: "Gameplay", icon: "🎮", color: "#ff6b5a", dark: "#7a2f26", caliber: 1.75, baseTime: 3.0 },
    { id: "audio", label: "Audio", icon: "🎵", color: "#3ddad0", dark: "#1a6b66", caliber: 1.3, baseTime: 2.6 },
    { id: "visual", label: "Visual", icon: "🎨", color: "#e074f0", dark: "#6a3573", caliber: 1.4, baseTime: 2.8 },
    { id: "juice", label: "Juice", icon: "✨", color: "#ffcf3f", dark: "#7a5f1a", caliber: 2.0, baseTime: 4.0 },
  ];
  const CATEGORY_MAP = {};
  CATEGORIES.forEach((c) => {
    CATEGORY_MAP[c.id] = c;
  });

  // Fractions of a category's base time, not absolute seconds, so one speed
  // track scales all four categories proportionally.
  const SPEED_TIERS = [
    { cost: 20, mult: 0.78, name: "Touch Typing" },
    { cost: 55, mult: 0.58, name: "Dual Monitors" },
    { cost: 150, mult: 0.43, name: "Mechanical Keyboard" },
    { cost: 400, mult: 0.31, name: "Vim Mastery" },
    { cost: 950, mult: 0.23, name: "AI Autocomplete" },
  ];

  const VALUE_TIERS = [
    { cost: 25, value: 12, name: "Better Sprites" },
    { cost: 70, value: 18, name: "Polish Pass" },
    { cost: 190, value: 27, name: "Trailer & Screenshots" },
    { cost: 500, value: 40, name: "Steam Page Glow-up" },
    { cost: 1200, value: 60, name: "Marketing Blitz" },
  ];

  const AUTO_TIERS = [
    { cost: 60, rate: 0.15, name: "Hire an Intern" },
    { cost: 160, rate: 0.35, name: "Hire a Junior Dev" },
    { cost: 420, rate: 0.7, name: "Hire a Mid Dev" },
    { cost: 1000, rate: 1.3, name: "Hire a Senior Dev" },
    { cost: 2400, rate: 2.4, name: "Hire a Staff Engineer" },
  ];

  const REVIEW_TIERS = [
    { cost: 80, min: 45, max: 92, name: "Beta Testers" },
    { cost: 220, min: 55, max: 94, name: "QA Pass" },
    { cost: 550, min: 65, max: 96, name: "Playtesting Sessions" },
    { cost: 1300, min: 75, max: 98, name: "Community Feedback Loop" },
    { cost: 3000, min: 85, max: 100, name: "Day-One Patch" },
  ];

  const TRACKS = [
    { id: "speed", label: "Coding Speed", icon: "⌨️", color: "#5aa7ff", tiers: SPEED_TIERS },
    { id: "value", label: "Game Polish", icon: "✨", color: "#7fd858", tiers: VALUE_TIERS },
    { id: "auto", label: "Team Hires", icon: "🧑‍💻", color: "#c58bff", tiers: AUTO_TIERS },
    { id: "review", label: "Quality Assurance", icon: "🏅", color: "#ffb648", tiers: REVIEW_TIERS },
  ];

  const SHOP_ITEMS = [
    { id: "coffee", icon: "☕", name: "Coffee", desc: "2x writing speed", cost: 40, duration: 30, kind: "timed" },
    { id: "energy", icon: "⚡", name: "Energy Drink", desc: "2x auto-hire output", cost: 70, duration: 40, kind: "timed" },
    { id: "pitch", icon: "💼", name: "Investor Pitch", desc: "1.5x sale value", cost: 120, duration: 45, kind: "timed" },
    { id: "lucky", icon: "🍀", name: "Lucky Commit", desc: "Next review guaranteed 95+ (arms for 60s)", cost: 90, duration: 60, kind: "arm" },
  ];

  const FLAVOR_LINES = [
    "Compiling... please wait.",
    "Fixing a typo in a comment nobody reads.",
    "Stack Overflow has the answer, probably.",
    "Naming things is the hardest part.",
    "Merge conflict resolved (probably wrong).",
    "Just one more semicolon...",
    "Coffee: acquired. Bugs: unaffected.",
    "Refactoring for the third time today.",
    "Copilot suggested something weird again.",
    "Tabs vs spaces: settled by force.",
    "It works on my machine.",
    "Writing a TODO that will outlive us all.",
  ];

  const REVIEWERS = ["IGN", "GameSpot", "Rock Paper Shotgun", "Kotaku", "PC Gamer", "Steam Curators", "itch.io players"];

  const MILESTONES = [
    { amt: 500, msg: "You shipped your first paid game!" },
    { amt: 2500, msg: "You quit your day job." },
    { amt: 10000, msg: "A publisher slides into your DMs." },
    { amt: 50000, msg: "Front page of Steam!" },
    { amt: 200000, msg: "GDC wants you to give a talk." },
  ];

  /* ---------- formatting ---------- */

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

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function hexToRgba(hex, alpha) {
    const v = hex.replace("#", "");
    const r = parseInt(v.substring(0, 2), 16);
    const g = parseInt(v.substring(2, 4), 16);
    const b = parseInt(v.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function scoreColor(score) {
    if (score >= 90) return "#ffd23f";
    if (score >= 75) return "#7fd858";
    if (score >= 50) return "#f0c020";
    return "#e0553f";
  }

  function scoreTitle(score) {
    if (score >= 90) return "Masterpiece!";
    if (score >= 75) return "Great reception!";
    if (score >= 50) return "Mixed reviews...";
    return "Ouch, rough launch...";
  }

  const HTML =
    '<div class="ig-app">' +
    '<div class="ig-topbar">' +
    '<button class="ig-menubtn" type="button" data-act="menu" aria-label="Return to menu">≡</button>' +
    '<div class="ig-title">INDIE GRIND</div>' +
    '<div class="ig-money" id="ig-money-badge"><span class="ig-money-icon">💰</span><span class="ig-money-val" id="ig-money-val">$0</span></div>' +
    "</div>" +
    '<div class="ig-body" id="ig-body">' +
    '<section class="ig-work">' +
    '<div class="ig-flavor" id="ig-flavor">Ready to build your first hit...</div>' +
    '<div class="ig-inventory">' +
    '<div class="ig-inv-head"><span class="ig-inv-label">GameObjects</span><span class="ig-inv-count" id="ig-inv-count">0</span></div>' +
    '<div class="ig-inv-icons" id="ig-inv-icons"></div>' +
    "</div>" +
    '<div class="ig-cat-grid" id="ig-cat-grid"></div>' +
    '<button class="ig-create-btn" id="ig-create-btn" type="button" disabled>' +
    '<span class="ig-create-label">🚀 Create Game!</span>' +
    '<span class="ig-create-sub" id="ig-create-sub">Need 3 GameObjects</span>' +
    "</button>" +
    "</section>" +
    '<div class="ig-panels">' +
    '<section class="ig-panel">' +
    "<h2>Permanent Upgrades</h2>" +
    '<div class="ig-list" id="ig-upgrade-list"></div>' +
    "</section>" +
    '<section class="ig-panel">' +
    "<h2>Shop — Temp Buffs</h2>" +
    '<div class="ig-list" id="ig-shop-list"></div>' +
    "</section>" +
    "</div>" +
    '<div class="ig-log" id="ig-log"></div>' +
    "</div>" +
    '<div class="ig-fx-layer" id="ig-fx-layer"></div>' +
    '<div class="ig-modal-backdrop" id="ig-modal-backdrop">' +
    '<div class="ig-modal" id="ig-modal">' +
    '<button class="ig-modal-close" id="ig-modal-close" type="button" aria-label="Close">×</button>' +
    '<div id="ig-modal-body"></div>' +
    "</div>" +
    "</div>" +
    "</div>";

  const CSS =
    "#ig-root{position:absolute;inset:0;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff0d0;" +
    "background:radial-gradient(ellipse at 50% 0%,rgba(126,116,224,.28),transparent 55%),linear-gradient(180deg,#1b1440 0%,#120e28 55%,#05030f 100%);}" +
    ".ig-app{position:absolute;inset:0;display:flex;flex-direction:column;}" +
    ".ig-topbar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;" +
    "background:rgba(10,7,26,.55);border-bottom:2px solid rgba(255,224,138,.25);}" +
    ".ig-menubtn{width:36px;height:36px;border-radius:10px;border:2px solid rgba(255,224,138,.6);background:rgba(255,255,255,.06);color:#ffe7a3;" +
    "font-size:18px;cursor:pointer;transition:transform .06s ease;}" +
    ".ig-menubtn:active{transform:translateY(2px);}" +
    ".ig-title{font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(16px,4vw,22px);letter-spacing:.06em;" +
    "background:linear-gradient(180deg,#fff6d5 0%,#f6d879 40%,#e2a72f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;}" +
    ".ig-money{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;border:2px solid rgba(255,224,138,.55);background:rgba(255,255,255,.06);font-weight:700;font-size:clamp(14px,3.6vw,18px);}" +
    ".ig-money-icon{font-size:1.05em;}" +
    ".ig-money.ig-pulse-up{animation:ig-money-up .38s ease;}" +
    ".ig-money.ig-pulse-down{animation:ig-money-down .38s ease;}" +
    "@keyframes ig-money-up{0%{transform:scale(1);}35%{transform:scale(1.18);color:#9dff9d;}100%{transform:scale(1);}}" +
    "@keyframes ig-money-down{0%{transform:scale(1);}35%{transform:scale(.92);color:#ff9d9d;}100%{transform:scale(1);}}" +
    ".ig-body{flex:1 1 auto;overflow-y:auto;padding:16px 14px 32px;display:flex;flex-direction:column;gap:18px;align-items:center;}" +
    ".ig-work{width:100%;max-width:460px;display:flex;flex-direction:column;gap:12px;align-items:stretch;}" +
    ".ig-flavor{text-align:center;font-style:italic;font-size:13px;color:#c9bdfb;min-height:1.4em;opacity:.85;}" +
    ".ig-inventory{border:2px solid rgba(255,224,138,.3);border-radius:14px;background:rgba(255,255,255,.04);padding:10px 14px;}" +
    ".ig-inv-head{display:flex;justify-content:space-between;align-items:baseline;}" +
    ".ig-inv-label{font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#d8cdff;opacity:.8;}" +
    ".ig-inv-count{font-size:22px;font-weight:800;color:#ffe7a3;transition:transform .15s ease;}" +
    ".ig-inv-count.ig-pop{animation:ig-count-pop .32s ease;}" +
    "@keyframes ig-count-pop{0%{transform:scale(1);}40%{transform:scale(1.35);color:#9dff9d;}100%{transform:scale(1);}}" +
    ".ig-inv-icons{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;min-height:26px;}" +
    ".ig-inv-icon{width:22px;height:22px;border-radius:6px;background:linear-gradient(160deg,#8fd0ff,#4a7fd0);box-shadow:0 2px 4px rgba(0,0,0,.4);" +
    "display:flex;align-items:center;justify-content:center;font-size:12px;animation:ig-icon-in .28s cubic-bezier(.34,1.56,.64,1);}" +
    ".ig-inv-icon.ig-overflow{background:linear-gradient(160deg,#ffd98f,#d08a4a);font-size:11px;font-weight:700;color:#3a2500;}" +
    "@keyframes ig-icon-in{0%{transform:scale(0) rotate(-30deg);opacity:0;}70%{transform:scale(1.2) rotate(6deg);opacity:1;}100%{transform:scale(1) rotate(0);}}" +
    ".ig-cat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}" +
    ".ig-cat-card{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:4px;padding:11px 11px 10px;border-radius:14px;" +
    "border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.04);transition:box-shadow .2s ease,opacity .2s ease;}" +
    ".ig-cat-card.ig-cat-busy{opacity:.5;}" +
    ".ig-cat-card.ig-cat-active{animation:ig-cat-pulse 1s ease-in-out infinite;}" +
    "@keyframes ig-cat-pulse{0%,100%{box-shadow:0 0 12px var(--cat-glow,rgba(255,255,255,.4));}50%{box-shadow:0 0 26px var(--cat-glow,rgba(255,255,255,.7));}}" +
    ".ig-cat-top{display:flex;align-items:center;gap:8px;}" +
    ".ig-cat-icon{font-size:20px;line-height:1;}" +
    ".ig-cat-name{font-weight:800;font-size:13px;}" +
    ".ig-cat-caliber{font-size:10px;opacity:.8;margin-top:1px;}" +
    ".ig-cat-time{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;}" +
    ".ig-cat-progress{margin-top:2px;height:6px;border-radius:4px;background:rgba(0,0,0,.35);overflow:hidden;}" +
    ".ig-cat-progress-fill{height:100%;width:0%;border-radius:4px;transition:width .1s linear;}" +
    ".ig-cat-btn{margin-top:6px;padding:8px;border-radius:9px;border:none;font-weight:800;font-size:12px;cursor:pointer;color:#fff;" +
    "text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 3px 0 rgba(0,0,0,.4);transition:transform .06s ease,box-shadow .06s ease;}" +
    ".ig-cat-btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.4);}" +
    ".ig-cat-btn:disabled{cursor:default;filter:grayscale(.5) saturate(.4);opacity:.55;}" +
    ".ig-create-btn{padding:14px 18px;border-radius:16px;border:2px solid #ffe9ad;cursor:pointer;text-align:center;" +
    "background:linear-gradient(180deg,#5a4b1a 0%,#332608 100%);box-shadow:0 6px 0 #1c1404;transition:transform .06s ease,box-shadow .06s ease,filter .2s ease;filter:saturate(.5);}" +
    ".ig-create-btn:not(:disabled){filter:saturate(1);background:linear-gradient(180deg,#ffe7a3 0%,#f0b94a 100%);box-shadow:0 6px 0 #8a5a12,0 0 26px rgba(255,210,63,.55);animation:ig-ready-glow 1.6s ease-in-out infinite;}" +
    ".ig-create-btn:not(:disabled) .ig-create-label{color:#3a2500;}" +
    ".ig-create-btn:not(:disabled) .ig-create-sub{color:#5a3f00;}" +
    ".ig-create-btn:active:not(:disabled){transform:translateY(4px);box-shadow:0 2px 0 #8a5a12;}" +
    ".ig-create-btn:disabled{cursor:default;}" +
    "@keyframes ig-ready-glow{0%,100%{box-shadow:0 6px 0 #8a5a12,0 0 18px rgba(255,210,63,.4);}50%{box-shadow:0 6px 0 #8a5a12,0 0 34px rgba(255,210,63,.85);}}" +
    ".ig-create-label{display:block;font-size:clamp(17px,4.6vw,21px);font-weight:800;color:#ffe7a3;}" +
    ".ig-create-sub{display:block;margin-top:2px;font-size:12px;color:#e0d3a0;}" +
    ".ig-panels{width:100%;max-width:920px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;}" +
    ".ig-panel{border:2px solid rgba(255,224,138,.25);border-radius:14px;background:rgba(10,7,26,.4);padding:12px 14px;}" +
    ".ig-panel h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#ffe7a3;opacity:.9;margin-bottom:10px;}" +
    ".ig-list{display:flex;flex-direction:column;gap:8px;}" +
    ".ig-card{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;" +
    "border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);transition:border-color .2s ease,box-shadow .2s ease;}" +
    ".ig-card-icon{font-size:20px;flex:0 0 auto;width:30px;text-align:center;}" +
    ".ig-card-body{flex:1 1 auto;min-width:0;}" +
    ".ig-card-name{font-size:13px;font-weight:700;color:#fff0d0;}" +
    ".ig-card-desc{font-size:11px;color:#c9bdfb;opacity:.85;margin-top:1px;}" +
    ".ig-card-btn{flex:0 0 auto;padding:7px 10px;border-radius:9px;border:none;font-size:12px;font-weight:700;cursor:pointer;color:#1a1204;" +
    "background:linear-gradient(180deg,#ffe7a3,#f0b94a);box-shadow:0 3px 0 #8a5a12;transition:transform .06s ease,box-shadow .06s ease,filter .15s ease;white-space:nowrap;}" +
    ".ig-card-btn:active{transform:translateY(2px);box-shadow:0 1px 0 #8a5a12;}" +
    ".ig-card-btn:disabled{cursor:default;filter:grayscale(.6) saturate(.4);opacity:.55;}" +
    ".ig-card-btn.ig-flash{animation:ig-flash .35s ease;}" +
    "@keyframes ig-flash{0%{filter:brightness(1);}40%{filter:brightness(1.7);}100%{filter:brightness(1);}}" +
    ".ig-card-bar{position:absolute;left:0;bottom:0;height:3px;background:linear-gradient(90deg,#9dffd0,#5aa7ff);width:0%;transition:width .2s linear;}" +
    ".ig-card.ig-armed{border-color:#7fd858;box-shadow:0 0 12px rgba(127,216,88,.5);}" +
    /* Affordability is the dominant signal: a buyable card/button glows and
       pulses green, a maxed one turns gold-solid — both read at a glance,
       distinct from the plain/disabled default for "not yet affordable". */
    ".ig-card.ig-afford{border-color:rgba(157,255,157,.6);box-shadow:0 0 12px rgba(157,255,157,.22);}" +
    ".ig-card.ig-maxed{border-color:rgba(255,210,63,.5);}" +
    ".ig-card-btn.ig-buy-ready{background:linear-gradient(180deg,#c8ffc8,#4fbf4f);color:#0c3a0c;" +
    "box-shadow:0 3px 0 #1f6b1f,0 0 10px rgba(157,255,157,.55);animation:ig-buy-pulse 1.4s ease-in-out infinite;}" +
    "@keyframes ig-buy-pulse{0%,100%{box-shadow:0 3px 0 #1f6b1f,0 0 8px rgba(157,255,157,.35);}50%{box-shadow:0 3px 0 #1f6b1f,0 0 18px rgba(157,255,157,.9);}}" +
    ".ig-card-btn.ig-maxed-btn{background:linear-gradient(180deg,#ffe7a3,#c99a2e)!important;color:#3a2500!important;filter:none!important;opacity:1!important;}" +
    ".ig-log{width:100%;max-width:920px;display:flex;flex-direction:column;gap:5px;}" +
    ".ig-log-entry{font-size:12px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.04);border-left:3px solid #5aa7ff;color:#d7cfff;" +
    "animation:ig-log-in .25s ease;}" +
    ".ig-log-entry.ig-log-sale{border-left-color:#ffd23f;color:#ffe7a3;}" +
    ".ig-log-entry.ig-log-milestone{border-left-color:#7fd858;color:#d8ffd0;font-weight:700;}" +
    "@keyframes ig-log-in{0%{opacity:0;transform:translateY(-6px);}100%{opacity:1;transform:translateY(0);}}" +
    ".ig-fx-layer{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden;}" +
    ".ig-particle{position:absolute;width:8px;height:8px;border-radius:2px;will-change:transform,opacity;animation:ig-particle-fly .8s ease-out forwards;}" +
    "@keyframes ig-particle-fly{0%{transform:translate(0,0) rotate(0deg) scale(1);opacity:1;}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--rot)) scale(.4);opacity:0;}}" +
    ".ig-float-text{position:absolute;transform:translate(-50%,0);font-weight:800;font-size:16px;white-space:nowrap;text-shadow:0 2px 4px rgba(0,0,0,.6);" +
    "animation:ig-float-up .9s ease-out forwards;}" +
    "@keyframes ig-float-up{0%{opacity:0;transform:translate(-50%,0) scale(.7);}15%{opacity:1;transform:translate(-50%,-6px) scale(1.1);}100%{opacity:0;transform:translate(-50%,-52px) scale(1);}}" +
    ".ig-shake{animation:ig-shake .35s ease;}" +
    "@keyframes ig-shake{0%,100%{transform:translate(0,0);}20%{transform:translate(-4px,2px);}40%{transform:translate(4px,-2px);}60%{transform:translate(-3px,1px);}80%{transform:translate(3px,-1px);}}" +
    /* Sale modal: a real overlay, dismissed by its × or a click/tap on the
       backdrop itself (not anything inside the card, since that's not
       "outside" it). */
    ".ig-modal-backdrop{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:5vw;" +
    "background:rgba(4,2,14,.72);}" +
    ".ig-modal-backdrop.ig-open{display:flex;}" +
    ".ig-modal{position:relative;max-width:420px;width:100%;max-height:86vh;overflow-y:auto;padding:28px 22px 22px;border-radius:20px;text-align:center;" +
    "background:linear-gradient(180deg,#241d54 0%,#120e28 100%);border:2px solid rgba(255,255,255,.22);box-shadow:0 24px 60px rgba(0,0,0,.65);" +
    "animation:ig-modal-pop .3s cubic-bezier(.34,1.56,.64,1);}" +
    "@keyframes ig-modal-pop{0%{opacity:0;transform:scale(.82) translateY(14px);}100%{opacity:1;transform:scale(1) translateY(0);}}" +
    ".ig-modal-close{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;border:none;cursor:pointer;" +
    "background:rgba(255,255,255,.12);color:#fff0d0;font-size:18px;line-height:1;}" +
    ".ig-modal-close:active{transform:scale(.9);}" +
    ".ig-review-score{font-size:38px;font-weight:900;}" +
    ".ig-review-title{font-size:14px;font-weight:700;margin-top:2px;opacity:.9;}" +
    ".ig-breakdown{margin-top:16px;display:flex;flex-direction:column;gap:6px;text-align:left;}" +
    ".ig-bd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;padding:7px 10px;border-radius:9px;" +
    "background:rgba(255,255,255,.05);border-left:3px solid rgba(255,255,255,.25);opacity:0;animation:ig-bd-in .3s ease forwards;}" +
    ".ig-bd-row span:first-child{opacity:.9;}" +
    ".ig-bd-row span:last-child{font-weight:700;font-variant-numeric:tabular-nums;}" +
    ".ig-bd-base{font-weight:700;}" +
    ".ig-bd-caliber{font-weight:800;color:#ffd23f;border-left-color:#ffd23f;margin-top:2px;background:rgba(255,210,63,.08);}" +
    ".ig-bd-final{font-weight:900;font-size:15px;color:#9dff9d;border-left-color:#9dff9d;margin-top:6px;padding-top:10px;" +
    "border-top:1px dashed rgba(255,255,255,.25);background:rgba(157,255,157,.08);}" +
    "@keyframes ig-bd-in{0%{opacity:0;transform:translateX(-10px);}100%{opacity:1;transform:translateX(0);}}" +
    "@media(max-width:520px){.ig-topbar{padding:8px 10px;}.ig-body{padding:12px 10px 26px;gap:14px;}}" +
    "@media(max-width:360px){.ig-cat-grid{grid-template-columns:1fr;}}";

  /* ---------- game class ---------- */

  class IndieGrind {
    constructor(root) {
      this.root = root;
      this.money = 0;
      this.inventory = { gameplay: 0, audio: 0, visual: 0, juice: 0 };
      this.levels = { speed: 0, value: 0, auto: 0, review: 0 };
      this.buffs = {}; // id -> expiresAt (ms epoch)
      this.lucky = { armed: false, expiresAt: 0 };
      this.writingCat = null;
      this.writeElapsed = 0;
      this.autoAccum = 0;
      this.milestoneIdx = 0;
      this.flavorTimer = 0;

      this.el = {
        moneyBadge: root.querySelector("#ig-money-badge"),
        moneyVal: root.querySelector("#ig-money-val"),
        flavor: root.querySelector("#ig-flavor"),
        invCount: root.querySelector("#ig-inv-count"),
        invIcons: root.querySelector("#ig-inv-icons"),
        catGrid: root.querySelector("#ig-cat-grid"),
        createBtn: root.querySelector("#ig-create-btn"),
        createSub: root.querySelector("#ig-create-sub"),
        upgradeList: root.querySelector("#ig-upgrade-list"),
        shopList: root.querySelector("#ig-shop-list"),
        log: root.querySelector("#ig-log"),
        fx: root.querySelector("#ig-fx-layer"),
        modalBackdrop: root.querySelector("#ig-modal-backdrop"),
        modalBody: root.querySelector("#ig-modal-body"),
        modalClose: root.querySelector("#ig-modal-close"),
      };

      this.el.createBtn.addEventListener("click", () => this.sellAll());
      this.el.modalClose.addEventListener("click", () => this.closeModal());
      this.el.modalBackdrop.addEventListener("click", (e) => {
        if (e.target === this.el.modalBackdrop) this.closeModal();
      });
      root.querySelector('[data-act="menu"]').addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });

      this.renderCategoryCards();
      this.renderUpgrades();
      this.renderShop();
      this.updateCreateSub();
      this.pickFlavor(true);
      this.addLog("Day one. Time to write your first GameObject.", "");

      this.interval = setInterval(() => this.tick(), TICK_MS);
    }

    /* ---------- derived stats ---------- */

    speedMult() {
      const lvl = this.levels.speed;
      let m = lvl === 0 ? 1 : SPEED_TIERS[lvl - 1].mult;
      if (this.buffActive("coffee")) m *= 0.5;
      return m;
    }

    writeTimeFor(catId) {
      const cat = CATEGORY_MAP[catId];
      return Math.max(0.15, cat.baseTime * this.speedMult());
    }

    saleValue() {
      const lvl = this.levels.value;
      let v = lvl === 0 ? BASE_VALUE : VALUE_TIERS[lvl - 1].value;
      if (this.buffActive("pitch")) v *= 1.5;
      return v;
    }

    autoRate() {
      const lvl = this.levels.auto;
      let r = lvl === 0 ? 0 : AUTO_TIERS[lvl - 1].rate;
      if (this.buffActive("energy")) r *= 2;
      return r;
    }

    reviewRange() {
      const lvl = this.levels.review;
      return lvl === 0 ? BASE_REVIEW : REVIEW_TIERS[lvl - 1];
    }

    buffActive(id) {
      return !!this.buffs[id] && this.buffs[id] > Date.now();
    }

    totalInventory() {
      return CATEGORIES.reduce((sum, c) => sum + (this.inventory[c.id] || 0), 0);
    }

    currentCaliber() {
      return CATEGORIES.reduce((sum, c) => sum + (this.inventory[c.id] || 0) * c.caliber, BASE_CALIBER);
    }

    /* ---------- main loop ---------- */

    tick() {
      const dt = TICK_MS / 1000;
      const now = Date.now();

      // expire buffs
      let buffsChanged = false;
      Object.keys(this.buffs).forEach((id) => {
        if (this.buffs[id] <= now) {
          delete this.buffs[id];
          buffsChanged = true;
          const item = SHOP_ITEMS.find((s) => s.id === id);
          this.addLog((item ? item.name : id) + " wore off.", "");
        }
      });
      if (this.lucky.armed && this.lucky.expiresAt <= now) {
        this.lucky.armed = false;
        buffsChanged = true;
        this.addLog("Your Lucky Commit went stale.", "");
      }

      // auto production — each hire writes a random category, same as a human would
      const rate = this.autoRate();
      if (rate > 0) {
        this.autoAccum += rate * dt;
        while (this.autoAccum >= 1) {
          this.autoAccum -= 1;
          const randCat = CATEGORIES[randInt(0, CATEGORIES.length - 1)].id;
          this.addGameObject(randCat, false);
        }
      }

      // manual write progress
      if (this.writingCat) {
        this.writeElapsed += dt;
        const target = this.writeTimeFor(this.writingCat);
        const pct = Math.min(1, this.writeElapsed / target);
        const els = this.catEls[this.writingCat];
        els.fill.style.width = pct * 100 + "%";
        if (pct >= 1) {
          const cat = this.writingCat;
          this.writingCat = null;
          this.writeElapsed = 0;
          this.finishWriteUI(cat);
          this.addGameObject(cat, true);
        }
      }

      // flavor rotation
      this.flavorTimer += dt;
      if (this.flavorTimer > 4) {
        this.flavorTimer = 0;
        this.pickFlavor(false);
      }

      if (buffsChanged) {
        this.renderShop();
        this.updateCategoryTimes();
      } else {
        this.updateShopTimers();
      }
      this.updateUpgradeAffordability();
    }

    pickFlavor(force) {
      const line = FLAVOR_LINES[randInt(0, FLAVOR_LINES.length - 1)];
      if (force || line !== this.el.flavor.textContent) {
        this.el.flavor.textContent = line;
      }
    }

    /* ---------- categories / writing / inventory ---------- */

    renderCategoryCards() {
      const box = this.el.catGrid;
      box.innerHTML = "";
      this.catEls = {};
      CATEGORIES.forEach((cat) => {
        const card = document.createElement("div");
        card.className = "ig-cat-card";
        card.style.borderColor = hexToRgba(cat.color, 0.55);
        card.style.setProperty("--cat-glow", hexToRgba(cat.color, 0.55));
        card.innerHTML =
          '<div class="ig-cat-top">' +
          '<span class="ig-cat-icon">' + cat.icon + "</span>" +
          "<div>" +
          '<div class="ig-cat-name">' + cat.label + "</div>" +
          '<div class="ig-cat-caliber">+' + cat.caliber.toFixed(2) + " Caliber</div>" +
          "</div>" +
          "</div>" +
          '<div class="ig-cat-time">' + this.writeTimeFor(cat.id).toFixed(2) + "s</div>" +
          '<div class="ig-cat-progress"><div class="ig-cat-progress-fill"></div></div>' +
          '<button class="ig-cat-btn" type="button">Write</button>';
        const fill = card.querySelector(".ig-cat-progress-fill");
        fill.style.background = "linear-gradient(90deg," + cat.dark + "," + cat.color + ")";
        const btn = card.querySelector(".ig-cat-btn");
        btn.style.background = "linear-gradient(180deg," + cat.color + "," + cat.dark + ")";
        btn.addEventListener("click", () => this.startWrite(cat.id));
        box.appendChild(card);
        this.catEls[cat.id] = { card: card, btn: btn, fill: fill, time: card.querySelector(".ig-cat-time") };
      });
    }

    updateCategoryTimes() {
      CATEGORIES.forEach((cat) => {
        const els = this.catEls[cat.id];
        if (els) els.time.textContent = this.writeTimeFor(cat.id).toFixed(2) + "s";
      });
    }

    startWrite(catId) {
      if (this.writingCat) return;
      this.writingCat = catId;
      this.writeElapsed = 0;
      Object.keys(this.catEls).forEach((id) => {
        const els = this.catEls[id];
        els.btn.disabled = true;
        if (id !== catId) els.card.classList.add("ig-cat-busy");
      });
      this.catEls[catId].card.classList.add("ig-cat-active");
    }

    finishWriteUI(catId) {
      Object.keys(this.catEls).forEach((id) => {
        const els = this.catEls[id];
        els.btn.disabled = false;
        els.card.classList.remove("ig-cat-busy");
        els.fill.style.width = "0%";
      });
      this.catEls[catId].card.classList.remove("ig-cat-active");
    }

    addGameObject(catId, big) {
      this.inventory[catId] = (this.inventory[catId] || 0) + 1;
      const total = this.totalInventory();
      this.el.invCount.textContent = fmtNum(total);
      this.el.invCount.classList.remove("ig-pop");
      void this.el.invCount.offsetWidth;
      this.el.invCount.classList.add("ig-pop");
      this.renderInvIcons();

      if (big) {
        const cat = CATEGORY_MAP[catId];
        const r = this.catEls[catId].card.getBoundingClientRect();
        this.floatText(r.left + r.width / 2, r.top, "+1", cat.color);
        this.spawnParticles(r.left + r.width / 2, r.top + r.height / 2, cat.color, 8);
      }

      this.el.createBtn.disabled = total < SELL_MIN_OBJECTS;
      this.updateCreateSub();
    }

    updateCreateSub() {
      const total = this.totalInventory();
      if (total < SELL_MIN_OBJECTS) {
        const need = SELL_MIN_OBJECTS - total;
        this.el.createSub.textContent = "Need " + need + " more GameObject" + (need === 1 ? "" : "s");
        return;
      }
      const caliber = this.currentCaliber();
      const est = Math.round(total * this.saleValue() * caliber);
      this.el.createSub.textContent = "Sell " + total + " (Caliber " + caliber.toFixed(2) + ") for ~" + fmtMoney(est);
    }

    renderInvIcons() {
      const box = this.el.invIcons;
      box.innerHTML = "";
      const total = this.totalInventory();
      let shown = 0;
      for (let i = 0; i < CATEGORIES.length && shown < MAX_ICONS_SHOWN; i++) {
        const cat = CATEGORIES[i];
        const n = this.inventory[cat.id] || 0;
        for (let j = 0; j < n && shown < MAX_ICONS_SHOWN; j++, shown++) {
          const d = document.createElement("div");
          d.className = "ig-inv-icon";
          d.style.background = "linear-gradient(160deg," + cat.color + "," + cat.dark + ")";
          d.textContent = cat.icon;
          box.appendChild(d);
        }
      }
      if (total > MAX_ICONS_SHOWN) {
        const d = document.createElement("div");
        d.className = "ig-inv-icon ig-overflow";
        d.textContent = "+" + (total - MAX_ICONS_SHOWN);
        box.appendChild(d);
      }
    }

    /* ---------- selling ---------- */

    sellAll() {
      const total = this.totalInventory();
      if (total < SELL_MIN_OBJECTS) return;
      const counts = Object.assign({}, this.inventory);
      CATEGORIES.forEach((c) => {
        this.inventory[c.id] = 0;
      });
      this.el.invCount.textContent = "0";
      this.renderInvIcons();
      this.el.createBtn.disabled = true;
      this.updateCreateSub();

      let score;
      if (this.lucky.armed) {
        score = randInt(95, 99);
        this.lucky.armed = false;
        this.addLog("Lucky Commit paid off!", "ig-log-sale");
        this.renderShop();
      } else {
        const range = this.reviewRange();
        score = randInt(range.min, range.max);
      }

      const reviewMult = score / 70;
      const perObj = this.saleValue();
      const baseValue = total * perObj * reviewMult;

      const catContribs = [];
      let caliber = BASE_CALIBER;
      CATEGORIES.forEach((cat) => {
        const n = counts[cat.id] || 0;
        if (n > 0) {
          const subtotal = n * cat.caliber;
          caliber += subtotal;
          catContribs.push({ cat: cat, count: n, subtotal: subtotal });
        }
      });

      const finalValue = Math.max(1, Math.round(baseValue * caliber));
      this.addMoney(finalValue);

      const reviewer = REVIEWERS[randInt(0, REVIEWERS.length - 1)];
      this.addLog(
        reviewer + ": " + score + "/100 — earned " + fmtMoney(finalValue) + " (Caliber " + caliber.toFixed(2) + ")",
        "ig-log-sale"
      );
      this.showSaleModal(score, baseValue, catContribs, caliber, finalValue);

      const r = this.el.createBtn.getBoundingClientRect();
      this.spawnParticles(r.left + r.width / 2, r.top + r.height / 2, scoreColor(score), 22);
      this.root.querySelector(".ig-app").classList.remove("ig-shake");
      void this.root.querySelector(".ig-app").offsetWidth;
      this.root.querySelector(".ig-app").classList.add("ig-shake");

      this.checkMilestones();
    }

    showSaleModal(score, baseValue, catContribs, caliber, finalValue) {
      const step = 70;
      let delay = 0;
      let rows = "";

      rows += '<div class="ig-bd-row ig-bd-base" style="animation-delay:' + delay + 'ms"><span>Base Value</span><span>' + fmtMoney(baseValue) + "</span></div>";
      delay += step;
      rows += '<div class="ig-bd-row" style="border-left-color:rgba(255,255,255,.4);animation-delay:' + delay + 'ms"><span>Base Caliber</span><span>×' + BASE_CALIBER.toFixed(2) + "</span></div>";
      delay += step;
      catContribs.forEach((c) => {
        rows +=
          '<div class="ig-bd-row" style="border-left-color:' + c.cat.color + ";animation-delay:" + delay + 'ms">' +
          "<span>" + c.cat.icon + " " + c.cat.label + " ×" + c.count + "</span><span>+" + c.subtotal.toFixed(2) + "</span></div>";
        delay += step;
      });
      rows += '<div class="ig-bd-row ig-bd-caliber" style="animation-delay:' + delay + 'ms"><span>Caliber</span><span>×' + caliber.toFixed(2) + "</span></div>";
      delay += step;
      rows += '<div class="ig-bd-row ig-bd-final" style="animation-delay:' + delay + 'ms"><span>Final Value</span><span>' + fmtMoney(finalValue) + "</span></div>";

      this.el.modalBody.innerHTML =
        '<div class="ig-review-score" style="color:' + scoreColor(score) + '">' + score + "/100</div>" +
        '<div class="ig-review-title">' + scoreTitle(score) + "</div>" +
        '<div class="ig-breakdown">' + rows + "</div>";

      this.el.modalBackdrop.classList.add("ig-open");
    }

    closeModal() {
      this.el.modalBackdrop.classList.remove("ig-open");
    }

    checkMilestones() {
      while (this.milestoneIdx < MILESTONES.length && this.money >= MILESTONES[this.milestoneIdx].amt) {
        this.addLog(MILESTONES[this.milestoneIdx].msg, "ig-log-milestone");
        this.milestoneIdx++;
      }
    }

    /* ---------- money / fx ---------- */

    addMoney(delta) {
      this.money += delta;
      this.el.moneyVal.textContent = fmtMoney(this.money);
      this.pulseMoney(delta >= 0);
    }

    spendMoney(amount) {
      this.money -= amount;
      this.el.moneyVal.textContent = fmtMoney(this.money);
      this.pulseMoney(false);
    }

    pulseMoney(up) {
      const cls = up ? "ig-pulse-up" : "ig-pulse-down";
      const other = up ? "ig-pulse-down" : "ig-pulse-up";
      this.el.moneyBadge.classList.remove(other, cls);
      void this.el.moneyBadge.offsetWidth;
      this.el.moneyBadge.classList.add(cls);
    }

    floatText(clientX, clientY, text, color) {
      const rootRect = this.root.getBoundingClientRect();
      const d = document.createElement("div");
      d.className = "ig-float-text";
      d.style.left = clientX - rootRect.left + "px";
      d.style.top = clientY - rootRect.top + "px";
      d.style.color = color;
      d.textContent = text;
      this.el.fx.appendChild(d);
      setTimeout(() => d.remove(), 950);
    }

    spawnParticles(clientX, clientY, color, count) {
      const rootRect = this.root.getBoundingClientRect();
      const x = clientX - rootRect.left;
      const y = clientY - rootRect.top;
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "ig-particle";
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 90;
        p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
        p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
        p.style.setProperty("--rot", Math.round(Math.random() * 360 - 180) + "deg");
        p.style.left = x + "px";
        p.style.top = y + "px";
        p.style.background = color;
        this.el.fx.appendChild(p);
        setTimeout(() => p.remove(), 850);
      }
    }

    addLog(msg, cls) {
      const d = document.createElement("div");
      d.className = "ig-log-entry" + (cls ? " " + cls : "");
      d.textContent = msg;
      this.el.log.insertBefore(d, this.el.log.firstChild);
      while (this.el.log.children.length > LOG_MAX) {
        this.el.log.removeChild(this.el.log.lastChild);
      }
    }

    /* ---------- upgrades ---------- */

    renderUpgrades() {
      const box = this.el.upgradeList;
      box.innerHTML = "";
      TRACKS.forEach((track) => {
        const level = this.levels[track.id];
        const maxed = level >= track.tiers.length;
        const card = document.createElement("div");
        card.className = "ig-card";
        card.style.borderLeft = "3px solid " + track.color;
        const currentDesc = this.trackCurrentDesc(track, level);
        const next = maxed ? null : track.tiers[level];
        const afford = !maxed && this.money >= next.cost;
        card.innerHTML =
          '<div class="ig-card-icon">' + track.icon + "</div>" +
          '<div class="ig-card-body">' +
          '<div class="ig-card-name">' + track.label + " — Lv" + level + "/" + track.tiers.length + "</div>" +
          '<div class="ig-card-desc">' + currentDesc + (maxed ? "" : " · next: " + next.name) + "</div>" +
          "</div>" +
          '<button class="ig-card-btn" type="button">' +
          (maxed ? "✓ MAX" : (afford ? "Buy " : "") + fmtMoney(next.cost)) +
          "</button>";
        const btn = card.querySelector("button");
        if (maxed) {
          btn.disabled = true;
          btn.classList.add("ig-maxed-btn");
          card.classList.add("ig-maxed");
        } else {
          btn.disabled = !afford;
          btn.classList.toggle("ig-buy-ready", afford);
          card.classList.toggle("ig-afford", afford);
          btn.addEventListener("click", () => this.buyTrack(track));
        }
        box.appendChild(card);
      });
    }

    // Buffs re-render on their own change; upgrades don't, since buying one
    // is the only event that used to refresh this list — so a sale that
    // makes a tier newly affordable left its button stuck looking disabled
    // until the player happened to buy something else. Called every tick to
    // keep "can I afford this" live instead of stale.
    updateUpgradeAffordability() {
      const cards = this.el.upgradeList.children;
      TRACKS.forEach((track, i) => {
        const card = cards[i];
        if (!card) return;
        const level = this.levels[track.id];
        if (level >= track.tiers.length) return; // maxed cards don't change
        const next = track.tiers[level];
        const afford = this.money >= next.cost;
        const btn = card.querySelector(".ig-card-btn");
        if (btn.disabled === afford) {
          btn.disabled = !afford;
          btn.textContent = (afford ? "Buy " : "") + fmtMoney(next.cost);
          btn.classList.toggle("ig-buy-ready", afford);
          card.classList.toggle("ig-afford", afford);
        }
      });
    }

    trackCurrentDesc(track, level) {
      if (track.id === "speed") {
        return Math.round(this.speedMult() * 100) + "% of base write time";
      }
      if (track.id === "value") {
        return fmtMoney(this.saleValue()) + " per GameObject";
      }
      if (track.id === "auto") {
        const r = this.autoRate();
        return r > 0 ? r.toFixed(2) + " auto/sec" : "no auto-writing yet";
      }
      if (track.id === "review") {
        const rr = this.reviewRange();
        return "reviews " + rr.min + "-" + rr.max;
      }
      return "";
    }

    buyTrack(track) {
      const level = this.levels[track.id];
      if (level >= track.tiers.length) return;
      const tier = track.tiers[level];
      if (this.money < tier.cost) return;
      this.spendMoney(tier.cost);
      this.levels[track.id] = level + 1;
      this.addLog("Upgraded " + track.label + ": " + tier.name + ".", "");
      this.renderUpgrades();
      this.updateCategoryTimes();
      this.updateCreateSub();
    }

    /* ---------- shop ---------- */

    renderShop() {
      const box = this.el.shopList;
      box.innerHTML = "";
      SHOP_ITEMS.forEach((item) => {
        const card = document.createElement("div");
        card.className = "ig-card";
        const active = item.kind === "arm" ? this.lucky.armed : this.buffActive(item.id);
        if (active) card.classList.add("ig-armed");
        const afford = this.money >= item.cost;
        card.classList.toggle("ig-afford", afford && !active);
        card.innerHTML =
          '<div class="ig-card-icon">' + item.icon + "</div>" +
          '<div class="ig-card-body">' +
          '<div class="ig-card-name">' + item.name + (active ? " — active" : "") + "</div>" +
          '<div class="ig-card-desc">' + item.desc + "</div>" +
          "</div>" +
          '<button class="ig-card-btn' + (afford ? " ig-buy-ready" : "") + '" type="button">' +
          (afford ? "Buy " : "") + fmtMoney(item.cost) +
          "</button>" +
          '<div class="ig-card-bar"></div>';
        const btn = card.querySelector("button");
        btn.disabled = !afford;
        btn.addEventListener("click", () => this.buyBuff(item, btn));
        box.appendChild(card);
      });
      this.updateShopTimers();
    }

    buyBuff(item, btn) {
      if (this.money < item.cost) return;
      this.spendMoney(item.cost);
      const now = Date.now();
      if (item.kind === "arm") {
        this.lucky.armed = true;
        this.lucky.expiresAt = now + item.duration * 1000;
        this.addLog("Lucky Commit armed — next sale is guaranteed great.", "");
      } else {
        this.buffs[item.id] = now + item.duration * 1000;
        this.addLog(item.name + " activated!", "");
      }
      btn.classList.remove("ig-flash");
      void btn.offsetWidth;
      btn.classList.add("ig-flash");
      this.renderShop();
      this.renderUpgrades();
      this.updateCategoryTimes();
      this.updateCreateSub();
    }

    updateShopTimers() {
      const cards = this.el.shopList.querySelectorAll(".ig-card");
      SHOP_ITEMS.forEach((item, i) => {
        const card = cards[i];
        if (!card) return;
        const bar = card.querySelector(".ig-card-bar");
        const btn = card.querySelector(".ig-card-btn");
        if (item.kind === "arm") {
          if (this.lucky.armed) {
            const remain = Math.max(0, this.lucky.expiresAt - Date.now());
            bar.style.width = (remain / (item.duration * 1000)) * 100 + "%";
          } else {
            bar.style.width = "0%";
          }
        } else if (this.buffActive(item.id)) {
          const remain = Math.max(0, this.buffs[item.id] - Date.now());
          bar.style.width = (remain / (item.duration * 1000)) * 100 + "%";
        } else {
          bar.style.width = "0%";
        }
        if (btn) {
          const afford = this.money >= item.cost;
          if (btn.disabled === afford) {
            btn.disabled = !afford;
            btn.textContent = (afford ? "Buy " : "") + fmtMoney(item.cost);
            btn.classList.toggle("ig-buy-ready", afford);
          }
          const active = item.kind === "arm" ? this.lucky.armed : this.buffActive(item.id);
          card.classList.toggle("ig-afford", afford && !active);
        }
      });
    }

    destroy() {
      clearInterval(this.interval);
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("ig-style")) return;
    const s = document.createElement("style");
    s.id = "ig-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function launchIndieGrind() {
    if (window.indieGrindGame) return window.indieGrindGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "ig-root";
    root.innerHTML = HTML;
    document.getElementById("game-container").appendChild(root);

    const game = new IndieGrind(root);
    const handle = {
      root: root,
      game: game,
      destroy: function () {
        game.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.indieGrindGame = handle;
    return handle;
  }

  window.launchIndieGrind = launchIndieGrind;
})();
