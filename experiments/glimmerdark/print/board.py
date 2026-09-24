"""The Glimmerdark board: drawn once at full size (15 x 20 in), then tiled onto
four sheets that fit both US Letter and A4, with crop marks and registration
targets on every seam.

    python board.py        -> dist/board_letter.pdf and dist/board_a4.pdf
"""

from __future__ import annotations

import math
import sys

from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

import content as T
import style as S

sys.path.insert(0, str(S.HERE.parent / "sim"))
from glimmer import board as GB  # noqa: E402

BOARD_W, BOARD_H = 15.0, 20.0      # inches
TILE_W, TILE_H = 7.5, 10.0          # each sheet's printed area (fits Letter and A4)
COLS, ROWS = 2, 2

COL_X = [2.4, 5.8, 9.2, 12.6]
ROW_Y = [15.3, 11.65, 7.65]
CH_R = 1.22
GATE = (7.5, 17.75)
GATE_W, GATE_H = 4.4, 1.45
HEART = (7.5, 3.95)
HEART_R = 1.35
TRACK_Y = 0.55
TRACK_H = 1.1

SUIT_OF = {0: "S", 1: "H", 2: "D", 3: "C"}


def node_xy(n: int) -> tuple[float, float]:
    if n == GB.GATE:
        return GATE
    if n == GB.HEART:
        return HEART
    row, col = (n - 1) // 4, (n - 1) % 4
    return COL_X[col], ROW_Y[row]


def _in(v):
    return v * inch


def draw_background(c):
    c.saveState()
    c.setFillColor(S.PARCHMENT)
    c.rect(0, 0, _in(BOARD_W), _in(BOARD_H), fill=1, stroke=0)
    # faint strata lines: the mountain's rock layers
    c.setStrokeColor(S.PARCHMENT_DEEP)
    c.setLineWidth(3)
    for i in range(14):
        y = 1.3 + i * 1.35
        p = c.beginPath()
        p.moveTo(0, _in(y))
        for k in range(1, 16):
            x = k * 1.0
            p.lineTo(_in(x), _in(y + 0.18 * math.sin(k * 1.3 + i)))
        c.drawPath(p, stroke=1, fill=0)
    # depth bands: slightly darker the deeper you go
    for row, shade in enumerate(("#F1E7D2", "#ECE0C7", "#E6D8BC")):
        y = ROW_Y[row]
        c.setFillColor(S.HexColor(shade))
        c.roundRect(_in(0.55), _in(y - 1.55), _in(BOARD_W - 1.1), _in(3.1), _in(0.35), fill=1, stroke=0)
    c.setStrokeColor(S.STONE)
    c.setLineWidth(2)
    c.rect(_in(0.18), _in(0.18), _in(BOARD_W - 0.36), _in(BOARD_H - 0.36), fill=0, stroke=1)
    c.restoreState()


def draw_title(c):
    c.saveState()
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_BLACK, 52)
    c.drawCentredString(_in(BOARD_W / 2), _in(19.05), "GLIMMERDARK")
    c.restoreState()


def draw_tunnels(c):
    c.saveState()
    c.setLineCap(1)
    for a, b in GB.EDGES:
        (x1, y1), (x2, y2) = node_xy(a), node_xy(b)
        if a == GB.GATE:
            y1 = GATE[1] - GATE_H / 2 + 0.1
            x1 = GATE[0] + (x2 - GATE[0]) * 0.28
        c.setStrokeColor(S.STONE)
        c.setLineWidth(_in(0.34))
        c.line(_in(x1), _in(y1), _in(x2), _in(y2))
        c.setStrokeColor(S.HexColor("#8C8577"))
        c.setLineWidth(_in(0.22))
        c.line(_in(x1), _in(y1), _in(x2), _in(y2))
        c.setStrokeColor(S.HexColor("#B8AE98"))
        c.setDash(_in(0.12), _in(0.14))
        c.setLineWidth(1.2)
        c.line(_in(x1), _in(y1), _in(x2), _in(y2))
        c.setDash()
    c.restoreState()


def draw_chamber(c, n: int):
    x, y = node_xy(n)
    suit = SUIT_OF[GB.VEIN[n]]
    depth = GB.DEPTH[n]
    value = T.DEPTH_VALUES[depth - 1]
    col = S.SUIT_COLOR[suit]
    c.saveState()
    c.setFillColor(S.STONE)
    c.circle(_in(x + 0.05), _in(y - 0.06), _in(CH_R + 0.03), fill=1, stroke=0)  # shadow
    c.setFillColor(S.PAPER)
    c.setStrokeColor(col)
    c.setLineWidth(_in(0.09))
    c.circle(_in(x), _in(y), _in(CH_R), fill=1, stroke=1)
    c.setStrokeColor(S.RULE)
    c.setLineWidth(0.8)
    c.circle(_in(x), _in(y), _in(CH_R - 0.12), fill=0, stroke=1)
    # label + vein
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 20)
    c.drawCentredString(_in(x), _in(y + 0.78), GB.NAMES[n])
    S.draw_suit(c, suit, _in(x), _in(y + 0.28), _in(0.62))
    c.setFont(S.LABEL_FONT, 9.5)
    c.setFillColor(col)
    c.drawCentredString(_in(x), _in(y - 0.18), f"{S.SUIT_NAME[suit].upper()} VEIN")
    # three token slots, drawn as faint gems of this depth's value
    for k in range(3):
        tx = x + (k - 1) * 0.62
        ty = y - 0.66
        c.setStrokeColor(S.GLIMMER[value][1])
        c.setDash(2, 2)
        c.setLineWidth(0.8)
        c.circle(_in(tx), _in(ty), _in(0.29), fill=0, stroke=1)
        c.setDash()
        S.draw_gem(c, _in(tx), _in(ty + 0.02), _in(0.14), value)
    c.restoreState()


def draw_gate(c):
    x, y = GATE
    w, h = GATE_W, GATE_H
    c.saveState()
    p = c.beginPath()
    left, right, bottom, top = x - w / 2, x + w / 2, y - h / 2, y + h / 2
    p.moveTo(_in(left), _in(bottom))
    p.lineTo(_in(left), _in(top - 0.5))
    p.curveTo(_in(left), _in(top + 0.35), _in(right), _in(top + 0.35), _in(right), _in(top - 0.5))
    p.lineTo(_in(right), _in(bottom))
    p.close()
    c.setFillColor(S.STONE)
    c.setStrokeColor(S.INK)
    c.setLineWidth(2.5)
    c.drawPath(p, fill=1, stroke=1)
    c.setFillColor(S.GLOW_LIGHT)
    c.setFont(S.TITLE_FONT, 26)
    c.drawCentredString(_in(x), _in(y + 0.18), "THE GATE")
    c.setFont(S.SANS, 11)
    c.setFillColor(S.PAPER)
    c.drawCentredString(_in(x), _in(y - 0.25), "Delvers start here. Enter or pass through to bank your pack.")
    c.drawCentredString(_in(x), _in(y - 0.52), "The Warden can never come here.")
    c.restoreState()


def draw_heart(c):
    x, y = HEART
    c.saveState()
    c.setFillColor(S.HexColor("#2A2E33"))
    c.setStrokeColor(S.GLOW)
    c.setLineWidth(_in(0.08))
    c.circle(_in(x), _in(y), _in(HEART_R), fill=1, stroke=1)
    # glowing cracks
    c.setStrokeColor(S.HexColor("#3FD4E0"))
    c.setLineWidth(1.6)
    for a0 in (0.3, 1.9, 3.4, 4.8):
        r0 = 0.35
        p = c.beginPath()
        p.moveTo(_in(x + r0 * math.cos(a0)), _in(y + r0 * math.sin(a0)))
        for k in range(1, 5):
            rr = r0 + k * 0.2
            aa = a0 + (0.18 if k % 2 else -0.14)
            p.lineTo(_in(x + rr * math.cos(aa)), _in(y + rr * math.sin(aa)))
        c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(S.GLOW_LIGHT)
    c.setFont(S.TITLE_FONT, 22)
    c.drawCentredString(_in(x), _in(y + 0.55), "THE HEART")
    c.setFont(S.SANS, 10)
    c.setFillColor(S.PAPER)
    c.drawCentredString(_in(x), _in(y + 0.22), "The Warden's lair. It starts here.")
    c.drawCentredString(_in(x), _in(y - 0.02), "Any card mines here.")
    S.draw_token(c, _in(x), _in(y - 0.62), _in(0.36), 5, crown=True)
    c.restoreState()


def draw_depth_labels(c):
    c.saveState()
    for row, y in enumerate(ROW_Y):
        v = T.DEPTH_VALUES[row]
        c.translate(_in(0.62), _in(y))
        c.rotate(90)
        c.setFillColor(S.INK_SOFT)
        c.setFont(S.TITLE_FONT, 15)
        c.drawCentredString(0, 0, f"DEPTH {row + 1}")
        c.rotate(-90)
        c.translate(-_in(0.62), -_in(y))
        S.draw_gem(c, _in(BOARD_W - 0.62), _in(y + 0.28), _in(0.22), v)
        c.setFont(S.LABEL_FONT, 11)
        c.setFillColor(S.GLIMMER[v][1])
        c.drawCentredString(_in(BOARD_W - 0.62), _in(y - 0.22), f"worth {v}")
    c.restoreState()


def draw_track(c):
    """Collapse track: Start, 1..9, with end marks per player count."""
    ends = T.COLLAPSE_END
    n_spaces = max(ends.values()) + 1
    x0, x1 = 1.0, BOARD_W - 1.0
    w = (x1 - x0) / n_spaces
    c.saveState()
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 14)
    c.drawString(_in(x0), _in(TRACK_Y + TRACK_H + 0.12), "COLLAPSE TRACK")
    c.setFont(S.SANS, 10)
    c.setFillColor(S.INK_SOFT)
    c.drawString(_in(x0 + 2.35), _in(TRACK_Y + TRACK_H + 0.13),
                 "+1 each time the draw pile is reshuffled  ·  +1 for every Joker revealed")
    for i in range(n_spaces):
        bx = x0 + i * w
        end_for = [n for n, e in ends.items() if e == i]
        c.setFillColor(S.HexColor("#3A2F2A") if end_for else S.PAPER)
        c.setStrokeColor(S.STONE)
        c.setLineWidth(1.4)
        c.roundRect(_in(bx + 0.05), _in(TRACK_Y), _in(w - 0.1), _in(TRACK_H - 0.25), _in(0.12), fill=1, stroke=1)
        c.setFillColor(S.PAPER if end_for else S.INK)
        if i == 0:
            c.setFont(S.TITLE_FONT, 13)
            c.drawCentredString(_in(bx + w / 2), _in(TRACK_Y + 0.33), "START")
        else:
            c.setFont(S.TITLE_FONT, 24)
            c.drawCentredString(_in(bx + w / 2), _in(TRACK_Y + 0.25), str(i))
        if end_for:
            c.setFont(S.LABEL_FONT, 9)
            c.setFillColor(S.DANGER)
            c.drawCentredString(_in(bx + w / 2), _in(TRACK_Y + TRACK_H - 0.17),
                                f"END · {end_for[0]} PLAYERS")
    c.restoreState()


def draw_pile_spot(c, x, y, label):
    w, h = 2.25, 3.15
    c.saveState()
    c.setStrokeColor(S.STONE_LIGHT)
    c.setDash(6, 4)
    c.setLineWidth(1.4)
    c.roundRect(_in(x), _in(y), _in(w), _in(h), _in(0.18), fill=0, stroke=1)
    c.setDash()
    c.setFillColor(S.INK_SOFT)
    c.setFont(S.TITLE_FONT, 14)
    c.drawCentredString(_in(x + w / 2), _in(y + h / 2 + 0.1), label)
    c.restoreState()


def draw_panel(c, x, y, w, h, title, lines):
    c.saveState()
    c.setFillColor(S.PAPER)
    c.setStrokeColor(S.STONE)
    c.setLineWidth(1.2)
    c.roundRect(_in(x), _in(y), _in(w), _in(h), _in(0.15), fill=1, stroke=1)
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 13)
    c.drawString(_in(x + 0.18), _in(y + h - 0.36), title)
    from reportlab.platypus import Frame
    st = S.styles(12.5)
    f = Frame(_in(x + 0.08), _in(y + 0.05), _in(w - 0.16), _in(h - 0.45), showBoundary=0,
              leftPadding=4, rightPadding=4, topPadding=2, bottomPadding=2)
    f.addFromList([S.P(t, st["small"]) for t in lines], c)
    c.restoreState()


def draw_board(c):
    draw_background(c)
    draw_title(c)
    draw_tunnels(c)
    for n in range(1, 13):
        draw_chamber(c, n)
    draw_gate(c)
    draw_heart(c)
    draw_depth_labels(c)
    draw_track(c)
    draw_pile_spot(c, 1.2, 2.05, "DRAW")
    draw_pile_spot(c, BOARD_W - 1.2 - 2.25, 2.05, "DISCARD")
    V = T.CFG
    draw_panel(c, 0.55, 16.62, 4.3, 2.25, "YOUR TURN", [
        f"<b>Up to {V.actions_per_turn} actions</b>, one card each: <b>Move</b> 1 chamber (any card), "
        "<b>Mine</b> (match the vein), or a face card's <b>Event</b>.",
        f"Then refill to {V.hand_size}. Your pack holds {V.pack_limit}.",
    ])
    draw_panel(c, BOARD_W - 0.55 - 4.3, 16.62, 4.3, 2.25, "THE WARDEN'S TURN", [
        "Flip the top card. <b>A–10</b>: 1 step. <b>J Q K</b>: 2 steps. <b>Joker</b>: Tremor.",
        "It walks toward the <b>winning</b> delver who's underground and <b>crushes</b> anyone it walks in on.",
    ])


# ------------------------------------------------------------------ tiling
def _tile_page(c, page_w, page_h, col, row, label):
    ox = (page_w - _in(TILE_W)) / 2
    oy = (page_h - _in(TILE_H)) / 2
    x0, y0 = col * TILE_W, row * TILE_H
    c.saveState()
    p = c.beginPath()
    p.rect(ox, oy, _in(TILE_W), _in(TILE_H))
    c.clipPath(p, stroke=0, fill=0)
    c.translate(ox - _in(x0), oy - _in(y0))
    draw_board(c)
    c.restoreState()
    S.crop_marks(c, ox, oy, _in(TILE_W), _in(TILE_H))
    # registration targets centred on each seam edge (they meet the neighbour's half-targets)
    c.saveState()
    p = c.beginPath()
    p.rect(ox, oy, _in(TILE_W), _in(TILE_H))
    c.clipPath(p, stroke=0, fill=0)
    for frac in (0.25, 0.75):
        if col == 0:
            S.registration(c, ox + _in(TILE_W), oy + _in(TILE_H) * frac)
        if col == 1:
            S.registration(c, ox, oy + _in(TILE_H) * frac)
        if row == 1:
            S.registration(c, ox + _in(TILE_W) * frac, oy)
        if row == 0:
            S.registration(c, ox + _in(TILE_W) * frac, oy + _in(TILE_H))
    c.restoreState()
    # margin labels
    c.saveState()
    c.setFont(S.SANS, 8)
    c.setFillColor(S.INK_SOFT)
    c.drawString(ox, oy + _in(TILE_H) + 0.12 * inch, f"GLIMMERDARK board · sheet {label}")
    joins = []
    if col == 0:
        joins.append("right edge joins sheet " + {1: "2", 0: "4"}[row])
    else:
        joins.append("left edge joins sheet " + {1: "1", 0: "3"}[row])
    if row == 1:
        joins.append("bottom edge joins sheet " + ("3" if col == 0 else "4"))
    else:
        joins.append("top edge joins sheet " + ("1" if col == 0 else "2"))
    c.drawRightString(ox + _in(TILE_W), oy + _in(TILE_H) + 0.12 * inch, " · ".join(joins))
    c.drawString(ox, oy - 0.22 * inch, "Trim on the crop marks, butt the edges together, line up the half-targets, tape on the back.")
    c.restoreState()


def _guide_page(c, page_w, page_h):
    c.setFont(S.TITLE_FONT, 22)
    c.setFillColor(S.INK)
    c.drawString(0.75 * inch, page_h - 1.0 * inch, "Glimmerdark board: assembly")
    st = S.styles(10.5)
    from reportlab.platypus import Frame
    f = Frame(0.75 * inch, page_h - 3.1 * inch, page_w - 1.5 * inch, 2.0 * inch, showBoundary=0)
    f.addFromList([
        S.P("Print sheets 1–4 at <b>100% / actual size</b> (not 'fit to page'). They print the same on US Letter "
            "and A4. The finished board is 15 × 20 inches (38 × 51 cm).", st["body"]),
        S.P("Trim each sheet along its crop marks. Lay them out as below, butt the edges together, line up the "
            "half-targets that meet at every seam, and tape along the back. Card stock or a sheet of foam board "
            "behind it makes it lie flat.", st["body"]),
    ], c)
    scale = 0.32
    w, h = BOARD_W * scale, BOARD_H * scale
    ox = (page_w - _in(w)) / 2
    oy = 1.1 * inch
    c.saveState()
    c.translate(ox, oy)
    c.scale(scale, scale)
    draw_board(c)
    c.restoreState()
    c.saveState()
    c.setStrokeColor(S.DANGER)
    c.setLineWidth(1.2)
    c.setDash(5, 3)
    c.line(ox + _in(w / 2), oy, ox + _in(w / 2), oy + _in(h))
    c.line(ox, oy + _in(h / 2), ox + _in(w), oy + _in(h / 2))
    c.setDash()
    c.setFillColor(S.DANGER)
    c.setFont(S.TITLE_FONT, 26)
    for label, (cx, cy) in {"1": (0.25, 0.75), "2": (0.75, 0.75), "3": (0.25, 0.25), "4": (0.75, 0.25)}.items():
        c.drawCentredString(ox + _in(w * cx), oy + _in(h * cy), label)
    c.restoreState()
    S.page_footer(c, page_w, "Glimmerdark · board · assembly guide")


def build(pagesize, out):
    page_w, page_h = pagesize
    c = canvas.Canvas(str(out), pagesize=pagesize)
    c.setTitle("Glimmerdark board")
    c.setAuthor("Glimmerdark")
    _guide_page(c, page_w, page_h)
    c.showPage()
    for label, (col, row) in {"1": (0, 1), "2": (1, 1), "3": (0, 0), "4": (1, 0)}.items():
        _tile_page(c, page_w, page_h, col, row, label)
        c.showPage()
    c.save()


def main():
    S.DIST.mkdir(exist_ok=True)
    build(letter, S.DIST / "board_letter.pdf")
    build(A4, S.DIST / "board_a4.pdf")
    print("board PDFs written")


if __name__ == "__main__":
    main()
