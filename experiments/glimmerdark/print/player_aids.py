"""One-page player aid per delver: ability, a card-based example, pack/vault
mat, turn reminder, and the paint scheme shared with the Miniatures Guide.

    python player_aids.py   -> dist/player_aids.pdf (6 pages)
"""

from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame

import content as T
import emblems as E
import style as S

W, H = letter
M = 0.55 * inch


def _frame(c, x, y, w, h, flow, pad=6):
    f = Frame(x, y, w, h, showBoundary=0, leftPadding=pad, rightPadding=pad, topPadding=pad, bottomPadding=pad)
    rest = f.addFromList(list(flow), c)
    return rest


def _panel(c, x, y, w, h, fill=S.PAPER, stroke=S.RULE, radius=10, lw=1):
    c.saveState()
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(lw)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    c.restoreState()


def aid_page(c, key: str):
    ch = T.CHARACTERS[key]
    pal = E.palette(key)
    main, dark = pal[0], pal[1]
    st = S.styles(11)
    V = T.CFG
    pack = V.pack_limit - (1 if key == "gritch" and V.gritch_pack4 else 0)

    # ---- header band
    band_h = 1.75 * inch
    c.setFillColor(main)
    c.rect(0, H - band_h, W, band_h, fill=1, stroke=0)
    c.setFillColor(dark)
    c.rect(0, H - band_h, W, 0.09 * inch, fill=1, stroke=0)
    E.emblem(c, key, M + 0.72 * inch, H - band_h / 2, 0.68 * inch)
    from reportlab.pdfbase.pdfmetrics import stringWidth
    c.setFillColor(colors.white)
    name = ch["name"].upper()
    avail = W - M - (M + 1.65 * inch)
    size = 30
    while stringWidth(name, S.TITLE_BLACK, size) > avail and size > 16:
        size -= 1
    c.setFont(S.TITLE_BLACK, size)
    c.drawString(M + 1.65 * inch, H - 0.85 * inch, name)
    c.setFont("Alegreya-Italic", 16)
    title = ch["title"][0].upper() + ch["title"][1:]
    c.drawString(M + 1.68 * inch, H - 1.2 * inch, title)
    # affinity chip (below the name line, right side)
    aff = ch["affinity"]
    chip_w = 1.85 * inch
    cx0 = W - M - chip_w
    chip_y = H - 1.5 * inch
    c.setFillColor(colors.white)
    c.roundRect(cx0, chip_y, chip_w, 0.42 * inch, 0.21 * inch, fill=1, stroke=0)
    c.setFillColor(dark)
    c.setFont(S.LABEL_FONT, 12)
    if ch["suit"]:
        S.draw_suit(c, ch["suit"], cx0 + 0.3 * inch, chip_y + 0.21 * inch, 0.24 * inch)
        c.drawString(cx0 + 0.52 * inch, chip_y + 0.15 * inch, aff.split(" ", 1)[1].upper())
    else:
        c.drawCentredString(cx0 + chip_w / 2, chip_y + 0.15 * inch, aff.upper())
    c.setFont(S.SANS, 9)
    c.setFillColor(colors.white)
    c.drawRightString(W - M, H - 0.52 * inch, "GLIMMERDARK · PLAYER AID")

    # ---- ability
    top = H - band_h - 0.25 * inch
    ab_h = 1.45 * inch
    _panel(c, M, top - ab_h, W - 2 * M, ab_h, fill=S.PARCHMENT, stroke=main, lw=2)
    c.setFillColor(dark)
    c.setFont(S.TITLE_FONT, 20)
    c.drawString(M + 0.2 * inch, top - 0.42 * inch, ch["ability"].upper())
    c.setFont(S.SANS, 9)
    c.setFillColor(S.INK_SOFT)
    c.drawRightString(W - M - 0.2 * inch, top - 0.38 * inch, "YOUR ABILITY")
    big = S.styles(13.5)["body"]
    _frame(c, M + 0.1 * inch, top - ab_h + 0.05 * inch, W - 2 * M - 0.2 * inch, ab_h - 0.55 * inch, [S.P(ch["text"], big)])

    # ---- example with cards
    ex_top = top - ab_h - 0.22 * inch
    ex_h = 2.65 * inch
    _panel(c, M, ex_top - ex_h, W - 2 * M, ex_h)
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 14)
    c.drawString(M + 0.2 * inch, ex_top - 0.34 * inch, "EXAMPLE")
    cw = 0.62 * inch
    x = M + 0.22 * inch
    y = ex_top - 0.5 * inch - cw * 1.4
    for code in ch["hand"]:
        played = code in ch["played"]
        S.draw_card(c, x, y, cw, code, highlight=main if played else None, label="played" if played else "kept")
        x += cw + 0.12 * inch
    c.setFont(S.SANS, 8.5)
    c.setFillColor(S.INK_SOFT)
    c.drawString(x + 0.1 * inch, y + cw * 1.2, "The hand in this example.")
    c.drawString(x + 0.1 * inch, y + cw * 1.2 - 11, "Outlined cards get played.")
    _frame(c, M + 0.1 * inch, ex_top - ex_h + 0.05 * inch, W - 2 * M - 0.2 * inch, ex_h - 0.62 * inch - cw * 1.55,
           [S.P(ch["example"], st["body"])])

    # ---- tip
    tip_top = ex_top - ex_h - 0.12 * inch
    _frame(c, M, tip_top - 0.55 * inch, W - 2 * M, 0.55 * inch,
           [S.P(f"<b>Tip.</b> {ch['tip']}", st["italic"])], pad=4)

    # ---- pack & vault mat
    mat_top = tip_top - 0.6 * inch
    mat_h = 1.35 * inch
    pw = 4.1 * inch
    _panel(c, M, mat_top - mat_h, pw, mat_h, fill=S.PARCHMENT, stroke=S.STONE, lw=1.4)
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 13)
    c.drawString(M + 0.15 * inch, mat_top - 0.3 * inch, "PACK")
    c.setFont(S.SANS, 8.5)
    c.setFillColor(S.INK_SOFT)
    c.drawString(M + 0.72 * inch, mat_top - 0.29 * inch, f"carried glimmer · holds {pack} · half value at the end")
    slot_r = 0.3 * inch
    for k in range(pack):
        sx = M + 0.5 * inch + k * 0.75 * inch
        sy = mat_top - 0.85 * inch
        c.setStrokeColor(S.STONE_LIGHT)
        c.setDash(3, 2)
        c.circle(sx, sy, slot_r, fill=0, stroke=1)
        c.setDash()
    vx = M + pw + 0.2 * inch
    vw = W - M - vx
    _panel(c, vx, mat_top - mat_h, vw, mat_h, fill=S.PAPER, stroke=S.GOLD, lw=1.4)
    c.setFillColor(S.INK)
    c.setFont(S.TITLE_FONT, 13)
    c.drawString(vx + 0.15 * inch, mat_top - 0.3 * inch, "VAULT")
    c.setFont(S.SANS, 8.5)
    c.setFillColor(S.INK_SOFT)
    c.drawString(vx + 0.85 * inch, mat_top - 0.29 * inch, "banked · safe · keep face up")

    # ---- turn reminder
    tr_top = mat_top - mat_h - 0.18 * inch
    tr_h = 1.05 * inch
    _panel(c, M, tr_top - tr_h, W - 2 * M, tr_h, fill=S.PAPER, stroke=S.RULE)
    small = S.styles(9.5)
    lines = [f"<b>Your turn.</b> Up to {V.actions_per_turn} actions, one card each: <b>Move</b> 1 (any card), "
             f"<b>Mine</b> (card matches the vein; 2–6 and A take {V.low_yield}, 7–10 and faces take {V.high_yield}; A is wild), "
             f"or a face card's <b>Event</b> (J Shortcut {V.jack_steps}, Q Pilfer, K Rouse). Refill to {V.hand_size}.",
             "<b>The Warden.</b> After each round flip a card: A–10 = 1 step, J/Q/K = 2, Joker = Tremor. It walks "
             "toward the winning delver underground and crushes anyone it walks in on (drop half, retreat)."]
    _frame(c, M + 0.05 * inch, tr_top - tr_h, W - 2 * M - 0.1 * inch, tr_h, [S.P(t, small["small"]) for t in lines])

    # ---- paint scheme
    ps_y = 0.62 * inch
    c.setFont(S.LABEL_FONT, 9)
    c.setFillColor(S.INK_SOFT)
    c.drawString(M, ps_y + 0.34 * inch, "MINIATURE PAINT SCHEME (matches the Miniatures Guide)")
    sx = M
    for name, hexv in zip(ch["colors"], ch["palette"]):
        c.setFillColor(S.HexColor(hexv))
        c.setStrokeColor(S.INK_FAINT)
        c.roundRect(sx, ps_y - 0.02 * inch, 0.3 * inch, 0.26 * inch, 3, fill=1, stroke=1)
        c.setFillColor(S.INK)
        c.setFont(S.SANS, 9)
        c.drawString(sx + 0.36 * inch, ps_y + 0.06 * inch, name)
        sx += 1.72 * inch
    S.page_footer(c, W, f"Glimmerdark · player aid · {ch['name']}")


def main():
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "player_aids.pdf"
    c = canvas.Canvas(str(out), pagesize=letter)
    c.setTitle("Glimmerdark player aids")
    for key in T.CHARACTERS:
        aid_page(c, key)
        c.showPage()
    c.save()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
