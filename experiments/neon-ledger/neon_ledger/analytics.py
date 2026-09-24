"""Aggregations the charts and detectors share.

Nothing here draws or judges - it only reshapes the enriched transaction
frame (see categorize.enrich) into the monthly / daily / per-merchant views
everything else is built from.

A note on partial months: bank exports almost never start on the 1st or end
on the last day of a month. A half-covered month looks like a spending
collapse (or an income collapse) and poisons every trend, baseline and
"vs. last month" comparison built on it. So every monthly view carries a
`full` flag and the trend/baseline code only ever looks at full months.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

AVG_MONTH_DAYS = 30.4375

CADENCES = [
    # name, centre (days), tolerance (days)
    ("weekly", 7.0, 1.5),
    ("biweekly", 14.0, 2.0),
    ("semimonthly", 15.2, 2.5),
    ("monthly", AVG_MONTH_DAYS, 4.0),
    ("bimonthly", 61.0, 7.0),
    ("quarterly", 91.3, 10.0),
    ("semiannual", 182.6, 15.0),
    ("yearly", 365.25, 20.0),
]


@dataclass
class Ledger:
    tx: pd.DataFrame
    start: pd.Timestamp
    end: pd.Timestamp
    months: list[pd.Timestamp] = field(default_factory=list)
    full_months: list[pd.Timestamp] = field(default_factory=list)

    @property
    def current_month(self) -> pd.Timestamp:
        return self.months[-1]

    @property
    def current_is_partial(self) -> bool:
        return bool(self.months) and self.months[-1] not in self.full_months

    @property
    def days(self) -> int:
        return int((self.end - self.start).days) + 1


def month_start(d: pd.Series | pd.Timestamp):
    if isinstance(d, pd.Timestamp):
        return d.to_period("M").to_timestamp()
    return d.dt.to_period("M").dt.to_timestamp()


def build_ledger(tx: pd.DataFrame) -> Ledger:
    tx = tx.sort_values(["date", "amount"]).reset_index(drop=True).copy()
    tx["month"] = month_start(tx["date"])
    tx["dow"] = tx["date"].dt.dayofweek
    tx["dom"] = tx["date"].dt.day
    tx["weekend"] = tx["dow"] >= 5
    start, end = tx["date"].min(), tx["date"].max()
    months = list(pd.date_range(month_start(start), month_start(end), freq="MS"))
    full = []
    for m in months:
        m_end = m + pd.offsets.MonthEnd(0)
        # Allow 3 days of slack at either edge - posting delays are normal.
        if start <= m + pd.Timedelta(days=3) and end >= m_end - pd.Timedelta(days=3):
            full.append(m)
    return Ledger(tx=tx, start=start, end=end, months=months, full_months=full)


# ---------------------------------------------------------------- monthly

def monthly_summary(L: Ledger) -> pd.DataFrame:
    t = L.tx
    g = t.groupby("month")
    df = pd.DataFrame({
        "income": g["inflow"].sum(),
        "spend": g["flow"].sum(),
        "discretionary": t[t["is_discretionary"]].groupby("month")["flow"].sum(),
        "transfers": t[t["kind"] == "transfer"].groupby("month")["amount"].apply(lambda s: s.abs().sum()),
        "n_tx": t[t["kind"] != "transfer"].groupby("month").size(),
        "refunds": -t[t["kind"] == "refund"].groupby("month")["flow"].sum(),
    }).reindex(L.months).fillna(0.0)
    df["net"] = df["income"] - df["spend"]
    df["savings_rate"] = np.where(df["income"] > 0, df["net"] / df["income"].where(df["income"] > 0, np.nan), np.nan)
    df["essential"] = df["spend"] - df["discretionary"]
    df["cum_net"] = df["net"].cumsum()
    df["full"] = df.index.isin(L.full_months)
    df.index.name = "month"
    return df


def category_matrix(L: Ledger, value: str = "flow") -> pd.DataFrame:
    """month x category spend (refunds netted). Only spending kinds."""
    t = L.tx[L.tx["kind"].isin(["expense", "refund"])]
    if t.empty:
        return pd.DataFrame(index=pd.Index(L.months, name="month"))
    m = t.pivot_table(index="month", columns="category", values=value, aggfunc="sum", fill_value=0.0)
    m = m.reindex(L.months, fill_value=0.0)
    m.index.name = "month"
    return m[m.sum().sort_values(ascending=False).index]


def top_categories(L: Ledger, n: int = 7) -> list[str]:
    m = category_matrix(L)
    tot = m.sum()
    return list(tot[tot > 0].sort_values(ascending=False).index[:n])


def fold_categories(series: pd.Series, keep: list[str]) -> pd.Series:
    """Collapse anything outside `keep` into 'Other' - never more than 8 hues."""
    return series.where(series.isin(keep), "Other")


def full_only(df: pd.DataFrame, L: Ledger) -> pd.DataFrame:
    return df.loc[df.index.isin(L.full_months)]


# ------------------------------------------------------------------ daily

def daily(L: Ledger) -> pd.DataFrame:
    t = L.tx
    idx = pd.date_range(L.start, L.end, freq="D")
    g = t.groupby("date")
    d = pd.DataFrame({
        "spend": g["flow"].sum(),
        "income": g["inflow"].sum(),
        "discretionary": t[t["is_discretionary"]].groupby("date")["flow"].sum(),
        "n": t[t["kind"] != "transfer"].groupby("date").size(),
    }).reindex(idx).fillna(0.0)
    d["net"] = d["income"] - d["spend"]
    d.index.name = "date"
    return d


def balance_series(L: Ledger, starting_balance: float | None) -> tuple[pd.Series, str]:
    """Daily cash position.

    Returns (series, mode) where mode is:
      reported  - the file carried a running balance column; we use it
      estimated - starting_balance + cumulative net (transfers excluded)
      relative  - no anchor; cumulative net from zero (shape only)
    """
    t = L.tx
    idx = pd.date_range(L.start, L.end, freq="D")
    # Accounts whose export carried a running balance. For a checking account
    # that *is* your liquid cash - card spending reaches it when the card is
    # paid - so those balances alone are the truest cash line we can draw.
    cover = t.groupby("account")["balance"].apply(lambda s: s.notna().mean())
    bal_accts = list(cover[cover > 0.8].index)
    if bal_accts:
        parts = []
        for acct in bal_accts:
            g = t[(t["account"] == acct) & t["balance"].notna()]
            # Same-day rows: keep file order; the last printed is end-of-day.
            last = g.sort_values("date", kind="stable").groupby("date")["balance"].last()
            parts.append(last.reindex(idx).ffill())
        s = pd.concat(parts, axis=1).sum(axis=1, min_count=1).ffill().bfill()
        s.index.name = "date"
        s.attrs["accounts"] = bal_accts
        return s, "reported"
    net = daily(L)["net"].cumsum()
    if starting_balance is not None:
        return starting_balance + net, "estimated"
    return net, "relative"


# ------------------------------------------------------------- recurring

def _cadence_for(intervals: np.ndarray) -> tuple[str, float, float] | None:
    if len(intervals) == 0:
        return None
    med = float(np.median(intervals))
    best = min(CADENCES, key=lambda c: abs(c[1] - med))
    name, centre, tol = best
    if abs(med - centre) > tol * 1.5:
        return None
    # A missed or doubled-up cycle is fine; most gaps must still fit.
    fits = np.abs(intervals - centre) <= tol * 1.6
    fits |= np.abs(intervals - 2 * centre) <= tol * 2  # one skipped cycle
    if fits.mean() < 0.7:
        return None
    return best


def find_recurring(L: Ledger, kind: str = "expense", min_hits: int = 3) -> pd.DataFrame:
    """Detect repeating charges (or deposits, with kind='income').

    Within each merchant, transactions are chained chronologically onto a
    stream whose last amount is within 35% - so a $15.49 -> $17.99 price hike
    stays one stream, but a $0.99 and a $9.99 iCloud tier are two.
    """
    t = L.tx[L.tx["kind"] == kind]
    rows = []
    for merchant, g in t.groupby("merchant", sort=False):
        if len(g) < 2:
            continue
        g = g.sort_values("date")
        streams: list[dict] = []
        for date, amt, cat in zip(g["date"], g["amount"].abs(), g["category"]):
            best, best_d = None, None
            for s in streams:
                ref = s["amounts"][-1]
                d = abs(amt - ref) / max(ref, 1.0)
                if d <= 0.35 and (best_d is None or d < best_d):
                    best, best_d = s, d
            if best is None:
                streams.append({"dates": [date], "amounts": [amt], "cats": [cat]})
            else:
                best["dates"].append(date)
                best["amounts"].append(amt)
                best["cats"].append(cat)
        for s in streams:
            n = len(s["dates"])
            dates = pd.DatetimeIndex(s["dates"])
            iv = np.diff(dates.values).astype("timedelta64[D]").astype(float)
            # Same-day repeats are separate purchases, not a cadence.
            iv = iv[iv > 0]
            if n < min_hits and not (n >= 2 and len(iv) and iv.min() > 300):
                continue
            cad = _cadence_for(iv)
            if cad is None:
                continue
            name, period, _ = cad
            amts = np.array(s["amounts"], dtype=float)
            changes = np.abs(np.diff(amts)) / np.maximum(amts[:-1], 1.0)
            fixed = bool((changes < 0.02).mean() >= 0.6) if len(changes) else True
            # Variable amounts on a rough cadence are easy to hit by chance
            # (three Chipotle visits ~60 days apart). Demand more evidence.
            if not fixed and n < 5:
                continue
            # Most recent price change that stuck.
            prior, change_date = None, None
            for i in range(len(amts) - 1, 0, -1):
                if abs(amts[i] - amts[i - 1]) / max(amts[i - 1], 1.0) >= 0.01:
                    prior, change_date = amts[i - 1], dates[i]
                    break
            last = float(amts[-1])
            typical = last if fixed else float(np.median(amts[-6:]))
            last_date = dates[-1]
            active = (L.end - last_date).days <= period * 1.5 + 4
            rows.append({
                "merchant": merchant,
                "category": pd.Series(s["cats"]).mode().iat[0],
                "cadence": name,
                "period_days": period,
                "hits": n,
                "first": dates[0],
                "last": last_date,
                "next_expected": last_date + pd.Timedelta(days=round(period)),
                "last_amount": last,
                "first_amount": float(amts[0]),
                "typical_amount": typical,
                "monthly_cost": typical * AVG_MONTH_DAYS / period,
                "annual_cost": typical * 365.25 / period,
                "fixed_amount": fixed,
                "amount_cv": float(amts.std() / amts.mean()) if amts.mean() else 0.0,
                "active": bool(active),
                "prior_amount": prior,
                "change_date": change_date,
                "change_pct": (last - prior) / prior if prior else 0.0,
                "total_change_pct": (last - amts[0]) / amts[0] if amts[0] else 0.0,
                "dates": list(dates),
                "amounts": list(amts),
            })
    cols = ["merchant", "category", "cadence", "period_days", "hits", "first", "last", "next_expected",
            "last_amount", "first_amount", "typical_amount", "monthly_cost", "annual_cost", "fixed_amount",
            "amount_cv", "active", "prior_amount", "change_date", "change_pct", "total_change_pct", "dates", "amounts"]
    out = pd.DataFrame(rows, columns=cols)
    return out.sort_values("monthly_cost", ascending=False).reset_index(drop=True)


def is_bill(rec: pd.DataFrame) -> pd.Series:
    """Recurring streams that behave like bills/subscriptions rather than habits
    (a weekly coffee is recurring, but it isn't a bill)."""
    bill_cats = {"Housing", "Utilities", "Insurance", "Subscriptions", "Education", "Taxes", "Auto", "Health & Fitness"}
    return rec["fixed_amount"] | rec["category"].isin(bill_cats)


# ------------------------------------------------------------------ pace

def category_pace(L: Ledger) -> pd.DataFrame:
    """Projected month-end spend for the current month, per category.

    projected = spent so far + the median amount that category has
    historically spent *after* today's day-of-month. Additive, so rent paid
    on the 1st doesn't get extrapolated into five rents.
    """
    cm = L.current_month
    day = L.end.day
    t = L.tx[L.tx["kind"].isin(["expense", "refund"])]
    now = t[t["month"] == cm].groupby("category")["flow"].sum()
    hist = t[t["month"].isin([m for m in L.full_months if m != cm][-6:])]
    if hist.empty:
        rem = pd.Series(dtype=float)
        typical = pd.Series(dtype=float)
    else:
        after = hist[hist["dom"] > day].groupby(["category", "month"])["flow"].sum().unstack(fill_value=0.0)
        tot = hist.groupby(["category", "month"])["flow"].sum().unstack(fill_value=0.0)
        after = after.reindex_like(tot).fillna(0.0)
        rem = after.median(axis=1)
        typical = tot.median(axis=1)
    cats = now.index.union(typical.index)
    df = pd.DataFrame({"so_far": now.reindex(cats).fillna(0.0), "typical_remaining": rem.reindex(cats).fillna(0.0), "typical_month": typical.reindex(cats).fillna(0.0)})
    if not L.current_is_partial:
        df["typical_remaining"] = 0.0
    df["projected"] = df["so_far"] + df["typical_remaining"]
    df.index.name = "category"
    return df.sort_values("projected", ascending=False)


def budget_frame(L: Ledger, budgets: pd.DataFrame) -> pd.DataFrame:
    """Long frame: month, category, budget, actual, pct, over."""
    cm = category_matrix(L)
    b = budgets.set_index("category")["monthly_budget"]
    rows = []
    for cat, budget in b.items():
        if budget <= 0:
            continue
        actual = cm[cat] if cat in cm.columns else pd.Series(0.0, index=cm.index)
        for m, a in actual.items():
            rows.append({"month": m, "category": cat, "budget": float(budget), "actual": float(a), "full": m in L.full_months})
    df = pd.DataFrame(rows, columns=["month", "category", "budget", "actual", "full"])
    df["pct"] = df["actual"] / df["budget"]
    df["over"] = df["actual"] - df["budget"]
    return df


def infer_budgets(L: Ledger, lookback: int = 6, headroom: float = 1.0) -> pd.DataFrame:
    """No budget file? Use each category's median full month, rounded up to $10.

    That makes an 'overrun' mean 'more than you usually spend', which is the
    honest thing a baseline can say without knowing your intentions.
    """
    cm = full_only(category_matrix(L), L).tail(lookback)
    if cm.empty:
        cm = category_matrix(L)
    med = cm.median() * headroom
    med = med[(med > 5) & ~med.index.isin(["Uncategorized", "Transfer", "Income"])]
    out = pd.DataFrame({"category": med.index, "monthly_budget": (np.ceil(med.values / 10.0) * 10.0)})
    return out.sort_values("monthly_budget", ascending=False).reset_index(drop=True)


# -------------------------------------------------------------- statistics

def trend(y: pd.Series) -> dict:
    """OLS slope on an evenly-spaced series + R^2 and relative growth."""
    y = pd.Series(y).astype(float).dropna()
    n = len(y)
    if n < 3:
        return {"slope": 0.0, "r2": 0.0, "growth": 0.0, "n": n, "fit": y * 0 + (y.mean() if n else 0)}
    x = np.arange(n, dtype=float)
    slope, icpt = np.polyfit(x, y.values, 1)
    fit = icpt + slope * x
    ss_res = float(((y.values - fit) ** 2).sum())
    ss_tot = float(((y.values - y.values.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    base = fit[0] if abs(fit[0]) > 1e-9 else (y.values.mean() or 1.0)
    growth = (fit[-1] - fit[0]) / abs(base) if base else 0.0
    return {"slope": float(slope), "r2": float(r2), "growth": float(growth), "n": n, "fit": pd.Series(fit, index=y.index)}


def robust_trend(y: pd.Series) -> dict:
    """Theil-Sen slope + Mann-Kendall significance.

    Personal spending is spiky (a vacation, a car repair). Least squares lets
    one spike drag the slope around and one outlier tank R^2; the median of
    pairwise slopes ignores both, and Mann-Kendall asks the question we
    actually care about - "does this keep going up?" - without assuming a
    straight line. `z` >= 1.64 is a one-sided 95% upward trend.
    """
    y = pd.Series(y).astype(float).dropna()
    n = len(y)
    if n < 4:
        return {"slope": 0.0, "z": 0.0, "tau": 0.0, "growth": 0.0, "n": n, "fit": y * 0 + (y.mean() if n else 0)}
    v = y.values
    i, j = np.triu_indices(n, k=1)
    slopes = (v[j] - v[i]) / (j - i)
    slope = float(np.median(slopes))
    x = np.arange(n, dtype=float)
    icpt = float(np.median(v - slope * x))
    fit = icpt + slope * x
    sgn = np.sign(v[j] - v[i])
    S = float(sgn.sum())
    var = n * (n - 1) * (2 * n + 5) / 18.0
    z = (S - np.sign(S)) / np.sqrt(var) if S != 0 else 0.0
    tau = S / (n * (n - 1) / 2)
    start = fit[0] if fit[0] > 0 else max(float(np.median(v)), 1.0)
    growth = (fit[-1] - fit[0]) / start
    return {"slope": slope, "z": float(z), "tau": float(tau), "growth": float(growth), "n": n, "fit": pd.Series(fit, index=y.index)}


def robust_z(value: float, history: pd.Series) -> float:
    """(value - median) / (1.4826 * MAD), with a floor so flat history doesn't explode."""
    h = pd.Series(history).astype(float).dropna()
    if len(h) < 3:
        return 0.0
    med = float(h.median())
    mad = float((h - med).abs().median()) * 1.4826
    floor = max(0.1 * abs(med), 5.0)
    return (value - med) / max(mad, floor)


def rolling_window(L: Ledger, days: int = 30) -> pd.Series:
    return daily(L)["spend"].rolling(days, min_periods=days).sum()


# ---------------------------------------------------------------- forecast

def forecast_cash(L: Ledger, rec_out: pd.DataFrame, rec_in: pd.DataFrame, balance_now: float, horizon: int = 90) -> pd.DataFrame:
    """Day-by-day projected balance for the next `horizon` days.

    Scheduled items (active recurring bills and paychecks) land on their
    predicted dates; everything else is a flat daily burn/earn taken from the
    last 90 days with the recurring streams subtracted out. The band widens
    with the square root of time from the day-to-day noise of that burn.
    """
    days = pd.date_range(L.end + pd.Timedelta(days=1), periods=horizon, freq="D")
    sched = pd.Series(0.0, index=days)
    events: dict[pd.Timestamp, list[str]] = {}

    def place(rec: pd.DataFrame, sign: float):
        for _, r in rec[rec["active"]].iterrows():
            d = r["next_expected"]
            while d <= L.end:
                d += pd.Timedelta(days=round(r["period_days"]))
            while d <= days[-1]:
                dd = pd.Timestamp(d).normalize()
                if dd in sched.index:
                    sched[dd] += sign * r["typical_amount"]
                    events.setdefault(dd, []).append(f"{'+' if sign > 0 else '-'}${r['typical_amount']:,.0f} {r['merchant']}")
                d += pd.Timedelta(days=round(r["period_days"]))

    bills = rec_out[is_bill(rec_out)] if not rec_out.empty else rec_out
    place(bills, -1.0)
    place(rec_in, +1.0)

    look = L.tx[L.tx["date"] > L.end - pd.Timedelta(days=90)]
    span = max(1, min(90, L.days))
    rec_keys = set()
    for rec in (bills, rec_in):
        for _, r in rec.iterrows():
            for d, a in zip(r["dates"], r["amounts"]):
                rec_keys.add((r["merchant"], pd.Timestamp(d), round(float(a), 2)))
    mask = [((m, d, round(abs(a), 2)) not in rec_keys) for m, d, a in zip(look["merchant"], look["date"], look["amount"])]
    loose = look[np.array(mask, dtype=bool)] if len(look) else look
    d_spend = loose.groupby("date")["flow"].sum().reindex(pd.date_range(L.end - pd.Timedelta(days=span - 1), L.end), fill_value=0.0)
    d_income = loose.groupby("date")["inflow"].sum().reindex(d_spend.index, fill_value=0.0)
    burn = float(d_spend.mean())
    earn = float(d_income.mean())
    noise = float((d_income - d_spend).std() or 0.0)

    step = sched + earn - burn
    expected = balance_now + step.cumsum()
    k = np.sqrt(np.arange(1, horizon + 1))
    out = pd.DataFrame({
        "expected": expected,
        "low": expected - 1.28 * noise * k,   # ~80% band
        "high": expected + 1.28 * noise * k,
        "scheduled": sched,
    })
    out["events"] = [" · ".join(events.get(d, [])) for d in out.index]
    out.attrs.update({"burn": burn, "earn": earn, "noise": noise})
    out.index.name = "date"
    return out


def forecast_months(ms: pd.DataFrame, L: Ledger, ahead: int = 6) -> pd.DataFrame:
    """Linear projection of monthly income & spend with a residual band."""
    full = full_only(ms, L).tail(12)
    if len(full) < 3:
        return pd.DataFrame()
    fut = pd.date_range(full.index[-1] + pd.offsets.MonthBegin(1), periods=ahead, freq="MS")
    out = {}
    x = np.arange(len(full), dtype=float)
    xf = np.arange(len(full), len(full) + ahead, dtype=float)
    for col in ("income", "spend"):
        y = full[col].values.astype(float)
        slope, icpt = np.polyfit(x, y, 1)
        resid = y - (icpt + slope * x)
        sd = float(resid.std(ddof=1)) if len(y) > 2 else 0.0
        pred = icpt + slope * xf
        out[col] = pred
        out[col + "_lo"] = pred - 1.28 * sd
        out[col + "_hi"] = pred + 1.28 * sd
    return pd.DataFrame(out, index=fut)


def seasonality(ms: pd.DataFrame, L: Ledger) -> pd.Series | None:
    """Month-of-year spend index (1.0 = average). Needs 13+ full months."""
    full = full_only(ms, L)
    if len(full) < 13:
        return None
    by = full.groupby(full.index.month)["spend"].mean()
    return (by / full["spend"].mean()).rename("index")


def dom_profile(L: Ledger) -> pd.DataFrame:
    """Average cumulative spend and income by day-of-month across full months."""
    t = L.tx[L.tx["month"].isin(L.full_months)]
    n = max(1, len(L.full_months))
    s = t.groupby("dom")[["flow", "inflow"]].sum().reindex(range(1, 32), fill_value=0.0) / n
    s["cum_spend"] = s["flow"].cumsum()
    s["cum_income"] = s["inflow"].cumsum()
    s["cum_net"] = s["cum_income"] - s["cum_spend"]
    s.index.name = "day"
    return s
