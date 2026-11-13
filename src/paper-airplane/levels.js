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
 *   solids rects {x, y, w, h, type}:
 *            "desk"   slides/settles (bounce 0.35)      "cork"  sticks, resets next to it
 *            "glass"  bouncy (0.78)                     "spring" top kicks the plane up (700 px/s)
 *            "shelf"  ONE-WAY: passes through from below/the side, catches a falling plane on top
 *   fans   wind rects {x, y, w, h, forceX, forceY}  (any direction: updrafts, downdrafts, crosswinds)
 *   hazards rects {x, y, w, h, label}
 *   width  (optional) world width in px for a SCROLLING level (default W): the camera follows the
 *          plane across it. Everything is still in sheet coordinates (x grows right up to `width`).
 *   bumpers (optional) circles {x, y, r}: pinball rebounders
 *   tubes   (optional) pairs {a: {x, y, dir}, b: {x, y, dir}}: enter one mouth, leave the other
 *           heading along its `dir` (degrees, 0 = right, 90 = down, -90 = up)
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
    {
      // Spring pad: a bounce higher than any throw, up through a one-way shelf.
      name: "Spring Break",
      par: 3,
      start: { x: 115, y: 580 },
      goal: { x: 361, y: 258, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 340, y: 582, w: 64, h: 18, type: "spring" },
        { x: 355, y: 314, w: 95, h: 14, type: "shelf" }, // one-way: the spring's rise passes up through it
      ],
      fans: [],
      hazards: [{ x: 188, y: 576, w: 55, h: 24, label: "SPILL" }],
    },
    {
      // Bumpers: pinball up to the bin ledge.
      name: "Pinball Desk",
      par: 4,
      start: { x: 115, y: 580 },
      goal: { x: 326, y: 243, w: 118, h: 56 }, // a wide bin: pinball is fiddly, so the target is generous
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 320, y: 299, w: 130, h: 14, type: "shelf" }, // one-way bin shelf
      ],
      bumpers: [
        { x: 288, y: 432, r: 37 },
        { x: 358, y: 368, r: 28 },
      ],
      fans: [],
      hazards: [{ x: 150, y: 576, w: 70, h: 24, label: "COFFEE" }],
    },
    {
      // One-way shelves: pass up through them, land on top.
      name: "Paper Stairs",
      par: 3,
      start: { x: 115, y: 580 },
      goal: { x: 350, y: 244, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 170, y: 450, w: 130, h: 14, type: "shelf" },
        { x: 310, y: 300, w: 140, h: 14, type: "shelf" }, // bin sits on this one
      ],
      fans: [],
      hazards: [{ x: 330, y: 576, w: 90, h: 24, label: "SPILL" }],
    },
    {
      // Mail tubes: pop in on one side of the wall, out the other.
      name: "Mail Room",
      par: 2,
      start: { x: 115, y: 580 },
      goal: { x: 345, y: 544, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 200, y: 140, w: 24, h: 460, type: "cork" }, // the wall between the halves
      ],
      tubes: [{ a: { x: 150, y: 430, dir: -90 }, b: { x: 385, y: 330, dir: 90 } }],
      fans: [],
      hazards: [{ x: 235, y: 576, w: 80, h: 24, label: "COFFEE" }],
    },
    {
      // Up one side on an updraft, down the other on a downdraft.
      name: "Draft Day",
      par: 3,
      start: { x: 115, y: 580 },
      goal: { x: 351, y: 544, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 295, y: 316, w: 24, h: 284, type: "cork" }, // wall: lobs can't clear it
      ],
      fans: [
        { x: 145, y: 298, w: 106, h: 302, forceX: 0, forceY: -620 }, // updraft
        { x: 145, y: 233, w: 179, h: 141, forceX: 197, forceY: 0 }, // crosswind carries you over the wall
        { x: 323, y: 130, w: 117, h: 410, forceX: 0, forceY: 623 }, // downdraft into the bin
      ],
      hazards: [{ x: 205, y: 576, w: 50, h: 24, label: "SPILL" }],
    },
    {
      // Two tubes chained through two walls: one throw into the first mouth does it.
      name: "Switchboard",
      par: 2,
      start: { x: 115, y: 580 },
      goal: { x: 358, y: 544, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 190, y: 250, w: 24, h: 350, type: "cork" },
        { x: 330, y: 250, w: 24, h: 350, type: "cork" },
      ],
      tubes: [
        { a: { x: 140, y: 440, dir: -90 }, b: { x: 262, y: 480, dir: -90 } },
        { a: { x: 262, y: 350, dir: 0 }, b: { x: 400, y: 300, dir: 90 } },
      ],
      fans: [],
      hazards: [{ x: 225, y: 576, w: 90, h: 24, label: "COFFEE" }],
    },
    {
      // Finale: spring up to a one-way shelf, then a shallow throw into a tube that drops into the bin.
      name: "The Boss's Desk",
      par: 3,
      start: { x: 115, y: 580 },
      goal: { x: 358, y: 544, w: 84, h: 56 },
      solids: [
        { x: 0, y: 600, w: W, h: 200, type: "desk" },
        { x: 150, y: 582, w: 64, h: 18, type: "spring" },
        { x: 90, y: 330, w: 150, h: 14, type: "shelf" }, // one-way: land on it from the spring's rise
        { x: 285, y: 250, w: 24, h: 350, type: "cork" }, // wall: no lobbing straight to the bin
      ],
      tubes: [{ a: { x: 262, y: 290, dir: -90 }, b: { x: 395, y: 300, dir: 90 } }],
      fans: [],
      hazards: [{ x: 225, y: 576, w: 56, h: 24, label: "COFFEE" }],
    },
    {
      // First scrolling level (4 sheets wide): thermals keep the plane aloft all the way across.
      name: "Thermal Express",
      par: 3,
      width: 1800,
      start: { x: 115, y: 560 },
      goal: { x: 1650, y: 544, w: 84, h: 56 },
      solids: [{ x: 0, y: 600, w: 1800, h: 200, type: "desk" }],
      fans: [
        // Tilted thermals: lift AND a push downrange (a straight updraft just stacks the plane in a column).
        { x: 300, y: 200, w: 120, h: 400, forceX: 170, forceY: -640 },
        { x: 630, y: 200, w: 120, h: 400, forceX: 170, forceY: -640 },
        { x: 960, y: 200, w: 120, h: 400, forceX: 170, forceY: -640 },
        { x: 1290, y: 200, w: 120, h: 400, forceX: 170, forceY: -640 },
      ],
      hazards: [
        { x: 470, y: 576, w: 60, h: 24, label: "COFFEE" },
        { x: 1100, y: 576, w: 60, h: 24, label: "SPILL" },
      ],
    },
  ];

  return { W, H, LEVELS };
});
