"""Rules-correctness tests: the simulator must implement the printed rules exactly."""

import random
from collections import Counter

import pytest

from glimmer import ai as AI
from glimmer import board as B
from glimmer import rules as R
from glimmer.engine import JOKERS, Game, IllegalMove, rank, suit


class Idle:
    name = "idle"

    def take_turn(self, g, p):
        pass


def game(chars=("mira", "gritch"), cfg=None, seed=1):
    return Game(cfg or R.current(), list(chars), [Idle() for _ in chars], seed)


def card(r, s):
    return s * 13 + (r - 2)


def test_deck_is_a_real_deck():
    g = game(("mira", "gritch", "hulda", "sable"))
    everything = g.draw_pile + g.discard + [c for p in g.players for c in p.hand]
    cfg = R.current()
    assert sorted(everything) == list(range(52)) + list(JOKERS[: cfg.jokers])
    assert all(len(p.hand) == g.hand_limit(p) + cfg.seat_bonus_cards[p.idx] for p in g.players)
    assert not any(c >= 52 for p in g.players for c in p.hand), "jokers are never held"


def test_card_encoding():
    assert rank(card(14, R.SPADES)) == 14 and suit(card(14, R.SPADES)) == R.SPADES
    assert rank(card(2, R.CLUBS)) == 2 and suit(card(2, R.CLUBS)) == R.CLUBS


def test_board_shape():
    assert len(B.EDGES) == 4 + 9 + 8 + 2
    assert Counter(v for v in B.VEIN if v is not None) == {0: 3, 1: 3, 2: 3, 3: 3}
    for row in range(3):
        assert sorted(B.VEIN[1 + 4 * row: 5 + 4 * row]) == [0, 1, 2, 3], "each depth has all four veins"
    assert B.DIST[B.GATE][B.HEART] == 4
    assert all(B.WDIST[s][t] < 99 for s in range(1, 14) for t in range(1, 14)), "Warden reaches every chamber"


def test_reshuffle_advances_collapse_and_conserves_cards():
    g = game()
    total = len(g.draw_pile) + sum(len(p.hand) for p in g.players)
    g.discard, g.draw_pile = g.draw_pile, []
    p = g.players[0]
    g.discard.extend(p.hand)  # play the whole hand, then refill from an empty draw pile
    p.hand.clear()
    g._refill(p)
    assert g.reshuffles == 1
    assert len(g.draw_pile) + len(g.discard) + sum(len(q.hand) for q in g.players) == total


def test_final_round_after_collapse():
    cfg = R.current()
    g = game()
    for _ in range(g.collapse_at):
        g.discard.extend(g.draw_pile)
        g.draw_pile = []
        g._reshuffle()
    assert g.final_round


def _turn(g, p):
    g.begin_turn(p)


def test_mining_rules():
    g = game(("gritch", "mira"))
    p = g.players[0]
    p.pos = 1  # A1, spade vein, depth 1
    p.hand = [card(9, R.SPADES), card(3, R.SPADES), card(9, R.HEARTS), card(14, R.DIAMONDS), card(12, R.SPADES)]
    _turn(g, p)
    with pytest.raises(IllegalMove):
        g.act_mine(p, card(9, R.HEARTS))  # wrong vein, and Gritch isn't Mira
    assert g.act_mine(p, card(9, R.SPADES)) == 2      # high card mines 2
    assert g.act_mine(p, card(3, R.SPADES)) == 1      # low card mines 1
    assert len(p.pack) == 3 and g.chambers[1] == []
    with pytest.raises(IllegalMove):
        g.act_mine(p, card(14, R.DIAMONDS))  # no actions left anyway


def test_ace_is_wild_and_mira_hearts_are_wild():
    g = game(("mira", "gritch"))
    mira = g.players[0]
    mira.pos = 1  # spade vein
    mira.hand = [card(8, R.HEARTS), card(14, R.CLUBS)]
    _turn(g, mira)
    assert g.act_mine(mira, card(8, R.HEARTS)) == 2
    assert g.act_mine(mira, card(14, R.CLUBS)) == 1


def test_pack_limit():
    g = game()
    p = g.players[0]
    p.pos = 5
    p.pack = [1, 1, 1, 1]
    p.hand = [card(10, R.DIAMONDS)]
    _turn(g, p)
    assert g.act_mine(p, card(10, R.DIAMONDS)) == 1
    assert len(p.pack) == R.current().pack_limit


def test_moves_and_banking():
    g = game()
    p = g.players[0]
    p.pos = 1
    p.pack = [2, 3]
    p.hand = [card(4, R.HEARTS)]
    _turn(g, p)
    g.act_move(p, card(4, R.HEARTS), B.GATE)
    assert p.pos == B.GATE and p.pack == [] and sorted(p.vault) == [2, 3]


def test_cannot_enter_warden():
    g = game()
    p = g.players[0]
    p.pos = 10
    g.warden = 11
    p.hand = [card(4, R.HEARTS)]
    _turn(g, p)
    with pytest.raises(IllegalMove):
        g.act_move(p, card(4, R.HEARTS), 11)


def test_gritch_spades_move_far():
    g = game(("gritch", "mira"))
    p = g.players[0]
    p.hand = [card(5, R.SPADES), card(5, R.HEARTS)]
    _turn(g, p)
    far = [1, 5, 9][R.current().gritch_spade_steps - 1]  # straight down column A
    assert far in g.reach(p, R.current().gritch_spade_steps)
    g.act_move(p, card(5, R.SPADES), far)
    assert p.pos == far
    with pytest.raises(IllegalMove):
        g.act_move(p, card(5, R.HEARTS), 1)  # a heart only moves 1


def test_crush_drops_half_rounded_up_and_retreats():
    g = game()
    p = g.players[0]
    p.pos = 6  # B2
    p.pack = [1, 2, 3]
    g.warden = 10  # B3
    g._warden_walk_to(6)
    assert sorted(p.pack) == [3] or len(p.pack) == 1
    assert len(g.chambers[6]) == 3 + 2
    assert p.pos == 2  # retreated to B1


def test_warden_targets_richest_carrier():
    g = game(("mira", "gritch", "hulda"))
    a, b, c = g.players
    a.pos, a.pack = 1, [1, 1]
    b.pos, b.pack = 9, [3]
    c.pos, c.pack = B.GATE, []
    g.warden = B.HEART
    assert g.warden_target(0) == 9  # 3 points beats 2


def test_pilfer_and_hulda_clubs():
    g = game(("hulda", "mira"))
    h, m = g.players
    h.pos, m.pos = 6, 7
    m.pack = [1, 3]
    h.hand = [card(4, R.CLUBS), card(12, R.HEARTS)]
    _turn(g, h)
    g.act_pilfer(h, card(4, R.CLUBS), m)
    assert h.pack == [3] and m.pack == [1]
    g.act_pilfer(h, card(12, R.HEARTS), m)
    assert sorted(h.pack) == [1, 3] and m.pack == []


def test_twins_pair_is_one_action_and_quill_face_is_free():
    g = game(("twins", "quill"))
    t, q = g.players
    t.pos = 1
    t.hand = [card(6, R.HEARTS), card(6, R.CLUBS), card(9, R.DIAMONDS)]
    _turn(g, t)
    g.act_move(t, card(6, R.HEARTS), 2)
    assert g.actions_left == 1
    g.act_move(t, card(6, R.CLUBS), 3)  # completes the pair: free
    assert g.actions_left == 1
    g.act_move(t, card(9, R.DIAMONDS), 4)
    assert g.actions_left == 0
    q.hand = [card(11, R.HEARTS), card(3, R.HEARTS), card(4, R.HEARTS), card(13, R.SPADES)]
    _turn(g, q)
    g.act_shortcut(q, card(11, R.HEARTS), 5)
    assert g.actions_left == 2  # first face card each turn is free
    g.act_move(q, card(3, R.HEARTS), 1)
    g.act_move(q, card(4, R.HEARTS), B.GATE)
    assert g.cost(q, card(13, R.SPADES)) is None  # second face isn't free


def test_sable_hoist():
    g = game(("sable", "mira"))
    s = g.players[0]
    s.pos, s.pack = 9, [1, 3, 2]
    s.hand = [card(5, R.DIAMONDS)]
    _turn(g, s)
    g.act_hoist(s, card(5, R.DIAMONDS))
    assert sorted(s.vault) == [2, 3] and s.pack == [1]


def test_king_rouse_crushes():
    g = game(("mira", "gritch"))
    a, b = g.players
    b.pos, b.pack = 10, [3, 3]
    a.hand = [card(13, R.CLUBS)]
    g.warden = B.HEART
    _turn(g, a)
    assert 10 in g.rouse_options()
    g.act_rouse(a, card(13, R.CLUBS), 10)
    assert g.warden == 10 and len(b.pack) == 1 and b.pos == 6


def test_scoring_halves_carried():
    g = game()
    p = g.players[0]
    p.vault, p.pack = [3, 3], [3, 2]
    assert g.score(p) == 6 + int(5 * R.current().carried_end_factor)


@pytest.mark.parametrize("n", [2, 3, 4])
def test_full_games_terminate_and_conserve_glimmer(n):
    cfg = R.current()
    for seed in range(30):
        chars = random.Random(seed).sample(R.CHARACTERS, n)
        g = Game(cfg, chars, [AI.make(s, seed) for s in ["tactician", "greedy", "cautious", "random"][:n]], seed)
        res = g.play()
        assert not res["timed_out"]
        cards = g.draw_pile + g.discard + [c for p in g.players for c in p.hand]
        assert sorted(cards) == list(range(52)) + list(JOKERS[: cfg.jokers])
        assert all(len(p.pack) <= cfg.pack_limit for p in g.players)
