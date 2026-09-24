"""Every tunable number in GLIMMERDARK, in one place.

`RuleConfig()` with no arguments is the CURRENT ruleset (the one the printed
materials describe). Historical rulesets used during balancing are kept in
`VERSIONS` so the changelog's before/after numbers can be re-derived at any
time with `python -m glimmer.run --version v1` etc.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

# Card / suit vocabulary shared by the engine, AI and the print scripts.
SPADES, HEARTS, DIAMONDS, CLUBS = 0, 1, 2, 3
SUIT_NAMES = ["Spades", "Hearts", "Diamonds", "Clubs"]
SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"]
JACK, QUEEN, KING, ACE = 11, 12, 13, 14

CHARACTERS = ["mira", "gritch", "hulda", "sable", "twins", "quill"]
CHARACTER_NAMES = {
    "mira": "Mira Emberheart",
    "gritch": "Gritch Underbough",
    "hulda": "Hulda Stonefist",
    "sable": "Sable Voss",
    "twins": "Pip & Pell",
    "quill": "Old Quill",
}


@dataclass(frozen=True)
class RuleConfig:
    version: str = "v1"
    # hands & turns
    hand_size: int = 5
    actions_per_turn: int = 2
    pack_limit: int = 5
    jokers: int = 2
    # board supply
    tokens_per_chamber: int = 3
    depth_values: tuple = (1, 2, 3)
    crown_value: int = 5
    # mining
    high_rank_min: int = 7          # rank >= this mines `high_yield`
    low_yield: int = 1
    high_yield: int = 2
    ace_wild: bool = True
    face_as_rank: int = 10          # a face card played "normally" counts as this rank
    # movement
    move_steps: int = 1
    jack_steps: int = 3
    # the Warden
    warden_steps_number: int = 1
    warden_steps_face: int = 2
    warden_stops_after_crush: bool = True
    crush_keep_choice: bool = True   # crushed delver chooses which tokens to drop (drops cheapest)
    king_rouse_steps: int = 2
    # end of game: collapse after this many reshuffles, by player count
    collapse_at: dict = field(default_factory=lambda: {2: 3, 3: 3, 4: 3})
    carried_end_factor: float = 0.5  # glimmer still in a pack at the end scores this fraction (rounded down)
    joker_surge: bool = True
    # seat compensation: extra cards in the opening hand, by seat index
    seat_bonus_cards: tuple = (0, 0, 0, 0)
    # character tuning
    gritch_spade_steps: int = 3
    sable_hoist: int = 2
    quill_free_faces: int = 1
    twins_pairs_per_turn: int = 1
    mira_wild_suit: int = HEARTS
    hulda_club_pilfer: bool = True
    # --- structural options added during balancing (v1 values shown) ---
    bank_on_pass_through: bool = True
    warden_target: str = "carrier"      # "carrier": richest pack; "leader": highest vault+pack underground
    crush_drop: str = "half_up"         # "half_up" | "half_down" | "one"
    crush_retreat: bool = True
    first_player_first_turn_actions: int = 2
    first_turn_limit_players: tuple = (2, 3, 4)   # player counts where the first-turn limit applies
    gritch_mode: str = "spade_far"      # "spade_far" | "spade_far_no_gate" | "spade_far_gate_end"
    gritch_pack4: bool = False
    hulda_faces_high: bool = False      # v4: a face-card club counts as 10 for Hulda's double pilfer
    joker_ticks_collapse: bool = False  # each joker revealed also advances the collapse marker
    mira_mode: str = "wild"             # "wild" | "wild_high" | "wild_plus1" | "wild_move2"
    sable_mode: str = "hoist"           # "hoist"
    twins_mode: str = "pair"            # "pair" | "pair_or_run"
    quill_mode: str = "free_face"       # "free_face" | "free_event"
    hulda_mode: str = "club_pilfer"     # "club_pilfer" | "club_pilfer_plus_immune"

    def collapse_for(self, n_players: int) -> int:
        return self.collapse_at[n_players]

    def with_(self, **kw) -> "RuleConfig":
        return replace(self, **kw)


VERSIONS: dict[str, RuleConfig] = {"v1": RuleConfig()}
# v2: timer, Warden and scoring fixes + ability recalibration (see CHANGELOG.md)
VERSIONS["v2"] = VERSIONS["v1"].with_(
    version="v2",
    joker_ticks_collapse=True, collapse_at={2: 7, 3: 8, 4: 9},
    warden_target="leader",
    depth_values=(1, 2, 4),
    first_player_first_turn_actions=1,
    gritch_spade_steps=2,
    mira_mode="wild_mineheart",
)
# v3: per-character fine-tuning in the full pool (see CHANGELOG.md)
VERSIONS["v3"] = VERSIONS["v2"].with_(
    version="v3",
    first_turn_limit_players=(3, 4),
    gritch_spade_steps=3, gritch_mode="spade_far_gate_end", gritch_pack4=True,
    hulda_mode="club_pilfer_high2",
    twins_mode="pair_or_suited_run", twins_pairs_per_turn=2,
    quill_mode="free_face_jack4",
)
# v4 (final): v3 plus a wording cleanup that became a rule: a face-card club is "high"
# for Hulda's Shakedown, exactly like face cards count as 10 everywhere else.
VERSIONS["v4"] = VERSIONS["v3"].with_(version="v4", hulda_faces_high=True)
CURRENT = "v4"
FINAL = "v4"


def current() -> RuleConfig:
    return VERSIONS[CURRENT]
