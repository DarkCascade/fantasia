# Glimmerdark

**A 2–4 player board game for one standard deck of playing cards, with a
set of 3D-printable miniatures. About 30–45 minutes, ages 12+.**

Under the old mountain sleeps the Warden, a stone giant grown into the rock.
Each player leads one delver down through three depths of chambers to haul
glimmer back to the Gate before the mountain collapses. Deeper chambers are
richer, and the Warden walks toward whoever is winning. The only cards are an
ordinary 52-card deck plus two jokers. Suits are the veins you mine, ranks are
how much you dig, face cards are events, and a joker is a tremor. Nobody ever
marks a card.

Six delvers each bend one card rule: Mira (hearts), Gritch (spades), Hulda
(clubs), Sable (diamonds), Pip & Pell (pairs and runs) and Old Quill (face
cards). The Warden is the boss figure everyone plays against.

**Balance.** The final rules were checked over 3,000,000 simulated games,
10,000 for each line-up of characters:

| | 2 players | 3 players | 4 players |
|---|---|---|---|
| Median playtime (45 s a turn) | 33 min | 36 min | 35 min |
| Games inside 30–45 min | 81% | 87% | 100% |
| Furthest delver from a fair share | 4.1 pts | 1.8 pts | 2.3 pts |
| First player's win rate (fair share) | 49.9% (50%) | 33.3% (33.3%) | 24.7% (25%) |

No strategy dominates:

- The planning AI wins 61% of games against greedy play and 62% against
  cautious play.
- Greedy and cautious play are about even (52 / 48).

The first draft had one character 29 points below a fair share, and
2-player games ran 48 minutes. The [Designer's
Notes](dist/designers_notes.pdf) and [CHANGELOG.md](CHANGELOG.md) show how it
got from there to here.

## What's here

| Deliverable | File |
|---|---|
| Rulebook: components, setup diagram, turn summary, worked examples | [`dist/rulebook.pdf`](dist/rulebook.pdf) |
| Card effects reference (print one per player) | [`dist/card_reference.pdf`](dist/card_reference.pdf) |
| Board, 15 × 20 in, tiled on 4 sheets with crop marks and seam targets | [`dist/board_letter.pdf`](dist/board_letter.pdf), [`dist/board_a4.pdf`](dist/board_a4.pdf) |
| One-page player aid per delver, with a card-by-card example | [`dist/player_aids.pdf`](dist/player_aids.pdf) |
| Glimmer tokens, standees and markers, with cut marks | [`dist/components.pdf`](dist/components.pdf) |
| Designer's Notes: the balancing story with before/after charts | [`dist/designers_notes.pdf`](dist/designers_notes.pdf) |
| Miniatures Guide: Meshy prompts, printability, scale, paint schemes | [`dist/miniatures_guide.pdf`](dist/miniatures_guide.pdf) |
| The Meshy prompts, one per line, ready to paste | [`minis/meshy_prompts.txt`](minis/meshy_prompts.txt) |
| Balance changelog, v1 → final | [`CHANGELOG.md`](CHANGELOG.md) |
| Final rules as plain text / first draft | [`design/rules.md`](design/rules.md), [`design/rules_v1_first_draft.md`](design/rules_v1_first_draft.md) |
| Simulator source and tests | [`sim/`](sim/) |
| Verification report | [`results/verification.txt`](results/verification.txt) |

## Printing it

Print everything at **100% / actual size**. Every sheet fits both US Letter
and A4. The board has its own A4 file because its sheets are centred on the
paper. Trim the four board sheets on their crop marks, line up the
half-targets at each seam, and tape them on the back. Card stock helps for
tokens and standees. The miniatures are optional; the standees stand in for
them.

## How it was made

```
design/     first-draft rules (written before any simulation) and the final rules as Markdown
sim/        rules engine, AI players, experiments, tests (standard library only)
print/      PDF generators; content.py is the single source of every rules text
minis/      Meshy prompts (minis.py), a batch generator (meshy_batch.py)
results/    sweep output per rules version, and the verification report
dist/       the finished PDFs
```

- **One source of rules text.** `print/content.py` holds every rule, card
  meaning, ability and example. It reads its numbers from the simulator's
  final `RuleConfig` (`sim/glimmer/rules.py`, `FINAL`). The rulebook, card
  reference, player aids, board panels and `design/rules.md` are all
  generated from it.
- **Rules-exact simulator.** `sim/glimmer/engine.py` plays full games with
  a real deck, deal, draw, discard and reshuffle. Illegal plays raise an
  error. `sim/tests/` has 36 tests. `test_printed_rules.py` replays every
  worked example in the rulebook and player aids, card for card, on the
  engine.
- **Four AIs:** greedy, cautious, tactician (ability- and Warden-aware) and
  random (for the luck tests).
- **Sweeps.** `sim/run_sweeps.sh v1 v2 v3 v4` runs, per version:
  - every 2-, 3- and 4-delver line-up (50 line-ups) at 10,000 games each
  - 13 strategy matchups and 3 luck tests at 10,000 games each
  - a 30,000-game playtime run
  - each ability against a no-ability control

  Output goes to `results/<version>/`. Seeds are fixed, so re-runs give the
  same numbers.
- **Playtime model:** 45 s per player turn (30–60 s range) plus 10 s per
  Warden phase, applied to the simulated turn counts. Setup and teaching are
  not included.

## Rebuilding

```bash
pip install -r requirements.txt
cd sim && python -m pytest -q && ./run_sweeps.sh v1 v2 v3 v4   # ~1 hour per version on 4 cores
cd .. && ./build.sh                                                  # every PDF, rules.md, CHANGELOG.md, then verify.py
```

`verify.py` is the Part 5 check. It:

- runs the tests
- confirms every rules text appears word for word in each PDF that prints it
- scans for stale text and missing glyphs
- checks page sizes, margins and font embedding
- re-assembles the board sheets and compares them pixel for pixel with the
  full board
- checks the prompts against the printability rules
- re-runs part of the simulation to confirm the Designer's Notes numbers,
  once exactly and once with fresh seeds

## Miniatures

`minis/meshy_prompts.txt` has seven prompts: six delvers and the Warden. All
share one style prefix and state the printability rules:

- a single standing figure on an integrated round base
- a compact pose with limbs close to the body
- no thin or floating parts, and thick props
- no background and no text

Each is under Meshy's 600-character limit. To generate them all:

```bash
export MESHY_API_KEY=...          # never commit it
python minis/meshy_batch.py --stl # GLBs, plus STLs scaled to each figure's height
```

Meshy's meshes are very dense. `--stl` decimates them to about 300k faces
and reports whether each mesh is watertight. The Miniatures Guide covers
supports, scale and paint.

## Licences

Fonts are Cinzel, Alegreya and Alegreya Sans (SIL Open Font License) and
DejaVu Sans. Their licence files are in `print/fonts/`.
