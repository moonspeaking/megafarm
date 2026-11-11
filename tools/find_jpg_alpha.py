#!/usr/bin/env python3
"""Read-only audit: find .jpg files in assets/ that still carry the embedded
alpha tail produced by the original engine (NSOGLRender.dll sub_10002190):

    [jpeg data ending in FFD9][width*height alpha bytes][u32 count][0x6666]

For each jpg we report: size, SOF dimensions, whether the tail is present and
valid (count == w*h, the jpeg part ends with FFD9), whether the alpha was
already extracted (manifest points to a .png), and where the texture is used
in assets/manifest.json and assets/scripts.

No dependencies, nothing is modified.
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# SOF marker codes (DCT, progressive, lossless variants)
SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
STANDALONE = {0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9}


def jpeg_size(jpg: bytes):
    """Parse JPEG markers and return (width, height) from the first SOF, or None."""
    if len(jpg) < 4 or jpg[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 4 <= len(jpg):
        if jpg[i] != 0xFF:
            return None  # broken marker stream
        m = jpg[i + 1]
        if m in STANDALONE:
            i += 2
            continue
        if i + 4 > len(jpg):
            return None
        ln = struct.unpack(">H", jpg[i + 2:i + 4])[0]
        if m in SOF:
            # len, precision(1), height(2), width(2)
            if i + 2 + ln > len(jpg) or ln < 6:
                return None
            h, w = struct.unpack(">HH", jpg[i + 5:i + 9])
            return (w, h)
        i += 2 + ln
    return None


def check_tail(b: bytes):
    """Return (w, h, ok) for the alpha tail of file bytes b, or None if no tail."""
    if b[-2:] == b"\xff\xd9":        # plain jpeg, no tail
        return None
    if struct.unpack("<H", b[-2:])[0] != 0x6666:
        return None                  # unknown trailing data (not our format)
    n = struct.unpack("<I", b[-6:-2])[0]
    dmg = len(b) - n - 6
    if n == 0 or dmg <= 0:
        return (None, None, False)
    jpg = b[:dmg]
    size = jpeg_size(jpg)
    ok = (size is not None and n == size[0] * size[1]
          and jpg[-2:] == b"\xff\xd9")
    if size is None:
        return (None, None, False)
    return (size[0], size[1], ok)


def usages(stem: str):
    """Where is this texture used: manifest.json and assets/scripts/*."""
    hits = []
    mfile = ASSETS / "manifest.json"
    try:
        manifest = json.loads(mfile.read_text())
    except Exception as e:
        manifest = None
        hits.append(f"manifest.json: ошибка чтения ({e})")
    if manifest:
        for key, val in manifest.get("textures", {}).items():
            if Path(val).stem == stem or key.rsplit("/", 1)[-1] == stem:
                hits.append(f"manifest.json: {key} -> {val}")
    for f in sorted((ASSETS / "scripts").rglob("*")):
        if not f.is_file():
            continue
        try:
            text = f.read_bytes().decode("utf-8", "replace")
        except Exception:
            continue
        for ln, line in enumerate(text.splitlines(), 1):
            if stem + ".tga" in line.lower():
                hits.append(f"{f.relative_to(ROOT)}:{ln}")
    return hits


def main() -> None:
    rows = []
    for f in sorted(ASSETS.rglob("*.jpg")):
        b = f.read_bytes()
        tail = check_tail(b)
        if tail is None:
            continue
        w, h, ok = tail
        rel = f.relative_to(ASSETS / "textures").with_suffix("")
        extracted = False
        mfile = ASSETS / "manifest.json"
        png = ASSETS / "textures" / rel.with_suffix(".png")
        try:
            manifest = json.loads(mfile.read_text())
            val = manifest.get("textures", {}).get(rel.as_posix(), "")
            extracted = (val.endswith(".png") and (ROOT / val).exists()) or png.exists()
        except Exception:
            extracted = png.exists()
        rows.append((f, len(b), w, h, ok, extracted, usages(f.stem)))

    print(f"{'path':58} {'bytes':>9} {'size':>13} {'tail':>4} {'ok':>2} {'extracted':>9}")
    for f, sz, w, h, ok, extracted, _ in rows:
        size = f"{w}x{h}" if w else "?"
        print(f"{str(f.relative_to(ROOT)):58} {sz:>9} {size:>13}"
              f" {'+' if w else '?':>4} {'+' if ok else '-':>2} {'-' if not extracted else '+':>9}")
    print()

    unextracted = [(f, sz, w, h, ok, u) for f, sz, w, h, ok, extracted, u in rows if not extracted]
    print(f"Всего jpg с хвостом: {len(rows)}, не извлечённых: {len(unextracted)}")
    for f, sz, w, h, ok, u in unextracted:
        print(f"\n* {f.relative_to(ROOT)} ({w}x{h}, {sz} b, хвост {'валиден' if ok else 'НЕ ВАЛИДЕН'})")
        for x in u[:12]:
            print(f"    {x}")
        if len(u) > 12:
            print(f"    … и ещё {len(u) - 12}")
    if not unextracted:
        return
    sys.exit(0)  # read-only audit: не сигнализируем ошибку


if __name__ == "__main__":
    main()
