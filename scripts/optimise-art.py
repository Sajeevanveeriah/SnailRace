#!/usr/bin/env python3
"""Re-encode the presentation art for the projector.

The runner and surprise art under public/art is drawn at about 300 px wide
at 1080p and 600 px at 4K, so each PNG becomes a WebP at most 768 px on its
long side (never upscaled), with its transparency kept. The club crest is
on every page, so it becomes a palette PNG at half size, which keeps the
same file name for the favicon and every reference.

Run from the repository root:  python3 scripts/optimise-art.py
Each run is idempotent: a file already at the target size and format is
left alone.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'public'
ART_DIRS = [ROOT / 'art' / 'snails', ROOT / 'art' / 'surprises']
CREST = ROOT / 'brand' / '20260403-NDCC-Logo-Bg-Removed-Rev00.png'
LONG_SIDE = 768
WEBP_QUALITY = 85
CREST_WIDTH = 592


def fit(image: Image.Image, long_side: int) -> Image.Image:
    w, h = image.size
    if max(w, h) <= long_side:
        return image
    scale = long_side / max(w, h)
    return image.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)


def to_webp(png: Path) -> tuple[int, int]:
    before = png.stat().st_size
    out = png.with_suffix('.webp')
    with Image.open(png) as image:
        rgba = fit(image.convert('RGBA'), LONG_SIDE)
        rgba.save(out, 'WEBP', quality=WEBP_QUALITY, method=6, exact=False)
    png.unlink()
    return before, out.stat().st_size


def crest() -> tuple[int, int]:
    before = CREST.stat().st_size
    with Image.open(CREST) as image:
        rgba = image.convert('RGBA')
        if rgba.width > CREST_WIDTH:
            rgba = rgba.resize((CREST_WIDTH, round(rgba.height * CREST_WIDTH / rgba.width)), Image.Resampling.LANCZOS)
        paletted = rgba.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        paletted.save(CREST, 'PNG', optimize=True)
    return before, CREST.stat().st_size


def main() -> int:
    total_before = total_after = 0
    for folder in ART_DIRS:
        for png in sorted(folder.glob('*.png')):
            before, after = to_webp(png)
            total_before += before
            total_after += after
            print(f'{png.relative_to(ROOT)} -> webp  {before:>9,} -> {after:>8,} bytes')
    if CREST.exists():
        before, after = crest()
        total_before += before
        total_after += after
        print(f'{CREST.relative_to(ROOT)}  {before:>9,} -> {after:>8,} bytes')
    print(f'total {total_before:,} -> {total_after:,} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
