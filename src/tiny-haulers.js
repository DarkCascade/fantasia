/*
 * Tiny Haulers — a cosy little logistics sim.
 *
 * Two small towns joined by a country highway: Maplewood (brick cottages,
 * autumn maples, all-way stop signs) and Seabright (pastel beach houses,
 * palms, traffic lights). You run a delivery company: pick routes off the job
 * board, hand them to your trucks and watch the drivers make their way
 * through traffic. Everyone on the road drives themselves — cars follow,
 * queue, take turns at stop signs, wait for gaps to pull out from the curb and
 * reroute around queues — so the game is in the dispatching, not the driving.
 *
 * The simulation lives in src/tiny-haulers/sim.js (window.TinyHaulersSim,
 * unit-tested under Node in test/tiny-haulers.test.js). This file is the
 * three.js view, the DOM HUD, the title screen and the save slots.
 *
 * Art: Meshy-generated models (src/tiny-haulers/models/*.glb, see
 * experiments/tiny-haulers-art/) when they load; otherwise everything falls
 * back to the primitive builders below (`?art=0` forces that).
 *
 * Created on demand via window.launchTinyHaulers(); three.js is imported on
 * first use like the other 3D games. window.tinyHaulersGame.destroy() takes no
 * arguments.
 */
(function () {
  "use strict";

  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function resolve(rel) {
    return new URL(rel, SELF_SRC || window.location.href).href;
  }
  var THREE_URL = resolve("../vendor/three.module.min.js");
  var BGU_URL = resolve("../vendor/jsm/utils/BufferGeometryUtils.js");
  var GLTF_URL = resolve("../vendor/jsm/loaders/GLTFLoader.js");
  var MODEL_BASE = resolve("./tiny-haulers/models/");
  var LOGO_URL = resolve("./tiny-haulers/marquee.webp");
  var ART_OFF = /[?&]art=0(?:&|$)/.test(window.location.search);
  var THREE = null;
  var mergeGeometries = null;
  var ART = null; // { name: THREE.Object3D } once the Meshy models are loaded

  var SLOT_PREFIX = "tiny-haulers-slot-";
  var SEEN_KEY = "tiny-haulers-seen-intro";
  var SPEEDS = [0, 1, 2, 4];

  function Sim() {
    return window.TinyHaulersSim;
  }

  /* ------------------------------------------------------------------ */
  /* Styles + markup                                                     */
  /* ------------------------------------------------------------------ */

  var CSS = [
    "#th-root{position:absolute;inset:0;overflow:hidden;background:#bfe3f2;color:#3b3355;font-family:'Trebuchet MS','Segoe UI Rounded',ui-rounded,'Segoe UI',system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;--ink:#3b3355;--cream:#fff8ec;--teal:#2ec4b6;--coral:#ff6b6b;--sun:#ffd166;--line:rgba(59,51,85,.14)}",
    "#th-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}",
    ":where(#th-root) button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}",
    ".th-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#3b3355}",
    ".th-layer{position:absolute;inset:0;pointer-events:none}",
    ".th-layer > *{pointer-events:auto}",
    /* labels / bubbles projected over the 3D scene */
    ".th-float{position:absolute;inset:0;pointer-events:none;overflow:hidden}",
    ".th-town{position:absolute;transform:translate(-50%,-50%);font-weight:900;font-size:clamp(15px,2.2vw,22px);letter-spacing:.06em;color:#fff;text-shadow:0 2px 0 rgba(59,51,85,.55),0 0 12px rgba(59,51,85,.35);white-space:nowrap;text-transform:uppercase}",
    ".th-badge{position:absolute;transform:translate(-50%,-100%);display:flex;align-items:center;gap:3px;padding:2px 7px 2px 4px;border-radius:999px;background:var(--cream);box-shadow:0 2px 0 rgba(59,51,85,.25);font-size:12px;font-weight:800;white-space:nowrap}",
    ".th-badge i{font-style:normal;font-size:15px}",
    ".th-badge.small{padding:2px 4px}",
    ".th-badge.small b{display:none}",
    ".th-pin{position:absolute;transform:translate(-50%,-100%);min-width:24px;height:24px;padding:0 5px;border-radius:12px 12px 12px 2px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:#fff;background:var(--coral);box-shadow:0 2px 0 rgba(0,0,0,.25);border:2px solid #fff}",
    ".th-pin.pick{background:#7a5cff}",
    ".th-pin.done{background:#9aa0a6;opacity:.7}",
    ".th-bubble{position:absolute;transform:translate(-50%,-100%);padding:3px 8px;border-radius:12px;background:#fff;font-weight:900;font-size:13px;box-shadow:0 2px 0 rgba(59,51,85,.25);white-space:nowrap;animation:th-pop .25s ease-out}",
    ".th-bubble::after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#fff}",
    ".th-money{position:absolute;transform:translate(-50%,-100%);font-weight:900;font-size:18px;color:#ffd166;text-shadow:0 2px 0 #7a5a00,0 0 6px rgba(0,0,0,.25);white-space:nowrap}",
    ".th-money.bonus{color:#9bff8a;text-shadow:0 2px 0 #1d6b12}",
    "@keyframes th-pop{from{transform:translate(-50%,-80%) scale(.4);opacity:0}to{transform:translate(-50%,-100%) scale(1);opacity:1}}",
    /* top bar */
    ".th-top{position:absolute;top:max(8px,env(safe-area-inset-top));left:8px;right:8px;display:flex;gap:8px;align-items:flex-start;pointer-events:none}",
    ".th-top > *{pointer-events:auto}",
    ".th-chip{background:var(--cream);border-radius:14px;box-shadow:0 3px 0 rgba(59,51,85,.22);padding:6px 11px;font-weight:800;display:flex;align-items:center;gap:6px;white-space:nowrap}",
    ".th-money-chip{font-size:20px}",
    ".th-money-chip.neg{color:#d64545}",
    ".th-clock{flex-direction:column;align-items:stretch;gap:3px;font-size:13px;padding:5px 10px}",
    ".th-daybar{height:5px;border-radius:3px;background:var(--line);overflow:hidden}",
    ".th-daybar i{display:block;height:100%;background:linear-gradient(90deg,#ffd166,#ff9f6b);width:0}",
    ".th-spacer{flex:1}",
    ".th-speed{padding:3px;gap:2px}",
    ".th-speed button{min-width:34px;height:30px;border-radius:10px;font-weight:900;font-size:12px}",
    ".th-speed button.on{background:var(--ink);color:#fff}",
    ".th-icon{width:40px;height:40px;justify-content:center;padding:0;font-size:19px}",
    ".th-views{position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 52px);left:8px;display:flex;gap:6px}",
    ".th-views button{background:rgba(255,248,236,.85);border-radius:12px;padding:5px 10px;font-weight:800;font-size:12px;box-shadow:0 2px 0 rgba(59,51,85,.18)}",
    ".th-views button.on{background:var(--ink);color:#fff}",
    /* side panel / bottom sheet */
    ".th-panel{position:absolute;right:10px;top:calc(max(8px,env(safe-area-inset-top)) + 52px);bottom:10px;width:340px;display:flex;flex-direction:column;background:rgba(255,248,236,.96);border-radius:18px;box-shadow:0 6px 0 rgba(59,51,85,.18),0 12px 30px rgba(59,51,85,.18);overflow:hidden}",
    ".th-tabs{display:flex;gap:4px;padding:8px 8px 0}",
    ".th-tabs button{flex:1;padding:8px 6px;border-radius:12px 12px 0 0;font-weight:900;font-size:14px;color:rgba(59,51,85,.6)}",
    ".th-tabs button.on{background:#fff;color:var(--ink)}",
    ".th-tabs .th-grip{display:none}",
    ".th-body{flex:1;overflow-y:auto;background:#fff;margin:0 8px 8px;border-radius:0 0 12px 12px;padding:8px;-webkit-overflow-scrolling:touch;touch-action:pan-y}",
    ".th-card{border-radius:14px;background:var(--cream);padding:9px 10px;margin-bottom:8px;box-shadow:0 2px 0 rgba(59,51,85,.12);border:2px solid transparent;transition:border-color .15s}",
    ".th-card.hot{border-color:#7a5cff}",
    ".th-card.empty{background:repeating-linear-gradient(45deg,#f6efe3,#f6efe3 8px,#fbf6ee 8px,#fbf6ee 16px);color:rgba(59,51,85,.45);font-weight:800;font-size:13px;text-align:center;padding:16px}",
    ".th-jh{display:flex;align-items:center;gap:8px}",
    ".th-good{font-size:26px;width:38px;height:38px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none}",
    ".th-jt{flex:1;min-width:0}",
    ".th-jt b{display:block;font-size:15px}",
    ".th-jt small{display:block;font-size:12px;color:rgba(59,51,85,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".th-pay{text-align:right;font-weight:900;font-size:18px;color:#1f8a5b;line-height:1.05}",
    ".th-pay small{display:block;font-size:11px;color:#c7891c}",
    ".th-stops{display:flex;flex-wrap:wrap;gap:4px;margin:7px 0 6px}",
    ".th-stop{font-size:11px;font-weight:800;background:#fff;border-radius:8px;padding:2px 6px;white-space:nowrap}",
    ".th-stop.x{background:#ffe9b8}",
    ".th-meta{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:rgba(59,51,85,.75)}",
    ".th-meta .th-exp{flex:1;height:5px;border-radius:3px;background:var(--line);overflow:hidden}",
    ".th-meta .th-exp i{display:block;height:100%;background:#ffb703}",
    ".th-btn{border-radius:12px;padding:7px 12px;font-weight:900;font-size:13px;background:var(--teal);color:#fff !important;box-shadow:0 3px 0 #1f8f84}",
    ".th-btn:active{transform:translateY(2px);box-shadow:0 1px 0 #1f8f84}",
    ".th-btn.alt{background:#ece3d3;color:var(--ink) !important;box-shadow:0 3px 0 #cbbfa8}",
    ".th-btn.warn{background:var(--coral);box-shadow:0 3px 0 #c44}",
    ".th-btn[disabled]{opacity:.45;pointer-events:none}",
    ".th-assign{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;padding-top:7px;border-top:2px dashed var(--line)}",
    ".th-assign .th-btn{display:flex;align-items:center;gap:5px;padding:6px 9px}",
    ".th-dot{width:12px;height:12px;border-radius:50%;flex:none;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)}",
    ".th-truck .th-jh b{font-size:16px}",
    ".th-status{font-size:12px;font-weight:800;color:rgba(59,51,85,.75)}",
    ".th-prog{display:flex;gap:3px;margin-top:6px}",
    ".th-prog i{flex:1;height:7px;border-radius:4px;background:var(--line)}",
    ".th-prog i.on{background:var(--teal)}",
    ".th-prog i.cur{background:repeating-linear-gradient(90deg,var(--teal) 0 6px,#8fe3da 6px 12px);background-size:24px 7px;animation:th-slide 0.8s linear infinite}",
    "@keyframes th-slide{to{background-position:24px 0}}",
    ".th-timer{font-size:12px;font-weight:900}",
    ".th-timer.late{color:#d64545}",
    ".th-q{margin-top:6px;font-size:12px;font-weight:800;display:flex;flex-direction:column;gap:3px}",
    ".th-q div{display:flex;align-items:center;gap:5px;background:#fff;border-radius:8px;padding:3px 6px}",
    ".th-q div span{flex:1}",
    ".th-q button{font-weight:900;color:#d64545 !important;padding:0 4px}",
    ".th-buy{display:flex;align-items:center;gap:10px;padding:10px;border-radius:14px;border:2px dashed #cbbfa8;margin-bottom:8px}",
    ".th-buy span{flex:1;font-size:13px;font-weight:800}",
    ".th-stats{font-size:12px;font-weight:800;color:rgba(59,51,85,.7);display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding:4px 4px 8px}",
    ".th-hint{font-size:12px;font-weight:700;color:rgba(59,51,85,.7);padding:2px 4px 8px;line-height:1.35}",
    /* toasts */
    ".th-toasts{position:absolute;left:50%;top:calc(max(8px,env(safe-area-inset-top)) + 96px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:5}",
    ".th-toast{background:var(--ink);color:#fff;font-weight:800;font-size:14px;padding:8px 14px;border-radius:14px;box-shadow:0 4px 12px rgba(0,0,0,.2);animation:th-toast 3.2s ease forwards;white-space:nowrap}",
    "@keyframes th-toast{0%{opacity:0;transform:translateY(-8px)}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}",
    /* modal / title */
    ".th-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(40,32,70,.35);z-index:10;padding:16px}",
    ".th-sheet{width:min(440px,100%);max-height:100%;overflow:auto;background:var(--cream);border-radius:22px;padding:18px;box-shadow:0 8px 0 rgba(59,51,85,.25),0 20px 50px rgba(0,0,0,.25)}",
    ".th-sheet h2{margin:0 0 4px;font-size:24px;font-weight:900}",
    ".th-sheet p{margin:0 0 12px;font-size:14px;font-weight:700;color:rgba(59,51,85,.75);line-height:1.4}",
    ".th-slot{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border-radius:16px;padding:12px;margin-bottom:9px;box-shadow:0 3px 0 rgba(59,51,85,.14);border:2px solid transparent}",
    ".th-slot:hover{border-color:var(--teal)}",
    ".th-slot .n{width:40px;height:40px;border-radius:12px;background:var(--sun);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;flex:none}",
    ".th-slot .d{flex:1;min-width:0}",
    ".th-slot .d b{display:block;font-size:15px}",
    ".th-slot .d small{display:block;font-size:12px;font-weight:700;color:rgba(59,51,85,.65)}",
    ".th-slot.empty .n{background:#ece3d3;color:rgba(59,51,85,.5)}",
    ".th-slot .del{font-size:16px;padding:6px;border-radius:10px}",
    ".th-slot .del:hover{background:#ffe1e1}",
    ".th-row{display:flex;gap:8px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap}",
    ".th-menu-list{display:flex;flex-direction:column;gap:9px}",
    ".th-menu-list .th-btn{padding:12px;font-size:16px;text-align:center}",
    ".th-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,2.5vh,22px);z-index:8;padding:20px;background:radial-gradient(ellipse at 50% 45%,rgba(255,248,236,.0),rgba(59,51,85,.28))}",
    ".th-logo{text-align:center;line-height:.9}",
    ".th-logo .t1,.th-logo .t2{display:block;font-weight:900;font-size:clamp(46px,11vw,104px);letter-spacing:.02em;color:#ffd166;-webkit-text-stroke:3px #3b3355;paint-order:stroke fill;text-shadow:0 6px 0 #3b3355,0 10px 18px rgba(0,0,0,.25)}",
    ".th-logo .t2{color:#ff8a65;transform:rotate(-2deg);margin-top:2px}",
    ".th-logo .truck{display:block;margin:0 auto -4px;width:clamp(110px,18vw,170px);filter:drop-shadow(0 6px 4px rgba(59,51,85,.35));animation:th-bob 1.4s ease-in-out infinite}",
    "@keyframes th-bob{50%{transform:translateY(-6px) rotate(-3deg)}}",
    ".th-tag{font-weight:900;font-size:clamp(14px,2.4vw,19px);color:#fff;text-shadow:0 2px 0 rgba(59,51,85,.6);text-align:center}",
    ".th-title .th-menu-list{width:min(300px,86vw)}",
    ".th-title .th-menu-list .th-btn{font-size:18px;padding:13px}",
    ".th-fine{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));font-size:12px;font-weight:800;color:rgba(255,255,255,.85);text-shadow:0 1px 0 rgba(59,51,85,.6)}",
    ".th-fatal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}",
    /* phones: the panel becomes a bottom sheet */
    "@media (max-width:760px){",
    ".th-panel{left:0;right:0;bottom:0;top:auto;width:auto;height:min(44vh,400px);border-radius:20px 20px 0 0;padding-bottom:env(safe-area-inset-bottom)}",
    ".th-panel.min{height:58px}",
    ".th-panel.min .th-body{display:none}",
    ".th-tabs .th-grip{display:block;flex:0 0 44px;font-size:18px;color:var(--ink)}",
    ".th-views{top:auto;bottom:calc(min(44vh,400px) + 8px)}",
    ".th-root-min .th-views{bottom:66px}",
    ".th-money-chip{font-size:17px}",
    ".th-speed button{min-width:26px;font-size:11px}",
    ".th-top [data-th=save]{display:none}",
    ".th-top{gap:6px}",
    ".th-money-chip{padding:6px 9px}",
    ".th-icon{width:36px;height:36px}",
    ".th-toasts{top:calc(max(8px,env(safe-area-inset-top)) + 54px)}",
    "}",
  ].join("\n");

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(n) {
    var neg = n < 0;
    var s = Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-$" : "$") + s;
  }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  /* ------------------------------------------------------------------ */
  /* Save slots                                                          */
  /* ------------------------------------------------------------------ */

  var Slots = {
    read: function (i) {
      try {
        var raw = window.localStorage.getItem(SLOT_PREFIX + i);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    write: function (i, data) {
      try {
        window.localStorage.setItem(SLOT_PREFIX + i, JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },
    clear: function (i) {
      try {
        window.localStorage.removeItem(SLOT_PREFIX + i);
      } catch (e) {}
    },
    all: function () {
      return [1, 2, 3].map(function (i) {
        return Slots.read(i);
      });
    },
    latest: function () {
      var best = 0,
        bt = -1;
      Slots.all().forEach(function (d, i) {
        if (d && d.savedAt > bt) {
          bt = d.savedAt;
          best = i + 1;
        }
      });
      return best;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Static geometry builder (vertex-coloured, merged into one mesh)     */
  /* ------------------------------------------------------------------ */

  function Builder() {
    this.geoms = [];
    this.m = new THREE.Matrix4();
    this.stack = [];
  }
  Builder.prototype.push = function (x, y, z, rotY, s) {
    this.stack.push(this.m.clone());
    var t = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY || 0), new THREE.Vector3(s || 1, s || 1, s || 1));
    this.m = this.m.clone().multiply(t);
  };
  Builder.prototype.pop = function () {
    this.m = this.stack.pop();
  };
  Builder.prototype.add = function (geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    var g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute("uv");
    var local = new THREE.Matrix4().compose(
      new THREE.Vector3(x || 0, y || 0, z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
      new THREE.Vector3(sx || 1, sy || 1, sz || 1)
    );
    g.applyMatrix4(this.m.clone().multiply(local));
    var c = new THREE.Color(color);
    var n = g.attributes.position.count;
    var arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.geoms.push(g);
    return g;
  };
  // box with its base at y
  Builder.prototype.box = function (w, h, d, color, x, y, z, ry) {
    return this.add(G.box, color, x, (y || 0) + h / 2, z, 0, ry || 0, 0, w, h, d);
  };
  // gable roof: ridge along local x
  Builder.prototype.gable = function (w, h, d, color, x, y, z, ry) {
    return this.add(G.prism, color, x, y, z, 0, ry || 0, 0, w, h, d);
  };
  Builder.prototype.cyl = function (r, h, color, x, y, z, seg, rTop) {
    var geo = seg === 6 ? G.cyl6 : seg === 8 ? G.cyl8 : G.cyl12;
    var mesh = this.add(geo, color, x, (y || 0) + h / 2, z, 0, 0, 0, r, h, r);
    void rTop;
    return mesh;
  };
  Builder.prototype.cone = function (r, h, color, x, y, z, seg) {
    return this.add(seg === 4 ? G.cone4 : G.cone8, color, x, (y || 0) + h / 2, z, 0, seg === 4 ? Math.PI / 4 : 0, 0, r, h, r);
  };
  Builder.prototype.blob = function (r, color, x, y, z, sx, sy, sz) {
    return this.add(G.ico, color, x, y, z, 0, 0, 0, r * (sx || 1), r * (sy || 1), r * (sz || 1));
  };
  Builder.prototype.build = function (mat) {
    if (!this.geoms.length) return null;
    var merged = mergeGeometries(this.geoms, false);
    this.geoms.forEach(function (g) {
      g.dispose();
    });
    this.geoms = [];
    merged.computeBoundingSphere();
    var mesh = new THREE.Mesh(merged, mat);
    return mesh;
  };

  var G = {}; // shared unit geometries
  function initGeoms() {
    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
    G.cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
    G.cyl12 = new THREE.CylinderGeometry(1, 1, 1, 12);
    G.cone4 = new THREE.ConeGeometry(1, 1, 4);
    G.cone8 = new THREE.ConeGeometry(1, 1, 8);
    G.ico = new THREE.IcosahedronGeometry(1, 1);
    G.sphere = new THREE.SphereGeometry(1, 12, 8);
    G.wheel = new THREE.CylinderGeometry(1, 1, 1, 12);
    G.wheel.rotateZ(Math.PI / 2);
    // unit triangular prism: base 1 wide (z) 1 long (x), apex at y=1
    var p = new THREE.BufferGeometry();
    var v = [];
    var A = [-0.5, 0, 0.5],
      B = [-0.5, 0, -0.5],
      Cc = [-0.5, 1, 0];
    var A2 = [0.5, 0, 0.5],
      B2 = [0.5, 0, -0.5],
      C2 = [0.5, 1, 0];
    function tri(a, b, c) {
      v.push.apply(v, a.concat(b, c));
    }
    tri(A, Cc, B); // end caps
    tri(A2, B2, C2);
    tri(A, A2, C2); // front slope
    tri(A, C2, Cc);
    tri(B, Cc, C2); // back slope
    tri(B, C2, B2);
    tri(A, B, B2); // bottom
    tri(A, B2, A2);
    p.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    p.computeVertexNormals();
    G.prism = p;
  }

  // 4-step toon ramp shared by every material
  var RAMP = null;
  function toonRamp() {
    if (RAMP) return RAMP;
    var data = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
    RAMP = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter;
    RAMP.needsUpdate = true;
    return RAMP;
  }
  function toon(color, opts) {
    var m = new THREE.MeshToonMaterial(Object.assign({ color: color, gradientMap: toonRamp() }, opts || {}));
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* Palettes                                                            */
  /* ------------------------------------------------------------------ */

  var PAL = {
    grass: "#a6d36b",
    grass2: "#93c45c",
    sand: "#f3e1b0",
    water: "#5cc6e2",
    roadM: "#77706a",
    roadS: "#7b8794",
    roadH: "#6d7178",
    curbM: "#d7b49c",
    curbS: "#f4f1ea",
    mWalls: ["#f6e7cf", "#e9b49a", "#f2d6a2", "#e3c9b4", "#fbf1df"],
    mBrick: ["#c8684f", "#b65a46", "#d98b6a"],
    mRoof: ["#c0523d", "#8a5a44", "#d27a3b", "#6d4c41", "#b5483a"],
    maple: ["#e76f51", "#f4a261", "#e9c46a", "#d62828", "#f28c38", "#8ab84a"],
    sWalls: ["#bdeee0", "#ffd3e0", "#cfe6ff", "#fff1b8", "#e5d8ff", "#ffe0c2"],
    sTrim: "#ffffff",
    sRoof: ["#7fc8f8", "#ff9fb2", "#8fe3c4", "#ffd479", "#b7a6ff"],
    palm: ["#3fa66b", "#52b788", "#2d936c"],
    trunk: "#8d6748",
    awnM: ["#c0523d", "#2a9d8f", "#e9c46a"],
    awnS: ["#ff8fab", "#4cc9f0", "#ffb703", "#80ed99"],
  };

  /* ------------------------------------------------------------------ */
  /* Primitive building + prop builders                                  */
  /* ------------------------------------------------------------------ */

  function awning(b, w, y, z, c1, c2) {
    var n = 6;
    for (var i = 0; i < n; i++) b.add(G.box, i % 2 ? c2 : c1, -w / 2 + (i + 0.5) * (w / n), y, z, -0.45, 0, 0, w / n, 0.06, 0.7);
  }
  function windowRow(b, w, y, z, color, n) {
    for (var i = 0; i < n; i++) b.box(0.36, 0.38, 0.06, color, -w / 2 + (i + 0.5) * (w / n), y, z);
  }

  // When the Meshy art is loaded, trees are collected here and drawn as two
  // InstancedMeshes instead of being merged in as primitives.
  var TREE_SINK = null;

  function mapleTree(b, x, z, s, rng) {
    if (TREE_SINK) {
      TREE_SINK.maple.push([x, z, s, rng() * 6]);
      return;
    }
    b.push(x, 0, z, rng() * 6, s);
    b.cyl(0.13, 0.7, PAL.trunk, 0, 0, 0, 6);
    var c = PAL.maple[Math.floor(rng() * PAL.maple.length)];
    var c2 = PAL.maple[Math.floor(rng() * PAL.maple.length)];
    b.blob(0.62, c, 0, 1.05, 0, 1, 0.9, 1);
    b.blob(0.42, c2, 0.33, 1.3, 0.15);
    b.blob(0.38, c, -0.3, 1.25, -0.18);
    b.pop();
  }
  function palmTree(b, x, z, s, rng) {
    if (TREE_SINK) {
      TREE_SINK.palm.push([x, z, s, rng() * 6]);
      return;
    }
    b.push(x, 0, z, rng() * 6, s);
    var lean = 0.12 + rng() * 0.1;
    for (var i = 0; i < 5; i++) b.add(G.cyl6, i % 2 ? "#a47e5b" : "#8d6748", lean * i * 0.6, 0.18 + i * 0.36, 0, 0, 0, lean * 0.6, 0.1 - i * 0.008, 0.38, 0.1 - i * 0.008);
    var tx = lean * 3,
      ty = 1.85;
    for (var k = 0; k < 6; k++) {
      var a = (k / 6) * Math.PI * 2;
      b.add(G.box, PAL.palm[k % 3], tx + Math.cos(a) * 0.45, ty - 0.08, Math.sin(a) * 0.45, 0, -a, -0.45, 0.9, 0.05, 0.26);
    }
    b.blob(0.12, "#7a5230", tx, ty, 0);
    b.pop();
  }
  function bush(b, x, z, color) {
    b.blob(0.35, color, x, 0.22, z, 1.2, 0.75, 1);
  }

  function buildLot(b, lot, rng, i) {
    if (ART && lotModel(lot, i)) return;
    b.push(lot.x, 0, lot.z, lot.rot);
    var t = lot.type;
    var mw = PAL.mWalls,
      sw = PAL.sWalls;
    function pick(a) {
      return a[(i * 7 + 3) % a.length];
    }
    if (t === "cottage") {
      var wall = pick(mw),
        roof = pick(PAL.mRoof);
      if (i % 3 === 0) wall = pick(PAL.mBrick);
      b.box(2.3, 1.35, 1.9, wall, 0, 0, -0.1);
      b.gable(2.5, 0.95, 2.2, roof, 0, 1.35, -0.1);
      b.box(0.28, 0.7, 0.28, "#8d5b4c", 0.7, 1.55, -0.5);
      b.box(0.45, 0.78, 0.06, "#7a4b3a", 0, 0, 0.86);
      windowRow(b, 2.0, 0.55, 0.86, "#bfe6ff", 2);
      bush(b, -1.0, 1.0, "#7cb342");
      bush(b, 1.0, 1.0, "#8bc34a");
    } else if (t === "shop") {
      var sw2 = pick(mw);
      b.box(2.6, 1.6, 2.0, sw2, 0, 0, -0.1);
      b.box(2.75, 0.18, 2.15, pick(PAL.mRoof), 0, 1.6, -0.1);
      b.box(1.6, 0.36, 0.08, "#fff8ec", 0, 1.15, 0.92);
      b.box(1.0, 0.7, 0.06, "#bfe6ff", -0.55, 0.1, 0.92);
      b.box(0.45, 0.82, 0.06, "#7a4b3a", 0.75, 0, 0.92);
      awning(b, 2.4, 0.98, 1.15, pick(PAL.awnM), "#fff8ec");
    } else if (t === "bakery") {
      b.box(2.6, 1.6, 2.0, "#f6d7a7", 0, 0, -0.1);
      b.gable(2.8, 0.8, 2.3, "#a0522d", 0, 1.6, -0.1);
      b.box(1.0, 0.7, 0.06, "#bfe6ff", -0.55, 0.1, 0.92);
      b.box(0.45, 0.82, 0.06, "#7a4b3a", 0.75, 0, 0.92);
      awning(b, 2.4, 0.98, 1.15, "#c0523d", "#fff8ec");
      b.blob(0.42, "#d9973d", 0, 2.55, 0.35, 1.5, 0.7, 0.9);
      b.box(0.3, 0.6, 0.3, "#8d5b4c", -0.8, 1.8, -0.5);
    } else if (t === "sawmill") {
      b.box(2.6, 1.5, 2.0, "#b5483a", 0, 0, -0.2);
      b.gable(2.8, 0.9, 2.3, "#5d4037", 0, 1.5, -0.2);
      b.box(0.9, 1.0, 0.06, "#f6e7cf", 0, 0, 0.82);
      for (var lg = 0; lg < 3; lg++) b.add(G.cyl8, "#a1754f", -1.15, 0.18 + (lg === 2 ? 0.3 : 0), 0.55 + (lg === 2 ? 0.17 : lg * 0.34), 0, 0, Math.PI / 2, 0.17, 1.1, 0.17);
      b.add(G.cyl12, "#cfd8dc", 0.9, 0.55, 1.0, Math.PI / 2, 0, 0, 0.42, 0.05, 0.42);
    } else if (t === "apiary") {
      b.box(2.0, 1.3, 1.6, "#f2c94c", -0.3, 0, -0.35);
      b.gable(2.2, 0.75, 1.9, "#8a5a44", -0.3, 1.3, -0.35);
      b.box(0.45, 0.75, 0.06, "#7a4b3a", -0.3, 0, 0.47);
      for (var h = 0; h < 3; h++) {
        b.box(0.42, 0.22, 0.42, "#ffe08a", 0.85 + (h % 2) * 0.3, 0, 0.55 - h * 0.5);
        b.box(0.42, 0.22, 0.42, "#f2c94c", 0.85 + (h % 2) * 0.3, 0.22, 0.55 - h * 0.5);
        b.box(0.5, 0.06, 0.5, "#fff8ec", 0.85 + (h % 2) * 0.3, 0.44, 0.55 - h * 0.5);
      }
      bush(b, -1.1, 0.9, "#f48fb1");
    } else if (t === "hq") {
      b.box(2.8, 1.7, 2.1, "#2ec4b6", 0, 0, -0.15);
      b.box(2.95, 0.2, 2.25, "#264653", 0, 1.7, -0.15);
      for (var st = 0; st < 5; st++) b.box(1.6, 0.16, 0.06, st % 2 ? "#cfd8dc" : "#eceff1", -0.35, 0.05 + st * 0.18, 0.92);
      b.box(1.7, 0.38, 0.08, "#ffd166", -0.35, 1.2, 0.93);
      b.box(0.45, 0.8, 0.06, "#264653", 0.95, 0, 0.92);
      b.cyl(0.04, 1.4, "#ddd", 1.3, 1.9, -0.9, 6);
      b.box(0.5, 0.3, 0.03, "#ff6b6b", 1.55, 2.95, -0.9);
    } else if (t === "park") {
      b.box(2.9, 0.06, 2.6, "#8fc95a", 0, 0, 0);
      var prng = mkRng(i * 31 + 7);
      if (lot.name === "Orchard") {
        for (var o = 0; o < 4; o++) mapleTree(b, -0.75 + (o % 2) * 1.5, -0.65 + Math.floor(o / 2) * 1.3, 0.75, prng);
      } else {
        mapleTree(b, -0.9, -0.6, 1.0, prng);
        mapleTree(b, 0.9, -0.7, 0.85, prng);
        b.box(0.9, 0.08, 0.3, "#8d6748", 0, 0.3, 0.6);
        b.box(0.08, 0.3, 0.3, "#5d4037", -0.4, 0, 0.6);
        b.box(0.08, 0.3, 0.3, "#5d4037", 0.4, 0, 0.6);
        b.cyl(0.4, 0.25, "#cfd8dc", 0, 0, -0.1, 12);
        b.cyl(0.32, 0.27, "#7fd3f0", 0, 0, -0.1, 12);
      }
    } else if (t === "beachhouse") {
      var wall2 = pick(sw);
      b.box(2.0, 0.25, 1.8, "#e7d7b5", 0, 0, -0.1);
      b.box(2.0, 1.25, 1.7, wall2, 0, 0.25, -0.15);
      b.box(2.2, 0.12, 1.9, PAL.sTrim, 0, 1.5, -0.15);
      b.box(1.2, 0.6, 1.1, wall2, -0.3, 1.62, -0.3);
      b.box(1.35, 0.1, 1.25, pick(PAL.sRoof), -0.3, 2.22, -0.3);
      windowRow(b, 1.8, 0.75, 0.71, "#bfe6ff", 2);
      b.box(0.42, 0.75, 0.06, "#ffffff", 0, 0.25, 0.72);
      b.box(2.0, 0.06, 0.5, "#d9c39a", 0, 0.25, 0.95);
    } else if (t === "boardwalk") {
      var wall3 = pick(sw);
      b.box(2.6, 1.55, 1.9, wall3, 0, 0, -0.15);
      b.box(2.75, 0.14, 2.05, PAL.sTrim, 0, 1.55, -0.15);
      b.box(1.8, 0.32, 0.08, "#ffffff", 0, 1.18, 0.82);
      b.box(1.0, 0.7, 0.06, "#bfe6ff", -0.55, 0.1, 0.82);
      b.box(0.45, 0.8, 0.06, "#ffffff", 0.75, 0, 0.82);
      awning(b, 2.4, 0.98, 1.05, pick(PAL.awnS), "#ffffff");
    } else if (t === "fishmarket") {
      b.box(2.7, 1.5, 2.0, "#9ec5d8", 0, 0, -0.15);
      b.gable(2.9, 0.75, 2.3, "#3d6e8a", 0, 1.5, -0.15);
      b.box(1.4, 0.9, 0.06, "#e3f2fd", 0, 0, 0.86);
      b.blob(0.36, "#ff9e7a", 0, 2.55, 0.1, 1.5, 0.75, 0.4);
      b.add(G.cone4, "#ff9e7a", 0.72, 2.55, 0.1, 0, 0, Math.PI / 2, 0.3, 0.45, 0.12);
      b.box(0.5, 0.2, 0.3, "#ffffff", -1.0, 0, 1.0);
      b.box(0.5, 0.2, 0.3, "#90caf9", -1.0, 0.2, 1.0);
    } else if (t === "icecream") {
      b.box(2.5, 1.5, 1.9, "#ffd3e0", 0, 0, -0.15);
      b.box(2.65, 0.14, 2.05, "#ffffff", 0, 1.5, -0.15);
      b.box(1.2, 0.7, 0.06, "#bfe6ff", -0.4, 0.15, 0.82);
      awning(b, 2.3, 0.95, 1.05, "#ff8fab", "#ffffff");
      b.add(G.cone8, "#e9b872", 0, 2.05, 0, Math.PI, 0, 0, 0.32, 0.8, 0.32);
      b.blob(0.36, "#fff3f8", 0, 2.55, 0);
      b.blob(0.28, "#ff8fab", 0.05, 2.85, 0);
    } else if (t === "taffy") {
      for (var sp = 0; sp < 6; sp++) b.box(0.45, 1.6, 2.0, sp % 2 ? "#ffffff" : "#ff8fab", -1.125 + sp * 0.45, 0, -0.15);
      b.box(2.85, 0.16, 2.15, "#c77dff", 0, 1.6, -0.15);
      b.cyl(0.18, 1.0, "#ffffff", 0.8, 1.76, -0.6, 8);
      b.box(0.5, 0.8, 0.06, "#c77dff", 0, 0, 0.86);
      b.blob(0.22, "#ffd166", -0.6, 2.0, -0.5, 1.6, 0.8, 0.8);
    }
    b.pop();
  }

  // The coast: sea south of Seabright, curving away inland to the west, and
  // along the east edge. Shared by the water shader and the tree scatter.
  function shoreZ(x) {
    return 17 + Math.pow(Math.max(0, 16 - x), 2) * 0.05 + Math.sin(x * 0.15) * 0.4;
  }
  function shoreX(z) {
    return 64 + Math.sin(z * 0.2) * 0.8;
  }
  function inSea(x, z, margin) {
    return z > shoreZ(x) - (margin || 0) || x > shoreX(z) - (margin || 0);
  }

  function mkRng(seed) {
    var r = new (Sim().Rng)(seed);
    return function () {
      return r.next();
    };
  }

  /* ------------------------------------------------------------------ */
  /* Meshy art                                                           */
  /* ------------------------------------------------------------------ */

  // Every model: its file, how big it should be and which way it faces.
  // Buildings face +z out of Meshy; vehicles come out lying along x with the
  // nose on -x (truck, car0, car1) or +x (car2), so `rot` turns the nose to +z,
  // the direction the game drives along. `fit` is the footprint box [x, z] a
  // building is scaled into; `len` is a vehicle's length. `tint` vehicles have
  // white bodies that take each truck's / car's colour (see tintMaterial).
  var ART_SPEC = {
    truck: { len: 2.2, rot: Math.PI / 2, tint: true },
    car0: { len: 1.7, rot: Math.PI / 2, tint: true },
    car1: { len: 1.7, rot: Math.PI / 2, tint: true },
    car2: { len: 1.55, rot: -Math.PI / 2, tint: true },
    cottage_a: { fit: [2.7, 2.4] },
    cottage_b: { fit: [2.7, 2.4] },
    shop_m: { fit: [2.8, 2.4] },
    bakery: { fit: [2.9, 2.5] },
    sawmill: { fit: [3.0, 2.5] },
    apiary: { fit: [2.9, 2.5] },
    hq: { fit: [3.0, 2.5] },
    beach_a: { fit: [2.6, 2.3] },
    beach_b: { fit: [2.7, 2.4] },
    shop_s: { fit: [2.8, 2.4] },
    fishmarket: { fit: [2.9, 2.5] },
    icecream: { fit: [2.8, 2.4] },
    taffy: { fit: [2.9, 2.5] },
    inn: { fit: [2.6, 2.4] },
    school: { fit: [2.6, 2.4] },
    hotel: { fit: [2.6, 2.4] },
    cafe: { fit: [2.8, 2.4] },
    lighthouse: { fit: [2.6, 2.6] },
    maple: { fit: [1.7, 1.7] },
    palm: { fit: [1.9, 1.9] },
  };
  // lot.type -> models it can use (alternating by lot index)
  var LOT_ART = {
    cottage: ["cottage_a", "cottage_b"],
    shop: ["shop_m"],
    bakery: ["bakery"],
    sawmill: ["sawmill"],
    apiary: ["apiary"],
    hq: ["hq"],
    beachhouse: ["beach_a", "beach_b"],
    boardwalk: ["shop_s"],
    fishmarket: ["fishmarket"],
    icecream: ["icecream"],
    taffy: ["taffy"],
  };

  // Consumers are matched by name first so the towns don't repeat one shop.
  var NAME_ART = {
    Cottage: ["cottage_a", "cottage_b"],
    Inn: ["inn"],
    School: ["school"],
    Library: ["school"],
    Clinic: ["school"],
    "Post Office": ["inn"],
    "Tea Room": ["cottage_b"],
    Florist: ["cottage_a"],
    Carpenter: ["cottage_b"],
    "Beach House": ["beach_a", "beach_b"],
    Hotel: ["hotel"],
    Aquarium: ["hotel"],
    "Caf\u00E9": ["cafe"],
    Boutique: ["cafe"],
    Bistro: ["cafe"],
    "Gift Shop": ["cafe"],
  };
  function lotModel(lot, i) {
    var names = (lot.role === "consumer" && NAME_ART[lot.name]) || LOT_ART[lot.type];
    if (!names) return null;
    names = names.filter(function (n) {
      return ART[n];
    });
    return names.length ? names[i % names.length] : null;
  }

  var ART_PREP = {}; // name -> { scene, scale, offset } normalised once

  // Swap Meshy's PBR material for the game's toon ramp (same texture), so the
  // models shade like everything else in the scene.
  function prepArt(name) {
    if (ART_PREP[name]) return ART_PREP[name];
    var src = ART[name];
    var spec = ART_SPEC[name];
    src.traverse(function (o) {
      if (o.isMesh && !o.userData.thToon) {
        var map = o.material.map || null;
        o.material = new THREE.MeshToonMaterial({ map: map, gradientMap: toonRamp(), color: "#ffffff" });
        o.userData.thToon = true;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    var holder = new THREE.Group();
    var rotor = new THREE.Group();
    rotor.rotation.y = spec.rot || 0;
    rotor.add(src);
    holder.add(rotor);
    holder.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(holder);
    var size = box.getSize(new THREE.Vector3());
    var k;
    if (spec.len) k = spec.len / size.z;
    else k = Math.min(spec.fit[0] / size.x, spec.fit[1] / size.z);
    var c = box.getCenter(new THREE.Vector3());
    rotor.remove(src);
    ART_PREP[name] = { src: src, k: k, ox: -c.x * k, oy: -box.min.y * k, oz: -c.z * k, rot: spec.rot || 0 };
    return ART_PREP[name];
  }

  // A placeable copy: a group whose origin sits at the model's footprint
  // centre on the ground, facing +z. Geometry and textures are shared.
  function artInstance(name, tint) {
    var p = prepArt(name);
    var g = new THREE.Group();
    var inner = new THREE.Group();
    inner.position.set(p.ox, p.oy, p.oz);
    inner.scale.setScalar(p.k);
    var rotor = new THREE.Group();
    rotor.rotation.y = p.rot;
    var copy = p.src.clone(true);
    rotor.add(copy);
    inner.add(rotor);
    g.add(inner);
    if (tint) {
      copy.traverse(function (o) {
        if (o.isMesh) o.material = tintMaterial(o.material, tint);
      });
    }
    return g;
  }

  // Recolour only the near-white, unsaturated texels (a vehicle's body), so
  // windows, wheels, lights and trim keep their painted colours.
  function tintMaterial(base, color) {
    var m = base.clone();
    var tint = { value: new THREE.Color(color) };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTint = tint;
      sh.fragmentShader =
        "uniform vec3 uTint;\n" +
        sh.fragmentShader.replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n{ vec3 tc = diffuseColor.rgb; float mx = max(tc.r, max(tc.g, tc.b)); float mn = min(tc.r, min(tc.g, tc.b));" +
            " float sat = (mx - mn) / max(mx, 1e-3); float wh = smoothstep(0.28, 0.55, mx) * (1.0 - smoothstep(0.10, 0.26, sat));" +
            " diffuseColor.rgb = mix(tc, uTint * min(1.0, mx * 1.2), wh); }"
        );
    };
    m.customProgramCacheKey = function () {
      return "th-tint";
    };
    return m;
  }

  // Many copies of one model as InstancedMeshes (one per sub-mesh).
  // items: [[x, z, scale, rotY], ...]
  function artInstanced(name, items, tints) {
    if (!items.length) return null;
    var p = prepArt(name);
    var group = new THREE.Group();
    var base = new THREE.Group();
    var inner = new THREE.Group();
    inner.position.set(p.ox, p.oy, p.oz);
    inner.scale.setScalar(p.k);
    var rotor = new THREE.Group();
    rotor.rotation.y = p.rot;
    var copy = p.src.clone(true);
    rotor.add(copy);
    inner.add(rotor);
    base.add(inner);
    base.updateMatrixWorld(true);
    var place = new THREE.Matrix4();
    var tmp = new THREE.Matrix4();
    copy.traverse(function (o) {
      if (!o.isMesh) return;
      var im = new THREE.InstancedMesh(o.geometry, o.material, items.length);
      items.forEach(function (it, i) {
        place.compose(new THREE.Vector3(it[0], 0, it[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it[3]), new THREE.Vector3(it[2], it[2], it[2]));
        tmp.multiplyMatrices(place, o.matrixWorld);
        im.setMatrixAt(i, tmp);
      });
      if (tints) {
        var col = new THREE.Color();
        items.forEach(function (it, i) {
          im.setColorAt(i, col.set(tints[i % tints.length]));
        });
      }
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    });
    return group;
  }

  /* ------------------------------------------------------------------ */
  /* Vehicles                                                            */
  /* ------------------------------------------------------------------ */

  function buildCarMesh(color, model) {
    var g = new THREE.Group();
    var body = toon(color);
    var dark = toon("#2b2d42");
    var glass = toon("#cdeefd");
    var white = toon("#ffffff");
    var mk = function (geo, mat, x, y, z, sx, sy, sz) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (model === 1) {
      // little van
      mk(G.box, body, 0, 0.42, 0, 0.82, 0.55, 1.5);
      mk(G.box, glass, 0, 0.8, 0.12, 0.76, 0.32, 1.1);
      mk(G.box, white, 0, 0.98, 0.1, 0.84, 0.08, 1.3);
    } else if (model === 2) {
      // round bubble car
      mk(G.sphere, body, 0, 0.45, 0, 0.45, 0.33, 0.78);
      mk(G.sphere, glass, 0, 0.66, -0.05, 0.34, 0.25, 0.42);
    } else {
      mk(G.box, body, 0, 0.36, 0, 0.82, 0.38, 1.5);
      mk(G.box, body, 0, 0.67, -0.1, 0.72, 0.3, 0.82);
      mk(G.box, glass, 0, 0.67, -0.1, 0.74, 0.22, 0.7);
    }
    [
      [-0.38, 0.5],
      [0.38, 0.5],
      [-0.38, -0.5],
      [0.38, -0.5],
    ].forEach(function (p) {
      mk(G.wheel, dark, p[0], 0.17, p[1], 0.12, 0.17, 0.17);
    });
    mk(G.box, toon("#fff6b0"), 0, 0.38, 0.76, 0.6, 0.08, 0.02);
    return g;
  }

  function buildTruckMesh(color) {
    var g = new THREE.Group();
    var body = toon(color);
    var dark = toon("#2b2d42");
    var cream = toon("#fff8ec");
    var glass = toon("#cdeefd");
    var mk = function (geo, mat, x, y, z, sx, sy, sz) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    mk(G.box, body, 0, 0.5, 0.68, 0.92, 0.66, 0.66); // cab
    mk(G.box, glass, 0, 0.7, 0.95, 0.84, 0.28, 0.14);
    mk(G.box, cream, 0, 0.72, -0.28, 0.98, 1.0, 1.3); // cargo box
    mk(G.box, body, 0, 0.72, -0.28, 1.0, 0.18, 1.32);
    mk(G.box, dark, 0, 0.2, 0, 0.9, 0.12, 2.0);
    [
      [-0.43, 0.72],
      [0.43, 0.72],
      [-0.43, -0.55],
      [0.43, -0.55],
    ].forEach(function (p) {
      mk(G.wheel, dark, p[0], 0.19, p[1], 0.13, 0.19, 0.19);
    });
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* Markup                                                              */
  /* ------------------------------------------------------------------ */

  var HUD_HTML =
    '<div class="th-float" data-th="float"></div>' +
    '<div class="th-layer" data-th="hud" style="display:none">' +
    '<div class="th-top">' +
    '<div class="th-chip th-money-chip" data-th="money">$0</div>' +
    '<div class="th-chip th-clock"><span data-th="clock">Day 1 · 6:00am</span><div class="th-daybar"><i data-th="daybar"></i></div></div>' +
    '<div class="th-spacer"></div>' +
    '<div class="th-chip th-speed" data-th="speed">' +
    '<button data-speed="0" title="Pause (Space)">&#10074;&#10074;</button><button data-speed="1" class="on" title="Normal speed">&#9654;</button><button data-speed="2" title="Fast">&#9654;&#9654;</button><button data-speed="3" title="Fastest">&#9654;&#9654;&#9654;</button>' +
    "</div>" +
    '<button class="th-chip th-icon" data-th="save" title="Save game">&#128190;</button>' +
    '<button class="th-chip th-icon" data-th="menu" title="Menu">&#9776;</button>' +
    "</div>" +
    '<div class="th-views" data-th="views"><button data-view="maplewood">Maplewood</button><button data-view="map" class="on">Map</button><button data-view="seabright">Seabright</button></div>' +
    '<div class="th-panel" data-th="panel">' +
    '<div class="th-tabs"><button data-tab="jobs" class="on">Jobs</button><button data-tab="fleet">Fleet</button><button class="th-grip" data-th="grip" title="Show / hide">&#9662;</button></div>' +
    '<div class="th-body" data-th="body"></div>' +
    "</div>" +
    "</div>" +
    '<div class="th-toasts" data-th="toasts"></div>' +
    '<div data-th="modal"></div>' +
    '<div data-th="title"></div>';

  var TITLE_HTML =
    '<div class="th-title">' +
    '<div class="th-logo"><img class="truck" alt="" draggable="false" src="' + LOGO_URL + '"><span class="t1">Tiny</span><span class="t2">Haulers</span></div>' +
    '<div class="th-tag">A cosy little delivery company in two little towns</div>' +
    '<div class="th-menu-list">' +
    '<button class="th-btn" data-title="new">New Game</button>' +
    '<button class="th-btn alt" data-title="continue">Continue</button>' +
    '<button class="th-btn alt" data-title="load">Load Game</button>' +
    '<button class="th-btn alt" data-title="exit">&#9666; Fantasia Menu</button>' +
    "</div>" +
    '<div class="th-fine">Maplewood &amp; Seabright Delivery Co.</div>' +
    "</div>";

  /* ------------------------------------------------------------------ */
  /* Game                                                                */
  /* ------------------------------------------------------------------ */

  function Game(root, handle) {
    this.root = root;
    this.handle = handle;
    this.destroyed = false;
    this.listeners = [];
    this.q = function (k) {
      return root.querySelector('[data-th="' + k + '"]');
    };
    this.mode = "title"; // title | play
    this.speedIdx = 1;
    this.tab = "jobs";
    this.assigning = null;
    this.selected = null; // truck id
    this.follow = false;
    this.hoverJob = null;
    this.panelMin = false;
    this.vehMeshes = new Map();
    this.bubbles = [];
    this.pops = [];
    this.lastSig = "";
    this.uiT = 0;
    this.camT = 0;
    this.lowPower = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    this.setupRenderer();
    this.buildStatic();
    this.setupInput();
    this.newWorld(true);
    this.showTitle();
    this.last = performance.now();
    var self = this;
    this.raf = requestAnimationFrame(function loop(now) {
      if (self.destroyed) return;
      self.frame(now);
      self.raf = requestAnimationFrame(loop);
    });
  }

  Game.prototype.on = function (el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this.listeners.push([el, ev, fn, opts]);
  };

  Game.prototype.setupRenderer = function () {
    var r = new THREE.WebGLRenderer({ antialias: !this.lowPower, powerPreference: this.lowPower ? "default" : "high-performance" });
    if (!r.getContext()) throw new Error("no WebGL context");
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    if (!this.lowPower) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer = r;
    this.root.insertBefore(r.domElement, this.root.firstChild);
    var self = this;
    this.on(r.domElement, "webglcontextlost", function (e) {
      e.preventDefault();
      self.fatal("This device dropped 3D graphics — try closing other tabs or apps, then come back.");
    });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#bfe3f2");
    this.scene.fog = new THREE.Fog("#bfe3f2", 160, 320);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    this.cam = { x: 6, z: 0, zoom: 40, az: 0.5, pitch: 0.82, tx: 6, tz: 0, tzoom: 40 };
    this.hemi = new THREE.HemisphereLight("#fff6e5", "#88a070", 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff1d6", 1.6);
    this.sun.position.set(-30, 60, 25);
    if (!this.lowPower) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      var sc = this.sun.shadow.camera;
      sc.left = -70;
      sc.right = 70;
      sc.top = 40;
      sc.bottom = -40;
      sc.near = 1;
      sc.far = 200;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.resize();
    this.on(window, "resize", this.resize.bind(this));
  };

  Game.prototype.resize = function () {
    var w = this.root.clientWidth || window.innerWidth,
      h = this.root.clientHeight || window.innerHeight;
    this.W = w;
    this.H = h;
    this.renderer.setSize(w, h, false);
    this.portrait = h > w * 1.1;
    this.narrow = w <= 760;
  };

  /* ---------- static world ---------- */

  Game.prototype.buildStatic = function () {
    var S = Sim();
    var map = S.getMap();
    this.map = map;
    var rng = mkRng(12345);
    var b = new Builder();
    var mat = toon("#ffffff", { vertexColors: true });
    this.staticMat = mat;

    // ground: grass everywhere, sand under Seabright, a field near Maplewood
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 260), toon(PAL.grass));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(5, -0.02, 0);
    ground.receiveShadow = true;
    this.scene.add(ground);
    b.box(48, 0.02, 40, PAL.sand, 38, -0.015, 3);
    b.box(10, 0.02, 26, PAL.sand, 63, -0.015, -2);
    // grass blocks inside Maplewood are a little greener
    b.box(30, 0.015, 30, PAL.grass2, -32, -0.012, 0);
    // sea: south and east of Seabright
    this.water = this.buildWater();
    // farm field west of Maplewood
    for (var row = 0; row < 7; row++) b.box(9, 0.12, 0.7, row % 2 ? "#c9a46a" : "#8cbf4a", -58, 0, -10 + row * 1.6);
    for (row = 0; row < 7; row++) b.box(9, 0.12, 0.7, row % 2 ? "#e9c46a" : "#b98b4e", -58, 0, 4 + row * 1.5);

    // roads
    var self = this;
    map.edges.forEach(function (e) {
      var A = map.nodes[e.a],
        B = map.nodes[e.b];
      var dx = B.x - A.x,
        dz = B.z - A.z,
        len = Math.sqrt(dx * dx + dz * dz);
      var ang = Math.atan2(dx, dz);
      var town = e.hwy ? "hwy" : A.town === "hwy" ? B.town : A.town;
      var col = town === "maplewood" ? PAL.roadM : town === "seabright" ? PAL.roadS : PAL.roadH;
      var mx = (A.x + B.x) / 2,
        mz = (A.z + B.z) / 2;
      b.push(mx, 0, mz, ang);
      b.box(3.0, 0.04, len, col, 0, 0, 0);
      // curbs / verges
      if (town === "hwy") {
        b.box(0.5, 0.03, len, "#c2b280", 1.75, 0, 0);
        b.box(0.5, 0.03, len, "#c2b280", -1.75, 0, 0);
      } else {
        var curb = town === "maplewood" ? PAL.curbM : PAL.curbS;
        var cl = len - A.inset - B.inset;
        var off = (A.inset - B.inset) / 2;
        if (cl > 0) {
          b.box(0.7, 0.1, cl + 0.2, curb, 1.85, 0, off);
          b.box(0.7, 0.1, cl + 0.2, curb, -1.85, 0, off);
        }
      }
      // centre line: dashed white in town, solid yellow on the highway
      var dl = len - A.inset - B.inset;
      var o2 = (A.inset - B.inset) / 2;
      if (town === "hwy") {
        b.box(0.08, 0.05, len, "#ffd166", 0.08, 0, 0);
        b.box(0.08, 0.05, len, "#ffd166", -0.08, 0, 0);
      } else {
        var n = Math.max(1, Math.floor(dl / 1.4));
        for (var k = 0; k < n; k++) b.box(0.1, 0.05, 0.6, "#f8f4e8", 0, 0, o2 - dl / 2 + (k + 0.5) * (dl / n));
      }
      b.pop();
    });
    // node patches + controls
    this.signals = [];
    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      var col = n.town === "maplewood" ? PAL.roadM : n.town === "seabright" ? PAL.roadS : PAL.roadH;
      if (n.deg >= 3) b.box(3.7, 0.045, 3.7, col, n.x, 0, n.z);
      else b.cyl(1.55, 0.045, col, n.x, 0, n.z, 12);
      if (!n.ctrl) return;
      n.nbrs.forEach(function (p) {
        var L = map.lanes[S.laneKey(p, id)];
        var ex = L.sx + L.dx * L.len,
          ez = L.sz + L.dz * L.len;
        var ang = Math.atan2(L.dx, L.dz);
        // stop line
        b.push(ex - L.dx * 0.1, 0, ez - L.dz * 0.1, ang);
        b.box(1.35, 0.055, 0.22, "#ffffff", 0, 0, 0);
        b.pop();
        var px = ex + L.nx * 1.4 - L.dx * 0.6,
          pz = ez + L.nz * 1.4 - L.dz * 0.6;
        if (n.ctrl === "stop") {
          b.cyl(0.05, 1.3, "#d0d0d0", px, 0, pz, 6);
          b.push(px, 1.42, pz, ang + Math.PI);
          b.add(G.cyl8, "#e63946", 0, 0, 0.04, Math.PI / 2, 0, Math.PI / 8, 0.3, 0.05, 0.3);
          b.add(G.cyl8, "#ffffff", 0, 0, 0.07, Math.PI / 2, 0, Math.PI / 8, 0.24, 0.02, 0.24);
          b.add(G.cyl8, "#e63946", 0, 0, 0.08, Math.PI / 2, 0, Math.PI / 8, 0.21, 0.02, 0.21);
          b.pop();
        } else {
          // zebra crossing on the far side of the stop line
          b.push(ex + L.dx * 0.55, 0, ez + L.dz * 0.55, ang);
          for (var z = 0; z < 5; z++) b.box(0.3, 0.05, 0.7, "#ffffff", -1.2 + z * 0.6, 0, 0);
          b.pop();
          b.cyl(0.06, 1.7, "#4a4e69", px, 0, pz, 6);
          b.push(px, 1.7, pz, ang + Math.PI);
          b.box(0.34, 0.9, 0.26, "#2b2d42", 0, 0, 0);
          b.pop();
          var lights = [];
          ["#ff4d4d", "#ffd166", "#5cff8a"].forEach(function (c, li) {
            var m = new THREE.Mesh(G.sphere, new THREE.MeshBasicMaterial({ color: "#333" }));
            m.scale.setScalar(0.1);
            m.position.set(px - L.dx * 0.14, 2.42 - li * 0.27, pz - L.dz * 0.14);
            self.scene.add(m);
            lights.push({ mesh: m, on: new THREE.Color(c), off: new THREE.Color("#3a3a46") });
          });
          self.signals.push({ node: n, lane: L, lights: lights });
        }
      });
    });

    // buildings (primitives; replaced by Meshy models when they load)
    this.lotMeshes = [];
    TREE_SINK = ART && ART.maple && ART.palm ? { maple: [], palm: [] } : null;
    if (ART) {
      map.lots.forEach(function (lot, i) {
        var name = lotModel(lot, i);
        if (!name) return;
        var o = artInstance(name);
        o.position.set(lot.x, 0, lot.z);
        o.rotation.y = lot.rot;
        self.scene.add(o);
        self.lotMeshes.push(o);
      });
    }
    var bb = new Builder();
    map.lots.forEach(function (lot, i) {
      buildLot(bb, lot, rng, i);
    });
    this.lotPrims = bb.build(mat);
    if (this.lotPrims) {
      this.lotPrims.castShadow = this.lotPrims.receiveShadow = true;
      this.scene.add(this.lotPrims);
    }

    // trees and props, kept clear of roads and lots
    function clear(x, z, rRoad, rLot) {
      for (var i = 0; i < map.edges.length; i++) {
        var e = map.edges[i],
          A = map.nodes[e.a],
          B = map.nodes[e.b];
        var vx = B.x - A.x,
          vz = B.z - A.z;
        var l2 = vx * vx + vz * vz;
        var t = Math.max(0, Math.min(1, ((x - A.x) * vx + (z - A.z) * vz) / l2));
        var qx = A.x + vx * t - x,
          qz = A.z + vz * t - z;
        if (qx * qx + qz * qz < rRoad * rRoad) return false;
      }
      for (var j = 0; j < map.lots.length; j++) {
        var L = map.lots[j];
        if ((L.x - x) * (L.x - x) + (L.z - z) * (L.z - z) < rLot * rLot) return false;
      }
      return true;
    }
    this.trees = [];
    var tb = new Builder();
    var placed = 0;
    for (var tries = 0; tries < 2600 && placed < 190; tries++) {
      var x = -66 + rng() * 132,
        z = -26 + rng() * 52;
      if (inSea(x, z, 1.2)) continue;
      if (x > -54 && x < -50 && z > -12 && z < 15) continue; // field edge
      if (x < -53 && x > -63 && z > -11 && z < 15) continue; // the field
      if (!clear(x, z, 3.0, 2.9)) continue;
      var seaside = x > 14;
      var inTown = (x > -48 && x < -16 && z > -16 && z < 16) || (x > 18 && x < 56 && z > -14 && z < 14);
      if (inTown && rng() < 0.55) continue;
      var s = 0.8 + rng() * 0.6;
      if (seaside) {
        if (z > 8 || rng() < 0.6) palmTree(tb, x, z, s, rng);
        else bush(tb, x, z, "#6abf69");
      } else if (x > 4) {
        if (rng() < 0.5) mapleTree(tb, x, z, s, rng);
        else palmTree(tb, x, z, s * 0.9, rng);
      } else mapleTree(tb, x, z, s, rng);
      this.trees.push({ x: x, z: z, s: s, seaside: seaside });
      placed++;
    }
    // highway fences + hay bales + a windmill by the field
    for (var f = -6; f < 12; f += 2.2) {
      tb.box(0.1, 0.5, 0.1, "#b08968", f, 0, -6.5 + f * -0.12);
    }
    for (var hb = 0; hb < 4; hb++) tb.add(G.cyl12, "#e9c46a", -56 + hb * 2.4, 0.4, -13.5, Math.PI / 2, 0, 0, 0.4, 0.8, 0.4);
    tb.cyl(0.9, 4.2, "#f6e7cf", -61, 0, 2, 8);
    tb.cone(1.2, 1.4, "#c0523d", -61, 4.2, 2, 8);
    // Seabright beach props: umbrellas + towels + a pier + the lighthouse
    var beach = [
      [24, 14.6, "#ff8fab"],
      [30, 15.4, "#4cc9f0"],
      [41, 15.2, "#ffb703"],
      [47, 14.6, "#80ed99"],
      [54, 13.0, "#ff8fab"],
    ];
    beach.forEach(function (u) {
      tb.cyl(0.04, 1.2, "#ffffff", u[0], 0, u[1], 6);
      tb.cone(0.8, 0.4, u[2], u[0], 1.05, u[1], 8);
      tb.box(0.6, 0.03, 1.1, u[2] === "#4cc9f0" ? "#ffd166" : "#ffffff", u[0] + 0.7, 0, u[1] + 0.2);
    });
    for (var pp = 0; pp < 9; pp++) tb.box(1.6, 0.12, 0.9, pp % 2 ? "#b08968" : "#a47148", 36, 0.25, 16.0 + pp * 0.9);
    for (pp = 0; pp < 4; pp++) {
      tb.cyl(0.08, 0.5, "#6d4c41", 35.3, -0.2, 18 + pp * 2, 6);
      tb.cyl(0.08, 0.5, "#6d4c41", 36.7, -0.2, 18 + pp * 2, 6);
    }
    tb.blob(1.7, "#a0a4a8", 62, 0, 18.5, 1.4, 0.5, 1.2);
    tb.blob(1.0, "#8d9196", 64, 0.1, 17, 1.2, 0.6, 1);
    if (ART && ART.lighthouse) {
      var lhm = artInstance("lighthouse");
      lhm.position.set(62, 0.3, 18.5);
      lhm.rotation.y = -0.6;
      this.scene.add(lhm);
    } else {
      for (var lh = 0; lh < 4; lh++) tb.cyl(0.62 - lh * 0.05, 0.85, lh % 2 ? "#e63946" : "#ffffff", 62, 0.5 + lh * 0.85, 18.5, 12);
      tb.cyl(0.5, 0.5, "#fff3b0", 62, 3.9, 18.5, 8);
      tb.cone(0.62, 0.55, "#e63946", 62, 4.4, 18.5, 8);
    }
    if (TREE_SINK) {
      this.treeInst = [artInstanced("maple", TREE_SINK.maple, ["#ffffff", "#ffe2a8", "#ffb9ad", "#f4ffc8", "#ffd6b0"]), artInstanced("palm", TREE_SINK.palm, ["#ffffff", "#e8ffd8", "#fff6d0"])];
      this.treeInst.forEach(function (m) {
        if (m) self.scene.add(m);
      });
      TREE_SINK = null;
    }
    this.treesMesh = tb.build(mat);
    if (this.treesMesh) {
      this.treesMesh.castShadow = this.treesMesh.receiveShadow = true;
      this.scene.add(this.treesMesh);
    }
    var sm = b.build(mat);
    sm.receiveShadow = true;
    this.scene.add(sm);
    this.staticMesh = sm;

    // windmill blades + bobbing boats are the only animated scenery
    this.windmill = new THREE.Group();
    this.windmill.position.set(-61, 3.6, 2.95);
    var bladeMat = toon("#fff8ec");
    for (var bl = 0; bl < 4; bl++) {
      var blade = new THREE.Mesh(G.box, bladeMat);
      blade.scale.set(0.35, 2.4, 0.05);
      blade.position.y = 1.2;
      var arm = new THREE.Group();
      arm.rotation.z = (bl * Math.PI) / 2;
      arm.add(blade);
      this.windmill.add(arm);
    }
    this.scene.add(this.windmill);
    this.boats = [];
    var boatCols = ["#ff6b6b", "#ffd166", "#4cc9f0"];
    for (var bo = 0; bo < 3; bo++) {
      var boat = new THREE.Group();
      var hull = new THREE.Mesh(G.box, toon(boatCols[bo]));
      hull.scale.set(0.9, 0.35, 2.0);
      hull.position.y = 0.1;
      var sail = new THREE.Mesh(G.cone4, toon("#ffffff"));
      sail.scale.set(0.05, 1.5, 0.6);
      sail.position.set(0, 1.0, 0.1);
      boat.add(hull, sail);
      boat.position.set(28 + bo * 13, 0, 26 + (bo % 2) * 4);
      boat.rotation.y = bo * 1.3;
      this.scene.add(boat);
      this.boats.push(boat);
    }
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.55, 32), new THREE.MeshBasicMaterial({ color: "#7a5cff", transparent: true, opacity: 0.85, depthWrite: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.routeMesh = null;
    this.buildLabels();
  };

  Game.prototype.buildWater = function () {
    var geo = new THREE.PlaneGeometry(400, 300, 1, 1);
    var mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(PAL.water) }, uDeep: { value: new THREE.Color("#3a9fd0") } },
      vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }",
      fragmentShader:
        "uniform float uTime; uniform vec3 uCol; uniform vec3 uDeep; varying vec3 vW;" +
        "void main(){" +
        "float sz = 17.0 + pow(max(0.0, 16.0 - vW.x), 2.0)*0.05 + sin(vW.x*0.15)*0.4;" +
        "float sx = 64.0 + sin(vW.z*0.2)*0.8;" +
        "float into = max(vW.z - sz, vW.x - sx);" +
        "if (into < 0.0) discard;" +
        "vec3 c = mix(uCol, uDeep, clamp(into/18.0,0.0,1.0));" +
        "float w = sin(vW.x*0.55+uTime*1.2+sin(vW.z*0.4)*2.0)*sin(vW.z*0.7-uTime*0.9);" +
        "c += smoothstep(0.82,0.97,w)*0.22;" +
        "float foam = smoothstep(1.3,0.0,into+sin(vW.x*0.8+vW.z*0.6+uTime*1.5)*0.25);" +
        "c = mix(c, vec3(1.0), foam*0.8);" +
        "gl_FragColor = vec4(c,1.0); }",
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(60, -0.01, 60);
    this.scene.add(m);
    return mat;
  };

  Game.prototype.buildLabels = function () {
    var float = this.q("float");
    var S = Sim();
    var self = this;
    this.labels = [];
    Object.keys(S.TOWNS).forEach(function (k) {
      var t = S.TOWNS[k];
      var el = document.createElement("div");
      el.className = "th-town";
      el.textContent = t.name;
      float.appendChild(el);
      self.labels.push({ el: el, x: t.cx, y: 6, z: k === "maplewood" ? -18.5 : -15, kind: "town" });
    });
    this.map.lots.forEach(function (lot) {
      if (lot.role !== "producer" && lot.role !== "hq") return;
      var el = document.createElement("div");
      el.className = "th-badge";
      el.innerHTML = "<i>" + lot.emoji + "</i><b>" + esc(lot.name) + "</b>";
      float.appendChild(el);
      self.labels.push({ el: el, x: lot.x, y: 3.2, z: lot.z, kind: "lot", lot: lot });
    });
  };

  /* ---------- worlds ---------- */

  Game.prototype.clearVehicles = function () {
    var self = this;
    this.vehMeshes.forEach(function (m) {
      self.scene.remove(m);
      m.traverse(function (o) {
        if (o.material && o.material.dispose) o.material.dispose();
      });
    });
    this.vehMeshes.clear();
    this.bubbles.forEach(function (b) {
      b.el.remove();
    });
    this.bubbles = [];
    this.pops.forEach(function (p) {
      p.el.remove();
    });
    this.pops = [];
    this.clearPins();
    this.setRoute(null);
  };

  Game.prototype.newWorld = function (demo) {
    var S = Sim();
    this.clearVehicles();
    this.world = new S.World({ seed: (Math.random() * 2147483647) | 0 });
    this.demo = !!demo;
    if (demo) {
      // the title screen's background town: two trucks doing demo rounds
      this.world.money = 1e6;
      this.world.buyTruck();
      this.world.events.length = 0;
    }
    this.afterWorld();
  };

  Game.prototype.afterWorld = function () {
    this.selected = null;
    this.follow = false;
    this.assigning = null;
    this.lastSig = "";
    this.slot = this.slot || 0;
  };

  Game.prototype.vehicleMesh = function (v) {
    var m = this.vehMeshes.get(v.id);
    if (m) return m;
    if (v.kind === "truck") m = this.artVehicle("truck", v.color) || buildTruckMesh(v.color);
    else m = this.artVehicle("car" + (v.model || 0), v.color) || buildCarMesh(v.color, v.model || 0);
    this.scene.add(m);
    this.vehMeshes.set(v.id, m);
    var p = this.world.pose(v);
    m.position.set(p.x, 0, p.z);
    m.rotation.y = p.heading;
    return m;
  };

  /* ---------- Meshy art ---------- */

  Game.prototype.artVehicle = function (name, color) {
    if (!ART || !ART[name]) return null;
    return artInstance(name, color);
  };

  /* ---------- title / menus ---------- */

  Game.prototype.showTitle = function () {
    this.mode = "title";
    this.q("hud").style.display = "none";
    var t = this.q("title");
    t.innerHTML = TITLE_HTML;
    var latest = Slots.latest();
    var cont = t.querySelector('[data-title="continue"]');
    if (!latest) cont.style.display = "none";
    else cont.innerHTML = "Continue <small style='opacity:.65'>(slot " + latest + ")</small>";
    var load = t.querySelector('[data-title="load"]');
    if (!Slots.all().some(Boolean)) load.style.display = "none";
    this.closeModal();
    this.titleFit = null; // reframe the whole map
    this.camT = 0;
    if (!this.demo) this.newWorld(true);
  };

  Game.prototype.startPlay = function (world, slot) {
    this.clearVehicles();
    if (world) this.world = world;
    else this.world = new (Sim().World)({ seed: (Math.random() * 2147483647) | 0 });
    this.demo = false;
    this.slot = slot || 0;
    this.afterWorld();
    this.mode = "play";
    this.q("title").innerHTML = "";
    this.q("hud").style.display = "";
    this.closeModal();
    this.setSpeed(1);
    this.setView("maplewood");
    this.renderPanel(true);
    this.updateHud();
    if (!world) {
      var seen = false;
      try {
        seen = !!window.localStorage.getItem(SEEN_KEY);
      } catch (e) {}
      if (!seen) this.showIntro();
    }
  };

  Game.prototype.showIntro = function () {
    var self = this;
    this.modal(
      "<h2>Welcome to Tiny Haulers!</h2>" +
        "<p>You run a one-truck delivery company out of Maplewood. Pick a route from the <b>Jobs</b> board and assign it to a truck &mdash; the driver handles the rest.</p>" +
        "<p>More stops pay more, and every route pays a <b>bonus</b> if it's delivered inside its time limit (the clock starts at pickup). Traffic is real: drivers queue, take turns at stop signs and wait at Seabright's lights.</p>" +
        "<p>Earn enough to buy more trucks in the <b>Fleet</b> tab. Trucks cost a little upkeep each day, so keep them busy!</p>" +
        '<div class="th-row"><button class="th-btn" data-m="ok">Let’s go!</button></div>',
      function (k) {
        if (k === "ok") {
          try {
            window.localStorage.setItem(SEEN_KEY, "1");
          } catch (e) {}
          self.closeModal();
        }
      }
    );
  };

  Game.prototype.modal = function (html, onClick) {
    var m = this.q("modal");
    m.innerHTML = '<div class="th-modal"><div class="th-sheet">' + html + "</div></div>";
    this.modalHandler = onClick;
    this.modalOpen = true;
  };

  Game.prototype.closeModal = function () {
    this.q("modal").innerHTML = "";
    this.modalHandler = null;
    this.modalOpen = false;
  };

  Game.prototype.slotsHtml = function (mode) {
    var all = Slots.all();
    var h = "";
    all.forEach(function (d, i) {
      var n = i + 1;
      if (d) {
        var s = d.summary || {};
        h +=
          '<div class="th-slot" data-slot="' +
          n +
          '" role="button" tabindex="0"><span class="n">' +
          n +
          '</span><span class="d"><b>Day ' +
          (s.day || 1) +
          " &middot; " +
          money(s.money || 0) +
          "</b><small>" +
          (s.trucks || 1) +
          " truck" +
          ((s.trucks || 1) === 1 ? "" : "s") +
          " &middot; " +
          (s.jobs || 0) +
          " jobs done &middot; saved " +
          ago(d.savedAt) +
          "</small></span>" +
          (mode === "load" ? '<button class="del" data-del="' + n + '" title="Delete save">&#128465;</button>' : "") +
          "</div>";
      } else {
        h += '<div class="th-slot empty" data-slot="' + n + '" role="button" tabindex="0"><span class="n">' + n + '</span><span class="d"><b>Empty slot</b><small>' + (mode === "save" ? "Save here" : "Nothing saved yet") + "</small></span></div>";
      }
    });
    return h;
  };

  Game.prototype.openSlots = function (mode, back) {
    var self = this;
    var title = mode === "save" ? "Save game" : "Load game";
    var sub = mode === "save" ? "Pick a slot. Saving over a slot replaces it." : "Pick a save to continue from.";
    this.modal("<h2>" + title + "</h2><p>" + sub + "</p>" + this.slotsHtml(mode) + '<div class="th-row"><button class="th-btn alt" data-m="back">Back</button></div>', function (k, el) {
      if (k === "back") {
        if (back) back();
        else self.closeModal();
        return;
      }
      var del = el.getAttribute("data-del");
      if (del) {
        Slots.clear(+del);
        self.openSlots(mode, back);
        return;
      }
      var n = +el.getAttribute("data-slot");
      if (!n) return;
      if (mode === "save") {
        if (Slots.read(n) && el.getAttribute("data-confirm") !== "1") {
          el.setAttribute("data-confirm", "1");
          el.querySelector("small").textContent = "Tap again to overwrite";
          return;
        }
        if (Slots.write(n, self.world.serialize())) {
          self.slot = n;
          self.toast("Saved to slot " + n);
        } else self.toast("Couldn’t save (storage blocked?)");
        self.closeModal();
        if (self.paused && self.resumeAfterMenu) self.setSpeed(self.resumeAfterMenu);
      } else {
        var data = Slots.read(n);
        if (!data) return;
        try {
          var w = Sim().loadWorld(data);
          self.startPlay(w, n);
          self.toast("Loaded slot " + n + " — Day " + w.day());
        } catch (e) {
          self.toast("That save couldn’t be read");
        }
      }
    });
  };

  Game.prototype.openMenu = function () {
    var self = this;
    var resume = this.speedIdx || 1;
    this.setSpeed(0);
    this.resumeAfterMenu = resume;
    this.modal(
      '<h2>Paused</h2><p>Day ' +
        this.world.day() +
        " &middot; " +
        money(this.world.money) +
        '</p><div class="th-menu-list"><button class="th-btn" data-m="resume">Resume</button><button class="th-btn alt" data-m="save">Save game</button><button class="th-btn alt" data-m="load">Load game</button><button class="th-btn alt" data-m="title">Title screen</button><button class="th-btn alt" data-m="exit">Fantasia menu</button></div>',
      function (k) {
        if (k === "resume") {
          self.closeModal();
          self.setSpeed(resume);
        } else if (k === "save") self.openSlots("save", self.openMenu.bind(self));
        else if (k === "load") self.openSlots("load", self.openMenu.bind(self));
        else if (k === "title") self.showTitle();
        else if (k === "exit") window.returnToMenu && window.returnToMenu();
      }
    );
  };

  /* ---------- input ---------- */

  Game.prototype.setupInput = function () {
    var self = this;
    var root = this.root;
    var canvas = this.renderer.domElement;
    // HUD clicks (event delegation, so re-rendered panels keep working)
    this.on(root, "click", function (e) {
      var t = e.target.closest("[data-th],[data-speed],[data-tab],[data-view],[data-job],[data-assign],[data-truck],[data-cancel],[data-buy],[data-title],[data-m],[data-slot],[data-del]");
      if (!t || !root.contains(t)) return;
      if (t.closest(".th-modal")) {
        if (!self.modalHandler) return;
        var key = t.getAttribute("data-m") || (t.hasAttribute("data-del") ? "del" : t.hasAttribute("data-slot") ? "slot" : null);
        if (t.hasAttribute("data-del")) e.stopPropagation();
        self.modalHandler(key, t);
        return;
      }
      if (t.hasAttribute("data-title")) return self.titleAction(t.getAttribute("data-title"));
      if (t.hasAttribute("data-speed")) return self.setSpeed(+t.getAttribute("data-speed"));
      if (t.hasAttribute("data-tab")) {
        self.tab = t.getAttribute("data-tab");
        if (self.panelMin) self.setPanelMin(false);
        return self.renderPanel(true);
      }
      if (t.hasAttribute("data-view")) return self.setView(t.getAttribute("data-view"));
      if (t.hasAttribute("data-assign")) {
        var res = self.world.acceptJob(+t.getAttribute("data-job-id"), +t.getAttribute("data-assign"));
        self.assigning = null;
        if (!res.ok) self.toast(res.reason);
        else {
          var tr = self.world.truckById(+t.getAttribute("data-assign"));
          self.toast(res.queued ? "Queued for " + tr.name : tr.name + " is on the way!");
          self.select(tr.id, false);
        }
        return self.renderPanel(true);
      }
      if (t.hasAttribute("data-cancel")) {
        var parts = t.getAttribute("data-cancel").split(":");
        self.world.cancelQueued(+parts[0], +parts[1]);
        return self.renderPanel(true);
      }
      if (t.hasAttribute("data-buy")) {
        var r = self.world.buyTruck();
        if (!r.ok) self.toast(r.reason);
        else self.select(r.truck.id, true);
        return self.renderPanel(true);
      }
      if (t.hasAttribute("data-job")) {
        var id = +t.getAttribute("data-job");
        var trucks = self.world.trucks;
        if (trucks.length === 1 && t.classList.contains("th-btn")) {
          var rr = self.world.acceptJob(id, trucks[0].id);
          if (!rr.ok) self.toast(rr.reason);
          else {
            self.toast(rr.queued ? "Queued for " + trucks[0].name : trucks[0].name + " is on the way!");
            self.select(trucks[0].id, false);
          }
        } else if (t.classList.contains("th-btn")) self.assigning = self.assigning === id ? null : id;
        else if (self.lastPointer === "mouse") self.hoverJob = id;
        else self.hoverJob = self.hoverJob === id ? null : id;
        return self.renderPanel(true);
      }
      if (t.hasAttribute("data-truck")) {
        self.select(+t.getAttribute("data-truck"), true);
        return self.renderPanel(true);
      }
      var k = t.getAttribute("data-th");
      if (k === "save") return self.openSlots("save");
      if (k === "menu") return self.openMenu();
      if (k === "grip") return self.setPanelMin(!self.panelMin);
    });
    // hover a job card to preview its stops on the map
    this.on(root, "pointerover", function (e) {
      if (e.pointerType !== "mouse") return; // touch previews by tapping the card instead
      var c = e.target.closest && e.target.closest(".th-card[data-jobcard]");
      self.hoverJob = c ? +c.getAttribute("data-jobcard") : null;
    });
    this.on(
      root,
      "pointerdown",
      function (e) {
        self.lastPointer = e.pointerType;
      },
      true
    );
    // camera: drag to pan, wheel / pinch to zoom, tap to select
    var pts = new Map();
    var drag = null;
    this.on(canvas, "pointerdown", function (e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0, cx: self.cam.tx, cz: self.cam.tz };
      else if (pts.size === 2) {
        var a = Array.from(pts.values());
        drag = { pinch: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), zoom: self.cam.tzoom, moved: 99 };
      }
    });
    this.on(canvas, "pointermove", function (e) {
      if (!pts.has(e.pointerId) || !drag) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && drag.pinch) {
        var a = Array.from(pts.values());
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        self.cam.tzoom = Math.max(8, Math.min(70, (drag.zoom * drag.pinch) / Math.max(20, d)));
        return;
      }
      if (drag.pinch) return;
      var dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      if (drag.moved < 6) return;
      self.follow = false;
      var u = self.screenToGroundDelta(dx, dy);
      self.cam.tx = drag.cx - u.x;
      self.cam.tz = drag.cz - u.z;
      self.cam.x = self.cam.tx;
      self.cam.z = self.cam.tz;
      self.viewName = null;
      self.markView();
    });
    function up(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (drag && drag.moved < 6 && pts.size === 0) self.tap(e.clientX, e.clientY);
      if (pts.size === 0) drag = null;
    }
    this.on(canvas, "pointerup", up);
    this.on(canvas, "pointercancel", up);
    this.on(
      canvas,
      "wheel",
      function (e) {
        e.preventDefault();
        self.cam.tzoom = Math.max(8, Math.min(70, self.cam.tzoom * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: false }
    );
    this.on(window, "keydown", function (e) {
      if (self.mode !== "play" || self.modalOpen) return;
      if (e.code === "Space") {
        e.preventDefault();
        self.setSpeed(self.speedIdx === 0 ? self.prevSpeed || 1 : 0);
      } else if (e.key >= "1" && e.key <= "3") self.setSpeed(+e.key);
      else if (e.key === "j") {
        self.tab = "jobs";
        self.renderPanel(true);
      } else if (e.key === "f") {
        self.tab = "fleet";
        self.renderPanel(true);
      }
    });
  };

  Game.prototype.titleAction = function (k) {
    var self = this;
    if (k === "new") this.startPlay(null, 0);
    else if (k === "continue") {
      var n = Slots.latest();
      var d = n && Slots.read(n);
      if (d) {
        try {
          this.startPlay(Sim().loadWorld(d), n);
          this.toast("Welcome back — Day " + this.world.day());
        } catch (e) {
          this.toast("That save couldn’t be read");
        }
      }
    } else if (k === "load") this.openSlots("load", function () {
      self.closeModal();
    });
    else if (k === "exit") window.returnToMenu && window.returnToMenu();
  };

  Game.prototype.setSpeed = function (i) {
    if (this.speedIdx) this.prevSpeed = this.speedIdx;
    this.speedIdx = i;
    this.paused = i === 0;
    var bs = this.root.querySelectorAll("[data-speed]");
    for (var k = 0; k < bs.length; k++) bs[k].classList.toggle("on", +bs[k].getAttribute("data-speed") === i);
  };

  Game.prototype.setPanelMin = function (v) {
    this.panelMin = v;
    this.q("panel").classList.toggle("min", v);
    this.root.classList.toggle("th-root-min", v);
    this.q("grip").innerHTML = v ? "&#9652;" : "&#9662;";
  };

  // Screen-pixel drag -> ground-plane delta for the ortho camera
  Game.prototype.screenToGroundDelta = function (dx, dy) {
    var c = this.cam;
    var unitsPerPx = (2 * c.zoom) / this.H;
    var rx = Math.cos(c.az),
      rz = -Math.sin(c.az); // camera right on the ground
    var fx = -Math.sin(c.az),
      fz = -Math.cos(c.az); // camera forward on the ground
    var sx = dx * unitsPerPx,
      sy = (dy * unitsPerPx) / Math.sin(c.pitch);
    return { x: rx * sx - fx * sy, z: rz * sx - fz * sy };
  };

  Game.prototype.project = function (x, y, z) {
    var v = this._pv || (this._pv = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (-v.y * 0.5 + 0.5) * this.H, vis: v.z < 1 && v.z > -1 };
  };

  Game.prototype.tap = function (sx, sy) {
    if (this.mode !== "play") return;
    var best = null,
      bd = 38 * 38;
    var self = this;
    this.world.trucks.forEach(function (t) {
      var p = self.world.pose(t);
      var s = self.project(p.x, 0.6, p.z);
      var d = (s.x - sx) * (s.x - sx) + (s.y - sy) * (s.y - sy);
      if (d < bd) {
        bd = d;
        best = t;
      }
    });
    if (best) {
      this.select(best.id, true);
      this.tab = "fleet";
      this.renderPanel(true);
      return;
    }
    var lot = null;
    bd = 34 * 34;
    this.map.lots.forEach(function (l) {
      var s = self.project(l.x, 1.0, l.z);
      var d = (s.x - sx) * (s.x - sx) + (s.y - sy) * (s.y - sy);
      if (d < bd) {
        bd = d;
        lot = l;
      }
    });
    if (lot) {
      var S = Sim();
      var what = lot.role === "producer" ? "makes " + S.GOODS[lot.good].name : lot.role === "hq" ? "your depot" : lot.role === "decor" ? (S.TOWNS[lot.town] || {}).name : "takes deliveries";
      this.toast(lot.emoji + " " + lot.label + " — " + what);
      return;
    }
    if (this.selected) {
      this.selected = null;
      this.follow = false;
      this.renderPanel(true);
    }
  };

  Game.prototype.select = function (id, follow) {
    this.selected = id;
    this.follow = !!follow;
    this.routeT = 0;
    if (follow) {
      this.viewName = null;
      this.markView();
    }
  };

  /* ---------- camera ---------- */

  var VIEWS = {
    maplewood: { x: -32, z: 0, w: 34, h: 34 },
    seabright: { x: 37, z: 2, w: 40, h: 32 },
    map: { x: 5, z: 0, w: 112, h: 36 },
  };

  Game.prototype.setView = function (name) {
    var v = VIEWS[name];
    if (!v) return;
    this.viewName = name;
    this.follow = false;
    this.fit(v);
    this.markView();
  };

  Game.prototype.markView = function () {
    var bs = this.root.querySelectorAll("[data-view]");
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-view") === this.viewName);
  };

  // The visible part of the screen (excluding the panel), in px
  Game.prototype.viewRect = function () {
    var r = { l: 0, t: 0, r: this.W, b: this.H };
    if (this.mode !== "play") return r;
    if (this.narrow) r.b = this.H - (this.panelMin ? 58 : Math.min(this.H * 0.44, 400));
    else r.r = this.W - 360;
    r.t = 56;
    return r;
  };

  Game.prototype.camAz = function () {
    // portrait screens turn the map so the long east-west axis runs up the screen
    return this.portrait ? 1.2 : 0.42;
  };

  Game.prototype.fit = function (v) {
    var c = this.cam;
    c.az = this.camAz();
    var rect = this.viewRect();
    var vw = rect.r - rect.l,
      vh = rect.b - rect.t;
    // footprint of the box in camera-right / camera-up units
    var corners = [
      [v.x - v.w / 2, v.z - v.h / 2],
      [v.x + v.w / 2, v.z - v.h / 2],
      [v.x - v.w / 2, v.z + v.h / 2],
      [v.x + v.w / 2, v.z + v.h / 2],
    ];
    var rx = Math.cos(c.az),
      rz = -Math.sin(c.az);
    var fx = -Math.sin(c.az),
      fz = -Math.cos(c.az);
    var minR = Infinity,
      maxR = -Infinity,
      minU = Infinity,
      maxU = -Infinity;
    corners.forEach(function (p) {
      var r = p[0] * rx + p[1] * rz;
      var u = (p[0] * fx + p[1] * fz) * Math.sin(c.pitch);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
    });
    var needW = (maxR - minR) * 1.06,
      needH = (maxU - minU) * 1.08 + 3;
    // zoom = half the screen height in world units
    var zoomH = (needH / 2) * (this.H / vh);
    var zoomW = (needW / 2) * (this.H / vw);
    c.tzoom = Math.max(8, Math.min(75, Math.max(zoomH, zoomW)));
    // shift the target so the box centres in the visible rect, not the screen
    var upp = (2 * c.tzoom) / this.H;
    var offX = ((rect.l + rect.r) / 2 - this.W / 2) * upp;
    var offY = ((rect.t + rect.b) / 2 - this.H / 2) * upp;
    var g = this.screenToGroundDeltaAt(c.az, offX, offY);
    c.tx = v.x - g.x;
    c.tz = v.z - g.z;
  };

  Game.prototype.screenToGroundDeltaAt = function (az, ux, uy) {
    var rx = Math.cos(az),
      rz = -Math.sin(az);
    var fx = -Math.sin(az),
      fz = -Math.cos(az);
    var sy = uy / Math.sin(this.cam.pitch);
    return { x: rx * ux - fx * sy, z: rz * ux - fz * sy };
  };

  Game.prototype.updateCamera = function (dt) {
    var c = this.cam;
    if (this.mode === "title") {
      this.camT += dt;
      c.az = this.camAz() + Math.sin(this.camT * 0.05) * 0.25;
      var v = VIEWS.map;
      if (!this.titleFit || this.titleFit !== this.W + "x" + this.H) {
        this.titleFit = this.W + "x" + this.H;
        this.fit({ x: v.x, z: v.z + 4, w: this.portrait ? 70 : v.w, h: this.portrait ? 50 : v.h });
        c.zoom = c.tzoom;
        c.x = c.tx;
        c.z = c.tz;
      }
    } else if (this.follow && this.selected) {
      var t = this.world.truckById(this.selected);
      if (t) {
        var p = this.world.pose(t);
        var rect = this.viewRect();
        var upp = (2 * c.zoom) / this.H;
        var g = this.screenToGroundDeltaAt(c.az, ((rect.l + rect.r) / 2 - this.W / 2) * upp, ((rect.t + rect.b) / 2 - this.H / 2) * upp);
        c.tx = p.x - g.x;
        c.tz = p.z - g.z;
        if (c.tzoom > 22) c.tzoom = 18;
      }
    }
    var k = 1 - Math.exp(-dt * 5);
    c.x += (c.tx - c.x) * k;
    c.z += (c.tz - c.z) * k;
    c.zoom += (c.tzoom - c.zoom) * k;
    if (this.mode === "play") c.az += (this.camAz() - c.az) * k;
    var dist = 120;
    var cp = Math.cos(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.az) * cp * dist, Math.sin(c.pitch) * dist, c.z + Math.cos(c.az) * cp * dist);
    this.camera.lookAt(c.x, 0, c.z);
    var a = this.W / this.H;
    this.camera.left = -c.zoom * a;
    this.camera.right = c.zoom * a;
    this.camera.top = c.zoom;
    this.camera.bottom = -c.zoom;
    this.camera.updateProjectionMatrix();
    // shadows follow the camera target (keeps the shadow map tight)
    this.sun.position.set(c.x - 30, 60, c.z + 25);
    this.sun.target.position.set(c.x, 0, c.z);
  };

  /* ---------- frame ---------- */

  Game.prototype.frame = function (now) {
    var dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    var w = this.world;
    var speed = this.mode === "play" ? SPEEDS[this.speedIdx] : 1;
    var simDt = dt * speed;
    var steps = Math.ceil(simDt / (1 / 30));
    for (var i = 0; i < steps; i++) {
      if (this.demo) this.demoDispatch();
      w.step(simDt / steps);
    }
    this.handleEvents();
    this.updateCamera(dt);
    this.updateVehicles(dt);
    this.updateScenery(now / 1000);
    this.updateOverlay(dt);
    this.uiT -= dt;
    if (this.mode === "play" && this.uiT <= 0) {
      this.uiT = 0.25;
      this.renderPanel(false);
      this.updateHud();
    }
    this.renderer.render(this.scene, this.camera);
  };

  Game.prototype.demoDispatch = function () {
    var w = this.world;
    for (var i = 0; i < w.trucks.length; i++) {
      var t = w.trucks[i];
      if (!t.job && !t.queue.length) {
        var j = w.board.filter(Boolean)[0];
        if (j) w.acceptJob(j.id, t.id);
      }
    }
    w.money = 1e6;
  };

  Game.prototype.handleEvents = function () {
    var w = this.world;
    var evs = w.events;
    if (!evs.length) return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === "emote") this.bubble(e.vid, e.kind, e.emoji);
      if (this.demo) continue;
      if (e.type === "pay") this.moneyPop(e.x, e.z, e.amount, e.bonus);
      else if (e.type === "jobDone") {
        var t = w.truckById(e.truck);
        this.toast((e.onTime ? "⭐ " : "") + (t ? t.name : "Truck") + " finished a route" + (e.onTime ? " on time!" : " (late, no bonus)"));
        this.lastSig = "";
      } else if (e.type === "dayEnd") {
        this.toast("Day " + e.day + " done: earned " + money(e.earned) + ", fuel " + money(e.fuel) + ", upkeep " + money(e.upkeep));
      } else if (e.type === "toast") this.toast(e.text);
    }
    evs.length = 0;
  };

  Game.prototype.updateVehicles = function (dt) {
    var w = this.world;
    var self = this;
    var alive = {};
    w.vehicles.forEach(function (v) {
      alive[v.id] = 1;
      var m = self.vehicleMesh(v);
      var p = w.pose(v);
      m.position.x = p.x;
      m.position.z = p.z;
      // bounce while loading / unloading
      var bob = 0;
      if (v.kind === "truck" && v.task && (v.task.phase === "loading" || v.task.phase === "unloading")) bob = Math.abs(Math.sin(performance.now() / 120)) * 0.06;
      m.position.y = bob + Math.sin(performance.now() / 90 + v.id) * 0.012 * Math.min(1, v.v);
      var dh = p.heading - m.rotation.y;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      m.rotation.y += dh * Math.min(1, dt * 14);
      // brake squat
      m.rotation.x = Math.max(-0.06, Math.min(0.06, -v.acc * 0.012));
    });
    this.vehMeshes.forEach(function (m, id) {
      if (!alive[id]) {
        self.scene.remove(m);
        self.vehMeshes.delete(id);
      }
    });
    // selection ring + route ribbon
    var sel = this.selected && w.truckById(this.selected);
    this.selRing.visible = !!sel && this.mode === "play";
    if (sel) {
      var sp = w.pose(sel);
      this.selRing.position.set(sp.x, 0.07, sp.z);
      var s = 1 + Math.sin(performance.now() / 250) * 0.06;
      this.selRing.scale.set(s, s, s);
      this.routeT -= dt;
      if (this.routeT <= 0) {
        this.routeT = 0.2;
        this.setRoute(w.routePolyline(sel), sel.color);
      }
    } else if (this.routeMesh) this.setRoute(null);
  };

  Game.prototype.setRoute = function (pts, color) {
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      this.routeMesh = null;
    }
    if (!pts || pts.length < 2) return;
    var pos = [];
    var wdt = 0.28;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i],
        b = pts[i + 1];
      var dx = b[0] - a[0],
        dz = b[1] - a[1];
      var l = Math.sqrt(dx * dx + dz * dz);
      if (l < 1e-4) continue;
      var nx = (-dz / l) * wdt,
        nz = (dx / l) * wdt;
      var y = 0.09;
      pos.push(a[0] + nx, y, a[1] + nz, a[0] - nx, y, a[1] - nz, b[0] + nx, y, b[1] + nz);
      pos.push(b[0] + nx, y, b[1] + nz, a[0] - nx, y, a[1] - nz, b[0] - nx, y, b[1] - nz);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (!this.routeMat) this.routeMat = new THREE.MeshBasicMaterial({ color: "#7a5cff", transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.routeMat.color.set(color || "#7a5cff");
    this.routeMesh = new THREE.Mesh(g, this.routeMat);
    this.routeMesh.renderOrder = 2;
    this.scene.add(this.routeMesh);
  };

  Game.prototype.updateScenery = function (t) {
    this.water.uniforms.uTime.value = t;
    this.windmill.rotation.z = t * 0.8;
    this.boats.forEach(function (b, i) {
      b.position.y = Math.sin(t * 1.3 + i) * 0.08;
      b.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.06;
    });
    var S = Sim();
    this.signals.forEach(function (s) {
      var col = S.signalFor(s.node, s.lane);
      var idx = col === "red" ? 0 : col === "yellow" ? 1 : 2;
      s.lights.forEach(function (l, i) {
        l.mesh.material.color.copy(i === idx ? l.on : l.off);
      });
    });
    // a gentle day: warm morning, bright noon, golden evening
    var f = this.world.dayFrac();
    var warm = Math.max(0, Math.abs(f - 0.5) * 2 - 0.4) / 0.6;
    this.sun.color.setRGB(1, 0.95 - warm * 0.18, 0.85 - warm * 0.35);
    this.hemi.intensity = 1.15 - warm * 0.15;
  };

  /* ---------- overlay: labels, pins, bubbles ---------- */

  Game.prototype.updateOverlay = function (dt) {
    var self = this;
    var play = this.mode === "play";
    var zoomedOut = this.cam.zoom > 30;
    this.labels.forEach(function (l) {
      var p = self.project(l.x, l.y, l.z);
      var show = p.vis && p.x > -80 && p.x < self.W + 80 && p.y > -40 && p.y < self.H + 40;
      if (l.kind === "lot") show = show && play;
      else if (play) show = show && self.cam.zoom > 24; // town names only when zoomed out
      l.el.style.display = show ? "" : "none";
      if (show) {
        l.el.style.left = p.x + "px";
        l.el.style.top = p.y + "px";
        if (l.kind === "lot") l.el.classList.toggle("small", zoomedOut);
      }
    });
    this.updatePins();
    var w = this.world;
    for (var i = this.bubbles.length - 1; i >= 0; i--) {
      var b = this.bubbles[i];
      b.t -= dt;
      var v = null;
      for (var k = 0; k < w.vehicles.length; k++) if (w.vehicles[k].id === b.vid) v = w.vehicles[k];
      if (b.t <= 0 || !v) {
        b.el.remove();
        this.bubbles.splice(i, 1);
        continue;
      }
      var pp = w.pose(v);
      var sp = this.project(pp.x, v.kind === "truck" ? 1.9 : 1.5, pp.z);
      b.el.style.left = sp.x + "px";
      b.el.style.top = sp.y + "px";
      b.el.style.opacity = Math.min(1, b.t * 3);
    }
    for (var j = this.pops.length - 1; j >= 0; j--) {
      var p2 = this.pops[j];
      p2.t += dt;
      if (p2.t > 1.6) {
        p2.el.remove();
        this.pops.splice(j, 1);
        continue;
      }
      var s2 = this.project(p2.x, 2.5 + p2.t * 2.2, p2.z);
      p2.el.style.left = s2.x + "px";
      p2.el.style.top = s2.y + "px";
      p2.el.style.opacity = Math.min(1, (1.6 - p2.t) * 2.5);
    }
  };

  var EMOTES = { honk: "beep beep!", wave: "👋", brake: "❗", wait: "…", load: "" };

  Game.prototype.bubble = function (vid, kind, emoji) {
    if (this.bubbles.length > 14) return;
    for (var i = 0; i < this.bubbles.length; i++) if (this.bubbles[i].vid === vid) return;
    var el = document.createElement("div");
    el.className = "th-bubble";
    el.textContent = kind === "load" ? (emoji || "📦") + " loading" : EMOTES[kind] || "!";
    this.q("float").appendChild(el);
    this.bubbles.push({ el: el, vid: vid, t: kind === "load" ? 2.2 : 1.6 });
  };

  Game.prototype.moneyPop = function (x, z, amount, bonus) {
    var el = document.createElement("div");
    el.className = "th-money" + (bonus ? " bonus" : "");
    el.textContent = "+" + money(amount) + (bonus ? " ⭐" : "");
    this.q("float").appendChild(el);
    this.pops.push({ el: el, x: x, z: z, t: 0 });
  };

  Game.prototype.clearPins = function () {
    (this.pins || []).forEach(function (p) {
      p.el.remove();
    });
    this.pins = [];
    this.pinSig = "";
  };

  // Pins for the hovered job, or the selected truck's current job.
  Game.prototype.updatePins = function () {
    var w = this.world;
    var job = null,
      done = 0,
      phase = "";
    if (this.mode === "play") {
      if (this.hoverJob) job = w.jobById(this.hoverJob);
      if (!job && this.assigning) job = w.jobById(this.assigning);
      if (!job && this.selected) {
        var t = w.truckById(this.selected);
        if (t && t.job) {
          job = t.job;
          phase = t.task.phase;
          done = phase === "deliver" || phase === "unloading" ? t.task.stopIdx : 0;
        }
      }
    }
    var sig = job ? job.id + ":" + done + ":" + phase : "";
    if (sig !== this.pinSig) {
      this.clearPins();
      this.pinSig = sig;
      if (job) {
        var float = this.q("float");
        var self = this;
        var add = function (lot, text, cls) {
          var el = document.createElement("div");
          el.className = "th-pin " + cls;
          el.textContent = text;
          float.appendChild(el);
          self.pins.push({ el: el, x: lot.x, z: lot.z });
        };
        var picked = phase === "deliver" || phase === "unloading";
        add(w.lotById[job.from], Sim().GOODS[job.good].emoji, "pick" + (picked ? " done" : ""));
        job.stops.forEach(function (id, i) {
          add(w.lotById[id], String(i + 1), i < done ? "done" : "");
        });
      }
    }
    var self2 = this;
    (this.pins || []).forEach(function (p) {
      var s = self2.project(p.x, 2.6, p.z);
      p.el.style.left = s.x + "px";
      p.el.style.top = s.y + "px";
    });
  };

  Game.prototype.toast = function (text) {
    var box = this.q("toasts");
    var el = document.createElement("div");
    el.className = "th-toast";
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.remove();
    }, 3300);
  };

  /* ---------- HUD + panel ---------- */

  Game.prototype.updateHud = function () {
    var w = this.world;
    var m = this.q("money");
    m.textContent = money(w.money);
    m.classList.toggle("neg", w.money < 0);
    this.q("clock").textContent = "Day " + w.day() + " · " + w.clockText();
    this.q("daybar").style.width = (w.dayFrac() * 100).toFixed(1) + "%";
  };

  Game.prototype.renderPanel = function (force) {
    var w = this.world;
    var S = Sim();
    var tabs = this.root.querySelectorAll("[data-tab]");
    for (var i = 0; i < tabs.length; i++) {
      var k = tabs[i].getAttribute("data-tab");
      tabs[i].classList.toggle("on", k === this.tab);
      var count = k === "jobs" ? w.board.filter(Boolean).length : w.trucks.length;
      tabs[i].textContent = (k === "jobs" ? "Jobs" : "Fleet") + " (" + count + ")";
    }
    // structure signature: re-render only when something structural changed
    var sig =
      this.tab +
      "|" +
      this.assigning +
      "|" +
      this.selected +
      "|" +
      w.board
        .map(function (j) {
          return j ? j.id : "-";
        })
        .join(",") +
      "|" +
      w.trucks
        .map(function (t) {
          return t.id + ":" + (t.job ? t.job.id + t.task.phase + t.task.stopIdx : "i") + ":" + t.queue.length;
        })
        .join(",") +
      "|" +
      (w.truckCost() !== null && w.money >= w.truckCost());
    var body = this.q("body");
    if (force || sig !== this.lastSig) {
      this.lastSig = sig;
      var st = body.scrollTop;
      body.innerHTML = this.tab === "jobs" ? this.jobsHtml() : this.fleetHtml();
      body.scrollTop = st;
    }
    // live bits
    var now = w.t;
    var exps = body.querySelectorAll("[data-exp]");
    for (var e = 0; e < exps.length; e++) {
      var j = w.jobById(+exps[e].getAttribute("data-exp"));
      if (j) exps[e].style.width = Math.max(0, Math.min(100, ((j.expires - now) / (j.expires - j.posted)) * 100)) + "%";
    }
    var self = this;
    var sts = body.querySelectorAll("[data-status]");
    for (var s = 0; s < sts.length; s++) {
      var t = w.truckById(+sts[s].getAttribute("data-status"));
      if (t) sts[s].textContent = w.truckStatus(t);
    }
    var tms = body.querySelectorAll("[data-timer]");
    for (var q = 0; q < tms.length; q++) {
      var tt = w.truckById(+tms[q].getAttribute("data-timer"));
      if (!tt || !tt.job) continue;
      var txt = "";
      var late = false;
      if (tt.task.started >= 0) {
        var left = tt.job.deadline - (now - tt.task.started);
        late = left < 0;
        txt = late ? "Late — no bonus" : "⏱ " + Math.ceil(left) + "s for +" + money(tt.job.bonus);
      } else txt = "⏱ " + tt.job.deadline + "s once loaded";
      tms[q].textContent = txt;
      tms[q].classList.toggle("late", late);
    }
    void self;
    void S;
  };

  Game.prototype.jobsHtml = function () {
    var w = this.world;
    var S = Sim();
    var self = this;
    var h = '<div class="th-hint">Tap <b>Assign</b> to send a truck. Hover or tap a card to see its stops on the map.</div>';
    w.board.forEach(function (j) {
      if (!j) {
        h += '<div class="th-card empty">New job coming in…</div>';
        return;
      }
      var from = w.lotById[j.from];
      var g = S.GOODS[j.good];
      var dest = S.TOWNS[j.destTown].name;
      h += '<div class="th-card' + (self.hoverJob === j.id || self.assigning === j.id ? " hot" : "") + '" data-jobcard="' + j.id + '" data-job="' + j.id + '">';
      h += '<div class="th-jh"><div class="th-good">' + g.emoji + '</div><div class="th-jt"><b>' + esc(g.name) + " &times; " + j.stops.length + "</b><small>" + esc(from.label) + " &rarr; " + dest + (j.cross ? " \uD83D\uDEE3\uFE0F" : "") + "</small></div>";
      h += '<div class="th-pay">' + money(j.pay) + "<small>+" + money(j.bonus) + " on time</small></div></div>";
      h += '<div class="th-stops">';
      j.stops.forEach(function (id, i) {
        var l = w.lotById[id];
        h += '<span class="th-stop' + (j.cross ? " x" : "") + '">' + (i + 1) + ". " + l.emoji + " " + esc(l.label) + "</span>";
      });
      h += "</div>";
      h += '<div class="th-meta"><span>' + j.dist + "m</span><span>⏱ " + j.deadline + 's</span><span class="th-exp"><i data-exp="' + j.id + '"></i></span><button class="th-btn" data-job="' + j.id + '">Assign</button></div>';
      if (self.assigning === j.id) {
        h += '<div class="th-assign">';
        w.trucks.forEach(function (t) {
          var busy = !!t.job;
          var full = busy && t.queue.length >= S.C.QUEUE_MAX;
          h +=
            '<button class="th-btn' +
            (busy ? " alt" : "") +
            '" data-assign="' +
            t.id +
            '" data-job-id="' +
            j.id +
            '"' +
            (full ? " disabled" : "") +
            '><span class="th-dot" style="background:' +
            t.color +
            '"></span>' +
            esc(t.name) +
            (busy ? " (queue " + t.queue.length + "/" + S.C.QUEUE_MAX + ")" : " ✓ idle") +
            "</button>";
        });
        h += "</div>";
      }
      h += "</div>";
    });
    return h;
  };

  Game.prototype.fleetHtml = function () {
    var w = this.world;
    var S = Sim();
    var self = this;
    var h = "";
    w.trucks.forEach(function (t) {
      h += '<div class="th-card th-truck' + (self.selected === t.id ? " hot" : "") + '" data-truck="' + t.id + '">';
      h += '<div class="th-jh"><span class="th-dot" style="width:22px;height:22px;background:' + t.color + '"></span><div class="th-jt"><b>' + esc(t.name) + '</b><small class="th-status" data-status="' + t.id + '">' + esc(w.truckStatus(t)) + "</small></div>";
      if (t.job) h += '<div class="th-pay">' + S.GOODS[t.job.good].emoji + " " + money(t.job.pay) + "</div>";
      h += "</div>";
      if (t.job) {
        var n = t.job.stops.length;
        var picked = t.task.phase === "deliver" || t.task.phase === "unloading";
        h += '<div class="th-prog"><i class="' + (picked ? "on" : "cur") + '"></i>';
        for (var i = 0; i < n; i++) h += '<i class="' + (picked && i < t.task.stopIdx ? "on" : picked && i === t.task.stopIdx ? "cur" : "") + '"></i>';
        h += '</div><div class="th-timer" data-timer="' + t.id + '"></div>';
      }
      if (t.queue.length) {
        h += '<div class="th-q">';
        t.queue.forEach(function (j) {
          h += "<div>" + S.GOODS[j.good].emoji + "<span>Next: " + esc(S.GOODS[j.good].name) + " · " + j.stops.length + " stop" + (j.stops.length > 1 ? "s" : "") + " · " + money(j.pay) + '</span><button data-cancel="' + t.id + ":" + j.id + '" title="Drop this job">✕</button></div>';
        });
        h += "</div>";
      }
      h += "</div>";
    });
    var cost = w.truckCost();
    if (cost !== null)
      h +=
        '<div class="th-buy"><span>&#128666; Hire another truck &amp; driver<br><small style="opacity:.7">+' +
        money(S.C.UPKEEP) +
        '/day upkeep</small></span><button class="th-btn" data-buy="1"' +
        (w.money < cost ? " disabled" : "") +
        ">Buy " +
        money(cost) +
        "</button></div>";
    else h += '<div class="th-hint">Your fleet is full — nice work!</div>';
    var st = w.stats;
    h +=
      '<div class="th-stats"><span>Routes done: ' +
      st.jobs +
      "</span><span>On time: " +
      (st.jobs ? Math.round((st.onTime / st.jobs) * 100) : 0) +
      "%</span><span>Drops: " +
      st.delivered +
      "</span><span>Earned: " +
      money(st.earned) +
      "</span><span>Fuel: " +
      money(st.fuel) +
      "</span><span>Upkeep: " +
      money(st.upkeep) +
      "</span></div>";
    return h;
  };

  Game.prototype.fatal = function (msg) {
    if (this.destroyed) return;
    this.destroy();
    showFatal(this.root, msg);
  };

  Game.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.listeners.forEach(function (l) {
      l[0].removeEventListener(l[1], l[2], l[3]);
    });
    this.clearVehicles();
    this.scene.traverse(function (o) {
      if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    this.renderer.dispose();
  };

  function isShared(g) {
    for (var k in G) if (G[k] === g) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function showFatal(root, msg) {
    root.innerHTML =
      '<div class="th-fatal"><div class="th-sheet"><h2>Can’t start the trucks</h2><p>' +
      esc(msg) +
      '</p><div class="th-row"><button class="th-btn" data-fatal>Menu</button></div></div></div>';
    var b = root.querySelector("[data-fatal]");
    if (b)
      b.addEventListener("click", function () {
        if (window.returnToMenu) window.returnToMenu();
      });
  }

  function injectStyle() {
    if (document.getElementById("th-style")) return;
    var s = document.createElement("style");
    s.id = "th-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureThree() {
    if (THREE && mergeGeometries) return Promise.resolve();
    return import(THREE_URL)
      .then(function (mod) {
        THREE = mod;
        return import(BGU_URL);
      })
      .then(function (mod) {
        mergeGeometries = mod.mergeGeometries;
        if (!G.box) initGeoms();
        return ART || ART_OFF ? null : loadArt();
      });
  }

  function loadArt() {
    var names = Object.keys(ART_SPEC);
    if (!names.length) return Promise.resolve();
    return import(GLTF_URL)
      .then(function (mod) {
        var loader = new mod.GLTFLoader();
        // each model is optional: a missing one falls back to its primitive
        return Promise.all(
          names.map(function (n) {
            return loader.loadAsync(MODEL_BASE + n + ".glb").catch(function () {
              return null;
            });
          })
        ).then(function (gl) {
          var art = {};
          var any = false;
          names.forEach(function (n, i) {
            if (gl[i]) {
              art[n] = gl[i].scene;
              any = true;
            }
          });
          if (any) ART = art;
        });
      })
      .catch(function (e) {
        console.warn("Tiny Haulers: art failed to load, using primitives", e);
      });
  }

  function launchTinyHaulers() {
    if (window.tinyHaulersGame) return window.tinyHaulersGame;
    injectStyle();
    var root = document.createElement("div");
    root.id = "th-root";
    root.innerHTML = '<div class="th-loading">Warming up the engines&hellip;</div>';
    document.getElementById("game-container").appendChild(root);
    var handle = {
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
    window.tinyHaulersGame = handle;
    if (!Sim()) {
      showFatal(root, "The simulation script didn’t load.");
      return handle;
    }
    ensureThree()
      .then(function () {
        if (handle.cancelled) return;
        root.innerHTML = HUD_HTML;
        handle.game = new Game(root, handle);
      })
      .catch(function (err) {
        if (handle.cancelled) return;
        showFatal(root, "This device couldn’t start 3D graphics for this game.");
        console.error("Tiny Haulers failed to start:", err);
      });
    return handle;
  }

  window.launchTinyHaulers = launchTinyHaulers;
})();
