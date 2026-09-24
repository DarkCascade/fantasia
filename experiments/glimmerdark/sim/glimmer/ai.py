"""AI strategies for GLIMMERDARK.

All strategies share one action evaluator; they differ in their parameters and
in how much they plan around their character's ability:

  greedy     - chases the richest haul per action, banks only when full,
               ignores the Warden unless it's about to step on it.
  cautious   - banks early, keeps its distance from the Warden, prefers
               shallow chambers and heads home early near the collapse.
  tactician  - balanced risk, targets the leader with Queens/Kings, plans the
               ascent against the collapse clock, and values cards by what its
               own character can do with them (Mira keeps hearts, Gritch keeps
               spades, Twins keep pairs, Quill keeps faces, Sable banks via
               diamonds, Hulda hunts loaded rivals with clubs).
  random     - uniformly random legal actions; a floor for skill-vs-luck.

Every action goes through Game.act_*, so the engine enforces legality.
"""

from __future__ import annotations

import math
import random

from . import board as B
from .engine import ACE, JACK, KING, QUEEN, Game, IllegalMove, Player, is_face, rank, suit
from .rules import CLUBS, DIAMONDS, HEARTS, SPADES

PARAMS = {
    "greedy": dict(bank_tokens=5, bank_value=13, risk=0.25, aggression=0.4, margin=1, depth_bias=0.0,
                   synergy=0.0, leader_focus=0.0, threat_bank=99),
    "cautious": dict(bank_tokens=3, bank_value=6, risk=1.0, aggression=0.2, margin=3, depth_bias=-0.25,
                     synergy=0.0, leader_focus=0.0, threat_bank=2),
    "tactician": dict(bank_tokens=4, bank_value=9, risk=0.9, aggression=1.0, margin=2, depth_bias=0.0,
                      synergy=1.0, leader_focus=1.0, threat_bank=3),
}


class Strategy:
    def __init__(self, name: str, seed: int = 0, **overrides):
        self.name = name
        self.P = dict(PARAMS.get(name, PARAMS["greedy"]))
        self.P.update(overrides)
        self.rng = random.Random(seed)

    # =============================================================== context
    def _turns_left(self, g: Game) -> float:
        if g.final_round:
            return 1.0
        per_pass = 52 + g.cfg.jokers - g.n * g.cfg.hand_size
        remaining = len(g.draw_pile) + (g.collapse_at - g.reshuffles - 1) * per_pass
        per_round = g.n * 2.1 + 1.0
        return 1.0 + remaining / per_round + 1.0

    def _context(self, g: Game, p: Player) -> None:
        cfg = g.cfg
        self.dist_here = B.dist_avoiding(p.pos, g.warden)
        self.d_gate = self.dist_here[B.GATE]
        tl = self._turns_left(g)
        self.turns_left = tl
        actions_future = g.actions_left + (tl - 1.0) * cfg.actions_per_turn
        self.actions_future = actions_future
        self.home_in_time = self.d_gate <= actions_future - self.P["margin"] or self.d_gate == 0
        f = 1.0 if self.home_in_time else cfg.carried_end_factor
        # Warden threat: am I the one it's walking toward, and how close is it?
        self.threatened = False
        if p.pack and p.pos != B.GATE:
            wd = B.WDIST[g.warden][p.pos]
            if wd <= 2 and g.warden_target(g._first) == p.pos:
                self.threatened = True
                f *= 1.0 - (0.35 if wd == 1 else 0.18)
        self.f = f
        self.leader = max(g.players, key=lambda q: q.banked + q.carried)
        self.my_total = p.banked + p.carried
        self.target, self.rate = self._choose_target(g, p)
        self.dist_target = B.dist_avoiding(self.target, g.warden)

    # =============================================================== planning
    def _match_capacity(self, g: Game, p: Player, node: int, moves: int) -> float:
        """Expected glimmer this delver can mine at `node` with its hand plus the
        cards it'll draw on the way (cards spent moving come from non-matches first)."""
        match_yields = []
        other = 0
        for c in p.hand:
            if g.matches(p, c, node):
                match_yields.append(g.mine_yield(p, c))
            else:
                other += 1
        match_yields.sort()
        short = max(0, moves - other)
        if short:
            match_yields = match_yields[short:]
        cap = float(sum(match_yields))
        # draws on the way: roughly 2 per turn, a quarter of them match (+ wild aces/hearts)
        pmatch = 0.25 + 4 / 52
        if p.char == "mira":
            pmatch += 0.2
        if node == B.HEART:
            pmatch = 1.0
        draws = 2.0 * max(0.0, moves / g.cfg.actions_per_turn)
        cap += draws * pmatch * 1.4
        return cap

    def _speed(self, g: Game, p: Player) -> float:
        if p.char == "gritch" and self.P["synergy"] > 0:
            spades = sum(1 for c in p.hand if suit(c) == SPADES)
            return 1.0 + 0.35 * min(spades, 2)
        return 1.0

    def _choose_target(self, g: Game, p: Player) -> tuple[int, float]:
        cfg = g.cfg
        dh = self.dist_here
        space = g.pack_limit(p) - len(p.pack)
        # --- go home?
        want_home = (
            space == 0
            or len(p.pack) >= self.P["bank_tokens"]
            or p.carried >= self.P["bank_value"]
            or (p.pack and not self.home_in_time)
            or (p.pack and self.d_gate >= self.actions_future - self.P["margin"] - 1)
            or (self.threatened and len(p.pack) >= self.P["threat_bank"])
        )
        if p.char == "sable" and self.P["synergy"] > 0 and want_home and space > 0:
            if any(suit(c) == DIAMONDS for c in p.hand) and self.home_in_time:
                want_home = False  # she'll hoist instead of walking up
        if want_home and p.pack:
            return B.GATE, max(0.5, p.carried * (1 - cfg.carried_end_factor) / max(1, self.d_gate))
        best, best_rate = B.GATE, 0.0
        speed = self._speed(g, p)
        for t in range(1, B.N_NODES):
            pile = g.chambers[t]
            if not pile or t == g.warden or dh[t] >= 99:
                continue
            moves = math.ceil(dh[t] / speed)
            cap = self._match_capacity(g, p, t, moves)
            take = min(space, len(pile), int(cap + 0.5))
            if take <= 0:
                continue
            vals = sorted(pile, reverse=True)[:take]
            value = float(sum(vals))
            mine_actions = max(1, math.ceil(take / 1.5))
            back = B.DIST[t][B.GATE]
            actions = moves + mine_actions + 0.6 * back
            if moves + mine_actions + back > self.actions_future:
                value *= cfg.carried_end_factor
            wd = B.WDIST[g.warden][t]
            if wd <= 1:
                value *= 1.0 - 0.5 * self.P["risk"]
            elif wd == 2:
                value *= 1.0 - 0.25 * self.P["risk"]
            for q in g.players:
                if q is not p and q.pos == t:
                    value *= 0.8
            value *= 1.0 + self.P["depth_bias"] * (B.DEPTH[t] - 1)
            rate = value / max(1.0, actions)
            if rate > best_rate:
                best, best_rate = t, rate
        # Hulda (tactician) also treats loaded rivals as a vein to be worked
        if p.char == "hulda" and self.P["synergy"] > 0 and space > 0:
            clubs = sum(1 for c in p.hand if suit(c) == CLUBS)
            if clubs:
                for q in g.players:
                    if q is p or not q.pack or q.pos == B.GATE:
                        continue
                    d = max(0, dh[q.pos] - 1)
                    val = sum(sorted(q.pack, reverse=True)[:min(clubs, space)])
                    rate = val / max(1.0, d + clubs + 0.6 * B.DIST[q.pos][B.GATE]) * 0.9
                    if rate > best_rate:
                        best, best_rate = q.pos, rate
        if best == B.GATE and p.pack:
            return B.GATE, 0.5
        return best, max(best_rate, 0.3)

    # =============================================================== card values
    def _keep(self, g: Game, p: Player, c: int, for_move: bool) -> float:
        """How much we'd rather keep this card than spend it."""
        v = 0.05
        r = rank(c)
        s = suit(c)
        syn = self.P["synergy"]
        t = self.target
        if for_move and t != B.GATE and g.matches(p, c, t):
            pile = g.chambers[t]
            avg = (sum(pile) / len(pile)) if pile else 1.0
            v += 0.55 * g.mine_yield(p, c) * avg
        if r == ACE:
            v += 0.5
        if r == JACK:
            v += 0.5
        elif r == QUEEN:
            rich = max((q.carried for q in g.players if q is not p), default=0)
            v += 0.3 + 0.08 * rich * self.P["aggression"]
        elif r == KING:
            v += 0.45
        if r >= g.cfg.high_rank_min and r < ACE:
            v += 0.15
        if syn:
            if p.char == "mira" and s == HEARTS:
                v += 0.7
            elif p.char == "gritch" and s == SPADES:
                v += 0.6
            elif p.char == "sable" and s == DIAMONDS:
                v += 0.25 + 0.1 * p.carried
            elif p.char == "hulda" and s == CLUBS:
                v += 0.3
            elif p.char == "quill" and is_face(c):
                v += 0.6
            elif p.char == "twins" and sum(1 for d in p.hand if rank(d) == r) >= 2:
                v += 0.7
        return v

    # =============================================================== danger
    def _danger(self, g: Game, p: Player, pos: int, pack: list[int]) -> float:
        """Expected glimmer lost if the turn ends at `pos` carrying `pack`."""
        if pos == B.GATE or not pack:
            return 0.0
        wd = B.WDIST[g.warden][pos]
        if wd > 2:
            return 0.0
        old_pos, old_pack = p.pos, p.pack
        p.pos, p.pack = pos, pack
        try:
            is_target = g.warden_target(g._first) == pos
        finally:
            p.pos, p.pack = old_pos, old_pack
        prob = 0.0
        if is_target:
            prob = 1.0 if wd <= 1 else 0.22
        # rivals holding a King could Rouse it onto us
        rivals_after = g.n - 1
        prob = min(1.0, prob + min(0.3, 0.1 * rivals_after) * (1.0 if wd <= g.cfg.king_rouse_steps else 0.0))
        pk = sorted(pack)
        mode = g.cfg.crush_drop
        drop = (len(pk) + 1) // 2 if mode == "half_up" else len(pk) // 2 if mode == "half_down" else 1
        lost = sum(pk[:drop]) if g.cfg.crush_keep_choice else sum(pk[-drop:])
        return prob * (lost * self.f + 0.3)

    def _is_last(self, g: Game, k: int) -> bool:
        return (k == 1 and g.actions_left == 1) or (k == 0 and g.actions_left == 0)

    # =============================================================== actions
    def _mine_gain(self, g: Game, p: Player, c: int, node: int, space: int) -> float:
        if not g.matches(p, c, node):
            return 0.0
        pile = g.chambers[node]
        take = min(g.mine_yield(p, c), space, len(pile))
        if take <= 0:
            return 0.0
        return float(sum(sorted(pile, reverse=True)[:take]))

    def _options(self, g: Game, p: Player, c: int, k: int):
        """Yield (score, callable) for every use of card c."""
        P = self.P
        normal = k is not None
        k = 1 if k is None else k
        budget_bonus = self.rate * 0.9 if k == 0 else 0.0
        space = g.pack_limit(p) - len(p.pack)
        r = rank(c)
        pair_bonus = 0.0
        if P["synergy"] and p.char == "twins" and k == 1 and g._pairs:
            tm = g.cfg.twins_mode
            partner = any(d != c and (rank(d) == r or (tm == "pair_or_run" and abs(rank(d) - r) == 1)
                                      or (tm == "pair_or_suited_run" and abs(rank(d) - r) == 1 and suit(d) == suit(c)))
                          for d in p.hand)
            if partner:
                pair_bonus = self.rate * 0.8

        # ---- mine
        last = self._is_last(g, k)
        risk = P["risk"]
        km = g.cost(p, c, False, True)
        gain = self._mine_gain(g, p, c, p.pos, space) if km is not None else 0.0
        if gain > 0:
            bbm = self.rate * 0.9 if km == 0 else 0.0
            score = gain * self.f - self._keep(g, p, c, False) * 0.6 + bbm + pair_bonus
            if self._is_last(g, km):
                pile = sorted(g.chambers[p.pos], reverse=True)
                take = min(g.mine_yield(p, c), space, len(pile))
                score -= risk * self._danger(g, p, p.pos, p.pack + pile[:take])
            yield score, (lambda: g.act_mine(p, c))

        # ---- moves (normal, Gritch spade, Jack shortcut)
        steps = g.move_steps(p, c)
        keep_m = self._keep(g, p, c, True)
        for dest, d in (g.reach(p, steps).items() if normal else ()):
            if g.far_move_blocked(p, c, dest):
                continue
            s = self._move_score(g, p, c, dest, steps)
            if last:
                s -= risk * self._end_danger_after_move(g, p, dest, steps)
            yield s - keep_m + budget_bonus + pair_bonus, (lambda dest=dest: g.act_move(p, c, dest))
        ke = g.cost(p, c, True)
        if ke is not None and ke != k:  # an event play may be free when a normal play isn't (Quill)
            budget_bonus_e = self.rate * 0.9 if ke == 0 else 0.0
        else:
            budget_bonus_e = budget_bonus
        if r == JACK and ke is not None:
            keep_j = keep_m - 0.5
            js = g.jack_steps(p)
            for dest, d in g.reach(p, js).items():
                s = self._move_score(g, p, c, dest, js)
                if last and ke == 1:
                    s -= risk * self._end_danger_after_move(g, p, dest, js)
                yield s - keep_j + budget_bonus_e, (lambda dest=dest: g.act_shortcut(p, c, dest))

        # ---- pilfer (Queen, or Hulda's clubs)
        if space > 0 and ((r == QUEEN and ke is not None) or (normal and p.char == "hulda" and suit(c) == CLUBS and g.cfg.hulda_club_pilfer)):
            for q in g.pilfer_targets(p):
                top = max(q.pack)
                lead = 1.0 + P["leader_focus"] * (0.6 if q is self.leader else 0.0)
                s = top * self.f + P["aggression"] * top * 0.6 * lead
                if last:
                    s -= risk * self._danger(g, p, p.pos, p.pack + [top])
                base_keep = self._keep(g, p, c, False) - (0.3 if r == QUEEN else 0.0)
                bb = budget_bonus_e if r == QUEEN else budget_bonus
                yield s - base_keep + bb + pair_bonus, (lambda q=q: g.act_pilfer(p, c, q))

        # ---- rouse (King)
        if r == KING and ke is not None:
            for dest in g.rouse_options():
                s = self._rouse_score(g, p, dest)
                if s > 0:
                    yield s - (self._keep(g, p, c, False) - 0.45) + budget_bonus_e, (lambda dest=dest: g.act_rouse(p, c, dest))

        # ---- hoist (Sable)
        if normal and p.char == "sable" and suit(c) == DIAMONDS and p.pack and not (
                g.cfg.sable_mode == "hoist_shallow" and B.DEPTH[p.pos] > 2):
            top = sorted(p.pack, reverse=True)[: g.hoist_count(c)]
            s = sum(top) * (1.0 - self.f + 0.25) + (0.4 if space <= 1 else 0.0)
            if self.threatened:
                s += 0.2 * sum(top)
            if last:
                rest = sorted(p.pack)[: max(0, len(p.pack) - g.hoist_count(c))]
                s -= risk * self._danger(g, p, p.pos, rest)
            base_keep = self._keep(g, p, c, False) - (0.25 + 0.1 * p.carried if P["synergy"] else 0.0)
            yield s - base_keep + budget_bonus, (lambda: g.act_hoist(p, c))

    def _end_danger_after_move(self, g: Game, p: Player, dest: int, steps: int) -> float:
        banked = dest == B.GATE or (steps > 1 and g.via_gate(p.pos, dest, steps))
        return self._danger(g, p, dest, [] if banked else p.pack)

    def _move_score(self, g: Game, p: Player, c: int, dest: int, steps: int) -> float:
        dt = self.dist_target
        progress = dt[p.pos] - dt[dest]
        s = progress * max(self.rate, 0.4)
        # banking
        vg = dest == B.GATE or (steps > 1 and g.via_gate(p.pos, dest, steps))
        if vg and p.pack:
            s += p.carried * (1.0 - self.f) + 0.6 * len(p.pack) * (1.0 if self.target == B.GATE else 0.5)
        # immediate mining there with what's left
        if dest != B.GATE and g.actions_left >= 2 and g.chambers[dest]:
            space = g.pack_limit(p) - (0 if vg else len(p.pack))
            best = 0.0
            for d in p.hand:
                if d != c:
                    best = max(best, self._mine_gain(g, p, d, dest, space))
            s += 0.5 * best * self.f
        # danger
        if p.pack or dest != B.GATE:
            wd = B.WDIST[g.warden][dest] if dest != B.GATE else 99
            if wd <= 1 and p.pack:
                s -= self.P["risk"] * 0.4 * p.carried
            elif wd <= 1:
                s -= self.P["risk"] * 0.6
        return s

    def _rouse_score(self, g: Game, p: Player, dest: int) -> float:
        # simulate the walk (it stops at the first chamber with delvers)
        node = g.warden
        crushed_node = None
        for _ in range(4):
            if node == dest:
                break
            node = B.warden_step(node, dest)
            if any(q.pos == node for q in g.players):
                crushed_node = node
                break
        s = 0.0
        if crushed_node is not None:
            for q in g.players:
                if q.pos != crushed_node:
                    continue
                pk = sorted(q.pack)
                lost = sum(pk[: (len(pk) + 1) // 2])
                if q is p:
                    s -= 2.0 * lost + 1.0
                else:
                    lead = 1.0 + self.P["leader_focus"] * (0.8 if q is self.leader else 0.0)
                    s += self.P["aggression"] * lost * lead
        # pushing it away from me
        if p.pack and p.pos != B.GATE:
            before = B.WDIST[g.warden][p.pos]
            after = B.WDIST[node][p.pos]
            s += 0.35 * (after - before) * min(p.carried, 8) / 4
        return s

    # =============================================================== turn
    def take_turn(self, g: Game, p: Player) -> None:
        for _ in range(8):
            if not g.can_act(p):
                return
            self._context(g, p)
            best, best_score = None, 0.02 - self.P["risk"] * self._danger(g, p, p.pos, p.pack)
            for c in list(p.hand):
                k = g.cost(p, c)
                if k is None and g.cost(p, c, True) is None and g.cost(p, c, False, True) is None:
                    continue
                for score, act in self._options(g, p, c, k):
                    if score > best_score:
                        best, best_score = act, score
            if best is None:
                return
            try:
                best()
            except IllegalMove as e:  # pragma: no cover - would be an AI bug
                raise RuntimeError(f"{self.name} tried an illegal move: {e}") from e


class RandomAI(Strategy):
    """Uniformly random legal play; ends its turn early 20% of the time."""

    def __init__(self, seed: int = 0):
        super().__init__("random", seed)

    def take_turn(self, g: Game, p: Player) -> None:
        for _ in range(8):
            if not g.can_act(p) or self.rng.random() < 0.2:
                return
            self._context(g, p)
            opts = []
            for c in list(p.hand):
                k = g.cost(p, c)
                if k is None:
                    continue
                opts.extend(a for _, a in self._options(g, p, c, k))
            if not opts:
                return
            self.rng.choice(opts)()


def make(name: str, seed: int = 0) -> Strategy:
    if name == "random":
        return RandomAI(seed)
    return Strategy(name, seed)
