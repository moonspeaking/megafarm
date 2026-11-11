#!/usr/bin/env python3
"""Read-only analysis of the alpha tails embedded in the original .jpg textures.

Task 17 (docs/open-questions.md) listed 31 textures whose tail
[jpeg FFD9][w*h alpha][u32 count][0x6666] was not extracted.  Later 28 of them
were extracted (see tools/extract_jpg_alpha.py EXTRA), 3 are still raw.
The tails are still inside every .jpg, so this script reads the alpha bytes
straight from the files (assets/ is never modified) and classifies each texture:

    opaque  - alpha is all 255, extraction is pointless
    mask    - binary 0/255 alpha (hard-edged shape, colour-key would work)
    soft    - semi-transparent values present (shadows / antialiasing)
    empty   - alpha effectively unused (all 0)

For each texture: share of 255 / 0 / mid values, bbox of alpha > 0, soft-edge
signature (mid pixels touching both 0 and 255 = antialiased edge; mid pixels
surrounded by mid = soft region) and, if PIL is available, correlation between
alpha and jpeg luminance (does the shape follow dark pixels?).

Usage:
    python3 tools/analyze_jpg_alpha.py            # the 31 textures of task 17
    python3 tools/analyze_jpg_alpha.py --all      # every jpg with a tail (60)
    python3 tools/analyze_jpg_alpha.py --preview DIR   # also save png previews
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from find_jpg_alpha import check_tail  # tail parser, same rules as the audit

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# The 31 of task 17 = every jpg with a tail EXCEPT the ones already extracted
# in the first batch (menu/, gamecomics/, decor, *_bed_lr/*_bed_ud).
EXCLUDED = {"gameplay/gamefield/decor"}


def target_set(all_files: bool):
    rows = []
    for f in sorted(ASSETS.rglob("*.jpg")):
        w, h, ok = check_tail(f.read_bytes()) or (None, None, False)
        if not w or not ok:
            continue
        rel = f.relative_to(ASSETS / "textures").with_suffix("").as_posix()
        if not all_files:
            if rel in EXCLUDED:
                continue
            if rel.startswith(("menu/", "gamecomics/")):
                continue
            if rel.endswith(("_bed_lr", "_bed_ud")):
                continue
        rows.append((rel, f, w, h))
    return rows


def bbox(alpha: bytes, w: int, h: int):
    """Bounding box of alpha > 0, or None."""
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = alpha[y * w:(y + 1) * w]
        if row.count(0) == w:
            continue
        if miny == h:
            miny = y
        maxy = y
        for x in range(w):
            if row[x]:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
    if maxx < 0:
        return None
    return (minx, miny, maxx, maxy)


def edge_signature(alpha: bytes, w: int, h: int):
    """Count mid pixels touching both 0 and 255 (antialiased edge) vs mid-only
    neighbourhoods (large soft region)."""
    edge = soft = 0
    for y in range(h):
        row = alpha[y * w:(y + 1) * w]
        for x in range(w):
            a = row[x]
            if not 0 < a < 255:
                continue
            neigh = []
            if x:
                neigh.append(row[x - 1])
            if x < w - 1:
                neigh.append(row[x + 1])
            if y:
                neigh.append(alpha[(y - 1) * w + x])
            if y < h - 1:
                neigh.append(alpha[(y + 1) * w + x])
            has0 = any(n == 0 for n in neigh)
            has255 = any(n == 255 for n in neigh)
            if has0 and has255:
                edge += 1
            elif not has0 and not has255 and neigh:
                soft += 1
    return edge, soft


def luminance_corr(alpha: bytes, f: Path, n: int):
    """Pearson r between alpha and jpeg luminance over pixels with alpha != 255.
    Needs PIL; returns None if unavailable or the shape is trivial."""
    try:
        from PIL import Image
        import io
        b = f.read_bytes()
        jpg_len = len(b) - n - 6
        im = Image.open(io.BytesIO(b[:jpg_len])).convert("L")
    except Exception:
        return None
    if im.size[0] * im.size[1] != n:
        return None
    lum = im.tobytes()
    sa = sl = saa = sll = sal = k = 0
    for i in range(n):
        a = alpha[i]
        if a == 255:
            continue
        l = lum[i]
        k += 1
        sa += a
        sl += l
        saa += a * a
        sll += l * l
        sal += a * l
    if k < 2:
        return None
    da = saa - sa * sa / k
    dl = sll - sl * sl / k
    if da <= 0 or dl <= 0:
        return None
    return (sal - sa * sl / k) / (da * dl) ** 0.5


def classify(n255: int, n0: int, nmid: int, n: int):
    t255, t0, tmid = n255 / n, n0 / n, nmid / n
    if t255 + tmid < 0.0005 and t0 > 0.9995:
        return "empty", t255, t0, tmid
    if t0 + tmid < 0.001:          # < 0.1% of anything but 255
        return "opaque", t255, t0, tmid
    if tmid / max(t0 + tmid + t255, 1e-9) < 0.005:   # < 0.5% semi tones
        return "mask", t255, t0, tmid
    return "soft", t255, t0, tmid


def preview(rel: str, alpha: bytes, w: int, h: int, jpg: bytes, out: Path):
    """RGBA composite over a checkerboard + the alpha channel itself."""
    from PIL import Image, ImageDraw
    import io
    im = Image.open(io.BytesIO(jpg)).convert("RGB")
    if im.size != (w, h):
        return
    a = Image.frombytes("L", (w, h), alpha)
    im.putalpha(a)
    bg = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(bg)
    step = max(8, min(w, h) // 8)
    for y in range(0, h, step):
        for x in range(0, w, step):
            if (x // step + y // step) % 2:
                d.rectangle((x, y, min(x + step, w) - 1, min(y + step, h) - 1), fill=200)
    bg.paste(im, (0, 0), a)
    name = rel.replace("/", "_")
    out.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out / f"{name}__composite.png")
    a.save(out / f"{name}__alpha.png")


def main():
    argv = sys.argv[1:]
    all_files = "--all" in argv
    pdir = None
    if "--preview" in argv:
        pdir = Path(argv[argv.index("--preview") + 1])

    rows = []
    for rel, f, w, h in target_set(all_files):
        b = f.read_bytes()
        n = struct.unpack("<I", b[-6:-2])[0]
        jpg = b[:len(b) - n - 6]
        alpha = b[len(b) - n - 6:len(b) - 6]
        hist = [0] * 256
        for v in alpha:
            hist[v] += 1
        n255, n0 = hist[255], hist[0]
        nmid = n - n255 - n0
        kind, t255, t0, tmid = classify(n255, n0, nmid, n)
        distinct = sum(1 for c in hist if c)
        box = bbox(alpha, w, h)
        edge, soft = edge_signature(alpha, w, h)
        corr = luminance_corr(alpha, f, n)
        # состояние порта: извлечена ли альфа в .png
        png = ASSETS / "textures" / (rel + ".png")
        manifest = json.loads((ASSETS / "manifest.json").read_text())
        extracted = (manifest.get("textures", {}).get(rel, "").endswith(".png")
                     and png.exists())
        rows.append(dict(rel=rel, w=w, h=h, kind=kind, t255=t255, t0=t0, tmid=tmid,
                         distinct=distinct, box=box, edge=edge, soft=soft,
                         corr=corr, extracted=extracted, file=f, jpg=jpg,
                         alpha=alpha))
        if pdir:
            preview(rel, alpha, w, h, jpg, pdir)

    kpng = lambda r: ("extracted→png" if r["extracted"] else "raw .jpg")
    print(f"{'texture':50} {'size':>9} {'type':>6} {'%255':>6} {'%0':>6} {'%mid':>6} "
          f"{'#val':>5} {'edge':>6} {'soft':>6} {'r(a,L)':>7}  port")
    for r in rows:
        box = (f"({r['box'][0]},{r['box'][1]})-({r['box'][2]},{r['box'][3]})"
               if r["box"] else "-")
        corr = f"{r['corr']:+.2f}" if r["corr"] is not None else "  -"
        print(f"{r['rel']:50} {str(r['w'])+'x'+str(r['h']):>9} {r['kind']:>6} "
              f"{r['t255']*100:6.2f} {r['t0']*100:6.2f} {r['tmid']*100:6.2f} "
              f"{r['distinct']:>5} {r['edge']:>6} {r['soft']:>6} {corr:>7}  {kpng(r)}"
              f"   bbox={box}")

    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"\nИтого: {len(rows)} текстур: " +
          ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())))
    sys.exit(0)  # read-only audit


if __name__ == "__main__":
    main()
