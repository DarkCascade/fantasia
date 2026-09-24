"""Small board diagrams for the rulebook: the real map geometry at mini scale,
with figures, glimmer, arrows and card rows drawn on top."""

from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import Flowable

import board as BD
import emblems as E
import style as S
from board import GB

FIG_COLOR = {k: S.HexColor(v["palette"][0]) for k, v in __import__("content").CHARACTERS.items()}


class Drawn(Flowable):
    """A flowable that calls fn(canvas, width, height)."""

    def __init__(self, width, height, fn, hAlign="CENTER"):
        super().__init__()
        self.width, self.height, self.fn = width, height, fn
        self.hAlign = hAlign

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        self.fn(self.canv, self.width, self.height)


def mini_map(c, x0, y0, scale, *, figures=None, warden=GB.HEART, glimmer=None, arrows=(), crush=None,
             highlight=(), show_tokens_default=False, labels=True, rows=(0, 1, 2, 3, 4)):
    """Schematic board. scale = points per board inch. figures: {node: [keys]}; glimmer: {node: [values]}."""
    def P(n):
        x, y = BD.node_xy(n)
        return x0 + x * scale, y0 + y * scale

    c.saveState()
    c.setLineCap(1)
    for a, b in GB.EDGES:
        (x1, y1), (x2, y2) = P(a), P(b)
        c.setStrokeColor(S.HexColor("#A79F8D"))
        c.setLineWidth(scale * 0.22)
        c.line(x1, y1, x2, y2)
    r = scale * 0.62
    for n in range(1, 13):
        x, y = P(n)
        suit = BD.SUIT_OF[GB.VEIN[n]]
        c.setFillColor(S.GLOW_LIGHT if n in highlight else S.PAPER)
        c.setStrokeColor(S.SUIT_COLOR[suit])
        c.setLineWidth(max(1.2, scale * 0.08))
        c.circle(x, y, r, fill=1, stroke=1)
        S.draw_suit(c, suit, x - r * 0.42, y + r * 0.32, r * 0.5)
        if labels:
            c.setFillColor(S.INK)
            c.setFont(S.LABEL_FONT, max(6.5, scale * 0.3))
            c.drawString(x + r * 0.05, y + r * 0.2, GB.NAMES[n])
    # gate & heart
    gx, gy = P(GB.GATE)
    c.setFillColor(S.STONE)
    c.roundRect(gx - scale * 1.6, gy - scale * 0.45, scale * 3.2, scale * 0.9, scale * 0.25, fill=1, stroke=0)
    c.setFillColor(S.GLOW_LIGHT)
    c.setFont(S.TITLE_FONT, max(7, scale * 0.38))
    c.drawCentredString(gx, gy - scale * 0.12, "GATE")
    hx, hy = P(GB.HEART)
    c.setFillColor(S.HexColor("#2A2E33"))
    c.setStrokeColor(S.GLOW)
    c.setLineWidth(max(1, scale * 0.06))
    c.circle(hx, hy, r * 1.05, fill=1, stroke=1)
    c.setFillColor(S.GLOW_LIGHT)
    c.setFont(S.TITLE_FONT, max(6.5, scale * 0.3))
    c.drawCentredString(hx, hy - scale * 0.1, "HEART")
    # glimmer
    glimmer = glimmer or {}
    for n, vals in glimmer.items():
        x, y = P(n)
        for i, v in enumerate(vals):
            S.draw_gem(c, x - r * 0.38 + i * r * 0.38, y - r * 0.45, r * 0.18, v)
    # arrows
    for a, b, col in arrows:
        (x1, y1), (x2, y2) = P(a), P(b)
        _arrow(c, x1, y1, x2, y2, col, scale, shrink=r * 1.05)
    # warden
    if warden is not None:
        wx, wy = P(warden)
        E._warden_eye(c, wx + r * 0.45, wy - r * 0.05, r * 0.42)
    # figures
    figures = figures or {}
    for n, keys in figures.items():
        x, y = P(n)
        for i, k in enumerate(keys):
            fx = x + r * 0.5 - i * r * 0.55 if n not in (GB.GATE,) else x - scale * 1.1 + i * scale * 0.7
            fy = y - r * 0.1 if n != GB.GATE else y + scale * 0.75
            c.setFillColor(FIG_COLOR[k])
            c.setStrokeColor(colors.white)
            c.setLineWidth(1)
            c.circle(fx, fy, r * 0.3, fill=1, stroke=1)
            c.setFillColor(colors.white)
            c.setFont(S.LABEL_FONT, max(5.5, r * 0.3))
            c.drawCentredString(fx, fy - r * 0.1, E.display_name(k)[0])
    if crush is not None:
        x, y = P(crush)
        c.setStrokeColor(S.DANGER)
        c.setLineWidth(2)
        c.circle(x, y, r * 1.18, fill=0, stroke=1)
    c.restoreState()


def _arrow(c, x1, y1, x2, y2, col, scale, shrink=0):
    import math
    dx, dy = x2 - x1, y2 - y1
    d = math.hypot(dx, dy) or 1
    ux, uy = dx / d, dy / d
    x1, y1 = x1 + ux * shrink * 0.6, y1 + uy * shrink * 0.6
    x2, y2 = x2 - ux * shrink, y2 - uy * shrink
    c.saveState()
    c.setStrokeColor(col)
    c.setFillColor(col)
    c.setLineWidth(max(1.6, scale * 0.09))
    c.line(x1, y1, x2, y2)
    h = max(5, scale * 0.3)
    p = c.beginPath()
    p.moveTo(x2 + ux * h * 0.3, y2 + uy * h * 0.3)
    p.lineTo(x2 - ux * h - uy * h * 0.55, y2 - uy * h + ux * h * 0.55)
    p.lineTo(x2 - ux * h + uy * h * 0.55, y2 - uy * h - ux * h * 0.55)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def card_row(cards, played=(), width=None, cw=0.5 * inch, labels=None):
    """Flowable: a row of mini cards; played ones outlined in teal."""
    n = len(cards)
    w = width or (n * (cw + 0.1 * inch))
    h = cw * 1.4 + 0.22 * inch

    def fn(c, W, H):
        x = (W - n * (cw + 0.1 * inch) + 0.1 * inch) / 2
        for i, code in enumerate(cards):
            lab = labels[i] if labels else None
            S.draw_card(c, x, 0.2 * inch, cw, code, highlight=S.GLOW if code in played else None, label=lab)
            x += cw + 0.1 * inch

    return Drawn(w, h, fn)
