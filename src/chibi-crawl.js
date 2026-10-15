/*
 * Chibi Crawl — an isometric, cutesy-chibi party auto-battler on three.js.
 *
 * A party of three (Knight, Mage, Cleric) jogs along a winding, endlessly
 * scrolling path, stumbles into a random pack of critters, auto-fights it,
 * cheers, and jogs on — forever. There is nothing to press: this first draft
 * is a *lab* for the look and feel of the genre, so almost everything that
 * could be a design decision is a live setting (⚙ in the corner, or hotkeys):
 *
 *   - Camera view   Iso / Low / Tactical / Side — a single perspective camera
 *                   whose pitch, azimuth, distance and fov are all damped, so
 *                   switching presets mid-fight is a smooth dolly-zoom.
 *   - Battle camera Fixed (arena shot) / Fit (reframes to the live combatants)
 *                   / Director (Fit + event-driven shots: wind-up close-ups,
 *                   crit and kill punches, slow-mo specials, a finishing shot).
 *   - Formations    Wedge / Line / Column / Stagger, separately for the party
 *                   and the enemy pack; the same slots drive the run and the
 *                   fight, so changing it live visibly reshuffles everyone.
 *   - Pack size     1-6 enemies, or Random.
 *   - UI            bars floating over heads, a bottom party panel, or both.
 *
 * Everything is generated at runtime from primitives (no assets): toon-shaded
 * spheres/cylinders with inverted-hull outlines, merged vertex-coloured props,
 * canvas-drawn sprites for particles. The simulation (`Game.step`) is
 * independent of rendering so it can be driven headlessly for balance checks.
 *
 * Created on demand via window.launchChibiCrawl(); three.js is imported on
 * first use like Slopeman / Gloom Hollow 3D.
 */
(function () {
  "use strict";

  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function resolve(rel) {
    return new URL(rel, SELF_SRC || window.location.href).href;
  }
  var THREE_URL = resolve("../vendor/three.module.min.js");
  var BGU_URL = resolve("../vendor/jsm/utils/BufferGeometryUtils.js");
  // Meshy-generated level art (baked by experiments/chibi-level-art/bake.py).
  // Optional: if it fails to load the primitive props below are used instead.
  var PROPS_URL = resolve("./chibi-crawl/props.json");
  var PROP_DATA = null;
  // Stylised ambientCG (CC0) ground/road/sand textures (baked by
  // experiments/chibi-level-art/tex.py). Optional like the props: if any fails
  // to load, or the URL says ?tex=0, the procedural canvas textures are used.
  var TEX_BASE = resolve("./chibi-crawl/tex/");
  var PHOTO = null; // { ground: [img x3], road: img, sand: img }
  var PHOTO_OFF = /[?&]tex=0(?:&|$)/.test(window.location.search);
  var THREE = null;
  var mergeGeometries = null;

  const SETTINGS_KEY = "chibi-crawl-settings";
  const BEST_KEY = "chibi-crawl-best-fights";

  /* ---------- tuning ---------- */

  const RUN_SPEED = 5.4; // party jog speed, units/sec
  const ARENA_GAP_MIN = 34; // distance between consecutive encounters
  const ARENA_GAP_MAX = 50;
  const ARENA_FLAT = 11; // path is dead straight this far either side of an arena
  const PARTY_STOP = 4.8; // party anchor stops this far before the arena centre
  const FOE_STAND = 4.8; // ...and the foe anchor sits this far after it
  const SIGHT_DIST = 17; // foes notice the party (and the camera pulls back) at this range
  const INTRO_S = 1.1;
  const VICTORY_S = 2.5;
  const WIPE_S = 2.4;
  const DASH_SPEED = 13;
  const RETURN_SPEED = 10;
  const SPECIAL_MAX = 100;
  const CRIT_CHANCE = 0.12;
  const CRIT_MULT = 1.7;
  const LEVEL_EVERY = 3; // party levels up every N victories
  const LEVEL_BONUS = 0.1; // hero hp/atk per level
  const FOE_SCALE_PER_FIGHT = 0.06;
  const RUN_REGEN = 0.045; // fraction of max hp regained per second while jogging
  const REVIVE_FRAC = 0.4;
  const CHUNK = 10; // scenery chunk length along the path
  const CHUNK_BEHIND = 3;
  const CHUNK_AHEAD = 7;
  const ROAD_HALF = 1.5;
  const BIOME_LEN = 320;
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  /* ---------- settings (the experiment knobs) ---------- */

  const DEFAULTS = {
    view: "iso",
    battleCam: "director",
    formation: "wedge",
    foeFormation: "stagger",
    foes: 0,
    ui: "both",
    speed: 1,
  };

  const VIEWS = {
    iso: { label: "Iso", pitch: 33, az: 68, dist: 32, fov: 24 },
    low: { label: "Low", pitch: 14, az: 78, dist: 19, fov: 46 },
    top: { label: "Tactical", pitch: 62, az: 55, dist: 30, fov: 30 },
    side: { label: "Side", pitch: 20, az: 100, dist: 30, fov: 22 },
  };

  const FORMATIONS = [
    ["wedge", "Wedge"],
    ["line", "Line"],
    ["column", "Column"],
    ["stagger", "Stagger"],
  ];

  const OPTIONS = [
    { key: "view", label: "Camera view", hot: "C", opts: Object.keys(VIEWS).map((k) => [k, VIEWS[k].label]) },
    {
      key: "battleCam",
      label: "Battle camera",
      hot: "B",
      opts: [
        ["fixed", "Fixed"],
        ["fit", "Fit"],
        ["director", "Director"],
      ],
    },
    { key: "formation", label: "Party formation", hot: "F", opts: FORMATIONS },
    { key: "foeFormation", label: "Enemy formation", hot: "E", opts: FORMATIONS },
    {
      key: "foes",
      label: "Enemy pack size",
      hot: "G",
      opts: [[0, "Rand"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]],
    },
    {
      key: "ui",
      label: "UI",
      hot: "U",
      opts: [
        ["heads", "Heads"],
        ["panel", "Panel"],
        ["both", "Both"],
      ],
    },
    { key: "speed", label: "Speed", hot: "1-3", opts: [[1, "1×"], [2, "2×"], [3, "3×"]] },
  ];

  function loadSettings() {
    const s = Object.assign({}, DEFAULTS);
    try {
      const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      OPTIONS.forEach((opt) => {
        if (o[opt.key] !== undefined && opt.opts.some((p) => p[0] === o[opt.key])) s[opt.key] = o[opt.key];
      });
    } catch (e) {
      /* storage may be unavailable */
    }
    return s;
  }
  function saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {
      /* ignore */
    }
  }
  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(n) {
    try {
      localStorage.setItem(BEST_KEY, String(n));
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- small helpers ---------- */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));
  const smooth = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeOutBack = (t) => {
    t = clamp(t, 0, 1);
    return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  };
  function angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash2 = (a, b) => ((a * 73856093) ^ (b * 19349663)) >>> 0;
  function pickWeighted(rng, table) {
    let sum = 0;
    for (const e of table) sum += e[1];
    let r = rng() * sum;
    for (const e of table) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return table[table.length - 1][0];
  }

  /* ---------- formations ---------- */

  // Slot i of n in a formation. `u` is how far BEHIND the leader the slot is
  // (the party faces +x and the pack faces -x, so each side flips the sign);
  // `v` is the lateral offset. Slot 0 is always the front-liner.
  const SPREAD = [0, 1, -1, 2, -2, 3, -3];
  function formationSlot(kind, i, n) {
    switch (kind) {
      case "line":
        return { u: 0, v: SPREAD[i] * 1.8 };
      case "column":
        return { u: i * 1.5, v: i === 0 ? 0 : (i % 2 ? 0.3 : -0.3) };
      case "stagger":
        return { u: i === 0 ? 0 : i % 2 === 1 ? 1.4 : 0.7, v: (i - (n - 1) / 2) * 1.6 };
      default: {
        const row = Math.ceil(i / 2);
        return { u: row * 1.35, v: i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * row * 1.25 };
      }
    }
  }

  /* ---------- course: the winding path and its encounters ---------- */

  // Arenas are planned ahead of the party. The path is dead straight through
  // each arena (a flat clearing for the fight) and eases between consecutive
  // arenas' z-levels with a little wiggle, so the world winds but the battle
  // axis is always +x.
  class Course {
    constructor(rng) {
      this.rng = rng;
      this.arenas = [{ x: -10, z: 0, idx: 0, start: true }];
      this.count = 0;
      this.plan(260);
    }
    plan(upToX) {
      let last = this.arenas[this.arenas.length - 1];
      while (last.x < upToX) {
        const gap = ARENA_GAP_MIN + this.rng() * (ARENA_GAP_MAX - ARENA_GAP_MIN);
        const z = clamp(last.z + (this.rng() - 0.5) * 16, -7, 7);
        last = { x: last.x + gap, z, idx: ++this.count, start: false };
        this.arenas.push(last);
      }
    }
    prune(x) {
      while (this.arenas.length > 3 && this.arenas[1].x < x - 60) this.arenas.shift();
    }
    z(x) {
      const a = this.arenas;
      if (x <= a[0].x) return a[0].z;
      for (let i = 0; i < a.length - 1; i++) {
        if (x < a[i + 1].x) {
          const A = a[i];
          const B = a[i + 1];
          const x0 = A.x + ARENA_FLAT;
          const x1 = B.x - ARENA_FLAT;
          if (x <= x0) return A.z;
          if (x >= x1) return B.z;
          const t = (x - x0) / (x1 - x0);
          return lerp(A.z, B.z, smooth(t)) + Math.sin(x * 0.17 + i) * 1.6 * Math.sin(Math.PI * t);
        }
      }
      return a[a.length - 1].z;
    }
    heading(x) {
      return Math.atan2(this.z(x + 0.6) - this.z(x - 0.6), 1.2);
    }
  }

  /* ---------- biomes ---------- */

  const BIOMES = [
    { name: "Meadow", ground: 0xa5e27d, sky: 0xcdeeff, leaf: [0x6fcf6a, 0x8fdc6c, 0x5cbc69], flower: [0xff8fb1, 0xfff27a, 0xffffff, 0xb48cff], pine: 0.8, water: 0x59c3f0 },
    { name: "Blossom", ground: 0xe8c6e0, sky: 0xffe3f0, leaf: [0xffb3cf, 0xff97c0, 0xffd1e2], flower: [0xffffff, 0xffe27a, 0xff8fb1, 0xc9a6ff], pine: 0.2, water: 0x7ec8f2 },
    { name: "Autumn", ground: 0xd9cc7a, sky: 0xffe9c7, leaf: [0xff9d4a, 0xf5c542, 0xe2693a], flower: [0xffd24a, 0xff8a4a, 0xffffff, 0xd96a4a], pine: 1.0, water: 0x58b4c4 },
    { name: "Frost", ground: 0xe3f4ff, sky: 0xdff3ff, leaf: [0x9fd8d0, 0x7cc4cc, 0xcdeef0], flower: [0xffffff, 0x9fd8ff, 0xc9b6ff, 0xffffff], pine: 3.0, water: 0xbfe6f7, ice: true },
  ];
  function biomeAt(x) {
    const seg = Math.max(0, x) / BIOME_LEN;
    const i = Math.floor(seg);
    const f = smooth((seg - i - 0.7) / 0.3);
    return { a: BIOMES[i % BIOMES.length], b: BIOMES[(i + 1) % BIOMES.length], f: f };
  }
  function biomeDiscrete(x) {
    const b = biomeAt(x);
    return b.f > 0.5 ? b.b : b.a;
  }

  /* ---------- three.js-dependent caches (built after the import) ---------- */

  const G = {}; // shared unit geometries
  const TEX = {}; // canvas textures
  let GRAD = null; // toon gradient
  let OUTLINE_MAT = null;
  const propCache = new Map();

  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // The arena decal: a soft-edged disc (flat cream, or tiled sand when `sand` is
  // an image), a dashed ring and a ring of stones. Drawn at any resolution.
  function drawArena(c, w, sand) {
    if (sand) {
      // ~8 world units per sand tile; the decal spans 19 units
      const pat = c.createPattern(sand, "repeat");
      const k = (w * 8) / 19 / sand.width;
      pat.setTransform(new DOMMatrix().scale(k, k));
      c.fillStyle = pat;
      c.fillRect(0, 0, w, w);
      const m = c.createRadialGradient(w / 2, w / 2, w * 0.1, w / 2, w / 2, w / 2);
      m.addColorStop(0, "rgba(0,0,0,0.97)");
      m.addColorStop(0.86, "rgba(0,0,0,0.94)");
      m.addColorStop(1, "rgba(0,0,0,0)");
      c.globalCompositeOperation = "destination-in";
      c.fillStyle = m;
      c.fillRect(0, 0, w, w);
      c.globalCompositeOperation = "source-over";
    } else {
      const g = c.createRadialGradient(w / 2, w / 2, w * 0.1, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(250,236,196,0.95)");
      g.addColorStop(0.86, "rgba(244,222,170,0.92)");
      g.addColorStop(1, "rgba(244,222,170,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
    }
    const u = w / 512; // the ring/stone sizes below were drawn at 512
    c.strokeStyle = "rgba(190,150,100,0.45)";
    c.lineWidth = 5 * u;
    c.setLineDash([22 * u, 16 * u]);
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.36, 0, TAU);
    c.stroke();
    c.setLineDash([]);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      const r = w * 0.44;
      c.save();
      c.translate(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
      c.rotate(a);
      c.fillStyle = i % 2 ? "#fff7de" : "#ffeab0";
      c.strokeStyle = "rgba(160,120,80,0.7)";
      c.lineWidth = 3 * u;
      c.beginPath();
      c.roundRect(-9 * u, -6 * u, 18 * u, 12 * u, 4 * u);
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  // Textures made from the loaded ambientCG images (see loadPhoto).
  function buildPhotoTex() {
    const rep = (im, repeatT) => {
      const t = new THREE.Texture(im);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = repeatT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    TEX.groundPhoto = PHOTO.ground.map((im) => rep(im, true));
    TEX.roadPhoto = rep(PHOTO.road, false);
    // the road keeps the procedural soft edges, as an alpha map (green channel)
    TEX.roadAlpha = canvasTex(8, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#000");
      g.addColorStop(0.14, "#fff");
      g.addColorStop(0.86, "#fff");
      g.addColorStop(1, "#000");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    TEX.roadAlpha.colorSpace = THREE.NoColorSpace;
    TEX.roadAlpha.wrapS = THREE.RepeatWrapping;
    TEX.arenaPhoto = canvasTex(1024, 1024, (c, w) => drawArena(c, w, PHOTO.sand));
  }

  function initShared() {
    G.sphere = new THREE.SphereGeometry(1, 22, 16);
    G.sphereLo = new THREE.SphereGeometry(1, 10, 8);
    G.cyl = new THREE.CylinderGeometry(1, 1, 1, 18);
    G.cylLo = new THREE.CylinderGeometry(1, 1, 1, 8);
    G.cone = new THREE.ConeGeometry(1, 1, 18);
    G.coneLo = new THREE.ConeGeometry(1, 1, 8);
    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.ico = new THREE.IcosahedronGeometry(1, 0);
    G.discFlat = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    G.ringFlat = new THREE.RingGeometry(0.84, 1, 44).rotateX(-Math.PI / 2);

    const d = new Uint8Array([125, 172, 216, 255]);
    GRAD = new THREE.DataTexture(d, 4, 1, THREE.RedFormat);
    GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter;
    GRAD.generateMipmaps = false;
    GRAD.needsUpdate = true;

    OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x4a3347, side: THREE.BackSide });

    TEX.soft = canvasTex(64, 64, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
    });
    TEX.puff = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.42, 0, TAU);
      c.fill();
    });
    TEX.star = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#fff";
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? w * 0.2 : w * 0.46;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        c.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
      }
      c.closePath();
      c.lineJoin = "round";
      c.lineWidth = 5;
      c.strokeStyle = "#fff";
      c.stroke();
      c.fill();
    });
    TEX.spark = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#fff";
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? w * 0.09 : w * 0.48;
        const a = (i * Math.PI) / 4;
        c.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    });
    TEX.heart = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#fff";
      c.beginPath();
      c.moveTo(w / 2, w * 0.86);
      c.bezierCurveTo(w * 0.02, w * 0.5, w * 0.12, w * 0.1, w * 0.36, w * 0.18);
      c.bezierCurveTo(w * 0.44, w * 0.2, w / 2, w * 0.3, w / 2, w * 0.34);
      c.bezierCurveTo(w / 2, w * 0.3, w * 0.56, w * 0.2, w * 0.64, w * 0.18);
      c.bezierCurveTo(w * 0.88, w * 0.1, w * 0.98, w * 0.5, w / 2, w * 0.86);
      c.fill();
    });
    TEX.excl = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#ff5a6e";
      c.strokeStyle = "#fff";
      c.lineWidth = 4;
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.4, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = "#fff";
      c.fillRect(w / 2 - 4.5, w * 0.24, 9, w * 0.3);
      c.beginPath();
      c.arc(w / 2, w * 0.68, 5.5, 0, TAU);
      c.fill();
    });
    TEX.coin = canvasTex(64, 64, (c, w) => {
      c.fillStyle = "#e8a417";
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.4, 0, TAU);
      c.fill();
      c.fillStyle = "#ffd84a";
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.33, 0, TAU);
      c.fill();
      c.fillStyle = "#fff6b8";
      c.beginPath();
      c.ellipse(w * 0.4, w * 0.38, w * 0.08, w * 0.14, 0.5, 0, TAU);
      c.fill();
    });
    TEX.petal = canvasTex(32, 32, (c, w) => {
      c.fillStyle = "#fff";
      c.beginPath();
      c.ellipse(w / 2, w / 2, w * 0.2, w * 0.4, 0.6, 0, TAU);
      c.fill();
    });

    // Ground: tintable tileable grass — a soft checker, blotches and tufts,
    // everything drawn with wrap-around so the repeat is seamless. Biome
    // colour is applied as the material tint.
    const ground = canvasTex(256, 256, (c, w) => {
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, w, w);
      c.fillStyle = "rgba(0,0,0,0.035)";
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) c.fillRect((x * w) / 4, (y * w) / 4, w / 4, w / 4);
      const rng = mulberry32(11);
      const wrap = (x, y, fn) => {
        for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]) fn(x + ox, y + oy);
      };
      for (let i = 0; i < 26; i++) {
        const x = rng() * w;
        const y = rng() * w;
        const r = 12 + rng() * 22;
        const a = rng() < 0.5 ? 0.028 : -0.03;
        c.fillStyle = a > 0 ? "rgba(0,0,0," + a + ")" : "rgba(255,255,255," + -a * 2 + ")";
        wrap(x, y, (px, py) => {
          c.beginPath();
          c.ellipse(px, py, r * 1.4, r, rng() * 3, 0, TAU);
          c.fill();
        });
      }
      c.strokeStyle = "rgba(0,0,0,0.1)";
      c.lineWidth = 2.5;
      c.lineCap = "round";
      for (let i = 0; i < 70; i++) {
        const x = rng() * w;
        const y = rng() * w;
        wrap(x, y, (px, py) => {
          c.beginPath();
          c.moveTo(px - 5, py + 4);
          c.lineTo(px - 1, py - 4);
          c.moveTo(px + 1, py + 4);
          c.lineTo(px + 1, py - 6);
          c.moveTo(px + 6, py + 4);
          c.lineTo(px + 3, py - 3);
          c.stroke();
        });
      }
    });
    ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
    TEX.ground = ground;

    const dirt = canvasTex(128, 128, (c, w) => {
      c.clearRect(0, 0, w, w);
      const g = c.createLinearGradient(0, 0, 0, w);
      g.addColorStop(0, "rgba(240,210,160,0)");
      g.addColorStop(0.14, "rgba(240,210,160,1)");
      g.addColorStop(0.86, "rgba(240,210,160,1)");
      g.addColorStop(1, "rgba(240,210,160,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      const rng = mulberry32(5);
      for (let i = 0; i < 40; i++) {
        const x = rng() * w;
        const y = w * (0.2 + rng() * 0.6);
        c.fillStyle = rng() < 0.5 ? "rgba(190,150,100,0.35)" : "rgba(255,240,205,0.6)";
        c.beginPath();
        c.ellipse(x, y, 2 + rng() * 3, 1.5 + rng() * 2, rng() * 3, 0, TAU);
        c.fill();
      }
    });
    dirt.wrapS = THREE.RepeatWrapping;
    TEX.dirt = dirt;

    TEX.arena = canvasTex(512, 512, (c, w) => drawArena(c, w, null));
  }

  /* ---------- prop builders (merged, vertex-coloured, cached) ---------- */

  const _v = () => new THREE.Vector3();
  function piece(geo, color, px, py, pz, sx, sy, sz, rx, ry, rz) {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(
      _v().set(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
      _v().set(sx, sy, sz)
    );
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  }
  function merged(list) {
    const g = mergeGeometries(list, false);
    list.forEach((p) => p.dispose());
    return g;
  }
  const BROWN = 0x9a6b4b;

  function b64(str, Type) {
    const raw = atob(str);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return Type === Uint8Array ? u8 : new Type(u8.buffer);
  }

  // A baked Meshy prop. Vertices with mask > 0 hold a grey shade and are
  // multiplied by the biome tint (foliage / petals / mushroom cap); the rest
  // carry their baked colour untouched.
  function meshyProp(d, tint) {
    const pos = b64(d.pos, Float32Array);
    const col = b64(d.col, Uint8Array);
    const mask = b64(d.mask, Uint8Array);
    const t = new THREE.Color(tint);
    const out = new Float32Array(d.n * 3);
    for (let i = 0; i < d.n; i++) {
      if (mask[i]) {
        const sh = (col[i * 3] / 255) * 1.5;
        out[i * 3] = t.r * sh;
        out[i * 3 + 1] = t.g * sh;
        out[i * 3 + 2] = t.b * sh;
      } else {
        out[i * 3] = col[i * 3] / 255;
        out[i * 3 + 1] = col[i * 3 + 1] / 255;
        out[i * 3 + 2] = col[i * 3 + 2] / 255;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(out, 3));
    g.setIndex(new THREE.BufferAttribute(b64(d.idx, Uint16Array), 1));
    g.computeVertexNormals();
    return g;
  }

  function buildProp(type, color, variant) {
    const key = type + ":" + color + ":" + variant;
    if (propCache.has(key)) return propCache.get(key);
    if (PROP_DATA && PROP_DATA[type]) {
      const mp = { geo: meshyProp(PROP_DATA[type], color), shadow: 0 };
      propCache.set(key, mp);
      return mp;
    }
    const P = [];
    let shadow = 1;
    let water = null;
    switch (type) {
      case "tree": {
        P.push(piece(G.cylLo, BROWN, 0, 0.5, 0, 0.17, 1.0, 0.17));
        const lite = new THREE.Color(color).offsetHSL(0, 0, 0.07).getHex();
        P.push(piece(G.sphereLo, color, 0, 1.55, 0, 0.92, 0.85, 0.92));
        P.push(piece(G.sphereLo, lite, 0.38, 2.05, 0.1, 0.58, 0.55, 0.58));
        P.push(piece(G.sphereLo, color, -0.42, 1.85, 0.22, 0.5, 0.48, 0.5));
        shadow = 1.15;
        break;
      }
      case "pine": {
        P.push(piece(G.cylLo, BROWN, 0, 0.3, 0, 0.15, 0.6, 0.15));
        const lite = new THREE.Color(color).offsetHSL(0, 0, 0.06).getHex();
        P.push(piece(G.coneLo, color, 0, 1.15, 0, 0.95, 1.2, 0.95));
        P.push(piece(G.coneLo, lite, 0, 1.85, 0, 0.74, 1.05, 0.74));
        P.push(piece(G.coneLo, color, 0, 2.5, 0, 0.5, 0.85, 0.5));
        shadow = 0.95;
        break;
      }
      case "bush": {
        P.push(piece(G.sphereLo, color, 0, 0.36, 0, 0.55, 0.42, 0.5));
        P.push(piece(G.sphereLo, new THREE.Color(color).offsetHSL(0, 0, 0.06).getHex(), 0.42, 0.28, 0.12, 0.4, 0.32, 0.38));
        P.push(piece(G.sphereLo, color, -0.4, 0.26, 0.1, 0.36, 0.3, 0.34));
        shadow = 0.8;
        break;
      }
      case "flowers": {
        const rng = mulberry32(variant * 31 + 7);
        for (let i = 0; i < 5; i++) {
          const x = (rng() - 0.5) * 1.1;
          const z = (rng() - 0.5) * 1.1;
          const h = 0.22 + rng() * 0.16;
          P.push(piece(G.cylLo, 0x58b85a, x, h / 2, z, 0.018, h, 0.018));
          P.push(piece(G.sphereLo, color, x, h + 0.04, z, 0.085, 0.07, 0.085));
          P.push(piece(G.sphereLo, 0xffe36a, x, h + 0.09, z, 0.04, 0.035, 0.04));
        }
        shadow = 0;
        break;
      }
      case "rock": {
        P.push(piece(G.ico, color, 0, 0.25, 0, 0.62, 0.42, 0.5, 0, 0.6, 0));
        P.push(piece(G.ico, new THREE.Color(color).offsetHSL(0, 0, 0.05).getHex(), 0.55, 0.14, 0.2, 0.3, 0.22, 0.28, 0.2, 1.1, 0));
        shadow = 0.85;
        break;
      }
      case "mushroom": {
        P.push(piece(G.cylLo, 0xfff3dc, 0, 0.2, 0, 0.13, 0.4, 0.13));
        P.push(piece(G.sphereLo, color, 0, 0.46, 0, 0.36, 0.24, 0.36));
        P.push(piece(G.sphereLo, 0xffffff, 0.13, 0.64, 0.08, 0.075, 0.04, 0.075));
        P.push(piece(G.sphereLo, 0xffffff, -0.12, 0.6, -0.1, 0.06, 0.035, 0.06));
        P.push(piece(G.sphereLo, 0xffffff, 0.0, 0.67, -0.1, 0.05, 0.03, 0.05));
        shadow = 0.5;
        break;
      }
      case "fence": {
        P.push(piece(G.box, 0xc9955f, -1.1, 0.36, 0, 0.12, 0.72, 0.12));
        P.push(piece(G.box, 0xc9955f, 1.1, 0.36, 0, 0.12, 0.72, 0.12));
        P.push(piece(G.box, 0xdcaa72, 0, 0.55, 0, 2.3, 0.1, 0.07));
        P.push(piece(G.box, 0xdcaa72, 0, 0.3, 0, 2.3, 0.1, 0.07));
        shadow = 0;
        break;
      }
      case "pond": {
        // A raised bank around a sunken-looking basin (the ground is a flat
        // plane, so the "bowl" is a rim with the water just below its crest).
        // The water itself is a separate mesh with its own shader (see
        // makeWaterMat); `variant` 1 = frozen (Frost biome).
        const prof = [
          [1.5, 0.0, 0xe3d3a0],
          [1.3, 0.05, 0xe9d7a8],
          [1.12, 0.11, 0xd9c690],
          [1.03, 0.1, 0xbfa874],
          [0.97, 0.05, 0x7d6a4c],
        ];
        const lathe = new THREE.LatheGeometry(prof.map((q) => new THREE.Vector2(q[0], q[1])), 36);
        lathe.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, POND_SQUASH));
        const cols = new Float32Array(lathe.attributes.position.count * 3);
        const tmp = new THREE.Color();
        for (let i = 0; i < lathe.attributes.position.count; i++) {
          tmp.set(prof[i % prof.length][2]);
          cols.set([tmp.r, tmp.g, tmp.b], i * 3);
        }
        lathe.setAttribute("color", new THREE.BufferAttribute(cols, 3));
        P.push(lathe);
        const rng = mulberry32(variant * 17 + 3);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU + (rng() - 0.5) * 0.35;
          const sz = 0.09 + rng() * 0.08;
          P.push(piece(G.ico, k % 2 ? 0xb9c0d6 : 0xcdbfd6, Math.cos(a) * 1.1, 0.11, Math.sin(a) * 1.1 * POND_SQUASH, sz * 1.2, sz * 0.8, sz, rng() * 3, rng() * 3, 0));
        }
        if (variant !== 1) {
          P.push(piece(G.cyl, 0x66c46a, -0.32, 0.085, 0.12, 0.22, 0.014, 0.19));
          P.push(piece(G.cyl, 0x58b85a, 0.36, 0.085, -0.16, 0.15, 0.014, 0.13));
          P.push(piece(G.sphereLo, 0xffffff, -0.32, 0.115, 0.12, 0.075, 0.05, 0.075));
          P.push(piece(G.sphereLo, 0xffd1e2, -0.32, 0.14, 0.12, 0.038, 0.03, 0.038));
        }
        // ico pieces are non-indexed, the rest indexed; mergeGeometries needs one kind
        for (let i = 0; i < P.length; i++) if (P[i].index) P[i] = P[i].toNonIndexed();
        const wg = new THREE.CircleGeometry(POND_WATER_R, 40).rotateX(-Math.PI / 2);
        wg.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, POND_SQUASH));
        wg.translate(0, 0.06, 0);
        const wc = new THREE.Color(color);
        const wcol = new Float32Array(wg.attributes.position.count * 3);
        const wice = new Float32Array(wg.attributes.position.count);
        for (let i = 0; i < wice.length; i++) {
          wcol.set([wc.r, wc.g, wc.b], i * 3);
          wice[i] = variant === 1 ? 1 : 0;
        }
        wg.setAttribute("color", new THREE.BufferAttribute(wcol, 3));
        wg.setAttribute("aIce", new THREE.BufferAttribute(wice, 1));
        water = wg;
        shadow = 0;
        break;
      }
      default:
        break;
    }
    const out = { geo: merged(P), shadow: shadow, water: water };
    propCache.set(key, out);
    return out;
  }

  /* ---------- unit definitions ---------- */

  const HERO_DEFS = [
    { kind: "knight", name: "Knight", icon: "🛡️", color: "#5b8def", hp: 160, atk: 14, cd: 0.8, melee: true, reach: 1.25, taunt: 3, headY: 2.15, chestY: 0.95, special: "Whirlwind", sRadius: 3.1 },
    { kind: "mage", name: "Mage", icon: "🔮", color: "#a070ff", hp: 90, atk: 21, cd: 1.3, ranged: true, taunt: 1, headY: 2.35, chestY: 0.95, special: "Meteor", sRadius: 3.4 },
    { kind: "cleric", name: "Cleric", icon: "✨", color: "#ffc53a", hp: 110, atk: 9, cd: 1.3, ranged: true, healer: true, taunt: 1, headY: 2.15, chestY: 0.95, special: "Blessing" },
  ];

  const FOE_DEFS = {
    slime: { kind: "slime", name: "Slime", hp: 40, atk: 7, cd: 1.3, melee: true, reach: 1.0, taunt: 1, headY: 1.25, chestY: 0.55, scale: 1, xp: 3 },
    shroom: { kind: "shroom", name: "Shroom", hp: 56, atk: 9, cd: 1.7, melee: true, reach: 1.1, taunt: 1, headY: 1.55, chestY: 0.6, scale: 1, xp: 4 },
    bat: { kind: "bat", name: "Bat", hp: 26, atk: 6, cd: 1.0, melee: true, reach: 1.0, taunt: 1, headY: 2.15, chestY: 1.3, hover: 1.3, scale: 1, xp: 3, hunter: true },
    king: { kind: "king", name: "King Slime", hp: 270, atk: 14, cd: 2.0, melee: true, reach: 1.9, taunt: 1, headY: 2.7, chestY: 1.0, scale: 1.85, xp: 20, special: "Body Slam", sRadius: 3.6 },
  };

  let nextUnitId = 1;
  let SHADOW_MAT = null;

  /* ---------- character construction ---------- */

  class Builder {
    constructor(u) {
      this.u = u;
    }
    mat(color, extra) {
      const m = new THREE.MeshToonMaterial(Object.assign({ color: color, gradientMap: GRAD }, extra));
      this.u.toons.push(m);
      return m;
    }
    basic(color, extra) {
      const m = new THREE.MeshBasicMaterial(Object.assign({ color: color }, extra));
      this.u.others.push(m);
      return m;
    }
    part(parent, geo, color, p, s, o) {
      o = o || {};
      const m = new THREE.Mesh(geo, o.basic ? this.basic(color, o.mat) : this.mat(color, o.mat));
      m.position.set(p[0], p[1], p[2]);
      m.scale.set(s[0], s[1], s[2]);
      if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
      if (!o.basic && o.outline !== false) {
        const th = o.ol || 0.032;
        const ol = new THREE.Mesh(geo, OUTLINE_MAT);
        ol.scale.set(1 + th / s[0], 1 + th / s[1], 1 + th / s[2]);
        m.add(ol);
      }
      parent.add(m);
      return m;
    }
    sprite(parent, tex, color, p, size, additive) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, depthWrite: false });
      if (additive) mat.blending = THREE.AdditiveBlending;
      this.u.others.push(mat);
      const s = new THREE.Sprite(mat);
      s.position.set(p[0], p[1], p[2]);
      s.scale.set(size, size, size);
      parent.add(s);
      return s;
    }
    group(parent, p) {
      const g = new THREE.Group();
      g.position.set(p[0], p[1], p[2]);
      parent.add(g);
      return g;
    }
  }

  // Big glossy eyes with a catch-light, optional blush and mouth. Returns the
  // eye groups so the pose code can blink them by scaling y.
  function addFace(b, head, o) {
    const eyes = [];
    for (const sx of [-1, 1]) {
      const g = b.group(head, [sx * o.ex, o.ey, o.ez]);
      b.part(g, G.sphere, o.eyeColor || 0x2b1d36, [0, 0, 0], [o.es * 0.78, o.es * 1.1, o.es * 0.55], { basic: true });
      b.part(g, G.sphere, 0xffffff, [o.es * 0.28, o.es * 0.42, o.es * 0.4], [o.es * 0.3, o.es * 0.3, o.es * 0.3], { basic: true });
      eyes.push(g);
      if (o.cheek) b.part(head, G.sphere, 0xff9fb0, [sx * (o.ex + o.es * 1.7), o.ey - o.es * 1.1, o.ez - o.cheekDrop], [o.es * 1.0, o.es * 0.62, o.es * 0.35], { outline: false });
    }
    if (o.mouth !== false) b.part(head, G.sphere, 0x4a2a3a, [0, o.ey - o.es * 1.7, o.ez + (o.mouthZ || 0.02)], [o.es * 0.46, o.es * 0.3, o.es * 0.28], { basic: true });
    return eyes;
  }

  function buildHuman(u, c) {
    const b = new Builder(u);
    const root = new THREE.Group();
    const body = b.group(root, [0, 0, 0]);
    const R = { root: root, body: body, kind: "human" };

    const mkLeg = (x) => {
      const piv = b.group(body, [x, 0.34, 0]);
      b.part(piv, G.cyl, c.legs, [0, -0.12, 0], [0.075, 0.24, 0.075]);
      b.part(piv, G.sphere, c.shoes, [0, -0.27, 0.04], [0.12, 0.085, 0.15]);
      return piv;
    };
    R.legL = mkLeg(-0.13);
    R.legR = mkLeg(0.13);

    if (c.robe) {
      b.part(body, G.cone, c.robe, [0, 0.47, 0], [0.43, 0.76, 0.43]);
      b.part(body, G.cyl, c.belt, [0, 0.62, 0], [0.3, 0.07, 0.3], { ol: 0.02 });
      if (c.hem) b.part(body, G.cyl, c.hem, [0, 0.12, 0], [0.43, 0.05, 0.43], { ol: 0.02 });
    } else {
      b.part(body, G.sphere, c.outfit, [0, 0.57, 0], [0.31, 0.29, 0.26]);
      b.part(body, G.cyl, c.belt, [0, 0.47, 0], [0.292, 0.07, 0.252], { ol: 0.02 });
    }

    const mkArm = (x) => {
      const piv = b.group(body, [x, 0.72, 0]);
      b.part(piv, G.cyl, c.outfit2 || c.outfit, [0, -0.1, 0], [0.062, 0.2, 0.062]);
      b.part(piv, G.sphere, c.skin, [0, -0.23, 0], [0.09, 0.09, 0.09]);
      return piv;
    };
    R.armL = mkArm(-0.33);
    R.armR = mkArm(0.33);

    const head = b.group(body, [0, 1.08, 0]);
    R.head = head;
    b.part(head, G.sphere, c.skin, [0, 0, 0], [0.46, 0.43, 0.445]);
    if (c.hair) {
      b.part(head, G.sphere, c.hair, [0, 0.09, -0.07], [0.53, 0.46, 0.5]);
      b.part(head, G.sphere, c.hair, [0, 0.27, 0.27], [0.34, 0.16, 0.2], { ol: 0.025 });
      b.part(head, G.sphere, c.hair, [-0.34, 0.15, 0.2], [0.17, 0.2, 0.15], { ol: 0.025 });
      b.part(head, G.sphere, c.hair, [0.34, 0.15, 0.2], [0.17, 0.2, 0.15], { ol: 0.025 });
    }
    R.eyes = addFace(b, head, { ex: 0.18, ey: -0.06, ez: 0.4, es: 0.085, cheek: true, cheekDrop: 0.03, mouthZ: 0.035 });
    if (c.build) c.build(b, R);
    return R;
  }

  function buildHero(u, kind) {
    if (kind === "knight") {
      return buildHuman(u, {
        skin: 0xffdcc0, hair: 0x7a4a2b, outfit: 0x4a7fd6, outfit2: 0x3d6bc0, belt: 0xf0c04a, legs: 0x3a4f8a, shoes: 0x6b4a32,
        build(b, R) {
          // helmet cap, plume, cape
          b.part(R.head, G.sphere, 0xd3dcec, [0, 0.2, -0.02], [0.55, 0.36, 0.55]);
          b.part(R.head, G.cyl, 0xf0c04a, [0, 0.0, -0.02], [0.55, 0.045, 0.55], { ol: 0.02 });
          b.part(R.head, G.cone, 0xff5a6e, [0, 0.6, -0.2], [0.11, 0.42, 0.11], { rot: [-0.5, 0, 0] });
          b.part(R.body, G.box, 0xe0485a, [0, 0.52, -0.26], [0.42, 0.52, 0.045], { rot: [0.12, 0, 0] });
          // sword in the right hand, blade pointing along the hand's +z
          const sw = b.group(R.armR, [0, -0.23, 0]);
          b.part(sw, G.cyl, 0x7a5a3a, [0, 0, 0.0], [0.035, 0.2, 0.035], { rot: [Math.PI / 2, 0, 0], ol: 0.02 });
          b.part(sw, G.box, 0xf0c04a, [0, 0, 0.13], [0.05, 0.3, 0.07], { ol: 0.02 });
          b.part(sw, G.box, 0xeef4ff, [0, 0, 0.58], [0.05, 0.13, 0.85], { ol: 0.025 });
          R.weapon = sw;
          // round shield on the left arm
          const sh = b.group(R.armL, [0, -0.2, 0.1]);
          b.part(sh, G.cyl, 0x4a7fd6, [0, 0, 0], [0.3, 0.05, 0.3], { rot: [Math.PI / 2, 0, 0] });
          b.part(sh, G.cyl, 0xf0c04a, [0, 0, 0.04], [0.14, 0.04, 0.14], { rot: [Math.PI / 2, 0, 0], ol: 0.015 });
        },
      });
    }
    if (kind === "mage") {
      return buildHuman(u, {
        skin: 0xffe2cc, hair: 0xb48cff, robe: 0x7a5bd6, belt: 0xf0c04a, hem: 0xf0c04a, outfit: 0x7a5bd6, outfit2: 0x6a4bc6, legs: 0x4a3a8a, shoes: 0x3a2a6a,
        build(b, R) {
          // wizard hat
          b.part(R.head, G.cyl, 0x5b3fb8, [0, 0.34, 0], [0.7, 0.05, 0.7]);
          b.part(R.head, G.cone, 0x6a4bc6, [0, 0.8, -0.05], [0.4, 0.9, 0.4], { rot: [-0.22, 0, 0] });
          b.part(R.head, G.cyl, 0xf0c04a, [0, 0.4, 0], [0.4, 0.07, 0.4], { ol: 0.02 });
          b.sprite(R.head, TEX.star, 0xffe27a, [0, 0.62, 0.33], 0.28, false);
          // staff + glowing orb: counter-rotated against the arm so it stays upright
          const st = b.group(R.armR, [0, -0.23, 0]);
          b.part(st, G.cyl, 0x9a6b4b, [0, 0.35, 0], [0.028, 1.35, 0.028], { ol: 0.02 });
          const orb = b.part(st, G.sphere, 0x8ff4ff, [0, 1.08, 0], [0.14, 0.14, 0.14], { basic: true });
          const halo = b.sprite(st, TEX.soft, 0x7fe8ff, [0, 1.08, 0], 0.7, true);
          R.staff = st;
          R.orb = orb;
          R.halo = halo;
          R.haloBase = 0.55;
        },
      });
    }
    return buildHuman(u, {
      skin: 0xffdfc6, hair: 0xffc86b, robe: 0xf3e3cf, belt: 0x8fe0c0, hem: 0xf0c04a, outfit: 0xf3e3cf, outfit2: 0xf3e3cf, legs: 0xf3dcc0, shoes: 0xd9a05a,
      build(b, R) {
        // pigtail buns + halo
        b.part(R.head, G.sphere, 0xffc86b, [-0.38, 0.2, -0.05], [0.17, 0.17, 0.17], { ol: 0.025 });
        b.part(R.head, G.sphere, 0xffc86b, [0.38, 0.2, -0.05], [0.17, 0.17, 0.17], { ol: 0.025 });
        const halo = b.part(R.head, new THREE.TorusGeometry(1, 0.1, 8, 28), 0xffe27a, [0, 0.66, -0.05], [0.3, 0.3, 0.3], { rot: [Math.PI / 2 - 0.15, 0, 0], basic: true });
        u.ownGeo.push(halo.geometry);
        b.part(R.head, G.box, 0xff8fb1, [0, 0.43, 0.2], [0.16, 0.05, 0.05], { ol: 0.015 });
        // heart staff
        const st = b.group(R.armR, [0, -0.23, 0]);
        b.part(st, G.cyl, 0xf0c04a, [0, 0.3, 0], [0.028, 1.2, 0.028], { ol: 0.02 });
        const heart = b.sprite(st, TEX.heart, 0xff7aa8, [0, 1.0, 0], 0.5, false);
        const glow = b.sprite(st, TEX.soft, 0xffb0cc, [0, 1.0, 0], 0.8, true);
        R.staff = st;
        R.orb = heart;
        R.halo = glow;
        R.haloBase = 0.55;
      },
    });
  }

  function buildSlime(u, o) {
    const b = new Builder(u);
    const root = new THREE.Group();
    const body = b.group(root, [0, 0, 0]);
    const R = { root: root, body: body, kind: "blob" };
    b.part(body, G.sphere, o.color, [0, 0.5, 0], [0.64, 0.5, 0.62], { mat: { transparent: false } });
    b.part(body, G.sphere, o.color, [0, 0.98, 0], [0.12, 0.14, 0.12], { ol: 0.025 });
    b.part(body, G.sphere, 0xffffff, [-0.26, 0.76, 0.3], [0.12, 0.08, 0.06], { basic: true });
    const face = b.group(body, [0, 0.52, 0]);
    R.eyes = addFace(b, face, { ex: 0.21, ey: 0.05, ez: 0.54, es: 0.1, cheek: true, cheekDrop: 0.05, mouthZ: 0.035 });
    if (o.crown) {
      b.part(body, G.cyl, 0xffd84a, [0, 0.96, 0], [0.34, 0.1, 0.34], { ol: 0.02 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        b.part(body, G.cone, 0xffd84a, [Math.cos(a) * 0.3, 1.1, Math.sin(a) * 0.3], [0.08, 0.2, 0.08], { ol: 0.015 });
        b.part(body, G.sphere, [0xff5a6e, 0x6ad8ff, 0xb48cff][i % 3], [Math.cos(a) * 0.3, 1.22, Math.sin(a) * 0.3], [0.045, 0.045, 0.045], { basic: true });
      }
    }
    return R;
  }

  function buildShroom(u) {
    const b = new Builder(u);
    const root = new THREE.Group();
    const body = b.group(root, [0, 0, 0]);
    const R = { root: root, body: body, kind: "blob" };
    R.legL = b.group(body, [-0.14, 0.14, 0]);
    R.legR = b.group(body, [0.14, 0.14, 0]);
    b.part(R.legL, G.sphere, 0xf3dcc0, [0, -0.07, 0.03], [0.12, 0.08, 0.15]);
    b.part(R.legR, G.sphere, 0xf3dcc0, [0, -0.07, 0.03], [0.12, 0.08, 0.15]);
    b.part(body, G.cyl, 0xfff0d6, [0, 0.48, 0], [0.27, 0.62, 0.27]);
    b.part(body, G.sphere, 0xff6f7a, [0, 0.98, 0], [0.74, 0.46, 0.74]);
    const dots = [[0.34, 1.27, 0.2, 0.1], [-0.3, 1.24, 0.28, 0.12], [0.0, 1.4, -0.1, 0.1], [-0.4, 1.12, -0.25, 0.09], [0.45, 1.1, -0.2, 0.09]];
    dots.forEach((d) => b.part(body, G.sphere, 0xffffff, [d[0] * 0.9, d[1] - 0.2, d[2] * 0.9], [d[3], d[3] * 0.5, d[3]], { ol: 0.015 }));
    const face = b.group(body, [0, 0.5, 0]);
    R.eyes = addFace(b, face, { ex: 0.12, ey: 0.06, ez: 0.24, es: 0.075, cheek: true, cheekDrop: 0.02, mouthZ: 0.02 });
    return R;
  }

  function buildBat(u) {
    const b = new Builder(u);
    const root = new THREE.Group();
    const body = b.group(root, [0, 0, 0]);
    const R = { root: root, body: body, kind: "bat" };
    const core = b.group(body, [0, 0, 0]);
    R.core = core;
    b.part(core, G.sphere, 0x9a7ad8, [0, 0, 0], [0.44, 0.42, 0.4]);
    b.part(core, G.cone, 0x9a7ad8, [-0.24, 0.42, 0], [0.1, 0.3, 0.1], { rot: [0, 0, 0.3], ol: 0.02 });
    b.part(core, G.cone, 0x9a7ad8, [0.24, 0.42, 0], [0.1, 0.3, 0.1], { rot: [0, 0, -0.3], ol: 0.02 });
    b.part(core, G.cone, 0xffffff, [-0.07, -0.2, 0.34], [0.035, 0.1, 0.035], { rot: [Math.PI, 0, 0], ol: 0.01 });
    b.part(core, G.cone, 0xffffff, [0.07, -0.2, 0.34], [0.035, 0.1, 0.035], { rot: [Math.PI, 0, 0], ol: 0.01 });
    R.eyes = addFace(b, core, { ex: 0.16, ey: 0.06, ez: 0.3, es: 0.085, cheek: true, cheekDrop: 0.02, mouth: false, eyeColor: 0x2b1d36 });
    const mkWing = (s) => {
      const piv = b.group(core, [s * 0.38, 0.05, 0]);
      b.part(piv, G.sphere, 0x7d5cc0, [s * 0.34, 0, 0], [0.4, 0.045, 0.24], { ol: 0.025 });
      b.part(piv, G.sphere, 0x7d5cc0, [s * 0.62, -0.04, -0.05], [0.18, 0.04, 0.16], { ol: 0.02 });
      return piv;
    };
    R.wingL = mkWing(-1);
    R.wingR = mkWing(1);
    return R;
  }

  // Applies a pose (computed by Unit.computePose) to whichever rig a unit has.
  function applyPose(R, p, t) {
    const body = R.body;
    const s = Math.max(0.2, p.sq);
    body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    body.rotation.x = p.lean - p.ko * 1.45;
    body.position.y = p.bob + p.ko * 0.2 + p.hover;
    if (R.eyes) for (let i = 0; i < R.eyes.length; i++) R.eyes[i].scale.y = p.blink;
    if (R.kind === "human") {
      R.legL.rotation.x = p.legs;
      R.legR.rotation.x = -p.legs;
      R.armL.rotation.x = p.armL;
      R.armR.rotation.x = p.armR;
      R.armL.rotation.z = p.armSpread;
      R.armR.rotation.z = -p.armSpread;
      R.head.rotation.z = p.headTilt;
      R.head.rotation.x = p.headNod;
      if (R.staff) R.staff.rotation.x = -p.armR + p.tilt;
      if (R.orb && R.halo) {
        R.halo.scale.setScalar(R.haloBase * (1 + p.glow * 0.7 + Math.sin(t * 5) * 0.06));
        if (R.orb.isMesh) R.orb.scale.setScalar(0.14 * (1 + p.glow * 0.4));
      }
    } else if (R.kind === "blob") {
      if (R.legL) {
        R.legL.rotation.x = p.legs;
        R.legR.rotation.x = -p.legs;
      }
    } else if (R.kind === "bat") {
      const flap = Math.sin(t * 17 + p.flapPhase) * 0.55 * p.flap;
      R.wingL.rotation.z = -flap + 0.1;
      R.wingR.rotation.z = flap - 0.1;
      R.core.rotation.z = p.headTilt;
    }
  }

  /* ---------- particles ---------- */

  class Fx {
    constructor(scene, count) {
      this.free = [];
      this.live = [];
      for (let i = 0; i < count; i++) {
        const mat = new THREE.SpriteMaterial({ map: TEX.puff, transparent: true, depthWrite: false });
        const s = new THREE.Sprite(mat);
        s.visible = false;
        scene.add(s);
        this.free.push({ s: s });
      }
    }
    emit(o) {
      const p = this.free.pop();
      if (!p) return null;
      const s = p.s;
      const m = s.material;
      m.map = TEX[o.tex || "puff"];
      m.color.set(o.color === undefined ? 0xffffff : o.color);
      m.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.rotation = o.rot || 0;
      p.x = o.x;
      p.y = o.y;
      p.z = o.z;
      p.vx = o.vx || 0;
      p.vy = o.vy || 0;
      p.vz = o.vz || 0;
      p.g = o.g || 0;
      p.drag = o.drag || 0;
      p.life = o.life || 0.6;
      p.age = -(o.delay || 0);
      p.s0 = o.s0 === undefined ? 0.4 : o.s0;
      p.s1 = o.s1 === undefined ? p.s0 : o.s1;
      p.a0 = o.a0 === undefined ? 1 : o.a0;
      p.a1 = o.a1 === undefined ? 0 : o.a1;
      p.spin = o.spin || 0;
      p.pop = !!o.pop;
      p.to = o.to || null;
      p.arc = o.arc || 0;
      p.onEnd = o.onEnd || null;
      p.fx = p.x;
      p.fy = p.y;
      p.fz = p.z;
      s.visible = p.age >= 0;
      s.position.set(p.x, p.y, p.z);
      s.scale.set(p.s0, p.s0, 1);
      m.opacity = p.a0;
      this.live.push(p);
      return p;
    }
    update(dt) {
      for (let i = this.live.length - 1; i >= 0; i--) {
        const p = this.live[i];
        p.age += dt;
        if (p.age < 0) continue;
        const s = p.s;
        s.visible = true;
        const k = p.age / p.life;
        if (k >= 1) {
          s.visible = false;
          this.live.splice(i, 1);
          this.free.push(p);
          if (p.onEnd) p.onEnd();
          continue;
        }
        if (p.to) {
          const e = smooth(k);
          s.position.set(lerp(p.fx, p.to.x, e), lerp(p.fy, p.to.y, e) + Math.sin(e * Math.PI) * p.arc, lerp(p.fz, p.to.z, e));
        } else {
          if (p.drag) {
            const d = Math.exp(-p.drag * dt);
            p.vx *= d;
            p.vy *= d;
            p.vz *= d;
          }
          p.vy -= p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y < 0.05 && p.g > 0) {
            p.y = 0.05;
            p.vy *= -0.4;
          }
          s.position.set(p.x, p.y, p.z);
        }
        let sz = lerp(p.s0, p.s1, k);
        if (p.pop) sz *= clamp(easeOutBack(Math.min(1, k * 5)), 0, 1.4);
        s.scale.set(sz, sz, 1);
        s.material.opacity = lerp(p.a0, p.a1, k * k);
        if (p.spin) s.material.rotation += p.spin * dt;
      }
    }
    clear() {
      for (const p of this.live) {
        p.s.visible = false;
        this.free.push(p);
      }
      this.live.length = 0;
    }
    dispose(scene) {
      this.clear();
      for (const p of this.free) {
        scene.remove(p.s);
        p.s.material.dispose();
      }
      this.free.length = 0;
    }
  }

  /* ---------- units ---------- */

  const centroid = (list) => {
    let x = 0;
    let z = 0;
    for (const u of list) {
      x += u.pos.x;
      z += u.pos.z;
    }
    const n = Math.max(1, list.length);
    return { x: x / n, z: z / n };
  };

  class Unit {
    constructor(g, def, side, color) {
      this.g = g;
      this.def = def;
      this.side = side;
      this.id = nextUnitId++;
      this.toons = [];
      this.others = [];
      this.ownGeo = [];
      this.pos = new THREE.Vector3();
      this.kb = { x: 0, z: 0 };
      this.lastX = 0;
      this.lastZ = 0;
      this.yaw = side === "hero" ? Math.PI / 2 : -Math.PI / 2;
      this.faceYaw = this.yaw;
      this.alive = true;
      this.dying = false;
      this.dyingT = 0;
      this.koT = 0;
      this.act = null;
      this.cdT = 0.5 + g.rng() * 0.8;
      this.healT = 1.5;
      this.meter = 0;
      this.flash = 0;
      this.hurtT = 0;
      this.cheerT = 0;
      this.alertT = 0;
      this.phase = g.rng() * 6;
      this.speed = 0;
      this.blinkT = 1 + g.rng() * 3;
      this.blinkK = 1;
      this.lastHurt = -99;
      this.slot = 0;
      this.po = {};
      this.pose = { bob: 0, lean: 0, sq: 1, legs: 0, armL: 0, armR: 0, armSpread: 0.1, headTilt: 0, headNod: 0, blink: 1, tilt: 0.25, ko: 0, glow: 0, hover: 0, flap: 1, flapPhase: g.rng() * 6 };
      this.hud = null;
      this.scale = def.scale || 1;

      if (side === "hero") this.rig = buildHero(this, def.kind);
      else if (def.kind === "slime") this.rig = buildSlime(this, { color: color });
      else if (def.kind === "king") this.rig = buildSlime(this, { color: 0x7fa8ff, crown: true });
      else if (def.kind === "shroom") this.rig = buildShroom(this);
      else this.rig = buildBat(this);
      this.root = this.rig.root;
      this.root.scale.setScalar(this.scale);
      g.world.add(this.root);

      if (!SHADOW_MAT) SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x1f3a2a, transparent: true, opacity: 0.24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.shadow = new THREE.Mesh(G.discFlat, SHADOW_MAT);
      this.shadow.renderOrder = 1;
      g.world.add(this.shadow);
    }

    setStats(mult, hpMult) {
      const d = this.def;
      this.maxHp = Math.round(d.hp * (hpMult || mult));
      this.hp = this.maxHp;
      this.atk = d.atk * mult;
      this.cd = d.cd;
    }

    get hover() {
      return this.def.hover || 0;
    }
    headWorld(out) {
      return out.set(this.pos.x, this.def.headY * this.scale * (this.scale > 1 ? 0.92 : 1) + (this.po.hopY || 0), this.pos.z);
    }
    chest(out) {
      return out.set(this.pos.x, this.def.chestY * (this.scale > 1 ? this.scale * 0.8 : 1), this.pos.z);
    }
    get targetable() {
      return this.alive && !this.dying;
    }

    faceToward(x, z) {
      const dx = x - this.pos.x;
      const dz = z - this.pos.z;
      if (dx * dx + dz * dz > 0.0004) this.faceYaw = Math.atan2(dx, dz);
    }
    moveToward(gx, gz, speed, dt) {
      const dx = gx - this.pos.x;
      const dz = gz - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-4) return 0;
      const step = Math.min(d, speed * dt);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      this.faceYaw = Math.atan2(dx, dz);
      return d - step;
    }

    pickTarget() {
      const g = this.g;
      const list = g.opponents(this);
      if (!list.length) return null;
      if (this.side === "hero") {
        if (this.def.kind === "mage") return list.reduce((a, c) => (c.hp > a.hp ? c : a));
        let best = list[0];
        let bd = 1e9;
        for (const f of list) {
          const d = (f.pos.x - this.pos.x) ** 2 + (f.pos.z - this.pos.z) ** 2;
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
        return best;
      }
      if (this.def.hunter) return list.reduce((a, c) => (c.hp / c.maxHp < a.hp / a.maxHp ? c : a));
      let sum = 0;
      for (const h of list) sum += h.def.taunt;
      let r = g.rng() * sum;
      for (const h of list) {
        r -= h.def.taunt;
        if (r <= 0) return h;
      }
      return list[0];
    }

    beginAct(kind, tgt) {
      this.act = { kind: kind, ph: kind === "melee" || kind === "whirl" ? "dash" : kind === "slam" ? "crouch" : "cast", t: 0, tgt: tgt };
      if (kind === "meteor" || kind === "bless") this.act.ph = "charge";
      if (kind === "whirl" || kind === "meteor" || kind === "bless" || kind === "slam") {
        this.meter = 0;
        this.g.specialLock = this;
        this.g.hud.callout(this, this.def.special);
      }
    }
    endAct() {
      this.act = null;
      this.cdT = this.cd * (0.9 + this.g.rng() * 0.2);
      if (this.g.specialLock === this) this.g.specialLock = null;
    }

    // Decide what to do next (battle only, no action in flight, cooldown ready).
    think() {
      const g = this.g;
      const foes = g.opponents(this);
      if (!foes.length) return;
      const hurtAllies = g.allies(this).filter((a) => a.hp / a.maxHp < 0.7).length;
      if (this.def.special && this.meter >= SPECIAL_MAX && !g.specialLock) {
        if (this.def.kind === "cleric") {
          if (hurtAllies >= 1 && g.allies(this).reduce((s, a) => s + a.hp / a.maxHp, 0) / g.allies(this).length < 0.82) return this.beginAct("bless");
        } else {
          const k = { knight: "whirl", mage: "meteor", king: "slam" }[this.def.kind];
          return this.beginAct(k);
        }
      }
      if (this.def.healer && this.healT <= 0) {
        const w = g.mostHurtAlly(this);
        if (w && w.hp / w.maxHp < 0.62) {
          this.healT = 3.2;
          return this.beginAct("heal", w);
        }
      }
      const t = this.pickTarget();
      if (!t) return;
      this.beginAct(this.def.melee ? "melee" : "cast", t);
    }

    stepAct(dt) {
      const g = this.g;
      const a = this.act;
      const po = this.po;
      a.t += dt;
      const home = g.slotPos(this);

      // retarget if the victim vanished mid-action
      if ((a.kind === "melee" || a.kind === "cast") && (!a.tgt || !a.tgt.targetable)) {
        const nt = this.pickTarget();
        if (nt) a.tgt = nt;
        else if (a.ph !== "back") a.ph = "back";
      }

      switch (a.kind) {
        case "melee": {
          if (a.ph === "dash") {
            const tp = a.tgt.pos;
            const dx = this.pos.x - tp.x;
            const dz = this.pos.z - tp.z;
            const dl = Math.sqrt(dx * dx + dz * dz) || 1;
            const reach = this.def.reach + (a.tgt.scale > 1 ? a.tgt.scale * 0.45 : 0);
            const d = this.moveToward(tp.x + (dx / dl) * reach, tp.z + (dz / dl) * reach, DASH_SPEED * (this.def.hunter ? 1.2 : 1), dt);
            this.faceToward(tp.x, tp.z);
            if (this.def.hunter) po.hover = lerp(this.def.hover, 0.65, smooth(1 - d / 5));
            po.lean = 0.3;
            if (d < 0.08) {
              a.ph = "wind";
              a.t = 0;
              g.director.event("windup", this, a.tgt);
            }
          } else if (a.ph === "wind") {
            const WIND = this.side === "hero" ? 0.2 : 0.3;
            po.swing = clamp(a.t / WIND, 0, 1);
            this.faceToward(a.tgt.pos.x, a.tgt.pos.z);
            if (this.def.hunter) po.hover = 0.65;
            if (a.t >= WIND) {
              g.hit(this, a.tgt, this.atk, {});
              a.ph = "rec";
              a.t = 0;
            }
          } else if (a.ph === "rec") {
            po.swing = 1;
            po.slash = clamp(a.t / 0.14, 0, 1);
            if (this.def.hunter) po.hover = lerp(0.65, this.def.hover, smooth(a.t / 0.3));
            if (a.t >= 0.28) {
              a.ph = "back";
              a.t = 0;
            }
          } else {
            if (this.def.hunter) po.hover = this.def.hover;
            if (this.moveToward(home.x, home.z, RETURN_SPEED, dt) < 0.15) this.endAct();
          }
          break;
        }
        case "cast":
        case "heal": {
          this.faceToward(a.tgt.pos.x, a.tgt.pos.z);
          const CAST = 0.34;
          po.armR = lerp(0, -1.9, easeOut(a.t / (CAST * 0.8)));
          po.tilt = lerp(0.25, 0.9, easeOut(a.t / CAST));
          po.glow = clamp(a.t / CAST, 0, 1);
          po.lean = -0.1;
          if (!a.fired && a.t >= CAST) {
            a.fired = true;
            if (a.kind === "heal") g.healOne(this, a.tgt);
            else g.fireProjectile(this, a.tgt);
            g.director.event(a.kind === "heal" ? "heal" : "windup", this, a.tgt);
          }
          if (a.fired) {
            po.armR = lerp(-1.9, -0.4, easeOut((a.t - CAST) / 0.2));
            po.tilt = 0.6;
            if (a.t >= CAST + 0.3) this.endAct();
          }
          break;
        }
        case "whirl": {
          const foes = g.opponents(this);
          if (a.ph === "dash") {
            if (!foes.length) return this.endAct();
            if (!a.goal) {
              const c = centroid(foes);
              a.goal = { x: c.x - 1.3, z: c.z };
              g.director.event("special", this, { pos: c }, { name: this.def.special });
            }
            this.faceToward(a.goal.x + 1.3, a.goal.z);
            po.lean = 0.3;
            if (this.moveToward(a.goal.x, a.goal.z, DASH_SPEED * 1.15, dt) < 0.1) {
              a.ph = "spin";
              a.t = 0;
            }
          } else if (a.ph === "spin") {
            po.spin = (a.t / 0.95) * TAU * 2.5;
            po.armSpread = 1.5;
            po.armL = 0;
            po.armR = 0;
            po.sqMul = 0.94;
            if (!a.hit && a.t >= 0.25) {
              a.hit = true;
              g.whirlHit(this);
            }
            if (a.t >= 0.95) {
              a.ph = "back";
              this.faceYaw = Math.PI / 2;
            }
          } else if (this.moveToward(home.x, home.z, RETURN_SPEED * 1.2, dt) < 0.15) this.endAct();
          break;
        }
        case "meteor": {
          if (a.ph === "charge") {
            po.armR = lerp(0, -2.7, easeOut(a.t / 0.4));
            po.tilt = 0.1;
            po.glow = clamp(a.t / 0.9, 0, 1) * 2.2;
            po.hopY = Math.sin(a.t * 3) * 0.05;
            const foes = g.opponents(this);
            if (!a.mark && foes.length) {
              a.mark = g.addMarker(centroid(foes), this.def.sRadius, 1.0);
              g.director.event("special", this, { pos: a.mark }, { name: this.def.special });
            }
            if (a.mark) this.faceToward(a.mark.x, a.mark.z);
            if (a.t >= 0.95) {
              a.ph = "fall";
              a.t = 0;
              if (a.mark) g.spawnMeteor(this, a.mark, () => (a.landed = true));
              else a.landed = true;
            }
          } else if (a.ph === "fall") {
            po.armR = -2.7;
            po.glow = 1.5;
            if (a.landed) {
              a.ph = "rec";
              a.t = 0;
            }
          } else {
            po.armR = lerp(-2.7, -0.3, easeOut(a.t / 0.3));
            if (a.t >= 0.6) this.endAct();
          }
          break;
        }
        case "bless": {
          if (a.ph === "charge") {
            po.armR = lerp(0, -2.9, easeOut(a.t / 0.35));
            po.armL = lerp(0, -2.9, easeOut(a.t / 0.35));
            po.tilt = 0;
            po.glow = clamp(a.t / 0.9, 0, 1) * 2.5;
            po.hopY = easeOut(a.t / 0.9) * 0.5;
            if (!a.began) {
              a.began = true;
              g.director.event("special", this, { pos: this.pos }, { name: this.def.special });
            }
            if (Math.random() < dt * 24) g.sparkleAt(this.pos.x + (Math.random() - 0.5) * 1.6, 0.2, this.pos.z + (Math.random() - 0.5) * 1.6, 0xffe27a);
            if (a.t >= 0.95) {
              g.blessing(this);
              a.ph = "rec";
              a.t = 0;
            }
          } else {
            po.armR = -2.9;
            po.armL = -2.9;
            po.hopY = lerp(0.5, 0, a.t / 0.4);
            if (a.t >= 0.5) this.endAct();
          }
          break;
        }
        case "slam": {
          if (a.ph === "crouch") {
            po.sqMul = 1 - 0.32 * smooth(a.t / 0.5);
            if (!a.began) {
              a.began = true;
              g.director.event("special", this, { pos: centroid(g.opponents(this)) }, { name: this.def.special });
            }
            if (a.t >= 0.5) {
              a.ph = "jump";
              a.t = 0;
              a.from = { x: this.pos.x, z: this.pos.z };
              const c = centroid(g.opponents(this));
              a.to = { x: c.x + 1.2, z: c.z };
              this.faceToward(c.x, c.z);
            }
          } else if (a.ph === "jump") {
            const k = clamp(a.t / 0.62, 0, 1);
            this.pos.x = lerp(a.from.x, a.to.x, smooth(k));
            this.pos.z = lerp(a.from.z, a.to.z, smooth(k));
            po.hopY = Math.sin(k * Math.PI) * 4.2;
            po.sqMul = 1 + 0.2 * Math.sin(k * Math.PI);
            if (k >= 1) {
              g.slamHit(this);
              a.ph = "rec";
              a.t = 0;
            }
          } else if (a.ph === "rec") {
            po.sqMul = 0.8 + 0.2 * smooth(a.t / 0.6);
            if (a.t >= 0.7) a.ph = "back";
          } else if (this.moveToward(home.x, home.z, RETURN_SPEED * 0.8, dt) < 0.2) this.endAct();
          break;
        }
        default:
          this.endAct();
      }
    }

    update(dt, t) {
      const g = this.g;
      const po = (this.po = {});
      if (this.dying) {
        this.dyingT += dt;
        const k = this.dyingT / 0.55;
        this.flash = 1;
        po.spin = k * 14;
        po.hopY = Math.sin(clamp(k, 0, 1) * Math.PI) * 1.4;
        this.root.scale.setScalar(this.scale * Math.max(0.01, (1 - k * k) * (1 + 0.25 * Math.sin(k * Math.PI))));
        if (k >= 1) {
          g.removeUnit(this);
          return;
        }
        this.syncVisual(dt, t);
        return;
      }
      if (!this.alive) {
        this.koT += dt;
        if (Math.random() < dt * 2.2) g.fx.emit({ tex: "star", color: 0xffe27a, x: this.pos.x + (Math.random() - 0.5) * 0.5, y: 1.9, z: this.pos.z + (Math.random() - 0.5) * 0.5, vy: 0.5, life: 0.9, s0: 0.25, s1: 0.1, spin: 4, a1: 0 });
        this.syncVisual(dt, t);
        return;
      }

      this.flash = Math.max(0, this.flash - dt * 5);
      this.hurtT = Math.max(0, this.hurtT - dt * 3.5);
      this.cheerT = Math.max(0, this.cheerT - dt);
      this.alertT = Math.max(0, this.alertT - dt);
      this.healT -= dt;
      if (Math.abs(this.kb.x) + Math.abs(this.kb.z) > 0.01) {
        this.pos.x += this.kb.x * dt;
        this.pos.z += this.kb.z * dt;
        const d = Math.exp(-9 * dt);
        this.kb.x *= d;
        this.kb.z *= d;
      }

      if (this.act) this.stepAct(dt);
      else {
        const h = g.slotPos(this);
        const k = 1 - Math.exp(-(g.phase === "run" ? 13 : 8) * dt);
        this.pos.x += (h.x - this.pos.x) * k;
        this.pos.z += (h.z - this.pos.z) * k;
        if (g.phase === "run") this.faceYaw = this.side === "hero" ? Math.PI / 2 - g.anchor.h : -Math.PI / 2;
        else if (g.phase === "victory" || g.phase === "wipe") {
          /* keep whatever facing we had */
        } else {
          const ops = g.opponents(this);
          if (ops.length) {
            const c = centroid(ops);
            this.faceToward(c.x, c.z);
          }
        }
        if (g.phase === "battle") {
          this.cdT -= dt;
          if (this.cdT <= 0) this.think();
        }
      }
      this.syncVisual(dt, t);
    }

    computePose(dt, t) {
      const p = this.pose;
      const po = this.po;
      const dx = this.pos.x - this.lastX;
      const dz = this.pos.z - this.lastZ;
      this.lastX = this.pos.x;
      this.lastZ = this.pos.z;
      const inst = Math.sqrt(dx * dx + dz * dz) / Math.max(dt, 1e-4);
      this.speed = damp(this.speed, Math.min(inst, 16), 14, dt);
      const run = clamp(this.speed / (this.side === "hero" ? 2.4 : 3), 0, 1);
      this.phase += dt * (5 + this.speed * 1.35);
      const s = Math.sin(this.phase);
      const hero = this.rig.kind === "human";

      p.legs = s * 0.95 * run;
      p.bob = Math.abs(Math.sin(this.phase)) * (hero ? 0.17 : 0.3) * run + Math.sin(t * 2.4 + this.id) * 0.012 * (1 - run);
      p.lean = 0.2 * run;
      p.sq = 1 + Math.sin(t * 2.6 + this.id * 1.7) * 0.014 + Math.cos(2 * this.phase) * 0.05 * run;
      p.armL = -s * 0.95 * run;
      p.armR = s * 0.95 * run;
      p.armSpread = 0.1 + run * 0.1;
      p.headTilt = Math.sin(t * 1.7 + this.id) * 0.03;
      p.headNod = 0.06 * run;
      p.tilt = 0.25;
      p.glow = 0;
      p.hover = this.hover + (this.rig.kind === "bat" ? Math.sin(t * 3 + this.id) * 0.1 : 0);
      p.flap = 1;
      if (this.rig.kind === "blob" && !hero) {
        // blobs hop rather than jog
        p.bob = Math.abs(Math.sin(this.phase * 0.7)) * 0.38 * run;
        p.sq = 1 + Math.sin(this.phase * 0.7 + 1.2) * 0.14 * run + Math.sin(t * 3 + this.id) * 0.03;
        p.lean = 0.1 * run;
      }

      // wind-up / strike
      const sw = po.swing || 0;
      const sl = po.slash || 0;
      if (sw > 0) {
        p.lean += -0.25 * sw;
        p.sq -= 0.12 * sw;
        if (hero) p.armR = lerp(p.armR, -2.7, sw);
        p.headNod -= 0.1 * sw;
      }
      if (sl > 0) {
        p.lean += 0.5 * (1 - sl);
        p.sq += 0.2 * (1 - sl);
        if (hero) p.armR = lerp(-2.7, -0.15, easeOut(sl));
      }
      if (this.cheerT > 0) {
        p.armL = -2.9 + Math.sin(t * 16 + this.id) * 0.25;
        p.armR = -2.9 + Math.cos(t * 16 + this.id) * 0.25;
        p.bob += Math.abs(Math.sin(t * 8 + this.id)) * 0.4;
        p.sq += Math.sin(t * 16 + this.id) * 0.05;
      }
      if (this.alertT > 0) {
        p.bob += Math.abs(Math.sin(t * 14 + this.id)) * 0.45;
        p.sq += Math.sin(t * 28 + this.id) * 0.06;
      }
      if (this.hurtT > 0) {
        p.sq *= 1 - 0.2 * this.hurtT;
        p.lean -= 0.35 * this.hurtT;
      }
      if (po.sqMul) p.sq *= po.sqMul;
      if (po.lean) p.lean = po.lean;

      // blink / expressions
      this.blinkT -= dt;
      if (this.blinkT < 0) {
        this.blinkT = 1.8 + Math.random() * 3;
        this.blinkK = 0;
      }
      this.blinkK = Math.min(1, this.blinkK + dt * 9);
      p.blink = Math.max(0.1, this.blinkK < 0.5 ? this.blinkK * 2 : 1);
      if (this.hurtT > 0.35) p.blink = 0.12;
      if (!this.alive && !this.dying) p.blink = 0.1;
      if (this.cheerT > 0) p.blink = 0.18;

      p.ko = this.alive || this.dying ? 0 : easeOut(this.koT / 0.4);
      if (p.ko > 0) {
        p.armL = 0.2;
        p.armR = 0.2;
        p.legs = 0;
        p.bob = 0;
        p.lean = 0;
      }
      for (const k of ["armL", "armR", "armSpread", "tilt", "glow", "hover"]) if (po[k] !== undefined) p[k] = po[k];
      if (po.hover === undefined && this.rig.kind === "bat") p.hover = this.hover + Math.sin(t * 3 + this.id) * 0.1;
    }

    syncVisual(dt, t) {
      this.computePose(dt, t);
      this.yaw += angleDelta(this.yaw, this.faceYaw) * (1 - Math.exp(-14 * dt));
      const hop = this.po.hopY || 0;
      this.root.position.set(this.pos.x, hop, this.pos.z);
      this.root.rotation.y = this.yaw + (this.po.spin || 0);
      applyPose(this.rig, this.pose, t);
      const f = this.flash * 0.75;
      for (let i = 0; i < this.toons.length; i++) this.toons[i].emissive.setRGB(f, f, f);
      const r = 0.62 * this.scale * (this.rig.kind === "bat" ? 0.7 : 1) * (1 - Math.min(0.5, hop * 0.1));
      this.shadow.position.set(this.pos.x, 0.03, this.pos.z);
      this.shadow.scale.set(r, 1, r * 0.92);
    }

    dispose() {
      this.g.world.remove(this.root);
      this.g.world.remove(this.shadow);
      this.toons.forEach((m) => m.dispose());
      this.others.forEach((m) => m.dispose());
      this.ownGeo.forEach((m) => m.dispose());
    }
  }

  /* ---------- pond water: a small stylised shader ---------- */

  const POND_SQUASH = 0.82; // ponds are ovals, narrower across z
  const POND_WATER_R = 0.99;

  // Cel-shaded water: depth-banded tint, scrolling ripple lines, a wobbling
  // foam ring at the bank and a few twinkling sparkles. Unlit and opaque, so
  // it costs one tiny fragment shader per pond. Frozen ponds (aIce) keep the
  // lines but stop moving and lose the foam. Tint comes in on the vertex
  // colour so one shared material serves every biome.
  function makeWaterMat() {
    return new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexColors: true,
      fog: true,
      vertexShader: `
        attribute float aIce;
        varying vec2 vP; varying vec3 vTint; varying float vIce; varying float vSeed;
        #include <fog_pars_vertex>
        void main() {
          vP = position.xz; vTint = color; vIce = aIce;
          vSeed = fract(sin(dot(modelMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 60.0;
          vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vP; varying vec3 vTint; varying float vIce; varying float vSeed;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 q = vec2(vP.x, vP.y / ${POND_SQUASH.toFixed(2)});
          float d = length(q) / ${POND_WATER_R.toFixed(2)};
          float t = (1.0 - vIce) * uTime + vSeed;
          float depthT = smoothstep(0.2, 0.95, d);
          depthT = mix(depthT, floor(depthT * 3.0 + 0.5) / 3.0, 0.55);
          vec3 shallow = mix(vTint * 1.3, vec3(0.78, 0.72, 0.5), 0.22);
          vec3 col = mix(vTint * 0.5, shallow, depthT);
          vec2 p = q * 3.4 + vec2(0.0, vSeed);
          float w1 = sin(p.x * 3.0 + sin(p.y * 2.1 + t * 0.8) * 1.4 + t * 0.7);
          float w2 = sin(p.y * 3.4 - sin(p.x * 1.7 - t * 0.6) * 1.2 - t * 0.9);
          col = mix(col, vec3(1.0), smoothstep(0.9, 0.97, max(w1, w2)) * 0.24);
          float ang = atan(q.y, q.x);
          float fr = d + 0.03 * sin(ang * 13.0 + t * 1.4) + 0.015 * sin(ang * 29.0 - t * 2.1);
          col = mix(col, vec3(0.95, 0.99, 1.0), smoothstep(0.82, 0.88, fr) * (1.0 - vIce) * 0.85);
          col = mix(col, vec3(0.9, 0.97, 1.0), vIce * 0.5);
          vec2 cell = floor(q * 10.0 + vSeed);
          float h = hash(cell);
          col += step(0.975, h) * pow(max(0.0, sin(uTime * 2.5 + h * 60.0)), 10.0) * 0.9;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
  }

  /* ---------- scenery: ground, road, props, arena decals ---------- */

  const GRASS_CLUMPS = ["grass_a", "grass_b", "grass_c"];
  const GRASS_PICK = ["grass_a", "grass_b", "grass_b", "grass_c", "grass_c"]; // grass_a is the pricey pom-pom (243 tris, can't decimate further), so it is drawn less
  // per-chunk counts at full density; touch screens get half (triangles, not draw calls, are the cost).
  // ?grass=N overrides the density multiplier (e.g. ?grass=1 on a phone, ?grass=0 for none).
  const GRASS_VERGE = 210;
  const GRASS_PATCHES = 24;
  const GRASS_DENSITY = (() => {
    const q = parseFloat(new URLSearchParams(location.search).get("grass"));
    if (isFinite(q) && q >= 0) return q;
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? 0.5 : 1;
  })();
  const PROP_SHADOW ={ tree: 1.0, pine: 0.9, bush: 0.75, rock: 0.8, mushroom: 0.4, grass: 0.3 };

  class Scenery {
    constructor(g) {
      this.g = g;
      this.group = new THREE.Group();
      g.scene.add(this.group);
      this.chunks = new Map();
      this.decals = new Map();
      this.propMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD });
      this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x1f3a2a, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const photo = !!(PHOTO && TEX.groundPhoto);
      this.roadMat = new THREE.MeshToonMaterial(
        photo
          ? { map: TEX.roadPhoto, alphaMap: TEX.roadAlpha, transparent: true, depthWrite: false, gradientMap: GRAD, polygonOffset: true, polygonOffsetFactor: -1 }
          : { map: TEX.dirt, transparent: true, depthWrite: false, gradientMap: GRAD, polygonOffset: true, polygonOffsetFactor: -1 }
      );
      this.arenaMat = new THREE.MeshToonMaterial({ map: photo ? TEX.arenaPhoto : TEX.arena, transparent: true, depthWrite: false, gradientMap: GRAD, polygonOffset: true, polygonOffsetFactor: -1.5 });
      this.groundMat = new THREE.MeshToonMaterial({ map: photo ? TEX.groundPhoto[0] : TEX.ground, color: 0xa5e27d, gradientMap: GRAD });
      if (photo) this.blendGround(this.groundMat);
      this.waterMat = makeWaterMat();
      if (!photo) TEX.ground.repeat.set(240 / 8, 176 / 8);
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 176).rotateX(-Math.PI / 2), this.groundMat);
      this.group.add(this.ground);
      this.decalGeo = new THREE.CircleGeometry(9.5, 48).rotateX(-Math.PI / 2);
    }

    // Three greyscale grasses at unrelated scales (8 / 11 / 6.5 world units per
    // tile) mixed by low-frequency world-space noise, so no single photographic
    // repeat reads as a pattern. The biome tint is still the material colour.
    blendGround(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTexB = { value: TEX.groundPhoto[1] };
        sh.uniforms.uTexC = { value: TEX.groundPhoto[2] };
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
varying vec3 vWPos;
uniform sampler2D uTexB;
uniform sampler2D uTexC;
float ccH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float ccN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ccH(i), ccH(i + vec2(1.0, 0.0)), f.x), mix(ccH(i + vec2(0.0, 1.0)), ccH(i + vec2(1.0, 1.0)), f.x), f.y);
}`
          )
          .replace(
            "#include <map_fragment>",
            `vec2 wp = vWPos.xz;
vec3 ga = texture2D(map, wp / 8.0).rgb;
vec3 gb = texture2D(uTexB, wp / 11.0 + 0.37).rgb;
vec3 gc = texture2D(uTexC, wp / 6.5 + 0.71).rgb;
vec3 gm = mix(ga, gb, smoothstep(0.4, 0.6, ccN(wp * 0.05)));
gm = mix(gm, gc, 0.85 * smoothstep(0.5, 0.75, ccN(wp * 0.035 + 31.7)));
diffuseColor *= vec4(gm * 1.14, 1.0); // maps are centred under white so highlights survive 8-bit; lift back to ~1`
          );
      };
    }

    buildChunk(ci) {
      const course = this.g.course;
      const group = new THREE.Group();
      const rng = mulberry32(hash2(ci + 5000, this.g.seed));
      const x0 = ci * CHUNK;

      // road ribbon
      const pos = new Float32Array((CHUNK + 1) * 2 * 3);
      const uv = new Float32Array((CHUNK + 1) * 2 * 2);
      const nor = new Float32Array((CHUNK + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i <= CHUNK; i++) {
        const x = x0 + i;
        const zc = course.z(x);
        pos.set([x, 0.03, zc - ROAD_HALF, x, 0.03, zc + ROAD_HALF], i * 6);
        uv.set([x / 3, 0, x / 3, 1], i * 4);
        nor.set([0, 1, 0, 0, 1, 0], i * 6);
        if (i < CHUNK) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      rg.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      rg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      rg.setIndex(idx);
      const road = new THREE.Mesh(rg, this.roadMat);
      road.frustumCulled = false;
      road.renderOrder = 0.5;
      group.add(road);

      // props
      const biome = biomeDiscrete(x0 + CHUNK / 2);
      const table = [
        ["tree", 3],
        ["pine", biome.pine],
        ["bush", 2.5],
        ["flowers", 4],
        ["grass", PROP_DATA && PROP_DATA.grass ? 5 : 0],
        ["rock", 1.2],
        ["mushroom", 1],
        ["fence", 0.5],
        ["pond", 0.7],
      ];
      const shadows = [];
      const n = 18 + Math.floor(rng() * 6);
      for (let k = 0; k < n; k++) {
        const x = x0 + rng() * CHUNK;
        const side = rng() < 0.5 ? -1 : 1;
        let z = course.z(x) + side * (ROAD_HALF + 1.0 + Math.pow(rng(), 1.35) * 27);
        let blocked = false;
        for (const a of course.arenas) if (Math.abs(x - a.x) < 12.5 && Math.abs(z - a.z) < 11) blocked = true;
        if (blocked) continue;
        const type = pickWeighted(rng, table);
        let color = 0xffffff;
        let variant = 0;
        let scale = 0.8 + rng() * 0.6;
        if (type === "tree" || type === "bush" || type === "grass") color = biome.leaf[Math.floor(rng() * 3)];
        else if (type === "pine") color = new THREE.Color(biome.leaf[Math.floor(rng() * 3)]).offsetHSL(0, 0, biome === BIOMES[3] ? 0 : -0.12).getHex();
        else if (type === "flowers") {
          color = biome.flower[Math.floor(rng() * 4)];
          variant = Math.floor(rng() * 3);
          scale = 1.1 + rng() * 0.8;
        } else if (type === "rock") color = rng() < 0.5 ? 0xb9c0d6 : 0xcdbfd6;
        else if (type === "mushroom") color = biome === BIOMES[3] ? 0x8fb4ff : 0xff6f7a;
        else if (type === "fence") scale = 1;
        else if (type === "pond") {
          scale = 0.85 + rng() * 0.4;
          color = biome.water;
          variant = biome.ice ? 1 : 0;
          z += side * 1.2; // a pond's bank is wide: keep it off the road
        }
        const prop = buildProp(type, color, variant);
        const m = new THREE.Mesh(prop.geo, this.propMat);
        m.position.set(x, 0, z);
        m.rotation.y = type === "fence" ? course.heading(x) + (rng() < 0.3 ? 1.57 : 0) : rng() * TAU;
        m.scale.setScalar(scale);
        group.add(m);
        if (prop.water) {
          const wm = new THREE.Mesh(prop.water, this.waterMat);
          wm.position.copy(m.position);
          wm.rotation.y = m.rotation.y;
          wm.scale.setScalar(scale);
          group.add(wm);
        }
        const sr = PROP_SHADOW[type];
        if (sr) shadows.push(piece(G.discFlat, 0x000000, x, 0.025, z, sr * scale * 0.95, 1, sr * scale * 0.85));
      }
      let sg = null;
      if (shadows.length) {
        sg = merged(shadows);
        const sm = new THREE.Mesh(sg, this.shadowMat);
        sm.renderOrder = 1;
        sm.frustumCulled = false;
        group.add(sm);
      }
      const geos = sg ? [rg, sg] : [rg];

      // grass clumps: dozens per chunk, so they are baked into ONE merged mesh
      // (one draw call) and kept to a couple of hundred tris each
      const cg = this.buildGrass(ci, biome);
      if (cg) {
        group.add(new THREE.Mesh(cg, this.propMat));
        geos.push(cg);
      }
      this.group.add(group);
      return { group: group, geos: geos };
    }

    // The hero path is overgrown: a dense verge hugging both road edges
    // (heavily biased toward the road, a few clumps nibbling onto it), plus
    // looser patches and loners further out. Arenas stay clear. Own rng stream
    // so adding/removing them never reshuffles the props.
    buildGrass(ci, biome) {
      if (!PROP_DATA || !GRASS_CLUMPS.every((t) => PROP_DATA[t])) return null;
      const course = this.g.course;
      const rng = mulberry32(hash2(ci + 9000, this.g.seed));
      const x0 = ci * CHUNK;
      const placed = [];
      const spot = (cx, cz, r, clear) => {
        const x = cx + (rng() * 2 - 1) * r;
        const z = cz + (rng() * 2 - 1) * r;
        if (Math.abs(z - course.z(x)) < clear) return;
        for (const a of course.arenas) if (Math.abs(x - a.x) < 12.5 && Math.abs(z - a.z) < 11) return;
        const geo = buildProp(GRASS_PICK[Math.floor(rng() * GRASS_PICK.length)], biome.leaf[Math.floor(rng() * 3)], 0).geo;
        const g = geo.clone();
        g.applyMatrix4(
          new THREE.Matrix4().compose(
            _v().set(x, 0, z),
            new THREE.Quaternion().setFromAxisAngle(_v().set(0, 1, 0), rng() * TAU),
            _v().setScalar(0.7 + rng() * 0.8)
          )
        );
        placed.push(g);
      };
      const side = () => (rng() < 0.5 ? -1 : 1);
      for (let k = 0, n = Math.round(GRASS_VERGE * GRASS_DENSITY); k < n; k++) {
        const px = x0 + rng() * CHUNK;
        spot(px, course.z(px) + side() * (ROAD_HALF - 0.3 + Math.pow(rng(), 2.4) * 13), 0.01, ROAD_HALF - 0.3);
      }
      for (let p = 0, n = Math.round(GRASS_PATCHES * GRASS_DENSITY); p < n; p++) {
        const px = x0 + rng() * CHUNK;
        const pz = course.z(px) + side() * (ROAD_HALF + 0.8 + Math.pow(rng(), 1.2) * 18);
        const cnt = 4 + Math.floor(rng() * 5);
        for (let k = 0; k < cnt; k++) spot(px, pz, 1.9, ROAD_HALF + 0.3);
      }
      for (let k = 0; k < 6; k++) {
        const px = x0 + rng() * CHUNK;
        spot(px, course.z(px) + side() * (ROAD_HALF + 0.8 + rng() * 18), 0.01, ROAD_HALF + 0.3);
      }
      return placed.length ? merged(placed) : null;
    }

    tick(dt) {
      this.waterMat.uniforms.uTime.value += dt;
    }

    update(fx, fz) {
      const course = this.g.course;
      const c0 = Math.floor(fx / CHUNK) - CHUNK_BEHIND;
      const c1 = Math.floor(fx / CHUNK) + CHUNK_AHEAD;
      for (let ci = c0; ci <= c1; ci++) if (!this.chunks.has(ci)) this.chunks.set(ci, this.buildChunk(ci));
      for (const [ci, ch] of this.chunks) {
        if (ci < c0 - 1 || ci > c1 + 1) {
          this.group.remove(ch.group);
          ch.geos.forEach((g) => g.dispose());
          this.chunks.delete(ci);
        }
      }
      // arena decals
      for (const a of course.arenas) {
        if (a.start || this.decals.has(a)) continue;
        const m = new THREE.Mesh(this.decalGeo, this.arenaMat);
        m.position.set(a.x, 0.02, a.z);
        this.group.add(m);
        this.decals.set(a, m);
      }
      for (const [a, m] of this.decals) {
        if (!course.arenas.includes(a)) {
          this.group.remove(m);
          this.decals.delete(a);
        }
      }
      this.ground.position.set(Math.floor(fx / 8) * 8, 0, Math.floor(fz / 8) * 8);
    }

    dispose() {
      this.g.scene.remove(this.group);
      for (const ch of this.chunks.values()) ch.geos.forEach((g) => g.dispose());
      this.chunks.clear();
      this.decalGeo.dispose();
      this.ground.geometry.dispose();
      [this.propMat, this.shadowMat, this.roadMat, this.arenaMat, this.groundMat, this.waterMat].forEach((m) => m.dispose());
    }
  }

  /* ---------- the battle director ---------- */

  // Event-driven camera shots layered on top of the "fit everyone" framing.
  // Each shot has a priority; a lower-priority event can't interrupt a
  // higher-priority shot that's still holding. Strength eases in, holds,
  // eases out, so the camera drifts toward the action and back instead of
  // cutting. Only active in Director mode.
  class Director {
    constructor(g) {
      this.g = g;
      this.shot = null;
      this.lastShotT = -9;
    }
    clear() {
      this.shot = null;
    }
    push(s) {
      const c = this.shot;
      if (c && c.t < c.hold && c.pri > s.pri) return;
      if (c && c.pri === s.pri && c.t < Math.min(0.45, c.hold * 0.5)) return;
      this.lastShotT = this.g.t;
      this.shot = Object.assign({ t: 0, inT: 0.3, out: 0.6, hold: 0.6, zoom: 0.8, azOff: 0, pitchOff: 0, fovOff: 0 }, s);
      this.g.hud.setCamText(s.name);
    }
    event(kind, a, b, data) {
      const g = this.g;
      if (g.S.battleCam !== "director" || (g.phase !== "battle" && g.phase !== "intro")) return;
      const mid = () => ({ x: (a.pos.x + b.pos.x) / 2, y: 1.0, z: (a.pos.z + b.pos.z) / 2 });
      const at = (o) => () => ({ x: o.pos.x, y: 1.0, z: o.pos.z });
      switch (kind) {
        case "windup":
          // routine swings only nudge the camera, and only when it is otherwise idle
          if (a.side === "hero" && !this.shot && g.t - this.lastShotT > 0.5) this.push({ name: "Attack nudge", pri: 1, hold: 0.45, zoom: 0.9, focus: mid });
          break;
        case "crit":
          this.push({ name: "Crit punch-in", pri: 2, hold: 0.5, zoom: 0.62, azOff: 14, pitchOff: -6, focus: at(b) });
          break;
        case "heal":
          this.push({ name: "Heal", pri: 2, hold: 0.6, zoom: 0.74, focus: at(b) });
          break;
        case "kill": {
          const p = { x: b.pos.x, y: 1.0, z: b.pos.z };
          if (data && data.final) {
            this.push({ name: "Finishing shot", pri: 5, hold: 1.2, out: 0.8, zoom: 0.55, azOff: -24, pitchOff: -8, focus: () => p });
            g.slowmo(0.28, 0.85);
          } else this.push({ name: "KO", pri: 3, hold: 0.5, zoom: 0.66, focus: () => p });
          break;
        }
        case "special": {
          const nm = data.name;
          if (nm === "Whirlwind") {
            this.push({ name: "Whirlwind", pri: 4, hold: 1.6, zoom: 0.6, azOff: 26, pitchOff: -8, focus: mid });
            g.slowmo(0.55, 0.5);
          } else if (nm === "Meteor") {
            const caster = a;
            const mk = b.pos;
            this.push({
              name: "Meteor: caster → impact",
              pri: 4,
              hold: 2.1,
              zoom: 0.6,
              azOff: -28,
              pitchOff: -10,
              focus: function () {
                const k = smooth((this.t - 0.7) / 0.5);
                return { x: lerp(caster.pos.x, mk.x, k), y: 1.0 + k * 0.5, z: lerp(caster.pos.z, mk.z, k) };
              },
            });
            g.slowmo(0.5, 0.45);
          } else if (nm === "Blessing") {
            this.push({ name: "Blessing", pri: 4, hold: 1.5, zoom: 0.68, pitchOff: -6, focus: () => ({ x: g.partyCenter().x, y: 1.0, z: g.partyCenter().z }) });
          } else {
            this.push({ name: nm, pri: 4, hold: 1.6, zoom: 0.62, azOff: 20, pitchOff: -6, focus: mid });
          }
          break;
        }
        case "impact": {
          const p = { x: a.x, y: 0.8, z: a.z };
          this.push({ name: "Impact", pri: 4, hold: 0.9, zoom: 0.66, focus: () => p });
          g.slowmo(0.4, 0.4);
          break;
        }
        default:
          break;
      }
    }
    // 0..1 strength of the current shot, advancing its clock.
    strength(dt) {
      const s = this.shot;
      if (!s) return 0;
      s.t += dt;
      if (s.t >= s.hold + s.out) {
        this.shot = null;
        return 0;
      }
      if (s.t < s.inT) return smooth(s.t / s.inT);
      if (s.t < s.hold) return 1;
      return 1 - smooth((s.t - s.hold) / s.out);
    }
  }

  /* ---------- HUD ---------- */

  const CSS = `
#cc-root { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #cdeeff; user-select: none; -webkit-user-select: none;
  font-family: ui-rounded, "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif; }
#cc-root canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
.cc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; color: #5a4a7a; }
.cc-ui { position: absolute; inset: 0; pointer-events: none; color: #fff; }
.cc-heads { position: absolute; inset: 0; overflow: hidden; }
.cc-tag { position: absolute; left: 0; top: 0; will-change: transform; display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; transition: opacity .25s; }
.cc-tag.off { opacity: 0; }
.cc-tag.ko { opacity: .55; filter: grayscale(.8); }
.cc-nm { font-size: 11px; font-weight: 900; letter-spacing: .04em; text-shadow: 0 1px 0 #3a2a55, 0 0 4px #3a2a55, 0 0 4px #3a2a55; white-space: nowrap; }
.cc-nm b { color: #ffe27a; margin-left: 3px; }
.cc-bar { position: relative; width: 58px; height: 9px; border-radius: 6px; background: #3a2a55; border: 2px solid #fff; box-shadow: 0 2px 0 rgba(58,42,85,.55); overflow: hidden; }
.cc-bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: linear-gradient(180deg, #8dff8a, #3fd16a); border-radius: 4px; transition: width .12s linear; }
.cc-bar i.mid { background: linear-gradient(180deg, #ffe97a, #f2b633); }
.cc-bar i.low { background: linear-gradient(180deg, #ff9aa8, #ff4d6d); }
.cc-bar i.lag { background: #fff; opacity: .85; transition: width .6s ease .25s; z-index: 0; }
.cc-bar i.fill { z-index: 1; }
.cc-tag.foe .cc-bar { width: 42px; height: 7px; border-width: 1.5px; }
.cc-sp { width: 50px; height: 5px; border-radius: 4px; background: #3a2a55; border: 1.5px solid #fff; overflow: hidden; }
.cc-sp i { display: block; height: 100%; width: 0; background: linear-gradient(180deg, #8fe8ff, #4da6ff); }
.cc-sp.full i { background: linear-gradient(180deg, #fff6a8, #ffc53a); animation: cc-pulse .5s ease-in-out infinite alternate; }
@keyframes cc-pulse { to { filter: brightness(1.35); } }
.cc-fl { position: absolute; left: 0; top: 0; will-change: transform; pointer-events: none; font-weight: 900; font-size: 20px; color: #fff; white-space: nowrap;
  text-shadow: 0 2px 0 #3a2a55, 2px 0 0 #3a2a55, -2px 0 0 #3a2a55, 0 -2px 0 #3a2a55, 0 0 8px rgba(58,42,85,.7); }
.cc-fl.crit { font-size: 30px; color: #ffe27a; }
.cc-fl.hurt { color: #ff8da1; }
.cc-fl.heal { color: #8dffb0; }
.cc-fl.call { font-size: 17px; letter-spacing: .08em; color: #fff6c0; text-transform: uppercase; }
.cc-top { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 12px; right: 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cc-top-r { display: flex; gap: 8px; }
.cc-btn { pointer-events: auto; cursor: pointer; font: inherit; font-weight: 900; color: #fff; background: rgba(58,42,85,.72); border: 2px solid #fff; border-radius: 14px; box-shadow: 0 3px 0 rgba(58,42,85,.5); }
.cc-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(58,42,85,.5); }
.cc-round { width: 42px; height: 42px; font-size: 20px; line-height: 1; }
.cc-pill { height: 42px; padding: 0 12px; font-size: 15px; }
.cc-chip { margin-top: 2px; padding: 6px 14px; border-radius: 16px; background: rgba(58,42,85,.72); border: 2px solid #fff; font-weight: 900; font-size: 14px; letter-spacing: .03em; text-align: center; white-space: nowrap; }
.cc-chip small { display: block; font-size: 10px; font-weight: 700; opacity: .8; letter-spacing: .08em; text-transform: uppercase; }
.cc-banner { position: absolute; left: 50%; top: 24%; transform: translate(-50%, -50%) scale(.6); opacity: 0; font-size: clamp(34px, 9vw, 64px); font-weight: 900; letter-spacing: .04em; text-align: center; white-space: nowrap;
  color: #fff; text-shadow: 0 4px 0 #3a2a55, 4px 0 0 #3a2a55, -4px 0 0 #3a2a55, 0 -4px 0 #3a2a55, 0 8px 18px rgba(58,42,85,.5); }
.cc-banner.show { animation: cc-banner 1.3s cubic-bezier(.2,1.4,.4,1) forwards; }
.cc-banner.gold { color: #ffe27a; }
.cc-banner.pink { color: #ffa0c0; }
@keyframes cc-banner { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4) rotate(-6deg); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1.1) rotate(2deg); } 30% { transform: translate(-50%, -50%) scale(1) rotate(0); } 82% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -62%) scale(1); } }
.cc-cam { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(var(--cc-panel, 12px) + 14px); font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 3px 10px; border-radius: 10px; background: rgba(58,42,85,.6); opacity: 0; transition: opacity .3s; white-space: nowrap; }
.cc-cam.on { opacity: .95; }
.cc-panel { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + env(safe-area-inset-bottom)); width: min(600px, 96vw); display: flex; gap: 8px; }
.cc-panel.off { display: none; }
.cc-card { flex: 1; min-width: 0; padding: 7px 9px 8px; border-radius: 16px; background: rgba(58,42,85,.78); border: 2px solid #fff; box-shadow: 0 4px 0 rgba(58,42,85,.5); transition: filter .3s, transform .15s; }
.cc-card.ko { filter: grayscale(.9) brightness(.8); }
.cc-card.act { transform: translateY(-4px); }
.cc-card-h { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.cc-ava { width: 30px; height: 30px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid #fff; }
.cc-card-n { font-size: 13px; font-weight: 900; line-height: 1.05; min-width: 0; }
.cc-card-n small { display: block; font-size: 10px; font-weight: 800; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-card .cc-bar { width: auto; height: 12px; }
.cc-card .cc-bar span { position: absolute; inset: 0; z-index: 2; text-align: center; font-size: 9px; line-height: 9px; font-weight: 900; text-shadow: 0 1px 0 #3a2a55, 0 0 3px #3a2a55; }
.cc-card .cc-sp { width: auto; height: 6px; margin-top: 4px; }
.cc-sheet { position: absolute; right: 12px; top: calc(max(10px, env(safe-area-inset-top)) + 52px); width: min(330px, calc(100% - 24px)); max-height: calc(100% - 140px); overflow-y: auto; padding: 12px 12px 8px; border-radius: 18px; pointer-events: auto;
  background: rgba(40,28,66,.92); border: 2px solid #fff; box-shadow: 0 8px 24px rgba(40,28,66,.5); transform-origin: top right; transition: transform .18s ease, opacity .18s ease; opacity: 0; transform: scale(.9); visibility: hidden; }
.cc-sheet.open { opacity: 1; transform: scale(1); visibility: visible; }
.cc-sheet h3 { margin: 0 0 8px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; color: #ffe27a; }
.cc-row { margin-bottom: 9px; }
.cc-row label { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; opacity: .85; margin-bottom: 3px; }
.cc-row label kbd { font: inherit; opacity: .6; }
.cc-seg { display: flex; gap: 4px; flex-wrap: wrap; }
.cc-seg button { flex: 1; min-width: 0; font: inherit; font-size: 13px; font-weight: 800; padding: 7px 4px; color: #fff; background: rgba(255,255,255,.1); border: 2px solid rgba(255,255,255,.35); border-radius: 10px; cursor: pointer; }
.cc-seg button.on { background: #ffc53a; color: #3a2a55; border-color: #fff; }
.cc-note { font-size: 10px; opacity: .65; margin: 2px 0 4px; line-height: 1.3; }
.cc-fatal { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; background: #2a2340; color: #fff; font-weight: 700; }
.cc-fatal p { margin: 0 0 16px; opacity: .85; font-weight: 500; }
@media (max-width: 520px) { .cc-card-n small { display: none; } .cc-ava { width: 26px; height: 26px; font-size: 14px; } }
`;

  const HUD_HTML = `
<div class="cc-ui">
  <div class="cc-heads" data-cc="heads"></div>
  <div class="cc-top">
    <button class="cc-btn cc-round" data-cc="menu" type="button" aria-label="Menu">&#8801;</button>
    <div class="cc-chip" data-cc="chip"></div>
    <div class="cc-top-r">
      <button class="cc-btn cc-pill" data-cc="speed" type="button">1&times;</button>
      <button class="cc-btn cc-round" data-cc="gear" type="button" aria-label="Settings">&#9881;</button>
    </div>
  </div>
  <div class="cc-banner" data-cc="banner"></div>
  <div class="cc-cam" data-cc="cam"></div>
  <div class="cc-panel" data-cc="panel"></div>
  <div class="cc-sheet" data-cc="sheet"></div>
</div>`;

  function hpClass(f) {
    return f > 0.55 ? "" : f > 0.28 ? "mid" : "low";
  }

  class Hud {
    constructor(g, root) {
      this.g = g;
      this.root = root;
      this.el = {};
      root.querySelectorAll("[data-cc]").forEach((n) => (this.el[n.getAttribute("data-cc")] = n));
      this.floats = [];
      this.tags = [];
      this.cards = [];
      this.bannerTimer = 0;
      this.camTimer = 0;
      this.tmp = new THREE.Vector3();
      this.tmp2 = new THREE.Vector3();
      this.buildSheet();
      this.buildPanel();
      this.applySettings();
    }

    buildSheet() {
      const g = this.g;
      let h = "<h3>Experiments</h3>";
      OPTIONS.forEach((o) => {
        h += '<div class="cc-row"><label><span>' + o.label + "</span><kbd>" + o.hot + '</kbd></label><div class="cc-seg" data-key="' + o.key + '">';
        o.opts.forEach((p) => {
          h += '<button type="button" data-v="' + p[0] + '">' + p[1] + "</button>";
        });
        h += "</div></div>";
      });
      h += '<div class="cc-note">Formation changes apply live. Pack size applies to the next encounter. Director = Fit + event-driven shots (wind-ups, crits, kills, specials, slow-mo finisher).</div>';
      this.el.sheet.innerHTML = h;
      this.el.sheet.querySelectorAll(".cc-seg button").forEach((b) => {
        b.addEventListener("click", () => {
          const key = b.parentNode.getAttribute("data-key");
          const opt = OPTIONS.find((o) => o.key === key);
          const val = opt.opts.find((p) => String(p[0]) === b.getAttribute("data-v"))[0];
          g.setSetting(key, val);
        });
      });
    }

    buildPanel() {
      let h = "";
      HERO_DEFS.forEach((d, i) => {
        h +=
          '<div class="cc-card" data-card="' + i + '"><div class="cc-card-h"><div class="cc-ava" style="background:' + d.color + '">' + d.icon + '</div>' +
          '<div class="cc-card-n">' + d.name + "<small>" + d.special + '</small></div></div>' +
          '<div class="cc-bar"><i class="lag"></i><i class="fill"></i><span></span></div><div class="cc-sp"><i></i></div></div>';
      });
      this.el.panel.innerHTML = h;
      this.cards = Array.from(this.el.panel.querySelectorAll(".cc-card")).map((c) => ({
        el: c,
        fill: c.querySelector(".fill"),
        lag: c.querySelector(".lag"),
        txt: c.querySelector(".cc-bar span"),
        sp: c.querySelector(".cc-sp"),
        spi: c.querySelector(".cc-sp i"),
        nm: c.querySelector(".cc-card-n"),
      }));
    }

    applySettings() {
      const S = this.g.S;
      this.el.sheet.querySelectorAll(".cc-seg").forEach((seg) => {
        const key = seg.getAttribute("data-key");
        seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-v") === String(S[key])));
      });
      this.el.speed.innerHTML = S.speed + "&times;";
      this.el.panel.classList.toggle("off", S.ui === "heads");
      this.root.style.setProperty("--cc-panel", S.ui === "heads" ? "12px" : "92px");
    }

    panelPx() {
      return this.g.S.ui === "heads" ? 0 : this.el.panel.offsetHeight + 12;
    }

    attach(u) {
      const el = document.createElement("div");
      el.className = "cc-tag " + u.side;
      if (u.side === "hero") {
        el.innerHTML =
          '<div class="cc-nm">' + u.def.name + "<b>Lv" + this.g.level + '</b></div><div class="cc-bar"><i class="lag"></i><i class="fill"></i></div><div class="cc-sp"><i></i></div>';
      } else el.innerHTML = '<div class="cc-bar"><i class="lag"></i><i class="fill"></i></div>';
      this.el.heads.appendChild(el);
      u.hud = { el: el, fill: el.querySelector(".fill"), lag: el.querySelector(".lag"), sp: el.querySelector(".cc-sp"), spi: el.querySelector(".cc-sp i"), lv: el.querySelector(".cc-nm b"), ratio: -1 };
      this.tags.push(u);
    }
    detach(u) {
      if (u.hud && u.hud.el.parentNode) u.hud.el.parentNode.removeChild(u.hud.el);
      const i = this.tags.indexOf(u);
      if (i >= 0) this.tags.splice(i, 1);
      u.hud = null;
    }

    project(v, w, h) {
      this.tmp.copy(v).project(this.g.camera);
      if (this.tmp.z > 1) return null;
      return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h };
    }

    float(text, x, y, z, cls, life, rise) {
      if (this.floats.length > 40) this.dropFloat(this.floats[0]);
      const el = document.createElement("div");
      el.className = "cc-fl " + (cls || "");
      el.textContent = text;
      this.el.heads.appendChild(el);
      this.floats.push({ el: el, x: x + (Math.random() - 0.5) * 0.5, y: y, z: z, age: 0, life: life || 0.95, rise: rise || 1.6 });
    }
    dropFloat(f) {
      if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
      const i = this.floats.indexOf(f);
      if (i >= 0) this.floats.splice(i, 1);
    }
    damage(text, u, cls) {
      this.float(text, u.pos.x, u.def.headY * u.scale * 0.75, u.pos.z, cls, 0.95, 1.6);
    }
    callout(u, text) {
      this.float(text + "!", u.pos.x, u.def.headY * u.scale + 0.5, u.pos.z, "call", 1.5, 0.7);
    }

    banner(text, cls) {
      const b = this.el.banner;
      b.textContent = text;
      b.className = "cc-banner " + (cls || "");
      void b.offsetWidth;
      b.classList.add("show");
    }
    setCamText(text, force) {
      if (!force && this.g.S.battleCam !== "director") return;
      this.el.cam.textContent = "🎥 " + text;
      this.el.cam.classList.add("on");
      this.camTimer = 1.4;
    }

    update(dt) {
      const g = this.g;
      const w = g.width;
      const h = g.height;
      const S = g.S;
      const showHeroTags = S.ui !== "panel";
      const inFight = g.phase === "battle" || g.phase === "intro";

      for (const u of this.tags) {
        const t = u.hud;
        if (!t) continue;
        const ratio = clamp(u.hp / u.maxHp, 0, 1);
        let visible;
        if (u.side === "hero") visible = showHeroTags;
        else visible = u.targetable && (S.ui !== "panel" ? inFight || g.phase === "victory" : g.t - u.lastHurt < 3);
        t.el.classList.toggle("off", !visible);
        t.el.classList.toggle("ko", !u.alive && u.side === "hero");
        if (!visible) continue;
        if (ratio !== t.ratio) {
          t.ratio = ratio;
          t.fill.style.width = ratio * 100 + "%";
          t.lag.style.width = ratio * 100 + "%";
          t.fill.className = "fill " + hpClass(ratio);
        }
        if (t.lv) t.lv.textContent = "Lv" + g.level;
        if (t.sp) {
          t.spi.style.width = clamp(u.meter / SPECIAL_MAX, 0, 1) * 100 + "%";
          t.sp.classList.toggle("full", u.meter >= SPECIAL_MAX);
        }
        const p = this.project(this.tmp2.set(u.pos.x, u.def.headY * u.scale * (u.scale > 1 ? 0.9 : 1) + 0.25 + ((u.po && u.po.hopY) || 0), u.pos.z), w, h);
        if (!p) {
          t.el.classList.add("off");
          continue;
        }
        t.el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) translate(-50%,-100%)";
      }

      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i];
        f.age += dt;
        const k = f.age / f.life;
        if (k >= 1) {
          this.dropFloat(f);
          continue;
        }
        const p = this.project(this.tmp.set(f.x, f.y + easeOut(k) * f.rise, f.z), w, h);
        if (!p) continue;
        const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.7 : 1.2 - 0.2 * Math.min(1, (k - 0.15) * 3);
        f.el.style.opacity = k > 0.7 ? String(1 - (k - 0.7) / 0.3) : "1";
        f.el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) translate(-50%,-100%) scale(" + sc.toFixed(2) + ")";
      }

      if (this.camTimer > 0) {
        this.camTimer -= dt;
        if (this.camTimer <= 0) this.el.cam.classList.remove("on");
      }

      // party panel
      if (S.ui !== "heads") {
        g.heroes.forEach((u, i) => {
          const c = this.cards[i];
          if (!c) return;
          const ratio = clamp(u.hp / u.maxHp, 0, 1);
          c.fill.style.width = ratio * 100 + "%";
          c.lag.style.width = ratio * 100 + "%";
          c.fill.className = "fill " + hpClass(ratio);
          c.txt.textContent = Math.ceil(u.hp) + " / " + u.maxHp;
          c.spi.style.width = clamp(u.meter / SPECIAL_MAX, 0, 1) * 100 + "%";
          c.sp.classList.toggle("full", u.meter >= SPECIAL_MAX);
          c.el.classList.toggle("ko", !u.alive);
          c.el.classList.toggle("act", !!u.act);
          c.nm.firstChild.nodeValue = u.def.name + " Lv" + g.level;
        });
      }
    }

    updateChip() {
      const g = this.g;
      this.el.chip.innerHTML =
        "Fight " + g.fightNo + " &middot; Lv " + g.level + " &middot; 🪙 " + g.coins + "<small>" + g.streak + " win streak &middot; best " + g.best + " &middot; " + g.biomeName + "</small>";
    }

    dispose() {
      clearTimeout(this.bannerTimer);
    }
  }

  /* ---------- the game ---------- */

  const SLIME_COLORS = [0x8fe3a0, 0x8fd0ff, 0xffa8c8, 0xffd77a];
  const CONFETTI = [0xff7aa8, 0xffe27a, 0x8fe3ff, 0xa6f08a, 0xc9a6ff];

  class Game {
    constructor(root, handle) {
      this.root = root;
      this.handle = handle;
      this.listeners = [];
      this.S = loadSettings();
      this.best = loadBest();
      this.seed = (Math.random() * 1e9) | 0;
      const q = /[?&]cc=(\d+)/.exec(window.location.search);
      if (q) this.seed = parseInt(q[1], 10);
      this.rng = mulberry32(this.seed ^ 0x5eed);
      this.t = 0;
      this.timeScale = 1;
      this.slow = { scale: 1, t: 0 };
      this.hitstopT = 0;
      this.trauma = 0;
      this.paused = false;
      this.destroyed = false;
      this.phase = "run";
      this.phaseT = 0;
      this.level = 1;
      this.wins = 0;
      this.streak = 0;
      this.coins = 0;
      this.fightNo = 1;
      this.doneIdx = 0;
      this.biomeName = "";
      this.heroes = [];
      this.foes = [];
      this.enc = null;
      this.specialLock = null;
      this.projs = [];
      this.meteors = [];
      this.rings = [];
      this.markers = [];
      this.timers = [];
      this.cam = null;
      this.width = 1;
      this.height = 1;
      this.aspect = 1.6;

      this.setupRenderer();
      this.hud = new Hud(this, root);
      this.director = new Director(this);
      this.scenery = null;
      this.bindInput();
      this.startRun();
      this.scenery = new Scenery(this);
      this.updateCamera(0.016, true);

      this.lastFrame = performance.now();
      this.tick = this.tick.bind(this);
      this.raf = requestAnimationFrame(this.tick);
    }

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    }

    /* ----- renderer / scene ----- */

    setupRenderer() {
      const lowPower = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
      this.renderer = new THREE.WebGLRenderer({
        antialias: !lowPower,
        powerPreference: lowPower ? "default" : "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
      if (!this.renderer.getContext()) throw new Error("WebGL context could not be created");
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
      this.canvas = this.renderer.domElement;
      this.root.insertBefore(this.canvas, this.root.firstChild);
      this.listen(this.canvas, "webglcontextlost", (e) => {
        e.preventDefault();
        console.error("Chibi Crawl: WebGL context lost.", e.statusMessage || "");
        this.onContextLost();
      });

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xcdeeff);
      this.scene.fog = new THREE.Fog(0xcdeeff, 40, 110);
      this.camera = new THREE.PerspectiveCamera(24, 1, 1, 400);
      this.scene.add(new THREE.HemisphereLight(0xfff6ee, 0xb9d7a8, 1.05));
      const sun = new THREE.DirectionalLight(0xfff0d8, 1.35);
      sun.position.set(-8, 14, 6);
      this.scene.add(sun);
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.fx = new Fx(this.scene, 320);
      this.tmpA = new THREE.Vector3();
      this.tmpB = new THREE.Vector3();

      this.resize();
      const onResize = () => this.resize();
      this.listen(window, "resize", onResize);
      this.listen(window, "orientationchange", onResize);
    }

    resize() {
      this.width = Math.max(1, this.root.clientWidth);
      this.height = Math.max(1, this.root.clientHeight);
      this.aspect = this.width / this.height;
      this.camera.aspect = this.aspect;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);
    }

    /* ----- input ----- */

    bindInput() {
      const el = this.hud.el;
      this.listen(el.menu, "click", () => window.returnToMenu && window.returnToMenu());
      this.listen(el.gear, "click", () => el.sheet.classList.toggle("open"));
      this.listen(el.speed, "click", () => this.setSetting("speed", (this.S.speed % 3) + 1));
      this.listen(window, "keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key.toLowerCase();
        const cyc = { c: "view", b: "battleCam", f: "formation", e: "foeFormation", g: "foes", u: "ui" }[k];
        if (cyc) this.cycle(cyc);
        else if (k === "1" || k === "2" || k === "3") this.setSetting("speed", parseInt(k, 10));
        else if (k === "p") this.paused = !this.paused;
        else if (k === "escape") el.sheet.classList.remove("open");
      });
    }

    cycle(key) {
      const opt = OPTIONS.find((o) => o.key === key);
      const i = opt.opts.findIndex((p) => p[0] === this.S[key]);
      const next = opt.opts[(i + 1) % opt.opts.length];
      this.setSetting(key, next[0]);
      this.hud.setCamText(opt.label + ": " + next[1], true);
    }

    setSetting(key, val) {
      this.S[key] = val;
      saveSettings(this.S);
      this.hud.applySettings();
      if (key === "battleCam") this.director.clear();
      if (key === "foes" && this.phase === "run" && this.enc && !this.enc.alerted) this.respawnEncounter();
    }

    /* ----- run lifecycle ----- */

    addUnit(def, side, color) {
      const u = new Unit(this, def, side, color);
      this.hud.attach(u);
      return u;
    }
    removeUnit(u) {
      let i = this.heroes.indexOf(u);
      if (i >= 0) this.heroes.splice(i, 1);
      i = this.foes.indexOf(u);
      if (i >= 0) this.foes.splice(i, 1);
      if (this.specialLock === u) this.specialLock = null;
      this.hud.detach(u);
      u.dispose();
    }
    heroMult() {
      return 1 + LEVEL_BONUS * (this.level - 1);
    }

    startRun() {
      this.course = new Course(this.rng);
      this.anchor = { x: 0, z: this.course.z(0), h: this.course.heading(0) };
      this.heroes.slice().forEach((u) => this.removeUnit(u));
      this.foes.slice().forEach((u) => this.removeUnit(u));
      this.heroes = [];
      HERO_DEFS.forEach((d, i) => {
        const u = this.addUnit(d, "hero");
        u.slot = i;
        u.setStats(this.heroMult());
        const p = this.slotPos(u);
        u.pos.set(p.x, 0, p.z);
        u.lastX = p.x;
        u.lastZ = p.z;
        this.heroes.push(u);
      });
      this.spawnEncounter();
      this.hud.updateChip();
    }

    spawnEncounter() {
      const course = this.course;
      const arena = course.arenas.find((a) => !a.start && a.idx > this.doneIdx);
      course.plan(arena.x + 260);
      const boss = arena.idx % 5 === 0;
      let n = this.S.foes;
      if (!n) n = boss ? 3 : pickWeighted(this.rng, [[2, 3], [3, 4], [4, 3], [5, 1.2]]) + (arena.idx > 12 ? 1 : 0);
      const kinds = [];
      if (boss) kinds.push("king");
      while (kinds.length < n) kinds.push(pickWeighted(this.rng, [["slime", 4], ["shroom", 3], ["bat", 3]]));
      const order = { king: 0, shroom: 1, slime: 2, bat: 3 };
      kinds.sort((a, b) => order[a] - order[b]);
      this.enc = { arena: arena, count: kinds.length, alerted: false, boss: boss };
      const mult = 1 + FOE_SCALE_PER_FIGHT * (arena.idx - 1);
      kinds.forEach((k, i) => {
        const u = this.addUnit(FOE_DEFS[k], "foe", SLIME_COLORS[Math.floor(this.rng() * SLIME_COLORS.length)]);
        u.slot = i;
        u.setStats(mult);
        const p = this.slotPos(u);
        u.pos.set(p.x, 0, p.z);
        u.lastX = p.x;
        u.lastZ = p.z;
        this.foes.push(u);
      });
    }
    respawnEncounter() {
      this.foes.slice().forEach((u) => this.removeUnit(u));
      this.spawnEncounter();
    }

    slotPos(u) {
      if (u.side === "hero") {
        const s = formationSlot(this.S.formation, u.slot, this.heroes.length || 3);
        const h = this.anchor.h;
        const c = Math.cos(h);
        const sn = Math.sin(h);
        return { x: this.anchor.x - s.u * c - s.v * sn, z: this.anchor.z - s.u * sn + s.v * c };
      }
      const a = this.enc.arena;
      const s = formationSlot(this.S.foeFormation, u.slot, this.enc.count);
      return { x: a.x + FOE_STAND + s.u, z: a.z + s.v };
    }

    opponents(u) {
      return (u.side === "hero" ? this.foes : this.heroes).filter((o) => o.targetable);
    }
    allies(u) {
      return (u.side === "hero" ? this.heroes : this.foes).filter((o) => o.targetable);
    }
    mostHurtAlly(u) {
      let best = null;
      for (const a of this.allies(u)) if (a.hp < a.maxHp && (!best || a.hp / a.maxHp < best.hp / best.maxHp)) best = a;
      return best;
    }
    partyCenter() {
      const live = this.heroes.filter((h) => h.alive);
      const c = centroid(live.length ? live : this.heroes);
      return { x: c.x, z: c.z };
    }
    later(sec, fn) {
      this.timers.push({ t: sec, fn: fn });
    }

    /* ----- phases ----- */

    stepSim(dt) {
      this.t += dt;
      this.phaseT += dt;
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const tm = this.timers[i];
        tm.t -= dt;
        if (tm.t <= 0) {
          this.timers.splice(i, 1);
          tm.fn();
        }
      }
      switch (this.phase) {
        case "run":
          this.stepRun(dt);
          break;
        case "intro":
          if (this.phaseT >= INTRO_S) {
            this.phase = "battle";
            this.phaseT = 0;
            this.heroes.concat(this.foes).forEach((u) => (u.cdT = 0.25 + this.rng() * 0.8));
          }
          break;
        case "battle":
          if (!this.foes.some((f) => f.targetable)) this.beginVictory();
          else if (!this.heroes.some((h) => h.alive)) this.beginWipe();
          break;
        case "victory":
          if (this.phaseT >= VICTORY_S) this.finishEncounter();
          break;
        case "wipe":
          if (this.phaseT >= WIPE_S) {
            this.heroes.forEach((h) => !h.alive && this.revive(h, 0.6));
            this.heroes.forEach((h) => (h.hp = Math.max(h.hp, h.maxHp * 0.6)));
            this.foes.forEach((f) => this.poof(f.pos.x, 0.8, f.pos.z, 0xffffff, 6));
            this.finishEncounter();
          }
          break;
        default:
          break;
      }
      const units = this.heroes.concat(this.foes);
      for (let i = 0; i < units.length; i++) units[i].update(dt, this.t);
      this.updateProjectiles(dt);
      this.updateRings(dt);
    }

    stepRun(dt) {
      const a = this.enc.arena;
      const A = this.anchor;
      const stopX = a.x - PARTY_STOP;
      const remain = stopX - A.x;
      if (remain <= 0.03) {
        A.x = stopX;
        this.beginIntro();
        return;
      }
      A.x += Math.min(remain, lerp(0.9, RUN_SPEED, smooth(remain / 7)) * dt);
      A.z = this.course.z(A.x);
      A.h = this.course.heading(A.x);
      for (const h of this.heroes) if (h.alive) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * RUN_REGEN * dt);
      if (!this.enc.alerted && a.x + FOE_STAND - A.x <= 19) this.alertFoes();
      this.course.prune(A.x);
    }

    alertFoes() {
      this.enc.alerted = true;
      this.foes.forEach((f, i) => {
        f.alertT = 0.9;
        this.fx.emit({ tex: "excl", x: f.pos.x, y: f.def.headY * f.scale + 0.7, z: f.pos.z, vy: 0.4, life: 1.1, s0: 0.95, s1: 0.95, a1: 0, pop: true, delay: i * 0.08 });
      });
    }

    beginIntro() {
      this.phase = "intro";
      this.phaseT = 0;
      this.fightNo = this.enc.arena.idx;
      this.director.clear();
      this.hud.banner(this.enc.boss ? "BOSS FIGHT!" : "FIGHT!", this.enc.boss ? "pink" : "");
      this.hud.updateChip();
      this.foes.forEach((f) => (f.alertT = 0.6));
    }

    beginVictory() {
      this.phase = "victory";
      this.phaseT = 0;
      this.wins++;
      this.streak++;
      if (this.streak > this.best) {
        this.best = this.streak;
        saveBest(this.best);
      }
      this.heroes.forEach((h) => h.alive && (h.cheerT = VICTORY_S - 0.3));
      this.hud.banner("VICTORY!", "gold");
      const c = this.partyCenter();
      this.confetti(c.x + 1.5, c.z);
      this.later(0.7, () => this.heroes.forEach((h) => !h.alive && this.revive(h, REVIVE_FRAC)));
      const newLevel = 1 + Math.floor(this.wins / LEVEL_EVERY);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.heroes.forEach((h) => {
          h.setStats(this.heroMult());
          if (h.hud && h.hud.lv) h.hud.lv.textContent = "Lv" + this.level;
        });
        this.later(0.9, () => {
          this.hud.banner("LEVEL UP!  Lv " + this.level, "gold");
          this.heroes.forEach((h) => {
            h.alive && (h.hp = h.maxHp);
            this.sparkleAt(h.pos.x, 0.5, h.pos.z, 0xffe27a, 8);
          });
        });
      }
      this.hud.updateChip();
    }

    beginWipe() {
      this.phase = "wipe";
      this.phaseT = 0;
      this.streak = 0;
      this.foes.forEach((f) => f.targetable && (f.cheerT = WIPE_S));
      this.hud.banner("Oh no!  Nap time…", "pink");
      this.director.clear();
      this.hud.updateChip();
    }

    revive(u, frac) {
      u.alive = true;
      u.koT = 0;
      u.act = null;
      u.hp = Math.max(1, Math.round(u.maxHp * frac));
      u.cdT = 0.6;
      this.sparkleAt(u.pos.x, 0.8, u.pos.z, 0x8dffb0, 10);
      this.hud.float("+" + u.hp, u.pos.x, 1.8, u.pos.z, "heal", 0.95, 1.4);
    }

    finishEncounter() {
      this.doneIdx = this.enc.arena.idx;
      this.foes.slice().forEach((f) => this.removeUnit(f));
      this.specialLock = null;
      this.projs.forEach((p) => this.disposeProj(p));
      this.projs.length = 0;
      this.markers.forEach((m) => this.disposeMarker(m));
      this.markers.length = 0;
      this.heroes.forEach((h) => {
        h.act = null;
        h.cdT = 0.5;
      });
      this.timers.length = 0;
      this.director.clear();
      this.spawnEncounter();
      this.phase = "run";
      this.phaseT = 0;
      this.hud.updateChip();
    }

    /* ----- combat ----- */

    hit(att, tgt, base, o) {
      o = o || {};
      if (!tgt.targetable) return;
      let dmg = base * (0.9 + this.rng() * 0.2);
      const crit = !o.noCrit && this.rng() < (att.side === "hero" ? CRIT_CHANCE : 0.06);
      if (crit) dmg *= CRIT_MULT;
      dmg = Math.max(1, Math.round(dmg));
      tgt.hp -= dmg;
      tgt.flash = 1;
      tgt.hurtT = 1;
      tgt.lastHurt = this.t;
      const dx = tgt.pos.x - att.pos.x;
      const dz = tgt.pos.z - att.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      const kb = ((o.kb || 3.2) * (crit ? 1.4 : 1)) / (tgt.scale > 1 ? 2 : 1);
      tgt.kb.x += (dx / l) * kb;
      tgt.kb.z += (dz / l) * kb;
      if (!o.aoe) att.meter = Math.min(SPECIAL_MAX, att.meter + 9);
      tgt.meter = Math.min(SPECIAL_MAX, tgt.meter + 7);
      const c = tgt.chest(this.tmpA);
      this.hitSpark(c.x, c.y, c.z, crit);
      this.hud.damage(String(dmg) + (crit ? "!" : ""), tgt, crit ? "crit" : tgt.side === "hero" ? "hurt" : "");
      this.shake(crit ? 0.32 : 0.1);
      if (crit) this.hitstopT = Math.max(this.hitstopT, 0.07);
      if (crit) this.director.event("crit", att, tgt);
      if (tgt.hp <= 0) this.kill(tgt, att);
    }

    kill(u, by) {
      u.hp = 0;
      u.alive = false;
      u.act = null;
      if (this.specialLock === u) this.specialLock = null;
      this.hitstopT = Math.max(this.hitstopT, 0.1);
      this.shake(0.4);
      if (u.side === "foe") {
        u.dying = true;
        u.dyingT = 0;
        const c = u.chest(this.tmpA);
        this.poof(c.x, c.y, c.z, 0xffffff, 8);
        this.starBurst(c.x, c.y, c.z, 0xffe27a, 7);
        const gain = Math.max(1, Math.round(u.def.xp * (0.8 + this.rng() * 0.5)));
        const to = this.partyCenter();
        for (let i = 0; i < Math.min(5, 1 + Math.floor(gain / 3)); i++) {
          this.fx.emit({ tex: "coin", x: c.x, y: c.y, z: c.z, to: { x: to.x, y: 1.2, z: to.z }, arc: 2.2 + this.rng(), life: 0.7 + this.rng() * 0.3, delay: 0.25 + i * 0.07, s0: 0.38, s1: 0.28, a1: 1, onEnd: () => ((this.coins += Math.ceil(gain / 3)), this.hud.updateChip()) });
        }
        const final = !this.foes.some((f) => f.targetable);
        this.director.event("kill", by, u, { final: final });
      } else {
        u.koT = 0;
        this.hud.float("KO!", u.pos.x, 2.2, u.pos.z, "hurt", 1.2, 1.0);
        this.director.event("kill", by, u, {});
      }
    }

    healOne(c, tgt) {
      if (!tgt.alive) return;
      const amt = Math.round(c.atk * 2.7);
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
      c.meter = Math.min(SPECIAL_MAX, c.meter + 14);
      this.hud.float("+" + amt, tgt.pos.x, tgt.def.headY * tgt.scale * 0.8, tgt.pos.z, "heal", 0.95, 1.6);
      this.hearts(tgt.pos.x, tgt.pos.z, 5);
      this.ring(tgt.pos.x, tgt.pos.z, 0.3, 1.5, 0.6, 0x8dffb0, 0.8);
    }

    blessing(c) {
      this.ring(c.pos.x, c.pos.z, 0.5, 9, 0.9, 0xffe27a, 0.9);
      this.ring(c.pos.x, c.pos.z, 0.3, 6, 0.7, 0xffffff, 0.7);
      this.shake(0.2);
      for (const a of this.heroes) {
        if (!a.alive) {
          this.revive(a, 0.35);
          continue;
        }
        const amt = Math.round(a.maxHp * 0.38);
        a.hp = Math.min(a.maxHp, a.hp + amt);
        this.hud.float("+" + amt, a.pos.x, a.def.headY * 0.8, a.pos.z, "heal", 1.1, 1.7);
        this.hearts(a.pos.x, a.pos.z, 6);
        this.sparkleAt(a.pos.x, 0.5, a.pos.z, 0xffe27a, 6);
      }
    }

    whirlHit(u) {
      this.ring(u.pos.x, u.pos.z, 0.6, u.def.sRadius + 0.4, 0.45, 0xffffff, 0.95);
      this.ring(u.pos.x, u.pos.z, 0.3, u.def.sRadius, 0.6, 0x9fd0ff, 0.7);
      this.shake(0.5);
      this.poof(u.pos.x, 0.3, u.pos.z, 0xffffff, 10);
      for (const f of this.opponents(u)) {
        const d = Math.hypot(f.pos.x - u.pos.x, f.pos.z - u.pos.z);
        if (d <= u.def.sRadius + 0.4) this.hit(u, f, u.atk * 1.7, { aoe: true, kb: 8 });
      }
    }

    slamHit(u) {
      const r = u.def.sRadius;
      this.ring(u.pos.x, u.pos.z, 0.8, r + 0.5, 0.55, 0xffffff, 0.95);
      this.ring(u.pos.x, u.pos.z, 0.4, r, 0.75, 0x7fa8ff, 0.7);
      this.shake(0.85);
      this.hitstopT = Math.max(this.hitstopT, 0.09);
      this.poof(u.pos.x, 0.3, u.pos.z, 0xe8f0ff, 14);
      this.director.event("impact", { x: u.pos.x, z: u.pos.z });
      for (const h of this.opponents(u)) {
        const d = Math.hypot(h.pos.x - u.pos.x, h.pos.z - u.pos.z);
        if (d <= r + 0.5) this.hit(u, h, u.atk * 1.4, { aoe: true, kb: 9, noCrit: true });
      }
    }

    fireProjectile(att, tgt) {
      const from = att.chest(new THREE.Vector3());
      from.y += 0.7;
      const isMage = att.def.kind === "mage";
      const color = isMage ? 0xff8a3a : 0xfff0a0;
      const mesh = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const orb = new THREE.Mesh(G.sphereLo, mat);
      orb.scale.setScalar(isMage ? 0.22 : 0.16);
      mesh.add(orb);
      const gm = new THREE.SpriteMaterial({ map: isMage ? TEX.soft : TEX.star, color: color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Sprite(gm);
      glow.scale.setScalar(isMage ? 0.9 : 0.6);
      mesh.add(glow);
      this.scene.add(mesh);
      const d = Math.hypot(tgt.pos.x - from.x, tgt.pos.z - from.z);
      this.projs.push({ att: att, tgt: tgt, from: from, t: 0, dur: clamp(0.22 + d * 0.028, 0.25, 0.6), mesh: mesh, mats: [mat, gm], color: color, mage: isMage, last: new THREE.Vector3().copy(from) });
    }
    disposeProj(p) {
      this.scene.remove(p.mesh);
      p.mats.forEach((m) => m.dispose());
    }
    spawnMeteor(u, mark, cb) {
      const mesh = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
      const orb = new THREE.Mesh(G.sphere, mat);
      orb.scale.setScalar(0.85);
      mesh.add(orb);
      const gm = new THREE.SpriteMaterial({ map: TEX.soft, color: 0xffb04a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Sprite(gm);
      glow.scale.setScalar(4);
      mesh.add(glow);
      this.scene.add(mesh);
      this.meteors.push({ u: u, mark: mark, t: 0, dur: 0.55, mesh: mesh, mats: [mat, gm], cb: cb });
    }
    updateProjectiles(dt) {
      for (let i = this.projs.length - 1; i >= 0; i--) {
        const p = this.projs[i];
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        if (p.tgt.targetable || !p.to) p.to = p.tgt.chest(p.to || new THREE.Vector3());
        const x = lerp(p.from.x, p.to.x, k);
        const z = lerp(p.from.z, p.to.z, k);
        const y = lerp(p.from.y, p.to.y, k) + Math.sin(k * Math.PI) * 0.9;
        p.mesh.position.set(x, y, z);
        this.fx.emit({ tex: p.mage ? "puff" : "star", color: p.color, add: true, x: x, y: y, z: z, vy: 0.3, life: 0.28, s0: p.mage ? 0.34 : 0.24, s1: 0.04, a0: 0.8, spin: 5 });
        if (k >= 1) {
          this.projs.splice(i, 1);
          this.disposeProj(p);
          if (p.tgt.targetable) {
            if (p.att.def.healer) this.hit(p.att, p.tgt, p.att.atk, { kb: 2.2 });
            else {
              this.hit(p.att, p.tgt, p.att.atk, { kb: 3 });
              if (p.mage)
                for (const o of this.opponents(p.att)) {
                  if (o !== p.tgt && Math.hypot(o.pos.x - p.tgt.pos.x, o.pos.z - p.tgt.pos.z) < 1.6) this.hit(p.att, o, p.att.atk * 0.35, { noCrit: true, kb: 2 });
                }
            }
          }
          this.starBurst(x, y, z, p.color, 5);
        }
      }
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const m = this.meteors[i];
        m.t += dt;
        const k = Math.min(1, m.t / m.dur);
        const e = k * k;
        m.mesh.position.set(m.mark.x + (1 - e) * 7, lerp(16, 0.7, e), m.mark.z - (1 - e) * 2.5);
        this.fx.emit({ tex: "puff", color: 0xff9a3a, add: true, x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z, life: 0.4, s0: 1.2, s1: 0.2, a0: 0.8 });
        this.fx.emit({ tex: "puff", color: 0x6a5a7a, x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z, life: 0.7, s0: 0.9, s1: 1.6, a0: 0.5 });
        if (k >= 1) {
          this.meteors.splice(i, 1);
          this.scene.remove(m.mesh);
          m.mats.forEach((x) => x.dispose());
          this.meteorImpact(m);
          m.cb();
        }
      }
      for (let i = this.markers.length - 1; i >= 0; i--) {
        const mk = this.markers[i];
        mk.age += dt;
        const pulse = 1 + Math.sin(mk.age * 10) * 0.04;
        mk.mesh.scale.set(pulse * Math.min(1, mk.age * 6), 1, pulse * Math.min(1, mk.age * 6));
        mk.mat.opacity = 0.35 + Math.sin(mk.age * 12) * 0.12;
      }
    }
    meteorImpact(m) {
      const u = m.u;
      const r = u.def.sRadius;
      const mk = m.mark;
      this.ring(mk.x, mk.z, 0.6, r + 1, 0.55, 0xffd27a, 0.95);
      this.ring(mk.x, mk.z, 0.3, r, 0.8, 0xff7a3a, 0.8);
      this.poof(mk.x, 0.5, mk.z, 0xffb04a, 16);
      this.poof(mk.x, 0.5, mk.z, 0x5a4a6a, 8);
      this.starBurst(mk.x, 1.0, mk.z, 0xffe27a, 12);
      this.shake(1);
      this.hitstopT = Math.max(this.hitstopT, 0.1);
      this.director.event("impact", { x: mk.x, z: mk.z });
      this.disposeMarker(mk);
      const i = this.markers.indexOf(mk);
      if (i >= 0) this.markers.splice(i, 1);
      for (const f of this.opponents(u)) {
        const d = Math.hypot(f.pos.x - mk.x, f.pos.z - mk.z);
        if (d <= r) this.hit(u, f, u.atk * 3.0 * (1 - 0.3 * (d / r)), { aoe: true, kb: 9 });
      }
    }
    addMarker(c, radius) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.4, depthWrite: false });
      const disc = new THREE.Mesh(G.discFlat, mat);
      disc.scale.set(radius, 1, radius);
      const ringm = new THREE.Mesh(G.ringFlat, mat);
      ringm.scale.set(radius, 1, radius);
      group.add(disc);
      group.add(ringm);
      group.position.set(c.x, 0.07, c.z);
      this.scene.add(group);
      const mk = { x: c.x, z: c.z, mesh: group, mat: mat, age: 0 };
      this.markers.push(mk);
      return mk;
    }
    disposeMarker(mk) {
      this.scene.remove(mk.mesh);
      mk.mat.dispose();
    }

    slowmo(scale, dur) {
      if (this.slow.t > 0 && this.slow.scale < scale) return;
      this.slow.scale = scale;
      this.slow.t = dur;
    }
    shake(a) {
      this.trauma = Math.min(1, this.trauma + a);
    }

    /* ----- effects ----- */

    ring(x, z, r0, r1, life, color, alpha) {
      const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(G.ringFlat, mat);
      mesh.position.set(x, 0.09, z);
      mesh.scale.set(r0, 1, r0);
      this.scene.add(mesh);
      this.rings.push({ mesh: mesh, mat: mat, t: 0, life: life, r0: r0, r1: r1, a: alpha });
    }
    updateRings(dt) {
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) {
          this.scene.remove(r.mesh);
          r.mat.dispose();
          this.rings.splice(i, 1);
          continue;
        }
        const s = lerp(r.r0, r.r1, easeOut(k));
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = r.a * (1 - k);
      }
    }
    poof(x, y, z, color, n) {
      for (let i = 0; i < n; i++) {
        const a = this.rng() * TAU;
        const s = 1 + this.rng() * 2.4;
        this.fx.emit({ tex: "puff", color: color, x: x, y: y, z: z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 0.6 + this.rng() * 1.6, drag: 2.5, life: 0.5 + this.rng() * 0.3, s0: 0.5, s1: 1.1, a0: 0.9 });
      }
    }
    starBurst(x, y, z, color, n) {
      for (let i = 0; i < n; i++) {
        const a = this.rng() * TAU;
        const s = 2 + this.rng() * 3;
        this.fx.emit({ tex: "star", color: color, add: true, x: x, y: y, z: z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 1.5 + this.rng() * 3, g: 9, life: 0.5 + this.rng() * 0.3, s0: 0.34, s1: 0.1, spin: 6 });
      }
    }
    hitSpark(x, y, z, crit) {
      this.fx.emit({ tex: "spark", color: crit ? 0xffe27a : 0xffffff, add: true, x: x, y: y + 0.2, z: z, life: crit ? 0.32 : 0.2, s0: crit ? 1.5 : 0.95, s1: crit ? 2.2 : 1.3, a0: 1, rot: this.rng() });
      this.starBurst(x, y, z, crit ? 0xffd24a : 0xffffff, crit ? 7 : 3);
    }
    sparkleAt(x, y, z, color, n) {
      for (let i = 0; i < (n || 1); i++) {
        this.fx.emit({ tex: "spark", color: color, add: true, x: x + (this.rng() - 0.5) * 0.8, y: y + this.rng() * 0.6, z: z + (this.rng() - 0.5) * 0.8, vy: 0.8 + this.rng(), life: 0.7, s0: 0.5, s1: 0.1, a0: 1, spin: 3 });
      }
    }
    hearts(x, z, n) {
      for (let i = 0; i < n; i++) this.fx.emit({ tex: "heart", color: 0xff8fb1, x: x + (this.rng() - 0.5) * 0.9, y: 0.6 + this.rng() * 0.5, z: z + (this.rng() - 0.5) * 0.9, vy: 1.4 + this.rng(), life: 0.9, s0: 0.36, s1: 0.5, a1: 0, delay: i * 0.06 });
    }
    confetti(x, z) {
      for (let i = 0; i < 46; i++) {
        const a = this.rng() * TAU;
        const s = 1 + this.rng() * 4.5;
        this.fx.emit({ tex: i % 3 ? "petal" : "star", color: CONFETTI[i % CONFETTI.length], x: x, y: 1.2, z: z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 5 + this.rng() * 5, g: 9, drag: 0.6, life: 1.6 + this.rng() * 0.6, s0: 0.3, s1: 0.22, a1: 1, spin: (this.rng() - 0.5) * 12 });
      }
    }

    /* ----- stepping ----- */

    step(dtReal) {
      if (this.paused || this.destroyed) return;
      if (this.hitstopT > 0) {
        this.hitstopT -= dtReal;
        this.timeScale = 0.04;
      } else {
        const target = this.slow.t > 0 ? this.slow.scale : 1;
        this.slow.t -= dtReal;
        this.timeScale = damp(this.timeScale, target, 14, dtReal);
      }
      const simDt = dtReal * this.S.speed * this.timeScale;
      let rem = simDt;
      while (rem > 1e-6) {
        const sub = Math.min(rem, 1 / 30);
        this.stepSim(sub);
        rem -= sub;
      }
      this.fx.update(simDt);
      this.trauma = Math.max(0, this.trauma - dtReal * 1.5);
      this.updateCamera(dtReal * Math.min(this.S.speed, 2));
    }

    /* ----- camera ----- */

    baseView() {
      const v = VIEWS[this.S.view];
      const port = clamp((1.3 - this.aspect) / 0.7, 0, 1);
      return { pitch: v.pitch + 10 * port, az: lerp(v.az, Math.min(v.az, 20), port), dist: v.dist, fov: v.fov };
    }

    fit(points, base, pad) {
      const az = base.az * DEG;
      const fx = Math.cos(az);
      const fz = -Math.sin(az);
      const rx = Math.sin(az);
      const rz = Math.cos(az);
      let minR = 1e9;
      let maxR = -1e9;
      let minF = 1e9;
      let maxF = -1e9;
      for (const p of points) {
        const r = p.x * rx + p.z * rz;
        const f = p.x * fx + p.z * fz;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (f < minF) minF = f;
        if (f > maxF) maxF = f;
      }
      const cr = (minR + maxR) / 2;
      const cf = (minF + maxF) / 2;
      const tanH = Math.tan((base.fov * DEG) / 2);
      const availH = 1 - Math.min(0.4, this.hud.panelPx() / this.height);
      const pitch = base.pitch * DEG;
      const spanV = (maxF - minF) * Math.sin(pitch) + (2.7 + pad * 0.5) * Math.cos(pitch);
      const dh = ((maxR - minR) / 2 + pad) / (tanH * this.aspect);
      const dv = (spanV / 2 + 0.6) / (tanH * availH);
      return { x: rx * cr + fx * cf, y: 0.9, z: rz * cr + fz * cf, dist: Math.max(dh, dv), az: base.az, pitch: base.pitch, fov: base.fov };
    }

    cameraTarget(dt) {
      const S = this.S;
      const base = this.baseView();
      if (this.camOverride) return Object.assign({ y: 0.9, shot: false }, base, this.camOverride);
      const ph = this.phase;
      const fight = ph === "intro" || ph === "battle" || ph === "victory" || ph === "wipe";
      let fr;
      if (fight && S.battleCam === "fixed") {
        const a = this.enc.arena;
        const x0 = a.x - PARTY_STOP - 3.2;
        const x1 = a.x + FOE_STAND + 3.6;
        fr = this.fit([{ x: x0, z: a.z - 4.2 }, { x: x0, z: a.z + 4.2 }, { x: x1, z: a.z - 4.2 }, { x: x1, z: a.z + 4.2 }], base, 1.4);
        fr.dist = Math.max(fr.dist, base.dist * 0.95);
      } else if (fight || (this.enc && this.enc.alerted && S.battleCam !== "fixed")) {
        let pts = this.heroes.map((h) => h.pos).concat(this.foes.filter((f) => !f.dying).map((f) => f.pos));
        if (ph === "victory" || ph === "wipe") pts = (ph === "victory" ? this.heroes : this.heroes.concat(this.foes)).map((h) => h.pos);
        fr = this.fit(pts, base, 1.6);
        fr.dist = Math.max(fr.dist, base.dist * (fight ? 0.88 : 0.95));
        if (ph === "victory") {
          fr.dist = Math.max(this.fit(this.heroes.map((h) => h.pos), base, 1.6).dist, base.dist * 0.8);
          fr.az += 18 * smooth(this.phaseT / 1.2);
        }
      } else {
        fr = this.fit(this.heroes.map((h) => h.pos), base, 2.0);
        fr.dist = Math.max(fr.dist, base.dist);
        fr.x += Math.cos(this.anchor.h) * 3.2;
        fr.z += Math.sin(this.anchor.h) * 3.2;
      }
      fr.shot = false;
      if (fight && S.battleCam === "director") {
        const s = this.director.strength(dt);
        const sh = this.director.shot;
        if (s > 0 && sh) {
          const f = sh.focus.call(sh);
          const minD = 3.3 / Math.tan((fr.fov * DEG) / 2);
          // portrait screens have no spare width to zoom into
          const zoom = lerp(sh.zoom, 1, clamp((1.3 - this.aspect) / 0.7, 0, 1) * 0.6);
          const d = Math.max(minD, fr.dist * zoom);
          fr.x = lerp(fr.x, f.x, s);
          fr.z = lerp(fr.z, f.z, s);
          fr.y = lerp(fr.y, f.y, s);
          fr.dist = lerp(fr.dist, d, s);
          fr.az += sh.azOff * s;
          fr.pitch += sh.pitchOff * s;
          fr.fov += sh.fovOff * s;
          fr.shot = true;
        }
      } else if (this.director.shot) this.director.clear();
      return fr;
    }

    updateCamera(dt, snap) {
      const fr = this.cameraTarget(snap ? 0 : dt);
      if (!this.cam || snap) this.cam = { x: fr.x, y: fr.y, z: fr.z, dist: fr.dist, az: fr.az, pitch: fr.pitch, fov: fr.fov };
      else {
        const c = this.cam;
        const kF = fr.shot ? 5.5 : 4.5;
        c.x = damp(c.x, fr.x, kF, dt);
        c.y = damp(c.y, fr.y, kF, dt);
        c.z = damp(c.z, fr.z, kF, dt);
        c.dist = damp(c.dist, fr.dist, fr.shot ? 3.6 : 3.0, dt);
        c.az = damp(c.az, fr.az, 2.6, dt);
        c.pitch = damp(c.pitch, fr.pitch, 2.8, dt);
        c.fov = damp(c.fov, fr.fov, 3.5, dt);
      }
      const c = this.cam;
      const p = c.pitch * DEG;
      const a = c.az * DEG;
      const cp = Math.cos(p);
      const amp = this.trauma * this.trauma * 0.55;
      const tt = this.t * 55;
      this.camera.position.set(
        c.x - cp * Math.cos(a) * c.dist + Math.sin(tt) * amp,
        c.y + Math.sin(p) * c.dist + Math.sin(tt * 1.3 + 2) * amp,
        c.z + cp * Math.sin(a) * c.dist + Math.cos(tt * 0.9) * amp
      );
      this.camera.lookAt(c.x, c.y, c.z);
      this.camera.fov = c.fov;
      const off = this.hud.panelPx() * 0.5;
      if (off > 0) this.camera.setViewOffset(this.width, this.height, 0, off, this.width, this.height);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      const fog = this.scene.fog;
      fog.near = c.dist + 10;
      fog.far = Math.min(c.dist + 75, 105);
    }

    /* ----- frame ----- */

    tick() {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(this.tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.step(dt);
      this.renderFrame(dt);
    }

    renderFrame(dt) {
      const x = this.cam.x;
      const z = this.cam.z;
      this.scenery.tick(dt);
      this.scenery.update(x, z);
      const b = biomeAt(this.anchor.x);
      const gc = this.scenery.groundMat.color;
      gc.setHex(b.a.ground).lerp(this.tmpColor(b.b.ground), b.f);
      const sky = this.scene.background;
      sky.setHex(b.a.sky).lerp(this.tmpColor(b.b.sky), b.f);
      this.scene.fog.color.copy(sky);
      const bn = (b.f > 0.5 ? b.b : b.a).name;
      if (bn !== this.biomeName) {
        this.biomeName = bn;
        this.hud.updateChip();
      }
      this.hud.update(dt);
      this.renderer.render(this.scene, this.camera);
    }
    tmpColor(hex) {
      if (!this._c) this._c = new THREE.Color();
      return this._c.setHex(hex);
    }

    /* ----- teardown ----- */

    onContextLost() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.listeners.forEach((l) => l[0].removeEventListener(l[1], l[2], l[3]));
      showFatal(this.root, "This device dropped 3D graphics mid-run — try closing other tabs/apps, or just head back.");
    }

    destroy() {
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.listeners.forEach((l) => l[0].removeEventListener(l[1], l[2], l[3]));
      this.hud.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      this.renderer.dispose();
    }
  }

  /* ---------- boot ---------- */

  function showFatal(root, message) {
    root.innerHTML =
      '<div class="cc-fatal"><div><h2>Can&rsquo;t start the adventure</h2><p>' +
      message +
      '</p><button class="cc-btn cc-pill" type="button" data-cc-fatal>Menu</button></div></div>';
    const btn = root.querySelector("[data-cc-fatal]");
    if (btn) btn.addEventListener("click", () => window.returnToMenu && window.returnToMenu());
  }

  function injectStyle() {
    if (document.getElementById("cc-style")) return;
    const s = document.createElement("style");
    s.id = "cc-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureThree() {
    if (THREE && mergeGeometries) return Promise.resolve();
    return import(THREE_URL)
      .then((mod) => {
        THREE = mod;
        return import(BGU_URL);
      })
      .then((mod) => {
        mergeGeometries = mod.mergeGeometries;
        if (!G.sphere) initShared();
        const props = PROP_DATA
          ? null
          : fetch(PROPS_URL)
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                PROP_DATA = d;
              })
              .catch(() => {});
        const photo = PHOTO || PHOTO_OFF ? null : loadPhoto();
        return Promise.all([props, photo]);
      });
  }

  function loadPhoto() {
    const names = ["ground-a", "ground-b", "ground-c", "road", "sand"];
    return Promise.all(
      names.map(
        (n) =>
          new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = TEX_BASE + n + ".jpg";
          })
      )
    )
      .then((im) => {
        PHOTO = { ground: im.slice(0, 3), road: im[3], sand: im[4] };
        buildPhotoTex();
      })
      .catch(() => {});
  }

  function launchChibiCrawl() {
    if (window.chibiCrawlGame) return window.chibiCrawlGame;
    injectStyle();
    const root = document.createElement("div");
    root.id = "cc-root";
    root.innerHTML = '<div class="cc-loading">Packing lunch&hellip;</div>';
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
    window.chibiCrawlGame = handle;

    ensureThree()
      .then(() => {
        if (handle.cancelled) return;
        root.innerHTML = HUD_HTML;
        handle.game = new Game(root, handle);
      })
      .catch((err) => {
        if (handle.cancelled) return;
        showFatal(root, "This device couldn't start 3D graphics for this game.");
        console.error("Chibi Crawl failed to start:", err);
      });
    return handle;
  }

  window.launchChibiCrawl = launchChibiCrawl;
})();
