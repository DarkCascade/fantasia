"""Batch experiments.

    python -m glimmer.run balance    [--version v3] [--games 10000]
    python -m glimmer.run strategies [--version v3] [--games 10000]
    python -m glimmer.run luck       [--version v3] [--games 10000]
    python -m glimmer.run all        [--version v3] [--games 10000]

Results land in ../results/<version>/<experiment>.json. Games run in worker
processes; each worker returns compact per-game records.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import random
import statistics as st
import sys
import time
import zlib
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

from . import ai as AI
from . import rules as R
from .engine import Game

RESULTS = Path(__file__).resolve().parents[2] / "results"

# Playtime model (stated in the Designer's Notes): each player turn takes ~45 s
# (read hand, play two cards, move, draw); each Warden phase ~10 s.
SEC_PER_TURN = 45
SEC_PER_TURN_RANGE = (30, 60)
SEC_WARDEN = 10


def _stable(t) -> int:
    return zlib.crc32("+".join(t).encode()) % 100_000


def minutes(turns: int, rounds: int, sec_turn: float = SEC_PER_TURN) -> float:
    return (turns * sec_turn + rounds * SEC_WARDEN) / 60.0


# ----------------------------------------------------------------- workers
def _game_record(res: dict) -> dict:
    snaps = res["snapshots"]
    n = res["n"]
    winners = res["winners"]
    rec = {k: res[k] for k in ("n", "chars", "ais", "first", "scores", "winners", "rounds", "turns",
                               "cards_played", "premium", "timed_out", "banked", "carried", "left_on_board")}
    rec["events"] = res["events"]
    # runaway-leader metrics from the per-round totals (banked + carried)
    if snaps:
        half = snaps[max(0, len(snaps) // 2 - 1)]
        mid_leaders = [i for i in range(n) if half[i] == max(half)]
        rec["mid_leader_won"] = any(i in winners for i in mid_leaders) and len(mid_leaders) == 1
        rec["mid_leader_unique"] = len(mid_leaders) == 1
        three_q = snaps[max(0, (3 * len(snaps)) // 4 - 1)]
        tq = [i for i in range(n) if three_q[i] == max(three_q)]
        rec["q3_leader_won"] = len(tq) == 1 and tq[0] in winners
        rec["q3_leader_unique"] = len(tq) == 1
        changes, prev = 0, None
        for s in snaps:
            top = max(s)
            lead = [i for i in range(n) if s[i] == top]
            if len(lead) == 1:
                if prev is not None and lead[0] != prev:
                    changes += 1
                prev = lead[0]
        rec["lead_changes"] = changes
    ss = sorted(res["scores"], reverse=True)
    rec["margin"] = ss[0] - ss[1]
    return rec


def _run_batch(job):
    cfg, char_sets, strat_sets, seeds, rotate = job
    usage = Counter()
    out = []
    for chars, strats, seed in zip(char_sets, strat_sets, seeds):
        rng = random.Random(seed ^ 0x5EED)
        chars = list(chars)
        strats = list(strats)
        if rotate:
            order = list(range(len(chars)))
            rng.shuffle(order)
            chars = [chars[i] for i in order]
            strats = [strats[i] for i in order]
        ais = [AI.make(s, seed + i) for i, s in enumerate(strats)]
        g = Game(cfg, chars, ais, seed, usage)
        res = g.play(first=0)
        out.append(_game_record(res))
    return out, usage


def run_games(cfg, char_sets, strat_sets, seed0=1, rotate=True, procs=None, batch=250):
    n = len(char_sets)
    seeds = [seed0 * 1_000_003 + i for i in range(n)]
    jobs = []
    for i in range(0, n, batch):
        jobs.append((cfg, char_sets[i:i + batch], strat_sets[i:i + batch], seeds[i:i + batch], rotate))
    records, usage = [], Counter()
    procs = procs or os.cpu_count() or 2
    with Pool(procs) as pool:
        for recs, u in pool.imap_unordered(_run_batch, jobs):
            records.extend(recs)
            usage.update(u)
    return records, usage


# ----------------------------------------------------------------- summaries
def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def length_summary(recs) -> dict:
    t = [r["turns"] for r in recs]
    rd = [r["rounds"] for r in recs]
    mins = [minutes(r["turns"], r["rounds"]) for r in recs]
    lo = [minutes(r["turns"], r["rounds"], SEC_PER_TURN_RANGE[0]) for r in recs]
    hi = [minutes(r["turns"], r["rounds"], SEC_PER_TURN_RANGE[1]) for r in recs]
    return {
        "games": len(recs),
        "turns_mean": st.mean(t), "rounds_mean": st.mean(rd),
        "turns_p10": pct(t, 0.1), "turns_p50": pct(t, 0.5), "turns_p90": pct(t, 0.9),
        "minutes_mean": st.mean(mins), "minutes_p10": pct(mins, 0.1), "minutes_p50": pct(mins, 0.5),
        "minutes_p90": pct(mins, 0.9), "minutes_lo_p50": pct(lo, 0.5), "minutes_hi_p50": pct(hi, 0.5),
        "share_30_45": sum(1 for m in mins if 30 <= m <= 45) / len(mins),
        "timed_out": sum(1 for r in recs if r["timed_out"]),
        "score_mean": st.mean(s for r in recs for s in r["scores"]),
        "margin_mean": st.mean(r["margin"] for r in recs),
        # whole-minute histogram of the 45 s/turn estimate, for the length charts
        "minutes_hist": {str(k): v for k, v in sorted(Counter(int(m) for m in mins).items())},
    }


def token_summary(recs, cfg) -> dict:
    """Tokens of each value that enter play in one game: the starting chambers
    plus every surge refill (tokens never return to the supply)."""
    out = {}
    for d, v in enumerate(cfg.depth_values, start=1):
        start = 4 * cfg.tokens_per_chamber  # four chambers per depth
        need = sorted(start + r["events"].get(f"surge_token_{v}", 0) for r in recs)
        out[str(v)] = {"p50": pct(need, 0.5), "p99": pct(need, 0.99), "p999": pct(need, 0.999), "max": need[-1],
                       "games": len(need)}
    return out


def dynamics_summary(recs) -> dict:
    mu = [r for r in recs if r.get("mid_leader_unique")]
    q3 = [r for r in recs if r.get("q3_leader_unique")]
    ev = Counter()
    for r in recs:
        ev.update(r["events"])
    n = len(recs)
    return {
        "mid_leader_wins": sum(r["mid_leader_won"] for r in mu) / max(1, len(mu)),
        "q3_leader_wins": sum(r["q3_leader_won"] for r in q3) / max(1, len(q3)),
        "lead_changes_mean": st.mean(r.get("lead_changes", 0) for r in recs),
        "events_per_game": {k: v / n for k, v in sorted(ev.items())},
        "left_on_board_mean": st.mean(r["left_on_board"] for r in recs),
    }


def char_summary(recs) -> dict:
    wins, games = defaultdict(float), defaultdict(int)
    for r in recs:
        w = 1.0 / len(r["winners"])
        for i, ch in enumerate(r["chars"]):
            games[ch] += 1
            if i in r["winners"]:
                wins[ch] += w
    n = recs[0]["n"]
    return {ch: {"games": games[ch], "win_rate": wins[ch] / games[ch], "fair": 1 / n,
                 "delta_pp": 100 * (wins[ch] / games[ch] - 1 / n)} for ch in sorted(games)}


def seat_summary(recs) -> dict:
    n = recs[0]["n"]
    wins = [0.0] * n
    for r in recs:
        for i in r["winners"]:
            wins[i] += 1.0 / len(r["winners"])
    return {"seat_win_rate": [w / len(recs) for w in wins], "fair": 1 / n}


def usage_summary(usage: Counter) -> dict:
    by_suit = defaultdict(Counter)
    by_rank = defaultdict(Counter)
    for (s, r, kind), v in usage.items():
        by_suit[R.SUIT_NAMES[s]][kind] += v
        by_rank[r][kind] += v
    def norm(d):
        out = {}
        for k, c in d.items():
            tot = sum(c.values())
            out[str(k)] = {"plays": tot, **{kk: vv / tot for kk, vv in sorted(c.items())}}
        return out
    return {"by_suit": norm(by_suit), "by_rank": norm(by_rank)}


# ----------------------------------------------------------------- experiments
def exp_balance(cfg, games_per, seed=11, strategy="tactician") -> dict:
    out = {"per_config": {}, "by_players": {}}
    all_usage = Counter()
    for n in (2, 3, 4):
        combos = list(itertools.combinations(R.CHARACTERS, n))
        recs_n = []
        for combo in combos:
            cs = [combo] * games_per
            ss = [(strategy,) * n] * games_per
            recs, usage = run_games(cfg, cs, ss, seed0=seed + _stable(combo))
            all_usage.update(usage)
            recs_n.extend(recs)
            key = f"{n}p:" + "+".join(combo)
            cs_sum = char_summary(recs)
            out["per_config"][key] = {"chars": cs_sum, "length": {k: v for k, v in length_summary(recs).items()
                                                                  if k in ("minutes_p50", "turns_mean", "share_30_45")}}
            print(f"  {key:<40} " + "  ".join(f"{c}:{v['win_rate']:.3f}" for c, v in cs_sum.items()), flush=True)
        out["by_players"][n] = {
            "chars": char_summary(recs_n), "seats": seat_summary(recs_n),
            "length": length_summary(recs_n), "dynamics": dynamics_summary(recs_n),
            "luck": luck_from(recs_n), "tokens": token_summary(recs_n, cfg),
        }
    out["usage"] = usage_summary(all_usage)
    return out


def luck_from(recs) -> dict:
    """Does drawing more high cards (7+, faces, aces) decide games? Win rate of
    the luckiest-drawing player vs the fair share."""
    lucky_wins, n_games = 0.0, 0
    for r in recs:
        prem = r["premium"]
        top = max(prem)
        lucky = [i for i in range(r["n"]) if prem[i] == top]
        if len(lucky) != 1:
            continue
        n_games += 1
        if lucky[0] in r["winners"]:
            lucky_wins += 1 / len(r["winners"])
    return {"luckiest_draw_win_rate": lucky_wins / max(1, n_games), "fair": 1 / recs[0]["n"]}


def exp_strategies(cfg, games_per, seed=23) -> dict:
    """Strategy matchups with random characters and random seats."""
    rng = random.Random(seed)
    strats = ["tactician", "greedy", "cautious"]
    out = {}
    for n in (2, 3, 4):
        lineups = []
        if n == 2:
            lineups = list(itertools.combinations(strats, 2)) + [(s, s) for s in strats]
        elif n == 3:
            lineups = [tuple(strats)] + [(s,) * 3 for s in strats]
        else:
            lineups = [("tactician", "greedy", "cautious", "tactician"), ("tactician", "greedy", "greedy", "cautious"),
                       ("tactician", "cautious", "cautious", "greedy")]
        for lu in lineups:
            cs = [tuple(rng.sample(R.CHARACTERS, n)) for _ in range(games_per)]
            ss = [lu] * games_per
            recs, _ = run_games(cfg, cs, ss, seed0=seed + _stable(lu))
            wins, games = defaultdict(float), defaultdict(int)
            for r in recs:
                for i, a in enumerate(r["ais"]):
                    games[a] += 1
                    if i in r["winners"]:
                        wins[a] += 1 / len(r["winners"])
            key = f"{n}p:" + "/".join(lu)
            out[key] = {a: wins[a] / games[a] for a in games}
            out[key]["_minutes_p50"] = length_summary(recs)["minutes_p50"]
            print(f"  {key:<45} " + "  ".join(f"{a}:{v:.3f}" for a, v in out[key].items()), flush=True)
    return out


def exp_luck(cfg, games_per, seed=31) -> dict:
    """Skill vs luck: how often does a much weaker player beat a strong one?"""
    rng = random.Random(seed)
    out = {}
    for n, lineup in ((2, ("tactician", "random")), (2, ("tactician", "tactician")), (4, ("tactician", "random", "random", "random"))):
        cs = [tuple(rng.sample(R.CHARACTERS, n)) for _ in range(games_per)]
        recs, _ = run_games(cfg, cs, [lineup] * games_per, seed0=seed + n)
        wins = defaultdict(float)
        games = Counter()
        for r in recs:
            for i, a in enumerate(r["ais"]):
                games[a] += 1
                if i in r["winners"]:
                    wins[a] += 1 / len(r["winners"])
        key = f"{n}p:" + "/".join(lineup)
        out[key] = {a: wins[a] / games[a] for a in games}
        out[key]["luck"] = luck_from(recs)
        print(f"  {key:<40} {out[key]}", flush=True)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("experiment", choices=["balance", "strategies", "luck", "all"])
    ap.add_argument("--version", default=R.CURRENT)
    ap.add_argument("--games", type=int, default=10000)
    a = ap.parse_args(argv)
    cfg = R.VERSIONS[a.version]
    outdir = RESULTS / a.version
    outdir.mkdir(parents=True, exist_ok=True)
    todo = ["balance", "strategies", "luck"] if a.experiment == "all" else [a.experiment]
    for exp in todo:
        t0 = time.time()
        print(f"== {exp} ({a.version}, {a.games} games/config)", flush=True)
        res = {"balance": exp_balance, "strategies": exp_strategies, "luck": exp_luck}[exp](cfg, a.games)
        res["_meta"] = {"version": a.version, "games_per_config": a.games, "seconds": time.time() - t0,
                        "sec_per_turn": SEC_PER_TURN, "sec_warden": SEC_WARDEN}
        (outdir / f"{exp}.json").write_text(json.dumps(res, indent=1, default=str))
        print(f"   done in {time.time() - t0:.0f}s -> {outdir / (exp + '.json')}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
