"""Meshy text-to-3D prompts for the Glimmerdark miniatures.

Single source for the prompts .txt, the JSON used by meshy_batch.py and the
Miniatures Guide PDF. Paint schemes come from print/content.py, the same data
the player aids use, so a painted mini always matches its player aid.

    python minis.py        -> writes meshy_prompts.txt and minis.json, checks every prompt
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "print"))
import content as T  # noqa: E402

MESHY_PROMPT_MAX = 600  # Meshy text-to-3D prompt limit (characters)

# The shared style prefix: every prompt starts with exactly this, so the set looks like one sculptor made it.
STYLE_PREFIX = (
    "Stylized chunky tabletop miniature for 3D printing, 32mm heroic scale, bold readable silhouette, "
    "crisp deep sculpted detail, compact pose with arms and props held "
    "tight to the body, thick sturdy props, one solid standing model on an integrated round base of cracked "
    "cave stone, no background, no scenery, no text, no thin or floating parts. "
)

NEGATIVE_BASE = (
    "thin parts, thin weapon, spear, sword, long pole, wide cape, flowing cloak, loose hair strands, whiskers, "
    "wings, chains, dangling rope, floating objects, separate pieces, disconnected parts, arms stretched out, "
    "dynamic action pose, background, scenery, landscape, text, letters, logo, watermark, transparent, glass, "
    "square base, low poly"
)

FIGURES = [
    dict(key="mira", height_mm=32, base_mm=25,
         body="Mira the lamp-keeper, a young woman in a short padded work coat and sturdy boots, both hands hugging a "
              "big rounded brass lantern to her chest, a heart-shaped window on the lantern front, short hair tied "
              "back tight, a determined smile.",
         tie="Her lantern's heart-shaped window is Hearthlight: her {H} cards light every vein.",
         paint="Coat ember orange; boots, gloves and hair soot black; lantern brass; face and shirt warm cream. "
               "Paint the heart window a hot amber glow so she reads as the hearts delver."),
    dict(key="gritch", height_mm=27, base_mm=25,
         body="Gritch the burrower, a hunched stocky gnome-like digger with big hands, gripping an oversized short "
              "spade diagonally across his body with the blade by his chest, a spade-suit-shaped blade, thick handle, "
              "round goggles pushed up on his forehead.",
         tie="The oversized spade is Tunneler: his {S} cards carry him up to 3 chambers at once.",
         paint="Jacket mole brown; spade and goggles iron grey; patches and backpack moss green; bone for teeth, "
               "buckles and the spade's edge highlight."),
    dict(key="hulda", height_mm=35, base_mm=25,
         body="Hulda the breaker, a broad-shouldered muscular woman with thick braids pinned tight to her head, huge "
              "blocky stone gauntlets clasped together in front of her belly, a three-leaf club emblem on her wide "
              "belt buckle, heavy boots, planted confident stance.",
         tie="Stone fists for Shakedown: her {C} cards knock glimmer out of rival packs.",
         paint="Tunic rust red; gauntlets and buckle iron; the club emblem and trim moss green; belt and boots "
               "leather brown."),
    dict(key="sable", height_mm=34, base_mm=25,
         body="Sable the gemcutter, a slim poised woman in a long fitted coat ending above the knees, holding a "
              "chunky pulley block against her chest with both hands, a jeweller's loupe over one eye, a "
              "diamond-shaped clasp at her collar, hair in a tight bun.",
         tie="The pulley block is Pulley: a {D} hoists glimmer straight to her vault.",
         paint="Coat deep violet; clasp, loupe rim and pulley fittings gold; gloves and trousers slate blue; "
               "pale lilac highlights on the coat edges."),
    dict(key="twins", height_mm=25, base_mm=32,
         body="Pip and Pell the twin sappers, two short identical sappers standing back to back and pressed together "
              "as one solid sculpt, matching round helmets with small headlamps, one coil of thick rope worn across "
              "both their chests, arms folded, cheeky grins.",
         tie="Back to back, in step: a pair or a suited run costs them one action.",
         paint="One twin's overalls teal, the other copper; helmets the opposite colour for each; rope canvas tan; "
               "boots and belts charcoal."),
    dict(key="quill", height_mm=30, base_mm=25,
         body="Old Quill the cartographer, an elderly stooped map-maker with a big nose and a short thick beard, a "
              "fat rolled map clamped under one arm, a short walking stick as thick as his wrist resting against "
              "his body, a satchel with a crown-shaped buckle.",
         tie="The crown buckle marks the court cards: his first face card each turn is free, and his Jacks travel 4.",
         paint="Coat parchment; hat and satchel deep plum; boots, ink stains and beard shading ink black; buckle, "
               "map ties and hair silver."),
    dict(key="warden", height_mm=60, base_mm=50,
         body="The Warden, a hulking crouched stone giant boss monster, compact boulder-like body, huge arms folded "
              "over its knees, head sunk low between massive shoulders, deep carved crack lines across its rocky "
              "skin, thick moss on the shoulders, small deep-set eyes.",
         tie="The boss: after every round it walks toward whoever is winning and crushes delvers it catches.",
         paint="Body granite grey with a dark slate wash; moss lichen green; paint the carved cracks and eyes a "
               "glowing cyan (thin white centre line, cyan glaze around); base dark slate."),
]

NEGATIVE_EXTRA = {
    "twins": ", more than two characters, two separate bases",
    "warden": ", standing upright, tall thin legs, weapon",
}
NEGATIVE_EXTRA_DEFAULT = ", multiple characters, crowd"

# Printability checks applied to every prompt (the prefix carries the rules; these confirm it survived).
REQUIRED_PHRASES = ["integrated round base", "no background", "no scenery", "no text", "no thin or floating parts",
                    "compact pose", "held tight to the body", "thick sturdy props"]
BANNED = re.compile(r"\b(cape|cloak|spear|sword|wings?|antenna|whisker|chain|flowing|strands?|floating|dangling|"
                    r"outstretched|leaping|flying)\b", re.I)


def prompt(fig: dict) -> str:
    return STYLE_PREFIX + fig["body"]


def negative(fig: dict) -> str:
    return NEGATIVE_BASE + NEGATIVE_EXTRA.get(fig["key"], NEGATIVE_EXTRA_DEFAULT)


def check(fig: dict) -> list[str]:
    problems = []
    p = prompt(fig)
    if len(p) > MESHY_PROMPT_MAX:
        problems.append(f"prompt is {len(p)} chars (> {MESHY_PROMPT_MAX})")
    if not p.startswith(STYLE_PREFIX):
        problems.append("missing the shared style prefix")
    for ph in REQUIRED_PHRASES:
        if ph not in p:
            problems.append(f"missing printability phrase: {ph!r}")
    body = fig["body"]
    m = BANNED.search(body)
    if m:
        problems.append(f"character text mentions a fragile feature: {m.group(0)!r}")
    if len(negative(fig)) > MESHY_PROMPT_MAX:
        problems.append("negative prompt too long")
    return problems


def display(key):
    if key == "warden":
        return T.WARDEN["name"], T.WARDEN["title"], T.WARDEN["colors"], T.WARDEN["palette"]
    ch = T.CHARACTERS[key]
    return ch["name"], ch["title"], ch["colors"], ch["palette"]


def main():
    bad = {f["key"]: check(f) for f in FIGURES if check(f)}
    if bad:
        raise SystemExit(f"prompt check failed: {bad}")
    lines = [prompt(f) for f in FIGURES]
    (HERE / "meshy_prompts.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    data = []
    for f in FIGURES:
        name, title, cnames, pal = display(f["key"])
        data.append({"key": f["key"], "name": name, "title": title, "prompt": prompt(f), "negative_prompt": negative(f),
                     "height_mm": f["height_mm"], "base_mm": f["base_mm"], "ability_tie": T.suit_text(f["tie"]),
                     "paint": f["paint"], "paint_swatches": dict(zip(cnames, pal)), "prompt_chars": len(prompt(f))})
    (HERE / "minis.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    for d in data:
        print(f"{d['key']:7} {d['prompt_chars']:3} chars  {d['height_mm']} mm on {d['base_mm']} mm base")
    print("all prompts pass the printability checks")


if __name__ == "__main__":
    main()
