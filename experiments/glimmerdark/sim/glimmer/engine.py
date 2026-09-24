"""GLIMMERDARK rules engine.

The engine owns all game state and enforces every rule; AIs only ever call the
`act_*` methods, which raise `IllegalMove` for anything the rules forbid. That
way an AI bug can't quietly "cheat" the balance numbers.

Cards are ints: 0..51 = suit * 13 + (rank - 2), rank 2..14 (11 J, 12 Q, 13 K,
14 A); 52 and 53 are the jokers.
"""

from __future__ import annotations

import random
from collections import Counter

from . import board as B
from .rules import ACE, CLUBS, DIAMONDS, JACK, KING, QUEEN, SPADES, RuleConfig

JOKERS = (52, 53)


class IllegalMove(Exception):
    pass


def suit(c: int) -> int:
    return c // 13


def rank(c: int) -> int:
    return c % 13 + 2


def is_face(c: int) -> bool:
    return c < 52 and rank(c) in (JACK, QUEEN, KING)


def card_name(c: int) -> str:
    if c >= 52:
        return "Joker"
    r = rank(c)
    rs = {11: "J", 12: "Q", 13: "K", 14: "A"}.get(r, str(r))
    return rs + "♠♥♦♣"[suit(c)]


class Player:
    __slots__ = ("idx", "char", "ai", "pos", "pack", "vault", "hand", "drawn", "premium_drawn", "log", "stat")

    def __init__(self, idx: int, char: str, ai):
        self.idx = idx
        self.char = char
        self.ai = ai
        self.pos = B.GATE
        self.pack: list[int] = []
        self.vault: list[int] = []
        self.hand: list[int] = []
        self.drawn = 0
        self.premium_drawn = 0
        self.stat = Counter()

    @property
    def carried(self) -> int:
        return sum(self.pack)

    @property
    def banked(self) -> int:
        return sum(self.vault)


class Game:
    def __init__(self, cfg: RuleConfig, chars: list[str], ais: list, seed: int, usage: Counter | None = None):
        self.cfg = cfg
        self.rng = random.Random(seed)
        self.n = len(chars)
        self.players = [Player(i, ch, ai) for i, (ch, ai) in enumerate(zip(chars, ais))]
        self.chambers: list[list[int]] = [[] for _ in range(B.N_NODES)]
        for node in range(1, 13):
            self.chambers[node] = [cfg.depth_values[B.DEPTH[node] - 1]] * cfg.tokens_per_chamber
        self.chambers[B.HEART] = [cfg.crown_value]
        self.warden = B.HEART
        self.draw_pile = list(range(52)) + list(JOKERS[: cfg.jokers])
        self.rng.shuffle(self.draw_pile)
        self.discard: list[int] = []
        self.reshuffles = 0
        self.collapse = 0
        self.collapse_at = cfg.collapse_for(self.n)
        self.final_round = False
        self.round = 0
        self.turns = 0
        self.cards_played = 0
        self.events = Counter()
        self.usage = usage if usage is not None else Counter()
        self.snapshots: list[list[int]] = []
        self.over = False
        # lookup tables: which card mines which node for each character; mining yield per card
        self._yield = [cfg.high_yield if self._eff_rank(c) >= cfg.high_rank_min else cfg.low_yield for c in range(52)]
        self._match = {ch: [[self._matches_slow(ch, c, node) for node in range(B.N_NODES)] for c in range(52)]
                       for ch in set(chars)}
        # per-turn budget state
        self._cur = None
        self._actions_left = 0
        self._free_faces = 0
        self._pairs = 0
        self._last_rank = None
        self._last_suit = None
        self._free_hearts = 0
        self._first = 0
        self._setup = True
        for p in self.players:
            extra = cfg.seat_bonus_cards[p.idx] if p.idx < len(cfg.seat_bonus_cards) else 0
            self._refill(p, self.hand_limit(p) + extra)
        self._setup = False

    # ------------------------------------------------------------------ deck
    def _tick(self) -> None:
        self.collapse += 1
        if self.collapse >= self.collapse_at:
            self.final_round = True

    def _reshuffle(self) -> bool:
        if not self.discard:
            return False
        self.draw_pile = self.discard
        self.discard = []
        self.rng.shuffle(self.draw_pile)
        self.reshuffles += 1
        self.events["reshuffle"] += 1
        self._tick()
        return True

    def _joker(self) -> None:
        if self.cfg.joker_surge:
            self._surge()
        if self.cfg.joker_ticks_collapse:
            self._tick()

    def _flip(self) -> int | None:
        if not self.draw_pile and not self._reshuffle():
            return None
        return self.draw_pile.pop()

    def _surge(self) -> None:
        self.events["surge"] += 1
        for node in range(1, 13):
            if not self.chambers[node]:
                v = self.cfg.depth_values[B.DEPTH[node] - 1]
                self.chambers[node].append(v)
                self.events[f"surge_token_{v}"] += 1

    def hand_limit(self, p: Player) -> int:
        if p.char == "mira" and self.cfg.mira_mode.endswith("hand6"):
            return self.cfg.hand_size + 1
        if p.char == "twins" and self.cfg.twins_mode.endswith("hand6"):
            return self.cfg.hand_size + 1
        if p.char == "quill" and self.cfg.quill_mode.endswith("hand6"):
            return self.cfg.hand_size + 1
        return self.cfg.hand_size

    def _refill(self, p: Player, size: int | None = None) -> None:
        size = self.hand_limit(p) if size is None else size
        while len(p.hand) < size:
            c = self._flip()
            if c is None:
                return
            if c >= 52:  # joker: revealed, resolved, discarded, replaced
                if self._setup:  # dealt at setup: shuffle it back in and deal another
                    self.draw_pile.insert(self.rng.randrange(len(self.draw_pile) + 1), c)
                    continue
                self._joker()
                self.discard.append(c)
                continue
            p.hand.append(c)
            p.drawn += 1
            if rank(c) >= self.cfg.high_rank_min:
                p.premium_drawn += 1

    # ------------------------------------------------------------------ helpers
    def eff_rank(self, c: int) -> int:
        return self._eff_rank(c)

    def _eff_rank(self, c: int) -> int:
        r = rank(c)
        if r == ACE:
            return 1
        if r in (JACK, QUEEN, KING):
            return self.cfg.face_as_rank
        return r

    def matches(self, p: Player, c: int, node: int) -> bool:
        return self._match[p.char][c][node]

    def _matches_slow(self, char: str, c: int, node: int) -> bool:
        vein = B.VEIN[node]
        if node == B.HEART:
            return True
        if vein is None:
            return False
        s = suit(c)
        if s == vein:
            return True
        if self.cfg.ace_wild and rank(c) == ACE:
            return True
        if char == "mira" and s == self.cfg.mira_wild_suit and "wild" in self.cfg.mira_mode:
            return True
        return False

    def mine_yield(self, p: Player, c: int) -> int:
        y = self._yield[c]
        if p.char == "mira" and suit(c) == self.cfg.mira_wild_suit:
            m = self.cfg.mira_mode
            if m.startswith("wild_high"):
                y = self.cfg.high_yield
            elif m.startswith("wild_plus1"):
                y += 1
        return y

    def pack_limit(self, p: Player) -> int:
        if p.char == "sable" and self.cfg.sable_mode == "hoist_pack4":
            return self.cfg.pack_limit - 1
        if p.char == "gritch" and self.cfg.gritch_pack4:
            return self.cfg.pack_limit - 1
        return self.cfg.pack_limit

    def space(self, p: Player) -> int:
        return self.pack_limit(p) - len(p.pack)

    def delvers_at(self, node: int) -> list[Player]:
        return [q for q in self.players if q.pos == node]

    def reach(self, p: Player, steps: int) -> dict[int, int]:
        """Nodes reachable within `steps` without entering the Warden's chamber -> distance."""
        d = B.dist_avoiding(p.pos, self.warden)
        return {v: d[v] for v in range(B.N_NODES) if 0 < d[v] <= steps}

    def via_gate(self, src: int, dest: int, steps: int) -> bool:
        d_src = B.dist_avoiding(src, self.warden)
        d_gate = B.dist_avoiding(B.GATE, self.warden)
        return d_src[B.GATE] + d_gate[dest] <= steps

    # --------------------------------------------------------------- budget
    def begin_turn(self, p: Player) -> None:
        self._cur = p
        self._actions_left = self.cfg.actions_per_turn
        if self.round == 1 and p.idx == self._first and self.n in self.cfg.first_turn_limit_players:
            self._actions_left = self.cfg.first_player_first_turn_actions
        self._free_faces = self.cfg.quill_free_faces if p.char == "quill" else 0
        self._free_hearts = 1 if (p.char == "mira" and ("freeheart" in self.cfg.mira_mode or "mineheart" in self.cfg.mira_mode)) else 0
        self._pairs = self.cfg.twins_pairs_per_turn if p.char == "twins" else 0
        self._last_rank = None

    def cost(self, p: Player, c: int, event: bool = False, mining: bool = False) -> int | None:
        """Actions this card would cost now (0 or 1), or None if it can't be played."""
        if p is not self._cur or c not in p.hand:
            return None
        if self._free_faces and is_face(c) and (self.cfg.quill_mode.startswith("free_face") or event):
            return 0
        if self._free_hearts and suit(c) == self.cfg.mira_wild_suit and (mining or "mineheart" not in self.cfg.mira_mode):
            return 0
        if self._pairs and self._last_rank is not None:
            r = rank(c)
            tm = self.cfg.twins_mode
            if (r == self._last_rank or (tm == "pair_or_run" and abs(r - self._last_rank) == 1)
                    or (tm == "pair_or_suited_run" and abs(r - self._last_rank) == 1 and suit(c) == self._last_suit)):
                return 0
        return 1 if self._actions_left > 0 else None

    def _spend(self, p: Player, c: int, kind: str) -> None:
        event = kind in ("shortcut", "rouse") or (kind == "pilfer" and rank(c) == QUEEN)
        mining = kind == "mine"
        k = self.cost(p, c, event, mining)
        if k is None:
            raise IllegalMove(f"{card_name(c)} cannot be played now")
        if k == 0:
            if self._free_faces and is_face(c) and (self.cfg.quill_mode.startswith("free_face") or event):
                self._free_faces -= 1
            elif self._free_hearts and suit(c) == self.cfg.mira_wild_suit and (mining or "mineheart" not in self.cfg.mira_mode):
                self._free_hearts -= 1
            else:
                self._pairs -= 1
        else:
            self._actions_left -= 1
        self._last_rank = rank(c) if k == 1 else None
        self._last_suit = suit(c)
        p.hand.remove(c)
        self.discard.append(c)
        self.cards_played += 1
        self.usage[(suit(c), rank(c), kind)] += 1

    @property
    def actions_left(self) -> int:
        return self._actions_left

    def can_act(self, p: Player) -> bool:
        return any(self.cost(p, c) is not None for c in p.hand)

    # --------------------------------------------------------------- actions
    def _arrive(self, p: Player, dest: int, via_gate: bool) -> None:
        p.pos = dest
        if (dest == B.GATE or (via_gate and self.cfg.bank_on_pass_through)) and p.pack:
            p.vault.extend(p.pack)
            p.pack.clear()
            self.events["bank"] += 1

    def act_move(self, p: Player, c: int, dest: int) -> None:
        self._do_move(p, c, dest, self.move_steps(p, c), "move")

    def move_steps(self, p: Player, c: int) -> int:
        if p.char == "gritch" and suit(c) == SPADES:
            return self.cfg.gritch_spade_steps
        if p.char == "mira" and self.cfg.mira_mode == "wild_move2" and suit(c) == self.cfg.mira_wild_suit:
            return 2
        return self.cfg.move_steps

    def act_shortcut(self, p: Player, c: int, dest: int) -> None:
        if rank(c) != JACK:
            raise IllegalMove("Shortcut needs a Jack")
        self._do_move(p, c, dest, self.jack_steps(p), "shortcut")

    def jack_steps(self, p: Player) -> int:
        if p.char == "quill" and "jack4" in self.cfg.quill_mode:
            return self.cfg.jack_steps + 1
        return self.cfg.jack_steps

    def far_move_blocked(self, p: Player, c: int, dest: int) -> bool:
        """Gritch's no-gate variant: a far spade move may not end at or pass through the Gate."""
        gm = self.cfg.gritch_mode
        if not (p.char == "gritch" and gm in ("spade_far_no_gate", "spade_far_gate_end") and suit(c) == SPADES):
            return False
        d_here = B.dist_avoiding(p.pos, self.warden)
        if dest == B.GATE:
            limit = self.cfg.gritch_spade_steps if gm == "spade_far_gate_end" else self.cfg.move_steps
            return d_here[B.GATE] > limit
        # only allowed if a path avoiding the Gate exists within the steps
        return B.dist_avoiding2(p.pos, self.warden)[dest] > self.cfg.gritch_spade_steps

    def _do_move(self, p, c, dest, steps, kind):
        r = self.reach(p, steps)
        if dest not in r or (kind == "move" and self.far_move_blocked(p, c, dest)):
            raise IllegalMove(f"cannot reach {B.NAMES[dest]}")
        vg = steps > 1 and dest != B.GATE and self.via_gate(p.pos, dest, steps)
        if kind == "move" and p.char == "gritch" and self.cfg.gritch_mode != "spade_far" and suit(c) == SPADES:
            vg = False
        self._spend(p, c, kind)
        self._arrive(p, dest, vg)

    def act_mine(self, p: Player, c: int) -> int:
        node = p.pos
        if not self.matches(p, c, node):
            raise IllegalMove("card does not match the vein")
        pile = self.chambers[node]
        take = min(self.mine_yield(p, c), self.space(p), len(pile))
        if take <= 0:
            raise IllegalMove("nothing to mine / pack full")
        self._spend(p, c, "mine")
        pile.sort()
        for _ in range(take):
            v = pile.pop()
            p.pack.append(v)
            p.stat["mined_value"] += v
        return take

    def pilfer_targets(self, p: Player) -> list[Player]:
        near = set(B.ADJ[p.pos]) | {p.pos}
        return [q for q in self.players if q is not p and q.pack and q.pos in near]

    def act_pilfer(self, p: Player, c: int, target: Player) -> None:
        ok = rank(c) == QUEEN or (p.char == "hulda" and self.cfg.hulda_club_pilfer and suit(c) == CLUBS)
        if not ok:
            raise IllegalMove("Pilfer needs a Queen (or Hulda's club)")
        if target not in self.pilfer_targets(p) or self.space(p) <= 0:
            raise IllegalMove("no pilfer target / pack full")
        n_take = 1
        if (p.char == "hulda" and suit(c) == CLUBS and self.cfg.hulda_mode == "club_pilfer_high2"
                and self._eff_rank(c) >= self.cfg.high_rank_min and (self.cfg.hulda_faces_high or rank(c) < QUEEN)):
            n_take = 2
        self._spend(p, c, "pilfer")
        target.pack.sort()
        for _ in range(min(n_take, len(target.pack), self.space(p))):
            v = target.pack.pop()
            p.pack.append(v)
            p.stat["pilfer_gain"] += v
            target.stat["pilfer_lost"] += v
        self.events["pilfer"] += 1

    def rouse_options(self) -> dict[int, int]:
        """Warden destinations for a King: node -> steps (path may not cross the Gate)."""
        d = B.WDIST[self.warden]
        return {v: d[v] for v in range(1, B.N_NODES) if 0 < d[v] <= self.cfg.king_rouse_steps}

    def act_rouse(self, p: Player, c: int, dest: int) -> None:
        if rank(c) != KING:
            raise IllegalMove("Rouse needs a King")
        if dest not in self.rouse_options():
            raise IllegalMove("Warden cannot reach there")
        self._spend(p, c, "rouse")
        self.events["rouse"] += 1
        self._warden_walk_to(dest)

    def act_hoist(self, p: Player, c: int) -> None:
        if p.char != "sable" or suit(c) != DIAMONDS or not p.pack:
            raise IllegalMove("Hoist is Sable's, with a diamond, and needs glimmer")
        if self.cfg.sable_mode == "hoist_shallow" and B.DEPTH[p.pos] > 2:
            raise IllegalMove("the pulley only reaches depth 2")
        n = self.hoist_count(c)
        self._spend(p, c, "hoist")
        p.pack.sort()
        for _ in range(min(n, len(p.pack))):
            p.vault.append(p.pack.pop())
        self.events["hoist"] += 1

    def hoist_count(self, c: int) -> int:
        if self.cfg.sable_mode == "hoist_by_rank":
            return 2 if self._eff_rank(c) >= self.cfg.high_rank_min else 1
        return self.cfg.sable_hoist

    def act_discard(self, p: Player, c: int) -> None:
        self._spend(p, c, "discard")

    # ---------------------------------------------------------------- Warden
    def _crush(self, node: int) -> None:
        for q in self.delvers_at(node):
            self.events["crush"] += 1
            q.stat["crushed"] += 1
            if q.pack:
                mode = self.cfg.crush_drop
                drop = (len(q.pack) + 1) // 2 if mode == "half_up" else len(q.pack) // 2 if mode == "half_down" else 1
                q.pack.sort()  # keeps the valuable ones (the player chooses; they'd drop cheap)
                if not self.cfg.crush_keep_choice:
                    q.pack.reverse()
                dropped, q.pack = q.pack[:drop], q.pack[drop:]
                q.stat["crush_lost"] += sum(dropped)
                self.chambers[node].extend(dropped)
                self.events["crush_tokens"] += drop
            if self.cfg.crush_retreat:
                dest = B.retreat_step(node, node)
                self._arrive(q, dest, False)

    def _warden_walk_to(self, dest: int) -> None:
        guard = 0
        while self.warden != dest and guard < 10:
            guard += 1
            self.warden = B.warden_step(self.warden, dest)
            if self.delvers_at(self.warden):
                self._crush(self.warden)
                if self.cfg.warden_stops_after_crush:
                    return

    def warden_target(self, first: int) -> int:
        order = {p.idx: (p.idx - first) % self.n for p in self.players}
        if self.cfg.warden_target == "leader":
            under = [p for p in self.players if p.pos != B.GATE]
            if not under:
                return B.HEART
            best = max(under, key=lambda p: (p.banked + p.carried, -B.WDIST[self.warden][p.pos], -order[p.idx]))
            return best.pos
        carriers = [p for p in self.players if p.pack and p.pos != B.GATE]
        if not carriers:
            return B.HEART
        best = max(carriers, key=lambda p: (p.carried, -B.WDIST[self.warden][p.pos], -order[p.idx]))
        return best.pos

    def warden_turn(self, first: int) -> None:
        c = self._flip()
        if c is None:
            return
        self.discard.append(c)
        if c >= 52:
            self._joker()
            self.events["rumble_joker"] += 1
            return
        steps = self.cfg.warden_steps_face if is_face(c) else self.cfg.warden_steps_number
        target = self.warden_target(first)
        for _ in range(steps):
            if self.warden == target:
                break
            self.warden = B.warden_step(self.warden, target)
            if self.delvers_at(self.warden):
                self._crush(self.warden)
                if self.cfg.warden_stops_after_crush:
                    break

    # ------------------------------------------------------------------ flow
    def score(self, p: Player) -> int:
        return p.banked + int(p.carried * self.cfg.carried_end_factor)

    def play(self, first: int = 0, max_rounds: int = 200) -> dict:
        self._first = first
        while not self.over and self.round < max_rounds:
            self.round += 1
            for k in range(self.n):
                p = self.players[(first + k) % self.n]
                self.begin_turn(p)
                p.ai.take_turn(self, p)
                self._cur = None
                self._refill(p)
                self.turns += 1
            self.warden_turn(first)
            self.snapshots.append([q.banked + q.carried for q in self.players])
            if self.final_round:
                self.over = True
        return self.result(first)

    def result(self, first: int) -> dict:
        scores = [self.score(p) for p in self.players]
        best = max(scores)
        tied = [p for p in self.players if scores[p.idx] == best]
        if len(tied) > 1:
            bv = max(p.banked for p in tied)
            tied = [p for p in tied if p.banked == bv]
        return {
            "n": self.n,
            "chars": [p.char for p in self.players],
            "ais": [p.ai.name for p in self.players],
            "first": first,
            "scores": scores,
            "banked": [p.banked for p in self.players],
            "carried": [p.carried for p in self.players],
            "winners": [p.idx for p in tied],
            "rounds": self.round,
            "turns": self.turns,
            "cards_played": self.cards_played,
            "events": dict(self.events),
            "snapshots": self.snapshots,
            "premium": [p.premium_drawn / max(1, p.drawn) for p in self.players],
            "left_on_board": sum(sum(ch) for ch in self.chambers),
            "timed_out": not self.over,
            "pstats": [dict(p.stat) for p in self.players],
        }
