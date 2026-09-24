from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from neon_ledger import analytics as A
from neon_ledger import categorize, ingest
from neon_ledger.pipeline import FileSpec, analyze, load

SAMPLE = Path(__file__).resolve().parent.parent / "sample_data"


@pytest.fixture(scope="module")
def demo():
    files = sorted(SAMPLE.glob("*_export.csv"))
    loaded = load([FileSpec(p.name, p.read_bytes()) for p in files])
    budgets = ingest.load_budgets((SAMPLE / "budgets.csv").read_bytes())
    return analyze(loaded.tx, budgets, None, 500.0)


def codes(an):
    return {f.code for f in an.findings}


def test_demo_runs_clean(demo):
    assert demo.ctx.errors == []
    assert demo.ctx.balance_mode == "reported"


@pytest.mark.parametrize("code", [
    "DUPLICATES",        # Best Buy billed twice, Uber Eats twice
    "PRICE_HIKES",       # Netflix, Spotify, Comcast, rent, NYT promo expiry
    "NEW_RECURRING",     # ChatGPT, Hulu, Disney+
    "UPCOMING_LUMPS",    # Amazon Prime annual renewal
    "SAVINGS_STOPPED",   # $300/mo transfers end in March 2026
    "INCOME_LOST",       # Upwork side income dries up
    "INTEREST",          # card interest from 2026
    "CARD_DEBT",         # paying 82% of the statement
    "LIFESTYLE_CREEP",
    "STEALTH_CREEP",
    "MICRO_LEAK",
    "PAYDAY_SPLURGE",
    "CRUNCH_WINDOW",     # rent on the 1st, pay on the 15th
    "OVERDRAFT_FEES",
    "DEFICIT_STREAK",
    "CHRONIC_OVERRUN",
])
def test_demo_planted_problems_are_found(demo, code):
    assert code in codes(demo)


def test_demo_price_hike_details(demo):
    f = next(f for f in demo.findings if f.code == "PRICE_HIKES")
    got = set(f.table["merchant"])
    assert {"Netflix", "Spotify", "Comcast Xfinity Internet"} <= got


def test_duplicate_is_best_buy(demo):
    f = next(f for f in demo.findings if f.code == "DUPLICATES")
    assert "Best Buy" in set(f.table["merchant"])


def test_semiannual_insurance_is_not_a_spike(demo):
    assert not any(f.code == "CATEGORY_SPIKE" and f.subject == "Insurance" for f in demo.findings)


def test_findings_sorted_by_severity(demo):
    order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
    idx = [order.index(f.severity) for f in demo.findings]
    assert idx == sorted(idx)


# --------------------------------------------------------- a boring, healthy life

def healthy_tx(months: int = 18, seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    start = pd.Timestamp("2024-01-01")
    bal = 8000.0
    for m in pd.date_range(start, periods=months, freq="MS"):
        rows.append((m + pd.Timedelta(days=0), "EMPLOYER PAYROLL DIR DEP", 3000.0))
        rows.append((m + pd.Timedelta(days=14), "EMPLOYER PAYROLL DIR DEP", 3000.0))
        rows.append((m + pd.Timedelta(days=2), "RENT PAYMENT PROPERTY MGMT", -1600.0))
        rows.append((m + pd.Timedelta(days=9), "CITY ELECTRIC", -round(rng.uniform(70, 90), 2)))
        rows.append((m + pd.Timedelta(days=11), "NETFLIX.COM", -15.49))
        rows.append((m + pd.Timedelta(days=20), "ONLINE TRANSFER TO SAVINGS", -800.0))
        for d in range(0, 28, 4):
            rows.append((m + pd.Timedelta(days=d + 1), "TRADER JOE'S", -round(rng.uniform(45, 70), 2)))
        for d in range(3, 28, 9):
            rows.append((m + pd.Timedelta(days=d), "CHIPOTLE", -round(rng.uniform(11, 16), 2)))
    df = pd.DataFrame(rows, columns=["date", "description", "amount"]).sort_values("date")
    df["balance"] = bal + df["amount"].cumsum()
    df["category"] = ""
    df["account"] = "Checking"
    df["source"] = "healthy.csv"
    return categorize.enrich(df.reset_index(drop=True))


def test_healthy_life_is_quiet():
    tx = healthy_tx()
    an = analyze(tx, None, None, 500.0)
    assert an.ctx.errors == []
    sev = [f.severity for f in an.findings]
    assert "CRITICAL" not in sev and "HIGH" not in sev, [(f.severity, f.title) for f in an.findings]
    score, label = an.threat
    assert score < 15, (score, [(f.severity, f.title) for f in an.findings])


def test_tiny_dataset_does_not_crash():
    rows = [("2025-03-03", "COFFEE", -4.0), ("2025-03-04", "PAYROLL DIR DEP", 1000.0), ("2025-03-05", "GROCERY", -50.0)]
    df = pd.DataFrame(rows, columns=["date", "description", "amount"])
    df["date"] = pd.to_datetime(df["date"])
    for c, v in (("category", ""), ("account", "a"), ("balance", float("nan")), ("source", "s")):
        df[c] = v
    an = analyze(categorize.enrich(df), None, None, 500.0)
    assert an.ctx.errors == []


# ----------------------------------------------------------------- building blocks

def test_recurring_detects_monthly_with_hike():
    dates = pd.date_range("2024-01-05", periods=14, freq="MS") + pd.Timedelta(days=4)
    amts = [-15.49] * 8 + [-17.99] * 6
    df = pd.DataFrame({"date": dates, "description": "NETFLIX.COM", "amount": amts})
    for c, v in (("category", ""), ("account", "a"), ("balance", float("nan")), ("source", "s")):
        df[c] = v
    L = A.build_ledger(categorize.enrich(df))
    r = A.find_recurring(L)
    assert len(r) == 1
    s = r.iloc[0]
    assert s["cadence"] == "monthly" and s["fixed_amount"]
    assert s["prior_amount"] == pytest.approx(15.49) and s["last_amount"] == pytest.approx(17.99)


def test_robust_trend_ignores_one_spike():
    y = pd.Series([100, 102, 101, 103, 99, 900, 100, 101, 102, 100], dtype=float)
    tr = A.robust_trend(y)
    assert abs(tr["slope"]) < 2
    assert tr["z"] < 1.64


def test_partial_months_flagged():
    df = pd.DataFrame({"date": pd.to_datetime(["2025-01-20", "2025-02-10", "2025-03-05", "2025-03-30"]),
                       "description": "X", "amount": -1.0})
    for c, v in (("category", ""), ("account", "a"), ("balance", float("nan")), ("source", "s")):
        df[c] = v
    L = A.build_ledger(categorize.enrich(df))
    assert L.full_months == [pd.Timestamp("2025-02-01"), pd.Timestamp("2025-03-01")]


def test_card_only_export_skips_income_logic():
    p = SAMPLE / "credit_card_export.csv"
    loaded = load([FileSpec(p.name, p.read_bytes())])
    an = analyze(loaded.tx, None, None, 500.0)
    got = codes(an)
    assert "NO_INCOME" in got
    assert not got & {"DEFICIT_STREAK", "NEG_SAVINGS", "CRUNCH_WINDOW", "OUTPACING"}
    assert an.ctx.balance_mode == "relative"
    assert an.ctx.errors == []
