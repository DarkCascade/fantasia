"""Miniatures Guide: Meshy prompts, negative prompts, sizes, ability ties and
paint schemes for every figure, plus the printability rules and a scale chart.

    python miniatures_guide.py  -> dist/miniatures_guide.pdf
"""

from __future__ import annotations

import sys

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

import emblems as E
import style as S

sys.path.insert(0, str(S.HERE.parent / "minis"))
import minis as MI  # noqa: E402

W, H = letter
MARGIN = 0.75 * inch
st = S.styles(10.5)
MONO = ParagraphStyle("mono", fontName="DejaVuSansMono", fontSize=8.2, leading=10.6, textColor=S.INK)


def on_page(c, doc):
    c.saveState()
    c.setStrokeColor(S.RULE)
    c.line(MARGIN, H - 0.55 * inch, W - MARGIN, H - 0.55 * inch)
    c.setFont(S.TITLE_FONT, 9)
    c.setFillColor(S.INK_SOFT)
    c.drawString(MARGIN, H - 0.48 * inch, "GLIMMERDARK · MINIATURES GUIDE")
    S.page_footer(c, W, "Glimmerdark", doc.page)
    c.restoreState()


def boxed(flow, fill=S.PARCHMENT, stroke=S.RULE, width=W - 2 * MARGIN):
    t = Table([[flow]], colWidths=[width])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), fill), ("BOX", (0, 0), (-1, -1), 0.8, stroke),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def scale_chart(c, w, h):
    """Figures drawn as silhouette bars at true relative height, on a millimetre scale."""
    figs = MI.FIGURES
    top_mm = 65
    base_y = 0.35 * inch
    per_mm = (h - base_y - 0.25 * inch) / top_mm
    c.setStrokeColor(S.RULE)
    c.setFont(S.SANS, 7)
    c.setFillColor(S.INK_SOFT)
    for mmv in range(0, top_mm + 1, 10):
        y = base_y + mmv * per_mm
        c.line(0.45 * inch, y, w, y)
        c.drawRightString(0.4 * inch, y - 2, f"{mmv} mm")
    slot = (w - 0.6 * inch) / len(figs)
    for i, f in enumerate(figs):
        x = 0.6 * inch + i * slot + slot / 2
        pal = E.palette(f["key"])
        bh = f["height_mm"] * per_mm
        bw = min(slot * 0.55, f["base_mm"] * per_mm)
        c.setFillColor(pal[0])
        c.roundRect(x - bw / 2 * 0.7, base_y, bw * 0.7, bh, 6, fill=1, stroke=0)
        c.setFillColor(S.STONE)
        c.rect(x - bw / 2, base_y - 3, bw, 4, fill=1, stroke=0)
        E.emblem(c, f["key"], x, base_y + bh + 0.22 * inch, 0.17 * inch)
        c.setFillColor(S.INK)
        c.setFont(S.LABEL_FONT, 7.5)
        c.drawCentredString(x, base_y - 0.16 * inch, E.display_name(f["key"]).split(" ")[0])
        c.setFont(S.SANS, 7)
        c.drawCentredString(x, base_y - 0.28 * inch, f"{f['height_mm']} mm / {f['base_mm']} mm base")


def figure_block(f):
    name, title, cnames, pal = MI.display(f["key"])
    em = __import__("diagrams").Drawn(0.9 * inch, 0.9 * inch, lambda c, w, h, k=f["key"]: E.emblem(c, k, w / 2, h / 2, 0.42 * inch))
    head = [S.P(f"<b>{name}</b>, <i>{title}</i>", st["h2"]),
            S.P(f"<b>Height</b> {f['height_mm']} mm to the top of the head (on a {f['base_mm']} mm round base) · "
                f"<b>Prompt</b> {len(MI.prompt(f))}/{MI.MESHY_PROMPT_MAX} characters", st["small"])]
    top = Table([[em, head]], colWidths=[1.0 * inch, W - 2 * MARGIN - 1.0 * inch])
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    swatches = []
    for cn, hx in zip(cnames, pal):
        nb = cn.replace(" ", "\u00a0")
        swatches.append(f'<font name="DejaVuSans" color="{hx}">■</font>\u00a0{nb}\u00a0<font size="7" color="#9A9186">{hx}</font>')
    flow = [top,
            S.P("<b>Meshy prompt</b>", st["h3"]), boxed(Paragraph(MI.prompt(f), MONO), fill=S.HexColor("#FBF8F1")),
            S.P("<b>Negative prompt</b>", st["h3"]), boxed(Paragraph(MI.negative(f), MONO), fill=S.HexColor("#FBF8F1")),
            S.P("<b>In the game.</b> " + f["tie"], st["body"]),
            S.P("<b>Paint scheme</b> (the same colours as the player aid): " + "\u00a0\u00a0 ".join(swatches), st["body"]),
            S.P(f["paint"], st["small"]),
            Spacer(1, 8)]
    return KeepTogether(flow)


def story():
    s = []
    s.append(S.P("Miniatures guide", st["h1"]))
    s.append(S.P("Seven figures: the six delvers and the Warden. Each one comes from a single text prompt for Meshy's "
                 "text-to-3D generator, written to produce a model that survives resin or FDM printing at about 32 mm "
                 "scale. The prompts are also in <font name='DejaVuSansMono'>minis/meshy_prompts.txt</font>, one per line, "
                 "ready to copy.", st["body"]))
    s.append(S.P("The shared style prefix", st["h2"]))
    s.append(S.P("Every prompt starts with exactly this text, so the set looks like one sculptor made it and every "
                 "prompt carries the printability rules:", st["body"]))
    s.append(boxed(Paragraph(MI.STYLE_PREFIX, MONO), fill=S.HexColor("#FBF8F1")))
    s.append(S.P("Printability rules (in every prompt)", st["h2"]))
    for t in ["<b>One solid standing model on an integrated round base.</b> No loose parts to glue, and it stands on the board.",
              "<b>Compact pose, limbs close to the body.</b> Arms and props are hugged, clasped or held diagonally across the body.",
              "<b>Nothing thin or free-floating.</b> No loose hair strands, thin weapons, wide capes, dangling rope or quills. "
              "Every prop is described as thick, stubby or blocky.",
              "<b>No background, scenery or text.</b> The base is the only ground.",
              "<b>Readable silhouette.</b> Each delver's role reads at arm's length: a lantern, a giant spade, stone fists, a "
              "pulley, two figures back to back, a rolled map, a boulder-giant.",
              "<b>Card affinity in the sculpt.</b> A heart window, a spade-shaped blade, a club buckle, a diamond clasp, "
              "matching twin helmets, a crown buckle for the face cards."]:
        s.append(S.P("• " + t, st["body"]))
    s.append(S.P("Using Meshy", st["h2"]))
    for t in [f"Prompts are at most {MI.MESHY_PROMPT_MAX} characters each (Meshy's text-to-3D limit); the longest here is "
              f"{max(len(MI.prompt(f)) for f in MI.FIGURES)}.",
              "The repo's pipeline (<font name='DejaVuSansMono'>experiments/meshy-prototype/generate.sh</font>) calls the v2 "
              "text-to-3D endpoint in <i>preview</i> mode. <font name='DejaVuSansMono'>minis/meshy_batch.py</font> does the "
              "same for every figure, sends the negative prompt, and defaults to the <i>sculpture</i> art style, which "
              "comes back untextured and suits printing. Pass <font name='DejaVuSansMono'>--art-style realistic</font> to "
              "match the old script.",
              "Some Meshy versions ignore or reject a negative prompt. If yours does, run with "
              "<font name='DejaVuSansMono'>--no-negative</font>. The printability rules are already in the positive prompt.",
              "Generate 2–4 variants per figure and keep the one with the clearest silhouette and the fewest thin bits."]:
        s.append(S.P("• " + t, st["body"]))
    s.append(S.P("Before you print", st["h2"]))
    for t in ["<b>Scale to height.</b> <font name='DejaVuSansMono'>meshy_batch.py --stl</font> scales each model so it "
              "stands its listed height, rotates it Z-up and sits it on the build plate.",
              "<b>Decimate.</b> Meshy's preview meshes are huge (this repo's snowman came back at about 1.9 million "
              "triangles). The script trims anything over 300k faces, which is invisible at this scale.",
              "<b>Make it watertight.</b> The script reports whether each mesh is watertight. If not, repair it "
              "(Meshmixer, PrusaSlicer's repair, or Netfabb) before slicing.",
              "<b>Resin:</b> tilt 30–45°, light supports under the base edge and chin. <b>FDM:</b> 0.4 mm nozzle, 0.08–0.12 mm "
              "layers, tree supports, base flat on the bed. The Warden prints fine hollowed on resin (drain holes under the base).",
              "<b>Bases:</b> 25 mm round for single delvers, 32 mm for Pip & Pell, 50 mm for the Warden. These match the "
              "board's chambers, which hold three tokens and two or three figures."]:
        s.append(S.P("• " + t, st["body"]))
    s.append(CondPageBreak(3.2 * inch))
    s.append(S.P("Scale chart", st["h2"]))
    s.append(__import__("diagrams").Drawn(W - 2 * MARGIN, 2.9 * inch, scale_chart))
    s.append(PageBreak())
    for f in MI.FIGURES:
        s.append(figure_block(f))
    s.append(CondPageBreak(3 * inch))
    s.append(S.P("Prompt checklist", st["h2"]))
    rows = [[S.P("<b>Figure</b>", st["cell_b"]), S.P("<b>Chars</b>", st["cell_b"])] +
            [S.P(f"<b>{h}</b>", st["cell_b"]) for h in ("Style prefix", "Round base", "Compact pose", "No thin parts", "No text or scene", "No fragile words")]]
    for f in MI.FIGURES:
        p = MI.prompt(f)
        ok = lambda b: ('<font name="DejaVuSans" color="#2E7D4F">✓</font>' if b
                        else '<font name="DejaVuSans" color="#B3261E">✗ FAIL</font>')
        rows.append([S.P(E.display_name(f["key"]), st["cell"]), S.P(str(len(p)), st["cell"]),
                     S.P(ok(p.startswith(MI.STYLE_PREFIX)), st["cell"]), S.P(ok("integrated round base" in p), st["cell"]),
                     S.P(ok("compact pose" in p and "held tight to the body" in p), st["cell"]),
                     S.P(ok("no thin or floating parts" in p), st["cell"]),
                     S.P(ok("no text" in p and "no scenery" in p and "no background" in p), st["cell"]),
                     S.P(ok(not MI.BANNED.search(f["body"])), st["cell"])])
    t = Table(rows, colWidths=[1.6 * inch, 0.55 * inch] + [0.8 * inch] * 6, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), S.PARCHMENT_DEEP), ("LINEBELOW", (0, 0), (-1, -1), 0.5, S.RULE),
                           ("FONTNAME", (0, 0), (-1, -1), "DejaVuSans")]))
    s.append(t)
    s.append(S.P("Checked automatically by <font name='DejaVuSansMono'>python minis/minis.py</font>, which refuses to write the "
                 "prompts file if any rule fails.", st["small"]))
    return s


def main():
    S.DIST.mkdir(exist_ok=True)
    out = S.DIST / "miniatures_guide.pdf"
    doc = BaseDocTemplate(str(out), pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=0.8 * inch,
                          bottomMargin=0.7 * inch, title="Glimmerdark miniatures guide", author="Glimmerdark")
    doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(MARGIN, 0.7 * inch, W - 2 * MARGIN, H - 1.5 * inch)],
                                       onPage=on_page)])
    doc.build(story())
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
