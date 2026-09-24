"""The printed documents, replayed on the engine.

Every worked example in the rulebook and on the player aids is set up here
card for card and played through the final ruleset, and every number the
printed text quotes is read from print/content.py and checked against what the
engine does. If a document and the simulator ever disagree, this fails.
"""

import sys
from pathlib import Path

import pytest

from glimmer import board as B
from glimmer import rules as R
from glimmer.engine import Game, IllegalMove

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "print"))
import content as T  # noqa: E402

CFG = R.VERSIONS[R.FINAL]
N = {name: i for i, name in enumerate(B.NAMES)}
SUITS = {"S": R.SPADES, "H": R.HEARTS, "D": R.DIAMONDS, "C": R.CLUBS}
RANKS = {"A": 14, "K": 13, "Q": 12, "J": 11}


class Idle:
    name = "idle"

    def take_turn(self, g, p):
        pass


def cd(code: str) -> int:
    """'9H' -> card id, as the documents write cards."""
    r, s = code[:-1], code[-1]
    return SUITS[s] * 13 + (RANKS.get(r) or int(r)) - 2


def setup(chars, seed=3):
    g = Game(CFG, list(chars), [Idle() for _ in chars], seed)
    g._first = 0
    g.round = 2  # past the first-turn limit unless a test sets round 1
    for node in range(1, 13):
        g.chambers[node] = [CFG.depth_values[B.DEPTH[node] - 1]] * CFG.tokens_per_chamber
    return g


def turn(g, p, hand):
    p.hand = [cd(c) for c in hand]
    g._cur = None
    g.begin_turn(p)


def mentions(text, *codes):
    """The example text really uses these cards (so the test tracks the document)."""
    t = T.suit_text(text)
    for c in codes:
        glyph = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[c[-1]]
        assert c[:-1] + glyph in t, f"{c} not in the printed example"


# ------------------------------------------------------------------ numbers quoted in the text
def test_content_is_the_final_ruleset():
    assert T.CFG is R.VERSIONS[R.FINAL]
    assert R.FINAL == R.CURRENT


def test_printed_numbers_match_the_engine():
    g = setup(["gritch", "quill", "mira", "hulda"])
    assert all(len(p.hand) == CFG.hand_size for p in g.players)
    assert g.pack_limit(g.players[0]) == T.GRITCH_PACK and g.pack_limit(g.players[1]) == CFG.pack_limit
    assert g.jack_steps(g.players[1]) == T.QUILL_JACK and g.jack_steps(g.players[2]) == CFG.jack_steps
    assert g.move_steps(g.players[0], cd("3S")) == CFG.gritch_spade_steps
    assert {n: CFG.collapse_for(n) for n in (2, 3, 4)} == T.COLLAPSE_END
    assert g.chambers[B.HEART] == [CFG.crown_value]
    assert [g.chambers[n][0] for n in (1, 5, 9)] == list(T.DEPTH_VALUES)
    low, high = T.LOW_RANKS.split("–"), T.HIGH_RANKS.split("–")
    assert g._yield[cd(low[0] + "S")] == g._yield[cd(low[1] + "S")] == CFG.low_yield
    assert g._yield[cd(high[0] + "S")] == g._yield[cd(high[1] + "S")] == CFG.high_yield
    assert g._yield[cd("AS")] == CFG.low_yield, "Aces count as 1"
    assert all(g._yield[cd(f + "S")] == CFG.high_yield for f in "JQK"), "faces mine as a 10"
    tokens = dict(T.TOKENS)
    assert set(tokens) == set(CFG.depth_values)


def test_first_turn_limit_only_with_3_or_4_players():
    for n, limited in ((2, False), (3, True), (4, True)):
        g = setup(["mira", "gritch", "hulda", "sable"][:n])
        g.round = 1
        g.begin_turn(g.players[0])
        assert g.actions_left == (1 if limited else CFG.actions_per_turn)
        g.begin_turn(g.players[1])
        assert g.actions_left == CFG.actions_per_turn


def test_rumble_steps_and_joker():
    g = setup(["mira", "gritch"])
    p = g.players[0]
    p.pos, p.pack = N["A1"], [1]
    for card, steps in (("8H", CFG.warden_steps_number), ("AH", CFG.warden_steps_number),
                        ("JC", CFG.warden_steps_face)):
        g.warden = N["Heart"]
        g.draw_pile.append(cd(card))
        g.warden_turn(0)
        assert B.WDIST[N["Heart"]][g.warden] == steps, card
    g.warden = N["Heart"]
    before = g.collapse
    g.draw_pile.append(52)
    g.warden_turn(0)
    assert g.warden == N["Heart"] and g.collapse == before + 1, "a Joker is a Tremor: no move, marker +1"


# ------------------------------------------------------------------ rulebook examples
def test_rulebook_a_first_turn():
    g = setup(["mira", "hulda", "gritch"])
    h = g.players[1]
    turn(g, h, ["4S", "9D", "AH", "6C", "KS"])
    g.act_move(h, cd("4S"), N["C1"])
    assert B.VEIN[N["C1"]] == R.DIAMONDS
    assert g.act_mine(h, cd("9D")) == CFG.high_yield
    assert h.pack == [1, 1] and g.actions_left == 0


def test_rulebook_going_deeper():
    g = setup(["mira", "hulda"])
    h = g.players[1]
    h.pos, h.pack = N["C1"], [1, 1]
    turn(g, h, ["AH", "6C", "KS", "7C", "2H"])
    g.act_move(h, cd("2H"), N["C2"])
    assert B.VEIN[N["C2"]] == R.SPADES and B.DEPTH[N["C2"]] == 2
    assert g.act_mine(h, cd("KS")) == 2
    assert sorted(h.pack) == [1, 1, 2, 2]
    # "If C2 had been any other vein, A♥ would have mined 1 there"
    g2 = setup(["mira", "hulda"])
    h2 = g2.players[1]
    h2.pos = N["B2"]
    turn(g2, h2, ["AH"])
    assert g2.act_mine(h2, cd("AH")) == 1


def test_rulebook_a_rumble_and_a_crush():
    g = setup(["mira", "hulda", "gritch"])
    m, h, gr = g.players
    m.pos, m.vault, m.pack = N["B3"], [4, 2], [4, 2, 2]
    h.pos, h.vault, h.pack = N["C2"], [], [2, 2, 1, 1]
    gr.pos, gr.vault = N["Gate"], [4, 4, 2, 2]
    assert (m.banked + m.carried, h.banked + h.carried, gr.banked) == (14, 6, 12)
    g.warden = N["Heart"]
    assert g.warden_target(0) == N["B3"]
    g.draw_pile.append(cd("8H"))
    g.warden_turn(0)
    assert g.warden == N["B3"]
    assert m.pack == [4] and sorted(g.chambers[N["B3"]]).count(2) >= 2
    assert m.pos == N["B2"]


def test_rulebook_final_scoring_3_players():
    g = setup(["mira", "hulda", "gritch"])
    m, h, gr = g.players
    m.vault, m.pack = [23], [4, 2]
    h.vault, h.pack = [21], [4, 4, 1]
    gr.vault, gr.pack = [26], []
    assert [g.score(p) for p in g.players] == [26, 25, 26]
    assert g.result(0)["winners"] == [2], "tie on points goes to the bigger vault"
    # the reshuffle that ends it: collapse marker reaches 8 with 3 players
    g.collapse = T.COLLAPSE_END[3] - 1
    g.draw_pile, g.discard = [cd("5S")], [cd("6S"), cd("7S")]
    h.hand = [cd("2C"), cd("3C"), cd("4C")]
    g._refill(h)
    assert g.collapse == T.COLLAPSE_END[3] and g.final_round and len(h.hand) == CFG.hand_size


def test_rulebook_queens_and_kings():
    g = setup(["gritch", "sable"])
    gr, sa = g.players
    gr.pos, sa.pos, sa.pack = N["D2"], N["D3"], [4, 4, 2]
    g.warden = N["C3"]
    turn(g, gr, ["QH", "KC"])
    g.act_pilfer(gr, cd("QH"), sa)
    assert gr.pack == [4] and sorted(sa.pack) == [2, 4]
    g.act_rouse(gr, cd("KC"), N["D3"])
    assert g.warden == N["D3"] and sa.pack == [4] and sa.pos == N["D2"]


# ------------------------------------------------------------------ player aid examples
def test_aid_mira():
    ex = T.CHARACTERS["mira"]["example"]
    mentions(ex, "9H", "4H", "6S")
    g = setup(["mira", "gritch"])
    m = g.players[0]
    m.pos = N["C3"]
    g.warden = N["Heart"]
    turn(g, m, T.CHARACTERS["mira"]["hand"])
    assert g.act_mine(m, cd("9H")) == 2 and m.pack == [4, 4]
    assert g.actions_left == CFG.actions_per_turn, "the first heart mined is free"
    assert g.act_mine(m, cd("4H")) == 1 and g.actions_left == 1, "only the first heart is free"
    g.act_move(m, cd("6S"), N["C2"])
    assert g.actions_left == 0


def test_aid_gritch():
    g = setup(["gritch", "mira"])
    gr = g.players[0]
    turn(g, gr, T.CHARACTERS["gritch"]["hand"])
    g.act_move(gr, cd("3S"), N["B3"])
    assert gr.pos == N["B3"] and B.VEIN[N["B3"]] == R.SPADES and B.DEPTH[N["B3"]] == 3
    gr.pack = [4, 4]
    turn(g, gr, ["5S"])
    g.act_move(gr, cd("5S"), N["Gate"])
    assert gr.pos == N["Gate"] and gr.vault == [4, 4], "one spade gets him back to the Gate"
    # he can't pass through the Gate on a spade move
    # (Warden in B1, so A1 -> Gate -> C1 is the only route within 3)
    g2 = setup(["gritch", "mira"])
    g2.players[0].pos, g2.warden = N["A1"], N["B1"]
    turn(g2, g2.players[0], ["4S", "JS"])
    with pytest.raises(IllegalMove):
        g2.act_move(g2.players[0], cd("4S"), N["C1"])
    g2.act_shortcut(g2.players[0], cd("JS"), N["C1"])  # a Jack may pass through
    assert g2.players[0].pos == N["C1"]


def test_aid_hulda():
    g = setup(["hulda", "twins"])
    h, tw = g.players
    h.pos, tw.pos, tw.pack = N["B2"], N["B1"], [4, 2, 1]
    turn(g, h, T.CHARACTERS["hulda"]["hand"])
    g.act_pilfer(h, cd("9C"), tw)
    assert sorted(h.pack) == [2, 4] and tw.pack == [1]
    g.act_pilfer(h, cd("3C"), tw)
    assert sorted(h.pack) == [1, 2, 4] and tw.pack == []
    # faces count as high clubs; an Ace is low
    for code, took in (("7C", 2), ("JC", 2), ("QC", 2), ("KC", 2), ("AC", 1), ("6C", 1)):
        g3 = setup(["hulda", "twins"])
        g3.players[0].pos, g3.players[1].pos, g3.players[1].pack = N["B2"], N["B1"], [4, 2, 1]
        turn(g3, g3.players[0], [code])
        g3.act_pilfer(g3.players[0], cd(code), g3.players[1])
        assert len(g3.players[0].pack) == took, code


def test_aid_sable():
    g = setup(["sable", "mira"])
    s = g.players[0]
    s.pos, s.pack = N["D3"], [4, 4, 4, 2, 2]
    turn(g, s, T.CHARACTERS["sable"]["hand"])
    g.act_hoist(s, cd("5D"))
    g.act_hoist(s, cd("7D"))
    assert s.vault == [4, 4, 4, 2] and s.pack == [2]
    g.warden = N["C3"]
    before = list(g.chambers[N["D3"]])
    g._warden_walk_to(N["D3"])
    assert s.pack == [] and g.chambers[N["D3"]] == before + [2], "a crush can shake loose only one 2"


def test_aid_twins():
    g = setup(["twins", "mira"])
    tw = g.players[0]
    tw.pos = N["B1"]
    turn(g, tw, T.CHARACTERS["twins"]["hand"])
    g.act_move(tw, cd("6H"), N["A1"])
    g.act_move(tw, cd("6C"), N["A2"])
    assert g.actions_left == 1 and B.VEIN[N["A2"]] == R.DIAMONDS
    assert g.act_mine(tw, cd("9D")) == 2 and g.actions_left == 0
    assert g.act_mine(tw, cd("10D")) == 1, "same suit, next rank: free"
    assert len(tw.hand) == 1, "four cards for two actions"
    # Aces sit above Kings, not below 2
    g2 = setup(["twins", "mira"])
    t2 = g2.players[0]
    turn(g2, t2, ["KS", "AS", "2S"])
    assert g2.cost(t2, cd("AS")) == 1
    g2.act_discard(t2, cd("KS"))
    assert g2.cost(t2, cd("AS")) == 0


def test_aid_quill():
    g = setup(["quill", "mira"])
    q = g.players[0]
    g.warden = N["A2"]
    turn(g, q, T.CHARACTERS["quill"]["hand"])
    assert B.dist_avoiding(N["Gate"], N["A2"])[N["Heart"]] == T.QUILL_JACK
    g.act_shortcut(q, cd("JC"), N["Heart"])
    assert q.pos == N["Heart"] and g.actions_left == CFG.actions_per_turn, "first face card is free"
    assert g.act_mine(q, cd("7D")) == 1 and q.pack == [CFG.crown_value], "any card mines in the Heart"
    assert g.actions_left == 1 and cd("KS") in q.hand
