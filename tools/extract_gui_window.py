#!/usr/bin/env python3
"""Compose the original window frame (3x3 slice) and the button pills from gui textures."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / "assets/manifest.json").read_text())["textures"]
def load(k):
    return Image.open(ROOT / m[k]).convert("RGBA")

# --- window frame: 48x48 sheet for border-image-slice: 16
sheet = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
grid = [["gui/left_up_gui", "gui/up_gui", "gui/right_up_gui"],
        ["gui/left_gui", "gui/center_gui", "gui/right_gui"],
        ["gui/left_down_gui", "gui/down_gui", "gui/right_down_gui"]]
for r, row in enumerate(grid):
    for c, k in enumerate(row):
        im = load(k)
        if im.size != (16, 16):
            im = im.crop((24, 24, 40, 40))
        sheet.alpha_composite(im, (c * 16, r * 16))
sheet.save(ROOT / "assets/ui/window.png")

# --- button pills (two states) keyed from the flat brown background
def key(im, tol=40):
    a = np.asarray(im.convert("RGB")).astype(int)
    bg = a[0, 0]
    d = np.abs(a - bg).max(axis=2)
    alpha = np.clip((d - 10) * 255 // 30, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([a.astype(np.uint8), alpha]))

bit = load("gui/bitbtn")
key(bit.crop((0, 0, 128, 64))).save(ROOT / "assets/ui/pill_a.png")
key(bit.crop((0, 64, 128, 128))).save(ROOT / "assets/ui/pill_b.png")
print("ok")
