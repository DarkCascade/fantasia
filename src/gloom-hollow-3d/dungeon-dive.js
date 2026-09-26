/*
 * Gloom Hollow 3D — Dungeon Dive.
 *
 * A second mode for Gloom Hollow 3D (src/gloom-hollow-3d.js), picked from that
 * game's own title screen. Instead of one arena and endless waves, every floor
 * is a freshly generated dungeon built from Kenney's Modular Dungeon Kit (CC0,
 * shipped in ./kit/). The exile has to find the descent portal somewhere on
 * the floor; monsters sleep in the rooms until they see you, and chests tucked
 * into rooms and dead-end side passages pay out bonus points for exploring off
 * the direct route. Stepping into the portal banks a floor bonus plus an
 * exploration bonus, offers a boon (the arena's own boon pool), and drops you
 * onto the next, harder floor. Death ends the run; score is the record.
 *
 * Structure: this file is an ES module, imported on demand by the arena's
 * launcher only when the mode is picked. The launcher hands over its THREE
 * instance and its Hollow3D class; DungeonDive *extends* Hollow3D, so combat,
 * bolts, the nova, telegraphs, boons, the HUD and every input scheme are the
 * arena's code, untouched. What this file replaces is the world (generator,
 * collision, line of sight, pathfinding, exploration) and the renderer.
 *
 * The renderer is deliberately the opposite of the arena's flat look:
 *   - ACES tone mapping into an HDR composer: GTAO ambient occlusion (desktop),
 *     Unreal bloom, then a custom grade pass (vignette, chromatic fringe, film
 *     grain, split-tone grade, hurt / low-life response, fade transitions).
 *   - The kit's flat palette texture is kept as albedo, and a runtime-generated
 *     1024px brick and flagstone set (height + normals + per-stone variation)
 *     is layered over every kit surface by triplanar projection in an
 *     onBeforeCompile hook, with wet puddles (near-mirror roughness, flattened
 *     normals, reflecting a PMREM environment) and damp wall bases.
 *   - Fog of war: an exploration texture masks everything you haven't found,
 *     revealed by walking distance so it never leaks through walls.
 *   - A wall cutaway: walls between the camera and the exile dissolve in a
 *     noisy, glowing-rimmed circle so you're never hidden behind a corridor.
 *   - Torches with a noise-driven fire shader, a pool of flickering point
 *     lights that follows you, the exile's own shadow-casting light, embers,
 *     drifting dust, loot beams over chests, a swirling portal, and particle
 *     bursts for every hit, kill, pickup and chest.
 * Phones get a lighter tier (see QUALITY) and the resolution adapts to frame
 * time on every device.
 */
import { GLTFLoader } from "../../vendor/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "../../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../../vendor/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "../../vendor/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "../../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../../vendor/jsm/postprocessing/OutputPass.js";
import { GTAOPass } from "../../vendor/jsm/postprocessing/GTAOPass.js";

let THREE = null; // handed over by the launcher; the same instance the arena uses
let API = null; // the arena's shared tuning + helpers (see createDungeonDive)
let KIT = null; // loaded kit geometry + palettes, shared by every floor of a run
let DETAIL = null; // generated detail textures (raw pixel data)
let QUALITY = null;

/* ---------- layout ---------- */

// The kit is modelled on a 4-unit grid with walls 4.2 units tall. Scaled by
// 0.6, one kit cell is 2.4 game tiles and a wall is ~2.5 tiles high — a
// corridor is wide enough for a fight but still reads as a corridor.
const KIT_SCALE = 0.6;
const CELL = 4 * KIT_SCALE;
const MAP_CELLS = 22; // the floor plan is MAP_CELLS x MAP_CELLS kit cells
const MAP_SIZE = MAP_CELLS * CELL;
const SUB = 10; // collision samples per cell edge
const SAMPLE = CELL / SUB; // 0.24 tiles per collision sample
const WALL_T = 2; // collision thickness of a wall, in samples
const CORNER_R = 0.8 * CELL; // walkable radius inside a rounded corner piece
const ROOM_MIN = 3;
const ROOM_MAX = 5;

const VOID = 0;
const ROOM = 1;
const HALL = 2;

// Wall rotation per side: the kit's wall piece sits on its local z=0 line and
// extends toward -z, so each rotation turns local -z to face into the cell.
const DIRS = [
  { dx: 0, dz: -1, rot: Math.PI }, // N
  { dx: 1, dz: 0, rot: Math.PI / 2 }, // E
  { dx: 0, dz: 1, rot: 0 }, // S
  { dx: -1, dz: 0, rot: -Math.PI / 2 }, // W
];

/* ---------- gameplay ---------- */

const LEASH = 13; // tiles: an awake monster this far from the exile gives up
const CHEST_OPEN_R = 1.05;
const PORTAL_R = 0.85;
const DESCEND_HEAL = 24;
const ELITE_HP = 2.6;
const ELITE_DMG = 1.6;
const REVEAL_DEPTH = 2;
// Light levels, in three's physical units (candela). Kept low: the scene is
// tone-mapped, and anything much brighter blows out and blooms into a haze.
const PLAYER_LIGHT = 11;
const TORCH_LIGHT = 9; // cells of walking distance revealed around the exile

// Points. Every award is multiplied by floorMult() so deeper floors pay more.
const PTS = {
  grunt: 20,
  brute: 45,
  elite: 160,
  chest: 150,
  rareChest: 400,
  floor: 400,
  explore: 900, // x the fraction of the floor explored when you descend
  purge: 300, // every monster on the floor slain
};

const ROOM_TYPES = [
  ["battle", 48],
  ["elite", 12],
  ["treasure", 18],
  ["empty", 22],
];

// Per-floor mood: which kit palette, fog tint and ambient. Cycles.
const MOODS = [
  { palette: 1, fog: 0x05060c, hemiSky: 0x33385e, hemiGround: 0x0c0a0a, torch: 0xff8a3a },
  { palette: 2, fog: 0x080508, hemiSky: 0x40283c, hemiGround: 0x0e0806, torch: 0xff7a30 },
  { palette: 0, fog: 0x07050c, hemiSky: 0x39305a, hemiGround: 0x120a08, torch: 0xffa24a },
];

const KIT_PIECES = [
  "template-floor",
  "template-floor-detail",
  "template-floor-detail-a",
  "template-wall",
  "template-wall-detail-a",
  "template-wall-corner",
  "template-corner",
  "template-detail",
  "gate",
  "gate-door",
  "gate-metal-bars",
];

/* ---------- small utilities ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise: a lattice of `period` random values per side, wrapped,
// smoothly interpolated. fbm sums octaves of it, still tileable.
function tileNoise(size, period, seed) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = hash2(x0 % period, y0 % period, seed);
      const b = hash2((x0 + 1) % period, y0 % period, seed);
      const c = hash2(x0 % period, (y0 + 1) % period, seed);
      const d = hash2((x0 + 1) % period, (y0 + 1) % period, seed);
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(size, basePeriod << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Height field -> RGBA pixels: RG = tangent-space normal xy, B = height,
// A = per-stone random (drives albedo variation in the shader).
function packDetail(size, height, rand, strength) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = height[y * size + ((x + size - 1) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y + size - 1) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      px[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      px[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, height[i])) * 255);
      px[i * 4 + 3] = Math.round(rand[i] * 255);
    }
  }
  return px;
}

// Running-bond brickwork: 8 courses per tile, bevelled edges, chipped faces.
function makeBricks(size) {
  const h = new Float32Array(size * size);
  const rnd = new Float32Array(size * size);
  const grain = fbm(size, 16, 4, 11);
  const chips = fbm(size, 32, 2, 23);
  const rows = 8;
  const bh = size / rows;
  const bw = bh * 2;
  const mortar = size / 340;
  const bevel = size / 90;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / bh);
    const off = (row % 2) * (bw / 2) + hash2(row, 0, 5) * bw * 0.25;
    const v = y - row * bh;
    for (let x = 0; x < size; x++) {
      const bx = (x + off) % size;
      const col = Math.floor(bx / bw);
      const u = bx - col * bw;
      const edge = Math.min(u, bw - u, v, bh - v);
      const id = hash2(row, col % Math.round(size / bw), 9);
      const i = y * size + x;
      let height = smoothstep(mortar, mortar + bevel, edge) * (0.78 + 0.22 * id);
      height += (grain[i] - 0.5) * 0.14;
      if (chips[i] > 0.68) height -= (chips[i] - 0.68) * 1.6 * smoothstep(mortar, mortar + bevel * 2, edge);
      h[i] = height;
      rnd[i] = id;
    }
  }
  return packDetail(size, h, rnd, size / 70);
}

// Irregular flagstones from a wrapped Voronoi: F2 - F1 is the distance to the
// nearest seam, so each cell becomes a bevelled stone with its own tone.
function makeFlagstones(size) {
  const h = new Float32Array(size * size);
  const rnd = new Float32Array(size * size);
  const grain = fbm(size, 12, 4, 31);
  const g = 5; // stones per tile side
  const pts = [];
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      pts.push([(i + 0.15 + hash2(i, j, 1) * 0.7) / g, (j + 0.15 + hash2(i, j, 2) * 0.7) / g, hash2(i, j, 3)]);
    }
  }
  const gap = 0.006;
  const bevel = 0.03;
  for (let y = 0; y < size; y++) {
    const fy = y / size;
    const cy = Math.floor(fy * g);
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const cx = Math.floor(fx * g);
      let f1 = 9;
      let f2 = 9;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ci = (cx + ox + g) % g;
          const cj = (cy + oy + g) % g;
          const p = pts[cj * g + ci];
          const px = p[0] + (cx + ox - ci) / g;
          const py = p[1] + (cy + oy - cj) / g;
          const d = Math.hypot(px - fx, py - fy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = p[2];
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const i = y * size + x;
      const seam = f2 - f1;
      h[i] = smoothstep(gap, gap + bevel, seam) * (0.8 + 0.2 * id) + (grain[i] - 0.5) * 0.16;
      rnd[i] = id;
    }
  }
  return packDetail(size, h, rnd, size / 60);
}

// General-purpose tileable noise: R/G = two fbm fields, B = fine grain.
function makeNoise(size) {
  const a = fbm(size, 4, 5, 101);
  const b = fbm(size, 6, 4, 202);
  const c = fbm(size, 32, 2, 303);
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = Math.round(a[i] * 255);
    px[i * 4 + 1] = Math.round(b[i] * 255);
    px[i * 4 + 2] = Math.round(c[i] * 255);
    px[i * 4 + 3] = 255;
  }
  return px;
}

/* ---------- floor generator ---------- */

// Pure function of the rng: rooms scattered on the cell grid, joined by a
// minimum spanning tree of L-shaped corridors (plus a few loops), with
// dead-end side passages hung off the corridors as chest alcoves. Returns
// cell data only; everything with a world position is derived from it.
function generateFloor(rng, floorNo) {
  const W = MAP_CELLS;
  const H = MAP_CELLS;
  const idx = (i, j) => j * W + i;
  const inside = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const kind = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);
  const isFloor = (i, j) => inside(i, j) && kind[idx(i, j)] !== VOID;

  const rooms = [];
  const want = ri(7, 10);
  for (let t = 0; t < 600 && rooms.length < want; t++) {
    const w = ri(ROOM_MIN, ROOM_MAX);
    const h = ri(ROOM_MIN, ROOM_MAX);
    const x = ri(1, W - w - 1);
    const y = ri(1, H - h - 1);
    // A one-cell gap between rooms, so their walls never share a cell.
    if (rooms.some((r) => x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y)) continue;
    const room = { id: rooms.length, x: x, y: y, w: w, h: h, cx: x + (w >> 1), cy: y + (h >> 1), type: "battle" };
    rooms.push(room);
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        kind[idx(i, j)] = ROOM;
        roomOf[idx(i, j)] = room.id;
      }
    }
  }

  // Prim's MST over room centres, Manhattan distance.
  const links = [];
  const inTree = [0];
  const linked = new Set();
  const key = (a, b) => (a < b ? a + "-" + b : b + "-" + a);
  const md = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  while (inTree.length < rooms.length) {
    let best = null;
    inTree.forEach((ai) => {
      rooms.forEach((b) => {
        if (inTree.indexOf(b.id) >= 0) return;
        const d = md(rooms[ai], b);
        if (!best || d < best.d) best = { a: ai, b: b.id, d: d };
      });
    });
    inTree.push(best.b);
    links.push([best.a, best.b]);
    linked.add(key(best.a, best.b));
  }
  // A few extra links make loops, so the map isn't a pure tree of dead ends.
  rooms.forEach((a) => {
    if (rng() > 0.25) return;
    let best = null;
    rooms.forEach((b) => {
      if (b.id === a.id || linked.has(key(a.id, b.id))) return;
      const d = md(a, b);
      if (!best || d < best.d) best = { b: b.id, d: d };
    });
    if (best && best.d < 16) {
      links.push([a.id, best.b]);
      linked.add(key(a.id, best.b));
    }
  });

  const doors = new Map();
  links.forEach((pair) => {
    const a = rooms[pair[0]];
    const b = rooms[pair[1]];
    let i = a.cx;
    let j = a.cy;
    const path = [[i, j]];
    const stepTo = (ti, tj) => {
      while (i !== ti || j !== tj) {
        if (i !== ti) i += Math.sign(ti - i);
        else j += Math.sign(tj - j);
        path.push([i, j]);
      }
    };
    if (rng() < 0.5) {
      stepTo(b.cx, j);
      stepTo(b.cx, b.cy);
    } else {
      stepTo(i, b.cy);
      stepTo(b.cx, b.cy);
    }
    path.forEach((p) => {
      if (kind[idx(p[0], p[1])] === VOID) kind[idx(p[0], p[1])] = HALL;
    });
    for (let k = 1; k < path.length; k++) {
      const c0 = idx(path[k - 1][0], path[k - 1][1]);
      const c1 = idx(path[k][0], path[k][1]);
      if ((kind[c0] === ROOM) !== (kind[c1] === ROOM)) {
        const room = kind[c0] === ROOM ? c0 : c1;
        const hall = room === c0 ? c1 : c0;
        doors.set(Math.min(c0, c1) + "|" + Math.max(c0, c1), { room: room, hall: hall });
      }
    }
  });

  // Dead-end spurs off the corridors: short, isolated, with a chest at the
  // end more often than not. They're what "exploration" pays out for.
  const spurs = [];
  const halls = [];
  for (let c = 0; c < W * H; c++) if (kind[c] === HALL) halls.push(c);
  const wantSpurs = ri(2, 4);
  for (let t = 0; t < 120 && spurs.length < wantSpurs && halls.length; t++) {
    const c = halls[Math.floor(rng() * halls.length)];
    const ci = c % W;
    const cj = Math.floor(c / W);
    const d = DIRS[ri(0, 3)];
    const len = ri(2, 3);
    let ok = true;
    for (let k = 1; k <= len + 1 && ok; k++) {
      const i = ci + d.dx * k;
      const j = cj + d.dz * k;
      if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1 || kind[idx(i, j)] !== VOID) ok = false;
      if (k <= len) {
        // Both flanks must be empty, or the spur would merge into something.
        if (isFloor(i + d.dz, j + d.dx) || isFloor(i - d.dz, j - d.dx)) ok = false;
      }
    }
    if (!ok) continue;
    for (let k = 1; k <= len; k++) kind[idx(ci + d.dx * k, cj + d.dz * k)] = HALL;
    spurs.push({ i: ci + d.dx * len, j: cj + d.dz * len, dir: DIRS.indexOf(d) });
  }

  // Walking distance (in cells) from the start room, to put the exit as far
  // away as the layout allows.
  const start = rooms[Math.floor(rng() * rooms.length)];
  const dist = new Int32Array(W * H).fill(-1);
  const q = [idx(start.cx, start.cy)];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const ci = c % W;
    const cj = Math.floor(c / W);
    DIRS.forEach((d) => {
      const ni = ci + d.dx;
      const nj = cj + d.dz;
      if (!isFloor(ni, nj)) return;
      const n = idx(ni, nj);
      if (dist[n] >= 0) return;
      dist[n] = dist[c] + 1;
      q.push(n);
    });
  }
  let exit = null;
  rooms.forEach((r) => {
    if (r === start) return;
    if (!exit || dist[idx(r.cx, r.cy)] > dist[idx(exit.cx, exit.cy)]) exit = r;
  });

  const totalWeight = ROOM_TYPES.reduce((a, t) => a + t[1], 0);
  rooms.forEach((r) => {
    if (r === start) r.type = "start";
    else if (r === exit) r.type = rng() < 0.35 ? "elite" : "battle";
    else {
      let roll = rng() * totalWeight;
      for (let k = 0; k < ROOM_TYPES.length; k++) {
        roll -= ROOM_TYPES[k][1];
        if (roll < 0) {
          r.type = ROOM_TYPES[k][0];
          break;
        }
      }
    }
  });

  return {
    W: W,
    H: H,
    kind: kind,
    roomOf: roomOf,
    rooms: rooms,
    doors: Array.from(doors.values()),
    spurs: spurs,
    start: start,
    exit: exit,
    floor: floorNo,
  };
}

/* ---------- kit loading ---------- */

async function loadKit(kitUrl) {
  const loader = new GLTFLoader();
  const pieces = {};
  let palette = null;
  await Promise.all(
    KIT_PIECES.map(async (name) => {
      const gltf = await loader.loadAsync(kitUrl + name + ".glb");
      gltf.scene.updateMatrixWorld(true);
      const parts = {};
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!palette && o.material && o.material.map) palette = o.material.map;
        const geo = o.geometry.clone();
        if (o.name === "door") {
          // The door leaf keeps its own origin (the hinge), so it can swing;
          // the node offset is remembered instead of baked in.
          parts.hinge = o.position.clone().multiplyScalar(KIT_SCALE);
        } else {
          geo.applyMatrix4(o.matrixWorld);
        }
        geo.scale(KIT_SCALE, KIT_SCALE, KIT_SCALE);
        geo.computeBoundingSphere();
        parts[o.name === "door" ? "leaf" : "main"] = geo;
      });
      pieces[name] = parts;
    })
  );
  const texLoader = new THREE.TextureLoader();
  const variants = await Promise.all(
    ["variation-a.png", "variation-b.png"].map((f) => texLoader.loadAsync(kitUrl + "Textures/" + f))
  );
  const palettes = [palette].concat(variants).map((t) => {
    // Match the glTF texture conventions so every palette lines up with the
    // kit's UVs, and skip mipmaps: the palette is a sheet of swatches, and
    // mip levels would bleed neighbouring swatches into each other.
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
  return { pieces: pieces, palettes: palettes };
}

/* ---------- shaders ---------- */

// One hook for every surface in the dungeon, feature-flagged per material:
//   DETAIL  triplanar brick/flagstone normals, albedo and roughness, puddles
//   CUT     the wall cutaway around the exile
//   MASK    the fog-of-war exploration mask
//   RIM     a cool fresnel rim so bodies read against the dark floor
function shadeHook(U, flags) {
  return function (shader) {
    const f = flags;
    Object.keys(U).forEach((k) => {
      shader.uniforms[k] = U[k];
    });
    const defs =
      (f.detail ? "#define D_DETAIL\n" : "") +
      (f.cut ? "#define D_CUT\n" : "") +
      (f.mask ? "#define D_MASK\n" : "") +
      (f.rim ? "#define D_RIM\n" : "");
    const world = f.detail || f.cut || f.mask;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", defs + "#include <common>\n" + (world ? "varying vec3 vDWorld;\nvarying vec3 vDWorldN;\n" : ""))
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n" +
          (world
            ? `{
  vec4 dw = vec4(transformed, 1.0);
  vec3 dn = objectNormal;
  #ifdef USE_INSTANCING
  dw = instanceMatrix * dw;
  dn = mat3(instanceMatrix) * dn;
  #endif
  dw = modelMatrix * dw;
  vDWorld = dw.xyz;
  vDWorldN = normalize(mat3(modelMatrix) * dn);
}`
            : "")
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        defs +
          "#include <common>\n" +
          (world ? "varying vec3 vDWorld;\nvarying vec3 vDWorldN;\n" : "") +
          `uniform sampler2D uBrickTex;
uniform sampler2D uFlagTex;
uniform sampler2D uNoiseTex;
uniform sampler2D uExploreTex;
uniform float uBrickScale;
uniform float uFlagScale;
uniform float uDetail;
uniform float uWet;
uniform float uMapSize;
uniform vec4 uCut;
uniform vec3 uCutColor;
uniform vec3 uRimColor;
`
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float dCutRim = 0.0;
#ifdef D_CUT
if (uCut.z > 0.0 && vDWorld.y > 0.14) {
  float dAhead = uCut.w - vViewPosition.z;
  if (dAhead > 0.35) {
    vec2 dq = (gl_FragCoord.xy - uCut.xy) / uCut.z;
    float dn = texture2D(uNoiseTex, gl_FragCoord.xy / 150.0).g;
    float de = length(dq) + (dn - 0.5) * 0.5 - (1.0 - smoothstep(0.35, 1.2, dAhead)) * -0.6;
    if (de < 1.0) discard;
    dCutRim = 1.0 - smoothstep(1.0, 1.06, de);
  }
}
#endif`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef D_DETAIL
vec3 dWN = normalize(vDWorldN);
vec3 dBl = pow(abs(dWN), vec3(4.0));
dBl /= (dBl.x + dBl.y + dBl.z);
vec4 dTX = texture2D(uBrickTex, vDWorld.zy * uBrickScale);
vec4 dTZ = texture2D(uBrickTex, vDWorld.xy * uBrickScale);
vec4 dTY = texture2D(uFlagTex, vDWorld.xz * uFlagScale);
float dH = dTX.b * dBl.x + dTZ.b * dBl.z + dTY.b * dBl.y;
float dRand = dTX.a * dBl.x + dTZ.a * dBl.z + dTY.a * dBl.y;
float dGround = dBl.y * step(0.0, dWN.y) * (1.0 - smoothstep(0.05, 0.3, vDWorld.y));
float dPud = dGround * smoothstep(0.6, 0.67, texture2D(uNoiseTex, vDWorld.xz * 0.043).r) * uWet;
float dDamp = (1.0 - dBl.y) * (1.0 - smoothstep(0.0, 0.75, vDWorld.y));
diffuseColor.rgb *= mix(0.6, 1.07, dH) * (0.88 + 0.24 * dRand);
diffuseColor.rgb *= mix(1.0, 0.68, dDamp);
diffuseColor.rgb *= mix(1.0, 0.42, dPud);
#endif`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
#ifdef D_DETAIL
roughnessFactor = mix(roughnessFactor, 0.98, (1.0 - dH) * 0.45);
roughnessFactor = mix(roughnessFactor, 0.38, dDamp * 0.7);
roughnessFactor = mix(roughnessFactor, 0.04, dPud);
#endif`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef D_DETAIL
{
  vec3 nX = vec3((dTX.rg * 2.0 - 1.0) * uDetail, 0.0);
  vec3 nY = vec3((dTY.rg * 2.0 - 1.0) * uDetail, 0.0);
  vec3 nZ = vec3((dTZ.rg * 2.0 - 1.0) * uDetail, 0.0);
  nX.z = sqrt(max(0.0, 1.0 - dot(nX.xy, nX.xy)));
  nY.z = sqrt(max(0.0, 1.0 - dot(nY.xy, nY.xy)));
  nZ.z = sqrt(max(0.0, 1.0 - dot(nZ.xy, nZ.xy)));
  vec3 tX = vec3(nX.xy + dWN.zy, abs(nX.z) * dWN.x);
  vec3 tY = vec3(nY.xy + dWN.xz, abs(nY.z) * dWN.y);
  vec3 tZ = vec3(nZ.xy + dWN.xy, abs(nZ.z) * dWN.z);
  vec3 dNW = normalize(tX.zyx * dBl.x + tY.xzy * dBl.y + tZ.xyz * dBl.z);
  dNW = normalize(mix(dNW, dWN, dPud));
  normal = normalize((viewMatrix * vec4(dNW, 0.0)).xyz);
}
#endif`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += uCutColor * dCutRim;
#ifdef D_RIM
{
  float dFr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uRimColor * pow(dFr, 3.0);
}
#endif`
      )
      .replace(
        "#include <fog_fragment>",
        `#ifdef D_MASK
{
  float dM = texture2D(uExploreTex, vDWorld.xz / uMapSize).r;
  gl_FragColor.rgb *= dM * dM * (3.0 - 2.0 * dM);
}
#endif
#include <fog_fragment>`
      );
  };
}

function hooked(U, material, flags) {
  material.onBeforeCompile = shadeHook(U, flags);
  const k = "gh3dive-" + (flags.detail ? "d" : "") + (flags.cut ? "c" : "") + (flags.mask ? "m" : "") + (flags.rim ? "r" : "");
  material.customProgramCacheKey = () => k;
  return material;
}

const BILLBOARD_VERT = `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  mat4 inst = mat4(1.0);
  #ifdef USE_INSTANCING
  inst = instanceMatrix;
  #endif
  vec4 center = modelMatrix * inst * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(inst[0].xyz);
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 p = center.xyz + camRight * position.x * s + vec3(0.0, 1.0, 0.0) * position.y * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FIRE_FRAG = `
uniform sampler2D uNoiseTex;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  float t = uTime + vSeed * 13.0;
  float n1 = texture2D(uNoiseTex, vec2(vUv.x * 0.55 + vSeed, vUv.y * 0.45 - t * 0.85)).r;
  float n2 = texture2D(uNoiseTex, vec2(vUv.x * 1.2 - vSeed, vUv.y * 1.0 - t * 1.6)).g;
  float n = n1 * 0.6 + n2 * 0.4;
  float h = vUv.y;
  float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * h;
  float width = mix(0.85, 0.04, pow(h, 0.75));
  float body = 1.0 - smoothstep(width * 0.3, width, abs(x));
  body *= smoothstep(0.0, 0.14, h) * (1.0 - smoothstep(0.3, 0.95, h + (n - 0.5) * 0.7));
  float core = pow(body, 2.6);
  vec3 col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.58, 0.16), body);
  col = mix(col, vec3(1.0, 0.94, 0.72), core);
  gl_FragColor = vec4(col * body * 4.0, body);
}`;

const BEAM_VERT = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float up = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.06, vUv.y);
  float stripes = 0.6 + 0.4 * sin(vUv.y * 24.0 - uTime * 4.5 + vUv.x * 12.566);
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
  gl_FragColor = vec4(uColor * up * stripes * core * uOpacity, 1.0);
}`;

const PORTAL_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PORTAL_FRAG = `
uniform float uTime;
uniform sampler2D uNoiseTex;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float n = texture2D(uNoiseTex, vec2(a * 0.159 + uTime * 0.05, r * 0.6 - uTime * 0.35)).r;
  float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 13.0 - uTime * 3.2 + n * 4.0);
  float ring = smoothstep(1.0, 0.9, r) * smoothstep(0.72, 0.95, r);
  float core = 1.0 - smoothstep(0.0, 0.95, r);
  vec3 violet = vec3(0.62, 0.22, 1.0);
  vec3 cyan = vec3(0.25, 0.85, 1.0);
  vec3 col = mix(violet, cyan, swirl * core);
  float glow = core * (0.45 + swirl * 1.3) + ring * 2.6;
  // The eye of the vortex is a black hole, so the swirl has depth.
  glow *= mix(0.15, 1.0, smoothstep(0.05, 0.35, r));
  gl_FragColor = vec4(col * glow * 2.2, 1.0);
}`;

// Low mist over the floor: two layers of scrolling noise, brighter around
// the exile, masked by exploration so it never lights up undiscovered rooms.
const MIST_VERT = `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const MIST_FRAG = `
uniform sampler2D uNoiseTex;
uniform sampler2D uExploreTex;
uniform float uMapSize;
uniform float uTime;
uniform vec3 uColor;
uniform vec2 uPlayer;
varying vec3 vW;
void main() {
  float n1 = texture2D(uNoiseTex, vW.xz * 0.032 + vec2(uTime * 0.011, uTime * 0.006)).r;
  float n2 = texture2D(uNoiseTex, vW.xz * 0.071 - vec2(uTime * 0.019, -uTime * 0.009)).g;
  float m = smoothstep(0.38, 0.8, n1 * 0.62 + n2 * 0.38);
  vec4 exf = texture2D(uExploreTex, vW.xz / uMapSize);
  float ex = exf.r * exf.g; // discovered, and actually floor (G), not void
  vec2 d = vW.xz - uPlayer;
  float lit = 0.35 + 1.6 * exp(-dot(d, d) / 18.0);
  gl_FragColor = vec4(uColor * lit, m * 0.3 * ex);
}`;

// Soft spherical halos around the flames — cheap stand-in for light
// scattering in smoky air.
const HALO_VERT = `
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vFlick;
void main() {
  vUv = uv;
  mat4 inst = mat4(1.0);
  #ifdef USE_INSTANCING
  inst = instanceMatrix;
  #endif
  vec4 center = modelMatrix * inst * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(inst[0].xyz);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vFlick = 0.82 + 0.12 * sin(uTime * 9.1 + aSeed) + 0.06 * sin(uTime * 23.7 + aSeed * 3.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(center.xyz + (r * position.x + u * position.y) * s, 1.0);
}`;

const HALO_FRAG = `
uniform vec3 uColor;
varying vec2 vUv;
varying float vFlick;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
  gl_FragColor = vec4(uColor * a * vFlick, 1.0);
}`;

// A shaft of pale light falling through a crack in the ceiling.
const SHAFT_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform sampler2D uNoiseTex;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
  float n = texture2D(uNoiseTex, vec2(vUv.x * 2.0, vUv.y * 0.8 - uTime * 0.03)).r;
  float a = core * (0.45 + 0.55 * n) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

const POOL_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uNoiseTex;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float n = texture2D(uNoiseTex, vUv * 0.7 + uTime * 0.01).g;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * (0.7 + 0.3 * n);
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

const PARTICLE_VERT = `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0 || vColor.a <= 0.0) discard;
  float a = exp(-d * 3.2) * (1.0 - d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

const SMOKE_FRAG = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0 || vColor.a <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.15, 1.0, d)));
}`;

// Last pass, after tone mapping: the "lens". Chromatic fringe toward the
// edges, split-tone grade (indigo shadows, warm highlights), vignette, film
// grain, a red edge pulse when hurt, desaturation at low life, and the fade
// used for descending.
// Straight after the scene render: clamp fireflies and zero any NaN/Inf a
// shader (or the AO pass) produced, before bloom can smear one bad pixel
// into a glowing square.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (c.r != c.r || c.g != c.g || c.b != c.b || c.r > 65000.0 || c.g > 65000.0 || c.b > 65000.0) c = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(min(c.rgb, vec3(10.0)), 1.0);
}`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: null },
    uHurt: { value: 0 },
    uLowLife: { value: 0 },
    uFade: { value: 0 },
    uCA: { value: 0.012 },
    uGrain: { value: 0.035 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uRes;
uniform float uHurt;
uniform float uLowLife;
uniform float uFade;
uniform float uCA;
uniform float uGrain;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * r2 * uCA * 4.0;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv + off).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - off).b;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.9, 0.96, 1.16) + vec3(0.01, 0.004, 0.026), 1.0 - smoothstep(0.0, 0.45, l));
  col = mix(col, col * vec3(1.07, 1.0, 0.9), smoothstep(0.45, 1.0, l));
  col = mix(col, vec3(l) * vec3(1.05, 0.95, 0.95), uLowLife * 0.6);
  vec2 ac = c * vec2(uRes.x / uRes.y, 1.0);
  float v = 1.0 - smoothstep(0.35, 1.05, length(ac) * 1.15);
  col *= mix(0.55, 1.0, v);
  float edge = smoothstep(0.25, 0.75, length(c) * 1.4);
  col += vec3(0.55, 0.02, 0.04) * edge * clamp(uHurt + uLowLife * (0.35 + 0.35 * sin(uTime * 5.0)), 0.0, 1.2);
  float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`,
};

/* ---------- particles ---------- */

// A fixed pool of point sprites updated on the CPU. Allocation is a ring:
// when the pool is full the oldest particle is recycled, which is invisible
// in practice and means an emitter can never fail.
class Particles {
  constructor(cap, additive) {
    this.cap = cap;
    this.next = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.base = new Float32Array(cap * 4); // r, g, b, alpha at birth
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("aColor", this.aCol);
    geo.setAttribute("aSize", this.aSize);
    this.uScale = { value: 400 };
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: this.uScale },
      vertexShader: PARTICLE_VERT,
      fragmentShader: additive ? GLOW_FRAG : SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 30 : 29;
    this.live = 0;
  }

  // o: { x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav, drag }
  emit(o) {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0;
    this.vel[i * 3 + 1] = o.vy || 0;
    this.vel[i * 3 + 2] = o.vz || 0;
    this.life[i] = this.max[i] = o.life;
    this.s0[i] = o.s0;
    this.s1[i] = o.s1 === undefined ? o.s0 : o.s1;
    this.base[i * 4] = o.r;
    this.base[i * 4 + 1] = o.g;
    this.base[i * 4 + 2] = o.b;
    this.base[i * 4 + 3] = o.a === undefined ? 1 : o.a;
    this.grav[i] = o.grav || 0;
    this.drag[i] = o.drag || 0;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.col[i * 4 + 3] = 0;
        }
        continue;
      }
      live++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const k = 1 - Math.min(1, this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = Math.min(1, t / 0.12) * (1 - smoothstep(0.55, 1, t));
      this.col[i * 4] = this.base[i * 4];
      this.col[i * 4 + 1] = this.base[i * 4 + 1];
      this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * fade;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
    }
    this.live = live;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------- HUD ---------- */

const DIVE_CSS = `
#gh3-root canvas.gh3-minimap{position:absolute;top:12px;right:12px;width:156px;height:156px;box-sizing:border-box;
  border-radius:12px;border:2px solid rgba(255,224,138,.32);background:rgba(6,5,14,.62);
  box-shadow:0 6px 16px rgba(0,0,0,.55);pointer-events:none;}
#gh3-root.gh3-dive .gh3-stats{top:178px;}
.gh3-score{display:block;margin-top:3px;font-size:20px;color:#ffe7a3;letter-spacing:.03em;
  text-shadow:0 0 10px rgba(255,190,90,.45),0 2px 4px #000;transform-origin:100% 50%;}
.gh3-score.is-bumped{animation:gh3-bump .35s ease-out;}
.gh3-fatal{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:20px;text-align:center;background:rgba(5,4,10,.92);pointer-events:auto;color:#e6ecff;}
@media (max-width:520px){
  #gh3-root canvas.gh3-minimap{width:104px;height:104px;}
  #gh3-root.gh3-dive .gh3-stats{top:124px;}
  #gh3-root.gh3-dive .gh3-title{left:64px;right:124px;text-align:left;}
  #gh3-root.gh3-dive .gh3-hint{top:52px;padding:0 124px 0 14px;text-align:left;}
}
`;

const DIVE_HUD = `<canvas class="gh3-minimap" data-gh3="minimap" width="312" height="312"></canvas>`;

function injectDiveStyle() {
  if (document.getElementById("gh3-dive-style")) return;
  const s = document.createElement("style");
  s.id = "gh3-dive-style";
  s.textContent = DIVE_CSS;
  document.head.appendChild(s);
}

/* ---------- the mode ---------- */

function defineDive(Base, bestKey) {
  const { BODY_R, MONSTERS, waveComposition, waveStatScale, randInt, dist, clamp } = API;

  return class DungeonDive extends Base {
    /* ---------- renderer ---------- */

    setupRenderer() {
      const Q = QUALITY;
      this.quality = Q;
      const renderer = new THREE.WebGLRenderer({
        antialias: false, // the composer's own multisampled target does this
        powerPreference: Q.low ? "default" : "high-performance",
        stencil: false,
      });
      // A null context is the one WebGL failure we can catch synchronously —
      // throw so the launcher shows a message instead of a blank canvas.
      if (!renderer.getContext()) throw new Error("WebGL is unavailable on this device");
      this.renderer = renderer;
      this.pixelRatio = Q.pr;
      renderer.setPixelRatio(this.pixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = Q.shadows;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.canvas = renderer.domElement;
      this.root.insertBefore(this.canvas, this.root.firstChild);
      this.listen(this.canvas, "webglcontextlost", (e) => {
        e.preventDefault();
        this.fatal("The graphics context was lost. Head back to the menu and try again.");
      });

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x030208);
      this.scene.fog = new THREE.FogExp2(0x07050c, 0.021);
      this.world = new THREE.Group();
      this.scene.add(this.world);

      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
      this.camHome = new THREE.Vector3();
      this.camRight = new THREE.Vector3(1, 0, -1).normalize();
      this.camFwd = new THREE.Vector3(-1, 0, -1).normalize();
      this.camFocus = new THREE.Vector3();
      this.camOffset = new THREE.Vector3();
      this.camDist = 16;
      this.lookAhead = new THREE.Vector3();

      this.raycaster = new THREE.Raycaster();
      this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this.tmpV = new THREE.Vector3();
      this.tmpV2 = new THREE.Vector3();
      this.tmpV3 = new THREE.Vector3();
      this.chase = { gx: 0, gz: 0 };

      this.buildLights();
      this.buildShared();
      this.buildComposer();

      this.resize();
      const onResize = () => this.resize();
      this.listen(window, "resize", onResize);
      this.listen(window, "orientationchange", onResize);
    }

    buildLights() {
      const Q = this.quality;
      this.hemi = new THREE.HemisphereLight(0x39305a, 0x120a08, 0.7);
      this.scene.add(this.hemi);
      // A faint cold key from the camera side keeps silhouettes readable in
      // rooms with no torch nearby.
      const fill = new THREE.DirectionalLight(0x6d7fc0, 0.32);
      fill.position.set(12, 20, 16);
      this.scene.add(fill);

      // The exile's own light: cool, bright, and — on capable hardware — the
      // one shadow caster, so every pillar and monster throws a long shadow
      // away from you.
      this.playerLight = new THREE.PointLight(0xa8c8ff, PLAYER_LIGHT, 12, 1.5);
      this.playerLight.castShadow = Q.shadows;
      if (Q.shadows) {
        this.playerLight.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
        this.playerLight.shadow.camera.near = 0.15;
        this.playerLight.shadow.camera.far = 14;
        this.playerLight.shadow.bias = -0.004;
        this.playerLight.shadow.radius = 3;
      }
      this.scene.add(this.playerLight);

      // A fixed pool of torch lights, handed to whichever discovered torches
      // are nearest. The count never changes, so no shader ever recompiles.
      this.torchLights = [];
      for (let i = 0; i < Q.torchLights; i++) {
        const l = new THREE.PointLight(0xff8a3a, 0, 9, 1.7);
        l.userData = { torch: null, level: 0 };
        this.scene.add(l);
        this.torchLights.push(l);
      }
      this.portalLight = new THREE.PointLight(0x9a5cff, 0, 10, 1.5);
      this.scene.add(this.portalLight);
      // Reused for one-off flashes: chests bursting open, the nova.
      this.flashLight = new THREE.PointLight(0xffd27a, 0, 9, 1.5);
      this.scene.add(this.flashLight);
    }

    buildShared() {
      const Q = this.quality;
      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const dataTex = (px, size, repeat) => {
        const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = aniso;
        t.needsUpdate = true;
        return t;
      };
      this.brickTex = dataTex(DETAIL.brick, DETAIL.size, true);
      this.flagTex = dataTex(DETAIL.flag, DETAIL.size, true);
      this.noiseTex = dataTex(DETAIL.noise, DETAIL.noiseSize, true);

      this.exploreData = new Uint8Array(MAP_CELLS * MAP_CELLS * 4);
      this.exploreTex = new THREE.DataTexture(this.exploreData, MAP_CELLS, MAP_CELLS, THREE.RGBAFormat);
      this.exploreTex.magFilter = THREE.LinearFilter;
      this.exploreTex.minFilter = THREE.LinearFilter;
      this.exploreTex.needsUpdate = true;

      // Every custom shader reads its uniforms from this one object, so a
      // single write per frame updates all of them.
      this.U = {
        uBrickTex: { value: this.brickTex },
        uFlagTex: { value: this.flagTex },
        uNoiseTex: { value: this.noiseTex },
        uExploreTex: { value: this.exploreTex },
        uBrickScale: { value: 1 / 2.3 },
        uFlagScale: { value: 1 / 3.4 },
        uDetail: { value: 0.85 },
        uWet: { value: 1 },
        uMapSize: { value: MAP_SIZE },
        uCut: { value: new THREE.Vector4(0, 0, 0, 0) },
        uCutColor: { value: new THREE.Color(0.14, 0.3, 0.75) },
        uRimColor: { value: new THREE.Color(0.16, 0.2, 0.42) },
        uTime: { value: 0 },
      };

      this.kitMat = hooked(
        this.U,
        new THREE.MeshStandardMaterial({ map: KIT.palettes[0], roughness: 0.78, metalness: 0.0, envMapIntensity: 0.6 }),
        { detail: true, cut: true, mask: true }
      );
      // Doors swing, so they can't be instanced — but they share the look.
      this.propMat = (color, rough, metal, extra) =>
        hooked(
          this.U,
          new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: rough, metalness: metal }, extra || {})),
          { mask: true }
        );

      this.fireMat = new THREE.ShaderMaterial({
        uniforms: { uNoiseTex: this.U.uNoiseTex, uTime: this.U.uTime },
        vertexShader: BILLBOARD_VERT,
        fragmentShader: FIRE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const beamMat = (color, opacity) =>
        new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTime: this.U.uTime,
            uOpacity: { value: opacity },
          },
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
      this.beamMats = { common: beamMat(0xffb43a, 1.6), rare: beamMat(0xc86bff, 2.0), portal: beamMat(0x8a5cff, 1.4) };
      this.beamGeo = new THREE.CylinderGeometry(0.34, 0.5, 6, 24, 1, true);
      this.beamGeo.translate(0, 3, 0);
      this.portalMat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.U.uTime, uNoiseTex: this.U.uNoiseTex },
        vertexShader: PORTAL_VERT,
        fragmentShader: PORTAL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.runeTex = this.makeRuneTexture();
      this.U.uPlayer = { value: new THREE.Vector2() };
      this.mistMat = new THREE.ShaderMaterial({
        uniforms: {
          uNoiseTex: this.U.uNoiseTex,
          uExploreTex: this.U.uExploreTex,
          uMapSize: this.U.uMapSize,
          uTime: this.U.uTime,
          uPlayer: this.U.uPlayer,
          uColor: { value: new THREE.Color(0.1, 0.12, 0.2) },
        },
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
      });
      this.mist = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), this.mistMat);
      this.mist.rotation.x = -Math.PI / 2;
      this.mist.position.set(MAP_SIZE / 2, 0.22, MAP_SIZE / 2);
      this.mist.renderOrder = 20;
      this.scene.add(this.mist);
      this.haloMat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.U.uTime, uColor: { value: new THREE.Color(0.55, 0.22, 0.06) } },
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.shaftMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0.55, 0.7, 1.0) },
          uTime: this.U.uTime,
          uNoiseTex: this.U.uNoiseTex,
          uOpacity: { value: 0.55 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.poolMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0.5, 0.65, 1.0) },
          uTime: this.U.uTime,
          uNoiseTex: this.U.uNoiseTex,
          uOpacity: { value: 0.35 },
        },
        vertexShader: PORTAL_VERT,
        fragmentShader: POOL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.shaftGeo = new THREE.CylinderGeometry(0.75, 1.25, 9, 28, 1, true);
      this.shaftGeo.translate(0, 4.5, 0);
      this.poolGeo = new THREE.CircleGeometry(1.5, 40);
      this.poolGeo.rotateX(-Math.PI / 2);

      // Environment for reflections: a dark room with a few warm and cold
      // panels, so wet floor and metal pick up believable highlights.
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x050409, side: THREE.BackSide })));
      [
        [0xff7a2a, 1.6, [8, 3, 0]],
        [0xff9a40, 1.1, [-6, 2, 7]],
        [0x6f9fff, 1.0, [0, 9, -8]],
        [0x9a5cff, 0.7, [-9, 4, -3]],
      ].forEach((p) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(p[0]).multiplyScalar(p[1]), side: THREE.DoubleSide })
        );
        m.position.set(p[2][0], p[2][1], p[2][2]);
        m.lookAt(0, 0, 0);
        env.add(m);
      });
      this.envTex = pm.fromScene(env, 0.02).texture;
      env.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      pm.dispose();
      this.scene.environment = this.envTex;

      // Resources that outlive a floor; clearFloor disposes everything else.
      this.shared = new Set([
        this.kitMat,
        this.fireMat,
        this.portalMat,
        this.beamGeo,
        this.haloMat,
        this.shaftMat,
        this.poolMat,
        this.shaftGeo,
        this.poolGeo,
      ]);
      Object.keys(this.beamMats).forEach((k) => this.shared.add(this.beamMats[k]));
      Object.keys(KIT.pieces).forEach((k) => {
        if (KIT.pieces[k].main) this.shared.add(KIT.pieces[k].main);
        if (KIT.pieces[k].leaf) this.shared.add(KIT.pieces[k].leaf);
      });

      this.glow = new Particles(Q.particles, true);
      this.smoke = new Particles(Math.round(Q.particles / 3), false);
      this.scene.add(this.glow.points, this.smoke.points);
    }

    makeRuneTexture() {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const g = c.getContext("2d");
      g.translate(256, 256);
      g.strokeStyle = "#fff";
      g.lineCap = "round";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, 0, 238, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, 176, 0, Math.PI * 2);
      g.stroke();
      const rng = mulberry32(7);
      const glyphs = 22;
      g.lineWidth = 6;
      for (let k = 0; k < glyphs; k++) {
        g.save();
        g.rotate((k / glyphs) * Math.PI * 2);
        g.translate(0, -207);
        g.beginPath();
        for (let s = 0; s < 3; s++) {
          const x0 = (rng() - 0.5) * 22;
          const y0 = (rng() - 0.5) * 24;
          g.moveTo(x0, y0);
          g.lineTo(x0 + (rng() - 0.5) * 26, y0 + (rng() - 0.5) * 26);
        }
        g.stroke();
        g.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    buildComposer() {
      const Q = this.quality;
      const r = this.renderer;
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: Q.msaa && r.capabilities.isWebGL2 ? Q.msaa : 0,
      });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = null;
      if (Q.gtao) {
        try {
          this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
          this.gtao.output = GTAOPass.OUTPUT.Default;
          this.gtao.blendIntensity = 0.9;
          this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
          this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
          this.composer.addPass(this.gtao);
        } catch (err) {
          this.gtao = null; // AO is a garnish; never let it stop the game
        }
      }
      this.composer.addPass(new ShaderPass(SanitizeShader));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      this.grade.uniforms.uRes.value = new THREE.Vector2(1, 1);
      this.composer.addPass(this.grade);
    }

    resize() {
      const w = Math.max(1, this.root.clientWidth);
      const h = Math.max(1, this.root.clientHeight);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(w, h, false);
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
      const aspect = w / h;
      // Portrait screens get a wider lens and a steeper look-down, the same
      // idea as the arena's aspect-adaptive pitch.
      const t = clamp((1.3 - aspect) / (1.3 - 0.5), 0, 1);
      const fov = 40 + 12 * t;
      this.camera.fov = fov;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      const tan = Math.tan((fov * Math.PI) / 360);
      const needW = 18 - 8 * t;
      const needH = 12.5;
      this.camDist = Math.max(needH / (2 * tan), needW / (2 * tan * aspect));
      const pitch = ((52 + 12 * t) * Math.PI) / 180;
      this.camOffset.set(Math.cos(pitch) * Math.SQRT1_2, Math.sin(pitch), Math.cos(pitch) * Math.SQRT1_2);
      const bw = Math.round(w * this.pixelRatio);
      const bh = Math.round(h * this.pixelRatio);
      this.bufW = bw;
      this.bufH = bh;
      this.grade.uniforms.uRes.value.set(bw, bh);
      const scale = bh / (2 * tan);
      this.glow.uScale.value = scale;
      this.smoke.uScale.value = scale;
      this.placeCamera(true, 0);
    }

    placeCamera(snap, dt) {
      const p = this.player;
      if (!p) return;
      this.tmpV3.set(p.gx + this.lookAhead.x, 0.55, p.gz + this.lookAhead.z);
      if (snap) this.camFocus.copy(this.tmpV3);
      else this.camFocus.lerp(this.tmpV3, 1 - Math.exp(-dt * 5.5));
      this.camera.position.copy(this.camFocus).addScaledVector(this.camOffset, this.camDist);
      this.camera.lookAt(this.camFocus);
      this.camera.updateMatrixWorld();
      this.camHome.copy(this.camera.position);
    }

    fatal(msg) {
      this.over = true;
      const d = document.createElement("div");
      d.className = "gh3-fatal";
      d.innerHTML = "<div>" + msg + '</div><button class="gh3-btn gh3-btn--menu" type="button">&#8801; Menu</button>';
      d.querySelector("button").addEventListener("click", () => this.toMenu());
      this.root.appendChild(d);
    }

    /* ---------- materials for bodies ---------- */

    // The arena's bodies are Lambert; down here they're PBR with a fresnel
    // rim, and anything that glows glows hard enough to bloom.
    lambert(color, opts) {
      const o = Object.assign({ color: color, roughness: 0.6, metalness: 0.06 }, opts || {});
      const m = new THREE.MeshStandardMaterial(o);
      if (opts && opts.emissive) m.emissiveIntensity = 3.2;
      return hooked(this.U, m, { rim: true });
    }

    makeExile() {
      const g = super.makeExile();
      // Swap the arena's little glow for the dungeon's player light (which
      // lives in the scene, not the model, so the light count never changes),
      // and don't let the exile shadow itself from its own lamp.
      g.children.slice().forEach((c) => {
        if (c.isLight) g.remove(c);
      });
      g.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      return g;
    }

    makeCoin() {
      const g = super.makeCoin();
      g.traverse((o) => {
        if (o.isMesh) {
          o.material.metalness = 0.9;
          o.material.roughness = 0.28;
        }
      });
      return g;
    }

    /* ---------- run ---------- */

    startRun() {
      this.over = false;
      this.now = performance.now();
      this.wave = 0;
      this.kills = 0;
      this.gold = 0;
      this.score = 0;
      this.floor = 0;
      this.chestsOpened = 0;
      this.chestsFound = 0;
      this.exploreSum = 0;
      this.monsters = [];
      this.flasks = [];
      this.coins = [];
      this.bolts = [];
      this.fx = [];
      this.timers = [];
      this.novaReadyAt = 0;
      this.transitioning = false;
      this.hurt = 0;
      this.lastHp = 0;
      const seed = QUALITY.seed;
      this.rng = seed ? mulberry32(seed) : Math.random;

      this.boltGeo = new THREE.ConeGeometry(0.09, 0.46, 8);
      this.boltGeo.rotateX(Math.PI / 2);
      this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe6ff).multiplyScalar(5) });
      this.burstGeo = new THREE.SphereGeometry(1, 12, 10);
      this.burstMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdff4ff).multiplyScalar(3), transparent: true });

      this.buildPlayer();
      this.lastHp = this.player.hp;
      this.startBest = this.loadBest();
      this.el.death.classList.remove("is-open");
      this.closeUpgrades();
      const title = this.root.querySelector(".gh3-title");
      if (title) title.innerHTML = "DUNGEON <span>DIVE</span>";
      this.el.hint.innerHTML =
        "Find the glowing portal down &bull; chests are bonus points<br>WASD / stick / tap to move &bull; auto-fire &bull; NOVA orb or Space";
      this.el.hint.style.opacity = "1";
      this.buildFloor(1);
      this.refreshHud();
    }

    // Floors after the first reuse the player (and the run's boons) and only
    // rebuild the world around it.
    buildFloor(n) {
      this.clearFloor();
      this.floor = n;
      this.purged = false;
      const gen = generateFloor(this.rng, n);
      this.gen = gen;
      this.mood = MOODS[(n - 1) % MOODS.length];
      this.kitMat.map = KIT.palettes[this.mood.palette];
      this.scene.fog.color.setHex(this.mood.fog);
      this.hemi.color.setHex(this.mood.hemiSky);
      this.hemi.groundColor.setHex(this.mood.hemiGround);
      this.torchLights.forEach((l) => l.color.setHex(this.mood.torch));

      this.level = new THREE.Group();
      this.world.add(this.level);
      this.chests = [];
      this.torches = [];
      this.doors = [];
      this.props = [];
      this.portal = null;

      this.planDecor(gen);
      this.buildCollision(gen);
      this.buildGeometry(gen);
      this.buildTorches();
      this.buildChests();
      this.buildPortal();
      this.buildShafts(gen);
      this.resetExplore();
      this.spawnDenizens(gen);

      const p = this.player;
      const spot = this.roomSpot(gen.start, 0, []);
      p.gx = spot.gx;
      p.gz = spot.gz;
      p.moveTo = null;
      p.target = null;
      p.path = null;
      p.facing = Math.PI * 1.25;
      this.place(p);
      this.flowSrc = -1;
      this.lastCell = -1;
      this.updateExplore(true);
      this.lookAhead.set(0, 0, 0);
      this.placeCamera(true, 0);
      this.banner("FLOOR " + n, 1800);
      this.drawMinimap();
    }

    // Tear down everything a floor built. Kit geometry and the shared
    // materials (this.shared) survive for the next floor; everything else
    // the floor made is disposed.
    clearFloor() {
      (this.monsters || []).forEach((m) => {
        this.drop(m.model);
        this.drop(m.bar);
        this.drop(m.tell.group);
      });
      this.monsters = [];
      (this.flasks || []).forEach((f) => this.drop(f.model));
      this.flasks = [];
      (this.coins || []).forEach((c) => this.drop(c.model));
      this.coins = [];
      if (this.bolts) this.clearBolts();
      if (this.level) {
        this.world.remove(this.level);
        const junk = new Set();
        this.level.traverse((o) => {
          if (o.isInstancedMesh) o.dispose();
          if (o.geometry) junk.add(o.geometry);
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => junk.add(m));
        });
        junk.forEach((r) => {
          if (!this.shared.has(r)) r.dispose();
        });
        this.level = null;
      }
      this.torchLights.forEach((l) => {
        l.intensity = 0;
        l.userData.torch = null;
        l.userData.level = 0;
      });
      this.portalLight.intensity = 0;
      this.flashLight.intensity = 0;
      if (this.glow) this.glow.clear();
      if (this.smoke) this.smoke.clear();
    }

    /* ---------- layout decisions ---------- */

    // Seeded helpers, so ?gh3seed= reproduces a floor exactly.
    rint(lo, hi) {
      return lo + Math.floor(this.rng() * (hi - lo + 1));
    }

    shuffleR(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    // Everything placed on the grid that isn't the kit shell itself: chests,
    // pillars, barred alcoves, props, torches. Decided before collision so
    // collision can include it.
    planDecor(gen) {
      const W = gen.W;
      const rng = this.rng;
      const isFloor = (i, j) => i >= 0 && j >= 0 && i < W && j < gen.H && gen.kind[j * W + i] !== VOID;
      const doorCells = new Set();
      gen.doors.forEach((d) => {
        doorCells.add(d.room);
        doorCells.add(d.hall);
      });

      // Rounded corner pieces: a floor cell with exactly two perpendicular
      // open sides toward the void.
      this.cornerCells = new Map();
      for (let j = 0; j < gen.H; j++) {
        for (let i = 0; i < W; i++) {
          if (!isFloor(i, j)) continue;
          const v = DIRS.map((d) => !isFloor(i + d.dx, j + d.dz));
          const count = v.filter(Boolean).length;
          if (count !== 2 || (v[0] && v[2]) || (v[1] && v[3])) continue;
          const rot = v[2] && v[1] ? 0 : v[0] && v[1] ? Math.PI / 2 : v[2] && v[3] ? -Math.PI / 2 : Math.PI;
          // The walkable corner of the cell: opposite the two walled sides.
          const cx = (v[1] ? i : i + 1) * CELL;
          const cz = (v[2] ? j : j + 1) * CELL;
          this.cornerCells.set(j * W + i, { rot: rot, cx: cx, cz: cz });
        }
      }

      // Wall edges a chest, alcove or torch can sit against.
      const wallEdges = (room) => {
        const out = [];
        for (let j = room.y; j < room.y + room.h; j++) {
          for (let i = room.x; i < room.x + room.w; i++) {
            const c = j * W + i;
            if (this.cornerCells.has(c) || doorCells.has(c)) continue;
            DIRS.forEach((d, di) => {
              if (!isFloor(i + d.dx, j + d.dz)) out.push({ i: i, j: j, dir: di });
            });
          }
        }
        return out;
      };

      this.pillars = [];
      this.bars = new Set();
      this.chestPlan = [];
      this.propPlan = [];
      const used = new Set();
      const edgeKey = (e) => e.j * W + e.i + ":" + e.dir;

      gen.rooms.forEach((room) => {
        // Pillars only in the big rooms, where they make cover worth using.
        if (room.w === 5 && room.h >= 3) {
          const rows = room.h === 5 ? [1, 3] : [1];
          rows.forEach((oy) => {
            [1, 3].forEach((ox) => this.pillars.push({ i: room.x + ox, j: room.y + oy + (room.h === 3 ? 0 : 0) }));
          });
        } else if (room.h === 5 && room.w >= 3) {
          [1, 3].forEach((oy) => this.pillars.push({ i: room.x + 1, j: room.y + oy }));
        }
        const edges = this.shuffleR(wallEdges(room));
        const take = (pred) => {
          for (let k = 0; k < edges.length; k++) {
            const e = edges[k];
            if (used.has(edgeKey(e)) || used.has("c" + (e.j * W + e.i))) continue;
            if (pred && !pred(e)) continue;
            used.add(edgeKey(e));
            return e;
          }
          return null;
        };
        const notPillar = (e) => !this.pillars.some((p) => p.i === e.i && p.j === e.j);

        if (room.type === "treasure" || (room.type === "battle" && rng() < 0.25)) {
          const e = take(notPillar);
          if (e) {
            used.add("c" + (e.j * W + e.i));
            this.chestPlan.push({ i: e.i, j: e.j, dir: e.dir, rare: rng() < (room.type === "treasure" ? 0.45 : 0.15) });
          }
        }
        if (room.type !== "start" && rng() < 0.4) {
          const e = take(notPillar);
          if (e) this.bars.add(edgeKey(e));
        }
        const props = this.rint(1, 3);
        for (let k = 0; k < props; k++) {
          const e = take(notPillar);
          if (!e) break;
          this.propPlan.push({ i: e.i, j: e.j, dir: e.dir, kind: rng() < 0.55 ? "barrel" : "crate", n: this.rint(1, 3) });
        }
      });

      gen.spurs.forEach((s) => {
        if (rng() > 0.75) return;
        this.chestPlan.push({ i: s.i, j: s.j, dir: s.dir, rare: rng() < 0.35, spur: true });
      });
      // Every floor has at least two chests worth finding.
      const spare = gen.rooms.filter((r) => r.type !== "start");
      for (let t = 0; t < 20 && this.chestPlan.length < 2 && spare.length; t++) {
        const room = spare[Math.floor(rng() * spare.length)];
        const edges = this.shuffleR(wallEdges(room)).filter(
          (e) => !used.has("c" + (e.j * W + e.i)) && !this.pillars.some((p) => p.i === e.i && p.j === e.j)
        );
        if (!edges.length) continue;
        const e = edges[0];
        used.add("c" + (e.j * W + e.i));
        used.add(edgeKey(e));
        this.chestPlan.push({ i: e.i, j: e.j, dir: e.dir, rare: rng() < 0.2 });
      }
      this.usedEdges = used;
      this.edgeKey = edgeKey;
    }

    /* ---------- collision ---------- */

    buildCollision(gen) {
      const W = gen.W;
      const GW = W * SUB;
      const GH = gen.H * SUB;
      this.gw = GW;
      this.gh = GH;
      const solid = new Uint8Array(GW * GH).fill(1);
      const set = (sx, sz, v) => {
        if (sx >= 0 && sz >= 0 && sx < GW && sz < GH) solid[sz * GW + sx] = v;
      };
      const isFloor = (i, j) => i >= 0 && j >= 0 && i < W && j < gen.H && gen.kind[j * W + i] !== VOID;
      const blockBox = (x0, z0, x1, z1) => {
        for (let sz = Math.floor(z0 / SAMPLE); sz <= Math.floor(z1 / SAMPLE); sz++) {
          for (let sx = Math.floor(x0 / SAMPLE); sx <= Math.floor(x1 / SAMPLE); sx++) set(sx, sz, 1);
        }
      };

      for (let j = 0; j < gen.H; j++) {
        for (let i = 0; i < W; i++) {
          if (!isFloor(i, j)) continue;
          for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) set(i * SUB + a, j * SUB + b, 0);
        }
      }
      for (let j = 0; j < gen.H; j++) {
        for (let i = 0; i < W; i++) {
          if (!isFloor(i, j)) continue;
          const corner = this.cornerCells.get(j * W + i);
          if (corner) {
            for (let b = 0; b < SUB; b++) {
              for (let a = 0; a < SUB; a++) {
                const x = (i * SUB + a + 0.5) * SAMPLE;
                const z = (j * SUB + b + 0.5) * SAMPLE;
                if (Math.hypot(x - corner.cx, z - corner.cz) > CORNER_R) set(i * SUB + a, j * SUB + b, 1);
              }
            }
            continue;
          }
          DIRS.forEach((d) => {
            if (isFloor(i + d.dx, j + d.dz)) return;
            for (let k = 0; k < SUB; k++) {
              for (let t = 0; t < WALL_T; t++) {
                if (d.dz === -1) set(i * SUB + k, j * SUB + t, 1);
                if (d.dz === 1) set(i * SUB + k, j * SUB + SUB - 1 - t, 1);
                if (d.dx === -1) set(i * SUB + t, j * SUB + k, 1);
                if (d.dx === 1) set(i * SUB + SUB - 1 - t, j * SUB + k, 1);
              }
            }
          });
        }
      }
      // Corner posts where three floor cells meet one void cell.
      this.posts = [];
      for (let vj = 1; vj < gen.H; vj++) {
        for (let vi = 1; vi < W; vi++) {
          const q = [isFloor(vi - 1, vj - 1), isFloor(vi, vj - 1), isFloor(vi - 1, vj), isFloor(vi, vj)];
          const n = q.filter(Boolean).length;
          const x = vi * CELL;
          const z = vj * CELL;
          if (n === 3) {
            const voidQ = q.indexOf(false); // 0 NW, 1 NE, 2 SW, 3 SE
            const rot = [Math.PI, Math.PI / 2, -Math.PI / 2, 0][voidQ];
            const gx = [1, -1, 1, -1][voidQ];
            const gz = [1, 1, -1, -1][voidQ];
            this.posts.push({ x: x, z: z, rot: rot });
            blockBox(Math.min(x, x + gx * 0.42), Math.min(z, z + gz * 0.42), Math.max(x, x + gx * 0.42) - 0.01, Math.max(z, z + gz * 0.42) - 0.01);
          }
        }
      }
      // Gate pillars stand on the two ends of every doorway.
      gen.doors.forEach((d) => {
        const e = this.doorEdge(d);
        const ends = e.horizontal
          ? [[e.x - CELL / 2, e.z], [e.x + CELL / 2, e.z]]
          : [[e.x, e.z - CELL / 2], [e.x, e.z + CELL / 2]];
        ends.forEach((p) => blockBox(p[0] - 0.5, p[1] - 0.5, p[0] + 0.5, p[1] + 0.5));
      });
      this.pillars.forEach((p) => {
        const x = (p.i + 0.5) * CELL;
        const z = (p.j + 0.5) * CELL;
        blockBox(x - 0.55, z - 0.55, x + 0.55, z + 0.55);
      });
      this.solid = solid;
      this.sight = solid; // doors add to this once they exist (see updateDoors)

      // Precomputed standability at every sample centre, for pathfinding.
      const stand = new Uint8Array(GW * GH);
      for (let sz = 0; sz < GH; sz++) {
        for (let sx = 0; sx < GW; sx++) {
          if (solid[sz * GW + sx]) continue;
          stand[sz * GW + sx] = this.canStand((sx + 0.5) * SAMPLE, (sz + 0.5) * SAMPLE, BODY_R) ? 1 : 0;
        }
      }
      this.stand = stand;
      this.flow = new Int16Array(GW * GH);
      this.flowQueue = new Int32Array(GW * GH);
    }

    // Block a footprint added after the fact (chests, props), keeping the
    // standability map in sync.
    blockFootprint(x, z, half) {
      const GW = this.gw;
      const s0x = Math.floor((x - half) / SAMPLE);
      const s1x = Math.floor((x + half) / SAMPLE);
      const s0z = Math.floor((z - half) / SAMPLE);
      const s1z = Math.floor((z + half) / SAMPLE);
      for (let sz = s0z; sz <= s1z; sz++) for (let sx = s0x; sx <= s1x; sx++) this.solid[sz * GW + sx] = 1;
      const pad = Math.ceil(BODY_R / SAMPLE) + 1;
      for (let sz = s0z - pad; sz <= s1z + pad; sz++) {
        for (let sx = s0x - pad; sx <= s1x + pad; sx++) {
          if (sx < 0 || sz < 0 || sx >= GW || sz >= this.gh) continue;
          const i = sz * GW + sx;
          this.stand[i] = !this.solid[i] && this.canStand((sx + 0.5) * SAMPLE, (sz + 0.5) * SAMPLE, BODY_R) ? 1 : 0;
        }
      }
    }

    doorEdge(d) {
      const W = this.gen.W;
      const ai = d.room % W;
      const aj = Math.floor(d.room / W);
      const bi = d.hall % W;
      const bj = Math.floor(d.hall / W);
      if (aj === bj) {
        return { x: Math.max(ai, bi) * CELL, z: (aj + 0.5) * CELL, horizontal: false };
      }
      return { x: (ai + 0.5) * CELL, z: Math.max(aj, bj) * CELL, horizontal: true };
    }

    isBlocked(gx, gz) {
      const sx = Math.floor(gx / SAMPLE);
      const sz = Math.floor(gz / SAMPLE);
      if (sx < 0 || sz < 0 || sx >= this.gw || sz >= this.gh) return true;
      return this.solid[sz * this.gw + sx] === 1;
    }

    sampleIdx(gx, gz) {
      const sx = clamp(Math.floor(gx / SAMPLE), 0, this.gw - 1);
      const sz = clamp(Math.floor(gz / SAMPLE), 0, this.gh - 1);
      return sz * this.gw + sx;
    }

    cellAt(gx, gz) {
      const i = clamp(Math.floor(gx / CELL), 0, MAP_CELLS - 1);
      const j = clamp(Math.floor(gz / CELL), 0, MAP_CELLS - 1);
      return j * MAP_CELLS + i;
    }

    // Line of sight across the collision map (plus closed doors).
    hasLOS(ax, az, bx, bz) {
      const dx = bx - ax;
      const dz = bz - az;
      const steps = Math.ceil(Math.hypot(dx, dz) / (SAMPLE * 0.5));
      for (let k = 1; k < steps; k++) {
        const sx = Math.floor((ax + (dx * k) / steps) / SAMPLE);
        const sz = Math.floor((az + (dz * k) / steps) / SAMPLE);
        if (sx < 0 || sz < 0 || sx >= this.gw || sz >= this.gh) return false;
        const i = sz * this.gw + sx;
        if (this.solid[i] || (this.doorBlock && this.doorBlock[i])) return false;
      }
      return true;
    }

    // Can a body of radius r walk the straight line from a to b?
    walkClear(ax, az, bx, bz, r) {
      const dx = bx - ax;
      const dz = bz - az;
      const steps = Math.ceil(Math.hypot(dx, dz) / (SAMPLE * 0.5));
      for (let k = 1; k <= steps; k++) {
        if (!this.canStand(ax + (dx * k) / steps, az + (dz * k) / steps, r)) return false;
      }
      return true;
    }

    nearestStand(idx, radius, pred) {
      const GW = this.gw;
      const sx = idx % GW;
      const sz = Math.floor(idx / GW);
      let best = -1;
      let bestD = 1e9;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = sx + dx;
          const z = sz + dz;
          if (x < 0 || z < 0 || x >= GW || z >= this.gh) continue;
          const i = z * GW + x;
          if (!this.stand[i] || (pred && !pred(i))) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      return best;
    }

    // A* over the standability map, 8-connected, then string-pulled into a
    // handful of straight legs. `pred` limits which samples may be used
    // (the exile only routes through ground they've already discovered).
    findPath(ax, az, bx, bz, pred) {
      const GW = this.gw;
      const N = GW * this.gh;
      let s = this.sampleIdx(ax, az);
      let t = this.sampleIdx(bx, bz);
      if (!this.stand[s]) s = this.nearestStand(s, 3);
      if (!this.stand[t] || (pred && !pred(t))) t = this.nearestStand(t, 4, pred);
      if (s < 0 || t < 0) return null;
      const tx = (t % GW) + 0.5;
      const tz = Math.floor(t / GW) + 0.5;
      if (!this.aG) {
        this.aG = new Float32Array(N);
        this.aCame = new Int32Array(N);
        this.aSeen = new Uint32Array(N);
        this.aHeap = new Int32Array(N * 2);
        this.aF = new Float32Array(N);
        this.aStamp = 0;
      }
      const stamp = ++this.aStamp;
      const g = this.aG;
      const came = this.aCame;
      const seen = this.aSeen;
      const f = this.aF;
      const heap = this.aHeap;
      let hn = 0;
      const push = (i) => {
        let k = hn++;
        heap[k] = i;
        while (k > 0) {
          const p = (k - 1) >> 1;
          if (f[heap[p]] <= f[heap[k]]) break;
          const tmp = heap[p];
          heap[p] = heap[k];
          heap[k] = tmp;
          k = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        heap[0] = heap[--hn];
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < hn && f[heap[l]] < f[heap[m]]) m = l;
          if (r < hn && f[heap[r]] < f[heap[m]]) m = r;
          if (m === k) break;
          const tmp = heap[m];
          heap[m] = heap[k];
          heap[k] = tmp;
          k = m;
        }
        return top;
      };
      const h = (i) => {
        const dx = Math.abs((i % GW) + 0.5 - tx);
        const dz = Math.abs(Math.floor(i / GW) + 0.5 - tz);
        return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
      };
      g[s] = 0;
      seen[s] = stamp;
      came[s] = -1;
      f[s] = h(s);
      push(s);
      let found = false;
      let expanded = 0;
      while (hn > 0 && expanded < 30000) {
        const c = pop();
        expanded++;
        if (c === t) {
          found = true;
          break;
        }
        const cx = c % GW;
        const cz = Math.floor(c / GW);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= this.gh) continue;
            const n = nz * GW + nx;
            if (!this.stand[n] || (pred && !pred(n))) continue;
            if (dx && dz && (!this.stand[cz * GW + nx] || !this.stand[nz * GW + cx])) continue;
            const ng = g[c] + (dx && dz ? Math.SQRT2 : 1);
            if (seen[n] === stamp && ng >= g[n]) continue;
            seen[n] = stamp;
            g[n] = ng;
            came[n] = c;
            f[n] = ng + h(n);
            push(n);
          }
        }
      }
      if (!found) return null;
      const cells = [];
      for (let c = t; c !== -1; c = came[c]) cells.push(c);
      cells.reverse();
      const pts = cells.map((c) => ({ gx: ((c % GW) + 0.5) * SAMPLE, gz: (Math.floor(c / GW) + 0.5) * SAMPLE }));
      // The exact click point replaces the last sample centre when it's legal.
      if (this.canStand(bx, bz, BODY_R) && (!pred || pred(this.sampleIdx(bx, bz)))) pts[pts.length - 1] = { gx: bx, gz: bz };
      const out = [];
      let from = { gx: ax, gz: az };
      let k = 0;
      while (k < pts.length - 1) {
        let far = k + 1;
        for (let m = pts.length - 1; m > k + 1; m--) {
          if (this.walkClear(from.gx, from.gz, pts[m].gx, pts[m].gz, BODY_R * 0.92)) {
            far = m;
            break;
          }
        }
        out.push(pts[far]);
        from = pts[far];
        k = far;
      }
      if (!out.length) out.push(pts[pts.length - 1]);
      return out;
    }

    // Distance field from the exile over the standability map: a hunting
    // monster with no line of sight just walks downhill on it, which gets it
    // round corners and through doorways without per-monster pathfinding.
    ensureFlow() {
      const p = this.player;
      const src = this.sampleIdx(p.gx, p.gz);
      if (src === this.flowSrc && this.now - this.flowAt < 600) return;
      if (this.now - this.flowAt < 140) return;
      this.flowSrc = src;
      this.flowAt = this.now;
      const GW = this.gw;
      const flow = this.flow;
      const q = this.flowQueue;
      flow.fill(-1);
      let s = src;
      if (!this.stand[s]) s = this.nearestStand(s, 3);
      if (s < 0) return;
      let head = 0;
      let tail = 0;
      flow[s] = 0;
      q[tail++] = s;
      while (head < tail) {
        const c = q[head++];
        const d = flow[c];
        if (d > 140) continue;
        const cx = c % GW;
        const cz = Math.floor(c / GW);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= this.gh) continue;
            const n = nz * GW + nx;
            if (flow[n] >= 0 || !this.stand[n]) continue;
            if (dx && dz && (!this.stand[cz * GW + nx] || !this.stand[nz * GW + cx])) continue;
            flow[n] = d + 1;
            q[tail++] = n;
          }
        }
      }
    }

    /* ---------- hooks into the arena's update loop ---------- */

    monsterEngaged(m, d) {
      const p = this.player;
      if (!m.awake) {
        if (d > m.def.aggro || !m.seen || !this.hasLOS(m.gx, m.gz, p.gx, p.gz)) return false;
        this.wake(m);
      }
      if (d > LEASH) {
        m.awake = false;
        return false;
      }
      return true;
    }

    chasePoint(m) {
      const p = this.player;
      if (this.walkClear(m.gx, m.gz, p.gx, p.gz, BODY_R * 0.85)) return p;
      this.ensureFlow();
      const GW = this.gw;
      let c = this.sampleIdx(m.gx, m.gz);
      if (this.flow[c] < 0) {
        const n = this.nearestStand(c, 2, (i) => this.flow[i] >= 0);
        if (n < 0) return p;
        c = n;
      }
      // Look a few samples down the gradient, so the step aims along the
      // corridor rather than at the next sample over.
      for (let k = 0; k < 5; k++) {
        const cx = c % GW;
        const cz = Math.floor(c / GW);
        let best = c;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= this.gh) continue;
            const n = nz * GW + nx;
            if (this.flow[n] >= 0 && this.flow[n] < this.flow[best]) best = n;
          }
        }
        if (best === c) break;
        c = best;
      }
      this.chase.gx = ((c % GW) + 0.5) * SAMPLE;
      this.chase.gz = (Math.floor(c / GW) + 0.5) * SAMPLE;
      return this.chase;
    }

    canShoot(m) {
      return m.seen && this.hasLOS(this.player.gx, this.player.gz, m.gx, m.gz);
    }

    // A monster that sees you raises its whole room.
    wake(m) {
      const rouse = (x) => {
        if (x.awake || !x.alive) return;
        x.awake = true;
        if (x.seen) this.popNumber(x.gx, x.barY + 0.25, x.gz, "!", "#ff5a3c");
      };
      rouse(m);
      if (m.room >= 0) this.monsters.forEach((o) => o.room === m.room && rouse(o));
    }

    hurtMonster(m, dmg, color) {
      super.hurtMonster(m, dmg, color);
      if (m.alive && !m.awake) this.wake(m);
    }

    // Knockback without the arena's fixed-grid clamp.
    knockback(entity, attacker) {
      const dx = entity.gx - attacker.gx;
      const dz = entity.gz - attacker.gz;
      const len = Math.hypot(dx, dz) || 1;
      const nx = entity.gx + (dx / len) * 0.4;
      const nz = entity.gz + (dz / len) * 0.4;
      if (this.canStand(nx, nz, BODY_R)) {
        entity.gx = nx;
        entity.gz = nz;
      }
    }

    // Walk orders route around walls. Only ground you've discovered is fair
    // game — a tap into the dark can't be used to feel out the layout.
    setMoveTarget(e) {
      const g = this.pointerToGround(e);
      if (!g) return false;
      const p = this.player;
      if (this.holdMove && p.path && this.now - (this.pathAt || 0) < 110) {
        // Holding and dragging: keep walking, re-plan at a sane rate.
        return true;
      }
      const known = (i) => {
        const sx = i % this.gw;
        const sz = Math.floor(i / this.gw);
        return this.exploreTarget[Math.floor(sz / SUB) * MAP_CELLS + Math.floor(sx / SUB)] > 0;
      };
      const path = this.findPath(p.gx, p.gz, g.gx, g.gz, known);
      if (!path || !path.length) return false;
      this.pathAt = this.now;
      p.target = null;
      p.path = path;
      p.moveTo = p.path.shift();
      return true;
    }

    /* ---------- update ---------- */

    update(dt) {
      if (this.choosing || this.transitioning) return;
      const p = this.player;
      const steering = (this.joy.active && Math.hypot(this.joy.dx, this.joy.dy) > 0.25) || this.keysHeading();
      if (steering || p.target) p.path = null;
      const bx = p.gx;
      const bz = p.gz;
      super.update(dt);
      if (this.over) return;
      if (!p.moveTo && !p.target && p.path && p.path.length) p.moveTo = p.path.shift();

      // Camera leads a little in the direction of travel.
      const vx = (p.gx - bx) / Math.max(dt, 0.001);
      const vz = (p.gz - bz) / Math.max(dt, 0.001);
      this.lookAhead.x += (clamp(vx * 0.35, -1.6, 1.6) - this.lookAhead.x) * Math.min(1, dt * 2.5);
      this.lookAhead.z += (clamp(vz * 0.35, -1.6, 1.6) - this.lookAhead.z) * Math.min(1, dt * 2.5);
      this.moved = Math.hypot(p.gx - bx, p.gz - bz);

      this.updateExplore(false);
      this.updateChests();
      this.updatePortal();
      this.updateDoors();
      this.monsters.forEach((m) => {
        if (!m.alive) return;
        const was = m.seen;
        m.seen = this.exploreVal[this.cellAt(m.gx, m.gz)] > 0.45;
        if (was !== m.seen) {
          m.model.visible = m.seen;
          this.drawBar(m);
        }
      });
    }

    drawBar(m) {
      super.drawBar(m);
      m.bar.visible = m.alive && !!m.seen;
    }

    tick(ts) {
      this.raf = requestAnimationFrame(this.tick);
      // Clamped at both ends: the first rAF timestamp can predate the
      // constructor's performance.now(), and a negative step would run every
      // decay in the game backwards.
      const delta = clamp(ts - this.lastFrame, 0, 50);
      this.lastFrame = ts;
      this.now = ts;
      const dt = delta / 1000;
      if (!this.over) this.update(dt);
      this.placeCamera(false, dt);
      this.runFx();
      this.animate(dt);
      this.composer.render(dt);
      this.trackPerf(delta);
    }

    // Adaptive resolution: frame time decides the pixel ratio (and whether
    // the AO pass is worth its cost), within the tier's ceiling.
    trackPerf(ms) {
      if (QUALITY.fixed) return;
      this.perfAcc = (this.perfAcc || 0) + ms;
      this.perfN = (this.perfN || 0) + 1;
      if (this.perfN < 90) return;
      const avg = this.perfAcc / this.perfN;
      this.perfAcc = 0;
      this.perfN = 0;
      if (avg > 24) {
        if (this.gtao && this.gtao.enabled) {
          this.gtao.enabled = false;
        } else if (this.pixelRatio > 0.6) {
          this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.15);
          this.resize();
        }
      } else if (avg < 13 && this.pixelRatio < QUALITY.pr - 0.01) {
        this.pixelRatio = Math.min(QUALITY.pr, this.pixelRatio + 0.1);
        this.resize();
      }
    }

    // Everything purely visual, run every frame even under the menus.
    animate(dt) {
      const t = this.now / 1000;
      this.U.uTime.value = t;
      this.grade.uniforms.uTime.value = t;
      const p = this.player;

      // Player light rides on the staff's focus.
      const f = p.facing;
      // Held well clear of the body: an inverse-square light a few
      // centimetres from the staff's orb lights it to thousands of times
      // white, which is how a pixel ends up blooming into a square.
      this.playerLight.position.set(p.gx + Math.sin(f) * 0.35, 2.3, p.gz + Math.cos(f) * 0.35);
      this.playerLight.intensity = PLAYER_LIGHT * (0.94 + 0.06 * Math.sin(t * 3.1));

      // The wall cutaway follows the exile's torso on screen.
      this.tmpV.set(p.gx, 0.75, p.gz).project(this.camera);
      this.tmpV2.set(p.gx, 0.75, p.gz).applyMatrix4(this.camera.matrixWorldInverse);
      this.U.uCut.value.set(
        (this.tmpV.x * 0.5 + 0.5) * this.bufW,
        (this.tmpV.y * 0.5 + 0.5) * this.bufH,
        this.bufH * 0.15,
        -this.tmpV2.z
      );

      this.U.uPlayer.value.set(p.gx, p.gz);
      this.updateTorchLights(dt, t);
      if (this.shafts) {
        this.shafts.forEach((sh) => {
          if (!sh.seen || Math.random() > dt * 7) return;
          if (Math.abs(sh.gx - p.gx) > 14 || Math.abs(sh.gz - p.gz) > 14) return;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.9;
          this.glow.emit({
            x: sh.gx + Math.cos(a) * r,
            y: 0.3 + Math.random() * 3.2,
            z: sh.gz + Math.sin(a) * r,
            vx: (Math.random() - 0.5) * 0.08,
            vy: -0.05 - Math.random() * 0.08,
            vz: (Math.random() - 0.5) * 0.08,
            life: 4 + Math.random() * 2,
            s0: 0.045,
            s1: 0.045,
            r: 1.4,
            g: 1.7,
            b: 2.4,
            a: 0.7,
          });
        });
      }
      this.updateAmbientParticles(dt, t);
      this.bolts.forEach((b) => {
        for (let k = 0; k < 2; k++) {
          this.glow.emit({
            x: b.gx + (Math.random() - 0.5) * 0.08,
            y: 0.78 + (Math.random() - 0.5) * 0.08,
            z: b.gz + (Math.random() - 0.5) * 0.08,
            life: 0.32,
            s0: 0.22,
            s1: 0.04,
            r: 1.2,
            g: 2.4,
            b: 4,
            a: 0.9,
          });
        }
      });
      if (this.chests) {
        this.chests.forEach((c) => {
          if (c.opened || !c.seen || Math.random() > dt * 6) return;
          const col = c.rare ? [2.6, 1.2, 4] : [4, 2.6, 0.8];
          this.glow.emit({
            x: c.gx + (Math.random() - 0.5) * 0.7,
            y: 0.2 + Math.random() * 0.3,
            z: c.gz + (Math.random() - 0.5) * 0.7,
            vy: 0.6 + Math.random() * 0.6,
            life: 1.4,
            s0: 0.12,
            s1: 0.02,
            r: col[0],
            g: col[1],
            b: col[2],
            a: 0.8,
          });
        });
      }
      if (this.portal && this.portal.seen) this.animatePortal(dt, t);
      this.glow.update(dt);
      this.smoke.update(dt);

      // Screen response: a red edge pulse on damage, desaturation near death.
      if (p.hp < this.lastHp) this.hurt = 1;
      this.lastHp = p.hp;
      this.hurt = Math.max(0, this.hurt - dt * 2.2);
      this.grade.uniforms.uHurt.value = this.hurt * 0.8;
      this.grade.uniforms.uLowLife.value = this.over ? 0.5 : clamp(1 - p.hp / p.maxHp / 0.3, 0, 1);

      if (this.minimapAt === undefined || this.now - this.minimapAt > 120) {
        this.minimapAt = this.now;
        this.drawMinimap();
      }
    }

    /* ---------- world building ---------- */

    buildGeometry(gen) {
      const W = gen.W;
      const isFloor = (i, j) => i >= 0 && j >= 0 && i < W && j < gen.H && gen.kind[j * W + i] !== VOID;
      const rng = this.rng;
      const lists = {};
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      const put = (name, x, z, rot, y) => {
        q.setFromAxisAngle(up, rot);
        m4.compose(new THREE.Vector3(x, y || 0, z), q, one);
        (lists[name] = lists[name] || []).push(m4.clone());
      };

      for (let j = 0; j < gen.H; j++) {
        for (let i = 0; i < W; i++) {
          if (!isFloor(i, j)) continue;
          const cx = (i + 0.5) * CELL;
          const cz = (j + 0.5) * CELL;
          const corner = this.cornerCells.get(j * W + i);
          if (corner) {
            put("template-corner", cx, cz, corner.rot);
            continue;
          }
          const r = rng();
          const floorPiece = r < 0.16 ? "template-floor-detail" : r < 0.3 ? "template-floor-detail-a" : "template-floor";
          put(floorPiece, cx, cz, Math.floor(rng() * 4) * (Math.PI / 2));
          DIRS.forEach((d, di) => {
            if (isFloor(i + d.dx, j + d.dz)) return;
            const x = cx + d.dx * (CELL / 2);
            const z = cz + d.dz * (CELL / 2);
            const key = j * W + i + ":" + di;
            if (this.bars.has(key)) {
              // A barred alcove: a portcullis into a black cell. Placed a
              // hair inside so the bars sit in front of the void.
              put("gate-metal-bars", x - d.dx * 0.18, z - d.dz * 0.18, d.dx ? Math.PI / 2 : 0);
              return;
            }
            put(rng() < 0.22 ? "template-wall-detail-a" : "template-wall", x, z, d.rot);
          });
        }
      }
      this.posts.forEach((p) => put("template-wall-corner", p.x, p.z, p.rot));
      this.pillars.forEach((p) => put("template-detail", (p.i + 0.5) * CELL, (p.j + 0.5) * CELL, 0));

      // Doorways: open arches, or a real door that swings open as you near.
      this.doorBlock = new Uint8Array(this.gw * this.gh);
      gen.doors.forEach((d) => {
        const e = this.doorEdge(d);
        const rot = e.horizontal ? 0 : Math.PI / 2;
        if (rng() < 0.35) {
          const frame = new THREE.Mesh(KIT.pieces["gate-door"].main, this.kitMat);
          frame.position.set(e.x, 0, e.z);
          frame.rotation.y = rot;
          frame.castShadow = frame.receiveShadow = true;
          const leaf = new THREE.Mesh(KIT.pieces["gate-door"].leaf, this.kitMat);
          const hinge = KIT.pieces["gate-door"].hinge;
          leaf.position.copy(hinge);
          leaf.castShadow = true;
          frame.add(leaf);
          this.level.add(frame);
          const door = { frame: frame, leaf: leaf, x: e.x, z: e.z, open: 0, want: 0, cells: [], dir: 1 };
          // Closed doors block sight (not movement: they open for anyone
          // who walks up to them).
          for (let k = -4; k <= 4; k++) {
            const px = e.horizontal ? e.x + k * SAMPLE : e.x;
            const pz = e.horizontal ? e.z : e.z + k * SAMPLE;
            door.cells.push(this.sampleIdx(px, pz));
          }
          door.cells.forEach((c) => {
            this.doorBlock[c] = 1;
          });
          this.doors.push(door);
        } else {
          put("gate", e.x, e.z, rot);
        }
      });

      Object.keys(lists).forEach((name) => {
        const mats = lists[name];
        const im = new THREE.InstancedMesh(KIT.pieces[name].main, this.kitMat, mats.length);
        mats.forEach((m, k) => im.setMatrixAt(k, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.level.add(im);
      });

      this.buildProps();
    }

    buildProps() {
      const wood = this.propMat(0x6a4428, 0.82, 0);
      const darkWood = this.propMat(0x4a2e1c, 0.86, 0);
      const iron = this.propMat(0x55575f, 0.42, 0.85);
      const barrelGeo = new THREE.LatheGeometry(
        [0.2, 0.235, 0.25, 0.235, 0.2].map((r, k) => new THREE.Vector2(r, (k / 4) * 0.62)),
        16
      );
      const lidGeo = new THREE.CircleGeometry(0.2, 16);
      lidGeo.rotateX(-Math.PI / 2);
      lidGeo.translate(0, 0.62, 0);
      const bandGeo = new THREE.TorusGeometry(0.242, 0.018, 6, 20);
      bandGeo.rotateX(Math.PI / 2);
      const crateGeo = new THREE.BoxGeometry(0.52, 0.52, 0.52);
      const slatGeo = new THREE.BoxGeometry(0.56, 0.07, 0.07);
      const mk = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
      };

      this.propPlan.forEach((pp) => {
        const d = DIRS[pp.dir];
        const cx = (pp.i + 0.5) * CELL;
        const cz = (pp.j + 0.5) * CELL;
        const back = CELL / 2 - 0.66; // tucked against the wall
        const side = (this.rng() - 0.5) * CELL * 0.4;
        // Along the wall is the axis perpendicular to the wall's normal.
        const ax = d.dz ? 1 : 0;
        const az = d.dx ? 1 : 0;
        const bx = cx + d.dx * back + ax * side;
        const bz = cz + d.dz * back + az * side;
        for (let k = 0; k < pp.n; k++) {
          const stacked = k === 2;
          const off = stacked ? 0.27 : k * 0.55;
          const ox = bx + ax * off;
          const oz = bz + az * off;
          if (!stacked && !this.canStand(ox, oz, 0.28)) continue;
          const g = new THREE.Group();
          if (pp.kind === "barrel") {
            g.add(mk(barrelGeo, darkWood), mk(lidGeo, darkWood));
            [0.12, 0.5].forEach((y) => {
              const band = mk(bandGeo, iron);
              band.position.y = y;
              g.add(band);
            });
          } else {
            const box = mk(crateGeo, wood);
            box.position.y = 0.26;
            g.add(box);
            [0.04, 0.48].forEach((y) => {
              [-0.25, 0.25].forEach((z) => {
                const sl = mk(slatGeo, darkWood);
                sl.position.set(0, y, z);
                g.add(sl);
              });
            });
          }
          g.position.set(ox, stacked ? (pp.kind === "crate" ? 0.52 : 0.62) : 0, oz);
          g.rotation.y = this.rng() * Math.PI;
          this.level.add(g);
          if (!stacked) this.blockFootprint(ox, oz, 0.27);
        }
      });
    }

    buildTorches() {
      const gen = this.gen;
      const W = gen.W;
      const isFloor = (i, j) => i >= 0 && j >= 0 && i < W && j < gen.H && gen.kind[j * W + i] !== VOID;
      const spots = [];
      const near = (i, j) => spots.some((s) => Math.abs(s.i - i) + Math.abs(s.j - j) < 2);
      for (let j = 0; j < gen.H; j++) {
        for (let i = 0; i < W; i++) {
          if (!isFloor(i, j) || this.cornerCells.has(j * W + i)) continue;
          const c = j * W + i;
          const chance = gen.kind[c] === ROOM ? 0.42 : 0.24;
          DIRS.forEach((d, di) => {
            if (isFloor(i + d.dx, j + d.dz)) return;
            if (this.usedEdges.has(this.edgeKey({ i: i, j: j, dir: di }))) return;
            if (this.bars.has(c + ":" + di)) return;
            if (this.rng() > chance || near(i, j)) return;
            spots.push({ i: i, j: j, dir: di });
          });
        }
      }
      if (!spots.length) return;
      const n = spots.length;
      const bracketGeo = new THREE.BoxGeometry(0.08, 0.3, 0.2);
      const handleGeo = new THREE.CylinderGeometry(0.035, 0.028, 0.4, 7);
      const cupGeo = new THREE.CylinderGeometry(0.1, 0.05, 0.12, 10, 1, true);
      const iron = this.propMat(0x3a3a42, 0.45, 0.8);
      const wood = this.propMat(0x3b2616, 0.9, 0);
      iron.side = THREE.DoubleSide;
      const brackets = new THREE.InstancedMesh(bracketGeo, iron, n);
      const handles = new THREE.InstancedMesh(handleGeo, wood, n);
      const cups = new THREE.InstancedMesh(cupGeo, iron, n);
      const flameGeo = new THREE.PlaneGeometry(0.5, 0.9);
      flameGeo.translate(0, 0.38, 0);
      const seeds = new Float32Array(n);
      for (let k = 0; k < n; k++) seeds[k] = Math.random() * 10;
      flameGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
      const flames = new THREE.InstancedMesh(flameGeo, this.fireMat, n);
      flames.frustumCulled = false;
      flames.renderOrder = 25;
      const haloGeo = new THREE.PlaneGeometry(2.6, 2.6);
      haloGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
      const halos = new THREE.InstancedMesh(haloGeo, this.haloMat, n);
      halos.frustumCulled = false;
      halos.renderOrder = 24;
      this.level.add(halos);
      this.halos = halos;
      [brackets, handles, cups, flames].forEach((m) => this.level.add(m));
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      spots.forEach((s, k) => {
        const d = DIRS[s.dir];
        const cx = (s.i + 0.5) * CELL;
        const cz = (s.j + 0.5) * CELL;
        const face = CELL / 2 - 0.42; // just proud of the wall face
        const x = cx + d.dx * face;
        const z = cz + d.dz * face;
        const inward = Math.atan2(-d.dx, -d.dz);
        e.set(0, inward, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x + d.dx * 0.05, 1.45, z + d.dz * 0.05), q, new THREE.Vector3(1, 1, 1));
        brackets.setMatrixAt(k, m4);
        const hx = x - d.dx * 0.1;
        const hz = z - d.dz * 0.1;
        e.set(-0.45 * (d.dz ? d.dz : 0), 0, 0.45 * (d.dx ? d.dx : 0));
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(hx, 1.55, hz), q, new THREE.Vector3(1, 1, 1));
        handles.setMatrixAt(k, m4);
        const fx = x - d.dx * 0.19;
        const fz = z - d.dz * 0.19;
        m4.compose(new THREE.Vector3(fx, 1.76, fz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        cups.setMatrixAt(k, m4);
        this.torches.push({
          k: k,
          x: fx,
          y: 1.95,
          z: fz,
          cell: s.j * W + s.i,
          seed: seeds[k],
          seen: false,
          dx: -d.dx,
          dz: -d.dz,
        });
        m4.makeScale(0, 0, 0);
        flames.setMatrixAt(k, m4);
        halos.setMatrixAt(k, m4);
      });
      halos.instanceMatrix.needsUpdate = true;
      [brackets, handles, cups, flames].forEach((m) => {
        m.instanceMatrix.needsUpdate = true;
        m.castShadow = m !== flames;
      });
      this.flames = flames;
    }

    buildChests() {
      this.chestPlan.forEach((cp) => {
        const d = DIRS[cp.dir];
        const cx = (cp.i + 0.5) * CELL;
        const cz = (cp.j + 0.5) * CELL;
        const back = CELL / 2 - (cp.spur ? 0.95 : 0.8);
        const gx = cx + d.dx * back;
        const gz = cz + d.dz * back;
        const chest = this.makeChest(cp.rare);
        chest.group.position.set(gx, 0, gz);
        chest.group.rotation.y = Math.atan2(-d.dx, -d.dz);
        this.level.add(chest.group);
        const beam = new THREE.Mesh(this.beamGeo, cp.rare ? this.beamMats.rare : this.beamMats.common);
        beam.position.set(gx, 0, gz);
        beam.visible = false;
        beam.renderOrder = 26;
        this.level.add(beam);
        this.blockFootprint(gx, gz, 0.3);
        this.chests.push({
          gx: gx,
          gz: gz,
          rare: cp.rare,
          lid: chest.lid,
          glowPlane: chest.glow,
          beam: beam,
          group: chest.group,
          cell: cp.j * MAP_CELLS + cp.i,
          opened: false,
          seen: false,
        });
      });
    }

    makeChest(rare) {
      const g = new THREE.Group();
      const wood = this.propMat(rare ? 0x4a1f3f : 0x6b3f22, 0.72, 0);
      const metal = this.propMat(rare ? 0xf0c050 : 0x8e919c, rare ? 0.22 : 0.34, 0.95);
      const mk = (geo, mat, parent, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.position.set(x, y, z);
        parent.add(m);
        return m;
      };
      mk(new THREE.BoxGeometry(0.72, 0.38, 0.46), wood, g, 0, 0.19, 0);
      mk(new THREE.BoxGeometry(0.76, 0.05, 0.5), metal, g, 0, 0.025, 0);
      const bandGeo = new THREE.BoxGeometry(0.06, 0.39, 0.475);
      [-0.25, 0.25].forEach((x) => mk(bandGeo, metal, g, x, 0.195, 0));
      // The lid pivots on its back edge.
      const lid = new THREE.Group();
      lid.position.set(0, 0.38, -0.23);
      g.add(lid);
      const lidGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.72, 18, 1, false, 0, Math.PI);
      lidGeo.rotateZ(Math.PI / 2);
      mk(lidGeo, wood, lid, 0, 0, 0.23);
      const hoopGeo = new THREE.TorusGeometry(0.235, 0.03, 6, 18, Math.PI);
      [-0.25, 0.25].forEach((x) => {
        const hoop = mk(hoopGeo, metal, lid, x, 0, 0.23);
        hoop.rotation.y = Math.PI / 2;
      });
      mk(new THREE.BoxGeometry(0.12, 0.14, 0.04), metal, g, 0, 0.36, 0.24);
      if (rare) {
        const gemMat = this.propMat(0xd07cff, 0.2, 0.1, { emissive: 0xb050ff, emissiveIntensity: 4 });
        mk(new THREE.OctahedronGeometry(0.045), gemMat, g, 0, 0.37, 0.27);
      }
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.36),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(rare ? 0xd08cff : 0xffc860).multiplyScalar(5) })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.37;
      glow.visible = false;
      g.add(glow);
      return { group: g, lid: lid, glow: glow };
    }

    buildPortal() {
      const room = this.gen.exit;
      const gx = (room.cx + 0.5) * CELL;
      const gz = (room.cy + 0.5) * CELL;
      // The exit room's centre must stay clear of its own pillars.
      const clearPillar = this.pillars.find((p) => p.i === room.cx && p.j === room.cy);
      const pos = clearPillar ? { gx: gx + CELL / 2, gz: gz } : { gx: gx, gz: gz };
      const g = new THREE.Group();
      g.position.set(pos.gx, 0.03, pos.gz);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 64), this.portalMat);
      disc.rotation.x = -Math.PI / 2;
      disc.renderOrder = 24;
      const runes = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 1.62, 72),
        new THREE.MeshBasicMaterial({
          map: this.runeTex,
          color: new THREE.Color(0xb080ff).multiplyScalar(3),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      runes.rotation.x = -Math.PI / 2;
      runes.position.y = 0.01;
      runes.renderOrder = 24;
      // RingGeometry's UVs are planar over the ring's bounds, which is what
      // the rune texture (drawn as a full circle) expects.
      const beam = new THREE.Mesh(this.beamGeo, this.beamMats.portal);
      beam.scale.set(2.6, 1.1, 2.6);
      beam.renderOrder = 26;
      g.add(disc, runes, beam);
      g.visible = false;
      this.level.add(g);
      this.portal = { group: g, runes: runes, gx: pos.gx, gz: pos.gz, cell: this.cellAt(pos.gx, pos.gz), seen: false };
    }

    // Moonlight through cracks in the vault: a soft shaft, a pool of light
    // where it lands, and dust turning in it. Only in some rooms, so each
    // one reads as a landmark.
    buildShafts(gen) {
      this.shafts = [];
      gen.rooms.forEach((room) => {
        if (room === gen.exit || this.rng() > 0.45) return;
        const gx = (room.x + 1 + this.rng() * (room.w - 2)) * CELL;
        const gz = (room.y + 1 + this.rng() * (room.h - 2)) * CELL;
        const shaft = new THREE.Mesh(this.shaftGeo, this.shaftMat);
        shaft.position.set(gx, 0, gz);
        shaft.rotation.set(0.12, this.rng() * Math.PI * 2, 0.08);
        shaft.renderOrder = 27;
        const pool = new THREE.Mesh(this.poolGeo, this.poolMat);
        pool.position.set(gx, 0.03, gz);
        pool.renderOrder = 21;
        shaft.visible = pool.visible = false;
        this.level.add(shaft, pool);
        this.shafts.push({ shaft: shaft, pool: pool, gx: gx, gz: gz, cell: this.cellAt(gx, gz), seen: false });
      });
    }

    /* ---------- denizens ---------- */

    // A random standable point in a room, clear of what's in `avoid`.
    roomSpot(room, clearance, avoid) {
      for (let t = 0; t < 80; t++) {
        const gx = (room.x + 0.3 + this.rng() * (room.w - 0.6)) * CELL;
        const gz = (room.y + 0.3 + this.rng() * (room.h - 0.6)) * CELL;
        const s = this.sampleIdx(gx, gz);
        if (!this.stand[s]) continue;
        if (avoid.some((a) => dist(a.gx, a.gz, gx, gz) < (a.r || clearance))) continue;
        return { gx: gx, gz: gz };
      }
      const c = this.nearestStand(this.sampleIdx((room.cx + 0.5) * CELL, (room.cy + 0.5) * CELL), 8);
      return { gx: ((c % this.gw) + 0.5) * SAMPLE, gz: (Math.floor(c / this.gw) + 0.5) * SAMPLE };
    }

    spawnDenizens(gen) {
      const n = gen.floor;
      const scale = waveStatScale(2 * n - 1);
      const comp = waveComposition(2 * n - 1);
      const bruteFrac = comp.brutes / comp.total;
      gen.rooms.forEach((room) => {
        const avoid = this.chests.map((c) => ({ gx: c.gx, gz: c.gz, r: 1.1 }));
        if (this.portal) avoid.push({ gx: this.portal.gx, gz: this.portal.gz, r: 1.6 });
        if (room.type === "start") return;
        if (room.type === "empty") {
          if (this.rng() < 0.5) {
            const s = this.roomSpot(room, 1, avoid);
            this.dropFlask(s.gx, s.gz);
          }
          return;
        }
        const area = room.w * room.h;
        let count;
        if (room.type === "elite") count = 1 + this.rint(0, 2);
        else if (room.type === "treasure") count = this.rint(1, 2) + Math.floor(n / 3);
        else count = Math.min(8, Math.round(area / 5) + Math.floor((n - 1) / 2) + this.rint(0, 1));
        const placed = [];
        for (let k = 0; k < count; k++) {
          const elite = room.type === "elite" && k === 0;
          const type = elite || this.rng() < bruteFrac ? "brute" : "grunt";
          const spot = this.roomSpot(room, 1.1, avoid.concat(placed));
          placed.push({ gx: spot.gx, gz: spot.gz, r: 1.1 });
          this.addMonster(type, spot.gx, spot.gz, scale, elite, room.id);
        }
      });
    }

    addMonster(type, gx, gz, scale, elite, roomId) {
      const def = MONSTERS[type];
      const model = this.add(type === "brute" ? this.makeBrute() : this.makeGrunt());
      let maxHp = Math.round(def.hp * scale.hp);
      let dmg = [Math.round(def.dmg[0] * scale.dmg), Math.round(def.dmg[1] * scale.dmg)];
      if (elite) {
        maxHp = Math.round(maxHp * ELITE_HP);
        dmg = [Math.round(dmg[0] * ELITE_DMG), Math.round(dmg[1] * ELITE_DMG)];
        model.scale.setScalar(1.3);
        // A violet ember glow: flash() restores whatever emissive a body had,
        // so the elite keeps its aura after every hit.
        model.traverse((o) => {
          if (o.isMesh && o.material.emissive && o.material.emissive.getHex() === 0) {
            o.material.emissive.setHex(0x2a0a3a);
          }
        });
      }
      const m = {
        def: def,
        model: model,
        gx: gx,
        gz: gz,
        hp: maxHp,
        maxHp: maxHp,
        speed: def.speed * (elite ? 0.9 : 1),
        range: def.range * (elite ? 1.15 : 1),
        cd: def.cd,
        nextAttack: 0,
        dmg: dmg,
        alive: true,
        barY: def.barY * (elite ? 1.3 : 1),
        lunge: { x: 0, z: 0 },
        facing: this.rng() * Math.PI * 2,
        windingUp: false,
        windupEndsAt: 0,
        awake: false,
        seen: false,
        elite: elite,
        room: roomId,
      };
      m.bar = this.add(this.makeBar());
      m.tell = this.makeTelegraph(m.range);
      this.add(m.tell.group);
      model.visible = false;
      this.place(m);
      this.drawBar(m);
      this.monsters.push(m);
      return m;
    }

    // The elite's scale is baked into its model; the arena's wind-up swell
    // resets scale to 1, which would shrink it — keep it relative.
    monsterAttack(m) {
      super.monsterAttack(m);
      if (m.elite) {
        const fx = this.fx[this.fx.length - 1];
        const inner = fx.onUpdate;
        fx.onUpdate = (t) => {
          inner(t);
          if (m.windingUp) m.model.scale.multiplyScalar(1.3);
        };
      }
    }

    landMonsterAttack(m) {
      super.landMonsterAttack(m);
      if (m.elite) m.model.scale.setScalar(1.3);
    }

    cancelWindup(m) {
      super.cancelWindup(m);
      if (m.elite) m.model.scale.setScalar(1.3);
    }

    killMonster(m) {
      super.killMonster(m);
      const pts = m.elite ? PTS.elite : m.def.key === "brute" ? PTS.brute : PTS.grunt;
      this.addScore(pts, m.gx, m.barY, m.gz);
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.6 + Math.random() * 1.6;
        this.glow.emit({
          x: m.gx,
          y: 0.5 + Math.random() * 0.6,
          z: m.gz,
          vx: Math.cos(a) * s,
          vy: 1 + Math.random() * 2.2,
          vz: Math.sin(a) * s,
          life: 0.7 + Math.random() * 0.6,
          s0: 0.26,
          s1: 0.02,
          r: m.elite ? 2.6 : 3.4,
          g: m.elite ? 0.6 : 0.5,
          b: m.elite ? 4 : 0.9,
          a: 0.9,
          grav: 1.5,
          drag: 1.2,
        });
      }
      for (let k = 0; k < 8; k++) {
        this.smoke.emit({
          x: m.gx + (Math.random() - 0.5) * 0.5,
          y: 0.3,
          z: m.gz + (Math.random() - 0.5) * 0.5,
          vy: 0.4 + Math.random() * 0.4,
          life: 1.2,
          s0: 0.5,
          s1: 1.3,
          r: 0.08,
          g: 0.06,
          b: 0.1,
          a: 0.55,
          drag: 1.5,
        });
      }
    }

    // In the arena this opens the boon picker; down here the picker belongs
    // to the portal, so clearing every monster on a floor is a bonus instead.
    onWaveCleared() {
      if (this.over || this.purged || this.transitioning) return;
      if (!this.monsters.length || this.monsters.some((m) => m.alive)) return;
      this.purged = true;
      this.addScore(PTS.purge, this.player.gx, 1.8, this.player.gz);
      this.banner("FLOOR PURGED", 1600);
    }

    resolveBolt(b) {
      const hit = !!(b.target && b.target.alive);
      super.resolveBolt(b);
      const n = hit ? 12 : 5;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1 + Math.random() * 2.5;
        this.glow.emit({
          x: b.gx,
          y: 0.78,
          z: b.gz,
          vx: Math.cos(a) * s,
          vy: Math.random() * 2,
          vz: Math.sin(a) * s,
          life: 0.35 + Math.random() * 0.25,
          s0: 0.12,
          s1: 0.01,
          r: 1.6,
          g: 3,
          b: 4.5,
          a: 1,
          grav: 5,
          drag: 3,
        });
      }
    }

    // The arena's nova, plus line of sight (no blasting through a wall) and
    // a proper frost burst.
    castNova() {
      if (this.over || this.choosing || this.transitioning || this.now < this.novaReadyAt) return;
      const p = this.player;
      this.novaReadyAt = this.now + p.novaCd;
      this.spawnNovaFx(p.gx, p.gz);
      this.shakeCamera(0.12, 190);
      this.monsters.forEach((m) => {
        if (!m.alive || !m.seen) return;
        if (dist(m.gx, m.gz, p.gx, p.gz) <= 2.4 && this.hasLOS(p.gx, p.gz, m.gx, m.gz)) {
          this.hurtMonster(m, randInt(18 + p.novaDmg, 26 + p.novaDmg), "#8fd8ff");
        }
      });
      for (let k = 0; k < 70; k++) {
        const a = (k / 70) * Math.PI * 2;
        const s = 4 + Math.random() * 2.5;
        this.glow.emit({
          x: p.gx,
          y: 0.25 + Math.random() * 0.4,
          z: p.gz,
          vx: Math.cos(a) * s,
          vy: Math.random() * 1.2,
          vz: Math.sin(a) * s,
          life: 0.5 + Math.random() * 0.2,
          s0: 0.2,
          s1: 0.03,
          r: 1.4,
          g: 3,
          b: 5,
          a: 1,
          drag: 3.5,
        });
      }
      this.flash(this.player.model, 0x224466);
      this.flashAt(p.gx, 1.2, p.gz, 0x8fd8ff, 14, 380);
      this.refreshHud();
    }

    flashAt(x, y, z, color, power, ms) {
      const l = this.flashLight;
      l.position.set(x, y, z);
      l.color.setHex(color);
      this.addFx(ms, (t) => {
        l.intensity = power * (1 - t) * (1 - t);
      });
    }

    bumpGold() {
      super.bumpGold();
      const p = this.player;
      for (let k = 0; k < 8; k++) {
        this.glow.emit({
          x: p.gx + (Math.random() - 0.5) * 0.4,
          y: 0.4 + Math.random() * 0.6,
          z: p.gz + (Math.random() - 0.5) * 0.4,
          vy: 1.2,
          life: 0.5,
          s0: 0.14,
          s1: 0.02,
          r: 4,
          g: 3,
          b: 0.8,
          a: 1,
        });
      }
    }

    /* ---------- exploration ---------- */

    resetExplore() {
      const n = MAP_CELLS * MAP_CELLS;
      this.exploreTarget = new Uint8Array(n);
      this.exploreVal = new Float32Array(n);
      this.exploreData.fill(0);
      // G marks floor cells (static per floor): the mist only hangs there.
      for (let c = 0; c < n; c++) this.exploreData[c * 4 + 1] = this.gen.kind[c] !== VOID ? 255 : 0;
      this.exploreTex.needsUpdate = true;
      this.floorCells = 0;
      for (let c = 0; c < n; c++) if (this.gen.kind[c] !== VOID) this.floorCells++;
      this.revealed = 0;
    }

    reveal(c) {
      const W = MAP_CELLS;
      if (this.gen.kind[c] !== VOID && !this.exploreTarget[c]) this.revealed++;
      this.exploreTarget[c] = 1;
      const ci = c % W;
      const cj = Math.floor(c / W);
      // Void neighbours come along, so the backs of the walls around a
      // discovered cell are lit rather than fading into the unknown.
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= W || j >= W) continue;
          const n = j * W + i;
          if (this.gen.kind[n] === VOID) this.exploreTarget[n] = 1;
        }
      }
    }

    // Reveal by walking distance, never by straight line, so nothing shows
    // through a wall. A room is revealed whole the moment you step in.
    updateExplore(instant) {
      const p = this.player;
      const c = this.cellAt(p.gx, p.gz);
      const W = MAP_CELLS;
      if (c !== this.lastCell) {
        this.lastCell = c;
        const gen = this.gen;
        const seen = new Map([[c, 0]]);
        const q = [c];
        for (let h = 0; h < q.length; h++) {
          const cur = q[h];
          const d = seen.get(cur);
          this.reveal(cur);
          const room = gen.roomOf[cur];
          if (room >= 0 && d === 0) {
            const r = gen.rooms[room];
            for (let j = r.y; j < r.y + r.h; j++) {
              for (let i = r.x; i < r.x + r.w; i++) {
                const n = j * W + i;
                if (!seen.has(n)) {
                  seen.set(n, 0);
                  q.push(n);
                }
              }
            }
          }
          if (d >= REVEAL_DEPTH) continue;
          const ci = cur % W;
          const cj = Math.floor(cur / W);
          DIRS.forEach((dd) => {
            const i = ci + dd.dx;
            const j = cj + dd.dz;
            if (i < 0 || j < 0 || i >= W || j >= W) return;
            const n = j * W + i;
            if (gen.kind[n] === VOID || seen.has(n)) return;
            seen.set(n, d + 1);
            q.push(n);
          });
        }
      }
      let dirty = false;
      const step = instant ? 1 : 0.035;
      for (let k = 0; k < W * W; k++) {
        const target = this.exploreTarget[k];
        const v = this.exploreVal[k];
        if (v >= target) continue;
        const nv = Math.min(target, v + step * 1.0);
        this.exploreVal[k] = nv;
        this.exploreData[k * 4] = Math.round(nv * 255);
        dirty = true;
      }
      if (instant) {
        for (let k = 0; k < W * W; k++) this.exploreData[k * 4] = Math.round(this.exploreVal[k] * 255);
        dirty = true;
      }
      if (dirty) this.exploreTex.needsUpdate = true;

      // Things that only exist once found.
      this.torches.forEach((t) => {
        if (t.seen || this.exploreVal[t.cell] < 0.3) return;
        t.seen = true;
        const m4 = new THREE.Matrix4().makeTranslation(t.x, t.y - 0.3, t.z);
        this.flames.setMatrixAt(t.k, m4);
        this.flames.instanceMatrix.needsUpdate = true;
        m4.makeTranslation(t.x + t.dx * 0.15, t.y + 0.05, t.z + t.dz * 0.15);
        this.halos.setMatrixAt(t.k, m4);
        this.halos.instanceMatrix.needsUpdate = true;
      });
      this.chests.forEach((ch) => {
        if (ch.seen || this.exploreVal[ch.cell] < 0.3) return;
        ch.seen = true;
        this.chestsFound++;
        ch.beam.visible = !ch.opened;
      });
      this.shafts.forEach((sh) => {
        if (sh.seen || this.exploreVal[sh.cell] < 0.3) return;
        sh.seen = true;
        sh.shaft.visible = sh.pool.visible = true;
      });
      if (this.portal && !this.portal.seen && this.exploreVal[this.portal.cell] > 0.3) {
        this.portal.seen = true;
        this.portal.group.visible = true;
        this.banner("THE WAY DOWN", 1400);
      }
    }

    exploredFraction() {
      return this.floorCells ? this.revealed / this.floorCells : 0;
    }

    /* ---------- chests, doors, portal ---------- */

    updateChests() {
      const p = this.player;
      this.chests.forEach((c) => {
        if (c.opened || !c.seen) return;
        if (dist(c.gx, c.gz, p.gx, p.gz) > CHEST_OPEN_R) return;
        this.openChest(c);
      });
    }

    openChest(c) {
      c.opened = true;
      this.chestsOpened++;
      const pts = c.rare ? PTS.rareChest : PTS.chest;
      this.addScore(pts, c.gx, 1.3, c.gz, c.rare ? "#e0a0ff" : "#ffd23f");
      c.glowPlane.visible = true;
      const lid = c.lid;
      this.addFx(520, (t) => {
        const e = t < 0.7 ? t / 0.7 : 1 + Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.06;
        lid.rotation.x = -1.95 * Math.min(1.06, e);
      });
      this.addFx(900, (t) => {
        c.beam.material = c.rare ? this.beamMats.rare : this.beamMats.common;
        c.beam.scale.set(1 + t * 1.5, 1 - t, 1 + t * 1.5);
        c.beam.visible = t < 1;
      });
      const col = c.rare ? [3, 1.4, 5] : [5, 3.4, 1];
      for (let k = 0; k < 60; k++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * 1.6;
        this.glow.emit({
          x: c.gx,
          y: 0.45,
          z: c.gz,
          vx: Math.cos(a) * s,
          vy: 2.5 + Math.random() * 3,
          vz: Math.sin(a) * s,
          life: 0.9 + Math.random() * 0.7,
          s0: 0.2,
          s1: 0.02,
          r: col[0],
          g: col[1],
          b: col[2],
          a: 1,
          grav: 4,
          drag: 0.8,
        });
      }
      this.flashAt(c.gx, 1.1, c.gz, c.rare ? 0xc890ff : 0xffcf70, 18, 700);
      this.shakeCamera(0.06, 160);
      // Coins arc out of the chest and land as pickups.
      const coins = (c.rare ? 7 : 4) + randInt(0, 2);
      for (let k = 0; k < coins; k++) {
        let tx = c.gx;
        let tz = c.gz;
        for (let t = 0; t < 10; t++) {
          const a = Math.random() * Math.PI * 2;
          const d = 0.6 + Math.random() * 0.9;
          if (this.canStand(c.gx + Math.cos(a) * d, c.gz + Math.sin(a) * d, 0.15)) {
            tx = c.gx + Math.cos(a) * d;
            tz = c.gz + Math.sin(a) * d;
            break;
          }
        }
        const model = this.add(this.makeCoin());
        const sx = c.gx;
        const sz = c.gz;
        const delay = k * 45;
        model.visible = false;
        this.after(delay, () => {
          model.visible = true;
          this.addFx(
            520,
            (t) => {
              model.position.set(sx + (tx - sx) * t, 0.45 + Math.sin(t * Math.PI) * 1.2 - 0.45 * t, sz + (tz - sz) * t);
              model.rotation.y += 0.4;
            },
            () => {
              if (this.over || !this.level) {
                this.drop(model);
                return;
              }
              this.coins.push({ model: model, gx: tx, gz: tz, born: this.now });
            }
          );
        });
      }
      if (Math.random() < 0.3) this.dropFlask(c.gx + 0.2, c.gz + 0.2);
    }

    updateDoors() {
      const p = this.player;
      this.doors.forEach((d) => {
        let near = dist(d.x, d.z, p.gx, p.gz) < 2.6;
        if (!near) {
          near = this.monsters.some((m) => m.alive && m.awake && dist(d.x, d.z, m.gx, m.gz) < 2.2);
        }
        const want = near ? 1 : 0;
        if (want && !d.want) {
          // Swing away from whoever is opening it.
          const lx = p.gx - d.x;
          const lz = p.gz - d.z;
          const ry = d.frame.rotation.y;
          d.dir = Math.sin(ry) * lx + Math.cos(ry) * lz > 0 ? -1 : 1;
        }
        d.want = want;
        const before = d.open;
        d.open += (want - d.open) * Math.min(1, 0.016 * 9);
        if (Math.abs(d.open - before) < 0.0005) return;
        d.leaf.rotation.y = d.dir * d.open * 1.7;
        const blocked = d.open < 0.35 ? 1 : 0;
        d.cells.forEach((c) => {
          this.doorBlock[c] = blocked;
        });
      });
    }

    updatePortal() {
      const P = this.portal;
      if (!P || !P.seen || this.transitioning) return;
      const p = this.player;
      if (dist(P.gx, P.gz, p.gx, p.gz) < PORTAL_R) this.enterPortal();
    }

    animatePortal(dt, t) {
      const P = this.portal;
      P.runes.rotation.z = t * 0.25;
      this.portalLight.position.set(P.gx, 1.2, P.gz);
      this.portalLight.intensity = 9 * (0.85 + 0.15 * Math.sin(t * 2.3));
      if (Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.3 + Math.random() * 1.1;
        this.glow.emit({
          x: P.gx + Math.cos(a) * r,
          y: 0.05,
          z: P.gz + Math.sin(a) * r,
          vx: -Math.sin(a) * 1.2 - Math.cos(a) * 0.3,
          vy: 0.8 + Math.random() * 1.6,
          vz: Math.cos(a) * 1.2 - Math.sin(a) * 0.3,
          life: 1.3,
          s0: 0.16,
          s1: 0.02,
          r: Math.random() < 0.5 ? 1.6 : 2.8,
          g: Math.random() < 0.5 ? 3.2 : 0.9,
          b: 5,
          a: 0.9,
          drag: 0.6,
        });
      }
    }

    // Step into the portal: bank the floor, fade to black, offer a boon (the
    // arena's picker, retitled), then build the next floor on the pick.
    enterPortal() {
      const p = this.player;
      this.transitioning = true;
      p.moveTo = null;
      p.path = null;
      p.target = null;
      this.holdMove = false;
      this.monsters.forEach((m) => m.windingUp && this.cancelWindup(m));
      this.clearBolts();
      const explored = this.exploredFraction();
      this.exploreSum += explored;
      const floorBonus = Math.round(PTS.floor * this.floorMult());
      const exploreBonus = Math.round(PTS.explore * explored * this.floorMult());
      this.score += floorBonus + exploreBonus;
      this.descendNote =
        "Floor bonus +" +
        floorBonus +
        " &nbsp;·&nbsp; Explored " +
        Math.round(explored * 100) +
        "% +" +
        exploreBonus +
        " &nbsp;·&nbsp; Chests " +
        this.chests.filter((c) => c.opened).length +
        "/" +
        this.chests.length;
      this.bumpScore();
      this.refreshHud();
      const P = this.portal;
      const model = p.model;
      this.flashAt(P.gx, 1, P.gz, 0xa070ff, 24, 900);
      this.addFx(700, (t) => {
        model.scale.setScalar(Math.max(0.01, 1 - t));
        model.rotation.y = p.facing + t * 12;
        model.position.y = t * 0.8;
        this.grade.uniforms.uFade.value = smoothstep(0.3, 1, t);
      });
      for (let k = 0; k < 90; k++) {
        const a = Math.random() * Math.PI * 2;
        this.glow.emit({
          x: P.gx + Math.cos(a) * 0.4,
          y: 0.2,
          z: P.gz + Math.sin(a) * 0.4,
          vx: Math.cos(a) * 0.6,
          vy: 3 + Math.random() * 4,
          vz: Math.sin(a) * 0.6,
          life: 1,
          s0: 0.2,
          s1: 0.02,
          r: 2.4,
          g: 1.6,
          b: 5,
          a: 1,
          drag: 0.4,
        });
      }
      this.after(760, () => {
        if (this.over) return;
        p.hp = Math.min(p.maxHp, p.hp + DESCEND_HEAL);
        this.offerUpgrades();
      });
    }

    offerUpgrades() {
      super.offerUpgrades();
      if (!this.choosing) return;
      this.el.upgradeTitle.textContent = "FLOOR " + this.floor + " CLEARED";
      const sub = this.root.querySelector(".gh3-upgrade-sub");
      if (sub) sub.innerHTML = this.descendNote + "<br>The dark offers a boon for the way down — take one";
    }

    nextWaveAfterChoice() {
      const p = this.player;
      this.buildFloor(this.floor + 1);
      p.model.scale.setScalar(1);
      p.model.position.y = 0;
      this.transitioning = false;
      this.addFx(650, (t) => {
        this.grade.uniforms.uFade.value = 1 - t;
      });
    }

    floorMult() {
      return 1 + 0.25 * (this.floor - 1);
    }

    addScore(base, x, y, z, color) {
      const pts = Math.round(base * this.floorMult());
      this.score += pts;
      this.popNumber(x, y, z, "+" + pts, color || "#ffe7a3");
      this.bumpScore();
      this.refreshHud();
    }

    bumpScore() {
      const el = this.el.score;
      if (!el) return;
      el.classList.remove("is-bumped");
      void el.offsetWidth;
      el.classList.add("is-bumped");
    }

    /* ---------- lights & ambience ---------- */

    updateTorchLights(dt, t) {
      if (!this.torches) return;
      const p = this.player;
      if (!this.torchPickAt || this.now - this.torchPickAt > 200) {
        this.torchPickAt = this.now;
        const lit = this.torches
          .filter((tc) => tc.seen)
          .map((tc) => ({ tc: tc, d: dist(tc.x, tc.z, p.gx, p.gz) }))
          .filter((o) => o.d < 15)
          .sort((a, b) => a.d - b.d)
          .slice(0, this.torchLights.length)
          .map((o) => o.tc);
        // Keep lights on torches that are still wanted, hand the rest out.
        const free = [];
        this.torchLights.forEach((l) => {
          if (l.userData.torch && lit.indexOf(l.userData.torch) >= 0) {
            lit.splice(lit.indexOf(l.userData.torch), 1);
          } else {
            free.push(l);
          }
        });
        free.forEach((l) => {
          const tc = lit.shift() || null;
          if (tc !== l.userData.torch) {
            l.userData.torch = tc;
            l.userData.level = 0;
          }
        });
      }
      this.torchLights.forEach((l) => {
        const tc = l.userData.torch;
        if (!tc) {
          l.intensity = Math.max(0, l.intensity - dt * 40);
          return;
        }
        l.userData.level = Math.min(1, l.userData.level + dt * 2.5);
        const s = tc.seed;
        const flick = 0.78 + 0.12 * Math.sin(t * 9.1 + s) + 0.08 * Math.sin(t * 23.7 + s * 3) + 0.05 * Math.sin(t * 41 + s * 7);
        l.intensity = TORCH_LIGHT * flick * l.userData.level;
        l.position.set(tc.x + tc.dx * 0.8 + Math.sin(t * 7 + s) * 0.03, tc.y + 0.35, tc.z + tc.dz * 0.8);
      });
    }

    updateAmbientParticles(dt, t) {
      const p = this.player;
      const Q = this.quality;
      // Dust hanging in the air around the exile, catching the light.
      if (Math.random() < dt * Q.dust) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 7;
        this.glow.emit({
          x: p.gx + Math.cos(a) * r,
          y: 0.3 + Math.random() * 2.2,
          z: p.gz + Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.3) * 0.08,
          vz: (Math.random() - 0.5) * 0.12,
          life: 5 + Math.random() * 3,
          s0: 0.05,
          s1: 0.05,
          r: 1.1,
          g: 0.95,
          b: 0.8,
          a: 0.28,
        });
      }
      // Embers off the nearby torches.
      if (this.torches) {
        this.torches.forEach((tc) => {
          if (!tc.seen || Math.random() > dt * 2.2) return;
          if (Math.abs(tc.x - p.gx) > 12 || Math.abs(tc.z - p.gz) > 12) return;
          this.glow.emit({
            x: tc.x + (Math.random() - 0.5) * 0.1,
            y: tc.y,
            z: tc.z + (Math.random() - 0.5) * 0.1,
            vx: (Math.random() - 0.5) * 0.3 + tc.dx * 0.2,
            vy: 0.8 + Math.random() * 0.8,
            vz: (Math.random() - 0.5) * 0.3 + tc.dz * 0.2,
            life: 1 + Math.random() * 0.8,
            s0: 0.06,
            s1: 0.015,
            r: 5,
            g: 1.8,
            b: 0.4,
            a: 1,
            drag: 0.6,
          });
        });
      }
      // Footfall dust.
      if (this.moved > 0.004 && (!this.stepAt || this.now - this.stepAt > 230)) {
        this.stepAt = this.now;
        this.smoke.emit({
          x: p.gx + (Math.random() - 0.5) * 0.2,
          y: 0.06,
          z: p.gz + (Math.random() - 0.5) * 0.2,
          vy: 0.15,
          life: 0.8,
          s0: 0.25,
          s1: 0.7,
          r: 0.32,
          g: 0.28,
          b: 0.3,
          a: 0.28,
          drag: 2,
        });
      }
    }

    /* ---------- HUD ---------- */

    drawMinimap() {
      const cv = this.el.minimap;
      if (!cv || !this.gen) return;
      const g = cv.getContext("2d");
      const size = cv.width;
      const s = size / MAP_CELLS;
      g.clearRect(0, 0, size, size);
      const gen = this.gen;
      for (let c = 0; c < MAP_CELLS * MAP_CELLS; c++) {
        const v = this.exploreVal[c];
        if (v <= 0.02 || gen.kind[c] === VOID) continue;
        const i = c % MAP_CELLS;
        const j = Math.floor(c / MAP_CELLS);
        g.globalAlpha = Math.min(1, v * 1.3);
        g.fillStyle = gen.kind[c] === ROOM ? "#7a6aa8" : "#51497a";
        g.fillRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
      }
      g.globalAlpha = 1;
      this.chests.forEach((c) => {
        if (!c.seen) return;
        g.fillStyle = c.opened ? "#5c5670" : c.rare ? "#d58cff" : "#ffd23f";
        g.beginPath();
        g.arc((c.gx / MAP_SIZE) * size, (c.gz / MAP_SIZE) * size, s * 0.32, 0, Math.PI * 2);
        g.fill();
      });
      if (this.portal && this.portal.seen) {
        const pulse = 0.5 + 0.5 * Math.sin(this.now / 220);
        g.strokeStyle = "rgba(186,140,255," + (0.5 + pulse * 0.5) + ")";
        g.lineWidth = 3;
        g.beginPath();
        g.arc((this.portal.gx / MAP_SIZE) * size, (this.portal.gz / MAP_SIZE) * size, s * (0.45 + pulse * 0.2), 0, Math.PI * 2);
        g.stroke();
      }
      const p = this.player;
      const px = (p.gx / MAP_SIZE) * size;
      const pz = (p.gz / MAP_SIZE) * size;
      g.fillStyle = "#9fd8ff";
      g.shadowColor = "#9fd8ff";
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(px, pz, s * 0.34, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }

    refreshHud() {
      super.refreshHud();
      if (!this.el.score) return;
      this.el.stats.textContent = "Floor " + this.floor + "  ·  Slain " + this.kills;
      this.el.score.textContent = this.score.toLocaleString() + " pts";
      const b = this.startBest;
      this.el.best.textContent =
        "Explored " +
        Math.round(this.exploredFraction() * 100) +
        "%  ·  " +
        (b.score > 0 ? "Best " + b.score.toLocaleString() : "Best —");
    }

    loadBest() {
      try {
        const raw = JSON.parse(localStorage.getItem(bestKey));
        if (raw && Number.isFinite(raw.score) && Number.isFinite(raw.floor)) return raw;
      } catch (e) {
        /* storage unavailable */
      }
      return { score: 0, floor: 0 };
    }

    saveBest() {
      try {
        if (this.score > this.startBest.score) {
          localStorage.setItem(bestKey, JSON.stringify({ score: this.score, floor: this.floor }));
        }
      } catch (e) {
        /* storage unavailable */
      }
    }

    endGame() {
      if (this.over) return;
      const p = this.player;
      super.endGame();
      const isBest = this.score > this.startBest.score;
      const explored = this.exploreSum + this.exploredFraction();
      this.el.summary.innerHTML =
        "Fell on floor " +
        this.floor +
        " with <b>" +
        this.score.toLocaleString() +
        "</b> points" +
        "<br>Chests opened: " +
        this.chestsOpened +
        " &nbsp;·&nbsp; Monsters slain: " +
        this.kills +
        " &nbsp;·&nbsp; Gold: " +
        this.gold +
        "<br>Average exploration: " +
        Math.round((explored / this.floor) * 100) +
        "%" +
        "<br>Boons: " +
        this.boonSummary() +
        "<br>" +
        (isBest ? "★ New Best!" : "Best: " + this.startBest.score.toLocaleString() + " (floor " + this.startBest.floor + ")");
      const model = p.model;
      this.addFx(600, (t) => {
        model.rotation.x = (-t * Math.PI) / 2.2;
        model.position.y = -0.2 * t;
      });
      for (let k = 0; k < 40; k++) {
        this.smoke.emit({
          x: p.gx + (Math.random() - 0.5) * 0.6,
          y: 0.3 + Math.random() * 0.8,
          z: p.gz + (Math.random() - 0.5) * 0.6,
          vy: 0.5 + Math.random() * 0.6,
          life: 1.6,
          s0: 0.4,
          s1: 1.2,
          r: 0.05,
          g: 0.04,
          b: 0.08,
          a: 0.6,
          drag: 1,
        });
      }
    }

    /* ---------- teardown ---------- */

    clearWorld() {
      this.clearFloor();
      this.grade.uniforms.uFade.value = 0;
      this.transitioning = false;
      super.clearWorld();
    }

    destroy() {
      super.destroy();
      [this.brickTex, this.flagTex, this.noiseTex, this.exploreTex, this.runeTex, this.envTex].forEach((t) => {
        if (t) t.dispose();
      });
      this.mist.geometry.dispose();
      [this.shaftGeo, this.poolGeo].forEach((g) => g.dispose());
      [
        this.kitMat,
        this.fireMat,
        this.portalMat,
        this.mistMat,
        this.haloMat,
        this.shaftMat,
        this.poolMat,
        this.beamMats.common,
        this.beamMats.rare,
        this.beamMats.portal,
      ].forEach(
        (m) => m && m.dispose()
      );
      this.beamGeo.dispose();
      this.glow.dispose();
      this.smoke.dispose();
      this.composer.dispose();
      if (this.gtao) this.gtao.dispose();
      this.bloom.dispose();
    }
  };
}

/* ---------- entry point ---------- */

function pickQuality() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("gh3q");
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const low = forced ? forced === "low" : coarse;
  const dpr = window.devicePixelRatio || 1;
  const seed = parseInt(params.get("gh3seed"), 10) || 0;
  if (low) {
    return {
      low: true,
      pr: Math.min(dpr, 1.25),
      msaa: 0,
      shadows: false,
      shadowSize: 0,
      gtao: false,
      torchLights: 3,
      particles: 900,
      dust: 5,
      tex: 512,
      fixed: !!forced,
      seed: seed,
    };
  }
  return {
    low: false,
    pr: Math.min(dpr, 1.75),
    msaa: 4,
    shadows: true,
    shadowSize: 1024,
    gtao: params.get("gh3ao") !== "0",
    torchLights: 6,
    particles: 2600,
    dust: 14,
    tex: 1024,
    fixed: !!forced,
    seed: seed,
  };
}

// Called by the arena's launcher. Loads the kit, generates the detail
// textures (once per page), then builds the game. Returns null if the player
// backed out while it was loading.
export async function createDungeonDive(ctx) {
  THREE = ctx.THREE;
  API = ctx.api;
  QUALITY = pickQuality();
  injectDiveStyle();
  ctx.root.classList.add("gh3-dive");
  const stats = ctx.root.querySelector(".gh3-stats");
  if (stats && !ctx.root.querySelector("[data-gh3=score]")) {
    const score = document.createElement("span");
    score.className = "gh3-score";
    score.setAttribute("data-gh3", "score");
    stats.insertBefore(score, stats.children[1]);
  }
  const hud = ctx.root.querySelector(".gh3-hud");
  if (hud && !ctx.root.querySelector("[data-gh3=minimap]")) hud.insertAdjacentHTML("afterbegin", DIVE_HUD);

  if (!KIT) KIT = await loadKit(ctx.kitUrl);
  if (!ctx.isLive()) return null;
  if (!DETAIL || DETAIL.size !== QUALITY.tex) {
    // Give the loading text a frame to paint before the (synchronous)
    // texture generation, which takes a moment on a phone.
    await new Promise((r) => setTimeout(r, 30));
    DETAIL = {
      size: QUALITY.tex,
      brick: makeBricks(QUALITY.tex),
      flag: makeFlagstones(QUALITY.tex),
      noiseSize: 256,
      noise: makeNoise(256),
    };
  }
  if (!ctx.isLive()) return null;
  const DungeonDive = defineDive(ctx.Hollow3D, ctx.bestKey);
  return new DungeonDive(ctx.root);
}

// Exposed for headless checks of the generator.
export { generateFloor, MAP_CELLS, CELL };
