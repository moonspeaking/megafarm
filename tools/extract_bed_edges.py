#!/usr/bin/env python3
"""Key the grass strips that surround dug beds (flat background colour + black filler)."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
man_path = ROOT / "assets" / "manifest.json"
man = json.loads(man_path.read_text())
for env in ("grass", "desert", "swamp"):
    for kind in ("lr", "ud"):
        key = f"gameplay/gamefield/{env}_bed_{kind}"
        if key not in man["textures"]:
            continue
        src = ROOT / man["textures"][key].replace(".png", ".jpg")
        if not src.exists():
            src = ROOT / man["textures"][key]
        im = Image.open(src).convert("RGB")
        a = np.asarray(im).astype(int)
        bg = a[0, 0]
        d = np.abs(a - bg).max(axis=2)
        black = a.max(axis=2) <= 12
        alpha = np.clip((d - 14) * 255 // 40, 0, 255)
        alpha[black] = 0
        out = np.dstack([a.astype(np.uint8), alpha.astype(np.uint8)])
        dst = ROOT / "assets/textures/gameplay/gamefield" / f"{env}_bed_{kind}.png"
        Image.fromarray(out).save(dst)
        man["textures"][key] = dst.relative_to(ROOT).as_posix()
man_path.write_text(json.dumps(man, indent=1, ensure_ascii=False))
print("ok")
