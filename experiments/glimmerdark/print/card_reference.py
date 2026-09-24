"""Card effects reference: every suit, rank, face card and joker on one page.
Print one per player.

    python card_reference.py  -> dist/card_reference.pdf
"""

from __future__ import annotations

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame

import content as T
import style as S

W, H = letter
M = 0.5 * inch

ROW_CARDS = {  # which mini cards illustrate each table row
    "Suit": ["7S", "7H", "7D", "7C"],
    "2–6": ["2C", "6H"],
    "7–10": ["7D", "10S"],
    "Ace": ["AH"],
    "Jack": ["JC"],
    "Queen": ["QD"],
    "King": ["KS"],
    "Joker": ["JK"],
}


def build(out):
    V = T.CFG
    c = canvas.Canvas(str(out), pagesize=letter)
    c.setTitle("Glimmerdark card reference")
    st = S.styles(10.5)
    # header
    c.setFillColor(S.STONE)
    c.rect(0, H - 1.0 * inch, W, 1.0 * inch, fill=1, stroke=0)
    c.setFillColor(S.PAPER)
    c.setFont(S.TITLE_BLACK, 24)
    c.drawString(M, H - 0.62 * inch, "GLIMMERDARK")
    c.setFont(S.TITLE_FONT, 16)
    c.setFillColor(S.GLOW_LIGHT)
    c.drawString(M + 3.05 * inch, H - 0.6 * inch, "card reference")
    c.setFont(S.SANS, 9)
    c.setFillColor(S.PAPER)
    c.drawRightString(W - M, H - 0.6 * inch, "print one per player")

    # table of meanings
    y = H - 1.25 * inch
    row_h = 0.74 * inch
    col_card = 1.85 * inch
    col_name = 1.45 * inch
    text_w = W - 2 * M - col_card - col_name
    for label, short, long in T.CARD_TABLE:
        cards = ROW_CARDS[label]
        para = S.P(long, S.styles(10)["body"])
        _, ph = para.wrap(text_w - 6, 1000)
        row_h = max(0.66 * inch, ph + 10)
        c.setStrokeColor(S.RULE)
        c.setLineWidth(0.8)
        c.line(M, y - row_h, W - M, y - row_h)
        cw = 0.42 * inch if len(cards) <= 2 else 0.36 * inch
        x = M + 0.05 * inch
        for code in cards:
            S.draw_card(c, x, y - row_h + 0.08 * inch, cw * 0.92, code)
            x += cw + 0.06 * inch
        c.setFillColor(S.INK)
        c.setFont(S.TITLE_FONT, 14)
        c.drawString(M + col_card, y - 0.3 * inch, label.upper())
        c.setFont(S.LABEL_FONT, 10)
        c.setFillColor(S.GLOW)
        c.drawString(M + col_card, y - 0.5 * inch, short)
        S.fill_frame(c, M + col_card + col_name, y - row_h, text_w, row_h,
                     [S.P(long, S.styles(10)["body"])], pad=3, what=f"reference row {label}")
        y -= row_h

    # lower block: actions + Warden + end
    y -= 0.15 * inch
    box_h = y - 0.6 * inch
    half = (W - 2 * M - 0.2 * inch) / 2
    for i, (title, items) in enumerate((
        ("On your turn", [f"<b>Up to {V.actions_per_turn} actions</b>, one card each:"] +
         [f"<b>{name}</b> ({who}): {what}" for name, who, what in T.ACTIONS] +
         [f"Then <b>refill to {V.hand_size}</b>. Pack holds {V.pack_limit}; enter or pass the Gate to bank.",
          "Reshuffle or Joker: advance the collapse marker 1."]),
        ("The Warden's turn", [f"<b>{k}.</b> {v}" for k, v in T.WARDEN_RULES] +
         [f"<b>Collapse</b> at {T.COLLAPSE_END[2]} (2p), {T.COLLAPSE_END[3]} (3p), {T.COLLAPSE_END[4]} (4p): "
          "finish the round. Vault counts full, pack counts half."]),
    )):
        x = M + i * (half + 0.2 * inch)
        c.setFillColor(S.PARCHMENT)
        c.setStrokeColor(S.RULE)
        c.roundRect(x, 0.6 * inch, half, box_h, 8, fill=1, stroke=1)
        c.setFillColor(S.INK)
        c.setFont(S.TITLE_FONT, 13)
        c.drawString(x + 0.14 * inch, 0.6 * inch + box_h - 0.3 * inch, title.upper())
        small = S.styles(9.6)["small"]
        S.fill_frame(c, x + 0.05 * inch, 0.62 * inch, half - 0.1 * inch, box_h - 0.38 * inch,
                     [S.P(t, small) for t in items], pad=5, what=f"reference box {title}")
    S.page_footer(c, W, "Glimmerdark · card reference")
    c.save()


def main():
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "card_reference.pdf"
    build(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
