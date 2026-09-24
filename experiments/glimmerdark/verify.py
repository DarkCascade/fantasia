"""Part 5: verify the whole package.

    python verify.py            # everything (re-runs part of the simulation; ~2 minutes on 4 cores)
    python verify.py --no-sim   # skip the simulation re-runs

Writes results/verification.txt. Checks:
  1. the rules engine's unit tests and the printed-examples tests (sim/tests)
  2. every rules text in content.py appears verbatim in each PDF that prints it,
     with the same card meanings everywhere, and no stale or broken text anywhere
  3. PDF geometry: page sizes, text inside the printable area, fonts embedded
  4. the tiled board re-assembles pixel-for-pixel into the full board, on Letter and on A4
  5. the Meshy prompts obey the printability rules, and the .txt matches the guide
  6. the Designer's Notes numbers: re-derived from results/, reproduced exactly by a
     re-run of one configuration, and confirmed by an independent-seed re-run of playtime
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "print"))
sys.path.insert(0, str(ROOT / "sim"))
sys.path.insert(0, str(ROOT / "minis"))

import pymupdf  # noqa: E402

import content as T  # noqa: E402
import results as RS  # noqa: E402
from glimmer import rules as R  # noqa: E402

DIST = ROOT / "dist"
INCH = 72
LOG: list[str] = []
FAILED: list[str] = []


def ok(cond: bool, what: str, detail: str = ""):
    line = f"[{'PASS' if cond else 'FAIL'}] {what}" + (f": {detail}" if detail else "")
    LOG.append(line)
    print(line, flush=True)
    if not cond:
        FAILED.append(what)
    return cond


def section(title):
    LOG.append(f"\n== {title}")
    print(f"\n== {title}", flush=True)


# ------------------------------------------------------------------ text helpers
def plain(s: str) -> str:
    s = T.suit_text(s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&amp;", "&").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def pdf_text(path: Path, pages=None) -> str:
    doc = pymupdf.open(path)
    idx = range(len(doc)) if pages is None else pages
    txt = " ".join(doc[i].get_text() for i in idx)
    txt = txt.replace("­", "").replace("-\n", "-")
    return re.sub(r"\s+", " ", txt)


def has(text: str, needle: str) -> bool:
    return plain(needle) in text


# ------------------------------------------------------------------ 1. tests
def check_tests():
    section("1. rules engine tests")
    r = subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=ROOT / "sim", capture_output=True, text=True)
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-200:]
    ok(r.returncode == 0, "pytest (engine rules + every printed example replayed on the engine)", last)


# ------------------------------------------------------------------ 2. documents agree
def check_documents():
    section("2. the documents say the same thing as content.py, and so each other")
    V = T.V
    rb = pdf_text(DIST / "rulebook.pdf")
    ref = pdf_text(DIST / "card_reference.pdf")
    aids = pymupdf.open(DIST / "player_aids.pdf")
    board = pdf_text(DIST / "board_letter.pdf")
    keys = list(T.CHARACTERS)
    ok(len(aids) == len(keys), "one player aid page per delver", f"{len(aids)} pages")

    for label, short, long in T.CARD_TABLE:
        ok(has(rb, long) and has(ref, long), f"card meaning '{label}' identical in rulebook and card reference")
        ok(has(ref, short), f"card short-form '{label}' on the card reference")
    for name, who, what in T.ACTIONS:
        ok(has(rb, what) and has(ref, what), f"action '{name}' identical in rulebook and card reference")
    for k, v in T.WARDEN_RULES:
        ok(has(rb, v) and has(ref, v), f"Warden rule '{k}' identical in rulebook and card reference")
    for t in T.SETUP + T.TURN_SUMMARY + T.END_RULES + [T.PACK_RULE]:
        ok(has(rb, t), "rulebook prints: " + plain(t)[:60] + "…")
    for q, a in T.FAQ:
        ok(has(rb, q) and has(rb, a), "FAQ in rulebook: " + plain(q))
    for i, key in enumerate(keys):
        ch = T.CHARACTERS[key]
        page = re.sub(r"\s+", " ", aids[i].get_text())
        ok(has(rb, ch["text"]), f"{ch['name']}: ability text in the rulebook")
        ok(has(page, ch["text"]), f"{ch['name']}: same ability text on the player aid")
        ok(has(page, ch["example"]), f"{ch['name']}: worked example on the player aid")
        jack = T.QUILL_JACK if key == "quill" else V.jack_steps
        pack = T.GRITCH_PACK if key == "gritch" else V.pack_limit
        ok(f"J Shortcut {jack}," in page and f"holds {pack}" in page,
           f"{ch['name']}: aid's turn reminder uses this delver's Jack ({jack}) and pack ({pack})")
        ok(f"{T.LOW_RANKS} and A take {V.low_yield}, {T.HIGH_RANKS} and faces take {V.high_yield}" in page,
           f"{ch['name']}: aid's mining numbers")
    ok(has(rb, T.CHARACTERS["twins"]["example"]), "rulebook's Pip & Pell example is the aid's example")
    ok(f"A–10: {V.warden_steps_number} step. J Q K: {V.warden_steps_face} steps" in board,
       "board panel: Warden steps")
    ok(f"refill to {V.hand_size}. Your pack holds {V.pack_limit} (Gritch's {T.GRITCH_PACK})" in board,
       "board panel: hand and pack")
    E = T.COLLAPSE_END
    ends = f"({E[2]} with 2 players, {E[3]} with 3, {E[4]} with 4)"
    ok(ends in rb, f"rulebook: collapse ends {ends}")
    ok(f"{E[2]} (2p), {E[3]} (3p), {E[4]} (4p)" in ref, "card reference: the same collapse ends")

    # stale or broken text anywhere in any PDF
    stale = [r"\{[SHDC]\}", r"&nbsp;", r"&amp;", r"\bNone\b", r"\bnan\b", r"worth 3\b", r"(?<![\d,])30,000", r"millions",
             r"3 reshuffles", r"Move up to 2 chambers"]
    for pdf in sorted(DIST.glob("*.pdf")):
        t = pdf_text(pdf)
        bad = [p for p in stale if re.search(p, t)]
        if "\x00" in t or "\ufffd" in t:
            bad.append("missing glyph (a character the font can't draw)")
        ok(not bad, f"{pdf.name}: no stale or broken text", ", ".join(bad))


# ------------------------------------------------------------------ 3. geometry
PAGE_SIZES = {"letter": (612, 792), "a4": (595.3, 841.9)}


def check_geometry():
    section("3. PDF geometry and fonts")
    for pdf in sorted(DIST.glob("*.pdf")):
        doc = pymupdf.open(pdf)
        want = "a4" if "a4" in pdf.stem else "letter"
        W, H = PAGE_SIZES[want]
        sizes_ok = all(abs(p.rect.width - W) < 1 and abs(p.rect.height - H) < 1 for p in doc)
        ok(sizes_ok, f"{pdf.name}: every page is {want}", f"{len(doc)} pages")
        margin = 0.2 * INCH
        outside = []
        for i, p in enumerate(doc):
            clip = tile_rect(p) if pdf.stem.startswith("board") and i > 0 else None
            for b in p.get_text("blocks"):
                r = pymupdf.Rect(b[:4])
                if clip is not None and clip.contains(pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)):
                    r = r & clip  # board art is clipped to its sheet; only the visible part prints
                x0, y0, x1, y1 = r
                if x0 < margin - 0.5 or y0 < margin - 0.5 or x1 > W - margin + 0.5 or y1 > H - margin + 0.5:
                    outside.append(f"p{i + 1}:{b[4][:30]!r}")
        ok(not outside, f"{pdf.name}: all text inside the printable area (0.2 in)", "; ".join(outside[:3]))
        fonts = {f[3].split("+")[-1]: f[1] for p in doc for f in p.get_fonts()}
        used = {sp["font"].split("+")[-1] for p in doc for b in p.get_text("dict")["blocks"]
                for ln in b.get("lines", []) for sp in ln["spans"] if sp["text"].strip()}
        not_embedded = [n for n in used if fonts.get(n) in ("n/a", "", None)]
        ok(not not_embedded, f"{pdf.name}: every font used is embedded ({', '.join(sorted(used))})",
           ", ".join(not_embedded))


def tile_rect(page):
    import board as BD
    tw, th = BD.TILE_W * INCH, BD.TILE_H * INCH
    ox, oy = (page.rect.width - tw) / 2, (page.rect.height - th) / 2
    return pymupdf.Rect(ox, oy, ox + tw, oy + th)


# ------------------------------------------------------------------ 4. board tiles
def check_board(dpi=40):
    section("4. board tiles re-assemble into the full board")
    import numpy as np
    from reportlab.pdfgen import canvas
    import board as BD
    full_pdf = ROOT / "results" / "_board_full.pdf"
    c = canvas.Canvas(str(full_pdf), pagesize=(BD.BOARD_W * INCH, BD.BOARD_H * INCH))
    BD.draw_board(c)
    c.save()

    def raster(page, clip=None):
        pix = page.get_pixmap(dpi=dpi, clip=clip, colorspace=pymupdf.csRGB)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(int)

    full = raster(pymupdf.open(full_pdf)[0])
    full_pdf.unlink()
    tw, th = BD.TILE_W * INCH, BD.TILE_H * INCH
    for name in ("board_letter.pdf", "board_a4.pdf"):
        doc = pymupdf.open(DIST / name)
        ok(len(doc) == 5, f"{name}: assembly guide + 4 sheets")
        worst = 0.0
        seam = []
        for page_no, (col, row) in zip(range(1, 5), ((0, 1), (1, 1), (0, 0), (1, 0))):
            # copy the sheet's trim area onto a page of exactly that size, so it rasterises on the same
            # pixel grid as the full board whatever the paper size
            tmp = pymupdf.open()
            tp = tmp.new_page(width=tw, height=th)
            tp.show_pdf_page(tp.rect, doc, page_no, clip=tile_rect(doc[page_no]))
            tile = raster(tp)
            # the same region of the full board (pymupdf's y runs downward; board row 1 is the top half)
            fy0 = 0 if row == 1 else full.shape[0] // 2
            fx0 = 0 if col == 0 else full.shape[1] // 2
            ref = full[fy0:fy0 + tile.shape[0], fx0:fx0 + tile.shape[1]]
            h, w = min(tile.shape[0], ref.shape[0]), min(tile.shape[1], ref.shape[1])
            diff = np.abs(tile[:h, :w] - ref[:h, :w]).mean(axis=2)
            # ignore a thin band at the edges, where the half-targets and crop marks are printed
            band = int(0.3 * dpi)
            core = diff[band:h - band, band:w - band]
            worst = max(worst, float(core.mean()))
            seam.append((col, row, tile))
        ok(worst < 2.0, f"{name}: every sheet matches its quarter of the full board",
           f"mean pixel difference {worst:.2f}/255")
        # seams: the last column of the left sheets continues into the first column of the right sheets
        t = {(c_, r_): im for c_, r_, im in seam}
        lr = np.abs(t[(0, 1)][:, -3] - t[(1, 1)][:, 2]).mean()
        tb = np.abs(t[(0, 1)][-3, :] - t[(0, 0)][2, :]).mean()
        ok(lr < 25 and tb < 25, f"{name}: artwork continues across both seams",
           f"left/right {lr:.1f}, top/bottom {tb:.1f} (mean /255 either side of the join)")


# ------------------------------------------------------------------ 5. prompts
def check_prompts():
    section("5. Meshy prompts")
    import minis as MI
    lines = (ROOT / "minis" / "meshy_prompts.txt").read_text(encoding="utf-8").splitlines()
    ok(lines == [MI.prompt(f) for f in MI.FIGURES], "meshy_prompts.txt is exactly the prompts, one per line",
       f"{len(lines)} lines")
    ok(len(MI.FIGURES) == len(T.CHARACTERS) + 1, "a prompt for every delver and the Warden")
    for f in MI.FIGURES:
        probs = MI.check(f)
        ok(not probs, f"{f['key']}: printability rules ({len(MI.prompt(f))}/{MI.MESHY_PROMPT_MAX} chars)",
           "; ".join(probs))
    guide = pdf_text(DIST / "miniatures_guide.pdf")
    for f in MI.FIGURES:
        ok(plain(MI.prompt(f)) in guide and plain(MI.negative(f)) in guide,
           f"{f['key']}: prompt and negative prompt in the guide match the .txt")
        ok(f"Height {f['height_mm']} mm" in guide, f"{f['key']}: height {f['height_mm']} mm in the guide")
        name, _, cnames, pal = MI.display(f["key"])
        ok(all(h.upper() in guide.upper() for h in pal), f"{f['key']}: paint swatches match the player aid palette")
    aids = pdf_text(DIST / "player_aids.pdf")
    for key, ch in T.CHARACTERS.items():
        ok(all(n in aids for n in ch["colors"]), f"{key}: player aid shows the same paint scheme names")


# ------------------------------------------------------------------ 6. numbers
def check_numbers(run_sim: bool):
    section("6. Designer's Notes numbers")
    import designers_notes as D
    res = D.load()
    ok(set(res) >= {D.BEFORE, D.AFTER}, "full sweeps present for the first draft and the final rules", ", ".join(res))
    a = res[D.AFTER]
    ok(a.games_per() >= 10_000, f"final sweep uses at least 10,000 games per configuration", f"{a.games_per():,}")
    ok(len(a.d["balance"]["per_config"]) == 50, "every 2-, 3- and 4-delver line-up swept (15 + 20 + 15)")
    notes = pdf_text(DIST / "designers_notes.pdf")
    for n in (2, 3, 4):
        L = a.length(n)
        ok(f"{L['minutes_p10']:.0f} / {L['minutes_p50']:.0f} / {L['minutes_p90']:.0f}" in notes,
           f"notes quote the final {n}-player playtime (p10/median/p90 at {D.SEC_PER_TURN} s a turn)")
    for ch in D.CHARS:
        cell = " / ".join(D.pp(a.delta(n, ch)) for n in (2, 3, 4))
        ok(cell in notes, f"notes quote {ch}'s final win-rate deltas", cell)
    total = RS.games_total()
    ok(f"{total:,}" in notes, "notes state the total number of simulated games", f"{total:,}")
    rb = pdf_text(DIST / "rulebook.pdf")
    import rulebook
    ok(plain(rulebook.games_line()) in rb, "rulebook credits quote the same total")
    comp = pdf_text(DIST / "components.pdf")
    import components
    ok(plain(components.token_note()) in comp, "components sheet quotes the final sweep's token needs")
    need = RS.token_need(R.FINAL)
    have = dict(T.TOKENS)
    ok(all(have[v] >= need[v]["p999"] for v in have), "token counts cover 99.9% of final-rules games",
       ", ".join(f"{v}: have {have[v]}, p99.9 {need[v]['p999']}, max {need[v]['max']}" for v in have))
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    ok(all(f"## {v}:" in changelog for v in res), "CHANGELOG.md has an entry for every swept version")
    if not run_sim:
        return
    # (a) determinism: re-run one configuration and get exactly the published numbers
    from glimmer import run as X
    combo = ("mira", "gritch")
    key = "2p:" + "+".join(combo)
    g = a.games_per()
    recs, _ = X.run_games(R.VERSIONS[D.AFTER], [combo] * g, [("tactician",) * 2] * g, seed0=11 + X._stable(combo))
    again = X.char_summary(recs)
    pub = a.d["balance"]["per_config"][key]["chars"]
    ok(all(abs(again[c]["win_rate"] - pub[c]["win_rate"]) < 1e-12 for c in combo),
       f"re-running {key} ({g:,} games) reproduces the published win rates exactly",
       ", ".join(f"{c} {again[c]['win_rate']:.4f}" for c in combo))
    # (b) an independent re-run with fresh seeds lands on the same playtime and balance
    import random
    rng = random.Random(20260924)
    for n in (2, 3, 4):
        k = 4000
        cs = [tuple(rng.sample(R.CHARACTERS, n)) for _ in range(k)]
        recs, _ = X.run_games(R.VERSIONS[D.AFTER], cs, [("tactician",) * n] * k, seed0=987_000 + n)
        L = X.length_summary(recs)
        pub = a.length(n)["minutes_p50"]
        ok(abs(L["minutes_p50"] - pub) <= 1.5, f"fresh-seed {n}-player re-run ({k:,} games): median playtime",
           f"{L['minutes_p50']:.1f} min vs {pub:.1f} published")
        cs_ = X.char_summary(recs)
        # 3 standard errors of the smaller (fresh) sample, per delver
        gaps = {c: (abs(cs_[c]["delta_pp"] - a.delta(n, c)), 300 * ((1 / n) * (1 - 1 / n) / cs_[c]["games"]) ** 0.5)
                for c in cs_}
        ok(all(g <= tol for g, tol in gaps.values()),
           f"fresh-seed {n}-player re-run: every delver's win rate within 3 standard errors",
           ", ".join(f"{c} {g:.1f}/{tol:.1f}" for c, (g, tol) in gaps.items()))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-sim", action="store_true")
    a = ap.parse_args(argv)
    check_tests()
    check_documents()
    check_geometry()
    check_board()
    check_prompts()
    check_numbers(not a.no_sim)
    summary = f"\n{len(LOG) - sum(1 for l in LOG if l.startswith(chr(10)))} checks, {len(FAILED)} failed"
    LOG.append(summary)
    print(summary)
    (ROOT / "results" / "verification.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
