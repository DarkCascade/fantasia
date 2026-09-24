"""The look: neon palette, page CSS, background FX layers and HUD widgets.

Everything is plain HTML/CSS/SVG strings rendered by st.html. No JavaScript,
no external requests: the fonts are served from ./static by Streamlit itself
(see .streamlit/config.toml).

Three FX levels, picked in the sidebar:
  MAX   - code rain, scanlines, sweeping scan beam, Tron floor, glitch title
  TAME  - static grid + glow only; nothing moves except on hover
  OFF   - flat dark theme, for long sessions or slow machines
`prefers-reduced-motion` forces animations off regardless.
"""

from __future__ import annotations

import html
import random

# --------------------------------------------------------------------------- palette
# Categorical order was checked with the dataviz palette validator against the
# #060913 surface: adjacent pairs clear deutan/protan ΔE 23+ and normal-vision
# ΔE 38+. They are deliberately brighter than a sober palette would allow.
CATEGORICAL = ["#00E5FF", "#FF5A36", "#2F7BFF", "#FFB000", "#A070FF", "#B4FF39", "#FF2BD6", "#00FFA3"]
OTHER = "#5B6B82"

CYAN = "#00E5FF"
MAGENTA = "#FF2BD6"
GREEN = "#00FF9C"
AMBER = "#FFB000"
RED = "#FF3355"
VIOLET = "#A070FF"
BLUE = "#2F7BFF"
LIME = "#B4FF39"
INK = "#D8F6FF"
INK_DIM = "#7F9BB8"
INK_MUTED = "#4C6480"
SURFACE = "#060913"
PANEL = "rgba(8, 18, 38, 0.72)"

INCOME_C = GREEN
SPEND_C = MAGENTA
NET_C = CYAN

SEVERITY = {
    "CRITICAL": {"color": "#FF1F4B", "icon": "⛔", "glyph": "◢◤"},
    "HIGH": {"color": "#FF7A1A", "icon": "▲", "glyph": "▲"},
    "MEDIUM": {"color": "#FFE14D", "icon": "◆", "glyph": "◆"},
    "LOW": {"color": "#35D6FF", "icon": "●", "glyph": "●"},
    "INFO": {"color": "#8FA6C4", "icon": "○", "glyph": "○"},
}

FONT_HEAD = "'Orbitron', 'Share Tech Mono', monospace"
FONT_MONO = "'Share Tech Mono', 'Consolas', 'Menlo', monospace"


def rgba(hex_color: str, a: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{a})"


def esc(s) -> str:
    return html.escape(str(s), quote=True)


# --------------------------------------------------------------------------- CSS

def page_css(fx: str) -> str:
    animate = fx == "MAX"
    glow = fx != "OFF"
    anim_off = "" if animate else """
*, *::before, *::after { animation: none !important; transition: none !important; }
.nl-ticker .track { padding-left: 150px; }
.nl-sub { max-width: 100%; }
"""
    glow_off = "" if glow else """
* { text-shadow: none !important; }
.nl-kpi, .nl-panel, .nl-case { box-shadow: none !important; }
"""
    return f"""<style>
:root {{
  --nl-cyan: {CYAN}; --nl-magenta: {MAGENTA}; --nl-green: {GREEN}; --nl-amber: {AMBER};
  --nl-red: {RED}; --nl-violet: {VIOLET}; --nl-ink: {INK}; --nl-dim: {INK_DIM}; --nl-muted: {INK_MUTED};
  --nl-surface: {SURFACE}; --nl-panel: {PANEL};
  --nl-head: {FONT_HEAD}; --nl-mono: {FONT_MONO};
}}

/* ---------- canvas ---------- */
.stApp {{
  background:
    radial-gradient(1200px 600px at 12% -10%, rgba(0,229,255,0.10), transparent 60%),
    radial-gradient(900px 700px at 105% 10%, rgba(255,43,214,0.10), transparent 55%),
    radial-gradient(900px 500px at 50% 120%, rgba(0,255,156,0.07), transparent 60%),
    linear-gradient(180deg, #03050B 0%, #050A18 55%, #03050B 100%) !important;
  color: var(--nl-ink);
}}
[data-testid="stHeader"] {{ background: transparent !important; }}
[data-testid="stMainBlockContainer"], .block-container {{ padding-top: 2.2rem !important; max-width: 1480px; }}
[data-testid="stAppViewContainer"] > .main, [data-testid="stMain"] {{ position: relative; z-index: 2; }}
::selection {{ background: rgba(255,43,214,0.45); color: #fff; }}
html {{ scrollbar-color: #00E5FF55 #03050B; }}
::-webkit-scrollbar {{ width: 10px; height: 10px; }}
::-webkit-scrollbar-track {{ background: #03050B; }}
::-webkit-scrollbar-thumb {{ background: linear-gradient(#00E5FF88, #FF2BD688); border-radius: 0; }}

/* ---------- type ---------- */
h1, h2, h3, h4 {{ font-family: var(--nl-head) !important; letter-spacing: .08em; text-transform: uppercase; }}
h2, h3 {{ color: var(--nl-cyan) !important; text-shadow: 0 0 6px rgba(0,229,255,.7), 0 0 22px rgba(0,229,255,.35); }}
p, li, label, .stMarkdown {{ font-family: var(--nl-mono); }}
code {{ color: var(--nl-green) !important; background: rgba(0,255,156,0.07) !important; }}
a {{ color: var(--nl-magenta) !important; }}

/* ---------- sidebar = control console ---------- */
[data-testid="stSidebar"] {{
  background: linear-gradient(180deg, rgba(4,10,24,0.97), rgba(10,4,24,0.97)) !important;
  border-right: 1px solid rgba(0,229,255,0.35);
  box-shadow: 6px 0 40px rgba(0,229,255,0.10), inset -1px 0 0 rgba(255,43,214,0.25);
}}
[data-testid="stSidebar"] h2, [data-testid="stSidebar"] h3 {{ font-size: .95rem !important; }}
[data-testid="stSidebarHeader"] {{ height: 1.2rem; }}

/* ---------- widgets ---------- */
.stButton > button, .stDownloadButton > button, [data-testid="stBaseButton-secondary"], [data-testid="stBaseButton-primary"] {{
  font-family: var(--nl-head) !important; letter-spacing: .12em; text-transform: uppercase; font-size: .72rem !important;
  border: 1px solid rgba(0,229,255,.6) !important; border-radius: 0 !important;
  background: linear-gradient(90deg, rgba(0,229,255,.10), rgba(255,43,214,.10)) !important;
  color: var(--nl-cyan) !important;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow: inset 0 0 12px rgba(0,229,255,.18);
  transition: all .15s ease;
}}
.stButton > button:hover, .stDownloadButton > button:hover {{
  color: #fff !important; background: linear-gradient(90deg, rgba(0,229,255,.35), rgba(255,43,214,.35)) !important;
  box-shadow: 0 0 18px rgba(0,229,255,.6), inset 0 0 18px rgba(255,43,214,.35);
  text-shadow: 0 0 8px #fff;
}}
[data-testid^="stBaseButton-secondary"], [data-testid^="stBaseButton-primary"] {{
  font-family: var(--nl-head) !important; letter-spacing: .12em; text-transform: uppercase; border-radius: 0 !important;
  border: 1px solid rgba(0,229,255,.6) !important; color: var(--nl-cyan) !important;
  background: linear-gradient(90deg, rgba(0,229,255,.10), rgba(255,43,214,.10)) !important;
}}
[data-testid^="stBaseButton-secondary"] p, [data-testid^="stBaseButton-primary"] p {{ font-family: var(--nl-head) !important; font-size: .72rem !important; }}
[data-testid^="stBaseButton-primary"] {{ border-color: var(--nl-magenta) !important; color: #fff !important;
  background: linear-gradient(90deg, rgba(255,43,214,.55), rgba(0,229,255,.40)) !important; text-shadow: 0 0 6px rgba(0,0,0,.8), 0 0 10px #fff; }}
[data-testid^="stBaseButton-primary"]:hover {{ box-shadow: 0 0 22px rgba(255,43,214,.7), inset 0 0 18px rgba(0,229,255,.5); }}

[data-baseweb="input"], [data-baseweb="select"] > div, [data-baseweb="textarea"], .stNumberInput input {{
  border-radius: 0 !important; background: rgba(0, 20, 40, .6) !important; font-family: var(--nl-mono) !important;
}}
[data-baseweb="input"]:focus-within, [data-baseweb="select"] > div:focus-within {{ box-shadow: 0 0 0 1px var(--nl-cyan), 0 0 14px rgba(0,229,255,.5) !important; }}
[data-baseweb="tag"], [data-testid="stMultiSelectTagsContainer"] [data-tag] {{
  border-radius: 0 !important; background: rgba(255,43,214,.22) !important; border: 1px solid rgba(255,43,214,.7) !important; color: #fff !important; }}
[data-baseweb="tag"] *, [data-testid="stMultiSelectTagsContainer"] [data-tag] * {{ color: #fff !important; fill: #fff !important; background: transparent !important; }}
[data-testid="stFileUploaderDropzone"] {{
  border: 1px dashed rgba(0,229,255,.7) !important; border-radius: 0 !important;
  background: repeating-linear-gradient(45deg, rgba(0,229,255,.05) 0 10px, rgba(0,0,0,0) 10px 20px) !important;
}}
[data-testid="stExpander"] details {{ border: 1px solid rgba(0,229,255,.25) !important; border-radius: 0 !important; background: rgba(4,12,28,.55); }}
[data-testid="stExpander"] summary {{ font-family: var(--nl-head); letter-spacing: .1em; text-transform: uppercase; font-size: .78rem; }}
[data-testid="stExpander"] summary:hover {{ color: var(--nl-cyan) !important; text-shadow: 0 0 8px var(--nl-cyan); }}
div[data-testid="stSlider"] [role="slider"] {{ box-shadow: 0 0 12px var(--nl-cyan); }}

/* ---------- tabs = holo nav ---------- */
[role="tablist"] {{
  gap: 4px !important; border-bottom: 1px solid rgba(0,229,255,.35); flex-wrap: wrap !important; overflow: visible !important;
  background: linear-gradient(90deg, rgba(0,229,255,.05), rgba(255,43,214,.05));
  padding: 4px 4px 0 4px;
}}
[data-testid="stTab"] {{
  border: 1px solid rgba(0,229,255,.22) !important; border-bottom: none !important; padding: 8px 12px !important; margin: 0 !important;
  background: rgba(0,10,24,.6) !important; color: var(--nl-dim) !important; cursor: pointer;
  clip-path: polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px); transition: background .15s ease, color .15s ease;
}}
[data-testid="stTab"] p {{ font-family: var(--nl-head) !important; font-size: .66rem !important; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; }}
[data-testid="stTab"]:hover {{ color: var(--nl-cyan) !important; background: rgba(0,229,255,.10) !important; }}
[data-testid="stTab"][aria-selected="true"] {{
  color: #fff !important; border-color: var(--nl-cyan) !important;
  background: linear-gradient(180deg, rgba(0,229,255,.35), rgba(255,43,214,.18)) !important;
  text-shadow: 0 0 8px #fff, 0 0 18px var(--nl-cyan);
  box-shadow: inset 0 -3px 0 var(--nl-magenta), 0 -4px 22px rgba(0,229,255,.45);
}}
[data-testid="stTab"][aria-selected="true"]::after {{ display: none; }}

/* ---------- charts & tables sit in holo panels ---------- */
[data-testid="stPlotlyChart"], [data-testid="stDataFrame"], [data-testid="stDataEditor"] {{
  border: 1px solid rgba(0,229,255,.20);
  background:
    linear-gradient(var(--nl-cyan), var(--nl-cyan)) top left / 14px 2px no-repeat,
    linear-gradient(var(--nl-cyan), var(--nl-cyan)) top left / 2px 14px no-repeat,
    linear-gradient(var(--nl-magenta), var(--nl-magenta)) bottom right / 14px 2px no-repeat,
    linear-gradient(var(--nl-magenta), var(--nl-magenta)) bottom right / 2px 14px no-repeat,
    rgba(4, 12, 28, .55);
  box-shadow: inset 0 0 40px rgba(0,229,255,.04);
  padding: 4px;
  transition: box-shadow .2s ease, border-color .2s ease;
}}
[data-testid="stPlotlyChart"]:hover {{ border-color: rgba(0,229,255,.55); box-shadow: 0 0 24px rgba(0,229,255,.18), inset 0 0 40px rgba(0,229,255,.06); }}
.js-plotly-plot .plotly .modebar {{ background: transparent !important; }}
.js-plotly-plot .plotly .modebar-btn path {{ fill: var(--nl-dim) !important; }}
.js-plotly-plot .plotly .modebar-btn:hover path {{ fill: var(--nl-cyan) !important; }}

[data-testid="stAlert"] {{ border-radius: 0 !important; border-left: 3px solid currentColor; font-family: var(--nl-mono); }}
[data-testid="stCaptionContainer"] {{ color: var(--nl-dim) !important; font-family: var(--nl-mono); }}
hr {{ border-color: rgba(0,229,255,.25) !important; }}

/* ================================================================ HUD components */
.nl-hdr {{ position: relative; padding: 6px 0 14px 0; margin-bottom: 8px; border-bottom: 1px solid rgba(0,229,255,.25); }}
.nl-hdr .row {{ display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }}
.nl-hdr .row > div {{ min-width: 0; max-width: 100%; }}
.nl-title {{
  position: relative; font-family: var(--nl-head); font-weight: 900; font-size: clamp(2rem, 4.6vw, 3.7rem);
  letter-spacing: .14em; line-height: 1; color: #EFFFFF; margin: 0;
  text-shadow: 0 0 4px #fff, 0 0 12px var(--nl-cyan), 0 0 28px var(--nl-cyan), 0 0 60px rgba(0,229,255,.6), 3px 0 0 rgba(255,43,214,.75), -3px 0 0 rgba(0,229,255,.75);
}}
.nl-title .sl {{ color: var(--nl-magenta); text-shadow: 0 0 10px var(--nl-magenta), 0 0 30px var(--nl-magenta); }}
.nl-title::before, .nl-title::after {{
  content: attr(data-text); position: absolute; left: 0; top: 0; width: 100%; overflow: hidden;
  color: #fff; background: transparent; pointer-events: none;
}}
.nl-title::before {{ text-shadow: -2px 0 var(--nl-magenta); animation: nl-glitch-a 3.6s infinite steps(1); clip-path: inset(0 0 0 0); opacity: .0; }}
.nl-title::after  {{ text-shadow:  2px 0 var(--nl-cyan);    animation: nl-glitch-b 2.9s infinite steps(1); clip-path: inset(0 0 0 0); opacity: .0; }}
@keyframes nl-glitch-a {{
  0%, 88%, 100% {{ opacity: 0; transform: none; }}
  89% {{ opacity: .9; clip-path: inset(12% 0 60% 0); transform: translate(-6px, -1px); }}
  91% {{ opacity: .9; clip-path: inset(55% 0 20% 0); transform: translate(5px, 1px); }}
  93% {{ opacity: .9; clip-path: inset(30% 0 45% 0); transform: translate(-3px, 0); }}
}}
@keyframes nl-glitch-b {{
  0%, 80%, 100% {{ opacity: 0; transform: none; }}
  81% {{ opacity: .85; clip-path: inset(70% 0 5% 0); transform: translate(7px, 0); }}
  84% {{ opacity: .85; clip-path: inset(5% 0 80% 0); transform: translate(-7px, 1px); }}
}}
.nl-sub {{ font-family: var(--nl-mono); color: var(--nl-green); font-size: .9rem; letter-spacing: .06em; margin-top: 8px;
  text-shadow: 0 0 8px rgba(0,255,156,.7); white-space: nowrap; overflow: hidden; border-right: 2px solid var(--nl-green);
  width: fit-content; max-width: 100%; animation: nl-type 2.4s steps(60, end) 1, nl-caret .8s step-end infinite; }}
@keyframes nl-type {{ from {{ max-width: 0; }} to {{ max-width: 100%; }} }}
@keyframes nl-caret {{ 50% {{ border-color: transparent; }} }}
.nl-chips {{ display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }}
.nl-chip {{ font-family: var(--nl-mono); font-size: .7rem; letter-spacing: .12em; padding: 3px 8px; border: 1px solid currentColor;
  text-transform: uppercase; background: rgba(0,0,0,.35); box-shadow: 0 0 10px currentColor inset; }}
.nl-chip .dot {{ display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin-right: 6px;
  box-shadow: 0 0 8px currentColor; animation: nl-pulse 1.6s ease-in-out infinite; }}
@keyframes nl-pulse {{ 0%,100% {{ opacity: 1; }} 50% {{ opacity: .25; }} }}

.nl-section {{ margin: 22px 0 10px 0; display: flex; align-items: baseline; gap: 14px; }}
.nl-section .num {{ font-family: var(--nl-head); color: var(--nl-magenta); font-size: .78rem; letter-spacing: .2em;
  text-shadow: 0 0 10px var(--nl-magenta); white-space: nowrap; }}
.nl-section .ttl {{ font-family: var(--nl-head); color: #fff; font-size: 1.05rem; letter-spacing: .16em; text-transform: uppercase;
  text-shadow: 0 0 8px var(--nl-cyan), 0 0 20px rgba(0,229,255,.5); }}
.nl-section {{ flex-wrap: wrap; }}
.nl-section .bar {{ flex: 1; height: 1px; min-width: 40px; background: linear-gradient(90deg, var(--nl-cyan), var(--nl-magenta), transparent);
  box-shadow: 0 0 8px var(--nl-cyan); position: relative; overflow: hidden; }}
.nl-section .bar::after {{ content: ""; position: absolute; top: -1px; left: -30%; width: 30%; height: 3px;
  background: linear-gradient(90deg, transparent, #fff, transparent); animation: nl-sweep 3.2s linear infinite; }}
@keyframes nl-sweep {{ to {{ left: 130%; }} }}
.nl-section .hint {{ font-family: var(--nl-mono); color: var(--nl-dim); font-size: .8rem; }}
.nl-readout {{ font-family: var(--nl-mono); color: var(--nl-dim); font-size: .8rem; margin: -2px 0 12px 2px; line-height: 1.45; }}
.nl-readout b {{ color: var(--nl-cyan); font-weight: normal; }}
.nl-readout::before {{ content: "▸ READOUT // "; color: var(--nl-magenta); letter-spacing: .1em; }}

/* KPI tiles */
.nl-kpis {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 8px 0 6px 0; }}
.nl-kpi {{
  position: relative; padding: 12px 14px 10px 14px; min-height: 118px; overflow: hidden;
  background: linear-gradient(160deg, rgba(0,229,255,.08), rgba(8,14,32,.85) 40%, rgba(255,43,214,.06));
  border: 1px solid var(--c); box-shadow: 0 0 16px color-mix(in srgb, var(--c) 35%, transparent), inset 0 0 22px color-mix(in srgb, var(--c) 12%, transparent);
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
  animation: nl-boot-in .6s ease-out both; animation-delay: var(--d, 0s);
}}
.nl-kpi::after {{ content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,.10) 45%, transparent 60%); transform: translateX(-120%);
  animation: nl-sheen 6s ease-in-out infinite; animation-delay: var(--d, 0s); }}
@keyframes nl-sheen {{ 0%, 70% {{ transform: translateX(-120%); }} 100% {{ transform: translateX(120%); }} }}
@keyframes nl-boot-in {{ from {{ opacity: 0; transform: translateY(8px) scale(.98); filter: blur(4px); }} to {{ opacity: 1; transform: none; filter: none; }} }}
.nl-kpi .lbl {{ font-family: var(--nl-head); font-size: .62rem; letter-spacing: .2em; color: var(--nl-dim); text-transform: uppercase; }}
.nl-kpi .val {{ font-family: var(--nl-head); font-weight: 700; font-size: 1.55rem; color: #fff; margin-top: 4px; white-space: nowrap;
  text-shadow: 0 0 6px var(--c), 0 0 18px var(--c); }}
.nl-kpi .sub {{ font-family: var(--nl-mono); font-size: .74rem; color: var(--nl-dim); margin-top: 2px; }}
.nl-kpi .delta {{ font-family: var(--nl-mono); font-size: .74rem; margin-left: 4px; }}
.nl-kpi .delta.good {{ color: var(--nl-green); }} .nl-kpi .delta.bad {{ color: #FF6B8B; }}
.nl-kpi svg {{ position: absolute; right: 8px; bottom: 8px; opacity: .95; }}

/* ticker */
.nl-ticker {{ position: relative; overflow: hidden; white-space: nowrap; border-top: 1px solid rgba(255,43,214,.5); border-bottom: 1px solid rgba(255,43,214,.5);
  background: linear-gradient(90deg, rgba(255,43,214,.16), rgba(0,0,0,.4) 12%, rgba(0,0,0,.4) 88%, rgba(0,229,255,.16));
  padding: 7px 0; margin: 6px 0 12px 0; font-family: var(--nl-mono); font-size: .86rem; }}
.nl-ticker .lab {{ position: absolute; left: 0; top: 0; bottom: 0; z-index: 2; display: flex; align-items: center; padding: 0 14px;
  background: #1A0417; border-right: 1px solid var(--nl-magenta); color: var(--nl-magenta); font-family: var(--nl-head); font-size: .66rem;
  letter-spacing: .2em; text-shadow: 0 0 8px var(--nl-magenta); box-shadow: 12px 0 18px #03050B; }}
.nl-ticker .track {{ display: inline-block; padding-left: 100%; animation: nl-marquee var(--dur, 60s) linear infinite; }}
.nl-ticker:hover .track {{ animation-play-state: paused; }}
.nl-ticker .it {{ margin-right: 48px; }}
@keyframes nl-marquee {{ from {{ transform: translateX(0); }} to {{ transform: translateX(-100%); }} }}

/* case files (findings) */
.nl-case {{ position: relative; margin: 0 0 12px 0; padding: 12px 16px 12px 18px; border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 14%, transparent), rgba(6,10,24,.85) 30%);
  box-shadow: 0 0 14px color-mix(in srgb, var(--c) 22%, transparent); animation: nl-boot-in .5s ease-out both; animation-delay: var(--d, 0s); }}
.nl-case::before {{ content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c); box-shadow: 0 0 12px var(--c); }}
.nl-case .top {{ display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-family: var(--nl-mono); font-size: .72rem; letter-spacing: .1em; color: var(--nl-dim); }}
.nl-case .sev {{ color: #06060c; background: var(--c); padding: 1px 8px; font-family: var(--nl-head); font-size: .62rem; letter-spacing: .18em; box-shadow: 0 0 10px var(--c); }}
.nl-case .mod {{ border: 1px solid rgba(127,155,184,.5); padding: 0 6px; }}
.nl-case .imp {{ margin-left: auto; color: var(--c); text-shadow: 0 0 8px var(--c); font-size: .8rem; }}
.nl-case .ttl {{ font-family: var(--nl-head); color: #fff; font-size: .98rem; letter-spacing: .06em; margin: 6px 0 4px 0; text-shadow: 0 0 10px color-mix(in srgb, var(--c) 70%, transparent); }}
.nl-case .det {{ font-family: var(--nl-mono); color: #BFD8EC; font-size: .86rem; line-height: 1.45; }}
.nl-case .act {{ font-family: var(--nl-mono); color: var(--nl-green); font-size: .8rem; margin-top: 6px; }}
.nl-case .act::before {{ content: "» DIRECTIVE: "; color: var(--nl-magenta); }}
.nl-case.crit {{ animation: nl-boot-in .5s ease-out both, nl-alarm 1.8s ease-in-out infinite; }}
@keyframes nl-alarm {{ 50% {{ box-shadow: 0 0 30px color-mix(in srgb, var(--c) 55%, transparent); }} }}

/* generic panel + empty state */
.nl-panel {{ position: relative; padding: 18px 22px; border: 1px solid rgba(0,229,255,.35); background: rgba(4,12,28,.7);
  box-shadow: 0 0 30px rgba(0,229,255,.12), inset 0 0 40px rgba(0,229,255,.05); font-family: var(--nl-mono); }}
.nl-panel h4 {{ margin: 0 0 8px 0; color: var(--nl-cyan); text-shadow: 0 0 10px var(--nl-cyan); font-size: .9rem; }}
.nl-panel pre {{ background: rgba(0,0,0,.45); border: 1px solid rgba(0,255,156,.25); color: var(--nl-green); padding: 10px; font-size: .8rem; overflow-x: auto; }}
.nl-await {{ text-align: center; padding: 40px 10px 10px 10px; }}
.nl-await .big {{ font-family: var(--nl-head); font-size: clamp(1.4rem, 3vw, 2.4rem); letter-spacing: .3em; color: #fff;
  text-shadow: 0 0 10px var(--nl-magenta), 0 0 40px var(--nl-magenta); animation: nl-pulse 2.2s ease-in-out infinite; }}
.nl-await .ring {{ width: 170px; height: 170px; margin: 26px auto; border-radius: 50%; position: relative;
  border: 2px solid rgba(0,229,255,.25); box-shadow: 0 0 30px rgba(0,229,255,.35), inset 0 0 30px rgba(0,229,255,.25); }}
.nl-await .ring::before, .nl-await .ring::after {{ content: ""; position: absolute; inset: 12px; border-radius: 50%;
  border: 3px solid transparent; border-top-color: var(--nl-cyan); border-right-color: var(--nl-magenta); animation: nl-spin 2.4s linear infinite; }}
.nl-await .ring::after {{ inset: 34px; border-top-color: var(--nl-green); border-left-color: var(--nl-amber); animation-duration: 1.5s; animation-direction: reverse; }}
@keyframes nl-spin {{ to {{ transform: rotate(360deg); }} }}

/* boot overlay (first load only) */
.nl-boot {{ position: fixed; inset: 0; z-index: 999999; background: #020409; display: flex; align-items: center; justify-content: center;
  animation: nl-boot-out .6s ease-in 2.7s forwards; pointer-events: none; }}
.nl-boot .log {{ font-family: var(--nl-mono); color: var(--nl-green); font-size: .95rem; line-height: 1.7; text-shadow: 0 0 8px rgba(0,255,156,.8); min-width: min(560px, 90vw); }}
.nl-boot .log div {{ opacity: 0; animation: nl-line .01s linear forwards; animation-delay: var(--d); white-space: nowrap; overflow: hidden; }}
.nl-boot .log .ok {{ color: var(--nl-cyan); }} .nl-boot .log .warn {{ color: var(--nl-amber); }}
@keyframes nl-line {{ to {{ opacity: 1; }} }}
@keyframes nl-boot-out {{ to {{ opacity: 0; visibility: hidden; }} }}

/* ================================================================ background FX */
.nl-fx {{ position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }}
.nl-rain span {{ position: absolute; top: -110vh; font-family: var(--nl-mono); font-size: 15px; line-height: 17px; color: #00FF9C;
  writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 1px; white-space: nowrap;
  text-shadow: 0 0 6px rgba(0,255,156,.9);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.35) 45%, #000 92%, transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.35) 45%, #000 92%, transparent 100%);
  animation: nl-fall linear infinite; }}
.nl-rain span.hot {{ color: #B8FFE6; }}
.nl-rain span.alt {{ color: #00E5FF; text-shadow: 0 0 6px rgba(0,229,255,.9); }}
@keyframes nl-fall {{ from {{ transform: translateY(0); }} to {{ transform: translateY(230vh); }} }}
.nl-grid-floor {{ position: fixed; left: -50%; right: -50%; bottom: -8vh; height: 46vh; pointer-events: none; z-index: 0;
  background-image: linear-gradient(rgba(255,43,214,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,.45) 1px, transparent 1px);
  background-size: 60px 60px; transform: perspective(420px) rotateX(64deg); transform-origin: 50% 100%;
  -webkit-mask-image: linear-gradient(to top, #000 10%, transparent 90%); mask-image: linear-gradient(to top, #000 10%, transparent 90%);
  animation: nl-floor 2.2s linear infinite; }}
@keyframes nl-floor {{ to {{ background-position: 0 60px; }} }}
.nl-scan {{ position: fixed; inset: 0; pointer-events: none; z-index: 99990;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.20) 0 1px, transparent 1px 3px); mix-blend-mode: multiply; }}
.nl-beam {{ position: fixed; left: 0; right: 0; height: 120px; top: -120px; pointer-events: none; z-index: 99991;
  background: linear-gradient(180deg, transparent, rgba(0,229,255,.06) 60%, rgba(0,229,255,.16) 96%, transparent);
  animation: nl-beam 9s linear infinite; }}
@keyframes nl-beam {{ to {{ top: 110vh; }} }}
.nl-vignette {{ position: fixed; inset: 0; pointer-events: none; z-index: 1;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%); }}
.nl-static-grid {{ position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image: linear-gradient(rgba(0,229,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,.05) 1px, transparent 1px);
  background-size: 48px 48px; }}

@media (prefers-reduced-motion: reduce) {{
  *, *::before, *::after {{ animation: none !important; transition: none !important; }}
  .nl-rain, .nl-beam {{ display: none; }}
  .nl-sub {{ max-width: 100%; }}
  .nl-ticker .track {{ padding-left: 150px; }}
}}
@media (max-width: 700px) {{
  .nl-sub {{ white-space: normal; border-right: none; animation: none; }}
  .nl-chips {{ justify-content: flex-start; }}
  .nl-kpi .val {{ font-size: 1.25rem; }}
  .nl-rain span:nth-child(2n) {{ display: none; }}
}}
{anim_off}
{glow_off}
</style>"""


# --------------------------------------------------------------------------- FX layers

_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789$¥€£₿%+-=<>∑∆Ξ"


def fx_layers(fx: str, seed: int = 1999) -> str:
    if fx == "OFF":
        return ""
    if fx == "TAME":
        return '<div class="nl-fx"><div class="nl-static-grid"></div></div><div class="nl-vignette"></div>'
    rnd = random.Random(seed)
    cols = []
    n = 42
    for i in range(n):
        left = (i + rnd.random() * 0.8) * (100 / n)
        length = rnd.randint(14, 34)
        chars = "".join(rnd.choice(_GLYPHS) for _ in range(length))
        dur = rnd.uniform(9, 24)
        delay = -rnd.uniform(0, dur)
        size = rnd.choice([13, 14, 15, 16, 18])
        op = rnd.uniform(0.10, 0.32)
        cls = "hot" if rnd.random() < 0.12 else ("alt" if rnd.random() < 0.18 else "")
        cols.append(f'<span class="{cls}" style="left:{left:.2f}%;animation-duration:{dur:.1f}s;animation-delay:{delay:.1f}s;'
                    f'font-size:{size}px;opacity:{op:.2f}">{chars}</span>')
    return ('<div class="nl-fx nl-rain">' + "".join(cols) + "</div>"
            '<div class="nl-grid-floor"></div><div class="nl-vignette"></div><div class="nl-scan"></div><div class="nl-beam"></div>')


def boot_overlay(n_tx: int, n_files: int, n_findings: int, n_rules: int = 23) -> str:
    lines = [
        ("> NEON//LEDGER v1.0 :: cold boot", ""),
        ("> network interfaces ............ NONE (sealed)", "ok"),
        ("> telemetry ..................... DISABLED", "ok"),
        (f"> data link ..................... {n_files} file(s), {n_tx:,} transactions", ""),
        ("> ingest :: sniff / map / normalise .... OK", "ok"),
        (f"> categoriser :: {n_rules} rule banks ........ OK", "ok"),
        ("> recurrence scanner .................. OK", "ok"),
        ("> precog array :: 3/3 online .......... OK", "ok"),
        (f"> pre-crime division :: {n_findings} case file(s) opened", "warn" if n_findings else "ok"),
        ("> rendering holo-display_", ""),
    ]
    body = "".join(f'<div class="{c}" style="--d:{0.12 + i * 0.22:.2f}s">{esc(t)}</div>' for i, (t, c) in enumerate(lines))
    return f'<div class="nl-boot"><div class="log">{body}</div></div>'


# --------------------------------------------------------------------------- widgets

def header(subtitle: str, chips: list[tuple[str, str]]) -> str:
    chip_html = "".join(f'<span class="nl-chip" style="color:{c}"><span class="dot"></span>{esc(t)}</span>' for t, c in chips)
    return (f'<div class="nl-hdr"><div class="row"><div>'
            f'<div class="nl-title" data-text="NEON//LEDGER">NEON<span class="sl">//</span>LEDGER</div>'
            f'<div class="nl-sub">{esc(subtitle)}</div></div>'
            f'<div class="nl-chips">{chip_html}</div></div></div>')


def section(num: str, title: str, hint: str = "") -> str:
    h = f'<span class="hint">{esc(hint)}</span>' if hint else ""
    return f'<div class="nl-section"><span class="num">{esc(num)}</span><span class="ttl">{esc(title)}</span><span class="bar"></span>{h}</div>'


def readout(text_html: str) -> str:
    return f'<div class="nl-readout">{text_html}</div>'


def sparkline_svg(values, color: str, w: int = 92, h: int = 30) -> str:
    vals = [float(v) for v in values if v == v]
    if len(vals) < 2:
        return ""
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    pts = [(i * (w - 4) / (len(vals) - 1) + 2, h - 3 - (v - lo) / span * (h - 6)) for i, v in enumerate(vals)]
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = d + f" L{pts[-1][0]:.1f},{h} L{pts[0][0]:.1f},{h} Z"
    fid = f"g{abs(hash((tuple(vals), color))) % 10**8}"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true">'
            f'<defs><filter id="{fid}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/>'
            f'<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
            f'<linearGradient id="{fid}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{color}" stop-opacity=".35"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="0"/></linearGradient></defs>'
            f'<path d="{area}" fill="url(#{fid}a)"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8" filter="url(#{fid})"/>'
            f'<circle cx="{pts[-1][0]:.1f}" cy="{pts[-1][1]:.1f}" r="2.6" fill="#fff" filter="url(#{fid})"/></svg>')


def kpi(label: str, value: str, color: str, sub: str = "", delta: str | None = None, good: bool | None = None,
        spark=None, delay: float = 0.0) -> str:
    dl = ""
    if delta:
        cls = "good" if good else ("bad" if good is False else "")
        dl = f'<span class="delta {cls}">{esc(delta)}</span>'
    sp = sparkline_svg(spark, color) if spark is not None else ""
    return (f'<div class="nl-kpi" style="--c:{color};--d:{delay:.2f}s"><div class="lbl">{esc(label)}</div>'
            f'<div class="val">{esc(value)}</div><div class="sub">{esc(sub)}{dl}</div>{sp}</div>')


def kpi_row(tiles: list[str]) -> str:
    return '<div class="nl-kpis">' + "".join(tiles) + "</div>"


def ticker(items: list[tuple[str, str]], label: str = "PRE-CRIME FEED") -> str:
    if not items:
        items = [("ALL SYSTEMS NOMINAL - NO ACTIVE CASE FILES", "#00FF9C")]
    parts = "".join(f'<span class="it" style="color:{c};text-shadow:0 0 8px {c}">{esc(t)}</span>' for t, c in items)
    dur = max(30, 7 * len(items))
    return f'<div class="nl-ticker"><span class="lab">◉ {esc(label)}</span><span class="track" style="--dur:{dur}s">{parts}{parts}</span></div>'


def case_file(f, idx: int, impact_text: str, module_name: str) -> str:
    s = SEVERITY[f.severity]
    crit = " crit" if f.severity == "CRITICAL" else ""
    act = f'<div class="act">{esc(f.action)}</div>' if getattr(f, "action", "") else ""
    imp = f'<span class="imp">{esc(impact_text)}</span>' if impact_text else ""
    return (f'<div class="nl-case{crit}" style="--c:{s["color"]};--d:{min(idx, 12) * 0.04:.2f}s">'
            f'<div class="top"><span class="sev">{s["icon"]} {esc(f.severity)}</span><span>CASE #{idx + 1:04d}-{esc(f.code)}</span>'
            f'<span class="mod">{esc(module_name)}</span>{imp}</div>'
            f'<div class="ttl">{esc(f.title)}</div><div class="det">{esc(f.detail)}</div>{act}</div>')


def panel(inner_html: str) -> str:
    return f'<div class="nl-panel">{inner_html}</div>'
