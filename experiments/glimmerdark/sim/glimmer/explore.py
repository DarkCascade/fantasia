"""Fast screening of candidate rule changes before committing to a full sweep.

    python -m glimmer.explore            # runs the VARIANTS below at low game counts

Screening numbers are only used to pick which variant gets the full
10,000-games-per-configuration treatment in glimmer.run; the changelog quotes
the full-sweep numbers, not these.
"""

from __future__ import annotations

import itertools
import random
import statistics as st
import sys
from collections import defaultdict

from . import rules as R
from .run import char_summary, dynamics_summary, length_summary, run_games, seat_summary


def screen(cfg, games_per_combo=150, strat_games=1500, seed=5, strategy="tactician", verbose=True):
    rep = {}
    for n in (2, 3, 4):
        combos = list(itertools.combinations(R.CHARACTERS, n))
        cs, ss = [], []
        for combo in combos:
            cs += [combo] * games_per_combo
            ss += [(strategy,) * n] * games_per_combo
        recs, _ = run_games(cfg, cs, ss, seed0=seed + n)
        L = length_summary(recs)
        rep[n] = {
            "min_p50": L["minutes_p50"], "min_p10": L["minutes_p10"], "min_p90": L["minutes_p90"],
            "in_window": L["share_30_45"], "score": L["score_mean"],
            "chars": {c: round(v["delta_pp"], 1) for c, v in char_summary(recs).items()},
            "seat0": seat_summary(recs)["seat_win_rate"][0],
            "mid_leader": dynamics_summary(recs)["mid_leader_wins"],
            "crush": dynamics_summary(recs)["events_per_game"].get("crush", 0),
        }
    rng = random.Random(seed)
    for lu in (("tactician", "greedy"), ("tactician", "cautious"), ("greedy", "cautious")):
        cs = [tuple(rng.sample(R.CHARACTERS, 2)) for _ in range(strat_games)]
        recs, _ = run_games(cfg, cs, [lu] * strat_games, seed0=seed + 99)
        w = defaultdict(float)
        for r in recs:
            for i in r["winners"]:
                w[r["ais"][i]] += 1 / len(r["winners"])
        rep["/".join(lu)] = round(w[lu[0]] / strat_games, 3)
    if verbose:
        show(cfg.version, rep)
    return rep


def show(name, rep):
    print(f"--- {name}")
    for n in (2, 3, 4):
        x = rep[n]
        spread = max(x["chars"].values()) - min(x["chars"].values())
        print(f"  {n}p min {x['min_p10']:.0f}/{x['min_p50']:.0f}/{x['min_p90']:.0f} win30-45 {x['in_window']:.2f} "
              f"seat0 {x['seat0']:.3f} midlead {x['mid_leader']:.2f} crush {x['crush']:.1f} score {x['score']:.1f} "
              f"spread {spread:.1f} {x['chars']}")
    print("  strat:", {k: v for k, v in rep.items() if isinstance(k, str)}, flush=True)


if __name__ == "__main__":
    base = R.current()
    for name, over in []:
        screen(base.with_(version=name, **over))
    sys.exit(0)


def duel(cfg, a, b="plain", games=2000, seed=77, strategy="tactician"):
    """2-player head-to-head, alternating seats. Returns a's win rate."""
    cs = [(a, b) if i % 2 == 0 else (b, a) for i in range(games)]
    recs, _ = run_games(cfg, cs, [(strategy, strategy)] * games, seed0=seed, rotate=False)
    w = 0.0
    for r in recs:
        for i in r["winners"]:
            if r["chars"][i] == a:
                w += 1 / len(r["winners"])
    return w / games


def lengths(cfg, games=1500, seed=3):
    out = {}
    for n in (2, 3, 4):
        cs = [tuple(random.Random(seed + i).sample(R.CHARACTERS, n)) for i in range(games)]
        recs, _ = run_games(cfg, cs, [("tactician",) * n] * games, seed0=seed + n)
        L = length_summary(recs)
        out[n] = (round(L["minutes_p10"]), round(L["minutes_p50"]), round(L["minutes_p90"]), round(L["share_30_45"], 2))
    return out
