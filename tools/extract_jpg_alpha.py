#!/usr/bin/env python3
"""Recover the real alpha channel of the original JPEG textures.

The engine (NSOGLRender.dll, sub_10002190) stores transparency *inside* the .jpg files:
    [JPEG data ending in FFD9][width*height alpha bytes][u32 alpha byte count][0x6666]
prepare_assets.py ignored that tail and colour-keyed black instead, which lost soft shadows
and left dark halos.  Run this after prepare_assets.py: it rewrites the matching
assets/textures/**/*.png as RGBA with the genuine alpha.
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = (Path.home() / "Library/Application Support/CrossOver/Bottles/Farm/drive_c/"
               "Program Files (x86)/SmallGames/Farm Craft/data/textures")


# JPGs whose transparency the port really uses (beds with rounded corners, HUD bars)
EXTRA = {
    "gameplay/gamefield/beds_dry", "gameplay/gamefield/beds_wet",
    "gameplay/levelgui/upbar", "gameplay/levelgui/downbar",
    # shop button panels: semi-transparent "glass" (alpha ~75/255) with soft corners
    "gameplay/levelgui/item_shop_menu", "gameplay/levelgui/shop_item",
}
# border of the game field: <env>_{up,down,left,right}_center and the four corners (CGameField::draw)
for _env in ("grass", "desert", "swamp"):
    for _n in ("up_center", "down_center", "left_center", "right_center",
               "left_up", "right_up", "left_down", "right_down"):
        EXTRA.add(f"gameplay/gamefield/{_env}_{_n}")


def main(src: Path) -> None:
    done = skipped = 0
    mpath = ROOT / "assets/manifest.json"
    manifest = json.loads(mpath.read_text())
    for f in sorted(src.rglob("*.jpg")):
        b = f.read_bytes()
        if b[-2:] == b"\xff\xd9" or struct.unpack("<H", b[-2:])[0] != 0x6666:
            continue
        n = struct.unpack("<I", b[-6:-2])[0]
        jpg = b[: len(b) - n - 6]
        alpha = b[len(b) - n - 6: len(b) - 6]
        im = Image.open(io.BytesIO(jpg)).convert("RGB")
        if im.size[0] * im.size[1] != n:
            skipped += 1
            continue
        a = Image.frombytes("L", im.size, alpha)
        im.putalpha(a)
        dst = ROOT / "assets/textures" / f.relative_to(src).with_suffix(".png")
        rel = f.relative_to(src).with_suffix("").as_posix()
        if not dst.exists():
            if not (rel.startswith(("menu/", "gamecomics/")) or rel in EXTRA):  # other opaque JPGs stay as they are
                skipped += 1
                continue
            manifest["textures"][rel] = dst.relative_to(ROOT).as_posix()
        im.save(dst)
        done += 1
    mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"rewrote {done} textures with embedded alpha, skipped {skipped}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC)
