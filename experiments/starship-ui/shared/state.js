/* Shared mock game state for all three skins.
 *
 * Every number here is *design data*: the UI never prints it by default. Each
 * skin turns it into something you can read at a glance (a posture, a light, a
 * tilt, a height) and only shows the digits when the "numbers lens" is on.
 * Same state, three renderers -> proves the ideas live in the data model, not
 * the art.
 */
(function () {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  // mood 0..1 -> a word + a stable bucket every skin maps to its own visuals
  const MOODS = [
    { min: 0.85, id: "radiant", word: "Radiant" },
    { min: 0.65, id: "content", word: "Content" },
    { min: 0.45, id: "steady", word: "Steady" },
    { min: 0.3, id: "restless", word: "Restless" },
    { min: 0.15, id: "strained", word: "Strained" },
    { min: 0, id: "fraying", word: "Fraying" },
  ];
  const moodOf = (m) => MOODS.find((x) => m >= x.min);

  const STATE = {
    ship: {
      name: "Marigold",
      day: 214,
      location: "Vesper",
      systems: { hull: 0.78, engines: 0.5, power: 0.9, life: 0.96, shields: 0.68, sensors: 0.85 },
      supplies: { fuel: 0.42, rations: 0.7, parts: 0.3, credits: 12400 },
      holdCap: 20,
    },

    // --- crew ---------------------------------------------------------------
    crew: [
      { id: "reyes", name: "Ines Reyes", role: "Captain", room: "bridge", mood: 0.62, doing: "plotting",
        quote: "If the Tessari trust us first, everything after is easy." },
      { id: "juno", name: "Juno Falk", role: "Pilot", room: "bridge", mood: 0.33, doing: "fidgeting",
        quote: "Forty days since I stood on actual dirt.", wants: "shore leave" },
      { id: "tobe", name: "Tobe Kwan", role: "Engineer", room: "engine", mood: 0.17, doing: "repairing",
        quote: "Third shift running. Coolant loop two keeps whining.", wants: "rest" },
      { id: "ama", name: "Dr. Ama Adeyemi", role: "Medic", room: "medbay", mood: 0.78, doing: "tending",
        quote: "I'll look in on Tobe. He won't ask." },
      { id: "ferro", name: "Ferro", role: "Quartermaster", room: "galley", mood: 0.92, doing: "cooking",
        quote: "The rations are fine. The rations are always fine." },
      { id: "pip", name: "Pip Lin", role: "Xenologist", room: "lab", mood: 0.88, doing: "studying",
        quote: "Sable's spires are older than the Compact. Older than anyone." },
    ],
    // bond between two crew, -1 (friction) .. +1 (close). Drawn as threads for the selected person.
    bonds: [
      ["tobe", "juno", -0.6], ["tobe", "ama", 0.8], ["reyes", "juno", 0.5], ["pip", "ferro", 0.7],
    ],

    // --- trade hub: Kestrel Landing, Ossia ----------------------------------
    market: {
      place: "Kestrel Landing", world: "Ossia",
      // ratio = local price / galaxy average. <1 cheap here, >1 dear here.
      goods: [
        { id: "ice", name: "Glacier Ice", base: 30, ratio: 0.62, stock: 0.9, trend: 0, held: 0 },
        { id: "grain", name: "Grain", base: 45, ratio: 0.86, stock: 0.7, trend: -1, held: 3 },
        { id: "salt", name: "Starsalt", base: 80, ratio: 0.55, stock: 0.8, trend: 0, held: 0 },
        { id: "cells", name: "Fuel Cells", base: 60, ratio: 1.0, stock: 0.5, trend: 1, held: 0 },
        { id: "alloy", name: "Alloys", base: 95, ratio: 1.12, stock: 0.4, trend: 0, held: 3 },
        { id: "glass", name: "Glassware", base: 110, ratio: 1.34, stock: 0.3, trend: 1, held: 2 },
        { id: "med", name: "Medicine", base: 120, ratio: 1.58, stock: 0.15, trend: 1, held: 4 },
        { id: "data", name: "Relic Data", base: 200, ratio: 1.8, stock: 0.1, trend: 0, held: 1 },
      ],
      // warmth 0..1: how much this faction likes you
      factions: [
        { id: "compact", name: "Tessari Compact", warmth: 0.74,
          asks: { good: "med", qty: 4, line: "Fever ward is out of medicine." } },
        { id: "dockers", name: "Dockers' Union", warmth: 0.5 },
        { id: "free", name: "Free Ossians", warmth: 0.22 },
      ],
      // routes out of here: profit = how well your CURRENT hold sells there, risk = danger on the way
      routes: [
        { id: "vesper", name: "Vesper", jumps: 1, profit: 0.28, risk: 0.1 },
        { id: "lumen", name: "Lumen Gate", jumps: 1, profit: 0.5, risk: 0.2 },
        { id: "kharn", name: "Kharn", jumps: 2, profit: 0.78, risk: 0.35 },
        { id: "halloran", name: "Halloran's Reach", jumps: 3, profit: 1.0, risk: 0.85 },
      ],
    },

    // --- exploration: Sable --------------------------------------------------
    planet: {
      name: "Sable", surveyed: 0.46, // fraction of the surface mapped
      air: 0.6, // away-team reserves (air + charge)
      stormEta: 0.35, // 0 = on top of you .. 1 = far away
      team: ["reyes", "pip", "ferro"],
      // pois: kind decides the glyph; seen=false means only a "?" is known
      pois: [
        { id: "probe", kind: "wreck", name: "Wrecked probe", note: "Salvageable. Someone got here first.", seen: true },
        { id: "vein", kind: "vein", name: "Lumen crystal vein", note: "Rich. Worth a sample run.", seen: true },
        { id: "spires", kind: "ruin", name: "The Spires", note: "Pip hasn't stopped talking about them.", seen: true },
        { id: "hesk", kind: "people", name: "Hesk settlement", note: "Curious, cautious. They have been watching you.", rapport: 0.4, seen: true },
        { id: "sink", kind: "hazard", name: "Sinkholes", note: "The ground here is hollow.", seen: true },
        { id: "signal", kind: "unknown", name: "Unknown signal", note: "Faint, regular, not natural.", seen: false },
      ],
    },

    // star systems in jump range for the little starmaps
    map: [
      { id: "vesper", name: "Vesper", x: 0, y: 0, here: true },
      { id: "ossia", name: "Ossia", x: 0.5, y: -0.25 },
      { id: "lumen", name: "Lumen Gate", x: -0.45, y: -0.4 },
      { id: "kharn", name: "Kharn", x: 0.2, y: 0.55 },
      { id: "halloran", name: "Halloran's Reach", x: 0.95, y: 0.35 },
      { id: "sable", name: "Sable", x: -0.35, y: 0.38 },
    ],
  };

  STATE.moodOf = moodOf;
  STATE.crewById = Object.fromEntries(STATE.crew.map((c) => [c.id, c]));
  STATE.goodById = Object.fromEntries(STATE.market.goods.map((g) => [g.id, g]));
  STATE.clamp = clamp;
  STATE.heldTotal = STATE.market.goods.reduce((n, g) => n + g.held, 0);
  window.STATE = STATE;

  /* ---- tiny helpers every skin uses --------------------------------------- */
  // seeded RNG so hand-drawn wobble and terrain are stable between redraws
  window.rng = function (seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  };

  // chrome shared by every skin page: tabs + numbers lens. Skins pass a mount fn.
  window.initShell = function (opts) {
    const tabs = ["ship", "market", "explore"];
    const q = new URLSearchParams(location.search);
    const hash = (location.hash || "#ship").slice(1);
    let cur = tabs.includes(hash) ? hash : "ship";
    let lens = q.get("lens") === "1";
    const root = document.querySelector("#stage");
    function show() {
      document.body.classList.toggle("lens", lens);
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === cur));
      const lensBtn = document.querySelector("[data-lens]");
      if (lensBtn) lensBtn.classList.toggle("on", lens);
      opts.render(cur, root, lens);
      history.replaceState(null, "", "#" + cur);
    }
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { cur = b.dataset.tab; show(); }));
    const lensBtn = document.querySelector("[data-lens]");
    if (lensBtn) lensBtn.onclick = () => { lens = !lens; show(); };
    addEventListener("keydown", (e) => {
      if (e.key === "n" || e.key === "N") { lens = !lens; show(); }
      const i = "123".indexOf(e.key);
      if (i >= 0) { cur = tabs[i]; show(); }
    });
    addEventListener("hashchange", () => { const h = location.hash.slice(1); if (tabs.includes(h)) { cur = h; show(); } });
    show();
    return { redraw: show };
  };

  // floating tooltip for anything with data-tip
  window.initTips = function (container) {
    let tip = document.querySelector(".tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip); }
    container.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) { tip.style.opacity = 0; return; }
      tip.innerHTML = t.dataset.tip;
      tip.style.opacity = 1;
      const w = tip.offsetWidth;
      tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + "px";
      tip.style.top = e.clientY + 16 + "px";
    });
    container.addEventListener("pointerleave", () => (tip.style.opacity = 0));
  };
})();
