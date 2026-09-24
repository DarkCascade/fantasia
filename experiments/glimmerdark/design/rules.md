# Glimmerdark

_Delve deep. Haul glimmer. Don't wake the Warden._

2–4 players · 30–45 minutes · Ages 12+

Rules version v4 (the ruleset the simulator balanced). Generated from `print/content.py`; the first draft is in `rules_v1_first_draft.md`.

Under the old mountain sleeps the Warden, a stone giant grown into the rock. Its dreams seep up through the tunnels as glimmer: stones of cold light, worth more the deeper you dig. You lead one delver into the Glimmerdark to haul glimmer to the surface before the mountain collapses. The deep chambers are rich, but the Warden walks down there, and it always turns toward whoever is winning.

**Goal.** Score the most glimmer. Glimmer you bring back to the Gate is safe in your vault; glimmer still in your pack when the mountain collapses counts for half.

## Components

- 1 standard deck of 52 playing cards plus 2 jokers (the only cards in the game)
- The Glimmerdark board (printed on 4 sheets, taped together)
- 6 delver figures and 1 Warden figure (3D-printed miniatures, or the cut-out standees)
- Glimmer tokens: 24 worth 1, 24 worth 2, 30 worth 4, and the Crown (worth 5)
- 1 collapse marker (any coin works) and 1 first-player marker
- 6 player aids (one per delver) and 1 card reference sheet per player

## Setup

1. Tape the four board sheets together. Put 3 glimmer in every chamber: 1-point tokens in the top row (depth 1), 2-point tokens in the middle row (depth 2) and 4-point tokens in the bottom row (depth 3). Put the Crown in the Heart.
2. Each player picks a delver, takes its player aid and figure, and stands the figure on the Gate. Stand the Warden in the Heart.
3. Put the collapse marker on the Start space of the Collapse track.
4. Shuffle all 54 cards. Deal 5 to each player. If anyone is dealt a joker, shuffle it back into the deck and deal them another card. The rest of the deck is the draw pile.
5. Pick a first player at random and give them the first-player marker. In a 3- or 4-player game, the first player takes only one action on their very first turn.

## The board

```
                 [ GATE ]
   [A1 ♠] — [B1 ♥] — [C1 ♦] — [D1 ♣]      depth 1
     |        |        |        |
   [A2 ♦] — [B2 ♣] — [C2 ♠] — [D2 ♥]      depth 2
     |        |        |        |
   [A3 ♥] — [B3 ♠] — [C3 ♣] — [D3 ♦]      depth 3
              \       /
              [ HEART ]
```

The Gate connects to all four depth-1 chambers; the Heart connects to B3 and C3. Glimmer is worth 1 / 2 / 4 at depth 1 / 2 / 3.

## What the cards mean

| Card | In short | What it does |
|---|---|---|
| **Suit** | The vein it mines | Each chamber shows a vein: ♠, ♥, ♦ or ♣. To Mine, play a card of that chamber's suit. |
| **2–6** | Low: Mine 1 | Mines 1 glimmer. Any card can Move 1 chamber instead. |
| **7–10** | High: Mine 2 | Mines 2 glimmer. Any card can Move 1 chamber instead. |
| **Ace** | Wild: Mine 1 | Matches every vein. Counts as rank 1, so it mines 1. |
| **Jack** | Shortcut: Move up to 3 | Event: move up to 3 chambers. Or play it as a normal card of rank 10. |
| **Queen** | Pilfer: steal 1 | Event: take the most valuable glimmer from a delver in your chamber or an adjacent chamber. Or play it as a normal card of rank 10. |
| **King** | Rouse: Warden moves 2 | Event: move the Warden up to 2 chambers, one at a time. If it enters a chamber with delvers, it crushes them and stops. Or play it as a normal card of rank 10. |
| **Joker** | Tremor (never held) | When revealed, by a player drawing or by the Warden's rumble: advance the collapse marker 1 space, then Glimmer Surge. Every empty chamber (not the Heart) gains 1 glimmer of its depth. Discard it; if you were drawing, draw another card. |

## Your turn

1. Take up to 2 actions. Each action is one card played face up onto the discard pile.
2. Refill your hand to 5 cards. If you need a card and the draw pile is empty, shuffle the discards into a new draw pile and advance the collapse marker 1 space.
3. After the last player's turn, the Warden takes its turn (the rumble).

**Actions**

- **Move** (any card): Move to an adjacent chamber along a tunnel. You can't enter or pass through the Warden's chamber.
- **Mine** (a card matching the vein): Take 1 glimmer (a low card or an Ace) or 2 (a high card, or a face card played as a 10) from your chamber, most valuable first. Aces match every vein, and in the Heart any card mines.
- **Event** (J, Q or K): Use the face card's event: Shortcut, Pilfer or Rouse.

You may take fewer than 2 actions. In a 3- or 4-player game the first player takes only one action on their very first turn.

**Your pack and the Gate.** Your pack holds 5 glimmer tokens. You can't mine or pilfer more than it holds. Whenever you enter the Gate, or pass through it, move everything in your pack into your vault. Vault glimmer is safe and stays face up in front of you.

## The Warden's turn

After the last player's turn, the Warden takes its turn. The first player does the rumble.

- **Rumble.** Flip the top card of the draw pile and discard it. A–10: the Warden moves 1 chamber. J, Q, K: it moves 2. Joker: Tremor instead (it doesn't move).
- **Target.** It walks toward the delver who is winning: the one with the most glimmer (vault plus pack) who isn't at the Gate. Ties go to the delver nearest the Warden, then the earliest in turn order from the first player. If every delver is at the Gate, it walks toward the Heart.
- **Route.** It takes the shortest route and never enters the Gate. If two steps are equally good, it takes the chamber that comes first in reading order (A1, B1, C1, D1, A2, …).
- **Crush.** When the Warden enters a chamber with delvers in it, it stops. Each of those delvers drops half the tokens in their pack (rounded up, their choice) into that chamber, then retreats 1 chamber toward the Gate (reading order breaks ties). If that's the Gate, they bank what they have left.

## Tremors and the collapse

**Joker: Tremor.** When revealed, by a player drawing or by the Warden's rumble: advance the collapse marker 1 space, then Glimmer Surge. Every empty chamber (not the Heart) gains 1 glimmer of its depth. Discard it; if you were drawing, draw another card.

**Reshuffle.** Whenever a card must be drawn, or flipped for the rumble, and the draw pile is empty, shuffle the discard pile into a new draw pile and advance the collapse marker 1 space.

## The end

- When the collapse marker reaches the end space for your player count (7 with 2 players, 8 with 3, 9 with 4), the mountain collapses. Finish the round, including the Warden's turn.
- Score your vault at full value, plus half the value of your pack (rounded down). The Crown is worth 5.
- Most points wins. Ties go to the tied player with more points in their vault. If that's tied too, you share the victory.

## The delvers

### Mira Emberheart, the Lampwright (♥ Hearts)

**Hearthlight.** Your ♥ cards match every vein. The first ♥ you play to Mine each turn is a free action: it doesn't count toward your two.

_Example._ Mira stands in C3 (a ♣ vein, 4-point glimmer) holding 9♥ 4♥ 6♠ 2♦ K♣. She plays 9♥ to Mine: hearts match any vein, a 9 is high, so she takes 2 × 4-point glimmer. It's her first heart this turn, so it's free. She still has two actions: 4♥ to Mine 1 more (not free, since only the first heart is), then 6♠ to Move away before the Warden arrives.

_Tip._ Hunt the deep chambers other delvers can't mine, and use your non-hearts to travel.

### Gritch Underbough, the Burrower (♠ Spades)

**Tunneler.** A ♠ played to Move takes you up to 3 chambers. It can end at the Gate, but can't pass through it. You travel light: your pack holds 4 glimmer.

_Example._ Gritch stands at the Gate holding 3♠ 8♦ 5♣ 10♥ J♦. He plays 3♠ and burrows Gate → B1 → B2 → B3 in a single action, straight into a ♠ chamber full of 4-point glimmer. Next turn a high ♠ would mine 2 there. With his small pack he'll be heading home sooner, but one spade gets him back up to the Gate.

_Tip._ Your spades are both your travel and your mining in ♠ veins. Plan round trips that end at the Gate.

### Hulda Stonefist, the Breaker (♣ Clubs)

**Shakedown.** You may play a ♣ as a Pilfer. A high ♣ (7–10, or a face card) takes 2 glimmer instead of 1.

_Example._ Hulda is in B2. Pip & Pell, in the next chamber B1, carry 4 + 2 + 1. Hulda plays 9♣: it's a high club, so she takes the two most valuable, the 4 and the 2. Then she plays 3♣ on Pip & Pell again and takes the 1.

_Tip._ Loaded delvers heading home have to walk past you. Stand beside the tunnels up to the Gate.

### Sable Voss, the Gemcutter (♦ Diamonds)

**Pulley.** As an action, play a ♦ to send up to 2 glimmer of your choice from your pack straight to your vault, from anywhere on the board.

_Example._ Sable is down in D3 with a full pack: 4 + 4 + 4 + 2 + 2. The Warden is one chamber away. She plays 5♦ and hoists two 4s to her vault, then plays 7♦ and hoists the third 4 and a 2. If the Warden crushes her now, all it can shake loose is one 2-point token.

_Tip._ Keep a diamond in hand when you go deep. It's insurance and a way to free up pack space.

### Pip & Pell, the Twin Sappers (Pairs and runs)

**In Step.** Twice per turn, the card right after one you paid for is free if it has the same rank, or the same suit and the next rank up or down (Aces sit above Kings).

_Example._ Pip & Pell stand in B1 holding 6♥ 6♣ 9♦ 10♦ 2♠. They play 6♥ to Move to A1 (paid), then 6♣ to Move on to A2, a ♦ vein: same rank, so it's free. There, 9♦ Mines two 2-point glimmer (paid) and 10♦ Mines the last one: same suit, next rank, so it's free. That's four cards played for two actions.

_Tip._ Build pairs and suited neighbors in your hand instead of spending them one at a time.

### Old Quill, the Cartographer (Face cards)

**Old Hands.** The first face card (J, Q or K) you play each turn is a free action. Your Jack's Shortcut moves up to 4 chambers.

_Example._ Quill stands at the Gate holding J♣ K♠ 4♥ 7♦ 2♣; the Warden has wandered up to A2. He plays J♣ as a Shortcut: B1, B2, B3, the Heart, four chambers in one move, and it's free as his first face card. Any card mines in the Heart, so 7♦ takes the Crown. He still has an action, and he keeps K♠ to Rouse the Warden away later.

_Tip._ Faces are your engine. Save one for the turn you need a third action.

## FAQ

**Do I have to take both actions?** No. You may take fewer, or none, and then refill.

**Can face cards be played as normal cards?** Yes. Any face card can instead be played as a normal card of rank 10: Move 1, or Mine 2 in its suit's vein.

**Can two delvers share a chamber?** Yes. Only the Warden's chamber is off limits.

**What if a chamber runs out of glimmer?** It stays empty until a Glimmer Surge refills it with 1 token.

**What if my pack is full?** You can't mine or pilfer. Head for the Gate, or hoist if you're Sable.

**Can the Warden crush someone on a King's Rouse?** Yes. A Rouse follows every Warden rule, including Crush.

**Does the first-turn limit apply with 2 players?** No, only with 3 or 4 players.

**Does the rumble flip count as a draw?** It comes from the draw pile, so if the pile is empty you reshuffle first and advance the collapse marker as usual.

**Can Gritch use a ♠ to move just 1 chamber?** Yes. Any card can always Move 1.
