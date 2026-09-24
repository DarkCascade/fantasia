"""Shared look for every Glimmerdark PDF: fonts, colours, suit glyphs, mini
playing cards, glimmer tokens, cut and registration marks.

Print-friendly by design: white paper, dark ink, colour used for identity
(suits, delvers, glimmer values) rather than big flooded areas.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"
DIST = HERE.parent / "dist"

_REGISTERED = False


def register_fonts() -> None:
    global _REGISTERED
    if _REGISTERED:
        return
    for name in ("Cinzel-Regular", "Cinzel-Bold", "Cinzel-Black", "Alegreya-Regular", "Alegreya-Italic",
                 "Alegreya-Bold", "Alegreya-BoldItalic", "AlegreyaSans-Regular", "AlegreyaSans-Italic",
                 "AlegreyaSans-Bold", "AlegreyaSans-ExtraBold", "DejaVuSans", "DejaVuSans-Bold", "DejaVuSansMono"):
        pdfmetrics.registerFont(TTFont(name, str(FONTS / f"{name}.ttf")))
    pdfmetrics.registerFontFamily("Alegreya", normal="Alegreya-Regular", bold="Alegreya-Bold",
                                  italic="Alegreya-Italic", boldItalic="Alegreya-BoldItalic")
    pdfmetrics.registerFontFamily("AlegreyaSans", normal="AlegreyaSans-Regular", bold="AlegreyaSans-Bold",
                                  italic="AlegreyaSans-Italic", boldItalic="AlegreyaSans-Bold")
    _REGISTERED = True


register_fonts()

# ------------------------------------------------------------------ palette
INK = HexColor("#1F1B16")
INK_SOFT = HexColor("#5A5248")
INK_FAINT = HexColor("#9A9186")
PAPER = colors.white
PARCHMENT = HexColor("#F6EEDD")
PARCHMENT_DEEP = HexColor("#EADFC6")
RULE = HexColor("#CDBF9F")
STONE = HexColor("#3A3F46")
STONE_LIGHT = HexColor("#6E757E")
GLOW = HexColor("#1C8C94")       # glimmer teal
GLOW_LIGHT = HexColor("#BFE8EA")
GOLD = HexColor("#B8893A")
WARDEN = HexColor("#5E6A73")
DANGER = HexColor("#B3261E")

# four-colour deck convention for veins (shape always shown too)
SUIT_COLOR = {"S": HexColor("#1F1F24"), "H": HexColor("#C8102E"), "D": HexColor("#1F5FAD"), "C": HexColor("#1C7C3A")}
SUIT_GLYPH = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}
SUIT_NAME = {"S": "Spades", "H": "Hearts", "D": "Diamonds", "C": "Clubs"}
SUIT_FROM_INT = ["S", "H", "D", "C"]

# glimmer token colours by value
GLIMMER = {1: (HexColor("#DDF4F5"), HexColor("#4FB7BD")), 2: (HexColor("#BDE3E6"), HexColor("#1C8C94")),
           4: (HexColor("#D8CCF0"), HexColor("#5B3FA0")), 5: (HexColor("#F3E2B0"), HexColor("#B8893A"))}

TITLE_FONT = "Cinzel-Bold"
TITLE_BLACK = "Cinzel-Black"
BODY_FONT = "Alegreya-Regular"
LABEL_FONT = "AlegreyaSans-Bold"
SANS = "AlegreyaSans-Regular"
GLYPH_FONT = "DejaVuSans"

# ------------------------------------------------------------------ text
_SUIT_RE = re.compile(r"\{([SHDC])\}")


def markup(text: str) -> str:
    """{H} -> coloured glyph, safe for reportlab Paragraph XML."""
    text = text.replace("&", "&amp;")
    return _SUIT_RE.sub(lambda m: f'<font name="{GLYPH_FONT}" color="{SUIT_COLOR[m.group(1)].hexval().replace("0x", "#")}">'
                                  f'{SUIT_GLYPH[m.group(1)]}</font>', text)


def styles(base_size: float = 10.5) -> dict[str, ParagraphStyle]:
    lead = base_size * 1.32
    return {
        "body": ParagraphStyle("body", fontName="Alegreya-Regular", fontSize=base_size, leading=lead, textColor=INK),
        "body_c": ParagraphStyle("body_c", fontName="Alegreya-Regular", fontSize=base_size, leading=lead,
                                 textColor=INK, alignment=TA_CENTER),
        "small": ParagraphStyle("small", fontName="Alegreya-Regular", fontSize=base_size * 0.86,
                                leading=base_size * 1.12, textColor=INK),
        "tiny": ParagraphStyle("tiny", fontName="AlegreyaSans-Regular", fontSize=base_size * 0.72,
                               leading=base_size * 0.9, textColor=INK_SOFT),
        "italic": ParagraphStyle("italic", fontName="Alegreya-Italic", fontSize=base_size, leading=lead, textColor=INK_SOFT),
        "h1": ParagraphStyle("h1", fontName=TITLE_FONT, fontSize=base_size * 2.1, leading=base_size * 2.4,
                             textColor=INK, spaceAfter=4),
        "h2": ParagraphStyle("h2", fontName=TITLE_FONT, fontSize=base_size * 1.45, leading=base_size * 1.7,
                             textColor=INK, spaceBefore=8, spaceAfter=3),
        "h3": ParagraphStyle("h3", fontName=LABEL_FONT, fontSize=base_size * 1.08, leading=base_size * 1.3,
                             textColor=GLOW, spaceBefore=5, spaceAfter=1),
        "label": ParagraphStyle("label", fontName=LABEL_FONT, fontSize=base_size * 0.95, leading=base_size * 1.15,
                                textColor=INK),
        "cell": ParagraphStyle("cell", fontName="Alegreya-Regular", fontSize=base_size * 0.92,
                               leading=base_size * 1.13, textColor=INK),
        "cell_b": ParagraphStyle("cell_b", fontName="AlegreyaSans-Bold", fontSize=base_size * 0.95,
                                 leading=base_size * 1.13, textColor=INK),
    }


def P(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup(text), style)


# ------------------------------------------------------------------ vector suit glyphs
def suit_path(c, suit: str, cx: float, cy: float, size: float):
    """A filled suit shape centred on (cx, cy), `size` = overall height."""
    s = size / 2.0
    p = c.beginPath()
    if suit == "D":
        p.moveTo(cx, cy + s)
        p.curveTo(cx + s * 0.35, cy + s * 0.35, cx + s * 0.62, cy + s * 0.1, cx + s * 0.72, cy)
        p.curveTo(cx + s * 0.62, cy - s * 0.1, cx + s * 0.35, cy - s * 0.35, cx, cy - s)
        p.curveTo(cx - s * 0.35, cy - s * 0.35, cx - s * 0.62, cy - s * 0.1, cx - s * 0.72, cy)
        p.curveTo(cx - s * 0.62, cy + s * 0.1, cx - s * 0.35, cy + s * 0.35, cx, cy + s)
        p.close()
    elif suit == "H":
        p.moveTo(cx, cy - s)
        p.curveTo(cx - s * 0.2, cy - s * 0.55, cx - s * 0.95, cy - s * 0.2, cx - s * 0.95, cy + s * 0.35)
        p.curveTo(cx - s * 0.95, cy + s * 0.85, cx - s * 0.2, cy + s * 1.0, cx, cy + s * 0.55)
        p.curveTo(cx + s * 0.2, cy + s * 1.0, cx + s * 0.95, cy + s * 0.85, cx + s * 0.95, cy + s * 0.35)
        p.curveTo(cx + s * 0.95, cy - s * 0.2, cx + s * 0.2, cy - s * 0.55, cx, cy - s)
        p.close()
    elif suit == "S":
        top = cy + s
        p.moveTo(cx, top)
        p.curveTo(cx + s * 0.25, cy + s * 0.55, cx + s * 0.95, cy + s * 0.2, cx + s * 0.95, cy - s * 0.25)
        p.curveTo(cx + s * 0.95, cy - s * 0.65, cx + s * 0.35, cy - s * 0.75, cx + s * 0.08, cy - s * 0.4)
        p.curveTo(cx + s * 0.12, cy - s * 0.75, cx + s * 0.3, cy - s * 0.95, cx + s * 0.42, cy - s)
        p.lineTo(cx - s * 0.42, cy - s)
        p.curveTo(cx - s * 0.3, cy - s * 0.95, cx - s * 0.12, cy - s * 0.75, cx - s * 0.08, cy - s * 0.4)
        p.curveTo(cx - s * 0.35, cy - s * 0.75, cx - s * 0.95, cy - s * 0.65, cx - s * 0.95, cy - s * 0.25)
        p.curveTo(cx - s * 0.95, cy + s * 0.2, cx - s * 0.25, cy + s * 0.55, cx, top)
        p.close()
    elif suit == "C":
        r = s * 0.44
        p.circle(cx, cy + s * 0.5, r)
        p.circle(cx - s * 0.5, cy - s * 0.08, r)
        p.circle(cx + s * 0.5, cy - s * 0.08, r)
        p.moveTo(cx - s * 0.12, cy)
        p.curveTo(cx - s * 0.12, cy - s * 0.6, cx - s * 0.3, cy - s * 0.9, cx - s * 0.45, cy - s)
        p.lineTo(cx + s * 0.45, cy - s)
        p.curveTo(cx + s * 0.3, cy - s * 0.9, cx + s * 0.12, cy - s * 0.6, cx + s * 0.12, cy)
        p.close()
    return p


def draw_suit(c, suit: str, cx: float, cy: float, size: float, color=None, stroke=None, stroke_width=0.6):
    c.saveState()
    c.setFillColor(color or SUIT_COLOR[suit])
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(stroke_width)
    if suit == "C":  # lobes filled one by one: overlapping sub-paths would punch holes
        s = size / 2.0
        r = s * 0.44
        for (ox, oy) in ((0, s * 0.5), (-s * 0.5, -s * 0.08), (s * 0.5, -s * 0.08)):
            c.circle(cx + ox, cy + oy, r, fill=1, stroke=0)
        p = c.beginPath()
        p.moveTo(cx - s * 0.12, cy + s * 0.1)
        p.curveTo(cx - s * 0.12, cy - s * 0.6, cx - s * 0.3, cy - s * 0.9, cx - s * 0.45, cy - s)
        p.lineTo(cx + s * 0.45, cy - s)
        p.curveTo(cx + s * 0.3, cy - s * 0.9, cx + s * 0.12, cy - s * 0.6, cx + s * 0.12, cy + s * 0.1)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        c.circle(cx, cy + s * 0.05, s * 0.2, fill=1, stroke=0)
    else:
        c.drawPath(suit_path(c, suit, cx, cy, size), fill=1, stroke=1 if stroke is not None else 0)
    c.restoreState()


# ------------------------------------------------------------------ mini playing card
RANK_LABEL = {11: "J", 12: "Q", 13: "K", 14: "A"}


def parse_card(code: str) -> tuple[int, str]:
    """'10H' -> (10, 'H'), 'QS' -> (12, 'S'), 'JK' -> joker."""
    code = code.strip().upper()
    if code in ("JK", "JOKER"):
        return 0, "J"
    s = code[-1]
    r = code[:-1]
    r = {"J": 11, "Q": 12, "K": 13, "A": 14}.get(r, None) or int(r)
    return r, s


def draw_card(c, x: float, y: float, w: float, code: str, highlight=None, label: str | None = None):
    """A small face-up playing card at (x, y) bottom-left, width w (height 1.4w)."""
    h = w * 1.4
    r, s = parse_card(code)
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(highlight or INK_FAINT)
    c.setLineWidth(1.6 if highlight else 0.7)
    c.roundRect(x, y, w, h, w * 0.09, fill=1, stroke=1)
    if r == 0:  # joker
        c.setFillColor(GOLD)
        c.setFont(TITLE_FONT, w * 0.2)
        c.drawCentredString(x + w / 2, y + h * 0.62, "JOKER")
        _star(c, x + w / 2, y + h * 0.36, w * 0.24, GOLD)
    else:
        col = SUIT_COLOR[s]
        lab = RANK_LABEL.get(r, str(r))
        c.setFillColor(col)
        c.setFont("AlegreyaSans-ExtraBold", w * 0.3)
        c.drawString(x + w * 0.08, y + h - w * 0.34, lab)
        draw_suit(c, s, x + w * 0.2, y + h - w * 0.52, w * 0.2)
        if r in (11, 12, 13):
            c.setFillColor(PARCHMENT)
            c.setStrokeColor(col)
            c.setLineWidth(0.6)
            c.roundRect(x + w * 0.3, y + h * 0.16, w * 0.6, h * 0.5, w * 0.05, fill=1, stroke=1)
            c.setFillColor(col)
            c.setFont(TITLE_FONT, w * 0.34)
            c.drawCentredString(x + w * 0.6, y + h * 0.33, lab)
        else:
            draw_suit(c, s, x + w * 0.58, y + h * 0.38, w * 0.46)
    c.restoreState()
    if label:
        c.saveState()
        c.setFont(SANS, max(5.5, w * 0.17))
        c.setFillColor(INK_SOFT)
        c.drawCentredString(x + w / 2, y - w * 0.22, label)
        c.restoreState()
    return h


def _star(c, cx, cy, r, color):
    c.saveState()
    c.setFillColor(color)
    p = c.beginPath()
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        px, py = cx + rr * math.cos(a), cy + rr * math.sin(a)
        (p.moveTo if i == 0 else p.lineTo)(px, py)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


# ------------------------------------------------------------------ glimmer gem + tokens
def draw_gem(c, cx, cy, r, value: int):
    light, dark = GLIMMER[value]
    c.saveState()
    pts = [(cx, cy + r), (cx + r * 0.8, cy + r * 0.3), (cx + r * 0.55, cy - r * 0.75),
           (cx - r * 0.55, cy - r * 0.75), (cx - r * 0.8, cy + r * 0.3)]
    p = c.beginPath()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    c.setFillColor(light)
    c.setStrokeColor(dark)
    c.setLineWidth(max(0.5, r * 0.08))
    c.drawPath(p, fill=1, stroke=1)
    c.setLineWidth(max(0.3, r * 0.04))
    c.line(cx - r * 0.8, cy + r * 0.3, cx + r * 0.8, cy + r * 0.3)
    c.line(cx, cy + r, cx - r * 0.28, cy + r * 0.3)
    c.line(cx, cy + r, cx + r * 0.28, cy + r * 0.3)
    c.line(cx - r * 0.28, cy + r * 0.3, cx, cy - r * 0.75)
    c.line(cx + r * 0.28, cy + r * 0.3, cx, cy - r * 0.75)
    c.restoreState()


def draw_token(c, cx, cy, r, value: int, crown: bool = False):
    light, dark = GLIMMER[value]
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(dark)
    c.setLineWidth(1.2)
    c.circle(cx, cy, r, fill=1, stroke=1)
    c.setFillColor(light)
    c.setStrokeColor(dark)
    c.setLineWidth(0.5)
    c.circle(cx, cy, r * 0.86, fill=1, stroke=1)
    if crown:
        _crown(c, cx, cy + r * 0.12, r * 0.55, dark)
    else:
        draw_gem(c, cx, cy + r * 0.14, r * 0.42, value)
    c.setFillColor(dark)
    c.setFont("AlegreyaSans-ExtraBold", r * 0.52)
    c.drawCentredString(cx, cy - r * 0.68, str(value))
    c.restoreState()


def _crown(c, cx, cy, s, color):
    c.saveState()
    c.setFillColor(GOLD)
    c.setStrokeColor(color)
    c.setLineWidth(0.8)
    p = c.beginPath()
    p.moveTo(cx - s, cy - s * 0.45)
    p.lineTo(cx - s, cy + s * 0.35)
    p.lineTo(cx - s * 0.5, cy)
    p.lineTo(cx, cy + s * 0.6)
    p.lineTo(cx + s * 0.5, cy)
    p.lineTo(cx + s, cy + s * 0.35)
    p.lineTo(cx + s, cy - s * 0.45)
    p.close()
    c.drawPath(p, fill=1, stroke=1)
    c.restoreState()


# ------------------------------------------------------------------ marks
def crop_marks(c, x, y, w, h, length=0.18 * inch, gap=0.05 * inch, color=INK_SOFT, width=0.4):
    """Corner crop marks outside the rectangle (x, y, w, h)."""
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(width)
    for px, dx in ((x, -1), (x + w, 1)):
        for py, dy in ((y, -1), (y + h, 1)):
            c.line(px + dx * gap, py, px + dx * (gap + length), py)
            c.line(px, py + dy * gap, px, py + dy * (gap + length))
    c.restoreState()


def registration(c, x, y, r=0.12 * inch, color=INK):
    """Crosshair registration target centred on (x, y)."""
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(0.45)
    c.circle(x, y, r, fill=0, stroke=1)
    c.circle(x, y, r * 0.45, fill=0, stroke=1)
    c.line(x - r * 1.5, y, x + r * 1.5, y)
    c.line(x, y - r * 1.5, x, y + r * 1.5)
    c.restoreState()


def page_footer(c, page_w, text, n=None):
    c.saveState()
    c.setFont(SANS, 7.5)
    c.setFillColor(INK_FAINT)
    c.drawString(0.5 * inch, 0.35 * inch, text)
    if n is not None:
        c.drawRightString(page_w - 0.5 * inch, 0.35 * inch, str(n))
    c.restoreState()


def hex_of(color) -> str:
    return "#" + color.hexval()[2:]


def fill_frame(c, x, y, w, h, flowables, pad=4, what="frame"):
    """Draw flowables into a frame and fail loudly if anything doesn't fit."""
    from reportlab.platypus import Frame
    f = Frame(x, y, w, h, showBoundary=0, leftPadding=pad, rightPadding=pad, topPadding=pad, bottomPadding=pad)
    rest = list(flowables)
    f.addFromList(rest, c)
    if rest:
        raise RuntimeError(f"text overflow in {what}: {len(rest)} flowable(s) did not fit")
