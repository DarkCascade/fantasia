"""The final rules as plain Markdown (design/rules.md), from the same content
module the printed rulebook, card reference and player aids use.

    python rules_md.py   -> ../design/rules.md
"""

from __future__ import annotations

from pathlib import Path

import content as T

V = T.V
OUT = Path(__file__).resolve().parents[1] / "design" / "rules.md"


def build() -> str:
    t = T.suit_text
    L = [f"# {T.TITLE}", "", f"_{T.TAGLINE}_", "", f"{T.PLAYERS} · {T.TIME} · {T.AGES}", "",
         f"Rules version {V.version} (the ruleset the simulator balanced). Generated from `print/content.py`; "
         "the first draft is in `rules_v1_first_draft.md`.", "",
         T.STORY, "", f"**Goal.** {T.GOAL}", "", "## Components", ""]
    L += [f"- {c}" for c in T.COMPONENTS] + ["", "## Setup", ""]
    L += [f"{i}. {t(s)}" for i, s in enumerate(T.SETUP, 1)] + ["", "## The board", "",
          "```",
          "                 [ GATE ]",
          "   [A1 ♠] — [B1 ♥] — [C1 ♦] — [D1 ♣]      depth 1",
          "     |        |        |        |",
          "   [A2 ♦] — [B2 ♣] — [C2 ♠] — [D2 ♥]      depth 2",
          "     |        |        |        |",
          "   [A3 ♥] — [B3 ♠] — [C3 ♣] — [D3 ♦]      depth 3",
          "              \\       /",
          "              [ HEART ]",
          "```", "",
          "The Gate connects to all four depth-1 chambers; the Heart connects to B3 and C3. Glimmer is worth "
          f"{T.DEPTH_VALUES[0]} / {T.DEPTH_VALUES[1]} / {T.DEPTH_VALUES[2]} at depth 1 / 2 / 3.", "",
          "## What the cards mean", "", "| Card | In short | What it does |", "|---|---|---|"]
    L += [f"| **{t(a)}** | {t(b)} | {t(c)} |" for a, b, c in T.CARD_TABLE]
    L += ["", "## Your turn", ""] + [f"{i}. {t(s)}" for i, s in enumerate(T.TURN_SUMMARY, 1)]
    L += ["", "**Actions**", ""] + [f"- **{n}** ({w}): {t(x)}" for n, w, x in T.ACTIONS]
    L += ["", f"You may take fewer than {V.actions_per_turn} actions. In a 3- or 4-player game the first player "
          "takes only one action on their very first turn.", "", f"**Your pack and the Gate.** {T.PACK_RULE}", "",
          "## The Warden's turn", "", "After the last player's turn, the Warden takes its turn. The first player "
          "does the rumble.", ""]
    L += [f"- **{k}.** {t(v)}" for k, v in T.WARDEN_RULES]
    L += ["", "## Tremors and the collapse", "", f"**Joker: Tremor.** {t(T.CARD_TABLE[-1][2])}", "",
          "**Reshuffle.** Whenever a card must be drawn, or flipped for the rumble, and the draw pile is empty, "
          "shuffle the discard pile into a new draw pile and advance the collapse marker 1 space.", "",
          "## The end", ""] + [f"- {t(s)}" for s in T.END_RULES]
    L += ["", "## The delvers", ""]
    for ch in T.CHARACTERS.values():
        L += [f"### {ch['name']}, {ch['title']} ({t(ch['affinity'])})", "",
              f"**{ch['ability']}.** {t(ch['text'])}", "", f"_Example._ {t(ch['example'])}", "",
              f"_Tip._ {t(ch['tip'])}", ""]
    L += ["## FAQ", ""] + [f"**{t(q)}** {t(a)}\n" for q, a in T.FAQ]
    return "\n".join(L).rstrip() + "\n"


def main():
    OUT.write_text(build(), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
