# GLIMMERDARK — first-draft rules (v1)

*Kept as written before any simulation. The live rules are in `rules.md`;
every change between the two is justified in `CHANGELOG.md`.*

**2–4 players · 30–45 minutes · ages 12+ · one standard deck (52 + 2 jokers)**

Under the old mountain sleeps the **Warden**, a stone giant grown into the
rock. Its dreams seep up through the tunnels as *glimmer*: stones of cold
light. Each player leads one delver into the Glimmerdark to haul glimmer to
the surface before the mountain collapses. Deep chambers hold richer
glimmer, but the Warden walks down there, and it's drawn to whoever carries
the most.

## Components

- 1 standard 52-card deck plus 2 jokers (the only cards)
- The board: the Gate, 12 chambers in 3 depths, and the Heart
- 1 figure per character (6 characters) and 1 Warden figure
- Glimmer tokens: 12 worth 1, 12 worth 2, 12 worth 3, plus the Crown (worth 5)
- 1 collapse marker (a coin) and the Collapse track (3 spaces)
- One card reference sheet and one character aid per player

## The board

```
                      [ GATE ]
  [A1 ♠] — [B1 ♥] — [C1 ♦] — [D1 ♣]      depth 1: glimmer worth 1
     |        |        |        |
  [A2 ♦] — [B2 ♣] — [C2 ♠] — [D2 ♥]      depth 2: glimmer worth 2
     |        |        |        |
  [A3 ♥] — [B3 ♠] — [C3 ♣] — [D3 ♦]      depth 3: glimmer worth 3
              \        /
              [ HEART ]                 the Warden's lair: the Crown (5)
```

The Gate connects to all four depth-1 chambers. The Heart connects to B3
and C3. Each chamber shows a **vein**, one of the four suits.

## Setup

1. Put 3 glimmer tokens in every chamber: 1-point tokens at depth 1,
   2-point at depth 2, 3-point at depth 3. The Crown goes in the Heart.
2. Delvers start at the Gate. The Warden starts in the Heart.
3. Shuffle all 54 cards, deal 5 to each player, and put the rest face down
   as the draw pile. The collapse marker goes beside the Collapse track.
4. Choose a first player at random.

## What the cards mean

| Card | Meaning |
|---|---|
| **Suit** | The vein it can mine. A ♠ mines ♠ chambers, and so on. |
| **2–6** | Low: mines 1 glimmer |
| **7–10** | High: mines 2 glimmer |
| **Ace** | Wild: matches every vein, mines 1 |
| **Jack** | Event *Shortcut*: move up to 3 chambers. Or play it as a 10. |
| **Queen** | Event *Pilfer*: take 1 glimmer from a delver in your chamber or next to it. Or play it as a 10. |
| **King** | Event *Rouse*: move the Warden up to 2 chambers. Or play it as a 10. |
| **Joker** | Never held. When drawn, reveal it: *Glimmer Surge*. Every empty chamber gains 1 glimmer of its depth. Then draw a replacement. |

## Your turn

Take **up to two actions**. Each action is one card played from your hand
to the discard pile:

- **Move**: any card. Move to an adjacent chamber.
- **Mine**: a card whose suit matches your chamber's vein. Take 1 glimmer
  (2 with a 7–10 or a face card played as a 10) from the chamber into your pack.
- **Event**: a face card's event instead of its normal use.

**Your pack holds 5 glimmer tokens.** You can't take more.

**Banking.** When you enter the Gate, move everything in your pack to your
vault. Banked glimmer is safe.

**Refill.** At the end of your turn, draw back up to 5 cards. If the draw
pile is empty, shuffle the discard pile into a new draw pile and move the
collapse marker one space along the Collapse track.

## The Warden's turn

After the last player's turn, the first player flips the top card of the
draw pile (the **rumble**) and discards it:

- **A–10**: the Warden moves 1 chamber toward the delver carrying the most
  glimmer (ties: the nearest delver, then the earliest in turn order).
  If nobody carries glimmer, it moves 1 chamber toward the Heart.
- **J, Q, K**: as above, but it moves 2 chambers.
- **Joker**: Glimmer Surge (see above), and the Warden does not move.

The Warden never enters the Gate. A delver may not move into the Warden's
chamber.

**Crushed.** When the Warden enters a chamber with delvers in it, each of
them drops half their pack (rounded up) into that chamber, then retreats
1 chamber toward the Gate.

## End of the game

When the collapse marker reaches the **third** space, the mountain
collapses. Finish the round (including the Warden's turn), then score:

- banked glimmer at full value
- glimmer still in your pack at **half** value (rounded down)
- the Crown is worth 5, carried or banked like other glimmer

Most points wins. Ties go to the player with more banked points.

## The delvers

| Delver | Ability |
|---|---|
| **Mira Emberheart**, Lampwright | Your ♥ cards match every vein. |
| **Gritch Underbough**, Burrower | A ♠ played to Move takes you up to 3 chambers. |
| **Hulda Stonefist**, Breaker | A ♣ can be played as *Pilfer* (like a Queen). |
| **Sable Voss**, Gemcutter | Action: play a ♦ to hoist up to 2 glimmer from your pack straight to your vault, from anywhere. |
| **Pip & Pell**, Twin Sappers | Once per turn, play a pair (two cards of the same rank) as one action; both cards take effect. |
| **Old Quill**, Cartographer | Once per turn, play a face card as a free action that doesn't count toward your two. |
