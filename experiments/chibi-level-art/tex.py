#!/usr/bin/env python3
"""Stylise ambientCG (CC0) 1K colour maps into the small textures Chibi Crawl ships.

Usage: python3 -I tex.py <dir with grass1/2/3.jpg road.jpg sand.jpg> <out dir>
  pip install pillow numpy scipy

All filtering wraps around, so a seamless input stays seamless. The game tints
the ground by biome (multiply), so the three grasses become low-contrast
*greyscale* centred just under white; the road and sand are re-coloured into the
game's cream/tan palette instead of keeping their photographic hues.
"""
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

def load_lum(path, size):
    im = Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float64) / 255.0
    return a @ np.array([0.299, 0.587, 0.114])

def norm01(x, lo=2, hi=98):
    a, b = np.percentile(x, [lo, hi])
    return np.clip((x - a) / (b - a), 0, 1)

def grass(path, size=512, mean=0.9, detail=0.075, blotch=0.035):
    l = load_lum(path, size)
    low = gaussian_filter(l, 22, mode="wrap")
    d = gaussian_filter(l, 1.3, mode="wrap") - low  # mid-frequency grain, soft-edged
    d = d / (d.std() + 1e-9)
    b = (low - low.mean()) / (low.std() + 1e-9)
    out = mean + d * detail + b * blotch
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "L")

def ramp(t, stops):
    xs = [s[0] for s in stops]
    cols = np.array([s[1] for s in stops], dtype=np.float64)
    return np.stack([np.interp(t, xs, cols[:, i]) for i in range(3)], -1)

def recolour(path, stops, size=512, squash=(0.15, 0.7), blur=0.9):
    t = norm01(gaussian_filter(load_lum(path, size), blur, mode="wrap"))
    t = squash[0] + squash[1] * t
    return Image.fromarray(np.clip(ramp(t, stops), 0, 255).astype(np.uint8), "RGB")

if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    for i, n in enumerate("abc", 1):
        grass(f"{src}/grass{i}.jpg").save(f"{out}/ground-{n}.jpg", quality=86)
    # game road/arena colours: dirt (240,210,160), arena sand (250,236,196), pebble shade (190,150,100)
    recolour(f"{src}/road.jpg", [(0, (150, 112, 74)), (0.5, (214, 178, 128)), (1, (248, 228, 188))]).save(f"{out}/road.jpg", quality=86)
    recolour(f"{src}/sand.jpg", [(0, (226, 192, 138)), (1, (252, 240, 204))], squash=(0.2, 0.6)).save(f"{out}/sand.jpg", quality=86)
    print("done")
