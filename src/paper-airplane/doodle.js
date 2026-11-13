/*
 * Paper Airplane — doodle drawing helpers.
 *
 * Everything here draws onto a Phaser Graphics object in a hand-drawn, "ink pen
 * on notebook paper" style: wobbly double-stroked lines, jittered fills, hatch
 * shading. All wobble is SEEDED (deterministic), so a static drawing never
 * shimmers between frames and a level always looks the same.
 *
 * Exposes window.PaperAirplaneDoodle. No game logic lives here; colours are
 * passed in, so the art can be retuned from PALETTE in paper-airplane.js.
 */
(function (root, factory) {
  root.PaperAirplaneDoodle = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- randomness ----------
  // Small seeded PRNG (mulberry32): same seed, same doodle.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash() {
    let h = 2166136261;
    for (let i = 0; i < arguments.length; i++) {
      h ^= Math.round(arguments[i] * 10) | 0;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---------- lines ----------
  // A straight segment bent into a gently wavering polyline.
  function wobble(x1, y1, x2, y2, seed, amp) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(2, Math.round(len / 16));
    const nx = -dy / len, ny = dx / len;
    const r = rng(seed);
    const pts = [];
    let off = (r() - 0.5) * 2 * amp;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      off += ((r() - 0.5) * 2 * amp - off) * 0.6; // smooth, not jittery
      const e = i === 0 || i === n ? 0.35 : 1; // ends stay close to the corners
      pts.push({ x: x1 + dx * t + nx * off * e, y: y1 + dy * t + ny * off * e });
    }
    return pts;
  }

  function polyline(g, pts, width, color, alpha) {
    if (pts.length < 2) return;
    g.lineStyle(width, color, alpha === undefined ? 1 : alpha);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
  }

  // The signature stroke: a main pass plus a thinner, fainter second pass that
  // wanders off it slightly, like going over a line twice with a pen.
  // o: { seed, amp = 1.3, width = 2.5, color, alpha = 1, double = true, over = 0 }
  function line(g, x1, y1, x2, y2, o) {
    const amp = o.amp === undefined ? 1.3 : o.amp;
    const width = o.width === undefined ? 2.5 : o.width;
    const alpha = o.alpha === undefined ? 1 : o.alpha;
    const seed = o.seed === undefined ? hash(x1, y1, x2, y2) : o.seed;
    if (o.over) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      x1 -= (dx / len) * o.over; y1 -= (dy / len) * o.over;
      x2 += (dx / len) * o.over; y2 += (dy / len) * o.over;
    }
    polyline(g, wobble(x1, y1, x2, y2, seed, amp), width, o.color, alpha);
    if (o.double !== false) {
      polyline(g, wobble(x1, y1, x2, y2, seed + 101, amp * 1.25), Math.max(1, width * 0.5), o.color, alpha * 0.5);
    }
  }

  // ---------- shapes ----------
  // Filled polygon with jittered vertices and wobbly outline edges.
  // o: { seed, fill, fillAlpha = 1, color (outline), width, amp, closed = true, outline = true }
  function polygon(g, pts, o) {
    const amp = o.amp === undefined ? 1.3 : o.amp;
    const seed = o.seed === undefined ? hash(pts[0].x, pts[0].y, pts.length) : o.seed;
    const r = rng(seed);
    const j = pts.map((p) => ({ x: p.x + (r() - 0.5) * amp * 1.4, y: p.y + (r() - 0.5) * amp * 1.4 }));
    if (o.fill !== undefined) {
      g.fillStyle(o.fill, o.fillAlpha === undefined ? 1 : o.fillAlpha);
      g.fillPoints(j, true);
    }
    if (o.outline === false) return;
    const n = o.closed === false ? pts.length - 1 : pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      line(g, a.x, a.y, b.x, b.y, { seed: seed + i * 7, amp, width: o.width, color: o.color, alpha: o.alpha, over: 2.5 });
    }
  }

  function rect(g, x, y, w, h, o) {
    const amp = Math.min(o.amp === undefined ? 1.3 : o.amp, Math.max(0.3, Math.min(w, h) * 0.18));
    polygon(g, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], Object.assign({}, o, { amp, seed: o.seed === undefined ? hash(x, y, w, h) : o.seed }));
  }

  // Irregular ellipse (a puddle, a bumper, a crumpled ball).
  function blob(g, cx, cy, rx, ry, o) {
    const n = Math.max(10, Math.round((rx + ry) / 3));
    const wob = o.amp === undefined ? Math.min(rx, ry) * 0.12 : o.amp;
    const r = rng(o.seed === undefined ? hash(cx, cy, rx, ry) : o.seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + (r() - 0.5) * (wob / Math.max(1, Math.min(rx, ry))) * 2;
      pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
    }
    if (o.fill !== undefined) {
      g.fillStyle(o.fill, o.fillAlpha === undefined ? 1 : o.fillAlpha);
      g.fillPoints(pts, true);
    }
    if (o.outline !== false) {
      const closed = pts.concat([pts[0], pts[1]]);
      polyline(g, closed, o.width === undefined ? 2.5 : o.width, o.color, o.alpha);
      polyline(g, closed.map((p, i) => ({ x: p.x + Math.sin(i * 2.1) * 0.9, y: p.y + Math.cos(i * 1.7) * 0.9 })), Math.max(1, (o.width === undefined ? 2.5 : o.width) * 0.45), o.color, (o.alpha === undefined ? 1 : o.alpha) * 0.5);
    }
  }
  function circle(g, cx, cy, r, o) { blob(g, cx, cy, r, r, o); }

  function star(g, cx, cy, r, o) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.42;
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    polygon(g, pts, Object.assign({ amp: r * 0.06 }, o));
  }

  // 45-degree hatch lines clipped to a rect: pen shading.
  // o: { gap = 7, color, alpha = 0.5, width = 1.2, seed }
  function hatch(g, x, y, w, h, o) {
    const gap = o.gap || 7;
    const seed = o.seed === undefined ? hash(x, y, w, h) : o.seed;
    let k = 0;
    for (let c = -h; c < w; c += gap, k++) {
      // line from (x+c, y+h) up-right to (x+c+h, y), clipped to x..x+w
      const t0 = Math.max(0, -c / h), t1 = Math.min(1, (w - c) / h);
      if (t1 <= t0) continue;
      const ax = x + c + h * t0, ay = y + h - h * t0;
      const bx = x + c + h * t1, by = y + h - h * t1;
      polyline(g, wobble(ax, ay, bx, by, seed + k * 13, 0.8), o.width || 1.2, o.color, o.alpha === undefined ? 0.5 : o.alpha);
    }
  }

  // Zig-zag spring coil between two x extents, running top to bottom.
  function coil(g, x, y, w, h, turns, o) {
    const pts = [];
    const n = turns * 2;
    for (let i = 0; i <= n; i++) pts.push({ x: x + (i % 2 === 0 ? 0 : w), y: y + (h * i) / n });
    polyline(g, pts, o.width || 2.5, o.color, o.alpha);
  }

  // ---------- paper ----------
  // A faint speckle/fibre/vignette texture, generated once into a canvas texture.
  function makePaperGrain(scene, key, W, H) {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, W, H);
    const ctx = tex.getContext();
    const r = rng(20240531);
    // soft vignette: the page is a touch darker toward the corners
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, "rgba(120,90,50,0)");
    grad.addColorStop(1, "rgba(120,90,50,0.16)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // a couple of faint tan stains
    for (let i = 0; i < 4; i++) {
      const sx = r() * W, sy = r() * H, sr = 60 + r() * 90;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      sg.addColorStop(0, "rgba(150,110,60,0.06)");
      sg.addColorStop(1, "rgba(150,110,60,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    // speckles
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = "rgba(90,70,40," + (0.025 + r() * 0.06).toFixed(3) + ")";
      const s = 0.6 + r() * 1.4;
      ctx.fillRect(r() * W, r() * H, s, s);
    }
    // short paper fibres
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 90; i++) {
      const fx = r() * W, fy = r() * H, a = r() * Math.PI, l = 4 + r() * 9;
      ctx.strokeStyle = "rgba(110,85,50," + (0.04 + r() * 0.05).toFixed(3) + ")";
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(fx + Math.cos(a) * l * 0.5, fy + Math.sin(a) * l * 0.5 + 1.5, fx + Math.cos(a) * l, fy + Math.sin(a) * l);
      ctx.stroke();
    }
    tex.refresh();
  }

  // ---------- desk doodles (decor props) ----------
  const rot = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

  const PROPS = {
    mug(g, cx, cy, s, c) {
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 1 };
      rect(g, cx - 14 * s, cy - 12 * s, 28 * s, 26 * s, Object.assign({ seed: 11 }, o));
      const handle = [];
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; handle.push({ x: cx + 14 * s + Math.cos(a) * 9 * s, y: cy + 1 * s + Math.sin(a) * 9 * s }); }
      polyline(g, handle, 2, c.ink, c.alpha);
      for (let k = 0; k < 2; k++) {
        const steam = [];
        for (let i = 0; i <= 8; i++) steam.push({ x: cx + (k ? 4 : -5) * s + Math.sin(i * 0.9 + k) * 3 * s, y: cy - 16 * s - i * 2.2 * s });
        polyline(g, steam, 1.6, c.ink, c.alpha * 0.8);
      }
    },
    plant(g, cx, cy, s, c) {
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 1 };
      polygon(g, [{ x: cx - 12 * s, y: cy + 6 * s }, { x: cx + 12 * s, y: cy + 6 * s }, { x: cx + 9 * s, y: cy + 24 * s }, { x: cx - 9 * s, y: cy + 24 * s }], Object.assign({ seed: 21 }, o));
      [[-18, -14], [0, -26], [18, -12]].forEach(([tx, ty], i) => {
        polygon(g, [{ x: cx, y: cy + 6 * s }, { x: cx + tx * 0.45 * s - 5 * s, y: cy + ty * 0.45 * s }, { x: cx + tx * s, y: cy + ty * s }, { x: cx + tx * 0.45 * s + 5 * s, y: cy + ty * 0.45 * s }], Object.assign({ seed: 22 + i }, o));
      });
    },
    clip(g, cx, cy, s, c) {
      const p = [[-6, 12], [-6, -8], [-3, -13], [3, -13], [6, -8], [6, 8], [2, 12], [-2, 12], [-2, -5], [2, -5]].map(([x, y]) => ({ x: cx + x * s, y: cy + y * s }));
      polyline(g, p, 2, c.ink, c.alpha);
    },
    pencil(g, cx, cy, s, c) {
      const a = -0.7;
      const P = (x, y) => { const r = rot({ x: x * s, y: y * s }, a); return { x: cx + r.x, y: cy + r.y }; };
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 0.8 };
      polygon(g, [P(-26, -4), P(14, -4), P(14, 4), P(-26, 4)], Object.assign({ seed: 31 }, o));
      polygon(g, [P(14, -4), P(26, 0), P(14, 4)], Object.assign({ seed: 32 }, o));
      line(g, P(-20, -4).x, P(-20, -4).y, P(-20, 4).x, P(-20, 4).y, { color: c.ink, alpha: c.alpha, width: 1.5, seed: 33 });
    },
    sticky(g, cx, cy, s, c) {
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 1 };
      const x = cx - 16 * s, y = cy - 16 * s, w = 32 * s;
      polygon(g, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w - 8 * s }, { x: x + w - 8 * s, y: y + w }, { x, y: y + w }], Object.assign({ seed: 41 }, o));
      polyline(g, [{ x: x + w - 8 * s, y: y + w }, { x: x + w - 8 * s, y: y + w - 8 * s }, { x: x + w, y: y + w - 8 * s }], 1.6, c.ink, c.alpha);
      for (let i = 0; i < 3; i++) line(g, x + 5 * s, y + (8 + i * 7) * s, x + (24 - i * 4) * s, y + (8 + i * 7) * s, { color: c.ink, alpha: c.alpha * 0.8, width: 1.4, seed: 42 + i, amp: 0.8 });
    },
    lamp(g, cx, cy, s, c) {
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 0.9 };
      blob(g, cx, cy + 20 * s, 14 * s, 4 * s, Object.assign({ seed: 51 }, o));
      polyline(g, [{ x: cx, y: cy + 18 * s }, { x: cx - 6 * s, y: cy - 2 * s }, { x: cx + 8 * s, y: cy - 16 * s }], 2, c.ink, c.alpha);
      polygon(g, [{ x: cx + 2 * s, y: cy - 22 * s }, { x: cx + 22 * s, y: cy - 14 * s }, { x: cx + 14 * s, y: cy - 4 * s }, { x: cx - 2 * s, y: cy - 12 * s }], Object.assign({ seed: 52 }, o));
    },
    stapler(g, cx, cy, s, c) {
      const o = { color: c.ink, alpha: c.alpha, width: 2, amp: 0.9 };
      rect(g, cx - 22 * s, cy - 2 * s, 44 * s, 9 * s, Object.assign({ seed: 61 }, o));
      polygon(g, [{ x: cx - 22 * s, y: cy - 2 * s }, { x: cx + 20 * s, y: cy - 10 * s }, { x: cx + 22 * s, y: cy - 2 * s }], Object.assign({ seed: 62 }, o));
    },
    ring(g, cx, cy, s, c) {
      circle(g, cx, cy, 15 * s, { seed: 71, color: c.coffee, alpha: c.alpha * 0.9, width: 3, amp: 1.2 });
      circle(g, cx + 1, cy - 1, 12 * s, { seed: 72, color: c.coffee, alpha: c.alpha * 0.45, width: 1.5, amp: 1.2 });
    },
  };
  const PROP_NAMES = Object.keys(PROPS);

  // Choose spots for decor props in the free areas of a level: not touching any
  // gameplay rect (inflated), not in the HUD band, and not on top of each other.
  // avoid: array of {x, y, w, h}. Returns [{kind, x, y, s}].
  function placeDecor(seed, avoid, W, H, count) {
    const r = rng(seed);
    const placed = [];
    // Shuffle the prop kinds so one level never repeats a prop.
    const order = PROP_NAMES.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let n = 0; n < count; n++) {
      for (let tries = 0; tries < 80; tries++) {
        const kind = order[n % order.length];
        const s = 0.85 + r() * 0.55;
        const rad = 30 * s;
        const x = 56 + rad + r() * (W - 112 - rad * 2);
        const y = 120 + rad + r() * (H - 190 - rad * 2);
        const clear = avoid.every((a) => x + rad + 18 < a.x || x - rad - 18 > a.x + a.w || y + rad + 18 < a.y || y - rad - 18 > a.y + a.h);
        const apart = placed.every((p) => Math.hypot(p.x - x, p.y - y) > 78);
        if (clear && apart) { placed.push({ kind, x, y, s }); break; }
      }
    }
    return placed;
  }

  function drawDecor(g, decor, colors) {
    decor.forEach((d) => PROPS[d.kind](g, d.x, d.y, d.s, colors));
  }

  return { rng, hash, wobble, polyline, line, polygon, rect, blob, circle, star, hatch, coil, makePaperGrain, placeDecor, drawDecor, PROP_NAMES };
});
