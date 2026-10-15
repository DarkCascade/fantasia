/* Chibi Crawl balance sim. Plays bot trips through the REAL game code (real combat,
 * real thieves, the real TownScreen buy/sell/hire actions) and reports profit,
 * losses and guard attrition, so economy and combat numbers can be tuned with data.
 *
 * Usage (serve the repo root, open the game, then in the page console / a headless
 * `evaluate`):
 *
 *   localStorage.setItem("chibi-crawl-save", JSON.stringify({coins:100,cargo:{},guards:[]}));
 *   window.launchChibiCrawl();                       // wait ~5s for it to boot
 *   (0, eval)(await (await fetch("experiments/chibi-balance/harness.js")).text());
 *   __bal.table("baseline", {}, 50);                 // 4 bot strategies, 50 trips each
 *   __bal.table("tougher", {foeHp: 1.6, wildsPack: 1}, 50);
 *   __bal.econ({ HIRE_COST: {knight: 80}, SELL_MULT: [0, 1.9, 3.3] });
 *
 * Knobs live in `g.tune` (TUNE in chibi-crawl.js) and `g.econ`; `apply()` resets them to
 * what the page loaded with, then overlays a config. If a changed src/chibi-crawl.js does
 * not show up, bust the cache first: await fetch("src/chibi-crawl.js", {cache: "reload"}).
 *
 * Strategies (`table` runs all four): none / K (Knight) / KC (+Cleric) / KMC (+Mage), each
 * re-hiring when it can afford to, always buying a full wagon at home and selling
 * everything at the next town round the ring. Level is held at 1 at the start of each
 * trip (`lock`) so runs are comparable; pass lock=false to see level growth.
 */
window.__bal = (function () {
  const g = window.chibiCrawlGame.game;
  const IDS = ["maybough", "breezewick", "oakhaven", "shiverpine"];
  const ts = g.townScreen;
  const cargoSum = () => Object.values(g.cargo).reduce((a, b) => a + b, 0);
  const rd = (a, b) => {
    const d = Math.abs(IDS.indexOf(a) - IDS.indexOf(b));
    return Math.min(d, 4 - d);
  };
  const ITEM = 20;
  // Gross damage taken by guards: a smoother difficulty signal than guard deaths.
  if (!g.__dmgWrapped) {
    g.__dmgWrapped = true;
    g.__dmg = 0;
    const orig = g.hit.bind(g);
    g.hit = (att, tgt, base, o) => {
      const hp0 = tgt.hp;
      orig(att, tgt, base, o);
      if (tgt.side === "hero") g.__dmg += Math.max(0, hp0 - Math.max(tgt.hp, 0));
    };
  }

  // trade at the current town like a player would
  const cycle = (pol) => {
    ts.town = g.town;
    const here = g.town.id;
    const st = { hired: 0, hireCost: 0 };
    IDS.forEach((id) => {
      if (id === here) return;
      if (g.cargo[id] > 0 && (!pol.carry || rd(id, here) >= 2)) ts.act("sellall", id);
    });
    (pol.guards || []).forEach((k) => {
      if (g.guards.indexOf(k) < 0) {
        const c0 = g.coins;
        ts.act("hire", k);
        if (g.guards.indexOf(k) >= 0) {
          st.hired++;
          st.hireCost += c0 - g.coins;
        }
      }
    });
    // upgrades, in the policy's order, once the guards are hired and there is a reserve left over
    (pol.order || []).forEach((u, i) => {
      if (pol.__bought === undefined) pol.__bought = 0;
      if (i !== pol.__bought) return;
      const tier = u === "wagon" ? g.wagonTier : g.trainTier;
      const cost = (u === "wagon" ? g.econ.WAGON_COST : g.econ.TRAIN_COST)[tier];
      if (cost !== undefined && g.coins >= cost + (pol.reserve || 60)) {
        ts.act(u, "");
        pol.__bought++;
      }
    });
    const k = Math.min(g.cargoCap() - cargoSum(), Math.floor(g.coins / ITEM));
    if (k > 0) ts.act("fill");
    ts.town = null;
    return st;
  };

  const reset = (coins, pol) => {
    g.wagonTier = (pol && pol.wagon) || 0;
    g.trainTier = (pol && pol.train) || 0;
    if (pol) pol.__bought = 0;
    g.coins = coins;
    IDS.forEach((k) => (g.cargo[k] = 0));
    g.guards = [];
    g.level = 1;
    g.wins = 0;
  };

  const runPol = (pol, trips) => {
    reset(pol.coins || 300, pol);
    const A = { trips: 0, profit: 0, stolen: 0, guardsLost: 0, hireCost: 0, plunders: 0, loseGuard: 0, fullLoss: 0, kills: 0, bankrupt: 0 };
    const byDest = {};
    for (let t = 0; t < trips; t++) {
      if (pol.lock) {
        g.wins = 0;
        g.level = 1;
      }
      const worth0 = g.coins + cargoSum() * ITEM;
      const c0 = g.coins;
      const car0 = cargoSum();
      const gd0 = g.guards.length;
      const next = IDS[(IDS.indexOf(g.town.id) + (pol.dir || 1) + 4) % 4];
      g.beginTownRun(next);
      g.paused = false;
      let n = 0;
      while (g.mode === "run" && n < 30000) {
        g.step(1 / 30);
        n++;
      }
      const car1 = cargoSum();
      const gd1 = g.guards.length;
      const kc = g.coins - c0;
      const st = cycle(pol);
      const lost = Math.max(0, car0 - car1);
      const gl = Math.max(0, gd0 - gd1);
      A.trips++;
      A.stolen += lost;
      A.guardsLost += gl;
      A.hireCost += st.hireCost;
      A.kills += kc;
      if (lost > 0) A.plunders++;
      if (gl > 0) A.loseGuard++;
      if (car0 > 0 && car1 === 0) A.fullLoss++;
      A.profit += g.coins + cargoSum() * ITEM - worth0;
      if (g.coins < 20 && cargoSum() === 0) {
        A.bankrupt++;
        g.coins = 100;
      }
      const d = byDest[next] || (byDest[next] = { trips: 0, gl: 0, st: 0 });
      d.trips++;
      d.gl += gl;
      d.st += lost;
    }
    const f = (x) => +(x / A.trips).toFixed(2);
    const o = { profit: f(A.profit), stolen: f(A.stolen), guardsLost: f(A.guardsLost), hireCostPerTrip: f(A.hireCost), killCoins: f(A.kills), pPlunder: f(A.plunders), pLoseGuard: f(A.loseGuard), pFullLoss: f(A.fullLoss), bankrupt: A.bankrupt, coinsEnd: g.coins, level: g.level };
    Object.keys(byDest).forEach((k) => (byDest[k] = { gl: +(byDest[k].gl / byDest[k].trips).toFixed(2), st: +(byDest[k].st / byDest[k].trips).toFixed(2) }));
    o.byDest = byDest;
    return o;
  };

  // Pure combat risk for a FIXED party and a full wagon: state is restored after every trip,
  // so a bad trip can't snowball (the bots in runPol fall into poverty traps, which hides the
  // real per-trip odds). Also derives the expected net profit per trip analytically.
  const risk = (kinds, trips, cargoN, level, tiers) => {
    level = level || 1; // party level at the START of each trip (foes scale with it via tune.perLevel)
    tiers = tiers || {};
    g.wagonTier = tiers.wagon || 0;
    g.trainTier = tiers.train || 0;
    cargoN = cargoN === undefined ? g.cargoCap() : cargoN; // default: a full wagon
    const sell = Math.round(ITEM * g.econ.SELL_MULT[1]);
    const R = { trips: trips, loseGuard: 0, plunder: 0, stolen: 0, kills: 0, guardsLost: 0, lostBy: { knight: 0, mage: 0, cleric: 0 }, fullWipe: 0, byDest: {} };
    for (let t = 0; t < trips; t++) {
      g.guards = kinds.slice();
      g.level = level;
      g.wins = (level - 1) * 3;
      // go round the ring so every biome pair is sampled; carry the town's own item to the next
      const here = g.town.id;
      const next = IDS[(IDS.indexOf(here) + 1) % 4];
      IDS.forEach((k) => (g.cargo[k] = 0));
      g.cargo[here] = cargoN;
      const c0 = g.coins;
      g.beginTownRun(next);
      g.paused = false;
      let n = 0;
      while (g.mode === "run" && n < 30000) {
        g.step(1 / 30);
        n++;
      }
      const lost = cargoN - g.cargo[here];
      const gone = kinds.filter((k) => g.guards.indexOf(k) < 0);
      R.stolen += lost;
      R.kills += g.coins - c0;
      R.guardsLost += gone.length;
      gone.forEach((k) => R.lostBy[k]++);
      if (lost > 0) R.plunder++;
      if (gone.length) R.loseGuard++;
      if (kinds.length && gone.length === kinds.length) R.fullWipe++;
      const d = R.byDest[next] || (R.byDest[next] = { n: 0, g: 0, st: 0 });
      d.n++;
      d.g += gone.length;
      d.st += lost;
    }
    const f = (x) => +(x / trips).toFixed(2);
    const guardCost = (R.lostBy.knight * g.econ.HIRE_COST.knight + R.lostBy.mage * g.econ.HIRE_COST.mage + R.lostBy.cleric * g.econ.HIRE_COST.cleric) / trips;
    const stolen = R.stolen / trips;
    const net = (cargoN - stolen) * sell - cargoN * ITEM - guardCost + R.kills / trips;
    return { party: (kinds.join("+") || "none") + (g.wagonTier || g.trainTier ? " [w" + g.wagonTier + " t" + g.trainTier + "]" : ""), pLoseGuard: f(R.loseGuard), pPlunder: f(R.plunder), pFullWipe: f(R.fullWipe), stolen: f(R.stolen), guardsLost: f(R.guardsLost), guardCost: +guardCost.toFixed(1), kills: f(R.kills), net: Math.round(net), byDest: Object.keys(R.byDest).map((k) => k.slice(0, 3) + " g" + (R.byDest[k].g / R.byDest[k].n).toFixed(1) + "/s" + (R.byDest[k].st / R.byDest[k].n).toFixed(1)).join(" ") };
  };
  // Difficulty of each biome ON ITS OWN: a same-town trip keeps all 3 encounters in one biome.
  // Reports guards lost and items stolen per trip for a fixed party, so the foe stat profiles
  // can be compared (the ring-rotating `risk` mixes biomes and hides which one is hard).
  const pure = (kinds, trips) => {
    const out = {};
    g.towns.forEach((tw) => {
      let gl = 0;
      let st = 0;
      g.__dmg = 0;
      for (let t = 0; t < trips; t++) {
        g.town = tw;
        g.guards = kinds.slice();
        g.level = 1;
        g.wins = 0;
        IDS.forEach((k) => (g.cargo[k] = 0));
        g.cargo[tw.id] = 6;
        g.beginTownRun(tw.id);
        g.paused = false;
        let n = 0;
        while (g.mode === "run" && n < 30000) {
          g.step(1 / 30);
          n++;
        }
        gl += kinds.filter((k) => g.guards.indexOf(k) < 0).length;
        st += 6 - g.cargo[tw.id];
      }
      out[tw.id.slice(0, 3)] = `dmg ${Math.round(g.__dmg / trips)} | g${(gl / trips).toFixed(2)}/s${(st / trips).toFixed(1)}`;
    });
    return out;
  };
  const riskTable = (label, cfg, trips) => {
    apply(cfg);
    const sets = [[], ["knight"], ["knight", "cleric"], ["knight", "mage"], ["knight", "cleric", "mage"]];
    return { label: label, rows: sets.map((s) => { const r = risk(s, trips || 40); return `${r.party.padEnd(18)} pLoseG ${r.pLoseGuard} | pPlunder ${r.pPlunder} | stolen ${r.stolen} | gLost ${r.guardsLost} (cost ${r.guardCost}) | net ${r.net}`; }) };
  };

  // Captured ONCE per page load (window.__balBase), so re-evaluating this file after tweaking
  // g.tune can never mistake an experiment for the baseline.
  if (!window.__balBase) window.__balBase = { t: JSON.parse(JSON.stringify(g.tune)), h: JSON.parse(JSON.stringify(g.econ.HIRE_COST)), s: [...g.econ.SELL_MULT] };
  // Set a foe variant's stats as multipliers on its base body: foe("crow", {hp: 1, atk: 1.2, cd: 1}).
  const foe = (key, m) => {
    const d = g.foeDefs[key];
    const b = g.foeDefs[d.kind];
    if (m.hp !== undefined) d.hp = Math.round(b.hp * m.hp);
    if (m.atk !== undefined) d.atk = b.atk * m.atk;
    if (m.cd !== undefined) d.cd = b.cd * m.cd;
  };
  const base = window.__balBase.t;
  const baseEcon = { h: window.__balBase.h, s: window.__balBase.s };
  const apply = (c) => Object.assign(g.tune, JSON.parse(JSON.stringify(base)), c || {});
  const econ = (c) => {
    c = c || {};
    Object.assign(g.econ.HIRE_COST, baseEcon.h, c.HIRE_COST || {});
    (c.SELL_MULT || baseEcon.s).forEach((v, i) => (g.econ.SELL_MULT[i] = v));
  };
  const table = (label, cfg, trips, lock) => {
    apply(cfg);
    const P = { none: [], K: ["knight"], KC: ["knight", "cleric"], KMC: ["knight", "cleric", "mage"] };
    const row = { label: label };
    for (const [n, gs] of Object.entries(P)) {
      const r = runPol({ guards: gs, lock: lock !== false }, trips || 50);
      row[n] = `net ${Math.round(r.profit)} | stolen ${r.stolen} | pPlun ${r.pPlunder} | pLoseG ${r.pLoseGuard} | gLost ${r.guardsLost}${r.bankrupt ? " | bankr " + r.bankrupt : ""}`;
    }
    return row;
  };
  return { g, foe, runPol, risk, pure, riskTable, reset, cycle, cargoSum, IDS, rd, apply, econ, table, base, baseEcon };
})();
