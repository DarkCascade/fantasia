#!/usr/bin/env python3
"""Turn the generated world-map art (Meshy 2D, see README) into the small WebP sprites
Chibi Crawl's map ships.

Usage: python3 -I mapart.py <dir with <name>/image_0.png folders> <out dir>
  pip install pillow

Each source is a 1024px RGBA PNG with a removed background. We zero out faint alpha haze,
crop to the real artwork, and downscale to what the map needs (a town draws ~25 map units
wide, so ~380px covers a big screen at 2x). Output is WebP with alpha.
"""
import os
import sys
from PIL import Image

# name: (output file, longest side in px)
SPECS = {
    "fish": ("sir-fish", 300),
    "town_maybough": ("town-maybough", 380),
    "town_breezewick": ("town-breezewick", 380),
    "town_oakhaven": ("town-oakhaven", 380),
    "town_shiverpine": ("town-shiverpine", 380),
    "tree_blossom": ("tree-blossom", 170),
    "tree_meadow": ("tree-meadow", 170),
    "tree_autumn": ("tree-autumn", 170),
    "tree_frost": ("tree-frost", 170),
}

def process(src, dst, side):
    im = Image.open(src).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 0 if v < 24 else v)  # kill the faint haze the background remover leaves
    im.putalpha(a)
    bb = a.point(lambda v: 255 if v > 40 else 0).getbbox()
    im = im.crop(bb)
    im.thumbnail((side, side), Image.LANCZOS)
    im.save(dst, "WEBP", quality=82, method=6)
    return im.size, os.path.getsize(dst)

if __name__ == "__main__":
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for name, (out, side) in SPECS.items():
        path = os.path.join(src_dir, name, "image_0.png")
        if name == "fish":
            path = os.path.join(src_dir, "fish", "image_0.png")
        size, nbytes = process(path, os.path.join(out_dir, out + ".webp"), side)
        total += nbytes
        print(f"{out}.webp {size[0]}x{size[1]} {nbytes // 1024} KB")
    print("total", total // 1024, "KB")
