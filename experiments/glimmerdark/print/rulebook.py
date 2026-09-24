"""The rulebook.

    python rulebook.py   -> dist/rulebook.pdf
"""

from __future__ import annotations

import math
import random

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Spacer, Table, TableStyle)

import board as BD
import content as T
import diagrams as DG
import emblems as E
import results as RS
import style as S
from board import GB

W, H = letter
MARGIN = 0.75 * inch
V = T.CFG
st = S.styles(10.5)


# ------------------------------------------------------------------ page art
def draw_cover(c, doc):
    c.saveState()
    c.setFillColor(S.HexColor("#15181C"))
    c.rect(0, 0, W, H, fill=1, stroke=0)
    rnd = random.Random(7)
    # mountain layers
    for layer, (shade, base, amp) in enumerate((("#2A2F36", 6.2, 1.6), ("#23272D", 4.8, 1.3), ("#1B1E23", 3.4, 1.0))):
        c.setFillColor(S.HexColor(shade))
        p = c.beginPath()
        p.moveTo(0, 0)
        pts = []
        for k in range(0, 18):
            x = k * W / 16
            y = base * inch + amp * inch * math.sin(k * 0.9 + layer) + rnd.uniform(-0.3, 0.3) * inch
            if layer == 0 and 7 <= k <= 9:
                y += 1.7 * inch  # the peak
            pts.append((x, y))
        for x, y in pts:
            p.lineTo(x, y)
        p.lineTo(W, 0)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
    # glimmer veins in the rock
    placed = 0
    while placed < 90:
        x = rnd.uniform(0.3, 8.2) * inch
        y = rnd.uniform(0.4, 5.2) * inch
        v = rnd.choice([1, 1, 2, 2, 4])
        size = rnd.uniform(0.04, 0.11) * inch
        # keep the Gate glow, the Warden's eye and the RULEBOOK label clear
        if abs(x - W / 2) < 1.55 * inch and 1.05 * inch < y < 4.6 * inch:
            continue
        if abs(x - W / 2) < 1.35 * inch and y < 0.95 * inch:
            continue
        S.draw_gem(c, x, y, size, v)
        placed += 1
    # the Gate glow
    gx, gy = W / 2, 3.05 * inch
    for k, a in enumerate((0.06, 0.1, 0.16, 0.25)):
        c.setFillColor(colors.Color(0.25, 0.83, 0.88, alpha=a))
        c.circle(gx, gy, (1.5 - k * 0.3) * inch, fill=1, stroke=0)
    c.setFillColor(S.HexColor("#0E1013"))
    p = c.beginPath()
    p.moveTo(gx - 0.55 * inch, gy - 0.9 * inch)
    p.lineTo(gx - 0.55 * inch, gy + 0.1 * inch)
    p.curveTo(gx - 0.55 * inch, gy + 0.75 * inch, gx + 0.55 * inch, gy + 0.75 * inch, gx + 0.55 * inch, gy + 0.1 * inch)
    p.lineTo(gx + 0.55 * inch, gy - 0.9 * inch)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    # the Warden's eye in the dark
    E._warden_eye(c, W / 2, 1.6 * inch, 0.42 * inch)
    # title
    c.setFillColor(S.HexColor("#E9F7F8"))
    c.setFont(S.TITLE_BLACK, 58)
    c.drawCentredString(W / 2, H - 2.3 * inch, "GLIMMERDARK")
    c.setFillColor(S.HexColor("#8FD9DE"))
    c.setFont("Alegreya-Italic", 18)
    c.drawCentredString(W / 2, H - 2.75 * inch, T.TAGLINE)
    c.setFillColor(S.HexColor("#C9C2B4"))
    c.setFont(S.LABEL_FONT, 12)
    c.drawCentredString(W / 2, H - 3.2 * inch, f"{T.PLAYERS}   ·   {T.TIME}   ·   {T.AGES}")
    c.setFont(S.SANS, 10)
    c.drawCentredString(W / 2, H - 3.5 * inch, "A board game for one standard deck of playing cards")
    c.setFont(S.TITLE_FONT, 16)
    c.setFillColor(S.HexColor("#E9F7F8"))
    c.drawCentredString(W / 2, 0.55 * inch, "RULEBOOK")
    c.restoreState()


def draw_body_page(c, doc):
    c.saveState()
    c.setStrokeColor(S.RULE)
    c.setLineWidth(0.8)
    c.line(MARGIN, H - 0.55 * inch, W - MARGIN, H - 0.55 * inch)
    c.setFont(S.TITLE_FONT, 9)
    c.setFillColor(S.INK_SOFT)
    c.drawString(MARGIN, H - 0.48 * inch, "GLIMMERDARK · RULEBOOK")
    S.page_footer(c, W, "Glimmerdark", doc.page)
    c.restoreState()


# ------------------------------------------------------------------ helpers
def h1(t):
    return S.P(t, st["h1"])


def h2(t):
    return S.P(t, st["h2"])


def h3(t):
    return S.P(t, st["h3"])


def para(t, style="body"):
    return S.P(t, st[style])


def box(flowables, fill=S.PARCHMENT, stroke=S.RULE, pad=8):
    t = Table([[flowables]], colWidths=[W - 2 * MARGIN])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), fill), ("BOX", (0, 0), (-1, -1), 0.8, stroke),
                           ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
                           ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad)]))
    return t


def example(title, lines, cards=None, played=(), diagram=None):
    items = [S.P(f"<b>Example: {title}</b>", st["h3"])]
    if cards:
        items.append(DG.card_row(cards, played, cw=0.46 * inch))
    items += [S.P(l, st["body"]) for l in lines]
    if diagram is not None:
        tbl = Table([[items, diagram]], colWidths=[W - 2 * MARGIN - diagram.width - 0.3 * inch, diagram.width + 0.3 * inch])
        tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        items = [tbl]
    return KeepTogether([box(items, fill=S.HexColor("#EEF8F8"), stroke=S.GLOW)])


def mini(width_in, height_in, **kw):
    scale = kw.pop("scale", 14.0)
    x0 = kw.pop("x0", 0.0)
    y0 = kw.pop("y0", 0.0)
    return DG.Drawn(width_in * inch, height_in * inch,
                    lambda c, w, h: DG.mini_map(c, x0, y0, scale, **kw))


def games_line() -> str:
    total = RS.games_total()
    if not total:
        return "Balanced by simulation; see the Designer's Notes for the numbers."
    return (f"Balanced over {total / 1e6:.1f} million simulated games; see the Designer's Notes for the numbers."
            if total >= 1e6 else f"Balanced over {total:,} simulated games; see the Designer's Notes for the numbers.")


# ------------------------------------------------------------------ content
def story():
    s = []
    s.append(NextPageTemplate("body"))
    s.append(PageBreak())

    # ---- welcome
    s.append(h1("Welcome to the Glimmerdark"))
    s.append(para(T.STORY))
    s.append(Spacer(1, 6))
    s.append(box([S.P("<b>Goal.</b> " + T.GOAL, st["body"])]))
    s.append(h2("The game in one minute"))
    for t in [
        f"On your turn you play up to <b>{V.actions_per_turn} cards</b> from your hand. Each card is one action: "
        "<b>Move</b> your delver one chamber (any card), <b>Mine</b> glimmer (a card whose suit matches the "
        "chamber's vein), or trigger a face card's <b>Event</b>.",
        f"Deeper chambers hold richer glimmer: {T.DEPTH_VALUES[0]}, {T.DEPTH_VALUES[1]} and {T.DEPTH_VALUES[2]} "
        f"points. Your pack holds {V.pack_limit} tokens, and they're only safe once you carry them back to the Gate.",
        "After everyone has gone, the <b>Warden</b> walks toward whoever is winning and crushes anyone it catches, "
        "scattering half their pack.",
        "Every reshuffle and every Joker shakes the mountain. When the <b>collapse</b> track fills up, the game ends.",
    ]:
        s.append(para("• " + t))
    s.append(h2("Components"))
    for comp in T.COMPONENTS:
        s.append(para("• " + comp))
    s.append(DG.Drawn(W - 2 * MARGIN, 0.95 * inch, _components_strip))
    s.append(para("Everything except the cards and the figures is in the printable PDFs: board (4 sheets), "
                  "components sheet (tokens, standees, markers), player aids and card reference.", "italic"))

    # ---- setup
    s.append(PageBreak())
    s.append(h1("Setup"))
    setup_diagram = DG.Drawn(3.65 * inch, 4.95 * inch, _setup_map)
    steps = [S.P(f"<b>{i}.</b> {t}", st["body"]) for i, t in enumerate(T.SETUP, 1)]
    tbl = Table([[steps, setup_diagram]], colWidths=[W - 2 * MARGIN - 3.8 * inch, 3.8 * inch])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    s.append(tbl)
    s.append(Spacer(1, 6))
    s.append(box([S.P("<b>The map.</b> The Gate is the surface. Below it lie three depths of four chambers, "
                      "labelled A1–D3, and the Heart at the bottom. Tunnels join chambers side by side and "
                      "straight down; the Gate reaches all four depth-1 chambers, and the Heart connects to B3 and C3. "
                      "Every depth has one chamber of each vein.", st["body"])]))

    s.append(Spacer(1, 8))
    s.append(box([S.P("<b>Your first game.</b> The four suit delvers (Mira {H}, Gritch {S}, Hulda {C} and Sable {D}) "
                      "are the easiest to learn; add Pip & Pell and Old Quill once everyone knows the rules. "
                      "Each player keeps their player aid in front of them: its PACK box holds the glimmer you "
                      "carry, and your banked glimmer goes in the VAULT box, face up for everyone to see.", st["body"]),
                  S.P("<b>Teaching in ten minutes.</b> Read <i>The game in one minute</i> aloud, show one Move and "
                      "one Mine with real cards, flip one rumble card for the Warden, and point at the collapse "
                      "track. Everything else can be looked up on the card reference as it comes up.", st["body"])],
                 fill=S.PAPER, stroke=S.GLOW))

    # ---- cards
    s.append(PageBreak())
    s.append(h1("What the cards mean"))
    s.append(para("There are no special cards: suits, ranks and faces get their meaning from the rules. You never "
                  "mark or change a card. Keep a card reference sheet in front of each player."))
    rows = [[S.P("<b>Card</b>", st["cell_b"]), S.P("<b>In short</b>", st["cell_b"]), S.P("<b>What it does</b>", st["cell_b"])]]
    for label, short, long in T.CARD_TABLE:
        rows.append([S.P(f"<b>{label}</b>", st["cell_b"]), S.P(short, st["cell"]), S.P(long, st["cell"])])
    t = Table(rows, colWidths=[0.85 * inch, 1.65 * inch, W - 2 * MARGIN - 2.5 * inch], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), S.PARCHMENT_DEEP), ("LINEBELOW", (0, 0), (-1, -1), 0.5, S.RULE),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    s.append(t)

    # ---- turn
    s.append(CondPageBreak(3.2 * inch))
    s.append(h1("Your turn"))
    for i, t in enumerate(T.TURN_SUMMARY, 1):
        s.append(para(f"<b>{i}.</b> {t}"))
    s.append(h2("Actions"))
    for name, who, what in T.ACTIONS:
        s.append(para(f"<b>{name}</b> <i>({who})</i>: {what}"))
    s.append(para(f"You may take fewer than {V.actions_per_turn} actions. In a 3- or 4-player game the first player "
                  "takes only one action on their very first turn."))
    s.append(h2("Your pack and the Gate"))
    s.append(para(T.PACK_RULE))
    s.append(Spacer(1, 4))
    s.append(example("a first turn",
                     ["Hulda is second in turn order, so she has both actions. She starts at the Gate holding "
                      "4{S} 9{D} A{H} 6{C} K{S}.",
                      "<b>Action 1:</b> she plays 4{S} to <b>Move</b> into C1. Any card can move one chamber, "
                      "and a low spade is the cheapest card to spend.",
                      "<b>Action 2:</b> C1 is a {D} vein, so she plays 9{D} to <b>Mine</b>. A 9 is high, so she "
                      f"takes {V.high_yield} of the 1-point glimmer into her pack.",
                      f"She keeps A{{H}} (wild, it mines any vein) and K{{S}} (to Rouse the Warden later), then draws "
                      f"back up to {V.hand_size} cards."],
                     cards=["4S", "9D", "AH", "6C", "KS"], played=("4S", "9D")))
    s.append(Spacer(1, 6))
    s.append(example("going deeper",
                     ["Next turn Hulda holds A{H} 6{C} K{S} 7{C} 2{H}.",
                      "She plays 2{H} to Move down to C2, a {S} vein at depth 2. Then she plays K{S} <b>as a normal "
                      f"card of rank 10</b> instead of its Rouse event: a {{S}} matches the vein and a 10 is high, so "
                      f"she mines {V.high_yield} two-point glimmer. Her pack now holds 1 + 1 + 2 + 2.",
                      "If C2 had been any other vein, A{H} would have mined 1 there: Aces are wild but low."],
                     cards=["AH", "6C", "KS", "7C", "2H"], played=("2H", "KS")))

    # ---- warden
    s.append(CondPageBreak(2.6 * inch))
    s.append(h1("The Warden's turn"))
    s.append(para("After the last player's turn, the Warden takes its turn. The first player does the rumble."))
    for k, v in T.WARDEN_RULES:
        s.append(para(f"<b>{k}.</b> {v}"))
    s.append(Spacer(1, 6))
    warden_map = DG.Drawn(3.1 * inch, 3.9 * inch, _warden_map)
    s.append(example("a rumble and a crush", [
        "The first player flips 8{H}: a number card, so the Warden moves 1 chamber.",
        "Mira is in B3 with 6 in her vault and 4 + 2 + 2 in her pack: 14 in all. Hulda in C2 has 0 banked and "
        "6 carried: 6. Gritch has 12 but he's at the Gate, so he's safe. The Warden walks toward the winning delver "
        "who's underground: Mira.",
        "From the Heart it steps straight into B3. Mira is crushed: half her 3 tokens, rounded up, is 2, and she "
        "chooses to drop both 2s into B3. She keeps the 4 and retreats one chamber toward the Gate, to B2.",
        "Had the flip been a Joker, the Warden would stay put: Tremor instead.",
    ], diagram=warden_map))

    # ---- jokers & end
    s.append(CondPageBreak(4.5 * inch))
    s.append(h1("Tremors and the collapse"))
    s.append(para("<b>Joker: Tremor.</b> " + T.CARD_TABLE[-1][2]))
    s.append(para("<b>Reshuffle.</b> Whenever a card must be drawn, or flipped for the rumble, and the draw pile is "
                  "empty, shuffle the discard pile into a new draw pile "
                  "and advance the collapse marker 1 space."))
    s.append(h2("The end"))
    for t in T.END_RULES:
        s.append(para("• " + t))
    s.append(Spacer(1, 6))
    s.append(example("final scoring (3 players)", [
        f"Hulda needs two cards to refill, but the draw pile holds one. She draws it, shuffles the discards into "
        f"a new draw pile and moves the collapse marker to {T.COLLAPSE_END[3]}: the end space for 3 players. She "
        "draws her second card. Everyone finishes the round, the Warden rumbles one last time, then:",
        "Mira: vault 23, pack 4 + 2 = 6, counts half = 3. <b>26</b>.",
        "Hulda: vault 21, pack 4 + 4 + 1 = 9, counts half (rounded down) = 4. <b>25</b>.",
        "Gritch: vault 26, pack empty. <b>26</b>.",
        "Mira and Gritch tie on 26. Gritch has more in his vault (26 against 23), so <b>Gritch wins</b>.",
    ]))
    s.append(Spacer(1, 6))
    s.append(example("Queens and Kings", [
        "Gritch is in D2 holding Q{H} K{C}. Sable is next door in D3 carrying 4 + 4 + 2, and the Warden is in C3.",
        "Gritch plays Q{H} for its <b>Pilfer</b> event and takes Sable's most valuable glimmer, a 4.",
        f"Then he plays K{{C}} for <b>Rouse</b>: he moves the Warden up to {V.king_rouse_steps} chambers, one at a time. It "
        "steps from C3 into D3, where it crushes Sable and stops. Half of her 2 tokens, rounded up, is 1: she drops "
        "the 2 and retreats to D2.",
    ], cards=["QH", "KC"], played=("QH", "KC")))

    # ---- delvers
    s.append(CondPageBreak(3.5 * inch))
    s.append(Spacer(1, 10))
    s.append(h1("The delvers"))
    s.append(para("Each player controls one delver with its own ability, and each ability bends the card rules a "
                  "little differently. Everything else follows the normal rules. Each delver's player aid has "
                  "a full example."))
    for key, ch in T.CHARACTERS.items():
        em = DG.Drawn(0.9 * inch, 0.9 * inch, lambda c, w, h, key=key: E.emblem(c, key, w / 2, h / 2, 0.42 * inch))
        txt = [S.P(f"<b>{ch['name']}</b>, <i>{ch['title']}</i> · {ch['affinity']}", st["label"]),
               S.P(f"<b>{ch['ability']}.</b> {ch['text']}", st["body"])]
        tt = Table([[em, txt]], colWidths=[1.0 * inch, W - 2 * MARGIN - 1.0 * inch])
        tt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, -1), 0.5, S.RULE),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
        s.append(tt)
    s.append(Spacer(1, 6))
    s.append(example("Pip & Pell play four cards", [T.CHARACTERS["twins"]["example"]],
                     cards=T.CHARACTERS["twins"]["hand"], played=T.CHARACTERS["twins"]["played"]))

    # ---- FAQ & tips
    s.append(CondPageBreak(4.0 * inch))
    s.append(Spacer(1, 12))
    s.append(h1("Questions & tips"))
    for q, a in T.FAQ:
        s.append(para(f"<b>{q}</b> {a}"))
    s.append(h2("Tips"))
    for t in [
        "Spend your low off-vein cards on moving and save high cards for the vein you're heading to.",
        "Bank before you get greedy. At the end, half of a full pack is worth less than a trip home.",
        "Watch the Warden's target: it's whoever is winning and underground. If that's you, keep moving or head up.",
        "Kings are weapons. A Rouse into a loaded rival's chamber can swing the game.",
        "Count the draw pile. It tells you how close the next reshuffle, and the collapse, is.",
    ]:
        s.append(para("• " + t))
    s.append(h2("Credits"))
    s.append(para("Design, simulation and balancing: the Glimmerdark project. Fonts: Cinzel, Alegreya and Alegreya Sans "
                  "(SIL Open Font License), DejaVu Sans. " + games_line(), "small"))
    return s


def _components_strip(c, w, h):
    """Tokens, the Crown, cards and figures in one row, scaled down to fit the frame if needed."""
    tok, crown, card, fig = 1.0 * inch, 0.9 * inch, 0.58 * inch, 0.8 * inch
    natural = 0.1 * inch + len(T.TOKENS) * tok + crown + 4 * card + 2 * fig
    k = min(1.0, w / natural)
    c.saveState()
    c.translate((w - natural * k) / 2, h * (1 - k) / 2)
    c.scale(k, k)
    x = 0.1 * inch
    for v, n in T.TOKENS:
        S.draw_token(c, x + 0.33 * inch, h / 2, 0.3 * inch, v)
        c.setFont(S.SANS, 9)
        c.setFillColor(S.INK_SOFT)
        c.drawString(x + 0.68 * inch, h / 2 - 3, f"× {n}")
        x += tok
    S.draw_token(c, x + 0.38 * inch, h / 2, 0.34 * inch, 5, crown=True)
    x += crown
    for code in ("AS", "7H", "QD", "JK"):
        S.draw_card(c, x, 0.08 * inch, 0.5 * inch, code)
        x += card
    for key in ("mira", "warden"):
        E.emblem(c, key, x + 0.4 * inch, h / 2, 0.34 * inch)
        x += fig
    c.restoreState()


def _setup_map(c, w, h):
    glim = {n: [T.DEPTH_VALUES[GB.DEPTH[n] - 1]] * 3 for n in range(1, 13)}
    DG.mini_map(c, 0, 0, 0.24 * inch, figures={GB.GATE: ["mira", "gritch", "hulda"]}, warden=GB.HEART, glimmer=glim)


def _warden_map(c, w, h):
    DG.mini_map(c, -0.05 * inch, -0.35 * inch, 0.2 * inch,
                figures={10: ["mira"], 7: ["hulda"], GB.GATE: ["gritch"]}, warden=GB.HEART,
                arrows=[(GB.HEART, 10, S.DANGER), (10, 6, S.INK_SOFT)], crush=10)


def build(out):
    doc = BaseDocTemplate(str(out), pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=0.8 * inch, bottomMargin=0.7 * inch, title="Glimmerdark rulebook",
                          author="Glimmerdark")
    cover = PageTemplate(id="cover", frames=[Frame(0, 0, W, H, id="c")], onPage=draw_cover)
    body = PageTemplate(id="body", frames=[Frame(MARGIN, 0.7 * inch, W - 2 * MARGIN, H - 1.5 * inch, id="b")],
                        onPage=draw_body_page)
    doc.addPageTemplates([cover, body])
    doc.build([Spacer(1, 1)] + story())


def main():
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "rulebook.pdf"
    build(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
