#!/usr/bin/env node
/*
 * Hall of Blows deck mode — balance bot.
 *
 *   node experiments/hallway-combat-balance/bot.js [seeds=60] [policy|all=all]
 *
 * Plays the real sim (src/hallway-combat/sim.js, deck mode) with a few card
 * policies and prints how far each gets. The thing we want to see is that risk
 * is *rewarded* (reckless > cautious in points) but not free (reckless dies
 * sooner / more often early), and that a careful run still ends eventually.
 * Bots are not humans; read the numbers as relative.
 */
"use strict";
const { World, CARDS, CONFIG } = require("../../src/hallway-combat/sim.js");

// quick sweeps without editing the sim:  DEPTH=0.05 HEAL=0.25 node bot.js
if (process.env.DEPTH) CONFIG.run.depthScale = +process.env.DEPTH;
if (process.env.HEAL) CONFIG.run.healOnKill = +process.env.HEAL;

const DT = 1 / 60;
const CAP_SECONDS = 40 * 60;

const danger = (id) => CARDS[id].danger;
const idx = (offer, pred) => offer.findIndex(pred);

const POLICIES = {
  // no thought at all
  random: (w) => Math.floor(w.rng() * w.offer.length),
  // always the gentlest room; heal when hurt
  coward: (w) => {
    const hp = w.knight.hp / w.knight.maxHp;
    if (hp < 0.8) { const s = idx(w.offer, (c) => c === "shrine"); if (s >= 0) return s; }
    const a = idx(w.offer, (c) => c === "armory");
    if (a >= 0) return a;
    let best = 0;
    w.offer.forEach((c, i) => { if (danger(c) < danger(w.offer[best])) best = i; });
    return best;
  },
  // always the scariest room
  reckless: (w) => {
    let best = 0;
    w.offer.forEach((c, i) => { if (danger(c) > danger(w.offer[best])) best = i; });
    return best;
  },
  // takes the biggest risk its life total can afford, heals when low
  smart: (w) => {
    const hp = w.knight.hp / w.knight.maxHp;
    const s = idx(w.offer, (c) => c === "shrine");
    if (hp < 0.5 && s >= 0) return s;
    const a = idx(w.offer, (c) => c === "armory");
    if (a >= 0 && hp > 0.4) return a;
    const allowed = hp >= 0.85 ? 5 : hp >= 0.65 ? 3 : hp >= 0.45 ? 2 : 1;
    let best = -1;
    w.offer.forEach((c, i) => {
      if (danger(c) > allowed) return;
      if (best < 0 || danger(c) > danger(w.offer[best])) best = i;
    });
    if (best >= 0) return best;
    w.offer.forEach((c, i) => { if (best < 0 || danger(c) < danger(w.offer[best])) best = i; });
    return best;
  },
};

function play(seed, policy) {
  const w = new World({ seed, deck: true });
  const picks = {};
  while (w.phase !== "over" && w.time < CAP_SECONDS) {
    if (w.offer) {
      const i = policy(w);
      picks[w.offer[i]] = (picks[w.offer[i]] || 0) + 1;
      w.choose(i);
    }
    w.step(DT);
    w.drainEvents();
  }
  return { rooms: w.rooms, score: w.score, time: w.time, deck: w.deckSize(), by: w.phase === "over" ? w.roomCard : "(survived)", picks };
}

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (n, d) => Math.round((100 * n) / d) + "%";

function main() {
  const seeds = +process.argv[2] || 60;
  const which = process.argv[3] || "all";
  const names = which === "all" ? Object.keys(POLICIES) : [which];
  console.log("seeds:", seeds, "| depthScale", CONFIG.run.depthScale, "| healOnKill", CONFIG.run.healOnKill, "\n");
  for (const name of names) {
    const runs = [];
    for (let s = 1; s <= seeds; s++) runs.push(play(s, POLICIES[name]));
    const killers = {};
    runs.forEach((r) => (killers[r.by] = (killers[r.by] || 0) + 1));
    const picks = {};
    runs.forEach((r) => Object.keys(r.picks).forEach((k) => (picks[k] = (picks[k] || 0) + r.picks[k])));
    const totalPicks = Object.values(picks).reduce((a, b) => a + b, 0);
    console.log(name.padEnd(9),
      "rooms med", String(med(runs.map((r) => r.rooms))).padStart(3),
      "max", String(Math.max(...runs.map((r) => r.rooms))).padStart(3),
      "| score med", String(med(runs.map((r) => r.score))).padStart(5),
      "max", String(Math.max(...runs.map((r) => r.score))).padStart(5),
      "| time med", Math.round(med(runs.map((r) => r.time))) + "s",
      "| deck med", med(runs.map((r) => r.deck)));
    console.log("          killed by:", Object.keys(killers).map((k) => k + " " + pct(killers[k], seeds)).join(", "));
    console.log("          picks:", Object.keys(picks).map((k) => k + " " + pct(picks[k], totalPicks)).join(", "), "\n");
  }
}
main();
