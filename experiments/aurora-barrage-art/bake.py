#!/usr/bin/env python3 -I
"""Bake raw Meshy PNGs into small WebPs in src/aurora-barrage/ (pip install pillow numpy)."""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "aurora-barrage")
os.makedirs(OUT, exist_ok=True)

# name -> width in px (about 2x the in-game display width, so phones stay sharp)
SHIPS = {"player": 192, "scout": 160, "gunship": 224, "bomber": 288, "boss": 640}

def ship(name, w):
    im = Image.open(f"{HERE}/raw/{name}.png").convert("RGBA")
    a = np.array(im)
    a[..., 3][a[..., 3] < 40] = 0              # drop faint matte haze (e.g. the player's exhaust wisp)
    im = Image.fromarray(a)
    im = im.crop(im.getbbox())
    h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    path = f"{OUT}/{name}.webp"
    im.save(path, quality=88, method=6)
    print(name, im.size, os.path.getsize(path) // 1024, "KB")

def background():
    im = Image.open(f"{HERE}/raw/bg.png").convert("RGB")
    a = np.array(im).astype(np.float32)
    H, W, _ = a.shape
    # 1. erase the lone planet (it would otherwise appear twice after the loop crossfade):
    #    replace its box with a heavily blurred copy of the surroundings, feathered.
    small = im.resize((W // 24, H // 24), Image.BILINEAR).filter(ImageFilter.GaussianBlur(3))
    soft = np.array(small.resize((W, H), Image.BICUBIC)).astype(np.float32)
    m = np.zeros((H, W), np.float32)
    m[560:740, 340:600] = 1
    m = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))).astype(np.float32)[..., None] / 255
    a = a * (1 - m) + soft * m
    # 2. make it loop vertically: blend the image with itself shifted by half a tile
    y = np.arange(H, dtype=np.float32)[:, None, None]
    w = np.sin(np.pi * y / H) ** 2
    a = a * w + np.roll(a, H // 2, axis=0) * (1 - w)
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((576, 1024), Image.LANCZOS)
    path = f"{OUT}/bg.webp"
    out.save(path, quality=80, method=6)
    print("bg", out.size, os.path.getsize(path) // 1024, "KB")
    # preview of the seam: two copies stacked
    seam = Image.new("RGB", (576, 800)); seam.paste(out.crop((0, 624, 576, 1024)), (0, 0)); seam.paste(out.crop((0, 0, 576, 400)), (0, 400))
    seam.save("/tmp/seam.png")

for n, w in SHIPS.items():
    ship(n, w)
background()
