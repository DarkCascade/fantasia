"""NEON//LEDGER - local-only cash-flow forensics console.

    streamlit run app.py          (or ./run.sh / run.bat)

Everything runs on this machine. CSVs you upload are parsed in memory by this
process; nothing is sent anywhere. See README.md for the privacy details and
.streamlit/config.toml for the settings that enforce them.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

from neon_ledger import analytics as A
from neon_ledger import categorize, charts as C, detectors as D, ingest, theme as T
from neon_ledger.pipeline import FileSpec, analyze, load

HERE = Path(__file__).resolve().parent
SAMPLE = HERE / "sample_data"
USER = HERE / "user_data"  # gitignored: budgets/rules you choose to save live here

st.set_page_config(page_title="NEON//LEDGER", page_icon="◈", layout="wide", initial_sidebar_state="expanded")

PLOTLY_CONFIG = {"displaylogo": False, "scrollZoom": False, "modeBarButtonsToRemove": ["lasso2d", "select2d", "autoScale2d"],
                 "toImageButtonOptions": {"format": "png", "scale": 2, "filename": "neon-ledger"}}

# Belt and braces: the local-only guarantees live in .streamlit/config.toml. Current
# Streamlit picks that up next to app.py, but older versions only read the launch
# folder, and env vars / CLI flags override it. Check the live values; say so loudly.
_addr = str(st.get_option("server.address") or "")
_leaky = [msg for bad, msg in (
    (_addr not in ("127.0.0.1", "localhost", "::1"), f"server.address is '{_addr or 'all interfaces'}' - other machines on your network may be able to reach this app"),
    (bool(st.get_option("browser.gatherUsageStats")), "browser.gatherUsageStats is on - Streamlit may send anonymous usage stats"),
) if bad]

ss = st.session_state
for k, v in {"demo": False, "overrides": {}, "budgets_df": None, "rules_df": None, "booted_for": None}.items():
    ss.setdefault(k, v)


def show(fig, key: str) -> None:
    st.plotly_chart(fig, theme=None, key=key, config=PLOTLY_CONFIG)


def html(s: str) -> None:
    if s:  # st.html refuses an empty body (FX OFF renders no background layer)
        st.html(s)


def usd(x, cents=False) -> str:
    return D.usd(x, cents)


# ============================================================================ loading

@st.cache_data(show_spinner=False, max_entries=8)
def cached_load(spec_key: tuple, dedupe: bool, recat: bool):
    specs = [FileSpec(name, data, json.loads(mp) if mp else None, flip, dayfirst) for name, data, mp, flip, dayfirst in spec_key]
    return load(specs, dedupe=dedupe, recategorize=recat)


@st.cache_data(show_spinner=False, max_entries=8)
def cached_analyze(tx: pd.DataFrame, budgets: pd.DataFrame | None, start_bal: float | None, low: float):
    return analyze(tx, budgets, start_bal, low)


def read_local(path_str: str) -> tuple[list[tuple[str, bytes]], str | None]:
    if not path_str.strip():
        return [], None
    p = Path(path_str.strip()).expanduser()
    if p.is_dir():
        files = sorted([*p.glob("*.csv"), *p.glob("*.CSV")])
        if not files:
            return [], f"No .csv files in {p}"
        return [(f.name, f.read_bytes()) for f in files], None
    if p.is_file():
        return [(p.name, p.read_bytes())], None
    return [], f"Not found: {p}"


def user_file(name: str) -> Path:
    USER.mkdir(exist_ok=True)
    return USER / name


def saved_budgets() -> pd.DataFrame | None:
    p = USER / "budgets.csv"
    if p.exists():
        try:
            return ingest.load_budgets(p.read_bytes())
        except Exception:
            return None
    return None


def saved_rules() -> pd.DataFrame:
    p = USER / "rules.csv"
    if p.exists():
        try:
            df = pd.read_csv(p, dtype=str, keep_default_na=False)
            if {"pattern", "category"} <= set(df.columns):
                return df[["pattern", "category"]]
        except Exception:
            pass
    return pd.DataFrame({"pattern": pd.Series(dtype=str), "category": pd.Series(dtype=str)})


if ss.rules_df is None:
    ss.rules_df = saved_rules()

# ============================================================================ sidebar

with st.sidebar:
    html(T.section("◈ 01", "Data link"))
    uploads = st.file_uploader("Transaction CSVs", type=["csv", "txt", "tsv"], accept_multiple_files=True,
                               help="Any bank/card export. Drop several at once (checking + cards) - overlapping rows between files are de-duplicated. "
                                    "Files are read into this local process's memory only.")
    c1, c2 = st.columns(2)
    if c1.button("◉ Demo", width="stretch", help="Load the synthetic sample (26 months, problems planted on purpose)."):
        ss.demo = True
    if c2.button("✕ Clear", width="stretch"):
        ss.demo = False
        ss.overrides = {}
        ss.budgets_df = None
    local_path = st.text_input("…or a local file / folder path", placeholder="~/Documents/statements",
                               help="Read CSVs straight from disk - handy for big folders of statements.")
    budget_up = st.file_uploader("Budget CSV (optional)", type=["csv"], help="Two columns: category, monthly budget. Without one, your own median month becomes the baseline.")

    html(T.section("◈ 02", "Sensors"))
    fx = st.segmented_control("Visual FX", ["MAX", "TAME", "OFF"], default="MAX", key="fx",
                              help="MAX: code rain, scanlines, glitch. TAME: glow, no motion. OFF: plain dark.") or "MAX"
    know_bal = st.toggle("I know my starting balance", value=False,
                         help="Only needed when your export has no Balance column. Anchors the cash-position line so low-balance and overdraft forecasts can run.")
    start_bal = st.number_input("Balance on the first day of the data ($)", value=0.0, step=100.0, disabled=not know_bal) if know_bal else None
    low_bal = st.number_input("Low-balance alarm floor ($)", value=500.0, step=50.0, min_value=0.0)
    with st.expander("Ingest options"):
        dayfirst = {"Auto-detect": None, "Month first (12/31)": False, "Day first (31/12)": True}[
            st.selectbox("Date order", ["Auto-detect", "Month first (12/31)", "Day first (31/12)"],
                         help="Auto looks for a day above 12 to decide; files where every day is 12 or under default to month-first.")]
        dedupe = st.toggle("De-duplicate overlapping files", value=True)
        recat = st.toggle("Ignore file categories; use NEON rules", value=False,
                          help="Re-categorise everything with the built-in keyword rules (your override rules still apply on top).")

# ------------------------------------------------------------------ gather files
raw_files: list[tuple[str, bytes]] = []
if uploads:
    raw_files += [(u.name, u.getvalue()) for u in uploads]
lp_files, lp_err = read_local(local_path)
raw_files += lp_files
if ss.demo:
    raw_files += [(p.name, p.read_bytes()) for p in sorted(SAMPLE.glob("*_export.csv"))]

spec_key = tuple(
    (name, data, json.dumps(ss.overrides.get(name, {}).get("mapping")) if ss.overrides.get(name, {}).get("mapping") else "",
     ss.overrides.get(name, {}).get("flip"), dayfirst)
    for name, data in raw_files
)

# ============================================================================ page chrome

html(T.page_css(fx))
html(T.fx_layers(fx))

n_files = len(raw_files)
loaded = cached_load(spec_key, dedupe, recat) if raw_files else None
tx_all = categorize.apply_user_rules(loaded.tx, ss.rules_df) if loaded is not None else None
has_data = tx_all is not None and len(tx_all) > 0

chips = [("LOCAL MODE · SEALED", T.GREEN) if not _leaky else ("LOCAL MODE · UNSEALED", T.RED),
         ("NETWORK: NONE", T.CYAN),
         ("TELEMETRY: OFF", T.MAGENTA) if st.get_option("browser.gatherUsageStats") is False else ("TELEMETRY: ON", T.RED)]
if has_data:
    chips.append((f"{len(tx_all):,} TX · {n_files} FILE{'S' if n_files != 1 else ''}", T.AMBER))
html(T.header("> financial pre-crime division :: cash-flow forensics console :: all processing on this machine", chips))

for msg in _leaky:
    st.error(f"⚠ Not sealed: {msg}. Launch with ./run.sh (or run.bat), or `streamlit run app.py` from inside the neon-ledger folder "
             "without overriding flags, so .streamlit/config.toml applies.")
if lp_err:
    st.warning(lp_err)
if loaded is not None:
    for e in loaded.errors:
        st.error(f"Ingest failure — {e}. Open DATA VAULT › Ingest diagnostics to remap columns.")

# ============================================================================ empty state

if not has_data:
    html('<div class="nl-await"><div class="big">AWAITING DATA LINK</div><div class="ring"></div></div>')
    c1, c2, c3 = st.columns([1, 1.2, 1])
    with c2:
        if st.button("◉ Initiate demo sequence", type="primary", width="stretch"):
            ss.demo = True
            st.rerun()
    html(T.panel("""
<h4>// FEED ME A CSV</h4>
Drop one or more exports in the <b>DATA LINK</b> panel (left). Any bank or card export works — the ingest engine sniffs the
delimiter, skips preamble lines, and auto-maps columns. Expected shapes:
<pre>Date,Description,Amount                      # signed: negative = money out
Date,Description,Debit,Credit                # split columns
Date,Description,Amount,Type                 # unsigned + DEBIT/CREDIT
Posting Date,Description,Amount,Balance      # running balance unlocks cash forecasting
Date,Description,Category,Amount,Account     # your own categories are kept</pre>
Card exports where purchases are <i>positive</i> are detected and flipped automatically (override in DATA VAULT).
Add a budget file (<code>category,monthly_budget</code>) or let your own median month act as the baseline.<br><br>
<b style="color:#00FF9C">Privacy:</b> this app has no network code. Streamlit is bound to 127.0.0.1 with telemetry disabled; the fonts are
served from the local <code>static/</code> folder. Nothing you load leaves this computer.
"""))
    st.stop()

# ============================================================================ filters (need data first)

all_min, all_max = tx_all["date"].min().date(), tx_all["date"].max().date()
with st.sidebar:
    html(T.section("◈ 03", "Scope"))
    if all_min < all_max:
        rng = st.slider("Date window", min_value=all_min, max_value=all_max, value=(all_min, all_max), format="YYYY-MM-DD",
                        help="Detectors need history - the default (everything) finds the most.")
    else:
        rng = (all_min, all_max)
    accts = sorted(tx_all["account"].unique())
    pick_accts = st.multiselect("Accounts", accts, default=accts) if len(accts) > 1 else accts
    cats_all = sorted(tx_all.loc[tx_all["kind"] != "transfer", "category"].unique())
    excl = st.multiselect("Exclude categories", cats_all, default=[], help="e.g. drop Housing to see what's left to optimise.")
    html(T.readout("Nothing leaves this machine. Close the tab and it's gone - unless you hit a SAVE button, which writes to <b>./user_data</b>."))

tx = tx_all[(tx_all["date"].dt.date >= rng[0]) & (tx_all["date"].dt.date <= rng[1]) & tx_all["account"].isin(pick_accts) & ~tx_all["category"].isin(excl)]
if tx.empty:
    st.warning("The current scope filters out every transaction.")
    st.stop()

# ------------------------------------------------------------------ budgets
if ss.budgets_df is not None:
    budgets, bud_src = ss.budgets_df, "edited in this session"
elif budget_up is not None:
    budgets, bud_src = ingest.load_budgets(budget_up.getvalue()), f"file: {budget_up.name}"
elif saved_budgets() is not None:
    budgets, bud_src = saved_budgets(), "user_data/budgets.csv"
elif ss.demo and (SAMPLE / "budgets.csv").exists() and not uploads and not lp_files:
    budgets, bud_src = ingest.load_budgets((SAMPLE / "budgets.csv").read_bytes()), "demo budgets.csv"
else:
    budgets, bud_src = None, "inferred baseline (your median full month per category)"

with st.spinner("Precogs dreaming…"):
    an = cached_analyze(tx, budgets, start_bal, float(low_bal))
L, ctx, findings = an.L, an.ctx, an.findings
ms, cm = ctx.ms, ctx.cm
ranked = A.top_categories(L, 8)
cmap = C.category_colors(ranked)
full = ctx.full
daily = A.daily(L)

sig = hashlib.md5(repr([(n, len(d)) for n, d in raw_files]).encode()).hexdigest()
if fx != "OFF" and ss.booted_for != sig:
    html(T.boot_overlay(len(tx), n_files, len([f for f in findings if f.severity != "INFO"]), len(categorize.RULES)))
    ss.booted_for = sig

# ============================================================================ ticker + KPIs

tick_items = [(f"{T.SEVERITY[f.severity]['icon']} {f.severity} :: {f.title}", T.SEVERITY[f.severity]["color"]) for f in findings if f.severity != "INFO"][:14]
html(T.ticker(tick_items))


def kpis() -> str:
    tiles = []
    last = full.iloc[-1] if len(full) else ms.iloc[-1]
    last_lbl = full.index[-1].strftime("%b %Y") if len(full) else ms.index[-1].strftime("%b %Y")
    avg6 = full["net"].tail(7).iloc[:-1].mean() if len(full) > 1 else np.nan
    d = last["net"] - avg6 if avg6 == avg6 else None
    tiles.append(T.kpi(f"Net · {last_lbl}", usd(last["net"]), T.GREEN if last["net"] >= 0 else T.RED,
                       sub="vs 6-mo avg", delta=(f"{'+' if d >= 0 else '-'}{usd(abs(d))}" if d is not None else None), good=(d >= 0) if d is not None else None,
                       spark=full["net"].tail(12).values if len(full) else None, delay=0.0))
    inc3 = full["income"].tail(3).mean() if len(full) else ms["income"].mean()
    sp3 = full["spend"].tail(3).mean() if len(full) else ms["spend"].mean()
    tiles.append(T.kpi("Income · 3-mo avg", usd(inc3), T.GREEN, sub="per month", spark=full["income"].tail(12).values if len(full) else None, delay=0.05))
    tiles.append(T.kpi("Spending · 3-mo avg", usd(sp3), T.MAGENTA, sub="per month", spark=full["spend"].tail(12).values if len(full) else None, delay=0.1))
    sr = (full["net"].tail(3).sum() / full["income"].tail(3).sum()) if len(full) and full["income"].tail(3).sum() > 0 and ctx.has_income else np.nan
    tiles.append(T.kpi("Savings rate · 3 mo", f"{sr:.0%}" if sr == sr else "—", T.CYAN if sr == sr and sr >= 0.1 else T.AMBER if sr == sr and sr >= 0 else T.RED,
                       sub="net ÷ income" if ctx.has_income else "no income in this data", spark=full["savings_rate"].tail(12).fillna(0).values if len(full) and ctx.has_income else None, delay=0.15))
    bal_now = float(ctx.balance.iloc[-1])
    me = ctx.balance.resample("ME").last().tail(12)
    lbl = {"reported": "Cash on hand", "estimated": "Cash (estimated)", "relative": "Cum. net since start"}[ctx.balance_mode]
    tiles.append(T.kpi(lbl, usd(bal_now), T.BLUE if bal_now >= low_bal else T.RED, sub=f"as of {L.end:%b %d}", spark=me.values, delay=0.2))
    burn = -full["net"].tail(3).mean() if len(full) >= 3 else np.nan
    if burn == burn and burn > 0 and ctx.balance_known and bal_now > 0:
        tiles.append(T.kpi("Runway", f"{bal_now / burn:.1f} mo", T.RED if bal_now / burn < 3 else T.AMBER, sub=f"burning {usd(burn)}/mo", delay=0.25))
    elif burn == burn and burn > 0:
        tiles.append(T.kpi("Burn rate", usd(burn), T.RED, sub="avg monthly deficit", delay=0.25))
    else:
        tiles.append(T.kpi("Surplus", usd(-burn) if burn == burn else "—", T.GREEN, sub="avg monthly, last 3", delay=0.25))
    r = ctx.rec_out
    fixed = float(r[A.is_bill(r) & r["active"]]["monthly_cost"].sum()) if not r.empty else 0.0
    n_bills = int((A.is_bill(r) & r["active"]).sum()) if not r.empty else 0
    tiles.append(T.kpi("Committed / mo", usd(fixed), T.AMBER, sub=f"{n_bills} recurring bills", delay=0.3))
    if L.current_is_partial and not ctx.pace.empty:
        proj = float(ctx.pace["projected"].sum())
        typ = float(ctx.pace["typical_month"].sum())
        tiles.append(T.kpi(f"{L.current_month:%b} pace", usd(proj), T.MAGENTA if proj > typ * 1.1 else T.CYAN,
                           sub=f"projected · typical {usd(typ)}", delta=f"{proj / typ - 1:+.0%}" if typ else None, good=(proj <= typ) if typ else None, delay=0.35))
    crit = sum(f.severity == "CRITICAL" for f in findings)
    high = sum(f.severity == "HIGH" for f in findings)
    tiles.append(T.kpi("Open case files", str(len([f for f in findings if f.severity != 'INFO'])), T.SEVERITY["CRITICAL"]["color"] if crit else T.SEVERITY["HIGH"]["color"] if high else T.GREEN,
                       sub=f"{crit} critical · {high} high", delay=0.4))
    return T.kpi_row(tiles)


html(kpis())

# ============================================================================ tabs

TABS = ["◈ Command deck", "⚠ Pre-crime", "⇄ Flow matrix", "◐ Spend spectrum", "▦ Budget grid",
        "◷ Temporal scan", "↻ Recurrence", "◎ Merchant intel", "◭ Precog", "▤ Data vault"]
tabs = st.tabs(TABS, key="nav", on_change="rerun")


def period_months(choice: str) -> list[pd.Timestamp]:
    fm = L.full_months or L.months
    return {"Last month": fm[-1:], "Last 3": fm[-3:], "Last 6": fm[-6:], "Last 12": fm[-12:], "All": L.months}[choice]


# ---------------------------------------------------------------- 1 COMMAND DECK
def tab_command():
    html(T.section("SECTOR 01", "Command deck", "the whole picture at a glance"))
    c1, c2 = st.columns([1, 2.2])
    with c1:
        show(C.threat_gauge(*an.threat), "gauge")
        html(T.readout("Threat index = weighted count of open case files (critical 22, high 11, medium 5, low 2). <b>Above 35</b> means several real problems at once."))
    with c2:
        show(C.cashflow_bars(ms, L), "cf")
        html(T.readout("Green = income, magenta = spending, cyan line = what's left. Faded bars are <b>partial months</b> (excluded from trends). Red dots are deficit months."))
    show(C.balance_chart(ctx.balance, ctx.balance_mode, low_bal, ctx.forecast), "bal")
    msg = {"reported": "from the running balance in your export", "estimated": "starting balance + every inflow and outflow (transfers excluded)",
           "relative": "no starting balance known, so this is <b>cumulative net from zero</b> - set one in SENSORS to unlock overdraft forecasting"}[ctx.balance_mode]
    html(T.readout(f"Cash line {msg}. Dotted magenta = 90-day precog with its 80% band; amber dash = your alarm floor."))
    c1, c2 = st.columns([1.3, 1])
    with c1:
        opts = list(reversed(L.months))
        m = st.selectbox("Waterfall month", opts, index=1 if len(opts) > 1 and L.current_is_partial else 0, format_func=lambda d: d.strftime("%B %Y"), key="wf_m")
        show(C.waterfall(L, m, cmap), "wf")
    with c2:
        html(T.section("▲", "Top case files"))
        for i, f in enumerate([f for f in findings if f.severity != "INFO"][:5]):
            html(T.case_file(f, i, f.impact_text, D.MODULES[f.module]))
        html(T.readout("Full list with evidence in <b>PRE-CRIME</b>."))


# ---------------------------------------------------------------- 2 PRE-CRIME
def tab_precrime():
    html(T.section("SECTOR 02", "Pre-crime division", f"{len(findings)} case files from {len(D.DETECTORS)} detectors"))
    c1, c2 = st.columns([1, 1.4])
    with c1:
        show(C.findings_matrix(findings), "fmat")
    with c2:
        show(C.findings_impact(findings), "fimp")
    c1, c2 = st.columns([1.2, 1])
    sevs = c1.pills("Severity", D.SEV_ORDER, selection_mode="multi", default=["CRITICAL", "HIGH", "MEDIUM", "LOW"], key="sev_pick")
    mods = c2.multiselect("Division", list(D.MODULES.values()), default=[], key="mod_pick", placeholder="all divisions")
    shown = [f for f in findings if f.severity in (sevs or D.SEV_ORDER) and (not mods or D.MODULES[f.module] in mods)]
    if not shown:
        st.info("No case files match the filters.")
    for i, f in enumerate(shown):
        html(T.case_file(f, i, f.impact_text, D.MODULES[f.module]))
        ev = C.evidence(f)
        if ev is not None or (f.table is not None and len(f.table)):
            with st.expander(f"◌ Evidence · case {i + 1:04d}"):
                if ev is not None:
                    show(ev, f"ev_{i}_{f.code}")
                if f.table is not None and len(f.table):
                    st.dataframe(pretty(f.table), hide_index=True, width="stretch")
    if ctx.errors:
        with st.expander(f"⚙ {len(ctx.errors)} detector fault(s)"):
            for e in ctx.errors:
                st.code(e)


def pretty(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].dt.strftime("%Y-%m-%d")
        elif pd.api.types.is_float_dtype(out[c]):
            if any(k in c for k in ("pct", "change")):
                out[c] = out[c].map(lambda v: f"{v:+.1%}" if v == v else "")
            elif c in ("z", "amount_cv"):
                out[c] = out[c].map(lambda v: f"{v:.2f}")
            else:
                out[c] = out[c].map(lambda v: f"${v:,.2f}" if v == v else "")
    return out


# ---------------------------------------------------------------- 3 FLOW MATRIX
def tab_flow():
    html(T.section("SECTOR 03", "Flow matrix", "income → pool → categories → merchants"))
    per = st.segmented_control("Window", ["Last month", "Last 3", "Last 6", "Last 12", "All"], default="Last 3", key="flow_per") or "Last 3"
    months = period_months(per)
    show(C.sankey(L, months, cmap), "sankey")
    html(T.readout("Band width = dollars. A red <b>DEFICIT</b> source means spending exceeded income in the window and was funded from savings or debt; a green <b>KEPT</b> sink is what you saved."))
    c1, c2 = st.columns(2)
    with c1:
        show(C.net_bars(ms, L), "netbars")
    with c2:
        show(C.cum_net(ms), "cumnet")
    c1, c2 = st.columns(2)
    with c1:
        show(C.dom_profile(A.dom_profile(L)), "dom")
        html(T.readout("Average month, day by day. Where magenta runs above green you're <b>spending money that hasn't arrived yet</b> - the red wedge is the cushion you need in checking."))
    with c2:
        show(C.weekly_net(daily), "weekly")
        html(T.readout("Weekly granularity shows the rhythm monthly totals hide: paycheck weeks vs. bill weeks."))


# ---------------------------------------------------------------- 4 SPEND SPECTRUM
def tab_spectrum():
    html(T.section("SECTOR 04", "Spend spectrum", "categories over time"))
    show(C.cat_area(cm, cmap, ranked, L), "area")
    c1, c2 = st.columns([1.4, 1])
    with c1:
        show(C.cat_share(cm, cmap, ranked), "share")
    with c2:
        show(C.mix_radar(cm, cmap, L, ranked), "radar")
    html(T.readout("Share and radar answer <b>'is my mix changing?'</b> - a category can grow in share while total spending stays flat."))
    c1, c2 = st.columns([1, 1.3])
    with c1:
        per = st.segmented_control("Orbit window", ["Last month", "Last 3", "Last 12", "All"], default="Last 3", key="sun_per") or "Last 3"
        show(C.sunburst(L, period_months(per), cmap), "sun")
    with c2:
        show(C.cat_heat(cm, L), "catheat")
        html(T.readout("Each row is scored against <b>its own</b> median and spread, so a $40 jump in a $60 category glows as bright as a $400 jump in rent."))
    show(C.small_multiples(cm, cmap, L), "small")
    c1, c2 = st.columns(2)
    with c1:
        show(C.bump(cm, cmap, ranked, L), "bump")
    with c2:
        show(C.race(cm, cmap, L), "race")
    show(C.terrain(cm, L), "terrain")
    html(T.readout("The terrain is the heat grid extruded: ridges are expensive months, a rising slope along a row is creep."))


# ---------------------------------------------------------------- 5 BUDGET GRID
def tab_budget():
    html(T.section("SECTOR 05", "Budget grid", f"source: {bud_src}"))
    if ctx.budgets_inferred:
        st.info("No budget loaded, so each category's **median full month** is its budget. Overruns here mean 'more than you usually spend'. "
                "Upload a budget CSV or edit the table below to set real targets.")
    show(C.budget_bullets(ctx.pace, ctx.budgets, L), "bullets")
    html(T.readout("Thin bar = spent so far, ghost bar = projected month-end (<b>so far + what you usually spend in the rest of a month</b> - additive, so rent paid on the 1st isn't extrapolated), frame = budget."))
    bf = A.budget_frame(L, ctx.budgets)
    show(C.budget_heat(bf), "bheat")
    c1, c2 = st.columns([1.3, 1])
    with c1:
        cats = list(ctx.budgets["category"])
        if cats:
            pick = st.selectbox("Inspect category", cats, key="bud_cat")
            show(C.budget_line(bf, pick, cmap), "bline")
    with c2:
        fb = bf[bf["full"]]
        last6 = sorted(fb["month"].unique())[-6:]
        lb = fb[fb["month"].isin(last6)].groupby("category").agg(budget=("budget", "first"), avg=("actual", "mean"),
                                                                  over_months=("over", lambda s: int((s > 0).sum())), worst=("pct", "max"))
        lb["avg_pct"] = lb["avg"] / lb["budget"]
        lb = lb.sort_values("avg_pct", ascending=False).reset_index()
        html(T.section("▦", "Overrun leaderboard", "last 6 full months"))
        st.dataframe(lb, hide_index=True, width="stretch", column_order=["category", "avg_pct", "avg", "budget", "over_months"], column_config={
            "category": "Category", "budget": st.column_config.NumberColumn("Budget", format="dollar"),
            "avg": st.column_config.NumberColumn("Avg actual", format="dollar"),
            "avg_pct": st.column_config.ProgressColumn("Avg % used", min_value=0.0, max_value=2.0, format="percent"),
            "over_months": st.column_config.NumberColumn("Months over"), "worst": st.column_config.NumberColumn("Worst month", format="percent")})
    html(T.section("✎", "Budget editor"))
    with st.form("bud_form"):
        ed = st.data_editor(ctx.budgets, num_rows="dynamic", hide_index=True, width="stretch", key="bud_editor",
                            column_config={"category": st.column_config.SelectboxColumn("Category", options=sorted(set(cm.columns) | set(ctx.budgets["category"]))),
                                           "monthly_budget": st.column_config.NumberColumn("Monthly budget", format="dollar", min_value=0.0, step=10.0)})
        b1, b2, b3 = st.columns(3)
        apply = b1.form_submit_button("⟳ Apply", type="primary", width="stretch")
        save = b2.form_submit_button("⤓ Apply + save to disk", width="stretch")
        reset = b3.form_submit_button("↺ Reset to baseline", width="stretch")
    if apply or save:
        clean = ed.dropna().query("category != ''")
        ss.budgets_df = clean.reset_index(drop=True)
        if save:
            clean.rename(columns={"monthly_budget": "monthly budget"}).to_csv(user_file("budgets.csv"), index=False)
            st.toast("Budgets written to user_data/budgets.csv", icon="💾")
        st.rerun()
    if reset:
        ss.budgets_df = A.infer_budgets(L)
        st.rerun()
    st.download_button("⤓ Download budgets.csv", ctx.budgets.to_csv(index=False).encode(), "budgets.csv", "text/csv", key="bud_dl")


# ---------------------------------------------------------------- 6 TEMPORAL
def tab_temporal():
    html(T.section("SECTOR 06", "Temporal scan", "when you spend, not just what"))
    show(C.calendar(daily), "cal")
    c1, c2 = st.columns(2)
    with c1:
        show(C.dow_polar(L), "dow")
    with c2:
        show(C.seasonality(A.seasonality(ms, L)), "season")
    show(C.rolling(L), "rolling")
    html(T.readout("Log scale. Amber diamonds are days that broke out of the 30-day ±2σ band. Sustained drift of the magenta line is a change in <b>baseline</b>, not a one-off."))
    c1, c2 = st.columns(2)
    with c1:
        show(C.dow_week_heat(L), "dowheat")
    with c2:
        show(C.ticket_hist(L), "ticket")
        html(T.readout("If the magenta curve sits right of the cyan one, your typical purchase got bigger."))
    show(C.galaxy(L, cmap), "galaxy")


# ---------------------------------------------------------------- 7 RECURRENCE
def tab_recurring():
    r = ctx.rec_out
    html(T.section("SECTOR 07", "Recurrence scanner", "subscriptions, bills, habits"))
    if r.empty:
        st.info("No repeating charges found yet - recurrence needs at least 3 hits on a regular cadence (2 for yearly).")
        return
    bills = r[A.is_bill(r)]
    act = bills[bills["active"]]
    hikes = r[(r["change_pct"] > 0.015) & r["active"]]
    html(T.kpi_row([
        T.kpi("Active bills", str(len(act)), T.AMBER, sub=f"{len(r) - len(bills)} habits also repeat"),
        T.kpi("Committed / month", usd(act["monthly_cost"].sum()), T.MAGENTA, sub=f"{usd(act['annual_cost'].sum())} / year"),
        T.kpi("Price hikes", str(len(hikes)), T.RED if len(hikes) else T.GREEN, sub="on active streams"),
        T.kpi("Stopped", str(int((~r['active']).sum())), T.CYAN, sub="streams that went quiet"),
    ]))
    show(C.rec_timeline(r, cmap, L), "rectl")
    c1, c2 = st.columns(2)
    with c1:
        show(C.rec_load(r, L), "recload")
        html(T.readout("Every bill-like stream that was active in a month, at its monthly-equivalent cost. A staircase going up is <b>commitment creep</b>."))
    with c2:
        show(C.price_steps(r), "steps")
    html(T.section("↻", "Stream registry"))
    reg = r.assign(kind=np.where(A.is_bill(r), "bill", "habit"))[["merchant", "category", "kind", "cadence", "typical_amount", "monthly_cost", "annual_cost",
                                                                   "hits", "first", "last", "next_expected", "active", "total_change_pct", "amounts"]]
    st.dataframe(reg, hide_index=True, width="stretch", column_config={
        "typical_amount": st.column_config.NumberColumn("Typical", format="dollar"),
        "monthly_cost": st.column_config.NumberColumn("Per month", format="dollar"),
        "annual_cost": st.column_config.NumberColumn("Per year", format="dollar"),
        "first": st.column_config.DateColumn("Since", format="YYYY-MM-DD"), "last": st.column_config.DateColumn("Last", format="YYYY-MM-DD"),
        "next_expected": st.column_config.DateColumn("Next ≈", format="YYYY-MM-DD"),
        "total_change_pct": st.column_config.NumberColumn("Price drift", format="percent"),
        "amounts": st.column_config.LineChartColumn("Amount history"), "active": st.column_config.CheckboxColumn("Active")})
    up = r[r["active"] & A.is_bill(r) & (r["next_expected"] <= L.end + pd.Timedelta(days=45))].sort_values("next_expected")
    c1, c2 = st.columns(2)
    with c1:
        html(T.section("◷", "Due in the next 45 days"))
        st.dataframe(up[["next_expected", "merchant", "typical_amount", "cadence"]], hide_index=True, width="stretch", column_config={
            "next_expected": st.column_config.DateColumn("Due ≈", format="MMM DD"), "typical_amount": st.column_config.NumberColumn("Amount", format="dollar")})
    with c2:
        html(T.section("⇢", "Recurring income"))
        ri = ctx.rec_in
        if ri.empty:
            st.caption("No regular deposits detected.")
        else:
            st.dataframe(ri[["merchant", "cadence", "typical_amount", "monthly_cost", "last"]], hide_index=True, width="stretch", column_config={
                "typical_amount": st.column_config.NumberColumn("Typical", format="dollar"), "monthly_cost": st.column_config.NumberColumn("Per month", format="dollar"),
                "last": st.column_config.DateColumn("Last", format="YYYY-MM-DD")})


# ---------------------------------------------------------------- 8 MERCHANTS
def tab_merchants():
    html(T.section("SECTOR 08", "Merchant intel", "who gets your money"))
    per = st.segmented_control("Window", ["Last 3", "Last 6", "Last 12", "All"], default="Last 12", key="mer_per") or "Last 12"
    months = period_months(per)
    show(C.pareto(L, months), "pareto")
    c1, c2 = st.columns([1.2, 1])
    with c1:
        show(C.merchant_bubble(L, months, cmap), "bubble")
        html(T.readout("Top-right = frequent <b>and</b> expensive. Far right, low = habits (death by a thousand cuts). Top-left = rare big tickets."))
    with c2:
        show(C.merchant_heat(L), "mheat")
    show(C.new_merchants(L), "newm")
    t = L.tx[L.tx["month"].isin(months) & L.tx["kind"].isin(["expense", "refund"])]
    top = t.groupby("merchant").agg(category=("category", lambda s: s.mode().iat[0]), visits=("flow", "size"), total=("flow", "sum"), avg=("flow", "mean"),
                                    last=("date", "max")).sort_values("total", ascending=False).head(40)
    hist = L.tx[L.tx["kind"].isin(["expense", "refund"])].pivot_table(index="merchant", columns="month", values="flow", aggfunc="sum").reindex(columns=L.months).fillna(0)
    top["trend"] = [list(hist.loc[m].values[-12:]) if m in hist.index else [] for m in top.index]
    top["share"] = top["total"] / max(t["flow"].sum(), 1)
    html(T.section("◎", "Merchant dossier"))
    st.dataframe(top.reset_index(), hide_index=True, width="stretch", column_config={
        "total": st.column_config.NumberColumn("Total", format="dollar"), "avg": st.column_config.NumberColumn("Avg ticket", format="dollar"),
        "share": st.column_config.ProgressColumn("Share of spend", min_value=0.0, max_value=float(max(top["share"].max(), 0.01)), format="percent"),
        "last": st.column_config.DateColumn("Last seen", format="YYYY-MM-DD"), "trend": st.column_config.BarChartColumn("12-month trend")})


# ---------------------------------------------------------------- 9 PRECOG
def tab_precog():
    html(T.section("SECTOR 09", "Precog forecast", "where this is heading"))
    fc = ctx.forecast
    if fc is None or fc.empty:
        st.info("Not enough data to forecast.")
        return
    if ctx.balance_mode == "relative":
        st.warning("No balance column and no starting balance - the path below starts from **zero** and shows direction only. "
                   "Set a starting balance in SENSORS to forecast real overdraft risk.")
    c1, c2 = st.columns([2.3, 1])
    with c2:
        html(T.section("⚗", "What-if engine"))
        trim = st.slider("Trim discretionary spending", 0, 60, 0, 5, format="%d%%", key="wi_trim")
        r = ctx.rec_out
        subs = r[r["active"] & A.is_bill(r) & ~r["category"].isin(["Housing", "Utilities", "Insurance", "Taxes"])] if not r.empty else r
        cancel = st.multiselect("Cancel subscriptions", list(subs["merchant"]) if len(subs) else [], key="wi_cancel")
        extra = st.number_input("Extra income per month ($)", 0.0, step=100.0, key="wi_extra")
        hit = st.number_input("One-off expense ($)", 0.0, step=100.0, key="wi_hit")
        hit_day = st.slider("…lands on day", 1, len(fc), 30, key="wi_day")
    disc_daily = float(daily["discretionary"].tail(90).mean())
    sub_save = float(subs[subs["merchant"].isin(cancel)]["monthly_cost"].sum()) / A.AVG_MONTH_DAYS if len(subs) else 0.0
    per_day = disc_daily * trim / 100 + sub_save + extra / A.AVG_MONTH_DAYS
    days = np.arange(1, len(fc) + 1)
    adj = fc["expected"] + per_day * days - np.where(days >= hit_day, hit, 0.0)
    changed = bool(trim or cancel or extra or hit)
    with c1:
        show(C.forecast_cash(ctx.balance, fc, low_bal, ctx.balance_mode, adj if changed else None), "fccash")
    exp_min = float(fc["expected"].min())
    adj_min = float(adj.min())
    html(T.kpi_row([
        T.kpi("Daily burn (unscheduled)", usd(fc.attrs["burn"]), T.MAGENTA, sub="last 90 days, excl. recurring"),
        T.kpi("Low point · current course", usd(exp_min), T.RED if exp_min < 0 else T.AMBER if exp_min < low_bal else T.GREEN, sub=f"{fc['expected'].idxmin():%b %d}"),
        T.kpi("Low point · with changes", usd(adj_min) if changed else "—", T.GREEN if adj_min >= low_bal else T.AMBER, sub=f"+{usd(per_day * A.AVG_MONTH_DAYS)}/mo freed" if changed else "adjust the what-if engine"),
        T.kpi("Day 90", usd(float(adj.iloc[-1] if changed else fc['expected'].iloc[-1])), T.CYAN, sub=f"{fc.index[-1]:%b %d, %Y}"),
    ]))
    html(T.readout("Method: active recurring bills and paychecks land on their predicted dates; everything else is a flat daily burn from the last 90 days. "
                   "The band widens with √time from your day-to-day noise. It's a <b>projection of the current course</b>, not a prophecy."))
    show(C.forecast_months(ms, A.forecast_months(ms, L), L), "fcm")
    ev = fc[fc["scheduled"] != 0][["scheduled", "expected", "events"]].reset_index()
    if len(ev):
        html(T.section("◷", "Scheduled items on the horizon"))
        st.dataframe(ev, hide_index=True, width="stretch", column_config={
            "date": st.column_config.DateColumn("Date", format="ddd MMM DD"), "scheduled": st.column_config.NumberColumn("Net scheduled", format="dollar"),
            "expected": st.column_config.NumberColumn("Balance after", format="dollar"), "events": "Items"})


# ---------------------------------------------------------------- 10 DATA VAULT
def tab_vault():
    html(T.section("SECTOR 10", "Data vault", "raw records, ingest diagnostics, category rules"))
    c1, c2, c3 = st.columns([1.3, 1, 1])
    q = c1.text_input("Search description / merchant", key="dv_q", placeholder="e.g. amazon, /uber (eats)?/")
    kinds = c2.multiselect("Kind", ["expense", "income", "refund", "transfer"], default=["expense", "income", "refund", "transfer"], key="dv_kind")
    cats = c3.multiselect("Category", sorted(tx["category"].unique()), key="dv_cat", placeholder="all")
    v = tx[tx["kind"].isin(kinds)]
    if cats:
        v = v[v["category"].isin(cats)]
    if q.strip():
        text = v["description"].astype(str) + " " + v["merchant"].astype(str)
        if len(q) > 2 and q.startswith("/") and q.endswith("/"):
            try:
                v = v[text.str.contains(q[1:-1], case=False, regex=True)]
            except Exception:
                st.warning("Bad regex.")
        else:
            v = v[text.str.contains(q, case=False, regex=False)]
    v = v.sort_values("date", ascending=False)
    html(T.readout(f"<b>{len(v):,}</b> records · out {usd(v['flow'].clip(lower=0).sum())} · in {usd(v['inflow'].sum())}"))
    st.dataframe(v[["date", "merchant", "description", "category", "kind", "amount", "account", "source"]], hide_index=True, width="stretch", height=460,
                 column_config={"date": st.column_config.DateColumn("Date", format="YYYY-MM-DD"), "amount": st.column_config.NumberColumn("Amount", format="dollar")})
    st.download_button("⤓ Export these records (CSV)", v.drop(columns=[c for c in v.columns if c.startswith("_")]).to_csv(index=False).encode(),
                       "neon-ledger-export.csv", "text/csv", key="dv_dl")

    html(T.section("✎", "Category override rules"))
    html(T.readout("Rows whose description or merchant contains <b>pattern</b> (case-insensitive; wrap in /slashes/ for a regex) get <b>category</b>. "
                   "Later rules win. Use category <b>Transfer</b> to exclude internal moves, <b>Income</b> for deposits."))
    with st.form("rules_form"):
        known = sorted(set(tx_all["category"]) | {"Transfer", "Income"} | {c for c, _ in categorize.RULES})
        red = st.data_editor(ss.rules_df, num_rows="dynamic", hide_index=True, width="stretch", key="rules_editor",
                             column_config={"pattern": st.column_config.TextColumn("Pattern", required=True),
                                            "category": st.column_config.SelectboxColumn("Category", options=known, required=True)})
        b1, b2 = st.columns(2)
        ap = b1.form_submit_button("⟳ Apply rules", type="primary", width="stretch")
        sv = b2.form_submit_button("⤓ Apply + save to disk", width="stretch")
    if ap or sv:
        ss.rules_df = red.fillna("").query("pattern != '' and category != ''").reset_index(drop=True)
        if sv:
            ss.rules_df.to_csv(user_file("rules.csv"), index=False)
            st.toast("Rules written to user_data/rules.csv", icon="💾")
        st.rerun()

    html(T.section("⚙", "Ingest diagnostics"))
    if loaded.removed_dupes:
        st.caption(f"{loaded.removed_dupes} row(s) appeared in more than one file and were de-duplicated.")
    fields = ["date", "description", "amount", "debit", "credit", "category", "account", "balance", "type_col"]
    for rep in loaded.reports:
        with st.expander(f"◈ {rep.source} — {rep.rows_kept:,} of {rep.rows_read:,} rows kept"):
            st.markdown(f"- Delimiter `{rep.delimiter!r}`, header on line {rep.header_row + 1}{', European decimals' if rep.european_decimals else ''}\n"
                        f"- Sign: {rep.sign_reason}\n" + "".join(f"- {n}\n" for n in rep.notes))
            cols = ["(none)"] + loaded.columns.get(rep.source, [])
            with st.form(f"map_{rep.source}"):
                gc = st.columns(3)
                picks = {}
                for i, fld in enumerate(fields):
                    cur = rep.mapping.get(fld)
                    picks[fld] = gc[i % 3].selectbox(fld.replace("_col", "").title(), cols, index=cols.index(cur) if cur in cols else 0, key=f"m_{rep.source}_{fld}")
                flip = st.radio("Which sign is spending?", ["Auto", "Negative = spending", "Positive = spending"], horizontal=True,
                                index={None: 0, False: 1, True: 2}[ss.overrides.get(rep.source, {}).get("flip")], key=f"f_{rep.source}")
                if st.form_submit_button("⟳ Re-ingest with this mapping", type="primary"):
                    ss.overrides[rep.source] = {"mapping": {k: (None if v == "(none)" else v) for k, v in picks.items()},
                                                "flip": {"Auto": None, "Negative = spending": False, "Positive = spending": True}[flip]}
                    st.rerun()

    html(T.section("⛨", "Privacy ledger"))
    html(T.panel(f"""<h4>// WHAT THIS APP TOUCHES</h4>
Reads: the CSVs you upload or point it at, and <code>user_data/</code> if you've saved budgets/rules there.<br>
Writes: <code>user_data/budgets.csv</code> and <code>user_data/rules.csv</code> — only when you press a SAVE button. Downloads are generated in-page.<br>
Network: none. Streamlit listens on <code>127.0.0.1</code> only, usage stats are off, fonts come from <code>static/</code>.<br>
Session: {len(tx):,} transactions in memory · {len(findings)} findings · budgets from {T.esc(bud_src)}."""))


RENDER = [tab_command, tab_precrime, tab_flow, tab_spectrum, tab_budget, tab_temporal, tab_recurring, tab_merchants, tab_precog, tab_vault]
for tab, fn in zip(tabs, RENDER):
    if tab.open is None or tab.open:
        with tab:
            fn()
