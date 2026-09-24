"""The Glimmerdark map: 14 spaces, fixed for every game.

                      [ GATE ]
  [A1 ♠] — [B1 ♥] — [C1 ♦] — [D1 ♣]      depth 1
     |        |        |        |
  [A2 ♦] — [B2 ♣] — [C2 ♠] — [D2 ♥]      depth 2
     |        |        |        |
  [A3 ♥] — [B3 ♠] — [C3 ♣] — [D3 ♦]      depth 3
              \\        /
              [ HEART ]

Node ids: 0 = Gate, 1..4 = A1..D1, 5..8 = A2..D2, 9..12 = A3..D3, 13 = Heart.
"""

from __future__ import annotations

from collections import deque

from .rules import CLUBS, DIAMONDS, HEARTS, SPADES

GATE, HEART = 0, 13
N_NODES = 14
NAMES = ["Gate", "A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2", "A3", "B3", "C3", "D3", "Heart"]

# vein suit per node (None = no vein: the Gate and the Heart)
VEIN = [None,
        SPADES, HEARTS, DIAMONDS, CLUBS,
        DIAMONDS, CLUBS, SPADES, HEARTS,
        HEARTS, SPADES, CLUBS, DIAMONDS,
        None]
DEPTH = [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4]


def _edges():
    e = set()
    for c in range(1, 5):
        e.add((GATE, c))
    for row in range(3):
        base = 1 + 4 * row
        for c in range(3):
            e.add((base + c, base + c + 1))
        if row < 2:
            for c in range(4):
                e.add((base + c, base + c + 4))
    e.add((10, HEART))
    e.add((11, HEART))
    return e


EDGES = sorted(_edges())
ADJ: list[list[int]] = [[] for _ in range(N_NODES)]
for a, b in EDGES:
    ADJ[a].append(b)
    ADJ[b].append(a)
for lst in ADJ:
    lst.sort()


def _bfs(src: int, blocked: frozenset = frozenset()) -> list[int]:
    dist = [99] * N_NODES
    dist[src] = 0
    q = deque([src])
    while q:
        u = q.popleft()
        for v in ADJ[u]:
            if v in blocked or dist[v] != 99:
                continue
            dist[v] = dist[u] + 1
            q.append(v)
    return dist


# delvers walk everywhere; the Warden never enters the Gate
DIST = [_bfs(s) for s in range(N_NODES)]
WDIST = [_bfs(s, frozenset({GATE})) if s != GATE else [99] * N_NODES for s in range(N_NODES)]


# AVOID[blocked][src]: delver distances when the Warden sits in `blocked`
AVOID = [[_bfs(s, frozenset({b})) for s in range(N_NODES)] for b in range(N_NODES)]


def dist_avoiding(src: int, blocked: int | None) -> list[int]:
    """Distances from src for a delver that may not enter `blocked` (the Warden's chamber)."""
    if blocked is None:
        return DIST[src]
    return AVOID[blocked][src]


def warden_step(src: int, target: int) -> int:
    """One Warden step from src toward target (lowest node id breaks ties). Never the Gate."""
    if src == target:
        return src
    best, bestd = src, WDIST[src][target] if target != GATE else 99
    for v in ADJ[src]:
        if v == GATE:
            continue
        d = WDIST[v][target] if target != GATE else min(WDIST[v][n] for n in ADJ[GATE])
        if d < bestd:
            best, bestd = v, d
    return best


def retreat_step(src: int, blocked: int | None) -> int:
    """A crushed delver's retreat: 1 chamber toward the Gate, not into the Warden."""
    best, bestd = src, DIST[src][GATE]
    for v in ADJ[src]:
        if v == blocked:
            continue
        if DIST[v][GATE] < bestd:
            best, bestd = v, DIST[v][GATE]
    return best


# AVOID2[blocked][src]: like AVOID but the Gate is also impassable (Gritch's no-gate far move)
AVOID2 = [[_bfs(s, frozenset({b, GATE})) if s != GATE else _bfs(s, frozenset({b})) for s in range(N_NODES)] for b in range(N_NODES)]


def dist_avoiding2(src: int, blocked: int | None) -> list[int]:
    return AVOID2[blocked if blocked is not None else GATE][src]
