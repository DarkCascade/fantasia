/*
 * Paper Airplane — level data (pure data, no Phaser).
 *
 * UMD: `window.PaperAirplaneLevels` in the browser, `module.exports` under Node
 * (the level checker and any future tests can read it without a browser).
 *
 * The sheet is a portrait 450x800 space (W x H), y grows DOWN. Per level:
 *   name   shown as "<n>. <name>" (keep it short: the HUD has ~25 characters)
 *   par    the throws a player using the aim preview should manage (not the minimum)
 *   start  where the plane rests
 *   goal   the bin rect {x, y, w, h}
 *   solids rects {x, y, w, h, type: "desk" | "cork" | "glass"}
 *   fans   wind rects {x, y, w, h, forceX, forceY}
 *   hazards rects {x, y, w, h, label}
 *
 * Ergonomics rules (phone-first; checked by experiments/paper-airplane/check-levels.js):
 *  - start.x >= 105 and start.y <= 620: you pull BACK, so the finger needs room
 *    to the left of and below the plane.
 *  - keep the top ~90px (HUD band) free of level geometry.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaperAirplaneLevels = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 450;
  const H = 800;

  const LEVELS = [
    {
      name: "The Cubicle Hop",
      par: 2,
      start: { x: 115, y: 560 },
      goal: { x: 345, y: 524, w: 84, h: 56 },
      solids: [
        { x: 0, y: 580, w: W, h: 220, type: "desk" }, // Floor desk (raised: room to pull down)
        { x: 245, y: 450, w: 24, h: 130, type: "cork" }, // Cubicle divider
        { x: 275, y: 190, w: 150, h: 18, type: "glass" }, // Overhead shelf
      ],
      fans: [],
      hazards: [{ x: 175, y: 556, w: 34, h: 24, label: "COFFEE" }],
    },
    {
      name: "Updraft Atrium",
      par: 3,
      start: { x: 115, y: 560 },
      goal: { x: 355, y: 268, w: 84, h: 52 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 305, y: 320, w: 145, h: 22, type: "desk" }, // High ledge
        { x: 315, y: 420, w: 24, h: 180, type: "glass" }, // Glass barrier
      ],
      fans: [
        // Floor vent updraft
        { x: 175, y: 190, w: 110, h: 410, forceX: 0, forceY: -760 },
      ],
      hazards: [{ x: 350, y: 576, w: 70, h: 24, label: "SPILL" }],
    },
    {
      name: "Corner Office Bank Shot",
      par: 3,
      start: { x: 115, y: 240 }, // rests on the mezzanine desk
      goal: { x: 30, y: 664, w: 84, h: 56 },
      solids: [
        { x: 0, y: 720, w: W, h: 80, type: "desk" },
        { x: 0, y: 250, w: 280, h: 24, type: "desk" }, // Mezzanine floor
        { x: 418, y: 100, w: 22, h: 620, type: "glass" }, // Bouncy glass back wall
        { x: 160, y: 610, w: 24, h: 110, type: "cork" }, // Guard wall before bin
      ],
      fans: [
        // AC crosswind pushing left
        { x: 250, y: 440, w: 160, h: 100, forceX: -480, forceY: 0 },
      ],
      hazards: [{ x: 190, y: 226, w: 45, h: 24, label: "COFFEE" }],
    },
  ];

  return { W, H, LEVELS };
});
