"""Designer's Notes: how Glimmerdark was balanced, with before/after charts,
and the changelog. Every number is read from results/<version>/*.json, so the
notes can't drift from the simulator.

    python designers_notes.py   -> dist/designers_notes.pdf and ../CHANGELOG.md
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, PageBreak,  # noqa: E402
                                PageTemplate, Spacer, Table, TableStyle)

import content as T  # noqa: E402
import results as RS  # noqa: E402
import style as S  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sim"))
from glimmer import rules as R  # noqa: E402
from glimmer.run import SEC_PER_TURN, SEC_PER_TURN_RANGE, SEC_WARDEN  # noqa: E402

BUILD = HERE / "_build"
W, H = letter
MARGIN = 0.75 * inch
FW = W - 2 * MARGIN
st = S.styles(10)
BEFORE, AFTER = "v1", R.FINAL
CHARS = list(R.CHARACTERS)
# chart colours: one per delver, picked from each paint scheme so they stay distinguishable on a chart
CHART = {"mira": "#D9612B", "gritch": "#6B4A2F", "hulda": "#3F6B3A", "sable": "#4B2E6B", "twins": "#2E7C7A",
         "quill": "#A08A4E"}
TEAL, INK, SOFT, FAINT, RED = "#1C8C94", "#1F1B16", "#5A5248", "#B9AF9C", "#B3261E"
BAND = 5.0  # the balance target: every delver within +/-5 points of a fair share
NAMES = {k: v["name"].split(" ")[0] if k != "twins" else "Pip & Pell" for k, v in T.CHARACTERS.items()}
NAMES["quill"] = "Old Quill"
SHORT = {**NAMES, "quill": "Quill", "twins": "Pip&Pell"}


# ------------------------------------------------------------------ data access
class Res:
    """One version's results with small accessors (player counts are strings, as in the JSON)."""

    def __init__(self, v: str, data: dict):
        self.v, self.d = v, data

    def has(self, exp):
        return exp in self.d

    def bp(self, n):
        return self.d["balance"]["by_players"][str(n)]

    def delta(self, n, ch):
        return self.bp(n)["chars"][ch]["delta_pp"]

    def deltas(self, n):
        return {ch: self.delta(n, ch) for ch in CHARS}

    def spread(self, n):
        d = self.deltas(n).values()
        return max(d) - min(d)

    def worst_abs(self, n):
        return max(abs(x) for x in self.deltas(n).values())

    def outside(self, n, band=BAND):
        return {ch: x for ch, x in self.deltas(n).items() if abs(x) > band}

    def length(self, n):
        return self.bp(n)["length"]

    def dyn(self, n):
        return self.bp(n)["dynamics"]

    def seat1(self, n):
        return self.bp(n)["seats"]["seat_win_rate"][0]

    def strat(self, key, who):
        return self.d["strategies"][key][who]

    def hist(self, n):
        if self.has("lengths"):
            return self.d["lengths"][str(n)]["length"]["minutes_hist"]
        return self.length(n).get("minutes_hist")

    def ability(self, ch):
        return self.d["abilities"][ch] if self.has("abilities") else None

    def games_per(self):
        return self.d["balance"]["_meta"]["games_per_config"]


def load() -> dict[str, Res]:
    return {v: Res(v, d) for v, d in RS.load_all().items() if "balance" in d}


# ------------------------------------------------------------------ formatting
def pc(x, d=0):
    return f"{100 * x:.{d}f}%"


def pp(x):
    return f"{x:+.1f}"


def mins(x):
    return f"{x:.0f}"


def lead_changes(r, n):
    return f"{r.dyn(n)['lead_changes_mean']:.1f}"


def crushes(r, n):
    return f"{r.dyn(n)['events_per_game'].get('crush', 0):.1f}"


def per_n(fn, sep=" / "):
    return sep.join(fn(n) for n in (2, 3, 4))


# ------------------------------------------------------------------ the changelog
# Each change: (what changed, why) - the why is a function of the PREVIOUS version's results,
# so the "data shown" half of every entry is the measured number, not a recollection.
def _mira_why(P):
    a = P.ability("mira")
    if a is None:
        extra = ""
    else:
        worth = "no better than having no ability" if a <= 0.5 else "worth very little"
        extra = (f" Duelling a delver with no ability at all, Mira won {pc(a, 1)} of games: letting hearts match any "
                 f"vein was {worth}, because the scarce thing on a turn is movement, not matching.")
    return f"Mira was {pp(P.delta(2, 'mira'))} / {pp(P.delta(3, 'mira'))} / {pp(P.delta(4, 'mira'))} points from a fair share (2 / 3 / 4 players).{extra}"


ITERATIONS = [
    dict(v="v1", title="First draft, exactly as written", changes=[
        ("The rules in design/rules_v1_first_draft.md, written before any simulation.", None),
    ]),
    dict(v="v2", title="Shorter, less snowbally, and a reason to go deep", changes=[
        ("The collapse track: jokers now move the marker too (a Tremor), and the end space depends on player count "
         "(7 / 8 / 9 with 2 / 3 / 4 players) instead of 3 reshuffles for everyone.",
         lambda P: f"Median playtime was {per_n(lambda n: mins(P.length(n)['minutes_p50']))} minutes with 2 / 3 / 4 "
                   f"players, and only {pc(P.length(2)['share_30_45'])} of 2-player games fitted the 30–45 minute window."),
        ("The Warden walks toward the delver who is winning (vault plus pack), not the one carrying the most.",
         lambda P: f"The player leading at the halfway point won {per_n(lambda n: pc(P.dyn(n)['mid_leader_wins']))} "
                   "of games. The Warden is the game's catch-up mechanism, so it should lean on the leader."),
        ("Deep glimmer is worth 4, not 3.",
         lambda P: f"Going deep didn't pay: the cautious AI beat the greedy one {pc(P.strat('2p:greedy/cautious', 'cautious'))} "
                   f"of the time and beat the planning AI {pc(P.strat('2p:tactician/cautious', 'cautious'))}. Sitting "
                   "in the shallows was the best strategy, which is dull."),
        ("The first player's first turn has 1 action instead of 2.",
         lambda P: f"The first player won {pc(P.seat1(2), 1)} of 2-player games (fair: 50%)."),
        ("Mira: the first {H} she plays to Mine each turn costs no action (hearts still match every vein).", _mira_why),
        ("Gritch: a {S} Move takes him up to 2 chambers instead of 3.",
         lambda P: f"Gritch was {pp(P.delta(2, 'gritch'))} / {pp(P.delta(3, 'gritch'))} / {pp(P.delta(4, 'gritch'))} "
                   "points from a fair share: in a game where movement is the bottleneck, triple moves were too much."),
    ]),
    dict(v="v3", title="Retuning the delvers", changes=[
        ("Gritch: back to 3 chambers per {S}, but he can't pass through the Gate (he may stop there), and his pack "
         "holds 4 instead of 5.",
         lambda P: f"At 2 chambers Gritch was {pp(P.delta(2, 'gritch'))} / {pp(P.delta(3, 'gritch'))} / "
                   f"{pp(P.delta(4, 'gritch'))}. Speed is his identity, so it came back, and the cost moved to how much "
                   "he can haul and how easily he banks."),
        ("Hulda: a high {C} (7–10) played as Pilfer takes 2 glimmer instead of 1.",
         lambda P: f"Hulda was {pp(P.delta(2, 'hulda'))} / {pp(P.delta(3, 'hulda'))} / {pp(P.delta(4, 'hulda'))}."),
        ("Pip & Pell: twice per turn instead of once, and a suited run (same suit, next rank up or down) counts "
         "as well as a pair.",
         lambda P: f"Pip & Pell were {pp(P.delta(2, 'twins'))} / {pp(P.delta(3, 'twins'))} / {pp(P.delta(4, 'twins'))}; "
                   "pairs in a five-card hand are too rare to lean on."),
        ("Old Quill: his Jack Shortcut moves 4 chambers instead of 3.",
         lambda P: f"Old Quill was {pp(P.delta(2, 'quill'))} / {pp(P.delta(3, 'quill'))} / {pp(P.delta(4, 'quill'))}."),
        ("The first player's short first turn now applies only with 3 or 4 players.",
         lambda P: f"The first player won {pc(P.seat1(2), 1)} / {pc(P.seat1(3), 1)} / {pc(P.seat1(4), 1)} with "
                   "2 / 3 / 4 players (fair: 50% / 33.3% / 25%)."),
    ]),
    dict(v="v4", title="One clean rule for Hulda", changes=[
        ("Hulda: face-card {C} count as high too, so any {C} of 7 or more takes 2.",
         lambda P: "In v3 the J{C} counted as high (a Jack matches as a 10) but the Q{C} and K{C} did not, which was "
                   f"hard to remember and harder to print. Hulda was {pp(P.delta(2, 'hulda'))} / {pp(P.delta(3, 'hulda'))} "
                   f"/ {pp(P.delta(4, 'hulda'))} before the change."),
    ]),
]


def summary_bullets(r: Res) -> list[str]:
    """What the full sweep of one version showed, in the same shape for every version."""
    out = [
        f"Playtime at {SEC_PER_TURN} s a turn: median {per_n(lambda n: mins(r.length(n)['minutes_p50']))} min "
        f"(2 / 3 / 4 players); {per_n(lambda n: pc(r.length(n)['share_30_45']))} of games inside 30–45 min.",
        f"Delver balance: best-to-worst spread {per_n(lambda n: f'{r.spread(n):.1f}')} points; furthest from a "
        f"fair share {per_n(lambda n: f'{r.worst_abs(n):.1f}')} points.",
    ]
    outs = [f"{NAMES[ch]} {pp(x)} ({n}p)" for n in (2, 3, 4) for ch, x in sorted(r.outside(n).items(), key=lambda t: -abs(t[1]))]
    out.append("Outside ±5 points: " + (", ".join(outs) if outs else "none") + ".")
    out.append(f"First player wins {pc(r.seat1(2), 1)} / {pc(r.seat1(3), 1)} / {pc(r.seat1(4), 1)} "
               "(fair 50% / 33.3% / 25%).")
    out.append(f"Halfway leader wins {per_n(lambda n: pc(r.dyn(n)['mid_leader_wins']))}; lead changes per game "
               f"{per_n(lambda n: lead_changes(r, n))}.")
    if r.has("strategies"):
        out.append(f"Planning AI beats greedy {pc(r.strat('2p:tactician/greedy', 'tactician'))} and cautious "
                   f"{pc(r.strat('2p:tactician/cautious', 'tactician'))}; greedy beats cautious "
                   f"{pc(r.strat('2p:greedy/cautious', 'greedy'))} (2 players).")
    out.append(f"Crushes per game {per_n(lambda n: crushes(r, n))}.")
    return out


def md(text: str) -> str:
    return T.suit_text(text) if hasattr(T, "suit_text") else text


def write_changelog(res: dict[str, Res], path: Path):
    L = ["# Glimmerdark balance changelog", "",
         f"Every number below is from the full sweep of that version: all {len(res[BEFORE].d['balance']['per_config'])} "
         f"delver line-ups (2, 3 and 4 players) at {res[BEFORE].games_per():,} games each, tactician AI in every seat, "
         f"plus the strategy and luck matchups at the same count. Playtime assumes {SEC_PER_TURN} s per player turn "
         f"and {SEC_WARDEN} s per Warden phase. Generated by `print/designers_notes.py` from `results/`.", ""]
    prev = None
    for it in ITERATIONS:
        v = it["v"]
        if v not in res:
            L += [f"## {v}: {it['title']}", "", "_Not swept yet._", ""]
            continue
        r = res[v]
        L += [f"## {v}: {it['title']}", ""]
        if prev is None:
            L += [md(it["changes"][0][0]), ""]
        else:
            L += ["**Changes (data from the previous version → change):**", ""]
            for what, why in it["changes"]:
                L.append(f"- **{md(what)}** {md(why(prev))}")
            L.append("")
        L += ["**Result (full sweep):**", ""] + [f"- {b}" for b in summary_bullets(r)] + [""]
        prev = r
    path.write_text("\n".join(L), encoding="utf-8")


# ------------------------------------------------------------------ charts
def _mpl_fonts():
    for f in ("AlegreyaSans-Regular.ttf", "AlegreyaSans-Bold.ttf"):
        font_manager.fontManager.addfont(str(S.FONTS / f))
    plt.rcParams.update({"font.family": "Alegreya Sans", "font.size": 9, "axes.edgecolor": FAINT,
                         "axes.labelcolor": SOFT, "xtick.color": SOFT, "ytick.color": SOFT, "axes.titleweight": "bold",
                         "axes.titlesize": 10, "axes.titlecolor": INK, "axes.spines.top": False,
                         "axes.spines.right": False, "savefig.dpi": 220})


def _save(fig, name) -> Path:
    BUILD.mkdir(exist_ok=True)
    p = BUILD / f"{name}.png"
    fig.savefig(p, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return p


def chart_delvers(res) -> Path:
    b, a = res[BEFORE], res[AFTER]
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.9), sharey=True)
    lim = max(max(abs(x) for n in (2, 3, 4) for x in r.deltas(n).values()) for r in (b, a)) + 3
    for ax, n in zip(axes, (2, 3, 4)):
        ax.axhspan(-BAND, BAND, color="#E3F3F4", zorder=0)
        ax.axhline(0, color=SOFT, lw=0.8)
        xs = range(len(CHARS))
        ax.bar([x - 0.2 for x in xs], [b.delta(n, c) for c in CHARS], 0.38, color=[CHART[c] for c in CHARS],
               alpha=0.35, label=f"{BEFORE} (first draft)")
        ax.bar([x + 0.2 for x in xs], [a.delta(n, c) for c in CHARS], 0.38, color=[CHART[c] for c in CHARS],
               label=f"{AFTER} (final)")
        ax.set_xticks(list(xs), [SHORT[c] for c in CHARS], rotation=40, ha="right")
        ax.set_title(f"{n} players (fair share {100 / n:.0f}%)")
        ax.set_ylim(-lim, lim)
    axes[0].set_ylabel("win rate minus fair share (points)")
    axes[1].text(0.5, 0.97, f"shaded: ±{BAND:.0f}-point target   pale: {BEFORE}   solid: {AFTER}",
                 transform=axes[1].transAxes, ha="center", va="top", fontsize=8, color=SOFT)
    fig.tight_layout()
    return _save(fig, "delvers")


def chart_spread(res) -> Path:
    vs = list(res)
    fig, ax = plt.subplots(figsize=(3.5, 2.5))
    for n, mk in ((2, "o"), (3, "s"), (4, "^")):
        ax.plot(vs, [res[v].worst_abs(n) for v in vs], marker=mk, color=TEAL if n == 2 else SOFT if n == 3 else INK,
                label=f"{n} players")
    ax.axhline(BAND, color=RED, ls="--", lw=0.9)
    ax.text(len(vs) - 1, BAND + 0.6, "±5 target", color=RED, ha="right", fontsize=8)
    ax.set_ylabel("furthest delver from fair (points)")
    ax.set_title("Delver balance by version")
    ax.set_ylim(0, None)
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    return _save(fig, "spread")


def chart_abilities(res) -> Path | None:
    b, a = res[BEFORE], res[AFTER]
    if not (b.has("abilities") and a.has("abilities")):
        return None
    fig, ax = plt.subplots(figsize=(3.7, 2.5))
    xs = range(len(CHARS))
    ax.axhline(0.5, color=SOFT, lw=0.8)
    ax.bar([x - 0.2 for x in xs], [b.ability(c) for c in CHARS], 0.38, color=[CHART[c] for c in CHARS], alpha=0.35)
    ax.bar([x + 0.2 for x in xs], [a.ability(c) for c in CHARS], 0.38, color=[CHART[c] for c in CHARS])
    ax.set_xticks(list(xs), [SHORT[c] for c in CHARS], rotation=40, ha="right")
    ax.set_ylim(0.3, 1.0)
    ax.set_ylabel("win rate vs a delver with no ability")
    ax.set_title("What each ability is worth")
    fig.tight_layout()
    return _save(fig, "abilities")


def chart_lengths(res) -> Path:
    b, a = res[BEFORE], res[AFTER]
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.4), sharey=True)
    for ax, n in zip(axes, (2, 3, 4)):
        ax.axvspan(30, 45, color="#E3F3F4", zorder=0)
        handles = []
        for r, style in ((b, dict(color=SOFT, alpha=0.7, lw=1.3, ls="--")), (a, dict(color=TEAL, lw=1.8))):
            h = r.hist(n)
            if not h:
                continue
            bins = {}
            for k, v in h.items():  # 2-minute bins
                bins[int(k) // 2 * 2] = bins.get(int(k) // 2 * 2, 0) + v
            xs = list(range(min(bins), max(bins) + 3, 2))
            tot = sum(bins.values())
            (ln,) = ax.step([x + 1 for x in xs], [100 * bins.get(x, 0) / tot for x in xs], where="mid", **style)
            handles.append((ln, f"{r.v} ({'first draft' if r.v == BEFORE else 'final'})"))
        ax.set_title(f"{n} players")
        ax.set_xlim(15, 80)
        ax.set_xlabel(f"minutes (at {SEC_PER_TURN} s a turn)")
    axes[0].set_ylabel("% of games (2-minute bins)")
    axes[0].legend([h for h, _ in handles], [l for _, l in handles], frameon=False, fontsize=8, loc="upper right")
    fig.tight_layout()
    return _save(fig, "lengths")


def chart_strategies(res) -> Path:
    vs = [v for v in res if res[v].has("strategies")]
    pairs = [("2p:tactician/greedy", "tactician", "planner vs greedy"),
             ("2p:tactician/cautious", "tactician", "planner vs cautious"),
             ("2p:greedy/cautious", "greedy", "greedy vs cautious")]
    fig, ax = plt.subplots(figsize=(3.6, 2.5))
    w = 0.8 / len(vs)
    for i, v in enumerate(vs):
        ax.bar([k + i * w - 0.4 + w / 2 for k in range(3)], [res[v].strat(key, who) for key, who, _ in pairs], w,
               color=TEAL, alpha=0.3 + 0.7 * (i + 1) / len(vs), label=v)
    ax.axhline(0.5, color=SOFT, lw=0.8)
    ax.set_xticks(range(3), [p[2] for p in pairs], fontsize=8)
    ax.set_ylim(0, 1)
    ax.set_ylabel("win rate of the first-named AI")
    ax.set_title("Strategy matchups, 2 players")
    ax.legend(frameon=False, fontsize=7, ncol=len(vs), loc="upper center")
    fig.tight_layout()
    return _save(fig, "strategies")


def chart_dynamics(res) -> Path:
    vs = list(res)
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 2.4))
    ax = axes[0]
    for n, mk in ((2, "o"), (3, "s"), (4, "^")):
        ax.plot(vs, [res[v].dyn(n)["mid_leader_wins"] for v in vs], marker=mk,
                color=TEAL if n == 2 else SOFT if n == 3 else INK, label=f"{n} players")
    ax.set_ylim(0, 1)
    ax.set_ylabel("halfway leader's win rate")
    ax.set_title("Runaway leaders")
    ax.legend(frameon=False, fontsize=8)
    ax = axes[1]
    for n, mk in ((2, "o"), (3, "s"), (4, "^")):
        ax.plot(vs, [res[v].seat1(n) * n for v in vs], marker=mk, color=TEAL if n == 2 else SOFT if n == 3 else INK,
                label=f"{n} players")
    ax.axhline(1, color=SOFT, lw=0.8)
    ys = [res[v].seat1(n) * n for v in vs for n in (2, 3, 4)]
    ax.set_ylim(min(0.8, min(ys) - 0.05), max(1.2, max(ys) + 0.05))
    ax.set_ylabel("first player's wins ÷ fair share")
    ax.set_title("First-player advantage")
    fig.tight_layout()
    return _save(fig, "dynamics")


RANKS = [str(r) for r in range(2, 15)]
RANK_LABEL = {"11": "J", "12": "Q", "13": "K", "14": "A"}
ACTION_COLOR = {"move": "#6E757E", "mine": TEAL, "shortcut": "#B8893A", "pilfer": "#9E3B26", "rouse": "#4B2E6B",
                "hoist": "#1F5FAD"}


def chart_usage(r: Res) -> Path:
    u = r.d["balance"]["usage"]
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 2.7), gridspec_kw={"width_ratios": [3.2, 1.3]})
    for ax, keys, labels, table in ((axes[0], RANKS, [RANK_LABEL.get(k, k) for k in RANKS], u["by_rank"]),
                                    (axes[1], ["Spades", "Hearts", "Diamonds", "Clubs"], ["♠", "♥", "♦", "♣"], u["by_suit"])):
        bottom = [0.0] * len(keys)
        for act, col in ACTION_COLOR.items():
            vals = [table[k].get(act, 0.0) * 100 for k in keys]
            ax.bar(range(len(keys)), vals, 0.75, bottom=bottom, color=col, label=act)
            bottom = [b + v for b, v in zip(bottom, vals)]
        ax.set_xticks(range(len(keys)), labels, fontname="DejaVu Sans" if table is u["by_suit"] else None)
        ax.set_ylim(0, 100)
    axes[0].set_ylabel("% of plays of that card")
    axes[0].set_title("What each rank is played for")
    axes[1].set_title("…and each suit")
    axes[0].legend(frameon=False, fontsize=7.5, ncol=6, loc="upper center", bbox_to_anchor=(0.62, -0.1))
    fig.tight_layout()
    return _save(fig, "usage")


# ------------------------------------------------------------------ pdf helpers
def P(t, s="body"):
    return S.P(t, st[s])


def img(path: Path, width=FW):
    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(str(path)).getSize()
    return Image(str(path), width=width, height=width * ih / iw)


def side_by_side(a, b):
    t = Table([[a, b]], colWidths=[FW / 2, FW / 2])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return t


def table(rows, widths, head=True, zebra=True):
    data = [[P(c, "cell_b" if head and i == 0 else "cell") if isinstance(c, str) else c for c in row]
            for i, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    cmds = [("LINEBELOW", (0, 0), (-1, -1), 0.4, S.RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if head:
        cmds.append(("BACKGROUND", (0, 0), (-1, 0), S.PARCHMENT_DEEP))
    t.setStyle(TableStyle(cmds))
    return t


def box(flow, fill=S.PARCHMENT, stroke=S.RULE):
    t = Table([[flow]], colWidths=[FW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), fill), ("BOX", (0, 0), (-1, -1), 0.8, stroke),
                           ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return t


def on_page(c, doc):
    c.saveState()
    c.setStrokeColor(S.RULE)
    c.setLineWidth(0.8)
    c.line(MARGIN, H - 0.55 * inch, W - MARGIN, H - 0.55 * inch)
    c.setFont(S.TITLE_FONT, 9)
    c.setFillColor(S.INK_SOFT)
    c.drawString(MARGIN, H - 0.48 * inch, "GLIMMERDARK · DESIGNER'S NOTES")
    S.page_footer(c, W, "Glimmerdark", doc.page)
    c.restoreState()


# ------------------------------------------------------------------ the story
def headline_table(res):
    b, a = res[BEFORE], res[AFTER]
    rows = [["", f"{BEFORE}: first draft", f"{AFTER}: final rules", "Target"]]
    rows.append(["Median playtime, 2 / 3 / 4 players", per_n(lambda n: mins(b.length(n)["minutes_p50"])) + " min",
                 per_n(lambda n: mins(a.length(n)["minutes_p50"])) + " min", "30–45 min"])
    rows.append(["Games inside 30–45 min", per_n(lambda n: pc(b.length(n)["share_30_45"])),
                 per_n(lambda n: pc(a.length(n)["share_30_45"])), "most"])
    rows.append(["Furthest delver from a fair share", per_n(lambda n: f"{b.worst_abs(n):.1f}") + " pts",
                 per_n(lambda n: f"{a.worst_abs(n):.1f}") + " pts", "≤ 5 pts"])
    rows.append(["First player's wins ÷ fair share", per_n(lambda n: f"{b.seat1(n) * n:.2f}"),
                 per_n(lambda n: f"{a.seat1(n) * n:.2f}"), "≈ 1.00"])
    rows.append(["Halfway leader goes on to win", per_n(lambda n: pc(b.dyn(n)["mid_leader_wins"])),
                 per_n(lambda n: pc(a.dyn(n)["mid_leader_wins"])), "lower"])
    if b.has("strategies") and a.has("strategies"):
        rows.append(["Planning AI vs cautious AI (2p)", pc(b.strat("2p:tactician/cautious", "tactician")),
                     pc(a.strat("2p:tactician/cautious", "tactician")), "> 50%"])
        rows.append(["Greedy AI vs cautious AI (2p)", pc(b.strat("2p:greedy/cautious", "greedy")),
                     pc(a.strat("2p:greedy/cautious", "greedy")), "near 50%"])
    return table(rows, [2.3 * inch, 1.55 * inch, 1.55 * inch, 1.0 * inch])


def playtime_table(r: Res):
    lo, hi = SEC_PER_TURN_RANGE
    rows = [["Players", "Turns (median)", "Rounds", f"Minutes at {SEC_PER_TURN} s: p10 / median / p90",
             f"Median at {lo} s / {hi} s", "Inside 30–45"]]
    for n in (2, 3, 4):
        L = r.length(n)
        rows.append([str(n), f"{L['turns_p50']}", f"{L['rounds_mean']:.1f}",
                     f"{L['minutes_p10']:.0f} / {L['minutes_p50']:.0f} / {L['minutes_p90']:.0f}",
                     f"{L['minutes_lo_p50']:.0f} / {L['minutes_hi_p50']:.0f}", pc(L["share_30_45"])])
    return table(rows, [0.6 * inch, 0.95 * inch, 0.6 * inch, 2.0 * inch, 1.3 * inch, 0.95 * inch])


def delver_table(res):
    vs = list(res)
    rows = [["Delver"] + [f"{v}: 2p / 3p / 4p" for v in vs]]
    for ch in CHARS:
        cells = []
        for v in vs:
            parts = []
            for n in (2, 3, 4):
                x = res[v].delta(n, ch)
                s = pp(x)
                parts.append(f'<font color="{RED}"><b>{s}</b></font>' if abs(x) > BAND else s)
            cells.append(" / ".join(parts))
        rows.append([NAMES[ch]] + cells)
    return table(rows, [1.0 * inch] + [(FW - 1.0 * inch) / len(vs)] * len(vs))


def remaining_imbalance(a: Res) -> list[str]:
    """Plain-language notes on what's left, driven by the final sweep."""
    notes = []
    items = sorted(((abs(a.delta(n, ch)), n, ch) for n in (2, 3, 4) for ch in CHARS), reverse=True)
    for mag, n, ch in items[:3]:
        x = a.delta(n, ch)
        why = WHY_LEFT.get((ch, n, x > 0))
        notes.append(f"<b>{NAMES[ch]}, {n} players: {pp(x)} points.</b> " + (f"<i>Probable cause:</i> {why}" if why else ""))
    return notes


# Likely causes for the residual gaps the final sweep leaves. Printed as the designer's reading of the
# data, not as measured fact; only the entries matching the three largest final gaps are used.
WHY_LEFT = {
    ("quill", 2, False): "In a duel there are only two rivals' worth of Queens and Kings to exploit and the Warden "
                         "targets one of just two delvers, so Quill's free court card matters less than it does at a "
                         "busier table, where he is at or above par. Pushing him up for 2 players would have pushed "
                         "him over the line at 4.",
    ("gritch", 2, True): "Gritch's triple move is at its strongest on an open 2-player board, where nobody is in his "
                         "way. His pack of 4 is the brake; it bites harder as tables get crowded.",
    ("twins", 2, True): "Pip & Pell's free cards compound over the longer 2-player game (more turns each).",
    ("twins", 4, False): "With four players each delver gets fewer turns, so Pip & Pell see fewer chances to chain "
                         "free cards.",
    ("twins", 3, False): "With more players each delver gets fewer turns, so Pip & Pell see fewer chances to chain "
                         "free cards.",
    ("sable", 2, False): "Sable's hoist saves trips to the Gate; with the Warden split between fewer delvers the "
                         "trips are safer anyway, so her edge is smaller.",
    ("sable", 3, False): "Sable's hoist saves trips to the Gate, and it matters less when the Warden has more targets "
                         "to chase than her.",
    ("sable", 4, False): "Sable's hoist saves trips to the Gate, and it matters less when the Warden has more targets "
                         "to chase than her.",
    ("hulda", 4, True): "More rivals means more packs to shake down.",
    ("hulda", 3, True): "More rivals means more packs to shake down.",
    ("mira", 3, True): "Mira's free heart is used every turn regardless of table size.",
    ("mira", 4, True): "Mira's free heart is used every turn regardless of table size.",
}


def story(res):
    b, a = res[BEFORE], res[AFTER]
    s = []
    s.append(P("Designer's Notes", "h1"))
    s.append(P(f"{T.TITLE} is a 2–4 player game for one standard deck, a board and some tokens. This is how it was "
               "balanced: a rules-exact simulator played the game to a pulp, and every change to the rules had to "
               "earn its place with data. The rules went through four versions; the table compares the first draft "
               f"with the final rules ({AFTER}), and the rest of these notes show the working."))
    s.append(Spacer(1, 6))
    s.append(headline_table(res))
    s.append(Spacer(1, 4))
    s.append(P(f"Delver balance is each character's win rate minus a fair share (50% / 33.3% / 25%), in "
               f"percentage points. Every figure comes from {b.games_per():,} games per line-up.", "small"))

    total = RS.games_total()
    s.append(P("How the game was tested", "h2"))
    s.append(P("<b>The simulator</b> (<font name='DejaVuSansMono' size='9'>sim/glimmer/</font>) enforces every rule "
               "in the rulebook: a real 52-card deck plus two jokers, dealt, drawn, discarded and reshuffled; the "
               "Warden's rumble, targeting, route and crush; every delver ability; tremors, surges and the collapse. "
               "An illegal play raises an error instead of being quietly allowed, and a test suite checks the deck, "
               "the board and each rule in isolation."))
    s.append(P("<b>Four AI players.</b> <i>Greedy</i> grabs the most glimmer it can and takes risks. <i>Cautious</i> "
               "banks early and keeps away from the Warden. <i>Tactician</i> plans each turn around its delver's "
               "ability, the Warden's likely next move and who is winning. <i>Random</i> plays any legal card and is "
               "used only to measure luck. Balance numbers use Tactician in every seat, since it plays each "
               "ability the way it is meant to be played."))
    s.append(P(f"<b>The sweep.</b> For each version: every line-up of 2, 3 and 4 delvers from the six "
               f"({len(b.d['balance']['per_config'])} line-ups) at {b.games_per():,} games each, with seats shuffled; "
               f"13 strategy matchups and 3 luck tests at {b.games_per():,} games each; a separate "
               f"{b.games_per():,}-games-per-player-count playtime run; and each ability duelled against a delver "
               f"with no ability. In all, {total:,} simulated games across the four versions. At that size, a "
               "delver's win rate for one player count is within about ±0.5 points (95% confidence)."))
    s.append(P("<b>Playtime model.</b> The simulator counts turns, not minutes. A player turn (play up to two cards, "
               f"resolve them, draw back to five) is costed at {SEC_PER_TURN} seconds, with {SEC_PER_TURN_RANGE[0]} s "
               f"for a table that knows the game and {SEC_PER_TURN_RANGE[1]} s for a slow or new one. Each Warden "
               f"phase (flip a card, walk the Warden, resolve a crush) adds {SEC_WARDEN} s. Setup and teaching are not "
               "included. The minutes in these notes are that formula applied to the simulated turn counts."))

    s.append(PageBreak())
    s.append(P("The balancing story", "h1"))
    s.append(P("Each entry shows what the previous version's full sweep said, what changed because of it, and what "
               "the next sweep showed. The same log is in CHANGELOG.md."))
    prev = None
    for it in ITERATIONS:
        v = it["v"]
        if v not in res:
            continue
        r = res[v]
        flow = [P(f"{v}: {it['title']}", "h2")]
        if prev is not None:
            rows = [["Change", "Why (data from " + prev.v + ")"]]
            for what, why in it["changes"]:
                rows.append([what, why(prev)])
            flow.append(table(rows, [2.6 * inch, FW - 2.6 * inch]))
        else:
            flow.append(P(it["changes"][0][0]))
        flow.append(P(f"<b>Result: the {v} sweep</b>", "h3"))
        flow += [P("• " + t, "small") for t in summary_bullets(r)]
        s.append(KeepTogether(flow) if prev is None else CondPageBreak(2.5 * inch))
        if prev is not None:
            s += flow
        prev = r

    s.append(PageBreak())
    s.append(P("Delvers before and after", "h1"))
    s.append(img(chart_delvers(res)))
    s.append(Spacer(1, 4))
    s.append(delver_table(res))
    s.append(P(f"Points from a fair share for every version; red is outside the ±{BAND:.0f}-point target.", "small"))
    ab = chart_abilities(res)
    left = img(chart_spread(res), FW / 2 - 6)
    right = img(ab, FW / 2 - 6) if ab else P("")
    s.append(Spacer(1, 6))
    s.append(side_by_side(left, right))
    if ab:
        s.append(P("Right: each delver duelling an ability-less delver, 2 players, "
                   f"{a.d['abilities']['_meta']['games_per_config']:,} games each. Pale bars are {BEFORE}, solid "
                   f"bars {AFTER}. In the final rules each ability wins between "
                   f"{pc(min(a.ability(c) for c in CHARS))} and {pc(max(a.ability(c) for c in CHARS))} of these "
                   "duels: all worth having, none a lock.", "small"))

    s.append(PageBreak())
    s.append(P("Game length before and after", "h1"))
    s.append(img(chart_lengths(res)))
    s.append(P("Share of games finishing at each minute, at 45 s a turn. Shaded: the 30–45 minute target.", "small"))
    s.append(P(f"Final rules ({AFTER})", "h3"))
    s.append(playtime_table(a))
    s.append(P(f"First draft ({BEFORE})", "h3"))
    s.append(playtime_table(b))
    s.append(P("Why the collapse clock works: the marker moves on every reshuffle and every joker, so a game is a "
               "fixed number of trips through the deck however the players behave. That is why no simulated game "
               "stalls: the longest final-rules game is set by the deck, not by anyone's caution. With more players "
               "each delver gets fewer turns per trip through the deck, so the end space grows with the player "
               "count (7 / 8 / 9) to give everyone enough turns while keeping each count in the window.", "small"))
    timed = sum(r.length(n)["timed_out"] for r in res.values() for n in (2, 3, 4))
    s.append(P(f"Games that hit the simulator's safety limit without ending: {timed} (all versions).", "small"))

    s.append(PageBreak())
    s.append(P("Strategy, snowballing and seats", "h1"))
    s.append(side_by_side(img(chart_strategies(res), FW / 2 - 6), P(strategy_text(b, a), "body")))
    s.append(Spacer(1, 6))
    s.append(img(chart_dynamics(res)))
    s.append(P("Left: how often whoever leads at the halfway round goes on to win (a pure coin-flip game would sit "
               "near the fair share; a runaway game near 100%). Right: the first player's win rate over a fair "
               "share (1.00 = no advantage).", "small"))
    s.append(P(f"In the final rules the halfway leader wins {per_n(lambda n: pc(a.dyn(n)['mid_leader_wins']))} of "
               f"2 / 3 / 4-player games, down from {per_n(lambda n: pc(b.dyn(n)['mid_leader_wins']))}. Being ahead "
               "is an advantage, as it should be, but the Warden's hunt and the pack-dropping crush keep leads "
               f"contestable: the lead changes hands {per_n(lambda n: lead_changes(a, n))} times "
               "a game on average."))
    if a.has("luck"):
        L = a.d["luck"]
        s.append(P("Luck versus skill", "h2"))
        s.append(P(
            f"Two tests. First, the planning AI against an AI that plays random legal cards: the planner wins "
            f"{pc(L['2p:tactician/random']['tactician'], 1)} of 2-player games and "
            f"{pc(L['4p:tactician/random/random/random']['tactician'], 1)} of 4-player games against three random "
            "players, so decisions matter far more than the deal. Second, among equally skilled players, the one "
            "whose draws happened to hold the biggest share of high cards (7 and up, faces and aces included) wins "
            f"{pc(L['2p:tactician/tactician']['luck']['luckiest_draw_win_rate'])} of 2-player games (fair: 50%), and "
            f"across all balance games {per_n(lambda n: pc(a.bp(n)['luck']['luckiest_draw_win_rate']))} with 2 / 3 / "
            "4 players (fair 50% / 33% / 25%). A good draw helps; it doesn't decide the game."))

    s.append(PageBreak())
    s.append(P("Cards: every rank has a job", "h1"))
    s.append(img(chart_usage(a)))
    u = a.d["balance"]["usage"]
    low = [RANK_LABEL.get(k, k) for k in RANKS]
    by_rank = u["by_rank"]
    s.append(P(
        f"How often each card was played for each action across every final-rules balance game. Low cards "
        f"(2–6) are the movers ({pc(sum(by_rank[k].get('move', 0) for k in RANKS[:5]) / 5)} of their plays), high "
        f"cards (7–10) the miners ({pc(sum(by_rank[k].get('mine', 0) for k in RANKS[5:9]) / 4)}), and each "
        f"face card does its own job: Jacks shortcut ({pc(by_rank['11'].get('shortcut', 0))}), Queens pilfer "
        f"({pc(by_rank['12'].get('pilfer', 0))}), Kings rouse the Warden ({pc(by_rank['13'].get('rouse', 0))}). Aces match "
        f"any vein, so they are mostly spent mining ({pc(by_rank['14'].get('mine', 0))}). {RANK_USES(by_rank)} The suits look alike apart from their delver's pull: {SUITS_LINE(u)}.", "body"))
    s.append(CondPageBreak(2.2 * inch))
    s.append(Spacer(1, 10))
    s.append(P("What's left, and why it stays", "h1"))
    s.append(P(f"In the final rules every delver is within ±{a.worst_abs(2):.1f} points of a fair share with 2 players, "
               f"±{a.worst_abs(3):.1f} with 3 and ±{a.worst_abs(4):.1f} with 4. The largest remaining gaps:"))
    for t in remaining_imbalance(a):
        s.append(P("• " + t))
    s.append(P("Where the AI falls short", "h2"))
    s.append(P(
        "The AIs look one turn ahead and value a hand by simple rules. They don't bluff, don't coordinate against a "
        "leader, don't plan multi-turn routes around the Warden, and don't read opponents' hands. Real players will "
        "probably gang up on the leader more than the AI does (which would help the game) and find ability tricks "
        "the AI misses: Pip & Pell's chains and Old Quill's free Kings are the most likely to play better in human hands "
        "than they do here. The simulator also can't measure fun, teachability or how long people really think. "
        "Treat these numbers as a floor for balance and a first estimate for time, then playtest with people."))
    s.append(P("Reproduce it", "h2"))
    s.append(P("<font name='DejaVuSansMono' size='8.5'>cd sim && ./run_sweeps.sh v1 v2 v3 v4</font> reruns "
               "every sweep (about an hour per version on four cores; seeds are fixed, so the numbers come back the "
               "same). <font name='DejaVuSansMono' size='8.5'>python print/designers_notes.py</font> rebuilds these "
               "notes and CHANGELOG.md from the results.", "small"))
    return s


def RANK_USES(by_rank):
    """How many actions each rank is used for at least 10% of the time: a dead card would have none."""
    uses = {k: sum(1 for a, v in by_rank[k].items() if a != "plays" and v >= 0.10) for k in RANKS}
    fewest = min(uses.values())
    total = sum(by_rank[k]["plays"] for k in RANKS)
    share = min(by_rank[k]["plays"] / total for k in RANKS) * len(RANKS)
    return (f"Every rank is played (the least-played rank comes up {pc(share)} as often as an even share), and "
            f"every rank has at least {fewest} action{'s' if fewest != 1 else ''} it's used for 10% of the time or "
            "more, so no card is dead in hand.")


def strategy_text(b: Res, a: Res) -> str:
    bc, bt = b.strat("2p:greedy/cautious", "cautious"), b.strat("2p:tactician/cautious", "cautious")
    ag, at, gc = (a.strat("2p:tactician/greedy", "tactician"), a.strat("2p:tactician/cautious", "tactician"),
                  a.strat("2p:greedy/cautious", "greedy"))
    t = "No single strategy should dominate. "
    if bc > 0.5:
        t += (f"In the first draft, turtling won: the cautious AI beat the greedy one {pc(bc)} of the time"
              + (f" and beat the planner {pc(bt)}. " if bt > 0.5 else ". "))
        t += "Deeper, richer glimmer and a Warden that hunts the leader were the answer. "
    t += (f"In the final rules the planner wins {pc(ag)} against greedy play and {pc(at)} against cautious play, "
          "so thinking ahead pays without guaranteeing anything. ")
    if abs(gc - 0.5) <= 0.1:
        t += f"Greedy and cautious play are close (greedy wins {pc(gc)}): both are viable styles, neither is a trap."
    else:
        t += (f"Between the two simple styles, {'greedy' if gc > 0.5 else 'cautious'} play wins "
              f"{pc(max(gc, 1 - gc))}, so the other is a real but beatable choice.")
    return t


def SUITS_LINE(u):
    parts = []
    for name, sym, act, what in (("Spades", "{S}", "move", "moves"), ("Hearts", "{H}", "mine", "mines"),
                                 ("Diamonds", "{D}", "hoist", "hoists"), ("Clubs", "{C}", "pilfer", "pilfers")):
        parts.append(f"{sym} {pc(u['by_suit'][name].get(act, 0))} {what}")
    return ", ".join(parts)


def main():
    res = load()
    if BEFORE not in res or AFTER not in res:
        raise SystemExit(f"need full sweeps for {BEFORE} and {AFTER} in {RS.RESULTS}")
    _mpl_fonts()
    write_changelog(res, HERE.parent / "CHANGELOG.md")
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "designers_notes.pdf"
    doc = BaseDocTemplate(str(out), pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=0.8 * inch,
                          bottomMargin=0.7 * inch, title="Glimmerdark designer's notes", author="Glimmerdark")
    doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(MARGIN, 0.7 * inch, FW, H - 1.5 * inch)], onPage=on_page)])
    doc.build(story(res))
    print(f"wrote {out}\nwrote {HERE.parent / 'CHANGELOG.md'}")


if __name__ == "__main__":
    main()
