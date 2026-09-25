// Greenlit balance sweep: drives the real Career model (src/greenlit.js exports
// it under Node) through whole careers with a few bot policies and prints how
// reviews, profit and losses evolve per era. Run: node experiments/greenlit-balance/sweep.js
//
// Targets the current tuning was set against:
//   - "engaged" (suits genre to deck, greedy picks, buys new tech, shelves
//     stale cards): ~63 in 1984 climbing to the mid-80s by the late game,
//     and almost never stuck broke.
//   - "never-buys" (same picks, never shops): slides from ~63 to ~50 by the
//     2000s, then the publisher's safety-net loans slowly haul it back up.
//   - "random" (random genre, random swipes, no shop): hovers around break
//     even (~50) — the decisions have to matter.
const M = require("../../src/greenlit.js");
const { Career, CARD_MAP, CATS, scoreProject, cardCost, magnitudeIndex } = M;

const CAREERS = 500;
const RELEASES = 26;

function deckStrength(c, genre) {
  const q = {};
  CATS.forEach((k) => {
    q[k.id] = c
      .activeDeck()
      .map((id) => CARD_MAP[id])
      .filter((x) => x.cat === k.id)
      .map((x) => x.power)
      .sort((a, b) => b - a)
      .slice(0, 2)
      .reduce((s, v) => s + v, 0);
  });
  return scoreProject(q, genre, c.year).effective;
}

function greedySide(c) {
  const p = c.project;
  const vals = p.pair.map((id) => {
    const card = CARD_MAP[id];
    const q = Object.assign({}, p.q);
    q[card.cat] += card.power;
    const cost = cardCost(card, c.year);
    const over = cost - (p.budget - p.spent);
    return scoreProject(q, p.genre, c.year).effective - (over > 0 ? (over / p.budget) * 20 : 0) - (cost / p.budget) * 4;
  });
  return vals[0] >= vals[1] ? 0 : 1;
}

function career(policy) {
  const c = new Career();
  const out = [];
  let broke = 0;
  let maxBroke = 0;
  for (let r = 0; r < RELEASES; r++) {
    const gs = c.offerGenres();
    const smart = policy !== "random";
    const g = smart && deckStrength(c, gs[1]) > deckStrength(c, gs[0]) ? gs[1] : gs[0];
    c.startProject(g.id);
    while (!c.project.over) c.pick(smart ? greedySide(c) : Math.random() < 0.5 ? 0 : 1);
    out.push(c.release("t" + r));
    if (policy === "engaged") {
      for (let k = 0; k < 10; k++) {
        const fresh = {};
        CATS.forEach((x) => {
          fresh[x.id] = c.activeDeck().filter((id) => CARD_MAP[id].cat === x.id && magnitudeIndex(CARD_MAP[id], c.year) > 0).length;
        });
        const avail = c
          .shopCards()
          .filter((x) => c.price(x.id) <= c.cash)
          .sort((a, b) => fresh[a.cat] - fresh[b.cat] || b.year - a.year || b.tier - a.tier);
        if (!avail.length) break;
        c.buy(avail[0].id);
      }
      for (const id of c.activeDeck()) {
        const card = CARD_MAP[id];
        const sameCat = c.activeDeck().filter((x) => CARD_MAP[x].cat === card.cat).length;
        if (magnitudeIndex(card, c.year) === 0 && sameCat > 2) c.toggleShelve(id);
      }
    }
    broke = c.cash === 0 ? broke + 1 : 0;
    maxBroke = Math.max(maxBroke, broke);
  }
  return { out, maxBroke };
}

for (const policy of ["engaged", "never-buys", "random"]) {
  const acc = Array.from({ length: RELEASES }, () => ({ review: 0, profit: 0, loss: 0 }));
  let stuck = 0;
  for (let i = 0; i < CAREERS; i++) {
    const { out, maxBroke } = career(policy === "never-buys" ? "never" : policy);
    out.forEach((r, j) => {
      acc[j].review += r.review / CAREERS;
      acc[j].profit += r.profit / CAREERS;
      acc[j].loss += (r.profit < 0 ? 1 : 0) / CAREERS;
    });
    if (maxBroke >= 5) stuck++;
  }
  console.log("\n== " + policy + " — careers broke 5+ releases running: " + ((stuck / CAREERS) * 100).toFixed(1) + "%");
  console.log("year  review  profit   loss%");
  acc.forEach((a, j) => {
    if (j % 3 === 0 || j === RELEASES - 1) {
      console.log(String(1984 + 2 * j), a.review.toFixed(1).padStart(7), (Math.round(a.profit / 1000) + "k").padStart(8), (a.loss * 100).toFixed(0).padStart(6));
    }
  });
}
