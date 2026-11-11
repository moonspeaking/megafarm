#!/usr/bin/env python3
"""Prepare Farm Craft assets for the browser port.

Reads the game files from the CrossOver bottle, converts TGA/JPEG sprites to
browser friendly PNG files (black colour-key -> alpha), copies audio and
transcodes the UTF-16 script files to UTF-8.  Writes assets/manifest.json.

Usage:
    python3 tools/prepare_assets.py [--source PATH] [--dest PATH]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from PIL import Image

DEFAULT_SOURCE = (
    Path.home()
    / "Library/Application Support/CrossOver/Bottles/Farm/drive_c/"
    "Program Files (x86)/SmallGames/Farm Craft"
)
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DEST = ROOT / "assets"

# Directories whose JPEGs are sprite sheets with a black background that must
# become transparent.  Everything else keeps its original background.
KEYED_PREFIXES = (
    "textures/animations/",
    "textures/objects/",
    "textures/gui/",
    "textures/menu/",
    "textures/gamemap/",
    "textures/trophyroom/",
    "textures/loader/",
)


def is_keyed(rel: str) -> bool:
    rel = rel.replace("\\", "/")
    if not rel.lower().endswith((".jpg", ".jpeg")):
        return False
    return any(rel.startswith(p) for p in KEYED_PREFIXES)


def key_black(im: Image.Image) -> Image.Image:
    """Turn a black-background JPEG into an RGBA image.

    The original engine uses black as a colour key.  Only near-black pixels
    that are connected to the image border count as background, so dark
    outlines and shadows *inside* a sprite stay fully opaque (an alpha derived
    from brightness makes everything look washed out).  A one pixel ring around
    the background is feathered to hide the JPEG fringe.
    """
    import numpy as np

    rgb = np.asarray(im.convert("RGB"))
    mx = rgb.max(axis=2).astype(np.int16)
    dark = mx <= 40
    bg = np.zeros_like(dark)
    bg[0, :] = dark[0, :]
    bg[-1, :] = dark[-1, :]
    bg[:, 0] = dark[:, 0]
    bg[:, -1] = dark[:, -1]
    while True:
        n = bg.copy()
        for _ in range(8):  # several growth steps per convergence check
            m = n.copy()
            m[1:, :] |= n[:-1, :]
            m[:-1, :] |= n[1:, :]
            m[:, 1:] |= n[:, :-1]
            m[:, :-1] |= n[:, 1:]
            n = m & dark
        if (n == bg).all():
            break
        bg = n
    ring = bg.copy()
    ring[1:, :] |= bg[:-1, :]
    ring[:-1, :] |= bg[1:, :]
    ring[:, 1:] |= bg[:, :-1]
    ring[:, :-1] |= bg[:, 1:]
    ring &= ~bg
    alpha = np.full(mx.shape, 255, dtype=np.uint8)
    alpha[bg] = 0
    soft = np.clip((mx - 20) * 255 // 60, 0, 255).astype(np.uint8)
    alpha[ring] = soft[ring]
    out = np.dstack([rgb, alpha])
    return Image.fromarray(out, "RGBA")


def has_black_corners(im: Image.Image) -> bool:
    rgb = im.convert("RGB")
    w, h = rgb.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    return all(sum(rgb.getpixel(p)) <= 12 for p in pts)


def uniform_corner_color(im: Image.Image):
    """Return the common corner colour if all four corners agree, else None."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    pts = [rgb.getpixel(q) for q in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    c = pts[0]
    if all(max(abs(a - b) for a, b in zip(c, q)) <= 6 for q in pts):
        return c
    return None


def key_color(im: Image.Image, color, tol: int = 40) -> Image.Image:
    """Make pixels close to `color` transparent (flat colour-key background)."""
    rgb = im.convert("RGB")
    out = Image.new("RGBA", rgb.size)
    px, op = rgb.load(), out.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = px[x, y]
            d = max(abs(r - color[0]), abs(g - color[1]), abs(b - color[2]))
            a = 0 if d <= tol // 2 else (255 if d >= tol else int(255 * (d - tol // 2) / (tol - tol // 2)))
            op[x, y] = (r, g, b, a)
    return out


def convert_texture(src: Path, dst: Path, rel: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower()
    if ext == ".tga":
        with Image.open(src) as im:
            im.convert("RGBA").save(dst.with_suffix(".png"))
        return
    if ext in (".jpg", ".jpeg"):
        if is_keyed(rel):
            with Image.open(src) as im:
                force = rel.replace("\\", "/").startswith(
                    ("textures/animations/animals/", "textures/animations/plants/"))
                if force or has_black_corners(im):
                    key_black(im).save(dst.with_suffix(".png"))
                else:
                    c = uniform_corner_color(im) if rel.replace("\\", "/").startswith("textures/objects/") else None
                    if c:
                        key_color(im, c).save(dst.with_suffix(".png"))
                    else:
                        im.convert("RGB").save(dst.with_suffix(".png"))
        else:
            # backgrounds: keep as JPEG (smaller, no transparency needed)
            shutil.copy2(src, dst.with_suffix(".jpg"))
        return
    shutil.copy2(src, dst)


def convert_script(src: Path, dst: Path) -> None:
    raw = src.read_bytes()
    if raw.startswith(b"\xff\xfe"):
        text = raw.decode("utf-16")
    elif raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1251")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text, encoding="utf-8")


def assets_rel(path: Path) -> str:
    """Path relative to the project root (the web server root)."""
    return Path(os.path.relpath(path, ROOT)).as_posix()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    ap.add_argument("--rekey", action="store_true",
                    help="only regenerate colour-keyed sprite textures in place")
    args = ap.parse_args()

    src_root: Path = args.source
    data = src_root / "data"
    if not data.is_dir():
        raise SystemExit(f"game data not found: {data}")

    dest: Path = args.dest
    if args.rekey:
        tex_src = data / "textures"
        n = 0
        for src in sorted(tex_src.rglob("*.jp*g")):
            rel = src.relative_to(data).as_posix()
            if not is_keyed(rel):
                continue
            out = dest / "textures" / src.relative_to(tex_src)
            if not out.with_suffix(".png").exists():
                continue
            convert_texture(src, out, rel)
            n += 1
        print(f"re-keyed {n} textures")
        return
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    manifest = {"textures": {}, "sounds": {}, "scripts": {}, "fonts": {}}

    # --- textures ---------------------------------------------------------
    tex_src = data / "textures"
    tex_dst = dest / "textures"
    for src in sorted(tex_src.rglob("*")):
        if not src.is_file() or src.name.startswith("."):
            continue
        rel = src.relative_to(data).as_posix()
        out = tex_dst / src.relative_to(tex_src)
        convert_texture(src, out, rel)
        # record the actual produced file (png or jpg)
        produced = out.with_suffix(".png")
        if not produced.exists():
            produced = out.with_suffix(".jpg")
        key = src.relative_to(tex_src).with_suffix("").as_posix().lower()
        manifest["textures"][key] = assets_rel(produced)

    # --- sounds (transcoded to m4a for Safari compatibility) -------------
    import subprocess
    snd_src = data / "sounds"
    snd_dst = dest / "sounds"
    snd_dst.mkdir(parents=True, exist_ok=True)
    for src in sorted(snd_src.rglob("*.ogg")):
        out = snd_dst / (src.stem + ".m4a")
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(src),
             "-c:a", "aac", "-b:a", "128k", str(out)],
            check=True,
        )
        manifest["sounds"][src.name.lower()] = assets_rel(out)

    # --- scripts ----------------------------------------------------------
    scr_src = data / "scripts"
    scr_dst = dest / "scripts"
    for src in sorted(scr_src.rglob("*.txt")):
        rel = src.relative_to(scr_src).as_posix()
        out = scr_dst / rel
        convert_script(src, out)
        manifest["scripts"][rel[:-4].lower()] = assets_rel(out)

    # --- fonts (bitmap atlas, currently unused but kept for later) --------
    fonts_dst = dest / "fonts"
    fonts_dst.mkdir(parents=True, exist_ok=True)
    for name in ("uni", "chn", "jap", "kor"):
        for ext in (".dat", ".tga"):
            p = data / f"{name}{ext}"
            if p.exists():
                if ext == ".tga":
                    with Image.open(p) as im:
                        im.convert("RGBA").save(fonts_dst / f"{name}.png")
                    manifest["fonts"][f"{name}.png"] = assets_rel(fonts_dst / f"{name}.png")
                else:
                    shutil.copy2(p, fonts_dst / p.name)
                    manifest["fonts"][p.name] = assets_rel(fonts_dst / p.name)

    (dest / "manifest.json").write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    n_tex = len(manifest["textures"])
    n_snd = len(manifest["sounds"])
    n_scr = len(manifest["scripts"])
    print(f"textures: {n_tex}  sounds: {n_snd}  scripts: {n_scr}")
    print(f"written to {dest}")


if __name__ == "__main__":
    main()
