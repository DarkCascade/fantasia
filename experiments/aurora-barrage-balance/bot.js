#!/usr/bin/env node
/*
 * Aurora Barrage balance bot. Plays the REAL sim (src/aurora-barrage/sim.js) headlessly
 * with a simple danger-field controller at several skill levels and reports how far each gets.
 *
 *   node experiments/aurora-barrage-balance/bot.js [seeds=12] [skill=all|idle|dodge|good|great] [maxMinutes=14]
 *
 * idle  = never moves (floor: how long can you survive doing nothing?)
 * dodge = sidesteps bullets, ignores orbs, sits under targets
 * good  = dodge + collects orbs when safe (a decent human)
 * great = good with wider lookahead and snappier decisions (a very good human)
 */
const S = require("../../src/aurora-barrage/sim.js");
const { W, H } = S;

const SKILLS = {
  idle: null,
  dodge: { every: 6, look: [0.12, 0.25, 0.4], reach: 150, orbs: 0, aimUnder: 1 },
  good: { every: 4, look: [0.1, 0.22, 0.36, 0.5], reach: 190, orbs: 1, aimUnder: 1 },
  great: { every: 2, look: [0.08, 0.18, 0.3, 0.45, 0.6], reach: 230, orbs: 1.3, aimUnder: 1 },
};

function danger(w, cx, cy, K, t0) {
  t0 = t0 || 0;
  let d = 0;
  for (const b of w.ebullets) {
    const dx0 = b.x - cx, dy0 = b.y - cy;
    if (Math.abs(dx0) > 240 || Math.abs(dy0) > 240) continue;
    for (let i = 0; i < K.look.length; i++) {
      const t = K.look[i] * 0.6 + t0;
      const dx = b.x + b.vx * t - cx, dy = b.y + b.vy * t - cy;
      const r = 17 + t * 40;
      const dd = dx * dx + dy * dy;
      if (dd < r * r) d += 6 / (1 + i);
      else if (dd < (r + 26) * (r + 26)) d += 0.6;
    }
  }
  for (const e of w.enemies) {
    if (e.dead) continue;
    const rr = e.r * 0.8 + 26;
    for (const t of [t0, t0 + 0.15, t0 + 0.3, t0 + 0.45]) {
      const ex = e.x + (e.kind === "scout" ? (e.vx + e.amp * e.freq * Math.cos(e.freq * e.t + e.ph)) * t : 0);
      const ey = e.y + (e.kind === "scout" ? e.vy * t : 0);
      const dx = ex - cx, dy = ey - cy;
      if (dx * dx + dy * dy < rr * rr) { d += 10; break; }
    }
  }
  return d;
}

function decide(w, K) {
  const p = w.player;
  let best = null, bs = -1e9;
  // nearest orb we might chase
  let orb = null, od = 1e9;
  if (K.orbs) for (const o of w.orbs) {
    const d = Math.hypot(o.x - p.x, o.y - p.y) - o.v * 2;
    if (d < od) { od = d; orb = o; }
  }
  // the enemy we'd like to sit under: the closest one that is on screen
  let tgt = null, td = 1e9;
  for (const e of w.enemies) {
    if (e.dead || e.y < 20) continue;
    if (e.kind === "boss") { tgt = e; td = -1; break; } // humans focus the boss
    const d = Math.abs(e.x - p.x) + Math.max(0, p.y - e.y) * 0.1;
    if (d < td) { td = d; tgt = e; }
  }
  const R = K.reach, step = R / 4;
  for (let gx = -4; gx <= 4; gx++) for (let gy = -4; gy <= 4; gy++) {
    const cx = Math.max(22, Math.min(W - 22, p.x + gx * step)), cy = Math.max(120, Math.min(H - 50, p.y + gy * step));
    // judge the whole move (the ship really sweeps through everything on the way), not just where it lands
    let dg = 0;
    const L = Math.hypot(cx - p.x, cy - p.y);
    for (const f of [0.34, 0.67, 1]) dg += danger(w, p.x + (cx - p.x) * f, p.y + (cy - p.y) * f, K, (L * f) / 1200) * (f === 1 ? 1.5 : 1);
    let sc = -dg * 10;
    if (orb) sc -= Math.hypot(orb.x - cx, orb.y - cy) * 0.03 * K.orbs;
    if (tgt && K.aimUnder) sc -= Math.abs(tgt.x - cx) * 0.012;
    sc -= Math.abs(cy - (H - 230)) * 0.004; // drift toward the lower third, but orbs can pull us up
    sc -= Math.hypot(gx, gy) * 0.05; // small preference for staying put
    if (sc > bs) { bs = sc; best = [cx, cy]; }
  }
  return best;
}

function play(seed, skill, maxMin) {
  const w = new S.World({ seed });
  const K = SKILLS[skill];
  const log = [];
  let frame = 0, boss1 = null, lvl = {};
  const bossT = {}, by = {};
  while (!w.over && w.t < maxMin * 60) {
    if (K && frame % K.every === 0) { const t = decide(w, K); if (t) w.setTarget(t[0], t[1]); }
    w.step(S.STEP);
    frame++;
    for (const e of w.drainEvents()) {
      if (e.t === "boss" && !bossT[w.stage]) bossT[w.stage] = { in: w.t };
      if (e.t === "bossDown") bossT[w.stage].out = w.t;
      if (e.t === "hurt") by[e.by] = (by[e.by] || 0) + 1;
      if (e.t === "hurt" && process.env.DEBUG) {
        const p = w.player, ne = w.enemies.map((q) => ({ k: q.kind, d: Math.round(Math.hypot(q.x - p.x, q.y - p.y) - q.r) })).sort((a, b) => a.d - b.d)[0];
        console.log(`  hurt t=${w.t.toFixed(1)} pos=${p.x | 0},${p.y | 0} lvl=${p.level} nearEnemy=${JSON.stringify(ne)} bullets=${w.ebullets.length}`);
      }
    }
    if (frame % 3600 === 0) lvl[Math.round(w.t / 60)] = w.player.level;
  }
  return { seed, t: w.t, level: w.player.level, maxLevel: w.maxLevel, stage: w.stage, bosses: w.bossesDown, hits: w.hitsTaken, score: w.score, lvl, bossT, over: w.over, kills: w.kills, lost: w.orbsLost, by, stageAtDeath: w.stage, bossAtDeath: !!w.boss };
}

const seeds = +process.argv[2] || 12;
const which = process.argv[3] && process.argv[3] !== "all" ? [process.argv[3]] : Object.keys(SKILLS);
const maxMin = +process.argv[4] || 14;
for (const skill of which) {
  const rs = [];
  const t0 = Date.now();
  for (let s = 1; s <= seeds; s++) rs.push(play(s, skill, maxMin));
  const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length);
  const med = (f) => { const a = rs.map(f).sort((x, y) => x - y); return a[a.length >> 1]; };
  console.log(`\n== ${skill}  (${seeds} runs, cap ${maxMin} min, ${((Date.now() - t0) / 1000).toFixed(1)}s) ==`);
  console.log(`survived  med ${med((r) => r.t).toFixed(0)}s  avg ${avg((r) => r.t).toFixed(0)}s  alive@cap ${rs.filter((r) => !r.over).length}/${seeds}`);
  console.log(`max level med ${med((r) => r.maxLevel)}  avg ${avg((r) => r.maxLevel).toFixed(1)}  best ${Math.max(...rs.map((r) => r.maxLevel))}`);
  console.log(`stage     med ${med((r) => r.stage)}  bosses avg ${avg((r) => r.bosses).toFixed(1)}  hits avg ${avg((r) => r.hits).toFixed(1)}`);
  const mins = [1, 2, 3, 4, 5, 6, 8, 10, 12];
  console.log("level by minute (median of runs still alive): " + mins.map((m) => { const a = rs.filter((r) => r.lvl[m] != null).map((r) => r.lvl[m]).sort((x, y) => x - y); return a.length ? `${m}m:${a[a.length >> 1]}(${a.length})` : `${m}m:-`; }).join("  "));
  const by = {}; for (const r of rs) for (const k in r.by) by[k] = (by[k] || 0) + r.by[k];
  console.log("hits by source (-1 body, 0 scout, 1 gunship, 2 bomber, 3 boss): " + JSON.stringify(by) + "   died during boss: " + rs.filter((r) => r.over && r.bossAtDeath).length + "/" + rs.filter((r) => r.over).length);
  for (let st = 1; st <= 6; st++) {
    const d = rs.filter((r) => r.bossT[st] && r.bossT[st].out).map((r) => r.bossT[st].out - r.bossT[st].in);
    const reached = rs.filter((r) => r.bossT[st]).length;
    if (reached) console.log(`  boss ${st}: reached ${reached}, beaten ${d.length}` + (d.length ? `, avg fight ${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1)}s` : ""));
  }
  const bt = rs.filter((r) => r.bossT[1] && r.bossT[1].out).map((r) => r.bossT[1].out - r.bossT[1].in);
  if (bt.length) console.log(`boss 1 fight: ${bt.length}/${seeds} beaten, avg ${(bt.reduce((a, b) => a + b, 0) / bt.length).toFixed(1)}s`);
}
