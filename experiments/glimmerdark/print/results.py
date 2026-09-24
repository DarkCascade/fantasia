"""Read the simulator's results (results/<version>/*.json) for the Designer's
Notes, the changelog and the few printed numbers that come from simulation."""

from __future__ import annotations

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parents[1] / "results"
VERSIONS = ("v1", "v2", "v3", "v4")
EXPERIMENTS = ("balance", "strategies", "luck", "lengths", "abilities")
PLAYERS = ("2", "3", "4")


def load(version: str) -> dict:
    out = {}
    for exp in EXPERIMENTS:
        f = RESULTS / version / f"{exp}.json"
        if f.exists():
            out[exp] = json.loads(f.read_text())
    return out


def load_all() -> dict:
    return {v: load(v) for v in VERSIONS if (RESULTS / v).exists()}


def games_in(exp: str, data: dict) -> int:
    """Games behind one experiment file."""
    per = data["_meta"]["games_per_config"]
    if exp == "balance":
        return per * len(data["per_config"])
    if exp in ("lengths",):
        return per * len(PLAYERS)
    return per * sum(1 for k in data if not k.startswith("_"))


def games_total(all_results: dict | None = None) -> int:
    all_results = all_results if all_results is not None else load_all()
    return sum(games_in(e, d) for res in all_results.values() for e, d in res.items())


def token_need(version: str = "v4") -> dict:
    """{value: {"p99", "p999", "max", "games"}} across every balance game of this version."""
    bal = load(version).get("balance")
    if not bal or "tokens" not in bal["by_players"]["2"]:
        return {}
    out = {}
    for n in PLAYERS:
        for v, q in bal["by_players"][n]["tokens"].items():
            o = out.setdefault(int(v), {"p99": 0, "p999": 0, "max": 0, "games": 0})
            for k in ("p99", "p999", "max"):
                o[k] = max(o[k], q[k])
            o["games"] += q["games"]
    return out
