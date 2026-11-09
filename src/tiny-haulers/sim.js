/*
 * Tiny Haulers — simulation core.
 *
 * Pure logic, no rendering: the road network of the two towns, the traffic
 * model (IDM car-following + reserved intersections), the job board, the
 * trucks' errands, the economy and save/load. It runs unchanged in the
 * browser (window.TinyHaulersSim) and under Node (module.exports), which is
 * what test/tiny-haulers.test.js drives.
 *
 * Coordinates: x is east, z is south (three.js ground plane). Traffic drives
 * on the right. A road is an undirected edge between two nodes; each edge
 * carries one lane per direction, keyed "a>b". Lanes stop short of the nodes
 * (an "inset") and a vehicle crosses a node on a "move": a precomputed curve
 * from the end of its incoming lane to the start of its outgoing lane.
 *
 * Intersections (degree >= 3) are controlled. Maplewood uses all-way stop
 * signs (stop, then go first-come-first-served), Seabright uses traffic
 * lights. Either way a vehicle has to be *granted* a move before it may enter,
 * and a grant is only given when no reserved/occupying vehicle's move crosses
 * its own (conflicts are precomputed from the curves' geometry) and there is
 * room on the lane it is heading into, so the box never blocks.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TinyHaulersSim = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Tuning                                                              */
  /* ------------------------------------------------------------------ */

  var C = {
    LANE_OFF: 0.75, // lane centre from the road centre line
    ROAD_W: 3.0,
    CURB_OFF: 1.25, // extra lateral offset of a vehicle parked at the curb
    TOWN_V: 3.4, // speed limits (units / s)
    HWY_V: 6.4,
    TURN_V: 1.7, // speed through a sharp turn
    CAR_LEN: 1.6,
    TRUCK_LEN: 2.1,
    // Intelligent Driver Model
    A_MAX: 2.4,
    B_COMF: 3.2,
    S0: 0.55,
    T_HEAD: 0.85,
    LOOK: 30,
    STOP_DWELL: 0.45, // full stop required at a stop sign
    // Signals: green / yellow / all-red per axis
    SIG_GREEN: 8,
    SIG_YELLOW: 1.8,
    SIG_RED: 1.0,
    SIG_MIN_GREEN: 3,
    // Day / economy
    DAY_LEN: 180, // seconds of play per in-game day
    START_MONEY: 250,
    TRUCK_COSTS: [400, 650, 900, 1250],
    MAX_TRUCKS: 5,
    UPKEEP: 20, // per truck per day
    FUEL: 0.06, // per unit driven by a truck
    LOAD_TIME: 2.4,
    UNLOAD_TIME: 1.7,
    QUEUE_MAX: 2, // jobs a truck can have waiting after the current one
    BOARD_SIZE: 5,
    BOARD_REFILL: 4, // seconds before an empty board slot is refilled
    JOB_LIFE_MIN: 70,
    JOB_LIFE_MAX: 110,
    AVG_SPEED: 2.6, // used for deadline estimates
    BONUS_FRAC: 0.3,
    AMBIENT: { maplewood: 3, seabright: 3, travel: 2 },
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  // mulberry32: tiny seedable PRNG whose whole state is one uint32, so it
  // saves as a number.
  function Rng(seed) {
    this.state = seed >>> 0 || 1;
  }
  Rng.prototype.next = function () {
    var t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.int = function (n) {
    return Math.floor(this.next() * n);
  };
  Rng.prototype.range = function (a, b) {
    return a + (b - a) * this.next();
  };
  Rng.prototype.pick = function (arr) {
    return arr[this.int(arr.length)];
  };
  Rng.prototype.weighted = function (weights) {
    var total = 0;
    for (var i = 0; i < weights.length; i++) total += weights[i];
    var r = this.next() * total;
    for (var j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r < 0) return j;
    }
    return weights.length - 1;
  };

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function laneKey(a, b) {
    return a + ">" + b;
  }
  function moveKey(inLane, outLane) {
    return inLane + "|" + outLane;
  }
  function removeFrom(arr, item) {
    var i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
  }
  function segDist(ax, az, bx, bz, cx, cz, dx, dz) {
    // min distance between segments AB and CD (approximate via endpoints +
    // a proper intersection test, good enough for conflict detection)
    function orient(px, pz, qx, qz, rx, rz) {
      return (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    }
    var o1 = orient(ax, az, bx, bz, cx, cz);
    var o2 = orient(ax, az, bx, bz, dx, dz);
    var o3 = orient(cx, cz, dx, dz, ax, az);
    var o4 = orient(cx, cz, dx, dz, bx, bz);
    if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
    function pointSeg(px, pz, sx, sz, ex, ez) {
      var vx = ex - sx,
        vz = ez - sz;
      var l2 = vx * vx + vz * vz;
      var t = l2 > 0 ? clamp(((px - sx) * vx + (pz - sz) * vz) / l2, 0, 1) : 0;
      var qx = sx + vx * t - px,
        qz = sz + vz * t - pz;
      return Math.sqrt(qx * qx + qz * qz);
    }
    return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
  }

  /* ------------------------------------------------------------------ */
  /* The map                                                             */
  /* ------------------------------------------------------------------ */

  var TOWNS = {
    maplewood: {
      id: "maplewood",
      name: "Maplewood",
      blurb: "A cosy woodland village of brick cottages and stop signs.",
      ctrl: "stop",
      cx: -32,
      cz: 0,
    },
    seabright: {
      id: "seabright",
      name: "Seabright",
      blurb: "A breezy seaside town of pastel houses and traffic lights.",
      ctrl: "signal",
      cx: 36,
      cz: 0,
    },
  };

  var GOODS = {
    bread: { id: "bread", name: "Bread", emoji: "🍞", town: "maplewood" },
    lumber: { id: "lumber", name: "Lumber", emoji: "🪵", town: "maplewood" },
    honey: { id: "honey", name: "Honey", emoji: "🍯", town: "maplewood" },
    fish: { id: "fish", name: "Fish", emoji: "🐟", town: "seabright" },
    icecream: { id: "icecream", name: "Ice Cream", emoji: "🍦", town: "seabright" },
    taffy: { id: "taffy", name: "Salt Taffy", emoji: "🍬", town: "seabright" },
  };

  // Map description: nodes (x, z, town) and undirected edges. Maplewood is a
  // 3x3 grid; Seabright is a back street, three cross streets and a curved
  // shore road; a country highway joins them.
  function mapSpec() {
    var nodes = [];
    var edges = [];
    function N(id, x, z, town) {
      nodes.push({ id: id, x: x, z: z, town: town });
    }
    function E(a, b, opts) {
      edges.push({ a: a, b: b, lots: opts && opts.lots, hwy: !!(opts && opts.hwy) });
    }
    var xs = [-44, -32, -20];
    var zs = [-12, 0, 12];
    for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) N("m" + c + r, xs[c], zs[r], "maplewood");
    for (c = 0; c < 3; c++)
      for (r = 0; r < 3; r++) {
        if (c < 2) E("m" + c + r, "m" + (c + 1) + r, { lots: "both" });
        if (r < 2) E("m" + c + r, "m" + c + (r + 1), { lots: "both" });
      }
    // Seabright
    N("s0", 22, -8, "seabright");
    N("s1", 36, -8, "seabright");
    N("s2", 50, -8, "seabright");
    N("s3", 22, 5, "seabright");
    N("a1", 28.5, 10, "seabright");
    N("s4", 36, 11.5, "seabright");
    N("a2", 43.5, 10, "seabright");
    N("s5", 50, 5, "seabright");
    E("s0", "s1", { lots: "both" });
    E("s1", "s2", { lots: "both" });
    E("s0", "s3", { lots: "both" });
    E("s1", "s4", { lots: "both2" });
    E("s2", "s5", { lots: "both" });
    // shore road: lots on the inland (north) side only
    E("s3", "a1", { lots: "inland" });
    E("a1", "s4", { lots: "none" });
    E("s4", "a2", { lots: "none" });
    E("a2", "s5", { lots: "inland" });
    // Highway
    N("h1", -8, 0, "hwy");
    N("h2", 2, -3.5, "hwy");
    N("h3", 12, -7, "hwy");
    E("m21", "h1", { hwy: true });
    E("h1", "h2", { hwy: true });
    E("h2", "h3", { hwy: true });
    E("h3", "s0", { hwy: true });
    return { nodes: nodes, edges: edges };
  }

  // Lot names / roles. Producers are claimed nearest to a target point so the
  // layout stays deterministic; everything else becomes a consumer or decor.
  var CONSUMERS = {
    maplewood: [
      ["Cottage", "🏡"],
      ["Tea Room", "🫖"],
      ["Bookshop", "📚"],
      ["Inn", "🛏️"],
      ["School", "🏫"],
      ["Toy Shop", "🧸"],
      ["Corner Store", "🏪"],
      ["Florist", "🌷"],
      ["Cottage", "🏡"],
      ["Carpenter", "🔨"],
      ["Library", "🏛️"],
      ["Cottage", "🏡"],
      ["Diner", "🍳"],
      ["Post Office", "📮"],
      ["Cottage", "🏡"],
      ["Clinic", "🩺"],
      ["Barber", "💈"],
      ["Cottage", "🏡"],
    ],
    seabright: [
      ["Beach House", "🏖️"],
      ["Surf Shop", "🏄"],
      ["Hotel", "🏨"],
      ["Café", "☕"],
      ["Aquarium", "🐠"],
      ["Beach House", "🏖️"],
      ["Chandlery", "⚓"],
      ["Boutique", "👒"],
      ["Arcade", "🕹️"],
      ["Beach House", "🏖️"],
      ["Bistro", "🍽️"],
      ["Market", "🧺"],
      ["Beach House", "🏖️"],
      ["Gift Shop", "🎁"],
    ],
  };

  var PRODUCERS = [
    { town: "maplewood", x: -38, z: -15.4, type: "bakery", name: "Bakery", good: "bread" },
    { town: "maplewood", x: -47.4, z: 6, type: "sawmill", name: "Sawmill", good: "lumber" },
    { town: "maplewood", x: -26, z: 15.4, type: "apiary", name: "Honey Farm", good: "honey" },
    { town: "seabright", x: 53.4, z: -1.5, type: "fishmarket", name: "Fish Market", good: "fish" },
    { town: "seabright", x: 27.3, z: 4.9, type: "icecream", name: "Ice Cream Parlour", good: "icecream" },
    { town: "seabright", x: 43, z: -11.4, type: "taffy", name: "Taffy Works", good: "taffy" },
  ];
  var SPECIALS = [
    { town: "maplewood", x: -16.6, z: 6, type: "hq", name: "Tiny Haulers HQ" },
    { town: "maplewood", x: -28.6, z: 6, type: "park", name: "Village Green" },
    { town: "maplewood", x: -38, z: 3.3, type: "park", name: "Orchard" },
    { town: "seabright", x: 39.3, z: -2.1, type: "park", name: "Plaza" },
  ];

  function buildMap() {
    var spec = mapSpec();
    var nodes = {};
    var lanes = {};
    var moves = {};
    spec.nodes.forEach(function (n) {
      nodes[n.id] = { id: n.id, x: n.x, z: n.z, town: n.town, nbrs: [], deg: 0, ctrl: null, inset: 0, reserved: [], occupants: [], waiting: [], moves: [], sig: null };
    });
    spec.edges.forEach(function (e) {
      nodes[e.a].nbrs.push(e.b);
      nodes[e.b].nbrs.push(e.a);
    });
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      n.deg = n.nbrs.length;
      if (n.deg >= 3) {
        n.inset = 1.85;
        var t = n.town === "hwy" ? null : TOWNS[n.town];
        n.ctrl = t ? t.ctrl : "stop";
      } else if (n.deg === 2) {
        var a = nodes[n.nbrs[0]],
          b = nodes[n.nbrs[1]];
        var ax = n.x - a.x,
          az = n.z - a.z,
          bx = b.x - n.x,
          bz = b.z - n.z;
        var ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
        n.inset = ang > 0.6 ? 1.5 : 0.7;
      } else n.inset = 1.0;
    });
    spec.edges.forEach(function (e) {
      [
        [e.a, e.b],
        [e.b, e.a],
      ].forEach(function (p) {
        var A = nodes[p[0]],
          B = nodes[p[1]];
        var dx = B.x - A.x,
          dz = B.z - A.z;
        var full = Math.sqrt(dx * dx + dz * dz);
        dx /= full;
        dz /= full;
        var nx = -dz,
          nz = dx; // right-hand normal (x east, z south)
        var town = e.hwy ? "hwy" : A.town === "hwy" ? B.town : A.town;
        var L = {
          key: laneKey(p[0], p[1]),
          a: p[0],
          b: p[1],
          town: town,
          hwy: e.hwy,
          dx: dx,
          dz: dz,
          nx: nx,
          nz: nz,
          full: full,
          sx: A.x + dx * A.inset + nx * C.LANE_OFF,
          sz: A.z + dz * A.inset + nz * C.LANE_OFF,
          len: full - A.inset - B.inset,
          vmax: e.hwy ? C.HWY_V : C.TOWN_V,
          vehicles: [],
          edge: e,
        };
        lanes[L.key] = L;
      });
    });
    // Moves through each node
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      n.nbrs.forEach(function (p) {
        var inL = lanes[laneKey(p, id)];
        n.nbrs.forEach(function (q) {
          if (q === p && n.deg > 1) return; // no U-turns except at dead ends
          var outL = lanes[laneKey(id, q)];
          var m = makeMove(n, inL, outL);
          moves[m.key] = m;
          n.moves.push(m);
        });
      });
      // conflicts: precomputed from geometry
      n.moves.forEach(function (m1) {
        n.moves.forEach(function (m2) {
          if (m1 === m2 || m1.inLane === m2.inLane) return;
          if (m1.outLane === m2.outLane || polyDist(m1.pts, m2.pts) < 1.0) m1.conflicts[m2.key] = true;
        });
      });
      if (n.ctrl === "signal") n.sig = { t: 0, phase: 0 };
    });
    var lots = buildLots(spec, nodes, lanes);
    return { nodes: nodes, lanes: lanes, moves: moves, lots: lots, edges: spec.edges };
  }

  function makeMove(n, inL, outL) {
    var p0x = inL.sx + inL.dx * inL.len,
      p0z = inL.sz + inL.dz * inL.len;
    var p2x = outL.sx,
      p2z = outL.sz;
    // control point: intersection of the two lane lines
    var cross = inL.dx * outL.dz - inL.dz * outL.dx;
    var p1x, p1z;
    if (Math.abs(cross) < 1e-3) {
      if (inL.dx * outL.dx + inL.dz * outL.dz < 0) {
        p1x = (p0x + p2x) / 2 + inL.dx * 2.2;
        p1z = (p0z + p2z) / 2 + inL.dz * 2.2;
      } else {
        p1x = (p0x + p2x) / 2;
        p1z = (p0z + p2z) / 2;
      }
    } else {
      var t = ((p2x - p0x) * outL.dz - (p2z - p0z) * outL.dx) / cross;
      p1x = p0x + inL.dx * t;
      p1z = p0z + inL.dz * t;
    }
    var pts = [];
    var cum = [0];
    var SEG = 10;
    for (var i = 0; i <= SEG; i++) {
      var u = i / SEG,
        w0 = (1 - u) * (1 - u),
        w1 = 2 * u * (1 - u),
        w2 = u * u;
      pts.push([w0 * p0x + w1 * p1x + w2 * p2x, w0 * p0z + w1 * p1z + w2 * p2z]);
      if (i > 0) {
        var ddx = pts[i][0] - pts[i - 1][0],
          ddz = pts[i][1] - pts[i - 1][1];
        cum.push(cum[i - 1] + Math.sqrt(ddx * ddx + ddz * ddz));
      }
    }
    var turn = Math.abs(Math.atan2(cross, inL.dx * outL.dx + inL.dz * outL.dz));
    return {
      key: moveKey(inL.key, outL.key),
      node: n.id,
      inLane: inL.key,
      outLane: outL.key,
      pts: pts,
      cum: cum,
      len: Math.max(0.05, cum[SEG]),
      turn: turn,
      sharp: turn > 0.7,
      // left turn when the cross product says so (x east, z south: cross>0 => right turn)
      dir: turn < 0.35 ? "straight" : cross > 0 ? "right" : "left",
      conflicts: {},
    };
  }

  function polyDist(a, b) {
    var best = Infinity;
    for (var i = 0; i < a.length - 1; i++)
      for (var j = 0; j < b.length - 1; j++) {
        var d = segDist(a[i][0], a[i][1], a[i + 1][0], a[i + 1][1], b[j][0], b[j][1], b[j + 1][0], b[j + 1][1]);
        if (d < best) best = d;
      }
    return best;
  }

  function buildLots(spec, nodes, lanes) {
    var lots = [];
    spec.edges.forEach(function (e) {
      if (!e.lots || e.lots === "none") return;
      var A = nodes[e.a],
        B = nodes[e.b];
      var fwd = lanes[laneKey(e.a, e.b)];
      var sides = [];
      if (e.lots === "both" || e.lots === "both2") sides = [1, -1];
      else if (e.lots === "inland") sides = [fwd.nz < 0 ? 1 : -1]; // the side facing north (z-)
      var per = e.lots === "both2" ? [0.3, 0.7] : [0.5];
      sides.forEach(function (side) {
        per.forEach(function (f) {
          var lane = side > 0 ? fwd : lanes[laneKey(e.b, e.a)];
          var mx = A.x + (B.x - A.x) * f,
            mz = A.z + (B.z - A.z) * f;
          // distance from the lane's start node to this point, minus that node's inset
          var startNode = nodes[lane.a];
          var dist = Math.sqrt((mx - startNode.x) * (mx - startNode.x) + (mz - startNode.z) * (mz - startNode.z));
          var s = clamp(dist - startNode.inset, 1.2, lane.len - 1.2);
          var off = 3.35;
          var bx = mx + lane.nx * off,
            bz = mz + lane.nz * off;
          lots.push({
            id: "L" + lots.length,
            town: A.town === "hwy" ? B.town : A.town,
            lane: lane.key,
            s: s,
            x: bx,
            z: bz,
            // building front faces the road: local +z -> -normal
            rot: Math.atan2(-lane.nx, -lane.nz),
            type: null,
            name: null,
            emoji: null,
            good: null,
            role: null,
          });
        });
      });
    });
    function claim(def, role) {
      var best = null,
        bd = Infinity;
      lots.forEach(function (l) {
        if (l.role || l.town !== def.town) return;
        var d = (l.x - def.x) * (l.x - def.x) + (l.z - def.z) * (l.z - def.z);
        if (d < bd) {
          bd = d;
          best = l;
        }
      });
      if (!best) return;
      best.role = role;
      best.type = def.type;
      best.name = def.name;
      if (def.good) {
        best.good = def.good;
        best.emoji = GOODS[def.good].emoji;
      }
    }
    PRODUCERS.forEach(function (p) {
      claim(p, "producer");
    });
    SPECIALS.forEach(function (p) {
      claim(p, p.type === "hq" ? "hq" : "decor");
      if (p.type === "hq") {
        var hq = lots.filter(function (l) {
          return l.role === "hq";
        })[0];
        if (hq) hq.emoji = "🚚";
      }
    });
    var counters = { maplewood: 0, seabright: 0 };
    lots.forEach(function (l) {
      if (l.role) return;
      var list = CONSUMERS[l.town];
      var c = list[counters[l.town]++ % list.length];
      l.role = "consumer";
      l.name = c[0];
      l.emoji = c[1];
      l.type = l.town === "maplewood" ? (c[0] === "Cottage" ? "cottage" : "shop") : c[0] === "Beach House" ? "beachhouse" : "boardwalk";
    });
    // Number duplicate names so job cards can tell them apart ("Cottage 2").
    var seen = {};
    lots.forEach(function (l) {
      var k = l.town + l.name;
      seen[k] = (seen[k] || 0) + 1;
    });
    var idx = {};
    lots.forEach(function (l) {
      var k = l.town + l.name;
      if (seen[k] > 1) {
        idx[k] = (idx[k] || 0) + 1;
        l.label = l.name + " " + idx[k];
      } else l.label = l.name;
    });
    return lots;
  }

  /* ------------------------------------------------------------------ */
  /* Routing                                                             */
  /* ------------------------------------------------------------------ */

  // Dijkstra over lanes (a lane -> the lanes it can turn into). Returns the
  // list of lane keys from `fromLane` (inclusive) to `toLane` (inclusive).
  // `ahead` true means the target is further along fromLane than we are, so
  // no search is needed. costFn(lane) gives the cost of driving a lane.
  function findRoute(map, fromLane, toLane, ahead, costFn) {
    if (fromLane === toLane && ahead) return [fromLane];
    var dist = {},
      prev = {},
      done = {};
    var open = [];
    var startLane = map.lanes[fromLane];
    function succ(lk) {
      var L = map.lanes[lk];
      var n = map.nodes[L.b];
      var out = [];
      for (var i = 0; i < n.moves.length; i++) if (n.moves[i].inLane === lk) out.push(n.moves[i]);
      return out;
    }
    succ(fromLane).forEach(function (m) {
      var c = costFn(map.lanes[m.outLane], m);
      if (dist[m.outLane] === undefined || c < dist[m.outLane]) {
        dist[m.outLane] = c;
        prev[m.outLane] = fromLane;
        open.push(m.outLane);
      }
    });
    void startLane;
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (done[cur]) continue;
      done[cur] = true;
      if (cur === toLane) break;
      succ(cur).forEach(function (m) {
        var nd = dist[cur] + costFn(map.lanes[m.outLane], m);
        if (!done[m.outLane] && (dist[m.outLane] === undefined || nd < dist[m.outLane])) {
          dist[m.outLane] = nd;
          prev[m.outLane] = cur;
          open.push(m.outLane);
        }
      });
    }
    if (dist[toLane] === undefined) return null;
    var path = [toLane];
    var k = toLane;
    var guard = 0;
    while (k !== fromLane || path.length === 1) {
      k = prev[k];
      if (k === undefined || ++guard > 500) return null;
      path.unshift(k);
      if (k === fromLane) break;
    }
    return path;
  }

  function staticCost(lane, move) {
    return lane.len + (move ? move.len : 0);
  }

  // Driving distance between two curb spots {lane, s}.
  function spotDistance(map, a, b) {
    var ahead = a.lane === b.lane && b.s >= a.s;
    if (ahead) return b.s - a.s;
    var r = findRoute(map, a.lane, b.lane, false, staticCost);
    if (!r) return Infinity;
    var d = map.lanes[a.lane].len - a.s;
    for (var i = 1; i < r.length; i++) {
      var m = map.moves[moveKey(r[i - 1], r[i])];
      d += m ? m.len : 0;
      d += i === r.length - 1 ? b.s : map.lanes[r[i]].len;
    }
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* Vehicles                                                            */
  /* ------------------------------------------------------------------ */

  var CAR_COLORS = ["#ff8a80", "#ffd166", "#7ed6c4", "#9fb8ff", "#c9a7ff", "#ffb4d6", "#a8e06b", "#ffa94d"];
  var TRUCK_COLORS = ["#2ec4b6", "#ff6b6b", "#f9c74f", "#577590", "#f3722c"];
  var TRUCK_NAMES = ["Pip", "Bramble", "Nugget", "Biscuit", "Tumble"];

  function Vehicle(id, kind, opts) {
    this.id = id;
    this.kind = kind;
    this.len = kind === "truck" ? C.TRUCK_LEN : C.CAR_LEN;
    this.v0f = opts.v0f || 1;
    this.color = opts.color;
    this.name = opts.name || null;
    this.home = opts.home || null;
    this.route = null;
    this.ri = 0;
    this.s = 0;
    this.v = 0;
    this.acc = 0;
    this.mode = "parked"; // parked | lane | transit
    this.move = null;
    this.tt = 0;
    this.granted = null; // node id we hold a grant for
    this.waitNode = null;
    this.stoppedAt = -1;
    this.arrivedAt = -1;
    this.spot = null; // current curb spot when parked
    this.target = null; // {lane, s, lotId}
    this.parkUntil = 0;
    this.lat = 1; // 1 = at the curb, 0 = in lane (visual)
    this.stuckT = 0;
    this.mergeWait = 0;
    this.emoteCD = 0;
    this.honkCD = 0;
    this.dist = 0; // odometer
    // trucks
    this.job = null;
    this.queue = [];
    this.task = null; // {phase:'pickup'|'deliver'|'idle', stopIdx}
    this.dwell = 0;
    this.cargo = null;
  }

  /* ------------------------------------------------------------------ */
  /* World                                                               */
  /* ------------------------------------------------------------------ */

  var SHARED_MAP = null;
  function getMap() {
    // The road geometry is immutable; its per-tick traffic state (lane
    // vehicle lists, reservations) is reset by World so a fresh map is not
    // rebuilt for every new game.
    if (!SHARED_MAP) SHARED_MAP = buildMap();
    return SHARED_MAP;
  }
  function resetTraffic(map) {
    Object.keys(map.lanes).forEach(function (k) {
      map.lanes[k].vehicles.length = 0;
    });
    Object.keys(map.nodes).forEach(function (k) {
      var n = map.nodes[k];
      n.reserved.length = 0;
      n.occupants.length = 0;
      n.waiting.length = 0;
      if (n.sig) {
        n.sig.t = 0;
        n.sig.phase = 0;
      }
    });
  }

  function World(opts) {
    opts = opts || {};
    this.map = getMap();
    resetTraffic(this.map);
    this.rng = new Rng(opts.seed || (Date.now() & 0x7fffffff));
    this.t = 0;
    this.money = C.START_MONEY;
    this.vehicles = [];
    this.trucks = [];
    this.board = [];
    this.boardRefill = [];
    this.nextId = 1;
    this.nextJobId = 1;
    this.events = [];
    this.stats = { delivered: 0, jobs: 0, earned: 0, fuel: 0, upkeep: 0, onTime: 0 };
    this.dayStats = { earned: 0, fuel: 0, jobs: 0 };
    this.lastDay = 1;
    this.lotById = {};
    var self = this;
    this.map.lots.forEach(function (l) {
      self.lotById[l.id] = l;
    });
    this.spotUse = {};
    if (opts.ambient !== false) this.spawnAmbient();
    if (!opts.empty) {
      this.addTruck();
      for (var i = 0; i < C.BOARD_SIZE; i++) this.board.push(this.genJob());
    }
  }

  World.prototype.emit = function (ev) {
    this.events.push(ev);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  };

  World.prototype.lotsOf = function (pred) {
    return this.map.lots.filter(pred);
  };

  World.prototype.lotSpot = function (lot) {
    return { lane: lot.lane, s: lot.s, lotId: lot.id };
  };

  World.prototype.hq = function () {
    return this.lotsOf(function (l) {
      return l.role === "hq";
    })[0];
  };

  World.prototype.day = function () {
    return Math.floor(this.t / C.DAY_LEN) + 1;
  };

  // 0..1 through the current day
  World.prototype.dayFrac = function () {
    return (this.t % C.DAY_LEN) / C.DAY_LEN;
  };

  World.prototype.clockText = function () {
    var mins = Math.floor(6 * 60 + this.dayFrac() * 16 * 60);
    var h = Math.floor(mins / 60),
      m = mins % 60;
    var ap = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + ap;
  };

  /* ---------- spawning ---------- */

  World.prototype.placeParked = function (v, spot) {
    v.mode = "parked";
    v.spot = spot;
    v.route = null;
    v.lat = 1;
    v.v = 0;
    this.useSpot(v, spot);
  };

  // Spots are shared: a second vehicle parking at the same lot stops a
  // car-length behind the first, so they never overlap.
  World.prototype.useSpot = function (v, spot) {
    var k = spot.lane;
    var list = this.spotUse[k] || (this.spotUse[k] = []);
    if (list.indexOf(v) < 0) list.push(v);
  };
  World.prototype.releaseSpot = function (v) {
    var k = v.spot && v.spot.lane;
    if (k && this.spotUse[k]) removeFrom(this.spotUse[k], v);
  };
  // Pick an s near `want` on lane that doesn't overlap other parked vehicles
  World.prototype.freeCurbS = function (lane, want, len, self) {
    var L = this.map.lanes[lane];
    var taken = (this.spotUse[lane] || []).filter(function (o) {
      return o !== self && o.mode === "parked" && o.spot;
    });
    var cands = [want];
    for (var k = 1; k <= 3; k++) cands.push(want - k * 2.4, want + k * 2.4);
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i];
      if (s < 0.9 || s > L.len - 0.9) continue;
      var ok = true;
      for (var j = 0; j < taken.length; j++) if (Math.abs(taken[j].spot.s - s) < (taken[j].len + len) / 2 + 0.25) ok = false;
      // also avoid vehicles heading to park nearby
      if (ok) return s;
    }
    return clamp(want, 0.9, L.len - 0.9);
  };

  World.prototype.spawnAmbient = function () {
    var self = this;
    var ci = 0;
    function spawnIn(town, n, travel) {
      var lots = self.lotsOf(function (l) {
        return l.town === town && l.role !== "decor";
      });
      for (var i = 0; i < n; i++) {
        var lot = lots[self.rng.int(lots.length)];
        var v = new Vehicle(self.nextId++, "car", { color: CAR_COLORS[ci++ % CAR_COLORS.length], home: town, v0f: self.rng.range(0.85, 1.12) });
        v.travel = travel;
        v.model = self.rng.int(3);
        var s = self.freeCurbS(lot.lane, lot.s, v.len, v);
        self.vehicles.push(v);
        self.placeParked(v, { lane: lot.lane, s: s, lotId: lot.id });
        v.parkUntil = self.rng.range(0.2, 4);
      }
    }
    spawnIn("maplewood", C.AMBIENT.maplewood, false);
    spawnIn("seabright", C.AMBIENT.seabright, false);
    for (var i = 0; i < C.AMBIENT.travel; i++) spawnIn(i % 2 ? "seabright" : "maplewood", 1, true);
  };

  World.prototype.truckCost = function () {
    var n = this.trucks.length;
    if (n >= C.MAX_TRUCKS) return null;
    return C.TRUCK_COSTS[Math.max(0, n - 1)];
  };

  World.prototype.addTruck = function (spot) {
    var i = this.trucks.length;
    var v = new Vehicle(this.nextId++, "truck", { color: TRUCK_COLORS[i % TRUCK_COLORS.length], name: TRUCK_NAMES[i % TRUCK_NAMES.length], v0f: 1 });
    v.task = { phase: "idle" };
    v.truckIndex = i;
    var hq = this.hq();
    var sp = spot || this.lotSpot(hq);
    var s = this.freeCurbS(sp.lane, sp.s, v.len, v);
    this.vehicles.push(v);
    this.trucks.push(v);
    this.placeParked(v, { lane: sp.lane, s: s, lotId: sp.lotId });
    return v;
  };

  World.prototype.buyTruck = function () {
    var cost = this.truckCost();
    if (cost === null) return { ok: false, reason: "Fleet is full" };
    if (this.money < cost) return { ok: false, reason: "Not enough money" };
    this.money -= cost;
    var t = this.addTruck();
    this.emit({ type: "toast", text: t.name + " joined the fleet!" });
    return { ok: true, truck: t };
  };

  /* ---------- jobs ---------- */

  World.prototype.genJob = function () {
    var rng = this.rng;
    var map = this.map;
    // Balance the board: lean toward the town that has fewer jobs listed
    var counts = { maplewood: 0, seabright: 0 };
    this.board.forEach(function (j) {
      if (j) counts[j.town]++;
    });
    var town = counts.maplewood > counts.seabright + 1 ? "seabright" : counts.seabright > counts.maplewood + 1 ? "maplewood" : rng.next() < 0.5 ? "maplewood" : "seabright";
    var producers = this.lotsOf(function (l) {
      return l.role === "producer" && l.town === town;
    });
    var from = rng.pick(producers);
    var n = 1 + rng.weighted([34, 30, 22, 14]);
    var cross = rng.next() < 0.4;
    var destTown = cross ? (town === "maplewood" ? "seabright" : "maplewood") : town;
    var pool = this.lotsOf(function (l) {
      return l.role === "consumer" && l.town === destTown;
    });
    var picks = [];
    while (picks.length < n && pool.length) picks.push(pool.splice(rng.int(pool.length), 1)[0]);
    // order the stops greedily: nearest next from where the truck is
    var cur = this.lotSpot(from);
    var ordered = [];
    var dist = 0;
    var self = this;
    while (picks.length) {
      var bi = 0,
        bd = Infinity;
      for (var i = 0; i < picks.length; i++) {
        var d = spotDistance(map, cur, self.lotSpot(picks[i]));
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      dist += bd;
      cur = this.lotSpot(picks[bi]);
      ordered.push(picks.splice(bi, 1)[0]);
    }
    var good = GOODS[from.good];
    var pay = jobPay(n, dist, cross);
    var est = dist / C.AVG_SPEED + C.LOAD_TIME + C.UNLOAD_TIME * n;
    var life = rng.range(C.JOB_LIFE_MIN, C.JOB_LIFE_MAX);
    return {
      id: this.nextJobId++,
      good: good.id,
      town: town,
      destTown: destTown,
      cross: cross,
      from: from.id,
      stops: ordered.map(function (l) {
        return l.id;
      }),
      dist: Math.round(dist),
      pay: pay,
      bonus: Math.round(pay * C.BONUS_FRAC),
      // Measured from pickup (accepting the job doesn't start the clock: a
      // truck may be across the map, or busy), so it rates the route itself.
      deadline: Math.round(est * 1.25 + 8),
      posted: this.t,
      expires: this.t + life,
    };
  };

  // More stops pay more than linearly, and the long haul between towns pays
  // per unit of distance on top.
  function jobPay(n, dist, cross) {
    return Math.round(10 + dist * 0.45 + 16 * n + 7 * n * (n - 1) + (cross ? 25 : 0));
  }

  World.prototype.jobById = function (id) {
    for (var i = 0; i < this.board.length; i++) if (this.board[i] && this.board[i].id === id) return this.board[i];
    return null;
  };

  World.prototype.truckById = function (id) {
    for (var i = 0; i < this.trucks.length; i++) if (this.trucks[i].id === id) return this.trucks[i];
    return null;
  };

  // Accept a job from the board for a truck. If the truck is busy the job is
  // queued (up to QUEUE_MAX deep).
  World.prototype.acceptJob = function (jobId, truckId) {
    var job = this.jobById(jobId);
    var truck = this.truckById(truckId);
    if (!job) return { ok: false, reason: "That job is gone" };
    if (!truck) return { ok: false, reason: "No such truck" };
    var busy = !!truck.job;
    if (busy && truck.queue.length >= C.QUEUE_MAX) return { ok: false, reason: truck.name + "'s queue is full" };
    var i = this.board.indexOf(job);
    this.board[i] = null;
    this.boardRefill.push({ slot: i, at: this.t + C.BOARD_REFILL });
    job.accepted = this.t;
    if (busy) truck.queue.push(job);
    else this.startJob(truck, job);
    this.emit({ type: "accept", truck: truck.id, job: job.id });
    return { ok: true, queued: busy };
  };

  World.prototype.startJob = function (truck, job) {
    truck.job = job;
    truck.task = { phase: "pickup", stopIdx: 0, started: -1 };
    truck.cargo = null;
    this.sendTo(truck, this.lotSpot(this.lotById[job.from]));
  };

  World.prototype.cancelQueued = function (truckId, jobId) {
    var t = this.truckById(truckId);
    if (!t) return false;
    for (var i = 0; i < t.queue.length; i++)
      if (t.queue[i].id === jobId) {
        t.queue.splice(i, 1);
        return true;
      }
    return false;
  };

  // Where a truck currently is heading (lot), for the UI
  World.prototype.truckTargetLot = function (t) {
    if (!t.job) return null;
    if (t.task.phase === "pickup" || t.task.phase === "loading") return this.lotById[t.job.from];
    return this.lotById[t.job.stops[Math.min(t.task.stopIdx, t.job.stops.length - 1)]];
  };

  World.prototype.truckStatus = function (t) {
    if (!t.job) return "Idle";
    var tgt = this.truckTargetLot(t);
    var where = tgt ? tgt.label : "";
    switch (t.task.phase) {
      case "pickup":
        return t.waitNode ? "Waiting at " + (this.map.nodes[t.waitNode].ctrl === "signal" ? "a light" : "a stop sign") : "Heading to " + where;
      case "loading":
        return "Loading " + GOODS[t.job.good].name.toLowerCase() + "…";
      case "deliver":
        if (t.mode === "parked" && t.mergeWait > 0.8) return "Waiting to pull out";
        if (t.waitNode) return "Waiting at " + (this.map.nodes[t.waitNode].ctrl === "signal" ? "a light" : "a stop sign");
        return "Stop " + (t.task.stopIdx + 1) + "/" + t.job.stops.length + ": " + where;
      case "unloading":
        return "Unloading at " + where;
    }
    return "";
  };

  /* ---------- driving errands ---------- */

  World.prototype.sendTo = function (v, spot) {
    // aim for a free stretch of curb near the lot so arrivals don't jump
    var s = this.freeCurbS(spot.lane, spot.s, v.len, v);
    v.target = { lane: spot.lane, s: s, lotId: spot.lotId };
  };

  World.prototype.laneCost = function (lane, move) {
    var n = this.map.nodes[lane.b];
    var c = lane.len / lane.vmax + (move ? move.len / C.TOWN_V : 0);
    // congestion: queued vehicles and stops make a lane look slower, so
    // drivers reroute around jams and long queues
    var q = 0;
    for (var i = 0; i < lane.vehicles.length; i++) if (lane.vehicles[i].v < 0.6) q++;
    c += q * 1.6 + lane.vehicles.length * 0.4;
    if (n.ctrl === "stop") c += 1.0 + n.waiting.length * 0.9;
    else if (n.ctrl === "signal") c += 2.0;
    if (move && move.sharp) c += 0.5;
    return c;
  };

  World.prototype.plan = function (v, fromLane, fromS) {
    var self = this;
    var tgt = v.target;
    var ahead = fromLane === tgt.lane && tgt.s > fromS + 0.4;
    var r = findRoute(this.map, fromLane, tgt.lane, ahead, function (lane, move) {
      return self.laneCost(lane, move);
    });
    return r;
  };

  // Pull out from the curb if there's a safe gap.
  World.prototype.tryDepart = function (v) {
    var spot = v.spot;
    var lane = this.map.lanes[spot.lane];
    // already at the target? (e.g. a new job at the same lot)
    var route = this.plan(v, spot.lane, spot.s);
    if (!route) return false;
    for (var i = 0; i < lane.vehicles.length; i++) {
      var o = lane.vehicles[i];
      var gap = o.s - spot.s;
      if (gap > 0 && gap < (o.len + v.len) / 2 + 0.7) return false; // someone right in front
      if (gap <= 0 && -gap < o.v * 1.6 + (o.len + v.len) / 2 + 1.2) return false; // someone coming
    }
    // vehicles about to come off the upstream node into this lane
    if (spot.s < 6) {
      var up = this.map.nodes[lane.a];
      var all = up.reserved.concat(up.occupants);
      for (var j = 0; j < all.length; j++) {
        var mv = all[j].move || this.moveFor(all[j]);
        if (mv && mv.outLane === lane.key) return false;
      }
    }
    this.releaseSpot(v);
    v.mode = "lane";
    v.route = route;
    v.ri = 0;
    v.s = spot.s;
    v.v = 0;
    v.spot = null;
    lane.vehicles.push(v);
    v.mergeWait = 0;
    return true;
  };

  World.prototype.moveFor = function (v) {
    if (!v.route || v.ri >= v.route.length - 1) return null;
    return this.map.moves[moveKey(v.route[v.ri], v.route[v.ri + 1])];
  };

  /* ---------- traffic step ---------- */

  // Nearest obstacle ahead along a vehicle's route: another vehicle, a stop
  // line it has no grant for, or the curb spot it is stopping at.
  World.prototype.lookAhead = function (v) {
    var map = this.map;
    var acc = 0;
    var ri = v.ri;
    var seg = v.mode;
    var pos = v.mode === "lane" ? v.s : v.tt;
    var half = v.len / 2;
    var vlim = Infinity;
    for (var iter = 0; iter < 10 && acc < C.LOOK; iter++) {
      if (seg === "lane") {
        var lane = map.lanes[v.route[ri]];
        var best = null;
        for (var i = 0; i < lane.vehicles.length; i++) {
          var o = lane.vehicles[i];
          if (o === v || o.s <= pos) continue;
          var g = acc + o.s - pos - (o.len / 2 + half);
          if (!best || g < best.gap) best = { gap: g, vl: o.v, veh: o };
        }
        if (ri === v.route.length - 1) {
          var tg = { gap: acc + (v.target.s - pos) + C.S0, vl: 0, target: true };
          if (!best || tg.gap < best.gap) best = tg;
        }
        if (best) {
          best.vlim = vlim;
          return best;
        }
        var node = map.nodes[lane.b];
        if (node.ctrl && !(ri === v.ri && v.granted === node.id)) {
          return { gap: acc + lane.len - pos - half - 0.1, vl: 0, line: node.id, vlim: vlim };
        }
        var mv = map.moves[moveKey(v.route[ri], v.route[ri + 1])];
        if (mv && mv.sharp) {
          var dTurn = Math.max(0, acc + lane.len - pos - half * 0.5);
          vlim = Math.min(vlim, Math.sqrt(C.TURN_V * C.TURN_V + 2 * 1.6 * dTurn));
        }
        acc += lane.len - pos;
        pos = 0;
        seg = "transit";
      } else {
        var m = map.moves[moveKey(v.route[ri], v.route[ri + 1])];
        if (!m) break;
        if (m.sharp && ri === v.ri && v.mode === "transit") vlim = Math.min(vlim, C.TURN_V);
        var nd = map.nodes[m.node];
        var bestT = null;
        for (var k = 0; k < nd.occupants.length; k++) {
          var oc = nd.occupants[k];
          if (oc === v || oc.move !== m || oc.tt <= pos) continue;
          var gt = acc + oc.tt - pos - (oc.len / 2 + half);
          if (!bestT || gt < bestT.gap) bestT = { gap: gt, vl: oc.v, veh: oc };
        }
        if (bestT) {
          bestT.vlim = vlim;
          return bestT;
        }
        acc += m.len - pos;
        pos = 0;
        ri++;
        seg = "lane";
      }
    }
    return { gap: Infinity, vl: 0, vlim: vlim };
  };

  World.prototype.stepSignals = function (dt) {
    var cycle = [C.SIG_GREEN, C.SIG_YELLOW, C.SIG_RED, C.SIG_GREEN, C.SIG_YELLOW, C.SIG_RED];
    var nodes = this.map.nodes;
    for (var id in nodes) {
      var n = nodes[id];
      if (!n.sig) continue;
      n.sig.t += dt;
      // Actuated: a green with nobody coming ends early when someone is
      // waiting at red, so a quiet side street doesn't hold up the town.
      if ((n.sig.phase === 0 || n.sig.phase === 3) && n.sig.t > C.SIG_MIN_GREEN) {
        var greenAx = n.sig.phase === 0 ? 0 : 1;
        var demandGreen = false,
          demandRed = false;
        for (var i = 0; i < n.nbrs.length; i++) {
          var L = this.map.lanes[laneKey(n.nbrs[i], n.id)];
          var near = false;
          for (var j = 0; j < L.vehicles.length; j++) if (L.len - L.vehicles[j].s < 14) near = true;
          if (!near) continue;
          if (axisOf(L) === greenAx) demandGreen = true;
          else demandRed = true;
        }
        if (demandRed && !demandGreen) {
          n.sig.phase += 1;
          n.sig.t = 0;
        }
      }
      while (n.sig.t >= cycle[n.sig.phase]) {
        n.sig.t -= cycle[n.sig.phase];
        n.sig.phase = (n.sig.phase + 1) % 6;
      }
    }
  };

  // Which axis an incoming lane belongs to (0: east-west, 1: north-south)
  function axisOf(lane) {
    return Math.abs(lane.dx) >= Math.abs(lane.dz) ? 0 : 1;
  }
  // Signal colour for an approach: "green" | "yellow" | "red"
  function signalFor(node, lane) {
    var ax = axisOf(lane);
    var ph = node.sig.phase;
    if (ph === 0) return ax === 0 ? "green" : "red";
    if (ph === 1) return ax === 0 ? "yellow" : "red";
    if (ph === 3) return ax === 1 ? "green" : "red";
    if (ph === 4) return ax === 1 ? "yellow" : "red";
    return "red";
  }

  World.prototype.exitRoom = function (v, move) {
    // free distance at the start of the lane the move leads into
    var out = this.map.lanes[move.outLane];
    var free = out.len;
    for (var i = 0; i < out.vehicles.length; i++) {
      var o = out.vehicles[i];
      free = Math.min(free, o.s - o.len / 2);
    }
    // vehicles already granted into the same lane take room too
    var n = this.map.nodes[move.node];
    var all = n.reserved;
    for (var j = 0; j < all.length; j++) {
      var om = all[j].move || this.moveFor(all[j]);
      if (om && om.outLane === out.key && all[j] !== v) free -= all[j].len + 0.4;
    }
    // A short lane that ends in its target or a free-flowing corner is fine
    // as long as the vehicle fits.
    return free >= v.len + 0.5 || (out.vehicles.length === 0 && free >= v.len * 0.8);
  };

  World.prototype.conflictsWithReserved = function (node, move, self) {
    for (var i = 0; i < node.reserved.length; i++) {
      var o = node.reserved[i];
      if (o === self) continue;
      var om = o.mode === "transit" ? o.move : this.moveFor(o);
      if (!om) continue;
      if (om === move) {
        // same move: fine once the other one is clear of the entry
        if (o.mode === "transit" && o.tt > o.len + 0.3) continue;
        return true;
      }
      if (move.conflicts[om.key]) return true;
    }
    return false;
  };

  World.prototype.stepIntersections = function () {
    var map = this.map;
    for (var id in map.nodes) {
      var n = map.nodes[id];
      if (!n.ctrl || !n.waiting.length) continue;
      // first come, first served
      n.waiting.sort(function (a, b) {
        return a.since - b.since;
      });
      var blocked = [];
      for (var i = 0; i < n.waiting.length; i++) {
        var w = n.waiting[i];
        var v = w.v;
        if (v.granted === n.id) continue;
        var move = this.moveFor(v);
        if (!move) continue;
        var lane = map.lanes[move.inLane];
        var toLine = lane.len - v.s - v.len / 2;
        var eligible = false;
        if (n.ctrl === "stop") {
          eligible = v.stoppedAt >= 0 && this.t - v.stoppedAt >= C.STOP_DWELL && toLine < 0.9;
        } else {
          var col = signalFor(n, lane);
          var brake = (v.v * v.v) / (2 * C.B_COMF);
          eligible = (col === "green" && toLine < brake + 2.5) || (col === "yellow" && toLine < 0.6 && v.v > 1.2);
        }
        var waitedLong = this.t - w.since > 6;
        var fifoBlocked = false;
        if (n.ctrl === "stop" && !waitedLong) {
          for (var b = 0; b < blocked.length; b++) if (blocked[b] === move || move.conflicts[blocked[b].key]) fifoBlocked = true;
        }
        if (eligible && !fifoBlocked && !this.conflictsWithReserved(n, move, v) && this.exitRoom(v, move)) {
          v.granted = n.id;
          n.reserved.push(v);
          // someone else was waiting their turn: a friendly wave
          if (n.ctrl === "stop" && n.waiting.length > 1 && this.rng.next() < 0.35) {
            var other = n.waiting[(i + 1) % n.waiting.length].v;
            if (other !== v && other.emoteCD <= 0) {
              this.emit({ type: "emote", vid: other.id, kind: "wave" });
              other.emoteCD = 5;
            }
          }
        } else if (n.ctrl === "stop" && v.stoppedAt >= 0) blocked.push(move);
      }
    }
  };

  World.prototype.stepVehicle = function (v, dt) {
    var map = this.map;
    v.emoteCD -= dt;
    v.honkCD -= dt;
    if (v.mode === "parked") {
      v.lat = Math.min(1, v.lat + dt * 1.6);
      return;
    }
    v.lat = Math.max(0, v.lat - dt * 1.4);
    var lane = v.mode === "lane" ? map.lanes[v.route[v.ri]] : null;
    var la = this.lookAhead(v);
    var vmaxLane = v.mode === "lane" ? lane.vmax : map.lanes[v.move.outLane].vmax;
    var v0 = Math.min(vmaxLane * v.v0f, la.vlim);
    // pulling out from the curb: a gentle start
    if (v.lat > 0.3) v0 = Math.min(v0, 1.4);
    var free = 1 - Math.pow(v.v / Math.max(0.1, v0), 4);
    var inter = 0;
    if (isFinite(la.gap)) {
      var sStar = C.S0 + Math.max(0, v.v * C.T_HEAD + (v.v * (v.v - la.vl)) / (2 * Math.sqrt(C.A_MAX * C.B_COMF)));
      inter = Math.pow(sStar / Math.max(la.gap, 0.05), 2);
    }
    var a = C.A_MAX * (free - inter);
    a = clamp(a, -9, C.A_MAX);
    v.acc = a;
    v.v = Math.max(0, v.v + a * dt);
    var ds = v.v * dt;
    if (isFinite(la.gap)) ds = Math.min(ds, Math.max(0, la.gap - (la.target ? C.S0 : 0.02)));
    if (ds < v.v * dt * 0.5) v.v = ds / dt; // a hard clamp also kills the speed
    // hard braking is worth a little "!"
    if (a < -4.5 && v.emoteCD <= 0 && v.v > 1) {
      this.emit({ type: "emote", vid: v.id, kind: "brake" });
      v.emoteCD = 4;
    }
    v.dist += ds;
    if (v.kind === "truck") {
      var cost = ds * C.FUEL;
      this.money -= cost;
      this.stats.fuel += cost;
      this.dayStats.fuel += cost;
    }

    if (v.mode === "lane") {
      v.s += ds;
      // waiting bookkeeping at controlled nodes
      var node = map.nodes[lane.b];
      var last = v.ri === v.route.length - 1;
      if (!last && node.ctrl && v.granted !== node.id) {
        var toLine = lane.len - v.s - v.len / 2;
        if (toLine < 4.5 && v.waitNode !== node.id) {
          // only the front vehicle of the lane queues at the node
          var front = true;
          for (var i = 0; i < lane.vehicles.length; i++) if (lane.vehicles[i] !== v && lane.vehicles[i].s > v.s) front = false;
          if (front) {
            v.waitNode = node.id;
            node.waiting.push({ v: v, since: this.t });
          }
        }
        if (v.waitNode === node.id && v.v < 0.12 && toLine < 0.9) {
          if (v.stoppedAt < 0) v.stoppedAt = this.t;
        }
      }
      // reached the curb spot?
      if (last && v.s >= v.target.s - 0.25 && v.v < 0.5) {
        this.arrive(v);
        return;
      }
      if (v.s >= lane.len) {
        if (last) {
          v.s = lane.len - 0.01;
          this.arrive(v);
          return;
        }
        if (node.ctrl && v.granted !== node.id) {
          v.s = lane.len;
          v.v = 0;
        } else {
          var mv = this.moveFor(v);
          var left = v.s - lane.len;
          removeFrom(lane.vehicles, v);
          if (v.waitNode) this.clearWait(v);
          v.mode = "transit";
          v.move = mv;
          v.tt = left;
          node.occupants.push(v);
          if (!node.ctrl) {
            // uncontrolled corners: nothing to reserve
          }
        }
      }
    } else {
      v.tt += ds;
      if (v.tt >= v.move.len) {
        var left2 = v.tt - v.move.len;
        var n2 = map.nodes[v.move.node];
        removeFrom(n2.occupants, v);
        removeFrom(n2.reserved, v);
        if (v.granted === n2.id) v.granted = null;
        v.stoppedAt = -1;
        v.ri++;
        v.mode = "lane";
        v.move = null;
        var nl = map.lanes[v.route[v.ri]];
        nl.vehicles.push(v);
        v.s = Math.min(left2, nl.len);
        // re-plan at every lane: congestion may have changed
        var r = this.plan(v, nl.key, v.s);
        if (r) v.route = v.route.slice(0, v.ri).concat(r);
      }
    }
    // stuck behind someone for ages: honk
    if (v.v < 0.05) v.stuckT += dt;
    else v.stuckT = 0;
    if (v.stuckT > 4 && v.honkCD <= 0 && la.veh && !la.line) {
      if (this.rng.next() < 0.5) this.emit({ type: "emote", vid: v.id, kind: "honk" });
      v.honkCD = 7 + this.rng.next() * 5;
    }
  };

  World.prototype.clearWait = function (v) {
    var n = this.map.nodes[v.waitNode];
    if (n) {
      for (var i = n.waiting.length - 1; i >= 0; i--) if (n.waiting[i].v === v) n.waiting.splice(i, 1);
    }
    v.waitNode = null;
  };

  World.prototype.arrive = function (v) {
    var lane = this.map.lanes[v.route[v.ri]];
    removeFrom(lane.vehicles, v);
    if (v.waitNode) this.clearWait(v);
    var s = this.freeCurbS(lane.key, v.s, v.len, v);
    this.placeParked(v, { lane: lane.key, s: s, lotId: v.target && v.target.lotId });
    v.lat = 0; // animate pulling over
    v.target = null;
    if (v.kind === "truck") this.truckArrived(v);
    else v.parkUntil = this.t + this.rng.range(2.5, 7);
  };

  World.prototype.truckArrived = function (t) {
    if (!t.job) return;
    if (t.task.phase === "pickup") {
      t.task.phase = "loading";
      t.dwell = C.LOAD_TIME;
      this.emit({ type: "emote", vid: t.id, kind: "load", emoji: GOODS[t.job.good].emoji });
    } else if (t.task.phase === "deliver") {
      t.task.phase = "unloading";
      t.dwell = C.UNLOAD_TIME;
    }
  };

  World.prototype.stepTruckTasks = function (t, dt) {
    if (!t.job) {
      if (t.queue.length) this.startJob(t, t.queue.shift());
      return;
    }
    var job = t.job;
    if (t.task.phase === "loading" || t.task.phase === "unloading") {
      t.dwell -= dt;
      if (t.dwell > 0) return;
      if (t.task.phase === "loading") {
        t.cargo = job.good;
        t.task.started = this.t;
        t.task.phase = "deliver";
        t.task.stopIdx = 0;
        this.sendTo(t, this.lotSpot(this.lotById[job.stops[0]]));
      } else {
        // paid per stop; the on-time bonus lands with the last drop
        var lot = this.lotById[job.stops[t.task.stopIdx]];
        var share = Math.round(job.pay / job.stops.length);
        if (t.task.stopIdx === job.stops.length - 1) share = job.pay - share * (job.stops.length - 1);
        var lastStop = t.task.stopIdx === job.stops.length - 1;
        var bonus = 0;
        var onTime = this.t - t.task.started <= job.deadline;
        if (lastStop && onTime) bonus = job.bonus;
        this.earn(share + bonus);
        this.stats.delivered++;
        this.emit({ type: "pay", vid: t.id, amount: share + bonus, x: lot.x, z: lot.z, bonus: bonus > 0 });
        t.task.stopIdx++;
        if (lastStop) {
          this.stats.jobs++;
          this.dayStats.jobs++;
          if (onTime) this.stats.onTime++;
          this.emit({ type: "jobDone", truck: t.id, job: job.id, onTime: onTime, total: job.pay + bonus });
          t.job = null;
          t.cargo = null;
          t.task = { phase: "idle" };
          if (t.queue.length) this.startJob(t, t.queue.shift());
        } else {
          t.task.phase = "deliver";
          this.sendTo(t, this.lotSpot(this.lotById[job.stops[t.task.stopIdx]]));
        }
      }
    }
  };

  World.prototype.earn = function (amt) {
    this.money += amt;
    this.stats.earned += amt;
    this.dayStats.earned += amt;
  };

  World.prototype.stepParked = function (v, dt) {
    if (v.mode !== "parked") return;
    var wantsToGo = false;
    if (v.kind === "truck") {
      wantsToGo = !!v.target && v.task && (v.task.phase === "pickup" || v.task.phase === "deliver");
    } else if (this.t >= v.parkUntil) {
      if (!v.target) {
        var town = v.home;
        if (this.rng.next() < (v.travel ? 0.55 : 0.08)) town = town === "maplewood" ? "seabright" : "maplewood";
        if (v.travel) v.home = town;
        var cur = v.spot.lotId;
        var lots = this.lotsOf(function (l) {
          return l.town === town && l.role !== "decor" && l.id !== cur;
        });
        this.sendTo(v, this.lotSpot(this.rng.pick(lots)));
      }
      wantsToGo = true;
    }
    if (!wantsToGo) return;
    // the target is this very spot (same lot): done already
    if (v.target && v.target.lane === v.spot.lane && Math.abs(v.target.s - v.spot.s) < 2.5) {
      v.target = null;
      if (v.kind === "truck") this.truckArrived(v);
      else v.parkUntil = this.t + 2;
      return;
    }
    if (v.lat < 0.95) return; // still pulling in
    if (this.tryDepart(v)) return;
    v.mergeWait += dt;
    if (v.mergeWait > 2.5 && v.emoteCD <= 0) {
      this.emit({ type: "emote", vid: v.id, kind: "wait" });
      v.emoteCD = 6;
    }
  };

  World.prototype.stepEconomy = function () {
    // board refills and expiries
    for (var i = this.boardRefill.length - 1; i >= 0; i--) {
      var r = this.boardRefill[i];
      if (this.t >= r.at) {
        if (!this.board[r.slot]) this.board[r.slot] = this.genJob();
        this.boardRefill.splice(i, 1);
      }
    }
    for (var j = 0; j < this.board.length; j++) {
      var job = this.board[j];
      if (job && this.t >= job.expires) {
        this.board[j] = null;
        this.boardRefill.push({ slot: j, at: this.t + 1 });
      }
    }
    var d = this.day();
    if (d !== this.lastDay) {
      var upkeep = C.UPKEEP * this.trucks.length;
      this.money -= upkeep;
      this.stats.upkeep += upkeep;
      this.emit({ type: "dayEnd", day: this.lastDay, earned: Math.round(this.dayStats.earned), fuel: Math.round(this.dayStats.fuel), upkeep: upkeep, jobs: this.dayStats.jobs });
      this.dayStats = { earned: 0, fuel: 0, jobs: 0 };
      this.lastDay = d;
    }
  };

  World.prototype.step = function (dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.stepSignals(dt);
    this.stepIntersections();
    var vs = this.vehicles;
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].mode === "parked") this.stepParked(vs[i], dt);
    }
    for (var j = 0; j < vs.length; j++) {
      if (vs[j].mode !== "parked") this.stepVehicle(vs[j], dt);
      else vs[j].lat = Math.min(1, vs[j].lat + dt * 1.6);
    }
    for (var k = 0; k < this.trucks.length; k++) this.stepTruckTasks(this.trucks[k], dt);
    this.stepEconomy();
  };

  /* ---------- poses for the renderer ---------- */

  World.prototype.pose = function (v) {
    var map = this.map;
    var x, z, hx, hz;
    if (v.mode === "transit") {
      var m = v.move;
      var t = clamp(v.tt, 0, m.len);
      var i = 1;
      while (i < m.cum.length - 1 && m.cum[i] < t) i++;
      var a = m.pts[i - 1],
        b = m.pts[i];
      var seg = m.cum[i] - m.cum[i - 1] || 1;
      var u = (t - m.cum[i - 1]) / seg;
      x = a[0] + (b[0] - a[0]) * u;
      z = a[1] + (b[1] - a[1]) * u;
      hx = b[0] - a[0];
      hz = b[1] - a[1];
    } else {
      var L = map.lanes[v.mode === "parked" ? v.spot.lane : v.route[v.ri]];
      var s = v.mode === "parked" ? v.spot.s : v.s;
      // ease in/out of the curb
      var e = v.lat * v.lat * (3 - 2 * v.lat) * C.CURB_OFF;
      x = L.sx + L.dx * s + L.nx * e;
      z = L.sz + L.dz * s + L.nz * e;
      hx = L.dx;
      hz = L.dz;
      // a little steering angle while pulling in or out
      if (v.lat > 0.02 && v.lat < 0.98) {
        var steer = v.mode === "parked" ? 0.35 : -0.35;
        hx = L.dx + L.nx * steer;
        hz = L.dz + L.nz * steer;
      }
    }
    return { x: x, z: z, heading: Math.atan2(hx, hz) };
  };

  // Remaining route as a polyline (for drawing a truck's path)
  World.prototype.routePolyline = function (v) {
    var map = this.map;
    var pts = [];
    if (!v.route || v.mode === "parked") return pts;
    var p = this.pose(v);
    pts.push([p.x, p.z]);
    for (var i = v.ri; i < v.route.length; i++) {
      var L = map.lanes[v.route[i]];
      var last = i === v.route.length - 1;
      if (!(i === v.ri && v.mode === "transit")) {
        var endS = last ? v.target.s : L.len;
        pts.push([L.sx + L.dx * endS, L.sz + L.dz * endS]);
      }
      if (!last) {
        var m = map.moves[moveKey(v.route[i], v.route[i + 1])];
        if (m)
          for (var k = 1; k < m.pts.length; k++) {
            if (i === v.ri && v.mode === "transit" && m.cum[k] < v.tt) continue;
            pts.push(m.pts[k]);
          }
      }
    }
    return pts;
  };

  /* ---------- save / load ---------- */

  World.prototype.serialize = function () {
    var self = this;
    function vehSpot(v) {
      if (v.mode === "parked") return { lane: v.spot.lane, s: v.spot.s, lotId: v.spot.lotId || null };
      if (v.mode === "lane") return { lane: v.route[v.ri], s: v.s, lotId: null };
      // in an intersection: snap to the start of the lane it is turning into
      return { lane: v.move.outLane, s: 0.5, lotId: null };
    }
    return {
      v: 1,
      t: this.t,
      money: this.money,
      rng: this.rng.state,
      nextJobId: this.nextJobId,
      stats: this.stats,
      dayStats: this.dayStats,
      lastDay: this.lastDay,
      board: this.board,
      boardRefill: this.boardRefill.map(function (r) {
        return { slot: r.slot, at: r.at };
      }),
      trucks: this.trucks.map(function (t) {
        return {
          name: t.name,
          color: t.color,
          spot: vehSpot(t),
          job: t.job,
          task: t.task,
          dwell: t.dwell,
          cargo: t.cargo,
          queue: t.queue,
          dist: t.dist,
          target: t.target,
        };
      }),
      savedAt: Date.now(),
      summary: {
        day: this.day(),
        money: Math.floor(this.money),
        trucks: this.trucks.length,
        jobs: this.stats.jobs,
        clock: this.clockText(),
      },
      _ver: self && 1,
    };
  };

  function loadWorld(data, opts) {
    if (!data || data.v !== 1) throw new Error("Unrecognised save data");
    var w = new World({ seed: data.rng, ambient: !(opts && opts.ambient === false), empty: true });
    w.t = data.t;
    w.money = data.money;
    w.rng.state = data.rng >>> 0;
    w.nextJobId = data.nextJobId;
    w.stats = data.stats;
    w.dayStats = data.dayStats || { earned: 0, fuel: 0, jobs: 0 };
    w.lastDay = data.lastDay || w.day();
    w.board = data.board.slice();
    while (w.board.length < C.BOARD_SIZE) w.board.push(null);
    w.boardRefill = (data.boardRefill || []).slice();
    data.trucks.forEach(function (td, i) {
      var sp = td.spot && w.map.lanes[td.spot.lane] ? td.spot : null;
      var t = w.addTruck(sp ? { lane: sp.lane, s: clamp(sp.s, 0.9, w.map.lanes[sp.lane].len - 0.9), lotId: sp.lotId } : null);
      t.name = td.name || t.name;
      t.color = td.color || t.color;
      t.job = td.job;
      t.task = td.task || { phase: "idle" };
      t.dwell = td.dwell || 0;
      t.cargo = td.cargo || null;
      t.queue = td.queue || [];
      t.dist = td.dist || 0;
      t.target = td.target || null;
      t.truckIndex = i;
      // a truck saved mid-drive resumes its errand from the curb
      if (t.job && (t.task.phase === "pickup" || t.task.phase === "deliver")) {
        var lotId = t.task.phase === "pickup" ? t.job.from : t.job.stops[t.task.stopIdx];
        w.sendTo(t, w.lotSpot(w.lotById[lotId]));
      }
    });
    return w;
  }

  return {
    C: C,
    TOWNS: TOWNS,
    GOODS: GOODS,
    Rng: Rng,
    World: World,
    loadWorld: loadWorld,
    getMap: getMap,
    findRoute: findRoute,
    spotDistance: spotDistance,
    jobPay: jobPay,
    signalFor: signalFor,
    laneKey: laneKey,
    moveKey: moveKey,
  };
});
