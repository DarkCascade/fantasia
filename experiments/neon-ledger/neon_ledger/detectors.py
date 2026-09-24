"""The PRE-CRIME division: detectors that look for cash-flow trouble.

Each detector is a small function `detect_x(ctx) -> list[Finding]`. They are
deliberately independent - one misfiring (odd data, too little history)
never takes the others down; run_all() catches the error and records it.

Severity is about how much damage the pattern does if ignored, not how
surprising it is. `impact` is the dollars-per-month at stake where that can
be estimated, and is used to rank findings of equal severity.

Thresholds err conservative: a detector that cries wolf on every file gets
ignored, which is worse than one that stays quiet on a borderline case.
"""

from __future__ import annotations

import re
import traceback
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import analytics as A
from .analytics import AVG_MONTH_DAYS, Ledger

SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
SEV_POINTS = {"CRITICAL": 22, "HIGH": 11, "MEDIUM": 5, "LOW": 2, "INFO": 0}
# Findings whose `impact` is a one-time dollar amount rather than $/month.
ONE_OFF = {"CRUNCH_WINDOW", "OVERDRAWN", "LOW_BALANCE", "PRECOG_OVERDRAFT", "PRECOG_FLOOR", "PRECOG_RISK", "CATEGORY_SPIKE",
           "PACE_SPIKE", "VELOCITY", "SEASONAL", "BUDGET_BLOWN", "BUDGET_PACE", "UPCOMING_LUMPS", "DUPLICATES", "OUTLIERS",
           "NEW_MERCHANTS", "INCOME_DROP"}

MODULES = {
    "CASHFLOW": "Cash-flow integrity",
    "TREND": "Trend analysis",
    "BUDGET": "Budget enforcement",
    "RECURRING": "Recurrence scanner",
    "LEAK": "Leak detection",
    "ANOMALY": "Anomaly radar",
    "INCOME": "Income watch",
    "FORECAST": "Precog forecast",
    "DATA": "Data integrity",
}


def usd(x: float, cents: bool = False) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.2f}" if cents else f"{sign}${abs(x):,.0f}"


def pct(x: float) -> str:
    return f"{x:+.0%}" if abs(x) < 10 else f"{x:+.0f}x"


def mlabel(m: pd.Timestamp) -> str:
    return pd.Timestamp(m).strftime("%b %Y")


@dataclass
class Finding:
    code: str
    module: str
    severity: str
    title: str
    detail: str
    impact: float = 0.0
    subject: str | None = None
    series: pd.Series | None = None      # evidence line
    baseline: pd.Series | None = None    # comparison line (trend fit, budget, median...)
    table: pd.DataFrame | None = None
    action: str = ""

    @property
    def rank(self) -> tuple:
        return (SEV_ORDER.index(self.severity), -abs(self.monthly_equiv))

    @property
    def per_month(self) -> bool:
        """True when `impact` is an ongoing $/month; False for a one-time amount
        (a shortfall, a spike, a duplicate charge...)."""
        return self.code not in ONE_OFF

    @property
    def monthly_equiv(self) -> float:
        return self.impact if self.per_month else self.impact / 12

    @property
    def impact_text(self) -> str:
        if self.impact <= 0:
            return ""
        return f"≈{usd(self.impact)}/mo at stake" if self.per_month else f"≈{usd(self.impact)} one-time"


@dataclass
class Context:
    L: Ledger
    ms: pd.DataFrame
    cm: pd.DataFrame
    rec_out: pd.DataFrame
    rec_in: pd.DataFrame
    budgets: pd.DataFrame
    budgets_inferred: bool
    balance: pd.Series
    balance_mode: str
    low_balance: float
    pace: pd.DataFrame
    forecast: pd.DataFrame | None
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def full(self) -> pd.DataFrame:
        return A.full_only(self.ms, self.L)

    @property
    def avg_income(self) -> float:
        f = self.full.tail(6)
        return float(f["income"].mean()) if len(f) else float(self.ms["income"].mean())

    @property
    def avg_spend(self) -> float:
        f = self.full.tail(6)
        return float(f["spend"].mean()) if len(f) else float(self.ms["spend"].mean())

    @property
    def balance_known(self) -> bool:
        return self.balance_mode in ("reported", "estimated")

    @property
    def has_income(self) -> bool:
        """False for a card-only export: judging 'spending vs income' there is meaningless."""
        f = self.full if len(self.full) else self.ms
        return float(f["income"].sum()) > 0.2 * max(float(f["spend"].sum()), 1.0)


def build_context(L: Ledger, budgets: pd.DataFrame | None, starting_balance: float | None, low_balance: float) -> Context:
    ms = A.monthly_summary(L)
    cm = A.category_matrix(L)
    rec_out = A.find_recurring(L, "expense")
    rec_in = A.find_recurring(L, "income")
    inferred = budgets is None or budgets.empty
    if inferred:
        budgets = A.infer_budgets(L)
    bal, mode = A.balance_series(L, starting_balance)
    fc = None
    if len(L.tx) and mode in ("reported", "estimated"):
        fc = A.forecast_cash(L, rec_out, rec_in, float(bal.iloc[-1]))
    elif len(L.tx):
        fc = A.forecast_cash(L, rec_out, rec_in, 0.0)
    return Context(L=L, ms=ms, cm=cm, rec_out=rec_out, rec_in=rec_in, budgets=budgets, budgets_inferred=inferred,
                   balance=bal, balance_mode=mode, low_balance=low_balance, pace=A.category_pace(L), forecast=fc)


# ================================================================ CASHFLOW

def detect_deficit_streak(ctx: Context) -> list[Finding]:
    if not ctx.has_income:
        return []
    net = ctx.full["net"]
    if len(net) < 2:
        return []
    streak = 0
    for v in reversed(net.values):
        if v < 0:
            streak += 1
        else:
            break
    last6 = net.tail(6)
    neg6 = int((last6 < 0).sum())
    if streak < 2 and neg6 < 3:
        return []
    window = net.tail(streak) if streak >= 2 else last6[last6 < 0]
    deficit = float(-window.sum())
    inc = ctx.avg_income
    if streak >= 4 or deficit > inc:
        sev = "CRITICAL"
    elif streak >= 3 or neg6 >= 4:
        sev = "HIGH"
    else:
        sev = "MEDIUM"
    title = (f"{streak} straight months of spending more than you earn" if streak >= 2
             else f"{neg6} of the last 6 months ran a deficit")
    return [Finding(
        "DEFICIT_STREAK", "CASHFLOW", sev, title,
        f"Combined shortfall {usd(deficit)} across those months - about {deficit / max(inc, 1):.1f} months of income. "
        f"Money that isn't coming from income is coming from savings or debt.",
        impact=deficit / max(len(window), 1), series=net.tail(12),
        action="Find the month the gap opened in the FLOW MATRIX waterfall and compare categories against the month before it.",
    )]


def detect_spend_outpacing_income(ctx: Context) -> list[Finding]:
    if not ctx.has_income:
        return []
    f = ctx.full.tail(12)
    if len(f) < 6:
        return []
    ts, ti = A.robust_trend(f["spend"]), A.robust_trend(f["income"])
    g_s = ts["slope"] * 12 / max(f["spend"].mean(), 1)
    g_i = ti["slope"] * 12 / max(f["income"].mean(), 1)
    gap = g_s - g_i
    if gap < 0.06 or ts["z"] < 1.28 or ts["slope"] <= 0:
        return []
    sev = "HIGH" if gap >= 0.15 else "MEDIUM"
    out = [Finding(
        "OUTPACING", "TREND", sev, f"Spending is growing {g_s:.0%}/yr; income {g_i:+.0%}/yr",
        f"On the fitted trend, monthly spending rises {usd(ts['slope'])} every month while income moves {usd(ti['slope'])}. "
        f"The gap compounds: at this rate it's {usd((ts['slope'] - ti['slope']) * 12)}/month wider a year from now.",
        impact=(ts["slope"] - ti["slope"]) * 12, series=f["spend"], baseline=ts["fit"],
        action="Look for the categories driving it on SPEND SPECTRUM > stealth creep.",
    )]
    # Where do the fitted lines cross?
    net_fit = (ti["fit"] - ts["fit"])
    if net_fit.iloc[-1] > 0 and (ts["slope"] - ti["slope"]) > 0:
        months = net_fit.iloc[-1] / (ts["slope"] - ti["slope"])
        if months <= 18:
            out.append(Finding(
                "CROSSOVER", "FORECAST", "HIGH" if months <= 6 else "MEDIUM",
                f"Spending trend crosses income in ~{months:.0f} months",
                f"You're still net-positive on trend ({usd(net_fit.iloc[-1])}/mo) but the lines converge. "
                f"Without a change, projected crossover is around {mlabel(f.index[-1] + pd.DateOffset(months=int(np.ceil(months))))}.",
                impact=net_fit.iloc[-1] / max(months, 1), series=ti["fit"] - ts["fit"],
            ))
    return out


def detect_savings_rate(ctx: Context) -> list[Finding]:
    if not ctx.has_income:
        return []
    f = ctx.full
    if len(f) < 6:
        return []
    last = f.tail(3)
    prior = f.iloc[-9:-3] if len(f) >= 9 else f.iloc[:-3]
    if prior.empty or last["income"].sum() <= 0 or prior["income"].sum() <= 0:
        return []
    sr_now = last["net"].sum() / last["income"].sum()
    sr_then = prior["net"].sum() / prior["income"].sum()
    drop = sr_then - sr_now
    out = []
    if sr_now < 0:
        out.append(Finding("NEG_SAVINGS", "CASHFLOW", "HIGH", f"Savings rate is negative: {sr_now:.0%} over the last 3 months",
                           f"For every $100 earned you spent {100 * (1 - sr_now):.0f}. It was {sr_then:.0%} in the six months before.",
                           impact=-last["net"].mean(), series=f["savings_rate"].tail(12)))
    elif drop >= 0.08:
        out.append(Finding("SAVINGS_SLIDE", "TREND", "HIGH" if drop >= 0.15 else "MEDIUM",
                           f"Savings rate slid from {sr_then:.0%} to {sr_now:.0%}",
                           f"That's {usd(drop * last['income'].mean())}/month that used to be kept and now isn't.",
                           impact=drop * last["income"].mean(), series=f["savings_rate"].tail(12)))
    return out


def detect_crunch_window(ctx: Context) -> list[Finding]:
    """Timing, not totals: are you underwater mid-month even in good months?"""
    if not ctx.has_income:
        return []
    if len(ctx.L.full_months) < 2:
        return []
    prof = A.dom_profile(ctx.L)
    low = prof["cum_net"].min()
    if low >= 0 or prof["cum_income"].iloc[-1] <= 0:
        return []
    day = int(prof["cum_net"].idxmin())
    depth = -float(low)
    inc = ctx.avg_income
    sev = "HIGH" if depth > 0.35 * inc else "MEDIUM" if depth > 0.1 * inc else "LOW"
    return [Finding(
        "CRUNCH_WINDOW", "CASHFLOW", sev, f"Monthly cash crunch: {usd(depth)} underwater by day {day}",
        f"In an average month your bills and spending get ahead of your deposits and stay ahead until around day {day}. "
        f"Even a net-positive month needs a {usd(depth)} cushion to get through that window without overdrafting.",
        impact=depth, series=prof["cum_net"],
        action="Ask for large bills (rent, card payment) to move closer to payday, or hold that cushion in checking.",
    )]


def detect_low_balance(ctx: Context) -> list[Finding]:
    if not ctx.balance_known:
        return []
    b = ctx.balance
    recent = b[b.index > ctx.L.end - pd.Timedelta(days=90)]
    out = []
    neg = recent[recent < 0]
    below = recent[recent < ctx.low_balance]
    if len(neg):
        out.append(Finding("OVERDRAWN", "CASHFLOW", "CRITICAL", f"Balance went negative on {len(neg)} day(s) in the last 90",
                           f"Lowest point {usd(recent.min())} on {recent.idxmin():%b %d}. Every overdraft is a fee and a declined-payment risk.",
                           impact=-float(recent.min()), series=recent))
    elif len(below):
        out.append(Finding("LOW_BALANCE", "CASHFLOW", "HIGH" if len(below) > 10 else "MEDIUM",
                           f"Below your {usd(ctx.low_balance)} floor on {len(below)} day(s) in the last 90",
                           f"Lowest {usd(recent.min())} on {recent.idxmin():%b %d}.",
                           impact=ctx.low_balance - float(recent.min()), series=recent))
    # Reserve drain: month-end balances trending down.
    me = b.resample("ME").last().tail(6)
    if len(me) >= 4:
        tr = A.trend(me)
        if tr["slope"] < -50 and tr["r2"] > 0.5:
            runway = me.iloc[-1] / -tr["slope"] if me.iloc[-1] > 0 else 0
            sev = "CRITICAL" if runway < 2 else "HIGH" if runway < 6 else "MEDIUM"
            out.append(Finding("RESERVE_DRAIN", "CASHFLOW", sev, f"Cash reserves draining {usd(-tr['slope'])}/month",
                               f"Month-end balance has fallen for the last {len(me)} months. At this pace the remaining {usd(me.iloc[-1])} "
                               f"lasts ~{runway:.1f} months." if runway else f"Month-end balance has fallen for the last {len(me)} months.",
                               impact=-tr["slope"], series=me, baseline=tr["fit"]))
    return out


def detect_forecast_breach(ctx: Context) -> list[Finding]:
    fc = ctx.forecast
    if fc is None or not ctx.balance_known or fc.empty:
        return []
    out = []
    zero = fc[fc["expected"] < 0]
    floor = fc[fc["expected"] < ctx.low_balance]
    risk = fc[fc["low"] < 0]
    if len(zero):
        d = zero.index[0]
        out.append(Finding("PRECOG_OVERDRAFT", "FORECAST", "CRITICAL", f"Projected overdraft around {d:%b %d}",
                           f"Scheduled bills plus your current burn rate take the balance to {usd(zero['expected'].iloc[0])} "
                           f"{(d - ctx.L.end).days} days from the last transaction.",
                           impact=-float(fc["expected"].min()), series=fc["expected"]))
    elif len(floor):
        d = floor.index[0]
        out.append(Finding("PRECOG_FLOOR", "FORECAST", "HIGH", f"Projected to breach your {usd(ctx.low_balance)} floor around {d:%b %d}",
                           f"Expected low point {usd(fc['expected'].min())} on {fc['expected'].idxmin():%b %d}.",
                           impact=ctx.low_balance - float(fc["expected"].min()), series=fc["expected"]))
    elif len(risk):
        out.append(Finding("PRECOG_RISK", "FORECAST", "MEDIUM", "Overdraft is inside the forecast's uncertainty band",
                           f"The expected path stays positive, but a normal-bad month puts you at {usd(risk['low'].iloc[0])} by {risk.index[0]:%b %d}.",
                           impact=0.0, series=fc["low"]))
    return out


def detect_runway(ctx: Context) -> list[Finding]:
    if not ctx.balance_known:
        return []
    last3 = ctx.full.tail(3)
    if len(last3) < 3:
        return []
    burn = -float(last3["net"].mean())
    bal = float(ctx.balance.iloc[-1])
    if burn <= 0 or bal <= 0:
        return []
    months = bal / burn
    if months > 12:
        return []
    sev = "CRITICAL" if months < 2 else "HIGH" if months < 6 else "MEDIUM"
    return [Finding("RUNWAY", "CASHFLOW", sev, f"Runway: {months:.1f} months at the current burn",
                    f"You've averaged a {usd(burn)}/month deficit for 3 months; {usd(bal)} on hand covers {months:.1f} months of that.",
                    impact=burn)]


def detect_card_debt(ctx: Context) -> list[Finding]:
    """Charges outrunning payments on a card account = a revolving balance."""
    t = ctx.L.tx
    t = t[t["month"].isin(ctx.L.full_months[-6:])]
    out = []
    for acct, g in t.groupby("account"):
        pays = g[(g["kind"] == "transfer") & (g["amount"] > 0)]["amount"].sum()
        charges = g["flow"].sum()
        if pays <= 0 or charges <= 0:
            continue
        # A checking account also receives transfers; a card is where charges
        # dominate and inbound transfers are the payments.
        if g["inflow"].sum() > 0.25 * charges:
            continue
        short = charges - pays
        if short > max(300.0, 0.1 * charges):
            out.append(Finding("CARD_DEBT", "CASHFLOW", "HIGH", f"{acct}: charged {usd(short)} more than you paid off in 6 months",
                               f"{usd(charges)} of charges vs {usd(pays)} of payments. That difference is a balance that accrues interest - "
                               f"and it doesn't show up as 'spending' anywhere else in a normal budget.",
                               impact=short / 6, subject=acct,
                               series=(g.groupby("month")["flow"].sum()
                                       .sub(g[(g["kind"] == "transfer") & (g["amount"] > 0)].groupby("month")["amount"].sum(), fill_value=0.0)
                                       .cumsum())))
    return out


def detect_bill_cluster(ctx: Context) -> list[Finding]:
    r = ctx.rec_out
    if r.empty:
        return []
    bills = r[A.is_bill(r) & r["active"]]
    if len(bills) < 3:
        return []
    days = bills["last"].dt.day.values
    amts = bills["monthly_cost"].values
    tot = amts.sum()
    best, best_start = 0.0, 1
    for s in range(1, 32):
        window = [(d - s) % 31 < 7 for d in days]
        v = amts[np.array(window)].sum()
        if v > best:
            best, best_start = v, s
    share = best / tot if tot else 0
    if share < 0.6 or best < 0.3 * max(ctx.avg_income, 1):
        return []
    end_day = (best_start + 6 - 1) % 31 + 1
    return [Finding("BILL_CLUSTER", "CASHFLOW", "MEDIUM" if share > 0.75 else "LOW",
                    f"{share:.0%} of fixed bills land in one week (day {best_start}–{end_day})",
                    f"{usd(best)} of your {usd(tot)} monthly fixed bills hit within 7 days. Whatever paycheck precedes that week "
                    f"has to cover almost all of it.", impact=0.0,
                    table=bills.assign(day=bills["last"].dt.day)[["merchant", "day", "typical_amount", "cadence"]].sort_values("day"))]


def detect_fixed_cost_ratio(ctx: Context) -> list[Finding]:
    if not ctx.has_income:
        return []
    inc = ctx.avg_income
    if inc <= 0:
        return []
    out = []
    cm = A.full_only(ctx.cm, ctx.L).tail(3)
    if "Housing" in cm.columns:
        h = float(cm["Housing"].mean())
        ratio = h / inc
        if ratio > 0.33:
            out.append(Finding("HOUSING_RATIO", "CASHFLOW", "HIGH" if ratio > 0.45 else "MEDIUM",
                               f"Housing takes {ratio:.0%} of income",
                               f"{usd(h)}/month on housing vs {usd(inc)} income. The usual ceiling is ~30%; above it, every other category competes for scraps.",
                               impact=h - 0.3 * inc))
    r = ctx.rec_out
    if not r.empty:
        fixed = float(r[A.is_bill(r) & r["active"]]["monthly_cost"].sum())
        ratio = fixed / inc
        if ratio > 0.6:
            out.append(Finding("FIXED_RATIO", "CASHFLOW", "HIGH" if ratio > 0.75 else "MEDIUM",
                               f"Fixed commitments eat {ratio:.0%} of income",
                               f"{usd(fixed)}/month is committed before you buy a single thing. That leaves little room to absorb a bad month.",
                               impact=fixed - 0.5 * inc))
    return out


# ================================================================ TREND

def detect_lifestyle_creep(ctx: Context) -> list[Finding]:
    f = ctx.full.tail(18)
    if len(f) < 6:
        return []
    tr = A.robust_trend(f["discretionary"])
    ti = A.robust_trend(f["income"])
    if tr["slope"] <= 0 or tr["z"] < 1.64 or tr["growth"] < 0.2:
        return []
    sev = "HIGH" if tr["growth"] > 0.5 else "MEDIUM"
    return [Finding("LIFESTYLE_CREEP", "TREND", sev,
                    f"Lifestyle creep: discretionary spend up {tr['growth']:.0%} in {len(f)} months",
                    f"Dining, shopping, entertainment & co. went from ~{usd(tr['fit'].iloc[0])} to ~{usd(tr['fit'].iloc[-1])} a month on trend"
                    + (", " if ctx.has_income else ". ")
                    + (f"while income moved {ti['growth']:+.0%}. " if ctx.has_income else "")
                    + "No single month looks alarming - that's what makes it creep.",
                    impact=tr["fit"].iloc[-1] - tr["fit"].iloc[0], series=f["discretionary"], baseline=tr["fit"])]


def detect_stealth_creep(ctx: Context) -> list[Finding]:
    cm = A.full_only(ctx.cm, ctx.L).tail(18)
    if len(cm) < 6:
        return []
    out = []
    for cat in cm.columns:
        y = cm[cat]
        if y.mean() < 30 or cat in ("Fees & Interest", "Taxes"):
            continue
        tr = A.robust_trend(y)
        if tr["slope"] <= 0 or tr["z"] < 1.96 or tr["growth"] < 0.25 or tr["fit"].iloc[0] < 15:
            continue
        impact = float(tr["fit"].iloc[-1] - tr["fit"].iloc[0])
        out.append(Finding("STEALTH_CREEP", "TREND", "MEDIUM" if impact >= 75 else "LOW",
                           f"Stealth creep in {cat}: +{tr['growth']:.0%} over {len(y)} months",
                           f"Up about {usd(tr['slope'])} a month on a robust trend (Mann-Kendall z = {tr['z']:.1f}). Each month is only "
                           f"slightly worse than the last, so month-over-month comparisons never flag it.",
                           impact=impact, subject=cat, series=y, baseline=tr["fit"]))
    return sorted(out, key=lambda f: -f.impact)[:6]


def _lumpy_by_month(ctx: Context) -> pd.DataFrame:
    """month x category totals of known non-monthly bills (semiannual insurance,
    annual memberships). They're scheduled, not surprising, so the spike
    detectors subtract them before judging a month."""
    r = ctx.rec_out
    idx = pd.Index(ctx.L.months, name="month")
    if r.empty:
        return pd.DataFrame(index=idx)
    rows = []
    for _, s in r[r["period_days"] >= 55].iterrows():
        for d, a in zip(s["dates"], s["amounts"]):
            rows.append({"month": A.month_start(pd.Timestamp(d)), "category": s["category"], "amt": a})
    if not rows:
        return pd.DataFrame(index=idx)
    return pd.DataFrame(rows).pivot_table(index="month", columns="category", values="amt", aggfunc="sum").reindex(idx).fillna(0.0)


def detect_category_spikes(ctx: Context) -> list[Finding]:
    lumpy = _lumpy_by_month(ctx)
    cm = A.full_only(ctx.cm.sub(lumpy.reindex(columns=ctx.cm.columns, fill_value=0.0), fill_value=0.0).clip(lower=0), ctx.L)
    out = []
    if len(cm) >= 4:
        last = cm.iloc[-1]
        hist = cm.iloc[-7:-1]
        for cat, v in last.items():
            h = hist[cat]
            med = float(h.median())
            delta = float(v - med)
            z = A.robust_z(float(v), h)
            if z >= 3 and delta >= max(75.0, 0.3 * med):
                out.append(Finding("CATEGORY_SPIKE", "ANOMALY", "HIGH" if delta > 750 else "MEDIUM",
                                   f"{cat} spiked in {mlabel(cm.index[-1])}: {usd(v)} vs {usd(med)} typical",
                                   f"{usd(delta)} above its 6-month median (robust z = {z:.1f}).",
                                   impact=delta, subject=cat, series=cm[cat].tail(12)))
    # Current partial month, on pace.
    if ctx.L.current_is_partial and not ctx.pace.empty:
        p = ctx.pace
        p = p[(p["typical_month"] > 0) & (p["projected"] > 1.5 * p["typical_month"]) & (p["projected"] - p["typical_month"] > 100)]
        for cat, r in p.iterrows():
            out.append(Finding("PACE_SPIKE", "ANOMALY", "MEDIUM",
                               f"{cat} is on pace for {usd(r['projected'])} this month ({r['projected'] / r['typical_month']:.1f}× normal)",
                               f"{usd(r['so_far'])} so far by day {ctx.L.end.day}; your usual full month is {usd(r['typical_month'])}.",
                               impact=float(r["projected"] - r["typical_month"]), subject=str(cat)))
    return sorted(out, key=lambda f: -f.impact)[:8]


def detect_velocity(ctx: Context) -> list[Finding]:
    roll = A.rolling_window(ctx.L, 30).dropna()
    if len(roll) < 120:
        return []
    last = float(roll.iloc[-1])
    rank = float((roll < last).mean())
    if rank < 0.95:
        return []
    return [Finding("VELOCITY", "TREND", "MEDIUM" if rank > 0.98 else "LOW",
                    f"Last 30 days: {usd(last)} - higher than {rank:.0%} of all 30-day windows",
                    f"Your rolling 30-day spend is near its all-time high for this dataset (median window {usd(roll.median())}).",
                    impact=last - float(roll.median()), series=roll.tail(365))]


def detect_seasonal(ctx: Context) -> list[Finding]:
    idx = A.seasonality(ctx.ms, ctx.L)
    if idx is None:
        return []
    out = []
    base = ctx.avg_spend
    for k in (1, 2, 3):
        m = (ctx.L.end + pd.DateOffset(months=k))
        v = float(idx.get(m.month, 1.0))
        if v >= 1.15:
            out.append(Finding("SEASONAL", "FORECAST", "MEDIUM" if v >= 1.3 else "LOW",
                               f"{m:%B} historically runs {v - 1:.0%} above average",
                               f"Past {m:%B}s averaged ~{usd(base * v)} vs a typical {usd(base)} month. Set aside ~{usd(base * (v - 1))} now.",
                               impact=base * (v - 1), series=idx))
    return out


def detect_weekend_drift(ctx: Context) -> list[Finding]:
    t = ctx.L.tx[ctx.L.tx["is_discretionary"] & ctx.L.tx["month"].isin(ctx.L.full_months)]
    if t.empty:
        return []
    months = ctx.L.full_months
    if len(months) < 9:
        return []
    now = t[t["month"].isin(months[-3:])]
    then = t[t["month"].isin(months[-12:-3])]
    if now["flow"].sum() <= 0 or then["flow"].sum() <= 0:
        return []
    s_now = now.loc[now["weekend"], "flow"].sum() / now["flow"].sum()
    s_then = then.loc[then["weekend"], "flow"].sum() / then["flow"].sum()
    if s_now - s_then < 0.07:
        return []
    by = t.groupby("month").apply(lambda g: g.loc[g["weekend"], "flow"].sum() / max(g["flow"].sum(), 1), include_groups=False)
    return [Finding("WEEKEND_DRIFT", "TREND", "LOW", f"Weekend share of fun money: {s_then:.0%} → {s_now:.0%}",
                    "More of your discretionary spending is happening on Saturdays and Sundays - usually a sign of unplanned, "
                    "social spending replacing planned purchases.", impact=(s_now - s_then) * now["flow"].sum() / 3, series=by.tail(12))]


# ================================================================ BUDGET

def detect_budget(ctx: Context) -> list[Finding]:
    b = ctx.budgets
    if b is None or b.empty:
        return []
    bf = A.budget_frame(ctx.L, b)
    out = []
    tag = " (vs. your own baseline)" if ctx.budgets_inferred else ""
    full = bf[bf["full"]]
    months = sorted(full["month"].unique())[-6:]
    # Against an inferred baseline (= your median month) about half of all months
    # are "over" by construction, so chronic-overrun only makes sense for a real budget.
    chronic_scope = full[full["month"].isin(months)] if not ctx.budgets_inferred else full.iloc[0:0]
    for cat, g in chronic_scope.groupby("category"):
        overs = g[g["pct"] > 1.05]
        if len(overs) >= 3:
            avg_over = float(overs["over"].mean())
            out.append(Finding("CHRONIC_OVERRUN", "BUDGET", "HIGH" if len(overs) >= 5 or avg_over > 150 else "MEDIUM",
                               f"{cat}: over budget {len(overs)} of the last {len(g)} months{tag}",
                               f"Average overrun {usd(avg_over)} on a {usd(g['budget'].iloc[0])} budget. A budget you break most months "
                               f"is a forecast you're getting wrong - raise it honestly or cut the category.",
                               impact=avg_over * len(overs) / len(g), subject=cat,
                               series=g.set_index("month")["actual"], baseline=g.set_index("month")["budget"]))
    if ctx.L.current_is_partial and not ctx.pace.empty:
        bud = b.set_index("category")["monthly_budget"]
        for cat, r in ctx.pace.iterrows():
            if cat not in bud.index or bud[cat] <= 0:
                continue
            B = float(bud[cat])
            # A baseline budget is just "your median month" - being 5% over it is noise, not news.
            blown_at = 1.12 if ctx.budgets_inferred else 1.02
            if r["so_far"] > B * blown_at:
                out.append(Finding("BUDGET_BLOWN", "BUDGET", "HIGH" if r["so_far"] > B * 1.25 else "MEDIUM",
                                   f"{cat}: budget already blown by day {ctx.L.end.day}{tag}",
                                   f"{usd(r['so_far'])} spent against {usd(B)} with {ctx.L.current_month.days_in_month - ctx.L.end.day} days left.",
                                   impact=float(r["projected"] - B), subject=str(cat)))
            elif r["projected"] > B * (1.25 if ctx.budgets_inferred else 1.1) and r["projected"] - B > 25:
                out.append(Finding("BUDGET_PACE", "BUDGET", "MEDIUM" if r["projected"] > B * 1.5 else "LOW",
                                   f"{cat}: on pace to finish at {usd(r['projected'])} vs {usd(B)} budget{tag}",
                                   f"{usd(r['so_far'])} so far plus the {usd(r['typical_remaining'])} you usually spend in the rest of a month.",
                                   impact=float(r["projected"] - B), subject=str(cat)))
    if not ctx.budgets_inferred:
        tot = float(b["monthly_budget"].sum())
        if ctx.avg_income > 0 and tot > ctx.avg_income:
            out.append(Finding("BUDGET_EXCEEDS_INCOME", "BUDGET", "HIGH", f"Your budget ({usd(tot)}) is bigger than your income ({usd(ctx.avg_income)})",
                               "Even hitting every category exactly would run a deficit. The plan itself needs cutting.",
                               impact=tot - ctx.avg_income))
        cm = A.full_only(ctx.cm, ctx.L).tail(6)
        unb = [c for c in cm.columns if c not in set(b["category"])]
        un = float(cm[unb].sum(axis=1).mean()) if unb else 0.0
        if un > 0.12 * max(ctx.avg_spend, 1):
            out.append(Finding("UNBUDGETED", "BUDGET", "LOW", f"{usd(un)}/month goes to categories with no budget line",
                               "Spending in: " + ", ".join(sorted(unb, key=lambda c: -cm[c].mean())[:6]) + ". Unbudgeted categories are where overruns hide.",
                               impact=un))
    return out


# ================================================================ RECURRING

def detect_price_hikes(ctx: Context) -> list[Finding]:
    r = ctx.rec_out
    if r.empty:
        return []
    horizon = ctx.L.end - pd.Timedelta(days=540)
    rows = []
    for _, s in r[r["active"]].iterrows():
        if s["prior_amount"] and s["change_pct"] > 0.015 and s["change_date"] is not None and s["change_date"] >= horizon and (s["fixed_amount"] or s["amount_cv"] < 0.1):
            rows.append({"merchant": s["merchant"], "from": s["prior_amount"], "to": s["last_amount"], "change": s["change_pct"],
                         "since": s["change_date"], "extra_per_month": (s["last_amount"] - s["prior_amount"]) * AVG_MONTH_DAYS / s["period_days"]})
    # Promo expiry: one stream ends, a pricier one from the same merchant starts right after.
    for merchant, g in r.groupby("merchant"):
        if len(g) < 2:
            continue
        g = g.sort_values("first")
        for (_, a), (_, b) in zip(g.iloc[:-1].iterrows(), g.iloc[1:].iterrows()):
            gap = (b["first"] - a["last"]).days
            if b["active"] and not a["active"] and 0 < gap <= a["period_days"] * 1.6 and b["typical_amount"] > a["typical_amount"] * 1.2 and b["first"] >= horizon:
                rows.append({"merchant": merchant, "from": a["typical_amount"], "to": b["typical_amount"],
                             "change": b["typical_amount"] / a["typical_amount"] - 1, "since": b["first"],
                             "extra_per_month": (b["typical_amount"] - a["typical_amount"]) * AVG_MONTH_DAYS / b["period_days"]})
    if not rows:
        return []
    df = pd.DataFrame(rows).sort_values("extra_per_month", ascending=False)
    extra = float(df["extra_per_month"].sum())
    sev = "HIGH" if extra >= 100 else "MEDIUM" if extra >= 15 else "LOW"
    names = ", ".join(f"{m} {c:+.0%}" for m, c in zip(df["merchant"].head(4), df["change"].head(4)))
    return [Finding("PRICE_HIKES", "RECURRING", sev, f"Price hikes on {len(df)} recurring charge(s): +{usd(extra)}/month",
                    f"{names}. Nobody emails you a comparison - the charge just quietly gets bigger. That's {usd(extra * 12)}/year.",
                    impact=extra, table=df)]


def detect_new_recurring(ctx: Context) -> list[Finding]:
    L = ctx.L
    cut = L.end - pd.Timedelta(days=100)
    found = ctx.rec_out[(ctx.rec_out["first"] >= cut) & ctx.rec_out["active"] & A.is_bill(ctx.rec_out)] if not ctx.rec_out.empty else ctx.rec_out
    # Two identical ~monthly charges is enough to raise an eyebrow on a fresh subscription.
    early = A.find_recurring(L, "expense", min_hits=2)
    if not early.empty:
        early = early[(early["hits"] == 2) & early["fixed_amount"] & early["cadence"].isin(["monthly"]) & (early["first"] >= cut) & early["active"]]
        found = pd.concat([found, early[~early["merchant"].isin(found["merchant"] if len(found) else [])]])
    if found is None or found.empty:
        return []
    tot = float(found["monthly_cost"].sum())
    sev = "MEDIUM" if tot >= 30 else "LOW"
    return [Finding("NEW_RECURRING", "RECURRING", sev, f"{len(found)} new recurring charge(s) in the last ~3 months: +{usd(tot)}/month",
                    ", ".join(f"{m} ({usd(a, True)}/{c.replace('ly', '') if c != 'monthly' else 'mo'})" for m, a, c in zip(found["merchant"], found["typical_amount"], found["cadence"]))
                    + f". That's {usd(tot * 12)}/year of new commitments.",
                    impact=tot, table=found[["merchant", "category", "cadence", "typical_amount", "first", "hits"]])]


def detect_subscription_load(ctx: Context) -> list[Finding]:
    r = ctx.rec_out
    if r.empty:
        return []
    out = []
    subs = r[r["active"] & A.is_bill(r) & ~r["category"].isin(["Housing", "Utilities", "Insurance", "Taxes"])]
    if len(subs):
        tot = float(subs["monthly_cost"].sum())
        then = ctx.L.end - pd.Timedelta(days=365)
        was = r[(r["first"] <= then) & (r["last"] >= then - pd.to_timedelta(r["period_days"], unit="D")) & A.is_bill(r)
                & ~r["category"].isin(["Housing", "Utilities", "Insurance", "Taxes"])]
        was_tot = float(was["monthly_cost"].sum())
        if tot > 0.05 * max(ctx.avg_income, 1) or (was_tot and tot > 1.3 * was_tot):
            out.append(Finding("SUB_LOAD", "RECURRING", "MEDIUM" if tot > 0.08 * max(ctx.avg_income, 1) else "LOW",
                               f"Subscriptions & memberships: {usd(tot)}/month across {len(subs)} services",
                               f"A year ago: {usd(was_tot)}/month across {len(was)}. That's {tot / max(ctx.avg_income, 1):.1%} of income, {usd(tot * 12)}/year.",
                               impact=tot - was_tot, table=subs[["merchant", "cadence", "typical_amount", "monthly_cost", "first"]]))
    small = r[r["active"] & r["fixed_amount"] & (r["typical_amount"] < 20) & ((ctx.L.end - r["first"]).dt.days > 180)]
    if len(small) >= 2:
        yr = float(small["annual_cost"].sum())
        out.append(Finding("QUIET_SUBS", "RECURRING", "LOW", f"{len(small)} small charges running quietly: {usd(yr)}/year",
                           "Each is under $20 and has renewed for 6+ months without changing - the easiest kind to forget you're paying: "
                           + ", ".join(small["merchant"].head(8)) + ".", impact=yr / 12,
                           table=small[["merchant", "typical_amount", "annual_cost", "first"]]))
    return out


def detect_upcoming_lumps(ctx: Context) -> list[Finding]:
    r = ctx.rec_out
    if r.empty:
        return []
    horizon = ctx.L.end + pd.Timedelta(days=75)
    up = r[r["active"] & (r["period_days"] >= 85) & (r["next_expected"] <= horizon) & (r["next_expected"] > ctx.L.end - pd.Timedelta(days=5))]
    if up.empty:
        return []
    tot = float(up["typical_amount"].sum())
    sev = "MEDIUM" if tot > 0.2 * max(ctx.avg_income, 1) or tot > 400 else "LOW"
    return [Finding("UPCOMING_LUMPS", "FORECAST", sev, f"{len(up)} non-monthly charge(s) due in the next ~75 days: {usd(tot)}",
                    "; ".join(f"{m} ~{usd(a)} around {d:%b %d} ({c})" for m, a, d, c in zip(up["merchant"], up["typical_amount"], up["next_expected"], up["cadence"]))
                    + ". Annual and semiannual bills never show up in a monthly average until they land.",
                    impact=tot, table=up[["merchant", "cadence", "typical_amount", "next_expected"]])]


def detect_savings_stopped(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    sav = t[(t["kind"] == "transfer") & (t["amount"] < 0) & t["description"].str.contains(
        r"(?:saving|invest|brokerage|401k|\bira\b|vanguard|fidelity|schwab|robinhood|betterment|wealthfront|acorns|emergency fund)", case=False, regex=True)]
    if len(sav) < 3:
        return []
    sm = sav.groupby("month")["amount"].sum().abs().reindex(ctx.L.months, fill_value=0.0)
    full = sm[sm.index.isin(ctx.L.full_months)]
    if len(full) < 6:
        return []
    last3 = float(full.tail(3).mean())
    # "Before" = the habit while it was alive: the 6 months leading up to the
    # last month that had any transfer (outside the recent window).
    older = full.iloc[:-3]
    alive = older[older > 0]
    before = float(older.loc[: alive.index[-1]].tail(6).mean()) if len(alive) else 0.0
    if before <= 0 or last3 > 0.5 * before:
        return []
    stopped = sav["date"].max()
    return [Finding("SAVINGS_STOPPED", "CASHFLOW", "HIGH" if last3 == 0 else "MEDIUM",
                    f"Savings transfers {'stopped' if last3 == 0 else 'shrank'}: {usd(before)}/mo → {usd(last3)}/mo",
                    f"Last transfer out to savings/investments: {stopped:%b %d, %Y}. Transfers are excluded from 'spending', "
                    f"so a stalled savings habit is invisible in every spending chart.",
                    impact=before - last3, series=sm.tail(12))]


# ================================================================ LEAKS

FEE_KINDS = [
    ("Overdraft / NSF", r"overdraft|\bnsf\b|insufficient|returned item|od fee"),
    ("Interest", r"interest charge|finance charge|purchase interest"),
    ("ATM", r"atm fee|atm surcharge|non-.*atm"),
    ("Foreign transaction", r"foreign"),
    ("Late", r"late (?:fee|charge|payment)"),
]


def detect_fees(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    fees = t[(t["category"] == "Fees & Interest") & (t["flow"] > 0)]
    if fees.empty:
        return []
    fees = fees.assign(fee_type="Other fees")
    for name, rx in FEE_KINDS:
        m = fees["description"].str.contains(rx, case=False, regex=True) & (fees["fee_type"] == "Other fees")
        fees.loc[m, "fee_type"] = name
    yr = fees[fees["date"] > ctx.L.end - pd.Timedelta(days=365)]
    out = []
    od = yr[yr["fee_type"] == "Overdraft / NSF"]
    if len(od):
        recent = od[od["date"] > ctx.L.end - pd.Timedelta(days=90)]
        out.append(Finding("OVERDRAFT_FEES", "LEAK", "HIGH" if len(recent) else "MEDIUM",
                           f"{len(od)} overdraft/NSF fee(s) in 12 months ({usd(od['flow'].sum())})",
                           f"Most recent {od['date'].max():%b %d}. These are pure cash-timing penalties - see the crunch window.",
                           impact=float(od["flow"].sum()) / 12, table=od[["date", "description", "flow"]]))
    it = fees[fees["fee_type"] == "Interest"]
    if len(it):
        months = it["month"].nunique()
        recent = it[it["date"] > ctx.L.end - pd.Timedelta(days=95)]
        out.append(Finding("INTEREST", "LEAK", "HIGH" if recent["month"].nunique() >= 2 else "MEDIUM",
                           f"Paying card interest: {usd(it['flow'].sum())} across {months} month(s)",
                           f"Last 3 months: {usd(recent['flow'].sum())}. Interest means a balance is being carried - it compounds, and it rises "
                           f"as the balance does ({usd(it.groupby('month')['flow'].sum().iloc[0])} in the first month vs {usd(it.groupby('month')['flow'].sum().iloc[-1])} in the latest).",
                           impact=float(recent["flow"].sum()) / 3, series=it.groupby("month")["flow"].sum()))
    rest = yr[~yr["fee_type"].isin(["Overdraft / NSF", "Interest"])]
    if len(rest) and rest["flow"].sum() >= 25:
        by = rest.groupby("fee_type")["flow"].agg(["count", "sum"]).sort_values("sum", ascending=False)
        out.append(Finding("FEES", "LEAK", "MEDIUM" if rest["flow"].sum() >= 150 else "LOW",
                           f"{usd(rest['flow'].sum())} in other fees over 12 months",
                           "; ".join(f"{k}: {int(r['count'])}× = {usd(r['sum'])}" for k, r in by.iterrows()) + ". Fees are money for nothing - most are avoidable.",
                           impact=float(rest["flow"].sum()) / 12, table=by.reset_index()))
    return out


def detect_micro_leak(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    micro = t[(t["kind"] == "expense") & (t["flow"] > 0) & (t["flow"] < 15) & ~t["category"].isin(["Fees & Interest", "Subscriptions", "Utilities", "Insurance"])
              & t["month"].isin(ctx.L.full_months)]
    if len(micro) < 20:
        return []
    by = micro.groupby("month")["flow"].agg(["sum", "count"]).reindex(ctx.L.full_months, fill_value=0.0)
    last3 = by.tail(3)
    prior = by.iloc[-12:-3]
    s_now = float(last3["sum"].mean())
    c_now = float(last3["count"].mean())
    s_then = float(prior["sum"].mean()) if len(prior) else s_now
    growth = s_now / s_then - 1 if s_then else 0
    if s_now < 80:
        return []
    top = micro[micro["month"].isin(ctx.L.full_months[-3:])].groupby("merchant")["flow"].agg(["count", "sum"]).sort_values("sum", ascending=False).head(6)
    sev = "MEDIUM" if s_now >= 200 or growth > 0.4 else "LOW"
    return [Finding("MICRO_LEAK", "LEAK", sev, f"Death by a thousand cuts: {c_now:.0f} purchases under $15 = {usd(s_now)}/month",
                    f"{usd(s_now * 12)}/year in amounts too small to register individually"
                    + (f", up {growth:.0%} vs the prior months" if growth > 0.15 else "")
                    + ". Top offenders: " + ", ".join(f"{m} ({int(r['count'])}×)" for m, r in top.iterrows()) + ".",
                    impact=s_now, series=by["sum"].tail(12), table=top.reset_index())]


def detect_dark_money(ctx: Context) -> list[Finding]:
    """Cash and P2P outflows: money that leaves without saying what for."""
    t = ctx.L.tx
    dark = t[t["category"].isin(["Cash & ATM", "P2P Transfers"]) & (t["kind"] == "expense")]
    if dark.empty:
        return []
    by = dark.groupby("month")["flow"].sum().reindex(ctx.L.full_months, fill_value=0.0)
    spend = ctx.full["spend"]
    if len(by) < 6:
        return []
    now = float(by.tail(3).mean())
    then = float(by.iloc[-12:-3].mean())
    share = now / max(float(spend.tail(3).mean()), 1)
    growth = now / then - 1 if then else 0
    tr = A.robust_trend(by.tail(18))
    long_growth = tr["growth"] if tr["z"] >= 1.64 else 0.0
    if share < 0.08 and growth < 0.4 and long_growth < 0.5:
        return []
    if max(now, float(tr["fit"].iloc[-1])) < 100:
        return []
    growth = max(growth, long_growth)
    return [Finding("DARK_MONEY", "LEAK", "MEDIUM" if share > 0.12 or growth > 0.6 else "LOW",
                    f"Untraceable outflows: {usd(now)}/month via cash & P2P ({share:.0%} of spend)",
                    f"ATM withdrawals and Venmo/Zelle/PayPal payments {'grew ' + f'{growth:.0%}' if growth > 0.1 else 'held steady'} on trend. "
                    f"No category data survives the trip, so this is spending no chart can explain.",
                    impact=float(tr["fit"].iloc[-1] - tr["fit"].iloc[0]) if long_growth else now * 0.1, series=by.tail(18), baseline=tr["fit"])]


def detect_payday_splurge(ctx: Context) -> list[Finding]:
    if not ctx.has_income:
        return []
    t = ctx.L.tx
    inc = t[t["kind"] == "income"]
    if inc.empty:
        return []
    big = inc[inc["inflow"] >= 0.25 * max(ctx.avg_income, 1)]
    if len(big) < 4:
        return []
    d = A.daily(ctx.L)
    glow = pd.Series(False, index=d.index)
    for day in big["date"].unique():
        glow[(d.index >= day) & (d.index <= pd.Timestamp(day) + pd.Timedelta(days=2))] = True
    in_w = d.loc[glow, "discretionary"]
    out_w = d.loc[~glow, "discretionary"]
    if len(in_w) < 6 or out_w.mean() <= 0:
        return []
    ratio = in_w.mean() / out_w.mean()
    if ratio < 1.35:
        return []
    per_month = (in_w.mean() - out_w.mean()) * glow.sum() / max(len(ctx.L.months), 1)
    return [Finding("PAYDAY_SPLURGE", "LEAK", "MEDIUM" if ratio > 1.7 else "LOW",
                    f"Payday effect: {ratio:.1f}× more discretionary spending in the 3 days after a deposit",
                    f"{usd(in_w.mean())}/day right after payday vs {usd(out_w.mean())}/day otherwise. Roughly {usd(per_month)}/month "
                    f"of spending follows the balance, not a plan.", impact=per_month)]


def detect_duplicates(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    e = t[(t["kind"] == "expense") & (t["flow"] >= 20) & ~t["category"].isin(["Cash & ATM", "P2P Transfers", "Transfer", "Housing"])]
    e = e.assign(key=e["flow"].round(2))
    pairs = []
    for (_, _), g in e.groupby(["merchant", "key"]):
        if len(g) < 2:
            continue
        g = g.sort_values("date")
        dts = g["date"].values
        for i in range(1, len(g)):
            gap = (dts[i] - dts[i - 1]).astype("timedelta64[D]").astype(int)
            if gap <= 3:
                pairs.append({"date": g["date"].iloc[i], "merchant": g["merchant"].iloc[i], "amount": float(g["flow"].iloc[i]),
                              "days_apart": gap, "description": g["description"].iloc[i]})
    if not pairs:
        return []
    df = pd.DataFrame(pairs).sort_values("date", ascending=False)
    recent = df[df["date"] > ctx.L.end - pd.Timedelta(days=120)]
    if recent.empty:
        return []
    tot = float(recent["amount"].sum())
    return [Finding("DUPLICATES", "ANOMALY", "MEDIUM" if tot >= 100 else "LOW",
                    f"{len(recent)} possible duplicate charge(s) in the last 120 days ({usd(tot)})",
                    "Same merchant, same exact amount, within 3 days: "
                    + "; ".join(f"{m} {usd(a, True)} on {d:%b %d}" for m, a, d in zip(recent["merchant"].head(5), recent["amount"].head(5), recent["date"].head(5)))
                    + ". Worth checking the statement - double-billing is common and only refunded if you ask.",
                    impact=tot, table=recent)]


def detect_outliers(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    e = t[(t["kind"] == "expense") & (t["flow"] > 0)]
    recent_cut = ctx.L.end - pd.Timedelta(days=90)
    rows = []
    for cat, g in e.groupby("category"):
        hist = g[g["date"] <= recent_cut]
        if len(hist) < 10 or cat in ("Housing", "Taxes", "Transfer"):
            continue
        lh = np.log(hist["flow"])
        med = float(lh.median())
        mad = float((lh - med).abs().median()) * 1.4826 or 0.25
        for _, r in g[g["date"] > recent_cut].iterrows():
            z = (np.log(r["flow"]) - med) / mad
            if z > 3.2 and r["flow"] >= 150:
                rows.append({"date": r["date"], "merchant": r["merchant"], "category": cat, "amount": float(r["flow"]),
                             "typical": float(np.exp(med)), "z": float(z)})
    if not rows:
        return []
    df = pd.DataFrame(rows).sort_values("amount", ascending=False)
    tot = float(df["amount"].sum())
    return [Finding("OUTLIERS", "ANOMALY", "MEDIUM" if tot >= 500 else "LOW",
                    f"{len(df)} unusually large purchase(s) in the last 90 days ({usd(tot)})",
                    "; ".join(f"{m} {usd(a)} ({c}, typical {usd(ty)})" for m, a, c, ty in zip(df["merchant"].head(5), df["amount"].head(5), df["category"].head(5), df["typical"].head(5)))
                    + ". Individually explainable, collectively they're often why a 'normal' month isn't.",
                    impact=tot, table=df)]


def detect_merchant_surge(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    e = t[t["kind"].isin(["expense", "refund"]) & t["month"].isin(ctx.L.full_months)]
    if len(ctx.L.full_months) < 9:
        return []
    now_m, then_m = ctx.L.full_months[-3:], ctx.L.full_months[-9:-3]
    now = e[e["month"].isin(now_m)].groupby("merchant")["flow"].sum() / 3
    then = e[e["month"].isin(then_m)].groupby("merchant")["flow"].sum() / len(then_m)
    df = pd.DataFrame({"now": now, "then": then}).fillna(0.0)
    df = df[(df["then"] > 20) & (df["now"] > 1.6 * df["then"]) & (df["now"] - df["then"] > 60)]
    rec = set(ctx.rec_out["merchant"]) if not ctx.rec_out.empty else set()
    df = df[~df.index.isin(rec)]
    if df.empty:
        return []
    df["delta"] = df["now"] - df["then"]
    df = df.sort_values("delta", ascending=False).head(6)
    return [Finding("MERCHANT_SURGE", "TREND", "MEDIUM" if df["delta"].sum() > 150 else "LOW",
                    f"{len(df)} merchant(s) getting a lot more of your money",
                    "; ".join(f"{m}: {usd(r['then'])} → {usd(r['now'])}/mo" for m, r in df.iterrows()) + " (last 3 months vs the 6 before).",
                    impact=float(df["delta"].sum()), table=df.reset_index().rename(columns={"index": "merchant"}))]


def detect_new_merchants(ctx: Context) -> list[Finding]:
    t = ctx.L.tx
    e = t[(t["kind"] == "expense") & (t["flow"] > 0)]
    first = e.groupby("merchant")["date"].min()
    if (ctx.L.end - ctx.L.start).days < 120:
        return []
    fresh = first[first > ctx.L.end - pd.Timedelta(days=60)].index
    big = e[e["merchant"].isin(fresh)].groupby("merchant")["flow"].sum()
    big = big[big >= 250].sort_values(ascending=False)
    if big.empty:
        return []
    return [Finding("NEW_MERCHANTS", "ANOMALY", "LOW", f"{usd(big.sum())} at {len(big)} merchant(s) you'd never used before (last 60 days)",
                    ", ".join(f"{m} {usd(v)}" for m, v in big.head(6).items()) + ". New places are where one-off 'just this once' spending lives.",
                    impact=float(big.sum()), table=big.rename("spent").reset_index())]


# ================================================================ INCOME

def detect_income(ctx: Context) -> list[Finding]:
    f = ctx.full.tail(12)
    out = []
    if len(f) >= 6:
        inc = f["income"]
        cv = float(inc.std() / inc.mean()) if inc.mean() > 0 else 0
        if cv > 0.25:
            out.append(Finding("INCOME_VOLATILE", "INCOME", "MEDIUM" if cv > 0.4 else "LOW", f"Income swings ±{cv:.0%} month to month",
                               f"Ranged {usd(inc.min())}–{usd(inc.max())}. Irregular income needs budgeting to the low months, not the average.",
                               impact=float(inc.mean() - inc.min()), series=inc))
        last = float(inc.iloc[-1])
        med = float(inc.iloc[-7:-1].median())
        if med > 0 and last < 0.8 * med:
            out.append(Finding("INCOME_DROP", "INCOME", "HIGH", f"{mlabel(inc.index[-1])} income was {1 - last / med:.0%} below normal",
                               f"{usd(last)} vs a {usd(med)} median.", impact=med - last, series=inc))
    # Sources that dried up: paid in >=4 of the 12 months before the last 4, nothing since.
    t = ctx.L.tx[ctx.L.tx["kind"] == "income"]
    months = ctx.L.months
    if len(months) >= 10 and not t.empty:
        recent = months[-4:]
        window = months[-16:-4]
        for src, g in t.groupby("merchant"):
            m_hit = set(g["month"])
            if len(m_hit & set(window)) >= 4 and not (m_hit & set(recent)):
                avg = float(g[g["month"].isin(window)]["inflow"].sum()) / len(window)
                if avg < 50:
                    continue
                out.append(Finding("INCOME_LOST", "INCOME", "HIGH", f"Income source went quiet: {src}",
                                   f"Paid you in {len(m_hit & set(window))} of {len(window)} months (avg {usd(avg)}/mo); last deposit {g['date'].max():%b %d, %Y}.",
                                   impact=avg, subject=src, series=g.groupby("month")["inflow"].sum().reindex(months, fill_value=0.0).tail(16)))
    # Regular paycheck overdue.
    r = ctx.rec_in
    if not r.empty:
        late = r[(r["hits"] >= 4) & r["active"].eq(False) & (r["last"] > ctx.L.end - pd.Timedelta(days=90))]
        for _, s in late.iterrows():
            out.append(Finding("PAYCHECK_LATE", "INCOME", "HIGH", f"Expected deposit missing: {s['merchant']}",
                               f"{s['cadence'].title()} deposit of ~{usd(s['typical_amount'])} last seen {s['last']:%b %d}; next was due ~{s['next_expected']:%b %d}.",
                               impact=float(s["monthly_cost"])))
    return out


# ================================================================ DATA

def detect_data_quality(ctx: Context) -> list[Finding]:
    L = ctx.L
    out = []
    if not ctx.has_income:
        out.append(Finding("NO_INCOME", "DATA", "INFO", "No income in this data - looks like a card-only export",
                           "Deficit, savings-rate, crunch-window and payday checks are switched off because they'd be meaningless. "
                           "Add your checking-account export alongside the card file to turn them on."))
    unc = L.tx[L.tx["category"] == "Uncategorized"]["flow"].sum()
    tot = L.tx["flow"].sum()
    if tot > 0 and unc / tot > 0.08:
        out.append(Finding("UNCATEGORIZED", "DATA", "INFO", f"{unc / tot:.0%} of spending is uncategorized",
                           "Detectors that work per-category can't see it. Add a Category column to your CSV, or extend the rules in categorize.py.",
                           impact=0.0))
    for acct, g in L.tx.groupby("account"):
        d = g["date"].drop_duplicates().sort_values()
        gaps = d.diff().dt.days
        big = gaps[gaps > 14]
        if len(big):
            i = big.idxmax()
            out.append(Finding("DATA_GAP", "DATA", "INFO", f"{acct}: {int(big.max())}-day gap with no transactions",
                               f"Ending {d[i]:%b %d, %Y}. Missing statements look exactly like months where you spent nothing.",
                               subject=acct))
    part = [m for m in L.months if m not in L.full_months]
    if part:
        out.append(Finding("PARTIAL_MONTHS", "DATA", "INFO", f"{len(part)} partial month(s) excluded from trends",
                           "Partially-covered months: " + ", ".join(mlabel(m) for m in part) + ". They'd look like sudden drops, so every trend and baseline skips them.",
                           ))
    return out


DETECTORS = [
    detect_deficit_streak, detect_spend_outpacing_income, detect_savings_rate, detect_crunch_window,
    detect_low_balance, detect_forecast_breach, detect_runway, detect_card_debt, detect_bill_cluster,
    detect_fixed_cost_ratio, detect_lifestyle_creep, detect_stealth_creep, detect_category_spikes,
    detect_velocity, detect_seasonal, detect_weekend_drift, detect_budget, detect_price_hikes,
    detect_new_recurring, detect_subscription_load, detect_upcoming_lumps, detect_savings_stopped,
    detect_fees, detect_micro_leak, detect_dark_money, detect_payday_splurge, detect_duplicates,
    detect_outliers, detect_merchant_surge, detect_new_merchants, detect_income, detect_data_quality,
]


def run_all(ctx: Context) -> list[Finding]:
    found: list[Finding] = []
    for det in DETECTORS:
        try:
            found.extend(det(ctx))
        except Exception as exc:  # one broken detector must not blind the rest
            ctx.errors.append(f"{det.__name__}: {exc.__class__.__name__}: {exc}\n{traceback.format_exc(limit=3)}")
    return sorted(found, key=lambda f: f.rank)


def threat_level(findings: list[Finding]) -> tuple[int, str]:
    score = min(100, sum(SEV_POINTS[f.severity] for f in findings))
    for cut, label in ((15, "NOMINAL"), (35, "GUARDED"), (60, "ELEVATED"), (85, "SEVERE")):
        if score < cut:
            return score, label
    return score, "CRITICAL"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
