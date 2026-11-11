#!/usr/bin/env python3
"""Cut the decoration atlas (decor.jpg, black colour key) into sprites.

Writes assets/textures/gameplay/gamefield/decor.png (keyed) and assets/decor.json
with one rectangle per sprite and a guessed environment (grass / desert / swamp).
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
import importlib.util

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("pa", ROOT / "tools" / "prepare_assets.py")
pa = importlib.util.module_from_spec(spec); spec.loader.exec_module(pa)

src = ROOT / "assets/textures/gameplay/gamefield/decor.jpg"
im = Image.open(src).convert("RGB")
rgb = np.asarray(im).astype(int)
mx = rgb.max(axis=2)
mn = rgb.min(axis=2)
# the atlas page is white and every sprite sits on a black frame: both are background
passable = (mx <= 40) | (mn >= 245)
bg = np.zeros_like(passable)
bg[0, :] = passable[0, :]; bg[-1, :] = passable[-1, :]; bg[:, 0] = passable[:, 0]; bg[:, -1] = passable[:, -1]
while True:
    n = bg.copy()
    for _ in range(8):
        m = n.copy()
        m[1:, :] |= n[:-1, :]; m[:-1, :] |= n[1:, :]; m[:, 1:] |= n[:, :-1]; m[:, :-1] |= n[:, 1:]
        n = m & passable
    if (n == bg).all():
        break
    bg = n
ring = bg.copy()
ring[1:, :] |= bg[:-1, :]; ring[:-1, :] |= bg[1:, :]; ring[:, 1:] |= bg[:, :-1]; ring[:, :-1] |= bg[:, 1:]
ring &= ~bg
alpha = np.full(mx.shape, 255, dtype=np.uint8)
alpha[bg] = 0
soft = np.clip((mx - 20) * 255 // 60, 0, 255).astype(np.uint8)
alpha[ring] = np.minimum(soft, 255)[ring]
Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA").save(ROOT / "assets/textures/gameplay/gamefield/decor.png")

mask = alpha > 0
mask[440:, :] = False          # calibration squares at the bottom

# connected components of the opaque area (slightly dilated so a sprite stays in one piece)
d = mask.copy()
for _ in range(2):
    n = d.copy()
    n[1:, :] |= d[:-1, :]; n[:-1, :] |= d[1:, :]; n[:, 1:] |= d[:, :-1]; n[:, :-1] |= d[:, 1:]
    d = n
H, W = d.shape
label = np.zeros((H, W), dtype=int)
cur = 0
boxes = []
for y in range(H):
    for x in range(W):
        if d[y, x] and not label[y, x]:
            cur += 1
            stack = [(y, x)]
            label[y, x] = cur
            x0 = x1 = x; y0 = y1 = y
            while stack:
                cy, cx = stack.pop()
                x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                for ny, nx in ((cy+1, cx), (cy-1, cx), (cy, cx+1), (cy, cx-1)):
                    if 0 <= ny < H and 0 <= nx < W and d[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = cur
                        stack.append((ny, nx))
            boxes.append((x0, y0, x1, y1))

sprites = []
for x0, y0, x1, y1 in boxes:
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if w < 14 or h < 10:
        continue
    cy = (y0 + y1) / 2
    cx = (x0 + x1) / 2
    if cy < 190 or 330 < cy < 440:
        env = "grass"
    elif cy < 255:
        env = "swamp" if cx < 385 else "desert"
    else:
        env = "desert"
    # tell stones (tall bulky, brownish/grey) from flowers by their bright pixels
    region = rgb[y0:y1+1, x0:x1+1]
    m = mask[y0:y1+1, x0:x1+1]
    mean = region[m].mean(axis=0)
    kind = "stone" if (abs(mean[0]-mean[1]) < 40 and mean[2] > mean[0]-30 and env != "desert") or w > 50 and h > 40 and env == "grass" and mean[1] < 120 else "flora"
    sprites.append({"x": x0, "y": y0, "w": w, "h": h, "env": env, "kind": kind})
(ROOT / "assets" / "decor.json").write_text(json.dumps(sprites, indent=1))
mp = ROOT / "assets" / "manifest.json"
man = json.loads(mp.read_text())
man["textures"]["gameplay/gamefield/decor"] = "assets/textures/gameplay/gamefield/decor.png"
mp.write_text(json.dumps(man, indent=1, ensure_ascii=False))
print(len(sprites), "sprites", {e: sum(1 for s in sprites if s['env'] == e) for e in ('grass', 'desert', 'swamp')})
