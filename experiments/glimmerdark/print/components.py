"""Cut-out components: glimmer tokens, the Crown, markers, and fold-over
standees for every figure (for anyone without the printed miniatures).

    python components.py  -> dist/components.pdf
"""

from __future__ import annotations

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

import content as T
import results as RS
from content import R
import emblems as E
import style as S

W, H = letter
M = 0.5 * inch


def token_page(c):
    c.setFont(S.TITLE_FONT, 18)
    c.setFillColor(S.INK)
    c.drawString(M, H - 0.75 * inch, "Glimmer tokens")
    c.setFont(S.SANS, 9.5)
    c.setFillColor(S.INK_SOFT)
    c.drawString(M, H - 0.98 * inch, "Cut along the dashed grid, or punch each circle with a 3/4 in (19 mm) circle punch. "
                 "Card stock recommended.")
    counts = [(v, n) for v, n in T.TOKENS] + [(5, 1)]
    cell = 0.86 * inch
    cols = 8
    items = [v for v, n in counts for _ in range(n)]
    rows = -(-len(items) // cols)
    gx = (W - cols * cell) / 2
    gy = H - 1.2 * inch - rows * cell
    for i, v in enumerate(items):
        r, k = divmod(i, cols)
        x = gx + k * cell
        y = gy + (rows - 1 - r) * cell
        S.draw_token(c, x + cell / 2, y + cell / 2, 0.37 * inch, v, crown=(v == 5))
    # dashed cut grid + crop marks around it
    c.saveState()
    c.setStrokeColor(S.INK_FAINT)
    c.setDash(2, 3)
    c.setLineWidth(0.4)
    for k in range(cols + 1):
        c.line(gx + k * cell, gy, gx + k * cell, gy + rows * cell)
    for r in range(rows + 1):
        c.line(gx, gy + r * cell, gx + cols * cell, gy + r * cell)
    c.restoreState()
    S.crop_marks(c, gx, gy, cols * cell, rows * cell)
    c.setFont(S.SANS, 9)
    c.setFillColor(S.INK_SOFT)
    summary = ", ".join(f"{n} × {v}" for v, n in T.TOKENS) + ", 1 Crown (5)"
    c.drawString(M, gy - 0.35 * inch, f"This sheet: {summary}. {token_note()}")
    S.page_footer(c, W, "Glimmerdark · components · glimmer tokens")


def token_note() -> str:
    """How the token counts compare with what the final-rules sweep needed."""
    need = RS.token_need(R.FINAL)
    if not need:
        return "If you ever run out, use a coin."
    have = dict(T.TOKENS)
    games = min(q["games"] for q in need.values())
    most = " / ".join(str(need[v]["max"]) for v, _ in T.TOKENS)
    if all(have[v] >= need[v]["max"] for v in have):
        return f"The most any of {games:,} simulated games needed was {most}, so it has never run short in testing."
    return (f"The most any of {games:,} simulated games needed was {most}; that's rare, and if you ever run out, "
            "use a coin.")


STANDEE_W, FACE_H, TAB_H = 1.45 * inch, 1.75 * inch, 0.45 * inch
STANDEE_H = 2 * TAB_H + 2 * FACE_H


def standee(c, key, x, y, w=STANDEE_W, face_h=FACE_H):
    """Fold-over standee: two faces joined at the top fold, a glue strip, and a base tab."""
    pal = E.palette(key)
    tab_h = TAB_H
    total_h = tab_h + face_h * 2 + tab_h
    c.saveState()
    # faces: bottom face is upside down so it reads correctly once folded
    for i, flip in ((0, True), (1, False)):
        fy = y + tab_h + i * face_h
        c.saveState()
        if flip:
            c.translate(x + w, fy + face_h)
            c.rotate(180)
            ox, oy = 0, 0
        else:
            c.translate(x, fy)
            ox, oy = 0, 0
        c.setFillColor(pal[0])
        c.rect(ox, oy, w, face_h, fill=1, stroke=0)
        c.setFillColor(S.PAPER)
        c.roundRect(ox + 0.08 * inch, oy + 0.08 * inch, w - 0.16 * inch, face_h - 0.16 * inch, 6, fill=1, stroke=0)
        E.emblem(c, key, ox + w / 2, oy + face_h * 0.6, 0.5 * inch)
        c.setFillColor(S.INK)
        name = E.display_name(key)
        size = 10.5
        from reportlab.pdfbase.pdfmetrics import stringWidth
        while stringWidth(name.upper(), S.TITLE_FONT, size) > w - 0.25 * inch:
            size -= 0.5
        c.setFont(S.TITLE_FONT, size)
        c.drawCentredString(ox + w / 2, oy + face_h * 0.24, name.upper())
        c.setFont("Alegreya-Italic", 8)
        c.setFillColor(S.INK_SOFT)
        c.drawCentredString(ox + w / 2, oy + face_h * 0.13, E.display_title(key))
        c.restoreState()
    # base tabs
    for ty in (y, y + tab_h + 2 * face_h):
        c.setFillColor(S.PARCHMENT_DEEP)
        c.rect(x, ty, w, tab_h, fill=1, stroke=0)
        c.setFillColor(S.INK_SOFT)
        c.setFont(S.SANS, 6.5)
        c.drawCentredString(x + w / 2, ty + tab_h / 2 - 2, "base: fold out")
    # fold lines
    c.setStrokeColor(S.INK_SOFT)
    c.setDash(3, 2)
    c.setLineWidth(0.5)
    for fy in (y + tab_h, y + tab_h + face_h, y + tab_h + 2 * face_h):
        c.line(x, fy, x + w, fy)
    c.setDash()
    c.restoreState()
    S.crop_marks(c, x, y, w, total_h, length=0.12 * inch, gap=0.04 * inch)
    return total_h


def standee_page(c):
    c.setFont(S.TITLE_FONT, 18)
    c.setFillColor(S.INK)
    c.drawString(M, H - 0.75 * inch, "Standees and markers")
    c.setFont(S.SANS, 9.5)
    c.setFillColor(S.INK_SOFT)
    c.drawString(M, H - 0.98 * inch, "No miniatures? Cut out each strip, fold on the dashed lines so the two faces meet back to back, "
                 "glue them, and fold the tabs out as a base.")
    keys = E.figure_names()
    w = 1.45 * inch
    gap = (W - 2 * M - 5 * w) / 4
    top = H - 1.3 * inch
    for i, key in enumerate(keys):
        row, col = divmod(i, 5)
        x = M + col * (w + gap)
        y = top - (row + 1) * STANDEE_H - row * 0.25 * inch
        standee(c, key, x, y)
    # markers: collapse marker + first player, beside the second row
    mx = M + 2 * (w + gap) + 0.2 * inch
    my = top - 2 * STANDEE_H - 0.25 * inch + 1.2 * inch
    for k, (label, sub) in enumerate((("COLLAPSE", "marker"), ("FIRST", "player"))):
        cx = mx + k * 2.1 * inch + 0.75 * inch
        cy = my + 1.2 * inch
        c.setFillColor(S.STONE if k == 0 else S.GOLD)
        c.circle(cx, cy, 0.62 * inch, fill=1, stroke=0)
        c.setFillColor(S.PAPER)
        c.setFont(S.TITLE_FONT, 11)
        c.drawCentredString(cx, cy + 2, label)
        c.setFont(S.SANS, 8)
        c.drawCentredString(cx, cy - 11, sub)
        S.crop_marks(c, cx - 0.62 * inch, cy - 0.62 * inch, 1.24 * inch, 1.24 * inch, length=0.1 * inch)
    S.page_footer(c, W, "Glimmerdark · components · standees and markers")


def main():
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "components.pdf"
    c = canvas.Canvas(str(out), pagesize=letter)
    c.setTitle("Glimmerdark components")
    token_page(c)
    c.showPage()
    standee_page(c)
    c.showPage()
    c.save()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
