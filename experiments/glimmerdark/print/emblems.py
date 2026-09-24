"""Character emblems: a medallion per delver (and the Warden), used on player
aids, standees and the rulebook so every character is recognisable at a glance."""

from __future__ import annotations

import math

from reportlab.lib import colors

import content as T
import style as S


def palette(key: str):
    if key == "warden":
        return [S.HexColor(h) for h in T.WARDEN["palette"]]
    return [S.HexColor(h) for h in T.CHARACTERS[key]["palette"]]


def emblem(c, key: str, cx: float, cy: float, r: float):
    pal = palette(key)
    main, dark, accent = pal[0], pal[1], pal[2]
    c.saveState()
    c.setFillColor(dark)
    c.circle(cx, cy, r, fill=1, stroke=0)
    c.setFillColor(main)
    c.circle(cx, cy, r * 0.88, fill=1, stroke=0)
    c.setStrokeColor(accent)
    c.setLineWidth(max(0.8, r * 0.05))
    c.circle(cx, cy, r * 0.76, fill=0, stroke=1)
    c.setFillColor(colors.white)
    c.circle(cx, cy, r * 0.66, fill=1, stroke=0)
    if key == "warden":
        _warden_eye(c, cx, cy, r * 0.62)
    elif key == "twins":
        for dx, code, rot in ((-0.16, "6H", 10), (0.16, "6C", -10)):
            c.saveState()
            c.translate(cx + dx * r, cy - r * 0.02)
            c.rotate(rot)
            S.draw_card(c, -r * 0.2, -r * 0.28, r * 0.4, code)
            c.restoreState()
    elif key == "quill":
        for dx, code, rot in ((-0.24, "JS", 16), (0.0, "QH", 0), (0.24, "KD", -16)):
            c.saveState()
            c.translate(cx + dx * r, cy - r * 0.06)
            c.rotate(rot)
            S.draw_card(c, -r * 0.18, -r * 0.25, r * 0.36, code)
            c.restoreState()
    else:
        suit = T.CHARACTERS[key]["suit"]
        S.draw_suit(c, suit, cx, cy, r * 0.8)
    c.restoreState()


def _warden_eye(c, cx, cy, r):
    c.saveState()
    c.setFillColor(S.HexColor("#2A2E33"))
    c.circle(cx, cy, r, fill=1, stroke=0)
    c.setStrokeColor(S.HexColor("#3FD4E0"))
    c.setLineWidth(max(0.8, r * 0.07))
    for a0 in (0.4, 2.0, 3.5, 5.0):
        p = c.beginPath()
        p.moveTo(cx + r * 0.25 * math.cos(a0), cy + r * 0.25 * math.sin(a0))
        for k in range(1, 4):
            rr = r * (0.25 + 0.22 * k)
            aa = a0 + (0.2 if k % 2 else -0.15)
            p.lineTo(cx + rr * math.cos(aa), cy + rr * math.sin(aa))
        c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(S.HexColor("#3FD4E0"))
    c.ellipse(cx - r * 0.34, cy - r * 0.12, cx + r * 0.34, cy + r * 0.12, fill=1, stroke=0)
    c.setFillColor(S.HexColor("#E8FBFC"))
    c.circle(cx, cy, r * 0.08, fill=1, stroke=0)
    c.restoreState()


def figure_names():
    return list(T.CHARACTERS) + ["warden"]


def display_name(key):
    return T.WARDEN["name"] if key == "warden" else T.CHARACTERS[key]["name"]


def display_title(key):
    return T.WARDEN["title"] if key == "warden" else T.CHARACTERS[key]["title"]
