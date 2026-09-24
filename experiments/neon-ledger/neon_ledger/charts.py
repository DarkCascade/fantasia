"""Plotly figure factories, all dressed in the 'neon' template.

Rules these follow (from the data-viz checklist, bent only where neon demands):
  * one y-scale per chart - no dual axes; different units get their own chart
  * categories keep their colour everywhere (colour follows the entity, via
    `category_colors`), max 8 hues + grey 'Other'
  * legends whenever there are 2+ series; hover on everything
  * status colours (critical/high/...) are only ever used for status

Render with st.plotly_chart(fig, theme=None) or Streamlit's own theme will
paint over the template.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.io as pio
from plotly.subplots import make_subplots

from . import analytics as A
from .theme import (AMBER, BLUE, CATEGORICAL, CYAN, FONT_HEAD, FONT_MONO, GREEN, INCOME_C, INK, INK_DIM, INK_MUTED,
                    LIME, MAGENTA, NET_C, OTHER, RED, SEVERITY, SPEND_C, VIOLET, rgba)

GRID = "rgba(0,229,255,0.08)"
AXIS = "rgba(0,229,255,0.35)"
MONEY = dict(tickprefix="$", tickformat=",.0f")


def _register() -> None:
    axis = dict(automargin=True, gridcolor=GRID, zerolinecolor="rgba(0,229,255,0.30)", linecolor=AXIS, tickcolor=AXIS,
                tickfont=dict(color=INK_DIM, size=11), title=dict(font=dict(color=INK_DIM, size=11)),
                showspikes=True, spikecolor=CYAN, spikethickness=1, spikedash="dot", spikemode="across", spikesnap="cursor")
    t = go.layout.Template()
    t.layout = go.Layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family=FONT_MONO, color=INK, size=12),
        title=dict(font=dict(family=FONT_HEAD, size=13, color="#FFFFFF"), x=0.01, xanchor="left", y=0.98, yanchor="top"),
        colorway=CATEGORICAL,
        xaxis=axis, yaxis=axis,
        hoverlabel=dict(bgcolor="rgba(3,8,20,0.96)", bordercolor=CYAN, font=dict(family=FONT_MONO, color="#FFFFFF", size=12)),
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=11, color=INK_DIM), orientation="h", x=0, y=1.02, yanchor="bottom"),
        margin=dict(l=8, r=12, t=48, b=8),
        hovermode="x unified",
        polar=dict(bgcolor="rgba(0,0,0,0)", angularaxis=dict(gridcolor=GRID, linecolor=AXIS, tickfont=dict(color=INK_DIM)),
                   radialaxis=dict(gridcolor=GRID, linecolor=AXIS, tickfont=dict(color=INK_MUTED))),
        scene=dict(xaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(0,229,255,0.18)", color=INK_DIM, showbackground=False),
                   yaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(0,229,255,0.18)", color=INK_DIM, showbackground=False),
                   zaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,43,214,0.18)", color=INK_DIM, showbackground=False)),
    )
    pio.templates["neon"] = t


_register()


def _legend_rows(fig: go.Figure, width_px: int = 620) -> int:
    names = [t.name for t in fig.data if t.name and t.showlegend is not False and t.type not in ("indicator", "sankey", "sunburst", "surface", "heatmap")]
    if len(names) < 2 or fig.layout.showlegend is False:
        return 0
    used = sum(len(str(n)) * 7 + 44 for n in names)
    return int(np.ceil(used / width_px))


def base(fig: go.Figure, title: str | None = None, height: int = 360, **kw) -> go.Figure:
    fig.update_layout(template="neon", height=height, **kw)
    if title:
        fig.update_layout(title=dict(text=title.upper()))
    if "margin" not in kw:
        rows = _legend_rows(fig)
        top = (40 if title else 12) + 22 * rows + (8 if rows else 0)
        fig.update_layout(margin=dict(t=max(top, 24)))
    return fig


def empty(msg: str, height: int = 220) -> go.Figure:
    fig = go.Figure()
    fig.add_annotation(text=f"◌ {msg}", showarrow=False, font=dict(color=INK_DIM, family=FONT_MONO, size=13), x=0.5, y=0.5, xref="paper", yref="paper")
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return base(fig, height=height)


def glow_line(fig, x, y, color, name, width=2.2, dash=None, fill=None, showlegend=True, hovertemplate=None, shape="linear",
              row=None, col=None, fillcolor=None, legendgroup=None, customdata=None):
    kw = dict(row=row, col=col) if row else {}
    for w, a in ((12, 0.06), (6, 0.16)):
        fig.add_trace(go.Scatter(x=x, y=y, mode="lines", line=dict(color=rgba(color, a), width=w, shape=shape), hoverinfo="skip",
                                 showlegend=False, legendgroup=legendgroup or name), **kw)
    fig.add_trace(go.Scatter(x=x, y=y, mode="lines", name=name, line=dict(color=color, width=width, dash=dash, shape=shape),
                             fill=fill, fillcolor=fillcolor or rgba(color, 0.08), showlegend=showlegend,
                             legendgroup=legendgroup or name, hovertemplate=hovertemplate, customdata=customdata), **kw)
    return fig


def category_colors(ranked: list[str]) -> dict[str, str]:
    cmap = {c: CATEGORICAL[i] for i, c in enumerate(ranked[:len(CATEGORICAL)])}
    cmap["Other"] = OTHER
    return cmap


def color_of(cat: str, cmap: dict[str, str]) -> str:
    return cmap.get(cat, OTHER)


def fold(cm: pd.DataFrame, keep: list[str]) -> pd.DataFrame:
    kept = [c for c in keep if c in cm.columns]
    rest = [c for c in cm.columns if c not in kept]
    out = cm[kept].copy()
    if rest:
        out["Other"] = cm[rest].sum(axis=1)
    return out


def _partial_opacity(idx, L) -> list[float]:
    return [1.0 if m in L.full_months else 0.4 for m in idx]


# ======================================================================= COMMAND DECK

def threat_gauge(score: int, label: str) -> go.Figure:
    col = SEVERITY["LOW"]["color"] if score < 15 else SEVERITY["MEDIUM"]["color"] if score < 35 else SEVERITY["HIGH"]["color"] if score < 60 else SEVERITY["CRITICAL"]["color"]
    fig = go.Figure(go.Indicator(
        mode="gauge+number", value=score,
        number=dict(font=dict(family=FONT_HEAD, size=46, color="#fff"), suffix=""),
        title=dict(text=f"<span style='font-size:12px;letter-spacing:3px;color:{INK_DIM}'>THREAT INDEX · </span><span style='font-size:15px;color:{col}'>{label}</span>",
                   font=dict(family=FONT_HEAD)),
        domain=dict(x=[0, 1], y=[0, 0.9]),
        gauge=dict(
            axis=dict(range=[0, 100], tickcolor=AXIS, tickfont=dict(color=INK_MUTED, size=10), dtick=25),
            bar=dict(color=col, thickness=0.28, line=dict(color="#fff", width=1)),
            bgcolor="rgba(0,0,0,0)", borderwidth=1, bordercolor=AXIS,
            steps=[dict(range=[0, 15], color=rgba(SEVERITY["LOW"]["color"], .12)), dict(range=[15, 35], color=rgba(SEVERITY["MEDIUM"]["color"], .12)),
                   dict(range=[35, 60], color=rgba(SEVERITY["HIGH"]["color"], .14)), dict(range=[60, 100], color=rgba(SEVERITY["CRITICAL"]["color"], .16))],
            threshold=dict(line=dict(color="#fff", width=3), thickness=0.9, value=score),
        ),
    ))
    return base(fig, height=300, margin=dict(l=28, r=28, t=40, b=10))


def cashflow_bars(ms: pd.DataFrame, L) -> go.Figure:
    op = _partial_opacity(ms.index, L)
    fig = go.Figure()
    fig.add_bar(x=ms.index, y=ms["income"], name="Income", marker=dict(color=rgba(INCOME_C, .75), opacity=op, line=dict(color=INCOME_C, width=1)),
                hovertemplate="$%{y:,.0f}")
    fig.add_bar(x=ms.index, y=ms["spend"], name="Spending", marker=dict(color=rgba(SPEND_C, .7), opacity=op, line=dict(color=SPEND_C, width=1)),
                hovertemplate="$%{y:,.0f}")
    glow_line(fig, ms.index, ms["net"], CYAN, "Net", width=2.4, hovertemplate="$%{y:,.0f}")
    fig.add_trace(go.Scatter(x=ms.index, y=ms["net"], mode="markers", marker=dict(size=7, color=[CYAN if v >= 0 else RED for v in ms["net"]],
                             line=dict(color="#fff", width=1)), showlegend=False, hoverinfo="skip"))
    fig.add_hline(y=0, line=dict(color="rgba(255,255,255,.35)", width=1))
    fig.update_yaxes(**MONEY)
    fig.update_layout(barmode="group", bargap=0.25, bargroupgap=0.08)
    return base(fig, "Monthly cash flow · income vs spending", 380)


def balance_chart(bal: pd.Series, mode: str, low: float, fc: pd.DataFrame | None = None, show_fc: bool = True) -> go.Figure:
    fig = go.Figure()
    lbl = {"reported": "Balance (reported)", "estimated": "Balance (estimated)", "relative": "Cumulative net (no starting balance)"}[mode]
    glow_line(fig, bal.index, bal.values, CYAN, lbl, width=2.2, fill="tozeroy", fillcolor=rgba(CYAN, .07), hovertemplate="$%{y:,.0f}")
    neg = bal.where(bal < 0)
    if neg.notna().any():
        fig.add_trace(go.Scatter(x=bal.index, y=neg, mode="lines", line=dict(color=RED, width=2.4), fill="tozeroy",
                                 fillcolor=rgba(RED, .25), name="Below zero", hovertemplate="$%{y:,.0f}"))
    if fc is not None and show_fc and mode != "relative":
        fig.add_trace(go.Scatter(x=list(fc.index) + list(fc.index[::-1]), y=list(fc["high"]) + list(fc["low"][::-1]), fill="toself", mode="lines",
                                 fillcolor=rgba(MAGENTA, .10), line=dict(width=0), name="Forecast band (80%)", hoverinfo="skip"))
        glow_line(fig, fc.index, fc["expected"], MAGENTA, "Forecast", width=2, dash="dot", hovertemplate="$%{y:,.0f}")
    if mode != "relative":
        fig.add_hline(y=low, line=dict(color=AMBER, width=1, dash="dash"), annotation_text=f"floor ${low:,.0f}",
                      annotation_font=dict(color=AMBER, size=10), annotation_position="top left")
    fig.add_hline(y=0, line=dict(color="rgba(255,255,255,.35)", width=1))
    fig.update_yaxes(**MONEY)
    return base(fig, "Cash position · reported/estimated + 90-day precog", 380)


def waterfall(L, month: pd.Timestamp, cmap: dict[str, str], top_n: int = 9) -> go.Figure:
    t = L.tx[L.tx["month"] == month]
    inc = float(t["inflow"].sum())
    cats = t[t["kind"].isin(["expense", "refund"])].groupby("category")["flow"].sum().sort_values(ascending=False)
    shown = cats.head(top_n)
    rest = float(cats.iloc[top_n:].sum())
    labels = ["Income"] + list(shown.index) + (["Everything else"] if rest else []) + ["Net"]
    vals = [inc] + [-v for v in shown.values] + ([-rest] if rest else []) + [0]
    measure = ["relative"] * (len(labels) - 1) + ["total"]
    net = inc - float(cats.sum())
    tot_c = GREEN if net >= 0 else RED
    fig = go.Figure(go.Waterfall(
        x=labels, y=vals, measure=measure,
        increasing=dict(marker=dict(color=rgba(GREEN, .8), line=dict(color=GREEN, width=1))),
        decreasing=dict(marker=dict(color=rgba(MAGENTA, .7), line=dict(color=MAGENTA, width=1))),
        totals=dict(marker=dict(color=rgba(tot_c, .8), line=dict(color="#fff", width=1))),
        connector=dict(line=dict(color="rgba(0,229,255,.35)", dash="dot", width=1)),
        texttemplate="%{delta:$,.0f}", textposition="outside", textfont=dict(size=10, color=INK_DIM),
        hovertemplate="%{x}: %{delta:$,.0f}<extra></extra>",
    ))
    fig.update_yaxes(**MONEY)
    fig.update_layout(hovermode="closest", showlegend=False)
    return base(fig, f"Where {month:%B %Y} went · waterfall", 400)


# ======================================================================= FLOW MATRIX

def sankey(L, months: list[pd.Timestamp], cmap: dict[str, str], max_merchants: int = 3) -> go.Figure:
    t = L.tx[L.tx["month"].isin(months)]
    if t.empty:
        return empty("No transactions in range")
    inc = t[t["kind"] == "income"].groupby("merchant")["inflow"].sum().sort_values(ascending=False)
    top_inc = inc.head(5)
    other_inc = float(inc.iloc[5:].sum())
    sp = t[t["kind"].isin(["expense", "refund"])]
    cats = sp.groupby("category")["flow"].sum()
    cats = cats[cats > 0].sort_values(ascending=False)
    total_in = float(inc.sum())
    total_out = float(cats.sum())
    nodes, colors = [], []

    def node(name, color):
        nodes.append(name)
        colors.append(color)
        return len(nodes) - 1

    pool = node("◈ CASH POOL", CYAN)
    src, dst, val, lcol = [], [], [], []
    for name, v in top_inc.items():
        i = node(f"⇢ {name}", GREEN)
        src.append(i); dst.append(pool); val.append(v); lcol.append(rgba(GREEN, .35))
    if other_inc > 0:
        i = node("⇢ Other income", GREEN)
        src.append(i); dst.append(pool); val.append(other_inc); lcol.append(rgba(GREEN, .35))
    if total_out > total_in:
        i = node("⚠ DEFICIT (savings/debt)", RED)
        src.append(i); dst.append(pool); val.append(total_out - total_in); lcol.append(rgba(RED, .45))
    for rank, (cat, v) in enumerate(cats.items()):
        c = color_of(cat, cmap)
        ci = node(cat, c)
        src.append(pool); dst.append(ci); val.append(v); lcol.append(rgba(c, .35))
        if rank >= 7:  # small categories end at the category - keeps the right edge legible
            continue
        m = sp[sp["category"] == cat].groupby("merchant")["flow"].sum().sort_values(ascending=False)
        m = m[m > 0]
        for mer, mv in m.head(max_merchants).items():
            mi = node(f"{mer}", rgba(c, .9))
            src.append(ci); dst.append(mi); val.append(mv); lcol.append(rgba(c, .22))
        rest = float(m.iloc[max_merchants:].sum())
        if rest > 0:
            mi = node(f"{cat}: other", rgba(c, .6))
            src.append(ci); dst.append(mi); val.append(rest); lcol.append(rgba(c, .15))
    if total_in > total_out:
        i = node("▣ KEPT", GREEN)
        src.append(pool); dst.append(i); val.append(total_in - total_out); lcol.append(rgba(GREEN, .45))
    fig = go.Figure(go.Sankey(
        arrangement="snap",
        node=dict(label=nodes, color=colors, pad=10, thickness=14, line=dict(color="rgba(255,255,255,.4)", width=0.5),
                  hovertemplate="%{label}<br>$%{value:,.0f}<extra></extra>"),
        link=dict(source=src, target=dst, value=val, color=lcol, hovertemplate="%{source.label} → %{target.label}<br>$%{value:,.0f}<extra></extra>"),
        textfont=dict(family=FONT_MONO, color="#fff", size=11),
    ))
    fig.update_layout(hovermode="closest")
    return base(fig, "Flow matrix · where the money goes", 620)


def net_bars(ms: pd.DataFrame, L) -> go.Figure:
    colors = [rgba(GREEN, .8) if v >= 0 else rgba(RED, .85) for v in ms["net"]]
    fig = go.Figure(go.Bar(x=ms.index, y=ms["net"], marker=dict(color=colors, opacity=_partial_opacity(ms.index, L),
                                                                  line=dict(color=[GREEN if v >= 0 else RED for v in ms["net"]], width=1)),
                           name="Net", hovertemplate="$%{y:,.0f}<extra></extra>"))
    full = A.full_only(ms, L)
    if len(full) >= 4:
        tr = A.robust_trend(full["net"])
        glow_line(fig, tr["fit"].index, tr["fit"].values, AMBER, "Robust trend", width=1.8, dash="dash", hovertemplate="$%{y:,.0f}")
    fig.add_hline(y=0, line=dict(color="rgba(255,255,255,.4)", width=1))
    fig.update_yaxes(**MONEY)
    return base(fig, "Net cash flow per month · with robust trend", 320)


def cum_net(ms: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    glow_line(fig, ms.index, ms["cum_net"], VIOLET, "Cumulative net", fill="tozeroy", fillcolor=rgba(VIOLET, .1), hovertemplate="$%{y:,.0f}")
    fig.add_hline(y=0, line=dict(color="rgba(255,255,255,.35)", width=1))
    fig.update_yaxes(**MONEY)
    return base(fig, "Cumulative net · wealth drift", 320, showlegend=False)


def dom_profile(prof: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    x = prof.index
    glow_line(fig, x, prof["cum_income"], INCOME_C, "Avg cumulative income", hovertemplate="$%{y:,.0f}", shape="hv")
    glow_line(fig, x, prof["cum_spend"], SPEND_C, "Avg cumulative spending", hovertemplate="$%{y:,.0f}")
    under = prof["cum_spend"] > prof["cum_income"]
    if under.any():
        fig.add_trace(go.Scatter(x=x, y=np.where(under, prof["cum_spend"], np.nan), mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=x, y=np.where(under, prof["cum_income"], np.nan), mode="lines", line=dict(width=0), fill="tonexty",
                                 fillcolor=rgba(RED, .28), name="Crunch window", hoverinfo="skip"))
    fig.update_xaxes(title_text="day of month", dtick=5)
    fig.update_yaxes(**MONEY)
    return base(fig, "Intra-month timing · the crunch window", 340)


def weekly_net(daily: pd.DataFrame) -> go.Figure:
    w = daily[["income", "spend"]].resample("W-SUN").sum()
    w["net"] = w["income"] - w["spend"]
    w = w.tail(52)
    fig = go.Figure(go.Bar(x=w.index, y=w["net"], marker=dict(color=[rgba(GREEN, .75) if v >= 0 else rgba(MAGENTA, .75) for v in w["net"]]),
                           hovertemplate="week of %{x|%b %d}<br>$%{y:,.0f}<extra></extra>", name="Weekly net"))
    fig.update_yaxes(**MONEY)
    fig.update_layout(hovermode="closest")
    return base(fig, "Weekly net · last 52 weeks", 300, showlegend=False)


# ======================================================================= SPEND SPECTRUM

def cat_area(cm: pd.DataFrame, cmap, keep, L) -> go.Figure:
    f = fold(cm, keep)
    fig = go.Figure()
    for c in f.columns:
        col = color_of(c, cmap)
        fig.add_trace(go.Scatter(x=f.index, y=f[c], name=c, stackgroup="one", mode="lines", line=dict(width=1.2, color=col),
                                 fillcolor=rgba(col, .38), hovertemplate="$%{y:,.0f}"))
    fig.update_yaxes(**MONEY)
    return base(fig, "Spend spectrum · category stack over time", 420)


def cat_share(cm: pd.DataFrame, cmap, keep) -> go.Figure:
    f = fold(cm, keep)
    share = f.div(f.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
    fig = go.Figure()
    for c in share.columns:
        col = color_of(c, cmap)
        fig.add_bar(x=share.index, y=share[c], name=c, marker=dict(color=rgba(col, .8), line=dict(color="#060913", width=1)),
                    hovertemplate="%{y:.0%}")
    fig.update_layout(barmode="stack", bargap=0.12)
    fig.update_yaxes(tickformat=".0%", range=[0, 1])
    return base(fig, "Category share · 100% stack (mix shift)", 380)


def sunburst(L, months, cmap) -> go.Figure:
    t = L.tx[L.tx["month"].isin(months) & L.tx["kind"].isin(["expense", "refund"])]
    g = t.groupby(["category", "merchant"])["flow"].sum()
    g = g[g > 0]
    if g.empty:
        return empty("No spending in range")
    ids, labels, parents, values, colors = [], [], [], [], []
    cat_tot = g.groupby(level=0).sum()
    for cat, v in cat_tot.items():
        ids.append(cat); labels.append(cat); parents.append(""); values.append(v); colors.append(rgba(color_of(cat, cmap), .85))
    for (cat, mer), v in g.items():
        ids.append(f"{cat}/{mer}"); labels.append(mer); parents.append(cat); values.append(v); colors.append(rgba(color_of(cat, cmap), .45))
    fig = go.Figure(go.Sunburst(ids=ids, labels=labels, parents=parents, values=values, branchvalues="total",
                                marker=dict(colors=colors, line=dict(color="#060913", width=1)),
                                hovertemplate="<b>%{label}</b><br>$%{value:,.0f}<br>%{percentParent:.1%} of parent<extra></extra>",
                                insidetextfont=dict(family=FONT_MONO, color="#fff"), maxdepth=2))
    fig.update_layout(hovermode="closest")
    return base(fig, "Spend orbit · category → merchant (click to zoom)", 520, margin=dict(l=4, r=4, t=48, b=4))


def cat_heat(cm: pd.DataFrame, L) -> go.Figure:
    f = cm.loc[:, cm.sum() > 0]
    if f.empty:
        return empty("No spending")
    f = f[f.sum().sort_values(ascending=False).index[:18]]
    full = A.full_only(f, L)
    med = full.median() if len(full) else f.median()
    mad = ((full - med).abs().median() * 1.4826 if len(full) else f.std()).clip(lower=med.abs() * 0.1 + 5)
    z = ((f - med) / mad).clip(-4, 4)
    fig = go.Figure(go.Heatmap(
        x=f.index, y=f.columns, z=z.T.values, customdata=f.T.values,
        colorscale=[[0, "#1B6BFF"], [0.35, "#0B2250"], [0.5, "#101626"], [0.65, "#4A0B45"], [1, "#FF2BD6"]], zmid=0,
        hovertemplate="%{y} · %{x|%b %Y}<br>$%{customdata:,.0f}<br>robust z %{z:+.1f}<extra></extra>",
        colorbar=dict(title=dict(text="vs typical", font=dict(color=INK_DIM, size=10)), tickfont=dict(color=INK_DIM, size=10), thickness=10,
                      tickvals=[-4, -2, 0, 2, 4], ticktext=["far below", "below", "typical", "above", "far above"]),
        xgap=2, ygap=2,
    ))
    fig.update_layout(hovermode="closest")
    fig.update_yaxes(autorange="reversed", showspikes=False)
    fig.update_xaxes(showspikes=False)
    return base(fig, "Anomaly heat · each category vs its own normal", 34 * len(f.columns) + 110)


def small_multiples(cm: pd.DataFrame, cmap, L, n: int = 12) -> go.Figure:
    full = A.full_only(cm, L)
    cats = [c for c in full.sum().sort_values(ascending=False).index if full[c].sum() > 0][:n]
    if not cats:
        return empty("Not enough full months")
    cols = 4
    rows = int(np.ceil(len(cats) / cols))
    fig = make_subplots(rows=rows, cols=cols, subplot_titles=[c.upper() for c in cats], vertical_spacing=0.12, horizontal_spacing=0.05)
    for i, c in enumerate(cats):
        r, k = i // cols + 1, i % cols + 1
        y = full[c].tail(18)
        col = color_of(c, cmap)
        glow_line(fig, y.index, y.values, col, c, width=1.8, showlegend=False, hovertemplate="$%{y:,.0f}", row=r, col=k,
                  fill="tozeroy", fillcolor=rgba(col, .08))
        if len(y) >= 4:
            tr = A.robust_trend(y)
            up = tr["slope"] > 0 and tr["z"] >= 1.64
            down = tr["slope"] < 0 and tr["z"] <= -1.64
            fig.add_trace(go.Scatter(x=tr["fit"].index, y=tr["fit"].values, mode="lines", showlegend=False, hoverinfo="skip",
                                     line=dict(color=RED if up else GREEN if down else "rgba(255,255,255,.35)", width=1.2, dash="dot")), row=r, col=k)
    fig.update_yaxes(tickprefix="$", tickformat="~s", tickfont=dict(size=9))
    fig.update_xaxes(tickfont=dict(size=9), tickformat="%b %y", nticks=4)
    fig.update_annotations(font=dict(family=FONT_HEAD, size=10, color=INK_DIM))
    fig.update_layout(hovermode="closest")
    return base(fig, "Category telemetry · dotted = robust trend (red rising, green falling)", 190 * rows + 60)


def bump(cm: pd.DataFrame, cmap, keep, L) -> go.Figure:
    f = A.full_only(cm[[c for c in keep if c in cm.columns]], L).tail(12)
    if f.empty:
        return empty("Not enough full months")
    ranks = f.rank(axis=1, ascending=False, method="first")
    fig = go.Figure()
    for c in ranks.columns:
        col = color_of(c, cmap)
        glow_line(fig, ranks.index, ranks[c], col, c, width=2.4, customdata=f[c].values, showlegend=False,
                  hovertemplate=f"{c}: #%{{y:.0f}} · $%{{customdata:,.0f}}")
        fig.add_trace(go.Scatter(x=[ranks.index[-1]], y=[ranks[c].iloc[-1]], mode="markers+text", text=[f" {c}"], textposition="middle right", cliponaxis=False,
                                 textfont=dict(color=col, size=10), marker=dict(color=col, size=9, line=dict(color="#fff", width=1)),
                                 showlegend=False, hoverinfo="skip"))
    fig.update_yaxes(autorange="reversed", dtick=1, title_text="rank", showspikes=False)
    return base(fig, "Rank shifts · who's climbing your budget", 380, margin=dict(l=8, r=130, t=48, b=8), showlegend=False)


def race(cm: pd.DataFrame, cmap, L, n: int = 10) -> go.Figure:
    cum = cm.cumsum()
    top = list(cum.iloc[-1].sort_values(ascending=False).index[:n])
    cum = cum[top]
    frames = []
    xmax = float(cum.values.max()) * 1.08 if cum.size else 1
    for m, row in cum.iterrows():
        r = row.sort_values()
        frames.append(go.Frame(name=f"{m:%Y-%m}", data=[go.Bar(
            x=r.values, y=r.index, orientation="h", marker=dict(color=[rgba(color_of(c, cmap), .8) for c in r.index],
                                                               line=dict(color=[color_of(c, cmap) for c in r.index], width=1)),
            text=[f"${v:,.0f}" for v in r.values], textposition="outside", textfont=dict(color=INK, size=10),
            hovertemplate="%{y}: $%{x:,.0f}<extra></extra>")],
            layout=go.Layout(title=dict(text=f"CUMULATIVE SPEND RACE · {m:%b %Y}".upper()))))
    first = frames[0].data[0] if frames else go.Bar()
    fig = go.Figure(data=[first], frames=frames)
    fig.update_xaxes(range=[0, xmax], **MONEY)
    fig.update_yaxes(showspikes=False)
    fig.update_layout(
        hovermode="closest",
        updatemenus=[dict(type="buttons", showactive=False, x=0.0, y=-0.08, xanchor="left", yanchor="top", direction="left",
                          bgcolor="rgba(0,229,255,.12)", bordercolor=CYAN, font=dict(color=CYAN, family=FONT_HEAD, size=10),
                          buttons=[dict(label="▶ PLAY", method="animate", args=[None, dict(frame=dict(duration=380, redraw=True), fromcurrent=True, transition=dict(duration=240))]),
                                   dict(label="❚❚ HOLD", method="animate", args=[[None], dict(frame=dict(duration=0, redraw=False), mode="immediate")])])],
        sliders=[dict(active=0, x=0.18, y=-0.06, len=0.8, currentvalue=dict(visible=False), font=dict(color=INK_DIM, size=9),
                      bgcolor="rgba(0,229,255,.2)", bordercolor=AXIS, activebgcolor=MAGENTA, tickcolor=AXIS,
                      steps=[dict(method="animate", label=f.name[2:], args=[[f.name], dict(mode="immediate", frame=dict(duration=0, redraw=True))]) for f in frames])],
        margin=dict(l=8, r=40, t=48, b=70),
    )
    return base(fig, "Cumulative spend race (press play)", 470)


def terrain(cm: pd.DataFrame, L, n: int = 12) -> go.Figure:
    full = A.full_only(cm, L)
    full = full[[c for c in full.columns if c not in ("Housing", "Taxes")]]  # one flat mesa of rent hides every other ridge
    cats = list(full.sum().sort_values(ascending=False).index[:n])
    if len(full) < 2 or not cats:
        return empty("Need 2+ full months for the terrain")
    z = full[cats].T.values
    fig = go.Figure(go.Surface(
        z=z, x=[m.strftime("%b %y") for m in full.index], y=cats,
        colorscale=[[0, "#020616"], [0.15, "#062A5A"], [0.4, "#00A6D6"], [0.65, "#00E5FF"], [0.85, "#FF2BD6"], [1, "#FFFFFF"]],
        contours=dict(z=dict(show=True, usecolormap=True, highlightcolor="#fff", project=dict(z=True))),
        hovertemplate="%{y} · %{x}<br>$%{z:,.0f}<extra></extra>", showscale=False, opacity=0.95,
        lighting=dict(ambient=0.85, diffuse=0.5, specular=0.15, roughness=0.6, fresnel=0.2),
    ))
    fig.update_layout(scene=dict(xaxis=dict(title="", tickfont=dict(size=9)), yaxis=dict(title="", tickfont=dict(size=9)),
                                 zaxis=dict(title="", tickprefix="$", tickformat="~s"), camera=dict(eye=dict(x=1.25, y=-1.2, z=0.75)),
                                 aspectratio=dict(x=1.6, y=1.2, z=0.6)), hovermode="closest")
    return base(fig, "Spend terrain · 3D holo (drag to rotate)", 560, margin=dict(l=0, r=0, t=48, b=0))


def mix_radar(cm: pd.DataFrame, cmap, L, keep) -> go.Figure:
    full = A.full_only(cm, L)
    if len(full) < 4:
        return empty("Need 4+ full months")
    # Rent would flatten everything else into the centre; the radar is about the flexible mix.
    cats = [c for c in keep if c in full.columns and c not in ("Housing", "Taxes", "Insurance")][:8]
    now = full[cats].tail(3).mean()
    then = full[cats].iloc[-15:-3].mean() if len(full) > 3 else now
    fig = go.Figure()
    for vals, name, col, dash in ((then, "Prior 12 months", INK_DIM, "dot"), (now, "Last 3 months", MAGENTA, None)):
        fig.add_trace(go.Scatterpolar(r=list(vals.values) + [vals.values[0]], theta=cats + [cats[0]], name=name, fill="toself",
                                      fillcolor=rgba(col if col != INK_DIM else CYAN, .12 if dash else .22),
                                      line=dict(color=col if col != INK_DIM else CYAN, width=2, dash=dash),
                                      hovertemplate="%{theta}: $%{r:,.0f}/mo<extra></extra>"))
    fig.update_polars(radialaxis=dict(tickprefix="$", tickformat="~s", showline=False, tickfont=dict(size=8), angle=90, tickangle=90),
                      angularaxis=dict(tickfont=dict(size=10, color=INK)))
    fig.update_layout(hovermode="closest")
    return base(fig, "Mix radar · flexible categories, now vs before", 440, margin=dict(l=70, r=70, t=96, b=30))


# ======================================================================= BUDGET GRID

def budget_bullets(pace: pd.DataFrame, budgets: pd.DataFrame, L) -> go.Figure:
    b = budgets.set_index("category")["monthly_budget"]
    cats = [c for c in b.index if b[c] > 0]
    if not cats:
        return empty("No budget lines")
    p = pace.reindex(cats).fillna(0.0)
    order = (p["projected"] / b.reindex(cats)).sort_values().index
    p = p.loc[order]
    bb = b.reindex(order)
    ratio = p["projected"] / bb
    col = [RED if r > 1.1 else AMBER if r > 0.95 else GREEN for r in ratio]
    fig = go.Figure()
    fig.add_bar(y=p.index, x=bb.values, orientation="h", name="Budget", marker=dict(color="rgba(255,255,255,.06)", line=dict(color="rgba(255,255,255,.35)", width=1)),
                hovertemplate="budget $%{x:,.0f}<extra></extra>", width=0.8)
    fig.add_bar(y=p.index, x=p["projected"], orientation="h", name="Projected month-end", marker=dict(color=[rgba(c, .22) for c in col], line=dict(color=col, width=1, )),
                hovertemplate="projected $%{x:,.0f}<extra></extra>", width=0.55)
    fig.add_bar(y=p.index, x=p["so_far"], orientation="h", name="Spent so far", marker=dict(color=[rgba(c, .85) for c in col]),
                hovertemplate="so far $%{x:,.0f}<extra></extra>", width=0.3)
    fig.update_layout(barmode="overlay", hovermode="y unified")
    fig.update_xaxes(**MONEY)
    fig.update_yaxes(showspikes=False)
    day = f"day {L.end.day} of {L.current_month.days_in_month}" if L.current_is_partial else "complete month"
    return base(fig, f"Budget pace · {L.current_month:%B %Y} ({day})", 40 * len(cats) + 120)


def budget_heat(bf: pd.DataFrame) -> go.Figure:
    if bf.empty:
        return empty("No budget data")
    pv = bf.pivot_table(index="category", columns="month", values="pct", aggfunc="first")
    act = bf.pivot_table(index="category", columns="month", values="actual", aggfunc="first").reindex_like(pv)
    bud = bf.pivot_table(index="category", columns="month", values="budget", aggfunc="first").reindex_like(pv)
    pv = pv.loc[pv.mean(axis=1).sort_values(ascending=False).index]
    act, bud = act.loc[pv.index], bud.loc[pv.index]
    pv, act, bud = pv.iloc[:, -18:], act.iloc[:, -18:], bud.iloc[:, -18:]
    z = pv.clip(0, 2).values
    txt = [[f"{v:.0%}" if v == v else "" for v in row] for row in pv.values]
    fig = go.Figure(go.Heatmap(
        x=pv.columns, y=pv.index, z=z, text=txt, texttemplate="%{text}", textfont=dict(size=9, color="#fff"),
        customdata=np.dstack([act.values, bud.values]),
        colorscale=[[0, "#0E6E8C"], [0.35, "#0A3048"], [0.5, "#1A2233"], [0.6, "#5A1640"], [0.8, "#FF2BD6"], [1, "#FF1F4B"]], zmid=1, zmin=0, zmax=2,
        hovertemplate="%{y} · %{x|%b %Y}<br>$%{customdata[0]:,.0f} of $%{customdata[1]:,.0f}<br>%{text}<extra></extra>",
        colorbar=dict(title=dict(text="% of budget", font=dict(color=INK_DIM, size=10)), tickformat=".0%", tickfont=dict(color=INK_DIM, size=10), thickness=10),
        xgap=2, ygap=2,
    ))
    fig.update_yaxes(autorange="reversed", showspikes=False)
    fig.update_xaxes(showspikes=False)
    fig.update_layout(hovermode="closest")
    return base(fig, "Overrun grid · % of budget used, by month", 32 * len(pv) + 120)


def budget_line(bf: pd.DataFrame, cat: str, cmap) -> go.Figure:
    g = bf[bf["category"] == cat].sort_values("month")
    if g.empty:
        return empty("No data for that category")
    col = color_of(cat, cmap)
    fig = go.Figure()
    fig.add_bar(x=g["month"], y=g["actual"], name="Actual", marker=dict(color=[rgba(RED, .75) if o > 0 else rgba(col, .6) for o in g["over"]]),
                hovertemplate="$%{y:,.0f}")
    glow_line(fig, g["month"], g["budget"], AMBER, "Budget", width=2, dash="dash", shape="hv", hovertemplate="$%{y:,.0f}")
    fig.update_yaxes(**MONEY)
    return base(fig, f"{cat} · actual vs budget", 320)


# ======================================================================= TEMPORAL

def calendar(daily: pd.DataFrame) -> go.Figure:
    d = daily["spend"].tail(371)
    if d.empty:
        return empty("No data")
    start = d.index[0] - pd.Timedelta(days=d.index[0].dayofweek)
    idx = pd.date_range(start, d.index[-1], freq="D")
    d = d.reindex(idx)
    weeks = ((idx - start).days // 7).values
    dows = idx.dayofweek.values
    z = np.full((7, weeks.max() + 1), np.nan)
    text = np.empty((7, weeks.max() + 1), dtype=object)
    for w, dw, v, day in zip(weeks, dows, d.values, idx):
        z[dw, w] = v
        text[dw, w] = f"{day:%a %b %d %Y}"
    cap = np.nanpercentile(z, 97) if np.isfinite(z).any() else 1
    week_starts = [start + pd.Timedelta(weeks=int(w)) for w in range(weeks.max() + 1)]
    fig = go.Figure(go.Heatmap(
        z=np.log1p(np.clip(z, 0, None)), x=week_starts, y=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], customdata=np.dstack([np.nan_to_num(z), text]),
        colorscale=[[0, "#060B18"], [0.25, "#08314A"], [0.55, "#00A6D6"], [0.8, "#FF2BD6"], [1, "#FFFFFF"]], zmin=0, zmax=np.log1p(cap),
        hovertemplate="%{customdata[1]}<br>$%{customdata[0]:,.0f}<extra></extra>", showscale=False, xgap=3, ygap=3,
    ))
    fig.update_yaxes(autorange="reversed", showspikes=False, showgrid=False)
    fig.update_xaxes(showspikes=False, showgrid=False, tickformat="%b")
    fig.update_layout(hovermode="closest")
    return base(fig, "Spend calendar · last 12 months (log colour)", 250)


def dow_polar(L) -> go.Figure:
    t = L.tx[L.tx["kind"].isin(["expense", "refund"]) & ~L.tx["category"].isin(FIXED_CATS)]
    days = pd.date_range(L.start, L.end, freq="D")
    n_per_dow = pd.Series(days.dayofweek).value_counts().reindex(range(7), fill_value=1)
    names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    fig = go.Figure()
    for col, name, mask, c in ((None, "Discretionary", t["is_discretionary"], MAGENTA), (None, "Other variable", ~t["is_discretionary"], CYAN)):
        per = t[mask].groupby("dow")["flow"].sum().reindex(range(7), fill_value=0) / n_per_dow
        fig.add_trace(go.Barpolar(r=per.values, theta=names, name=name, marker=dict(color=rgba(c, .55), line=dict(color=c, width=1.2)),
                                  hovertemplate="%{theta}: $%{r:,.0f}/day<extra>" + name + "</extra>"))
    fig.update_polars(radialaxis=dict(tickprefix="$", tickformat="~s", showline=False), angularaxis=dict(direction="clockwise", rotation=90))
    fig.update_layout(barmode="stack", hovermode="closest")
    return base(fig, "Weekday radar · avg variable spend per day", 420, margin=dict(l=50, r=50, t=90, b=30))


def dow_week_heat(L) -> go.Figure:
    t = L.tx[L.tx["kind"].isin(["expense", "refund"]) & L.tx["month"].isin(L.full_months)]
    if t.empty:
        return empty("Need full months")
    wom = ((t["dom"] - 1) // 7 + 1).clip(upper=5)
    pv = t.assign(wom=wom).pivot_table(index="wom", columns="dow", values="flow", aggfunc="sum").reindex(index=range(1, 6), columns=range(7)).fillna(0)
    pv = pv / max(len(L.full_months), 1)
    fig = go.Figure(go.Heatmap(z=pv.values, x=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], y=["Days 1–7", "Days 8–14", "Days 15–21", "Days 22–28", "Days 29–31"],
                               colorscale=[[0, "#060B18"], [0.4, "#123C7A"], [0.75, "#A070FF"], [1, "#FF2BD6"]],
                               hovertemplate="%{y} · %{x}<br>$%{z:,.0f} avg/month<extra></extra>", xgap=3, ygap=3,
                               texttemplate="$%{z:,.0f}", textfont=dict(size=10, color="#fff"), showscale=False))
    fig.update_yaxes(autorange="reversed", showspikes=False)
    fig.update_xaxes(showspikes=False)
    fig.update_layout(hovermode="closest")
    return base(fig, "When in the month · weekday × week heat", 330)


FIXED_CATS = ("Housing", "Insurance", "Taxes", "Utilities")


def variable_daily(L) -> pd.Series:
    """Daily spend minus the fixed-bill categories: rent day shouldn't be a 'breakout'."""
    t = L.tx[L.tx["kind"].isin(["expense", "refund"]) & ~L.tx["category"].isin(FIXED_CATS)]
    return t.groupby("date")["flow"].sum().reindex(pd.date_range(L.start, L.end, freq="D"), fill_value=0.0)


def rolling(L) -> go.Figure:
    s = variable_daily(L)
    r7 = s.rolling(7, min_periods=3).mean()
    r30 = s.rolling(30, min_periods=10).mean()
    sd = s.rolling(30, min_periods=10).std()
    hi = r30 + 2 * sd
    out = s[(s > hi) & (s > 50)]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=list(hi.index) + list(hi.index[::-1]), y=list(hi.values) + list((r30 - 2 * sd).clip(lower=0).values[::-1]),
                             fill="toself", mode="lines", fillcolor=rgba(VIOLET, .10), line=dict(width=0), name="±2σ band (30d)", hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=s.index, y=s.values, mode="markers", marker=dict(size=3, color=rgba(CYAN, .45)), name="Daily spend", hovertemplate="$%{y:,.0f}"))
    glow_line(fig, r7.index, r7.values, CYAN, "7-day avg", width=1.6, hovertemplate="$%{y:,.0f}")
    glow_line(fig, r30.index, r30.values, MAGENTA, "30-day avg", width=2.2, hovertemplate="$%{y:,.0f}")
    fig.add_trace(go.Scatter(x=out.index, y=out.values, mode="markers", name="Breakout days", marker=dict(symbol="diamond", size=9, color=AMBER, line=dict(color="#fff", width=1)),
                             hovertemplate="$%{y:,.0f}"))
    fig.update_yaxes(type="log", tickprefix="$", tickformat=",.0f")
    return base(fig, "Burn-rate oscilloscope · variable daily spend (bills excluded)", 400)


def seasonality(idx: pd.Series | None) -> go.Figure:
    if idx is None:
        return empty("Seasonality needs 13+ full months of history")
    names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    vals = idx.reindex(range(1, 13)).values
    cols = [MAGENTA if v >= 1.1 else CYAN if v <= 0.9 else VIOLET for v in np.nan_to_num(vals, nan=1)]
    fig = go.Figure(go.Barpolar(r=vals, theta=names, marker=dict(color=[rgba(c, .6) for c in cols], line=dict(color=cols, width=1.2)),
                                hovertemplate="%{theta}: %{r:.2f}× average<extra></extra>"))
    fig.add_trace(go.Scatterpolar(r=[1] * 13, theta=names + [names[0]], mode="lines", line=dict(color="rgba(255,255,255,.5)", dash="dot", width=1),
                                  name="average", hoverinfo="skip"))
    fig.update_polars(radialaxis=dict(showline=False, tickfont=dict(size=9)), angularaxis=dict(direction="clockwise", rotation=90))
    fig.update_layout(hovermode="closest", showlegend=False)
    return base(fig, "Seasonal radar · month-of-year spend index", 420, margin=dict(l=50, r=50, t=60, b=30))


def galaxy(L, cmap) -> go.Figure:
    t = L.tx[(L.tx["kind"] == "expense") & (L.tx["flow"] > 0)].tail(4000)
    if t.empty:
        return empty("No data")
    cats = list(t.groupby("category")["flow"].sum().sort_values(ascending=False).index)
    ypos = {c: i for i, c in enumerate(cats)}
    fig = go.Figure()
    for c in cats:
        g = t[t["category"] == c]
        col = color_of(c, cmap)
        fig.add_trace(go.Scatter3d(x=g["date"], y=[ypos[c]] * len(g), z=np.log10(g["flow"]), mode="markers", name=c,
                                   marker=dict(size=np.clip(np.log10(g["flow"]) * 2.4, 1.5, 9), color=col, opacity=0.8, line=dict(width=0)),
                                   customdata=np.stack([g["merchant"], g["flow"]], axis=1),
                                   hovertemplate="%{customdata[0]}<br>$%{customdata[1]:,.2f}<br>%{x|%b %d %Y}<extra>" + c + "</extra>",
                                   showlegend=c in cmap))
    fig.update_layout(scene=dict(yaxis=dict(tickvals=list(range(len(cats))), ticktext=cats, title="", tickfont=dict(size=8)),
                                 zaxis=dict(title="", tickvals=[0, 1, 2, 3, 4], ticktext=["$1", "$10", "$100", "$1k", "$10k"]),
                                 xaxis=dict(title=""), camera=dict(eye=dict(x=-1.7, y=-1.4, z=0.7)), aspectratio=dict(x=1.8, y=1.1, z=0.7)),
                      hovermode="closest", legend=dict(orientation="v", x=1.0, xanchor="right", y=0.95, yanchor="top"))
    return base(fig, "Transaction galaxy · every purchase in 3D (log $)", 580, margin=dict(l=0, r=0, t=48, b=0))


def ticket_hist(L) -> go.Figure:
    t = L.tx[(L.tx["kind"] == "expense") & (L.tx["flow"] > 0)]
    if t.empty:
        return empty("No data")
    cut = L.end - pd.Timedelta(days=90)
    bins = np.logspace(0, np.log10(max(t["flow"].max(), 10)) + 0.05, 36)
    fig = go.Figure()
    for mask, name, col in ((t["date"] <= cut, "Before", CYAN), (t["date"] > cut, "Last 90 days", MAGENTA)):
        v = t.loc[mask, "flow"]
        if v.empty:
            continue
        h, e = np.histogram(v, bins=bins)
        share = h / h.sum()
        centers = np.sqrt(e[:-1] * e[1:])
        glow_line(fig, centers, share, col, name, width=2, shape="spline", fill="tozeroy", fillcolor=rgba(col, .12),
                  hovertemplate="~$%{x:,.0f}: %{y:.1%} of purchases")
    fig.update_xaxes(type="log", tickprefix="$", tickformat=",.0f", title_text="purchase size")
    fig.update_yaxes(tickformat=".0%", title_text="share of purchases")
    return base(fig, "Ticket-size spectrum · are purchases getting bigger?", 340)


# ======================================================================= RECURRING

def rec_timeline(rec: pd.DataFrame, cmap, L) -> go.Figure:
    if rec.empty:
        return empty("No recurring charges detected")
    r = rec.sort_values(["active", "monthly_cost"], ascending=[True, True]).tail(26)
    fig = go.Figure()
    for _, s in r.iterrows():
        # colour = status: magenta if the price went up, cyan if live, grey if stopped
        hiked = s["active"] and s["change_pct"] > 0.015
        col = MAGENTA if hiked else CYAN if s["active"] else INK_MUTED
        label = f"{s['merchant']} · {s['cadence']}"
        fig.add_trace(go.Scatter(x=[s["first"], s["last"]], y=[label, label], mode="lines", line=dict(color=rgba(col, .35 if s["active"] else .15), width=6),
                                 showlegend=False, hoverinfo="skip"))
        amts = np.array(s["amounts"])
        fig.add_trace(go.Scatter(x=s["dates"], y=[label] * len(s["dates"]), mode="markers", showlegend=False,
                                 marker=dict(size=np.clip(np.sqrt(amts) * 1.4, 5, 18), color=col if s["active"] else INK_MUTED, line=dict(color="#fff", width=0.6),
                                             symbol="circle" if s["active"] else "x-thin-open"),
                                 customdata=amts, hovertemplate=f"{s['merchant']}<br>%{{x|%b %d %Y}}: $%{{customdata:,.2f}}<extra></extra>"))
        if s["active"]:
            fig.add_trace(go.Scatter(x=[s["next_expected"]], y=[label], mode="markers", showlegend=False,
                                     marker=dict(size=11, color="rgba(0,0,0,0)", line=dict(color=col, width=2), symbol="diamond-open"),
                                     hovertemplate=f"next ~%{{x|%b %d}} · ${s['typical_amount']:,.2f}<extra>predicted</extra>"))
    fig.add_vline(x=L.end, line=dict(color=MAGENTA, width=1, dash="dot"))
    fig.update_layout(hovermode="closest")
    fig.update_yaxes(showspikes=False, tickfont=dict(size=10))
    return base(fig, "Recurrence timeline · magenta = price rose · ◇ next charge · × stopped", 28 * len(r) + 110)


def rec_load(rec: pd.DataFrame, L) -> go.Figure:
    if rec.empty:
        return empty("No recurring charges detected")
    bills = rec[A.is_bill(rec)]
    months = L.months
    rows = []
    for _, s in bills.iterrows():
        for m in months:
            m_end = m + pd.offsets.MonthEnd(0)
            if s["first"] <= m_end and s["last"] + pd.Timedelta(days=s["period_days"] * 0.9) >= m:
                rows.append({"month": m, "merchant": s["merchant"], "cost": s["typical_amount"] * A.AVG_MONTH_DAYS / s["period_days"]})
    if not rows:
        return empty("No bill-like streams")
    df = pd.DataFrame(rows).groupby("month").agg(cost=("cost", "sum"), n=("merchant", "nunique")).reindex(months, fill_value=0)
    fig = go.Figure()
    glow_line(fig, df.index, df["cost"], AMBER, "Monthly committed", width=2.4, fill="tozeroy", fillcolor=rgba(AMBER, .10), shape="hv",
              customdata=df["n"], hovertemplate="$%{y:,.0f}/mo across %{customdata} streams")
    fig.update_yaxes(**MONEY)
    return base(fig, "Commitment load · recurring bills active each month", 320, showlegend=False)


def price_steps(rec: pd.DataFrame) -> go.Figure:
    r = rec[(rec["total_change_pct"].abs() > 0.015) & rec["fixed_amount"] & A.is_bill(rec)] if not rec.empty else rec
    if r is None or r.empty:
        return empty("No price changes on fixed recurring charges")
    fig = go.Figure()
    for i, (_, s) in enumerate(r.head(8).iterrows()):
        idx = np.array(s["amounts"]) / s["amounts"][0] * 100
        col = CATEGORICAL[i % len(CATEGORICAL)]
        glow_line(fig, s["dates"], idx, col, s["merchant"], width=2, shape="hv", customdata=s["amounts"],
                  hovertemplate="%{y:.0f} (= $%{customdata:,.2f})")
    fig.add_hline(y=100, line=dict(color="rgba(255,255,255,.35)", dash="dot"))
    fig.update_yaxes(title_text="price index (first charge = 100)")
    return base(fig, "Price drift · fixed charges indexed to their first bill", 360)


# ======================================================================= MERCHANTS

def pareto(L, months) -> go.Figure:
    t = L.tx[L.tx["month"].isin(months) & L.tx["kind"].isin(["expense", "refund"])]
    m = t.groupby("merchant")["flow"].sum()
    m = m[m > 0].sort_values(ascending=False)
    if m.empty:
        return empty("No data")
    cum = m.cumsum() / m.sum()
    n80 = int((cum < 0.8).sum()) + 1
    show = m.head(40)
    fig = go.Figure(go.Bar(x=show.index, y=show.values, marker=dict(color=[rgba(MAGENTA, .8) if i < n80 else rgba(CYAN, .35) for i in range(len(show))]),
                           customdata=cum.head(40).values, hovertemplate="%{x}<br>$%{y:,.0f} · cumulative %{customdata:.0%}<extra></extra>"))
    fig.add_annotation(x=min(n80, len(show)) - 1, y=float(show.max()), text=f"◀ {n80} of {len(m)} merchants = 80% of spend", showarrow=False,
                       xanchor="left", font=dict(color=MAGENTA, size=12, family=FONT_MONO))
    fig.update_yaxes(**MONEY)
    fig.update_xaxes(tickangle=-50, tickfont=dict(size=9), showspikes=False)
    fig.update_layout(hovermode="closest", showlegend=False)
    return base(fig, "Pareto scan · the few merchants that get most of it", 420)


def merchant_bubble(L, months, cmap) -> go.Figure:
    t = L.tx[L.tx["month"].isin(months) & (L.tx["kind"] == "expense")]
    g = t.groupby("merchant").agg(visits=("flow", "size"), avg=("flow", "mean"), total=("flow", "sum"),
                                  category=("category", lambda s: s.mode().iat[0]))
    g = g[g["total"] > 0].sort_values("total", ascending=False).head(80)
    if g.empty:
        return empty("No data")
    fig = go.Figure()
    for cat, gg in g.groupby("category"):
        col = color_of(cat, cmap)
        fig.add_trace(go.Scatter(x=gg["visits"], y=gg["avg"], mode="markers", name=cat,
                                 marker=dict(size=np.sqrt(gg["total"]) * 0.9 + 6, sizemode="diameter", color=rgba(col, .55), line=dict(color=col, width=1.2)),
                                 text=gg.index, customdata=gg["total"],
                                 hovertemplate="<b>%{text}</b><br>%{x} visits · avg $%{y:,.2f}<br>total $%{customdata:,.0f}<extra></extra>",
                                 showlegend=cat in cmap))
    top = g.head(10)
    fig.add_trace(go.Scatter(x=top["visits"], y=top["avg"], mode="text", text=top.index, textposition="top center",
                             textfont=dict(size=10, color=INK), showlegend=False, hoverinfo="skip"))
    fig.update_xaxes(type="log", title_text="visits", dtick=1)
    fig.update_yaxes(type="log", tickprefix="$", title_text="average ticket", dtick=1, tickformat=",.0f")
    fig.update_layout(hovermode="closest")
    return base(fig, "Merchant constellation · frequency × ticket size × total", 480)


def merchant_heat(L, n: int = 16) -> go.Figure:
    t = L.tx[L.tx["kind"].isin(["expense", "refund"])]
    top = t.groupby("merchant")["flow"].sum().sort_values(ascending=False).head(n).index
    pv = t[t["merchant"].isin(top)].pivot_table(index="merchant", columns="month", values="flow", aggfunc="sum").reindex(index=top, columns=L.months).fillna(0)
    pv = pv.iloc[:, -18:]
    # Each row scaled to its own busiest month, so rent doesn't black out every other merchant.
    norm = pv.div(pv.max(axis=1).replace(0, np.nan), axis=0).fillna(0)
    fig = go.Figure(go.Heatmap(z=norm.values, x=pv.columns, y=pv.index, customdata=pv.values, zmin=0, zmax=1,
                               colorscale=[[0, "#060B18"], [0.3, "#0B3160"], [0.7, "#00E5FF"], [1, "#FFFFFF"]],
                               hovertemplate="%{y} · %{x|%b %Y}<br>$%{customdata:,.0f}<extra></extra>", xgap=2, ygap=2, showscale=False))
    fig.update_yaxes(autorange="reversed", showspikes=False, tickfont=dict(size=10))
    fig.update_xaxes(showspikes=False)
    fig.update_layout(hovermode="closest")
    return base(fig, "Merchant heat · each row vs its own peak month", 28 * len(pv) + 110)


def new_merchants(L) -> go.Figure:
    t = L.tx[(L.tx["kind"] == "expense") & (L.tx["flow"] > 0)]
    first = t.groupby("merchant")["month"].min()
    t = t.assign(is_new=t["month"].values == first.reindex(t["merchant"]).values)
    by = t[t["is_new"]].groupby("month").agg(n=("merchant", "nunique"), spend=("flow", "sum")).reindex(L.months, fill_value=0)
    by = by.iloc[2:]  # the first months are all 'new'
    if by.empty:
        return empty("Need more history")
    fig = go.Figure(go.Bar(x=by.index, y=by["spend"], marker=dict(color=rgba(LIME, .6), line=dict(color=LIME, width=1)), customdata=by["n"],
                           hovertemplate="$%{y:,.0f} at %{customdata} first-time merchants<extra></extra>"))
    fig.update_yaxes(**MONEY)
    fig.update_layout(hovermode="closest", showlegend=False)
    return base(fig, "Exploration spend · money at merchants seen for the first time", 300)


# ======================================================================= FORECAST

def forecast_cash(bal: pd.Series, fc: pd.DataFrame, low: float, mode: str, adjusted: pd.Series | None = None) -> go.Figure:
    hist = bal[bal.index > bal.index[-1] - pd.Timedelta(days=75)]
    fig = go.Figure()
    glow_line(fig, hist.index, hist.values, CYAN, "History", width=2.2, hovertemplate="$%{y:,.0f}")
    fig.add_trace(go.Scatter(x=list(fc.index) + list(fc.index[::-1]), y=list(fc["high"]) + list(fc["low"][::-1]), fill="toself", mode="lines",
                             fillcolor=rgba(MAGENTA, .12), line=dict(width=0), name="80% band", hoverinfo="skip"))
    glow_line(fig, fc.index, fc["expected"], MAGENTA, "Precog: current course", width=2.4, dash="dot", customdata=fc["events"],
              hovertemplate="$%{y:,.0f}<br>%{customdata}")
    if adjusted is not None:
        glow_line(fig, adjusted.index, adjusted.values, GREEN, "Precog: with your changes", width=2.4, hovertemplate="$%{y:,.0f}")
    ev = fc[fc["scheduled"] != 0]
    if len(ev):
        fig.add_trace(go.Scatter(x=ev.index, y=ev["expected"], mode="markers", name="Scheduled items",
                                 marker=dict(symbol=["triangle-up" if v > 0 else "triangle-down" for v in ev["scheduled"]], size=10,
                                             color=[GREEN if v > 0 else AMBER for v in ev["scheduled"]], line=dict(color="#fff", width=1)),
                                 customdata=ev["events"], hovertemplate="%{customdata}<extra></extra>"))
    if mode != "relative":
        fig.add_hline(y=low, line=dict(color=AMBER, width=1, dash="dash"), annotation_text=f"floor ${low:,.0f}", annotation_font=dict(color=AMBER, size=10))
    fig.add_hline(y=0, line=dict(color=RED, width=1.4))
    fig.add_vline(x=bal.index[-1], line=dict(color="rgba(255,255,255,.35)", width=1, dash="dot"))
    fig.update_yaxes(**MONEY)
    return base(fig, "Precog cash path · next 90 days", 440)


def forecast_months(ms: pd.DataFrame, fm: pd.DataFrame, L) -> go.Figure:
    full = A.full_only(ms, L).tail(18)
    if fm.empty:
        return empty("Need 3+ full months to project")
    fig = go.Figure()
    for col, c, name in (("income", INCOME_C, "Income"), ("spend", SPEND_C, "Spending")):
        glow_line(fig, full.index, full[col], c, name, width=2.2, hovertemplate="$%{y:,.0f}", legendgroup=col)
        fig.add_trace(go.Scatter(x=list(fm.index) + list(fm.index[::-1]), y=list(fm[col + "_hi"]) + list(fm[col + "_lo"][::-1]), fill="toself", mode="lines",
                                 fillcolor=rgba(c, .10), line=dict(width=0), showlegend=False, hoverinfo="skip", legendgroup=col))
        x = [full.index[-1]] + list(fm.index)
        y = [full[col].iloc[-1]] + list(fm[col])
        glow_line(fig, x, y, c, f"{name} (projected)", width=2, dash="dot", hovertemplate="$%{y:,.0f}", legendgroup=col, showlegend=False)
    fig.update_yaxes(**MONEY)
    return base(fig, "Trajectory · 6-month linear projection with 80% band", 380)


# ======================================================================= FINDINGS

def evidence(f) -> go.Figure | None:
    if f.series is None or len(f.series) < 2:
        return None
    s = f.series
    col = SEVERITY[f.severity]["color"]
    fig = go.Figure()
    is_pct = f.code in ("NEG_SAVINGS", "SAVINGS_SLIDE", "WEEKEND_DRIFT")
    is_idx = f.code == "SEASONAL"
    x = s.index
    if is_idx:
        x = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][: len(s)]
    ht = "%{y:.0%}" if is_pct else "%{y:.2f}×" if is_idx else "$%{y:,.0f}"
    if len(s) <= 24 and not isinstance(s.index, pd.RangeIndex) and f.code not in ("CRUNCH_WINDOW",) and not str(f.code).startswith(("PRECOG", "OVERDRAWN", "LOW_BAL", "VELOCITY")):
        fig.add_bar(x=x, y=s.values, marker=dict(color=rgba(col, .55), line=dict(color=col, width=1)), name=f.subject or "value", hovertemplate=ht)
    else:
        glow_line(fig, x, s.values, col, f.subject or "value", width=2, hovertemplate=ht, fill="tozeroy", fillcolor=rgba(col, .08))
    if f.baseline is not None and len(f.baseline):
        glow_line(fig, f.baseline.index, f.baseline.values, CYAN, "baseline / trend", width=1.6, dash="dash", hovertemplate=ht)
    if is_pct:
        fig.update_yaxes(tickformat=".0%")
    elif not is_idx:
        fig.update_yaxes(**MONEY)
    fig.add_hline(y=0, line=dict(color="rgba(255,255,255,.25)", width=1))
    return base(fig, None, 230, margin=dict(l=8, r=8, t=10, b=8), showlegend=False)


def findings_matrix(findings) -> go.Figure:
    from .detectors import MODULES, SEV_ORDER
    if not findings:
        return empty("No findings")
    df = pd.DataFrame([{"module": MODULES[f.module], "sev": f.severity} for f in findings])
    pv = df.pivot_table(index="module", columns="sev", aggfunc="size", fill_value=0).reindex(columns=SEV_ORDER, fill_value=0)
    pv = pv.loc[pv.sum(axis=1).sort_values().index]
    fig = go.Figure()
    for sev in SEV_ORDER:
        c = SEVERITY[sev]["color"]
        fig.add_bar(y=pv.index, x=pv[sev], orientation="h", name=f"{SEVERITY[sev]['icon']} {sev}", marker=dict(color=rgba(c, .75), line=dict(color=c, width=1)),
                    hovertemplate="%{x}<extra>" + sev + "</extra>")
    fig.update_layout(barmode="stack", hovermode="y unified", legend=dict(traceorder="normal"))
    fig.update_xaxes(dtick=1, title_text="case files")
    fig.update_yaxes(showspikes=False)
    return base(fig, "Case load by division", 40 * len(pv) + 120)


def findings_impact(findings, n: int = 12) -> go.Figure:
    fs = sorted([f for f in findings if f.impact > 0 and f.per_month], key=lambda f: -f.impact)[:n]
    if not fs:
        return empty("No ongoing $/month findings")
    fs = fs[::-1]
    labels = [(f.title[:58] + "…") if len(f.title) > 60 else f.title for f in fs]
    cols = [SEVERITY[f.severity]["color"] for f in fs]
    fig = go.Figure(go.Bar(y=labels, x=[f.impact for f in fs], orientation="h", marker=dict(color=[rgba(c, .7) for c in cols], line=dict(color=cols, width=1)),
                           hovertemplate="$%{x:,.0f}/month at stake<extra></extra>"))
    fig.update_xaxes(**MONEY, title_text="≈ $ per month at stake")
    fig.update_yaxes(showspikes=False, tickfont=dict(size=10))
    fig.update_layout(hovermode="closest", showlegend=False, margin=dict(l=8, r=12, t=48, b=8))
    return base(fig, "Ongoing drains · $ per month at stake", 34 * len(fs) + 110)
