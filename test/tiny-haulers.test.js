// Unit tests for Tiny Haulers' simulation core (src/tiny-haulers/sim.js).
// Run with: node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/tiny-haulers/sim.js");

const DT = 1 / 30;

function run(w, secs, each) {
  for (let i = 0; i < secs / DT; i++) {
    if (each && each(w) === false) return false;
    w.step(DT);
  }
  return true;
}

// Give every idle truck the best-paying job per unit of distance.
function dispatch(w) {
  for (const t of w.trucks)
    if (!t.job && !t.queue.length) {
      const jobs = w.board.filter(Boolean).sort((a, b) => b.pay / b.dist - a.pay / a.dist);
      if (jobs[0]) w.acceptJob(jobs[0].id, t.id);
    }
}

test("rng is deterministic and its state round-trips", () => {
  const a = new S.Rng(42);
  const seq = [a.next(), a.next(), a.next()];
  const b = new S.Rng(42);
  assert.deepEqual([b.next(), b.next(), b.next()], seq);
  const c = new S.Rng(1);
  c.state = a.state;
  assert.equal(c.next(), a.next());
});

test("every lane has positive length and every lane can reach every other", () => {
  const map = S.getMap();
  const keys = Object.keys(map.lanes);
  assert.ok(keys.length > 30);
  for (const k of keys) assert.ok(map.lanes[k].len > 2, k + " is too short");
  const cost = (l, m) => l.len + (m ? m.len : 0);
  for (const from of keys)
    for (const to of keys) {
      const r = S.findRoute(map, from, to, false, cost);
      assert.ok(r && r[0] === from && r[r.length - 1] === to, `no route ${from} -> ${to}`);
    }
});

test("routes never U-turn and follow real moves", () => {
  const map = S.getMap();
  const r = S.findRoute(map, "m00>m10", "m10>m00", false, (l) => l.len);
  for (let i = 1; i < r.length; i++) assert.ok(map.moves[S.moveKey(r[i - 1], r[i])], "missing move " + r[i - 1] + " -> " + r[i]);
});

test("intersection conflicts come from geometry", () => {
  const map = S.getMap();
  const mv = (a, n, b) => map.moves[S.moveKey(S.laneKey(a, n), S.laneKey(n, b))];
  // Maplewood's centre m11 is a 4-way: west neighbour m01, east m21, north m10, south m12.
  const eastbound = mv("m01", "m11", "m21");
  const westbound = mv("m21", "m11", "m01");
  const westboundLeft = mv("m21", "m11", "m12"); // heading west, turning left to the south
  const northbound = mv("m12", "m11", "m10");
  assert.equal(eastbound.dir, "straight");
  assert.equal(westboundLeft.dir, "left");
  assert.ok(!eastbound.conflicts[westbound.key], "opposite straights share the road");
  assert.ok(eastbound.conflicts[westboundLeft.key], "a left turn crosses oncoming traffic");
  assert.ok(eastbound.conflicts[northbound.key], "crossing streets conflict");
  // right turns from opposite approaches don't touch
  const r1 = mv("m01", "m11", "m12");
  const r2 = mv("m21", "m11", "m10");
  assert.equal(r1.dir, "right");
  assert.ok(!r1.conflicts[r2.key]);
});

test("towns have distinct controls and the right producers", () => {
  const map = S.getMap();
  const ctrl = (town) => new Set(Object.values(map.nodes).filter((n) => n.town === town && n.ctrl).map((n) => n.ctrl));
  assert.deepEqual([...ctrl("maplewood")], ["stop"]);
  assert.deepEqual([...ctrl("seabright")], ["signal"]);
  const prod = map.lots.filter((l) => l.role === "producer");
  assert.equal(prod.length, 6);
  for (const p of prod) assert.equal(S.GOODS[p.good].town, p.town);
  assert.equal(map.lots.filter((l) => l.role === "hq").length, 1);
});

test("more stops pay more, and so does distance", () => {
  for (let n = 1; n < 4; n++) assert.ok(S.jobPay(n + 1, 60, false) - S.jobPay(n, 60, false) > S.jobPay(2, 60, false) - S.jobPay(1, 60, false) - 1, "per-stop pay grows");
  assert.ok(S.jobPay(2, 100, false) > S.jobPay(2, 50, false));
  assert.ok(S.jobPay(2, 80, true) > S.jobPay(2, 80, false), "cross-town bonus");
});

test("generated jobs are well-formed", () => {
  const w = new S.World({ seed: 3, ambient: false });
  const towns = new Set();
  for (let i = 0; i < 60; i++) {
    const j = w.genJob();
    const from = w.lotById[j.from];
    assert.equal(from.role, "producer");
    assert.equal(from.good, j.good);
    assert.ok(j.stops.length >= 1 && j.stops.length <= 4);
    assert.equal(new Set(j.stops).size, j.stops.length, "stops are distinct");
    for (const s of j.stops) {
      assert.equal(w.lotById[s].role, "consumer");
      assert.equal(w.lotById[s].town, j.destTown);
    }
    assert.equal(j.cross, j.town !== j.destTown);
    assert.ok(j.pay > 0 && j.deadline > 0 && j.dist > 0 && j.expires > j.posted);
    towns.add(j.town);
  }
  assert.equal(towns.size, 2, "both towns post jobs");
});

test("a truck drives a job to completion and gets paid", () => {
  const w = new S.World({ seed: 9 });
  const job = w.board[0];
  const t = w.trucks[0];
  const before = w.money;
  assert.ok(w.acceptJob(job.id, t.id).ok);
  assert.equal(w.board[0], null, "taken off the board");
  let done = null;
  run(w, 400, () => {
    done = w.events.find((e) => e.type === "jobDone");
    return !done;
  });
  assert.ok(done, "job finished");
  assert.equal(t.job, null);
  assert.equal(t.task.phase, "idle");
  assert.ok(w.money > before, "earned more than the fuel cost");
  assert.equal(w.stats.delivered, job.stops.length);
});

test("busy trucks queue jobs up to the limit", () => {
  const w = new S.World({ seed: 5, ambient: false });
  const t = w.trucks[0];
  const ids = w.board.map((j) => j.id);
  assert.ok(w.acceptJob(ids[0], t.id).ok);
  const q1 = w.acceptJob(ids[1], t.id);
  assert.ok(q1.ok && q1.queued);
  assert.ok(w.acceptJob(ids[2], t.id).ok);
  const full = w.acceptJob(ids[3], t.id);
  assert.equal(full.ok, false);
  assert.equal(t.queue.length, S.C.QUEUE_MAX);
  assert.ok(w.cancelQueued(t.id, ids[1]));
  assert.equal(t.queue.length, 1);
});

test("buying trucks costs money and is capped", () => {
  const w = new S.World({ seed: 1, ambient: false });
  w.money = 0;
  assert.equal(w.buyTruck().ok, false);
  w.money = 1e6;
  while (w.truckCost() !== null) assert.ok(w.buyTruck().ok);
  assert.equal(w.trucks.length, S.C.MAX_TRUCKS);
  assert.equal(w.buyTruck().ok, false);
  const spent = 1e6 - w.money;
  assert.equal(spent, S.C.TRUCK_COSTS.reduce((a, b) => a + b, 0));
});

test("signals never show green both ways", () => {
  const w = new S.World({ seed: 2, ambient: false });
  const sigs = Object.values(w.map.nodes).filter((n) => n.sig);
  assert.ok(sigs.length >= 2);
  for (let i = 0; i < 2000; i++) {
    w.stepSignals(0.05);
    for (const n of sigs) {
      const greens = new Set(n.nbrs.map((p) => w.map.lanes[S.laneKey(p, n.id)]).filter((l) => S.signalFor(n, l) === "green").map((l) => (Math.abs(l.dx) >= Math.abs(l.dz) ? 0 : 1)));
      assert.ok(greens.size <= 1);
    }
  }
});

test("traffic flows: no collisions and no gridlock", () => {
  const w = new S.World({ seed: 11 });
  w.money = 1e5;
  while (w.trucks.length < 4) w.buyTruck();
  let minD = Infinity;
  const stall = new Map();
  let maxStall = 0;
  run(w, 900, () => {
    dispatch(w);
    const moving = w.vehicles.filter((v) => v.mode !== "parked").map((v) => w.pose(v));
    for (let i = 0; i < moving.length; i++)
      for (let j = i + 1; j < moving.length; j++) minD = Math.min(minD, Math.hypot(moving[i].x - moving[j].x, moving[i].z - moving[j].z));
    for (const v of w.vehicles) {
      const s = v.mode !== "parked" && v.v < 0.02 ? (stall.get(v) || 0) + DT : 0;
      stall.set(v, s);
      maxStall = Math.max(maxStall, s);
    }
  });
  assert.ok(minD > 0.9, "vehicles kept their distance (closest " + minD.toFixed(2) + ")");
  assert.ok(maxStall < 40, "nobody was stuck for long (" + maxStall.toFixed(1) + "s)");
  assert.ok(w.stats.jobs >= 10, "the fleet got work done (" + w.stats.jobs + " jobs)");
  assert.ok(w.vehicles.length <= 8 + S.C.MAX_TRUCKS, "small fleet of vehicles");
});

test("save / load round-trips mid-job and the job still completes", () => {
  const w = new S.World({ seed: 21 });
  const t = w.trucks[0];
  w.acceptJob(w.board[1].id, t.id);
  w.acceptJob(w.board[2].id, t.id); // queued
  run(w, 20);
  const data = JSON.parse(JSON.stringify(w.serialize()));
  assert.equal(data.summary.trucks, 1);
  const w2 = S.loadWorld(data);
  assert.equal(Math.round(w2.money), Math.round(w.money));
  assert.equal(w2.t, w.t);
  assert.equal(w2.trucks.length, 1);
  const t2 = w2.trucks[0];
  assert.equal(t2.job.id, t.job.id);
  assert.equal(t2.queue.length, 1);
  assert.deepEqual(
    w2.board.map((j) => j && j.id),
    w.board.map((j) => j && j.id)
  );
  // the loaded world keeps generating the same jobs
  assert.equal(w2.genJob().id, w.genJob().id);
  let done = 0;
  run(w2, 600, () => {
    done = w2.events.filter((e) => e.type === "jobDone").length;
    return done < 2;
  });
  assert.equal(done, 2, "both the running and the queued job finish after loading");
});

test("loading rejects garbage", () => {
  assert.throws(() => S.loadWorld(null));
  assert.throws(() => S.loadWorld({ v: 99 }));
});

test("a day ends with upkeep", () => {
  const w = new S.World({ seed: 4, ambient: false });
  const m = w.money;
  run(w, S.C.DAY_LEN + 1);
  const ev = w.events.find((e) => e.type === "dayEnd");
  assert.ok(ev);
  assert.equal(ev.upkeep, S.C.UPKEEP);
  assert.equal(w.day(), 2);
  assert.ok(Math.abs(w.money - (m - S.C.UPKEEP)) < 1e-6);
});
