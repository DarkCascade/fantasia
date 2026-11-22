"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { World, CONFIG } = require("../src/hallway-combat/sim.js");

const DT = 1 / 60;

function run(seed, seconds) {
  const w = new World({ seed });
  const log = { events: [], minKnightHp: w.knight.hp, phases: new Set(), minGapAtSwing: Infinity, maxGapAtSwing: 0 };
  for (let i = 0; i < seconds / DT; i++) {
    w.step(DT);
    log.phases.add(w.phase);
    log.minKnightHp = Math.min(log.minKnightHp, w.knight.hp);
    for (const e of w.drainEvents()) {
      log.events.push(Object.assign({ t: w.time }, e));
      if (e.type === "swing") {
        const gap = Math.abs(w.orc.x - w.knight.x);
        log.minGapAtSwing = Math.min(log.minGapAtSwing, gap);
        log.maxGapAtSwing = Math.max(log.maxGapAtSwing, gap);
      }
    }
  }
  return { w, log };
}

test("the loop repeats: walk -> fight -> dying -> walk, many orcs", () => {
  const { w, log } = run(7, 120);
  assert.ok(w.kills >= 10, "expected at least 10 orcs in two minutes, got " + w.kills);
  for (const p of ["walk", "fight", "dying"]) assert.ok(log.phases.has(p), "phase " + p + " never seen");
  const count = (type) => log.events.filter((e) => e.type === type).length;
  assert.strictEqual(count("spawn"), count("engage") + (w.orc && w.phase === "walk" ? 1 : 0));
  assert.strictEqual(count("death"), w.kills);
});

test("the knight is overpowered: he never comes close to dying", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { log } = run(seed, 90);
    assert.ok(log.minKnightHp > 40, "seed " + seed + " dropped the knight to " + log.minKnightHp);
  }
});

test("the orc is not a pushover: it lands hits across a run", () => {
  const { log } = run(3, 120);
  const orcHits = log.events.filter((e) => e.type === "hit" && e.by === "orc");
  const knightHits = log.events.filter((e) => e.type === "hit" && e.by === "knight");
  assert.ok(orcHits.length > 0, "orc never hit");
  assert.ok(knightHits.length > orcHits.length * 2, "knight should out-hit the orc by a wide margin");
});

test("swings are strictly in place: only inside melee range, damage within bounds", () => {
  const { log } = run(11, 120);
  assert.ok(log.maxGapAtSwing <= CONFIG.knight.range + 1e-9);
  for (const e of log.events.filter((e) => e.type === "hit")) {
    const spec = e.by === "knight" ? CONFIG.knight : CONFIG.orc;
    assert.ok(e.dmg >= spec.dmg[0] && e.dmg <= spec.dmg[1]);
  }
});

test("a dead orc never lands a blow, and the orc fades in rather than popping in", () => {
  const w = new World({ seed: 5 });
  let sawPartialFade = false;
  let deadSwings = 0;
  for (let i = 0; i < 120 / DT; i++) {
    w.step(DT);
    if (w.orc && w.orc.alive && w.orc.alpha > 0 && w.orc.alpha < 1) sawPartialFade = true;
    for (const e of w.drainEvents()) {
      if (e.type === "hit" && e.by === "orc" && w.phase === "dying") deadSwings++;
    }
  }
  assert.ok(sawPartialFade, "orc should fade in over several frames");
  assert.strictEqual(deadSwings, 0);
});

test("determinism: the same seed gives the same run", () => {
  const a = run(42, 60);
  const b = run(42, 60);
  assert.deepStrictEqual(a.log.events, b.log.events);
});

/* ---------- deck mode: the roguelike card format ---------- */

const { CARDS } = require("../src/hallway-combat/sim.js");

function deckWorld(seed) {
  return new World({ seed, deck: true });
}
function advance(w, seconds, each) {
  const evs = [];
  for (let i = 0; i < seconds / DT; i++) {
    if (each) each(w);
    w.step(DT);
    for (const e of w.drainEvents()) evs.push(e);
  }
  return evs;
}

test("deck: there is always an offer of three cards, and picking one spawns that room straight away", () => {
  const w = deckWorld(1);
  assert.strictEqual(w.offer.length, 3);
  assert.strictEqual(w.orc, null, "the hall starts empty");
  w.offer = ["brute", "shrine", "orc"];
  assert.ok(w.choose(0));
  assert.strictEqual(w.orc.name, "Brute", "the picked room appears immediately");
  assert.strictEqual(w.roomCard, "brute");
  assert.strictEqual(w.offer.length, 3, "the next offer is drawn the moment a room starts");
  assert.ok(w.orc.maxHp > CONFIG.orc.maxHp * 1.5, "a brute is much bulkier than an orc");
  assert.strictEqual(w.choose(7), false, "no such card");
});

test("deck: a card picked while the knight is busy is queued and appears when he is done", () => {
  const w = deckWorld(2);
  w.offer = ["orc", "orc", "orc"];
  w.choose(0);
  w.knight.hp = w.knight.maxHp = 1000;
  w.offer = ["frenzied", "orc", "orc"];
  advance(w, 1); // still walking up to the first orc
  assert.ok(w.choose(0));
  assert.strictEqual(w.queued, "frenzied");
  assert.strictEqual(w.offer, null, "no new offer while one is queued");
  assert.strictEqual(w.orc.name, "Orc", "the current room carries on");
  let spawned = null;
  for (let i = 0; i < 30 / DT && !spawned; i++) {
    w.step(DT);
    for (const e of w.drainEvents()) if (e.type === "spawn" && e.card === "frenzied") spawned = e;
  }
  assert.ok(spawned, "the queued room spawns once the first is cleared");
  assert.strictEqual(w.queued, null);
  assert.ok(w.offer && w.offer.length === 3, "and a fresh offer is drawn");
});

test("deck: leave an empty hall alone long enough and a card is picked for you", () => {
  const w = deckWorld(3);
  const evs = advance(w, CONFIG.run.pickTime + 1);
  const choose = evs.find((e) => e.type === "choose");
  assert.ok(choose && choose.auto, "the hall chose for us");
  assert.ok(w.roomCard, "a room is now in play");
});

test("deck: a busy hall never auto-picks (the clock only runs on an empty hall)", () => {
  const w = deckWorld(4);
  w.offer = ["brute", "orc", "orc"];
  w.choose(0);
  w.drainEvents(); // our own pick
  w.knight.hp = w.knight.maxHp = 5000;
  const evs = advance(w, 6);
  assert.strictEqual(evs.filter((e) => e.type === "choose").length, 0);
  assert.ok(w.offer, "the offer is still waiting");
});

test("deck: riskier rooms pay more and add cards to the deck; foes and points grow with depth", () => {
  const w = deckWorld(5);
  w.knight.hp = w.knight.maxHp = 5000;
  const before = w.deckSize();
  w.offer = ["brute", "orc", "orc"];
  w.choose(0);
  const evs = advance(w, 40);
  const clear = evs.find((e) => e.type === "roomclear" && e.card === "brute");
  assert.ok(clear, "brute cleared");
  assert.strictEqual(clear.reward, CARDS.brute.reward, "depth 0 pays the face value");
  assert.strictEqual(w.score >= CARDS.brute.reward, true);
  assert.ok(evs.some((e) => e.type === "reward"), "a brute drops a card");
  assert.strictEqual(w.deckSize(), before + CARDS.brute.drops);
  // the second room is tougher than the first would have been
  w.offer = ["orc", "orc", "orc"];
  w.queued = null;
  if (!w.roomCard) w.choose(0);
  const scaled = Math.round(CONFIG.orc.maxHp * (1 + CONFIG.run.depthScale * w.rooms));
  const orcNow = w.orc || (advance(w, 1), w.orc);
  assert.ok(orcNow.maxHp >= scaled - 1, "foes toughen per room cleared");
});

test("deck: shrine heals, armory sharpens the knight, and neither touches the shared CONFIG", () => {
  const w = deckWorld(6);
  const dmg0 = CONFIG.knight.dmg.slice();
  w.knight.hp = 40;
  w.offer = ["shrine", "armory", "orc"];
  w.choose(0);
  w.offer = ["armory", "orc", "orc"];
  w.choose(0); // queued behind the shrine
  for (let i = 0; i < 30 / DT && w.rooms < 2; i++) w.step(DT); // stop before the empty hall auto-picks a fight
  assert.ok(w.knight.hp >= 70, "the shrine restored 30% of max life, got " + w.knight.hp);
  assert.deepStrictEqual(w.knight.dmg, [dmg0[0] + 3, dmg0[1] + 3], "the armory is a permanent +3");
  assert.deepStrictEqual(CONFIG.knight.dmg, dmg0, "CONFIG is never mutated");
  assert.strictEqual(w.rooms, 2);
});

test("deck: if the knight falls the run is over, and nothing else happens", () => {
  const w = deckWorld(7);
  w.knight.hp = 1;
  w.offer = ["warchief", "orc", "orc"];
  w.choose(0);
  const evs = advance(w, 30);
  const deaths = evs.filter((e) => e.type === "knightdeath");
  assert.strictEqual(deaths.length, 1);
  assert.strictEqual(deaths[0].by, "warchief");
  assert.strictEqual(w.phase, "over");
  assert.strictEqual(w.knight.alive, false);
  assert.strictEqual(w.knight.fall, 1, "he topples");
  assert.strictEqual(w.offer, null);
  assert.strictEqual(w.choose(0), false, "no more picks once he is down");
  const after = advance(w, 10);
  assert.strictEqual(after.filter((e) => e.type === "hit").length, 0, "the fight does not carry on over his body");
});

test("deck: cards are conserved (draw + discard + offer = start deck + rewards) and play is deterministic", () => {
  const start = Object.values(CONFIG.run.startDeck).reduce((a, b) => a + b, 0);
  const play = (seed) => {
    const w = deckWorld(seed);
    w.knight.hp = w.knight.maxHp = 400;
    let rewards = 0;
    const log = [];
    for (let i = 0; i < 240 / DT; i++) {
      if (w.offer) w.choose(w.offer.length - 1);
      w.step(DT);
      for (const e of w.drainEvents()) {
        if (e.type === "reward") rewards += e.ids.length;
        if (e.type === "choose" || e.type === "roomclear") log.push(e.type + ":" + (e.card || ""));
      }
      if (w.queued) assert.ok(!w.offer);
    }
    assert.strictEqual(w.deckSize() + (w.queued ? 0 : 0), start + rewards);
    assert.ok(w.rooms > 5, "a long run clears plenty of rooms");
    return log;
  };
  assert.deepStrictEqual(play(21), play(21));
});

test("deck: the classic loop is unchanged when deck mode is off", () => {
  const w = new World({ seed: 9 });
  assert.strictEqual(w.deckMode, false);
  assert.strictEqual(w.offer, undefined);
  assert.strictEqual(w.choose(0), false);
});
