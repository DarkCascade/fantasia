"""Single source of truth for every printed word about the rules.

The rulebook, card reference sheet, player aids, rules.md and the consistency
checker all read from here, and every number is taken from the simulator's
RuleConfig for the final ruleset. So a card can't mean one thing in the
rulebook and another on the reference sheet, and neither can drift from the
rules that were actually balanced.

Inline suit markup: {S} {H} {D} {C} render as the suit glyphs in the PDFs.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sim"))

from glimmer import rules as R  # noqa: E402

CFG = R.VERSIONS[R.FINAL]
V = CFG  # short alias for f-strings

TITLE = "Glimmerdark"
TAGLINE = "Delve deep. Haul glimmer. Don't wake the Warden."
PLAYERS = "2–4 players"
TIME = "30–45 minutes"
AGES = "Ages 12+"

STORY = (
    "Under the old mountain sleeps the Warden, a stone giant grown into the rock. Its dreams seep up "
    "through the tunnels as glimmer: stones of cold light, worth more the deeper you dig. You lead one "
    "delver into the Glimmerdark to haul glimmer to the surface before the mountain collapses. The deep "
    "chambers are rich, but the Warden walks down there, and it always turns toward whoever is winning."
)
GOAL = ("Score the most glimmer. Glimmer you bring back to the Gate is safe in your vault; glimmer still in "
        "your pack when the mountain collapses counts for half.")

DEPTH_VALUES = V.depth_values
LOW_RANKS = f"2–{V.high_rank_min - 1}"   # "2–6"
HIGH_RANKS = f"{V.high_rank_min}–10"     # "7–10"
GRITCH_PACK = V.pack_limit - 1 if V.gritch_pack4 else V.pack_limit
QUILL_JACK = V.jack_steps + 1 if "jack4" in V.quill_mode else V.jack_steps
TOKENS = [(1, 24), (2, 24), (4, 30)]  # at least the most any final-rules sweep game needed (verify.py checks)
COLLAPSE_END = V.collapse_at

COMPONENTS = [
    "1 standard deck of 52 playing cards plus 2 jokers (the only cards in the game)",
    "The Glimmerdark board (printed on 4 sheets, taped together)",
    "6 delver figures and 1 Warden figure (3D-printed miniatures, or the cut-out standees)",
    f"Glimmer tokens: {TOKENS[0][1]} worth 1, {TOKENS[1][1]} worth 2, {TOKENS[2][1]} worth 4, and the Crown (worth {V.crown_value})",
    "1 collapse marker (any coin works) and 1 first-player marker",
    "6 player aids (one per delver) and 1 card reference sheet per player",
]

SETUP = [
    f"Tape the four board sheets together. Put {V.tokens_per_chamber} glimmer in every chamber: "
    f"{DEPTH_VALUES[0]}-point tokens in the top row (depth 1), {DEPTH_VALUES[1]}-point tokens in the middle row "
    f"(depth 2) and {DEPTH_VALUES[2]}-point tokens in the bottom row (depth 3). Put the Crown in the Heart.",
    "Each player picks a delver, takes its player aid and figure, and stands the figure on the Gate. "
    "Stand the Warden in the Heart.",
    "Put the collapse marker on the Start space of the Collapse track.",
    f"Shuffle all 54 cards. Deal {V.hand_size} to each player. If anyone is dealt a joker, shuffle it back "
    "into the deck and deal them another card. The rest of the deck is the draw pile.",
    "Pick a first player at random and give them the first-player marker. In a 3- or 4-player game, the "
    "first player takes only one action on their very first turn.",
]

# ------------------------------------------------------------------ card meanings
# (label, short meaning, long meaning). Used by the reference sheet and the rulebook table.
CARD_TABLE = [
    ("Suit", "The vein it mines",
     "Each chamber shows a vein: {S}, {H}, {D} or {C}. To Mine, play a card of that chamber's suit."),
    (LOW_RANKS, f"Low: Mine {V.low_yield}",
     f"Mines {V.low_yield} glimmer. Any card can Move 1 chamber instead."),
    (HIGH_RANKS, f"High: Mine {V.high_yield}",
     f"Mines {V.high_yield} glimmer. Any card can Move 1 chamber instead."),
    ("Ace", f"Wild: Mine {V.low_yield}",
     f"Matches every vein. Counts as rank 1, so it mines {V.low_yield}."),
    ("Jack", f"Shortcut: Move up to {V.jack_steps}",
     f"Event: move up to {V.jack_steps} chambers. Or play it as a normal card of rank 10."),
    ("Queen", "Pilfer: steal 1",
     "Event: take the most valuable glimmer from a delver in your chamber or an adjacent chamber. "
     "Or play it as a normal card of rank 10."),
    ("King", f"Rouse: Warden moves {V.king_rouse_steps}",
     f"Event: move the Warden up to {V.king_rouse_steps} chambers, one at a time. If it enters a chamber "
     "with delvers, it crushes them and stops. Or play it as a normal card of rank 10."),
    ("Joker", "Tremor (never held)",
     "When revealed, by a player drawing or by the Warden's rumble: advance the collapse marker 1 space, "
     "then Glimmer Surge. Every empty chamber (not the Heart) gains 1 glimmer of its depth. Discard it; "
     "if you were drawing, draw another card."),
]

ACTIONS = [
    ("Move", "any card", "Move to an adjacent chamber along a tunnel. You can't enter or pass through the Warden's chamber."),
    ("Mine", "a card matching the vein",
     f"Take {V.low_yield} glimmer (a low card or an Ace) or {V.high_yield} (a high card, or a face card played as a 10) "
     "from your chamber, most valuable first. Aces match every vein, and in the Heart any card mines."),
    ("Event", "J, Q or K", "Use the face card's event: Shortcut, Pilfer or Rouse."),
]

TURN_SUMMARY = [
    f"Take up to {V.actions_per_turn} actions. Each action is one card played face up onto the discard pile.",
    f"Refill your hand to {V.hand_size} cards. If you need a card and the draw pile is empty, shuffle the "
    "discards into a new draw pile and advance the collapse marker 1 space.",
    "After the last player's turn, the Warden takes its turn (the rumble).",
]

PACK_RULE = (f"Your pack holds {V.pack_limit} glimmer tokens. You can't mine or pilfer more than it holds. "
             "Whenever you enter the Gate, or pass through it, move everything in your pack into your vault. "
             "Vault glimmer is safe and stays face up in front of you.")

WARDEN_RULES = [
    ("Rumble", f"Flip the top card of the draw pile and discard it. A–10: the Warden moves {V.warden_steps_number} chamber. "
               f"J, Q, K: it moves {V.warden_steps_face}. Joker: Tremor instead (it doesn't move)."),
    ("Target", "It walks toward the delver who is winning: the one with the most glimmer (vault plus pack) who "
               "isn't at the Gate. Ties go to the delver nearest the Warden, then the earliest in turn order from "
               "the first player. If every delver is at the Gate, it walks toward the Heart."),
    ("Route", "It takes the shortest route and never enters the Gate. If two steps are equally good, it takes "
              "the chamber that comes first in reading order (A1, B1, C1, D1, A2, …)."),
    ("Crush", "When the Warden enters a chamber with delvers in it, it stops. Each of those delvers drops half the "
              "tokens in their pack (rounded up, their choice) into that chamber, then retreats 1 chamber toward "
              "the Gate (reading order breaks ties). If that's the Gate, they bank what they have left."),
]

END_RULES = [
    f"When the collapse marker reaches the end space for your player count ({COLLAPSE_END[2]} with 2 players, "
    f"{COLLAPSE_END[3]} with 3, {COLLAPSE_END[4]} with 4), the mountain collapses. Finish the round, including "
    "the Warden's turn.",
    f"Score your vault at full value, plus half the value of your pack (rounded down). The Crown is worth {V.crown_value}.",
    "Most points wins. Ties go to the tied player with more points in their vault. If that's tied too, you share the victory.",
]

# ------------------------------------------------------------------ delvers
CHARACTERS = {
    "mira": dict(
        hand=["9H", "4H", "6S", "2D", "KC"], played=["9H", "4H", "6S"],
        name="Mira Emberheart", title="the Lampwright", affinity="{H} Hearts", suit="H",
        colors=["ember orange", "soot black", "brass", "warm cream"],
        palette=["#D9612B", "#2B2320", "#B8893A", "#F2E3C6"],
        ability="Hearthlight",
        text="Your {H} cards match every vein. The first {H} you play to Mine each turn is a free action: "
             "it doesn't count toward your two.",
        example=("Mira stands in C3 (a {C} vein, 4-point glimmer) holding 9{H} 4{H} 6{S} 2{D} K{C}. "
                 "She plays 9{H} to Mine: hearts match any vein, a 9 is high, so she takes 2 × 4-point glimmer. "
                 "It's her first heart this turn, so it's free. She still has two actions: 4{H} to Mine 1 more "
                 "(not free, since only the first heart is), then 6{S} to Move away before the Warden arrives."),
        tip="Hunt the deep chambers other delvers can't mine, and use your non-hearts to travel.",
        mini="Lantern held close to the chest, heart-shaped window in the lantern, short coat, sturdy boots.",
    ),
    "gritch": dict(
        hand=["3S", "8D", "5C", "10H", "JD"], played=["3S"],
        name="Gritch Underbough", title="the Burrower", affinity="{S} Spades", suit="S",
        colors=["mole brown", "iron grey", "moss green", "bone"],
        palette=["#6B4A2F", "#5C6166", "#56713A", "#E6DCC4"],
        ability="Tunneler",
        text=f"A {{S}} played to Move takes you up to {V.gritch_spade_steps} chambers. It can end at the Gate, but "
             f"can't pass through it. You travel light: your pack holds {GRITCH_PACK} glimmer.",
        example=("Gritch stands at the Gate holding 3{S} 8{D} 5{C} 10{H} J{D}. "
                 "He plays 3{S} and burrows Gate → B1 → B2 → B3 in a single action, straight into a {S} chamber "
                 "full of 4-point glimmer. Next turn a high {S} would mine 2 there. With his small pack he'll "
                 "be heading home sooner, but one spade gets him back up to the Gate."),
        tip="Your spades are both your travel and your mining in {S} veins. Plan round trips that end at the Gate.",
        mini="Hunched digger with an oversized short spade held diagonally across the body; spade shape on the shovel blade.",
    ),
    "hulda": dict(
        hand=["9C", "3C", "7H", "2D", "QS"], played=["9C", "3C"],
        name="Hulda Stonefist", title="the Breaker", affinity="{C} Clubs", suit="C",
        colors=["rust red", "iron", "moss green", "leather brown"],
        palette=["#9E3B26", "#6E7378", "#3F6B3A", "#7A5634"],
        ability="Shakedown",
        text=f"You may play a {{C}} as a Pilfer. A high {{C}} ({HIGH_RANKS}, or a face card) takes "
             "2 glimmer instead of 1.",
        example=("Hulda is in B2. Pip & Pell, in the next chamber B1, carry 4 + 2 + 1. Hulda plays 9{C}: it's a "
                 "high club, so she takes the two most valuable, the 4 and the 2. Then she plays 3{C} on "
                 "Pip & Pell again and takes the 1."),
        tip="Loaded delvers heading home have to walk past you. Stand beside the tunnels up to the Gate.",
        mini="Broad-shouldered brawler with huge stone gauntlets clasped in front; club (trefoil) emblem on the belt buckle.",
    ),
    "sable": dict(
        hand=["5D", "7D", "8S", "4C", "AH"], played=["5D", "7D"],
        name="Sable Voss", title="the Gemcutter", affinity="{D} Diamonds", suit="D",
        colors=["deep violet", "gold", "slate blue", "pale lilac"],
        palette=["#4B2E6B", "#C9A23A", "#3E5A7A", "#D9CCE8"],
        ability="Pulley",
        text=f"As an action, play a {{D}} to send up to {V.sable_hoist} glimmer of your choice from your pack straight to your "
             "vault, from anywhere on the board.",
        example=("Sable is down in D3 with a full pack: 4 + 4 + 4 + 2 + 2. The Warden is one chamber away. "
                 "She plays 5{D} and hoists two 4s to her vault, then plays 7{D} and hoists the third 4 and a 2. "
                 "If the Warden crushes her now, all it can shake loose is one 2-point token."),
        tip="Keep a diamond in hand when you go deep. It's insurance and a way to free up pack space.",
        mini="Slim figure in a long fitted coat with a jeweller's loupe, clutching a pulley block; diamond-shaped clasp.",
    ),
    "twins": dict(
        hand=["6H", "6C", "9D", "10D", "2S"], played=["6H", "6C", "9D", "10D"],
        name="Pip & Pell", title="the Twin Sappers", affinity="Pairs and runs", suit=None,
        colors=["teal", "copper", "canvas tan", "charcoal"],
        palette=["#2E7C7A", "#B8683A", "#CDB68A", "#33373B"],
        ability="In Step",
        text=f"Twice per turn, the card right after one you paid for is free if it has the same rank, or the "
             "same suit and the next rank up or down (Aces sit above Kings).",
        example=("Pip & Pell stand in B1 holding 6{H} 6{C} 9{D} 10{D} 2{S}. They play 6{H} to Move to A1 (paid), then "
                 "6{C} to Move on to A2, a {D} vein: same rank, so it's free. There, 9{D} Mines two 2-point "
                 "glimmer (paid) and 10{D} Mines the last one: same suit, next rank, so it's free. That's four cards "
                 "played for two actions."),
        tip="Build pairs and suited neighbors in your hand instead of spending them one at a time.",
        mini="Two short sappers standing back to back on one base, sharing one rope coil; matching helmets.",
    ),
    "quill": dict(
        hand=["JC", "KS", "4H", "7D", "2C"], played=["JC", "7D"],
        name="Old Quill", title="the Cartographer", affinity="Face cards", suit=None,
        colors=["parchment", "deep plum", "ink black", "silver"],
        palette=["#E8D9B0", "#5B2C4F", "#1F1F24", "#A9ADB3"],
        ability="Old Hands",
        text=f"The first face card (J, Q or K) you play each turn is a free action. Your Jack's Shortcut moves "
             f"up to {QUILL_JACK} chambers.",
        example=("Quill stands at the Gate holding J{C} K{S} 4{H} 7{D} 2{C}; the Warden has wandered up to A2. "
                 "He plays J{C} as a Shortcut: B1, B2, B3, the Heart, four chambers in one move, and it's free as "
                 "his first face card. Any card mines in the Heart, so 7{D} takes the Crown. He still has an "
                 "action, and he keeps K{S} to Rouse the Warden away later."),
        tip="Faces are your engine. Save one for the turn you need a third action.",
        mini="Elderly map-maker with a rolled map tucked under one arm and a quill tucked behind the ear; stout walking staff held vertically against the body.",
    ),
}

WARDEN = dict(
    name="The Warden", title="the sleeping stone giant",
    colors=["granite grey", "lichen green", "glowing cyan cracks", "dark slate base"],
    palette=["#7D8084", "#6E7F4E", "#3FD4E0", "#2E3238"],
    mini="Hulking stone giant, crouched and compact, arms folded over its knees, glowing cracks, mossy shoulders.",
)

FAQ = [
    ("Do I have to take both actions?", "No. You may take fewer, or none, and then refill."),
    ("Can face cards be played as normal cards?",
     "Yes. Any face card can instead be played as a normal card of rank 10: Move 1, or Mine 2 in its suit's vein."),
    ("Can two delvers share a chamber?", "Yes. Only the Warden's chamber is off limits."),
    ("What if a chamber runs out of glimmer?", "It stays empty until a Glimmer Surge refills it with 1 token."),
    ("What if my pack is full?", "You can't mine or pilfer. Head for the Gate, or hoist if you're Sable."),
    ("Can the Warden crush someone on a King's Rouse?", "Yes. A Rouse follows every Warden rule, including Crush."),
    ("Does the first-turn limit apply with 2 players?", "No, only with 3 or 4 players."),
    ("Does the rumble flip count as a draw?",
     "It comes from the draw pile, so if the pile is empty you reshuffle first and advance the collapse marker "
     "as usual."),
    ("Can Gritch use a {S} to move just 1 chamber?", "Yes. Any card can always Move 1."),
]


def suit_text(s: str) -> str:
    """Plain-text rendering for rules.md."""
    for k, g in (("{S}", "♠"), ("{H}", "♥"), ("{D}", "♦"), ("{C}", "♣")):
        s = s.replace(k, g)
    return s
