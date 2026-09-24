"""Synthetic demo data with problems deliberately planted in it.

Run `python -m neon_ledger.sample_data` to regenerate sample_data/*.csv.

The two files imitate real exports on purpose, because the ingest code has to
cope with them:

  checking_export.csv     "Posting Date, Description, Amount, Type, Balance"
                          with a two-line preamble; money out is negative;
                          carries a running balance.
  credit_card_export.csv  "Date, Description, Card Member, Account #, Amount"
                          Amex-style: purchases are POSITIVE, payments negative.

Neither has a category column - the rule engine has to earn its keep.

What's hidden in here (so you can check the detectors find it):
  * dining creeping up ~4%/month for two years; coffee visits nearly tripling
  * Netflix, Spotify, Comcast and rent all raising prices at different times
  * new subscriptions stacking up in the last few months
  * an annual Amazon Prime renewal coming up, semiannual car insurance
  * a Best Buy charge billed twice, a duplicated Uber Eats order
  * overdraft + card interest + ATM + foreign-transaction fees
  * payday splurges, weekend drift, growing ATM cash and Venmo outflows
  * savings transfers that quietly stop; a side income that dries up
  * rent due on the 1st, paychecks on the 15th and last day -> a monthly
    cash crunch that eventually overdraws the account
  * a December shopping spike each year, a one-off car repair
"""

from __future__ import annotations

import calendar
from pathlib import Path

import numpy as np
import pandas as pd

START = pd.Timestamp("2024-07-01")
END = pd.Timestamp("2026-09-18")
SEED = 7


def _last_business_day(y: int, m: int) -> pd.Timestamp:
    d = pd.Timestamp(y, m, calendar.monthrange(y, m)[1])
    while d.dayofweek >= 5:
        d -= pd.Timedelta(days=1)
    return d


def _bday(d: pd.Timestamp) -> pd.Timestamp:
    while d.dayofweek >= 5:
        d -= pd.Timedelta(days=1)
    return d


def generate(seed: int = SEED) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    chk: list[tuple] = []   # (date, desc, amount)   negative = out
    card: list[tuple] = []  # (date, desc, amount)   positive = purchase
    months = pd.date_range(START, END, freq="MS")

    def within(d):
        return START <= d <= END

    for mi, m in enumerate(months):
        y, mo = m.year, m.month
        ndays = calendar.monthrange(y, mo)[1]
        progress = mi / max(1, len(months) - 1)

        # ---------------- income: semimonthly paycheck, raise in Mar 2025
        pay = 2160.0 if m < pd.Timestamp("2025-03-01") else 2300.0
        for d in (_bday(pd.Timestamp(y, mo, 15)), _last_business_day(y, mo)):
            if within(d):
                chk.append((d, "ACME ROBOTICS PAYROLL DIR DEP PPD ID: 99812", round(pay + rng.normal(0, 6), 2)))
        # side gig that dries up in 2026
        if m < pd.Timestamp("2026-02-01") and rng.random() < 0.8:
            d = m + pd.Timedelta(days=int(rng.integers(3, 26)))
            if within(d):
                chk.append((d, "UPWORK GLOBAL INC DIR DEP", round(rng.uniform(280, 900), 2)))

        # ---------------- fixed bills from checking
        rent = 1850.0 if m < pd.Timestamp("2025-08-01") else 1975.0
        if within(m):
            chk.append((m, "ZELLE PAYMENT TO OAKRIDGE APARTMENTS LLC", -rent))
        d = pd.Timestamp(y, mo, 12)
        if within(d):
            base = 95 + 70 * np.cos((mo - 1.5) / 12 * 2 * np.pi) ** 2 + (60 if mo in (7, 8) else 0)
            chk.append((d, "CITY POWER & LIGHT ELECTRIC BILL PAY", -round(base + rng.normal(0, 12), 2)))
        d = pd.Timestamp(y, mo, 18)
        if within(d):
            chk.append((d, "COMCAST XFINITY INTERNET", -(79.99 if m < pd.Timestamp("2025-11-01") else 89.99)))
        d = pd.Timestamp(y, mo, 22)
        if within(d):
            chk.append((d, "T-MOBILE AUTOPAY WIRELESS", -85.00))
        if mo in (2, 8):
            d = pd.Timestamp(y, mo, 9)
            if within(d):
                chk.append((d, "GEICO INSURANCE PREMIUM", -612.40 if y == 2024 else -655.80))
        # savings transfer that stops in March 2026
        d = pd.Timestamp(y, mo, 16)
        if within(d) and m < pd.Timestamp("2026-03-01"):
            chk.append((d, "ONLINE TRANSFER TO SAVINGS XXXXXX4412", -300.00))
        # ATM cash - growing
        n_atm = int(rng.poisson(1.2 + 2.3 * progress))
        for _ in range(n_atm):
            d = m + pd.Timedelta(days=int(rng.integers(0, ndays)))
            if within(d):
                amt = float(rng.choice([40, 60, 80, 100, 120]))
                chk.append((d, "ATM WITHDRAWAL 1200 MARKET ST", -amt))
                if rng.random() < 0.6:
                    chk.append((d, "NON-CHASE ATM FEE-WITH", -3.50))
        # Venmo - growing
        n_v = int(rng.poisson(1.5 + 3.5 * progress))
        for _ in range(n_v):
            d = m + pd.Timedelta(days=int(rng.integers(0, ndays)))
            if within(d):
                chk.append((d, "VENMO PAYMENT 10239988", -round(rng.uniform(12, 85), 2)))
        if rng.random() < 0.5:
            d = m + pd.Timedelta(days=int(rng.integers(0, ndays)))
            if within(d):
                chk.append((d, "VENMO CASHOUT", round(rng.uniform(15, 60), 2)))

        # ---------------- card: subscriptions
        subs = [
            (3, "NETFLIX.COM", 15.49 if m < pd.Timestamp("2025-10-01") else 17.99, None),
            (7, "SPOTIFY USA", 10.99 if m < pd.Timestamp("2025-06-01") else 11.99, None),
            (11, "APPLE.COM/BILL ICLOUD", 2.99, None),
            (14, "PLANET FITNESS CLUB FEES", 24.99, None),
            (20, "ADOBE *CREATIVE CLOUD", 59.99, pd.Timestamp("2025-02-01")),
            (5, "PELOTON INTERACTIVE MEMBERSHIP", 44.00, pd.Timestamp("2025-01-01")),
            (24, "OPENAI *CHATGPT SUBSCR", 20.00, pd.Timestamp("2026-06-01")),
            (26, "HULU 877-8244858", 9.99, pd.Timestamp("2026-07-01")),
            (2, "DISNEY PLUS", 15.99, pd.Timestamp("2026-08-01")),
            (17, "NYTIMES DIGITAL", 4.00 if m < pd.Timestamp("2025-07-01") else 25.00, pd.Timestamp("2025-01-01")),
        ]
        for day, desc, amt, since in subs:
            d = pd.Timestamp(y, mo, min(day, ndays))
            if within(d) and (since is None or m >= since):
                card.append((d, desc, amt))
        if mo == 2:
            d = pd.Timestamp(y, mo, 14)
            if within(d):
                card.append((d, "PLANET FITNESS ANNUAL FEE", 49.00))
        if mo == 11:
            d = pd.Timestamp(y, mo, 8)
            if within(d):
                card.append((d, "AMAZON PRIME*MEMBERSHIP", 139.00))

        # ---------------- card: variable spending
        for d in pd.date_range(m, m + pd.offsets.MonthEnd(0)):
            if not within(d):
                continue
            wk = d.dayofweek >= 5
            payday_glow = 1.0
            for pd_ in (_bday(pd.Timestamp(y, mo, 15)), _last_business_day(y, mo)):
                if 0 <= (d - pd_).days <= 2:
                    payday_glow = 2.8
            # dining creep ~4%/mo compounding, weekend-heavy, more weekend-heavy over time
            dine_rate = (0.22 + 0.33 * progress) * (1.0 + (0.8 + 0.9 * progress) * wk) * payday_glow
            for _ in range(rng.poisson(dine_rate)):
                place = rng.choice(["CHIPOTLE 1123", "TST* THE HOLLOW DINER", "SQ *NOODLE BAR", "SHAKE SHACK #221", "UBER EATS ORDER", "DOORDASH*THAI GARDEN", "SWEETGREEN MISSION"])
                amt = round(float(rng.lognormal(np.log(22 + 10 * progress), 0.35)), 2)
                card.append((d, str(place), amt))
            # coffee: frequency nearly triples
            for _ in range(rng.poisson(0.25 + 0.5 * progress)):
                card.append((d, str(rng.choice(["STARBUCKS STORE 08812", "SQ *BLUE BOTTLE COFFEE", "PEETS COFFEE #117"])), round(float(rng.uniform(4.25, 7.95)), 2)))
            # groceries steady
            if rng.random() < 0.26:
                card.append((d, str(rng.choice(["TRADER JOE'S #552", "SAFEWAY #1781", "WHOLE FOODS MKT 10234", "COSTCO WHSE #0421"])), round(float(rng.lognormal(np.log(58), 0.4)), 2)))
            # transport
            if rng.random() < 0.1:
                card.append((d, "SHELL OIL 57442", round(float(rng.uniform(38, 62)), 2)))
            if rng.random() < 0.07 + 0.08 * wk:
                card.append((d, "UBER *TRIP HELP.UBER.COM", round(float(rng.uniform(11, 34)), 2)))
            # shopping, with december spike + payday bump
            shop_rate = 0.12 * payday_glow * (2.6 if mo == 12 else 1.0) * (1 + 0.5 * progress) * (1 + 1.6 * progress * wk)
            for _ in range(rng.poisson(shop_rate)):
                card.append((d, str(rng.choice(["AMZN MKTP US*2K4LZ91", "TARGET 00012345", "AMAZON.COM*RT5GH1", "ETSY.COM - HANDMADE"])), round(float(rng.lognormal(np.log(42), 0.7)), 2)))
            # entertainment
            if rng.random() < (0.04 + 0.05 * wk * progress) * payday_glow:
                card.append((d, str(rng.choice(["AMC THEATRES 4410", "STEAMGAMES.COM 4259522", "TICKETMASTER"])), round(float(rng.uniform(14, 95)), 2)))
            if rng.random() < 0.015:
                card.append((d, "WALGREENS #3321", round(float(rng.uniform(9, 48)), 2)))
            if rng.random() < 0.012:
                card.append((d, "GREAT CLIPS BARBER", 28.00))

        # card interest once they start carrying a balance
        if m >= pd.Timestamp("2026-01-01"):
            d = pd.Timestamp(y, mo, 21)
            if within(d):
                card.append((d, "INTEREST CHARGE ON PURCHASES", round(18 + 6 * (m.month) + rng.normal(0, 3), 2)))

    # ---------------- one-offs
    card += [
        (pd.Timestamp("2025-12-19"), "DELTA AIR LINES 0062", 486.20),
        (pd.Timestamp("2025-12-21"), "HOTEL CASA DEL MAR LISBOA", 612.00),
        (pd.Timestamp("2025-12-21"), "FOREIGN TRANSACTION FEE", 18.36),
        (pd.Timestamp("2025-12-23"), "TST* TABERNA LISBOA", 88.40),
        (pd.Timestamp("2025-12-23"), "FOREIGN TRANSACTION FEE", 2.65),
        (pd.Timestamp("2026-04-11"), "MIDAS AUTO SERVICE #2231", 1240.55),
        (pd.Timestamp("2026-08-21"), "BEST BUY 00011865", 349.99),
        (pd.Timestamp("2026-08-22"), "BEST BUY 00011865", 349.99),
        (pd.Timestamp("2026-08-24"), "IKEA EAST PALO ALTO", 684.10),
        (pd.Timestamp("2026-08-24"), "WAYFAIR*FURNITURE", 412.75),
        (pd.Timestamp("2026-07-12"), "UBER EATS ORDER", 46.18),
        (pd.Timestamp("2026-07-12"), "UBER EATS ORDER", 46.18),
    ]

    chk.append((pd.Timestamp("2026-04-14"), "IRS USATAXPYMT 2025 BALANCE DUE", -1850.00))

    card_df = pd.DataFrame(card, columns=["date", "description", "amount"]).sort_values("date", kind="stable").reset_index(drop=True)

    # ---------------- card payments: pay last month's statement on the 25th
    card_df["stmt"] = card_df["date"].dt.to_period("M")
    stmt_tot = card_df.groupby("stmt")["amount"].sum()
    for per, tot in stmt_tot.items():
        pay_day = (per + 1).to_timestamp() + pd.Timedelta(days=24)
        if not within(pay_day):
            continue
        # From 2026 they can't pay in full - that's what the interest line is.
        paid = tot if pay_day < pd.Timestamp("2026-01-01") else round(tot * 0.82, 2)
        chk.append((pay_day, "AMEX EPAYMENT ACH PMT", -round(paid, 2)))
        card_df.loc[len(card_df)] = [pay_day, "AUTOPAY PAYMENT - THANK YOU", -round(paid, 2), per]

    # ---------------- checking: running balance, with overdraft fees where it goes negative
    chk_df = pd.DataFrame(chk, columns=["date", "description", "amount"]).sort_values(["date", "amount"], ascending=[True, False], kind="stable").reset_index(drop=True)
    rows, bal, od_months = [], 2650.0, set()
    for d, desc, amt in chk_df.itertuples(index=False):
        bal = round(bal + amt, 2)
        rows.append((d, desc, amt, bal))
        if bal < 0 and d.to_period("M") not in od_months:
            od_months.add(d.to_period("M"))
            bal = round(bal - 35.0, 2)
            rows.append((d, "OVERDRAFT FEE FOR A $%.2f ITEM" % abs(amt), -35.0, bal))

    checking = pd.DataFrame(rows, columns=["Posting Date", "Description", "Amount", "Balance"])
    checking.insert(3, "Type", np.where(checking["Amount"] < 0, "DEBIT", "CREDIT"))
    checking["Posting Date"] = checking["Posting Date"].dt.strftime("%m/%d/%Y")
    checking["Amount"] = checking["Amount"].map(lambda v: f"{v:.2f}")
    checking["Balance"] = checking["Balance"].map(lambda v: f"{v:.2f}")

    card_out = card_df.sort_values("date", kind="stable").reset_index(drop=True)
    cc = pd.DataFrame({
        "Date": card_out["date"].dt.strftime("%m/%d/%Y"),
        "Description": card_out["description"],
        "Card Member": "J RIVERA",
        "Account #": "-31009",
        "Amount": card_out["amount"].map(lambda v: f"{v:.2f}"),
    })

    budgets = pd.DataFrame({
        "Category": ["Housing", "Dining", "Groceries", "Shopping", "Utilities", "Subscriptions", "Transport", "Entertainment", "Health & Fitness", "Cash & ATM", "P2P Transfers", "Insurance"],
        "Monthly Budget": [2000, 350, 500, 250, 300, 120, 150, 80, 90, 100, 120, 220],
    })
    return checking, cc, budgets


def write(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    checking, cc, budgets = generate()
    with open(out_dir / "checking_export.csv", "w", newline="") as f:
        f.write("Account: EVERYDAY CHECKING ...4412\n")
        f.write(f"Statement range: {START:%m/%d/%Y} - {END:%m/%d/%Y}\n")
        checking.to_csv(f, index=False)
    cc.to_csv(out_dir / "credit_card_export.csv", index=False)
    budgets.to_csv(out_dir / "budgets.csv", index=False)


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent / "sample_data"
    write(here)
    print(f"wrote demo data to {here}")
