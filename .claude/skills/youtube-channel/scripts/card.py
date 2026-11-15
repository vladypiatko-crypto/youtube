#!/usr/bin/env python3
"""Quick on-brand visual cards (scene frames or thumbnails) with Pillow.

  python card.py --out assets/s01.png --kind title  --text "Why is space dark?" --sub "It's not the reason you think"
  python card.py --out assets/s04.png --kind number --text "13.8 billion" --sub "years old"
  python card.py --out assets/s06.png --kind list   --text "Light|Distance|Expansion"
  python card.py --out thumbnail.png  --size 1280x720 --kind title --text "SPACE ISN'T EMPTY" --image assets/bg.jpg

Colours and font default to channel.json -> style.palette [background, text, accent] and style.font.
--image puts a photo behind the text (darkened). For anything fancier, build HTML and screenshot it.
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from common import load_channel


def find_font(name: str, bold: bool = True) -> str | None:
    if name and Path(name).exists():
        return name
    try:
        q = f"{name or 'sans'}:{'bold' if bold else 'regular'}"
        path = subprocess.run(["fc-match", "-f", "%{file}", q], capture_output=True, text=True).stdout.strip()
        return path or None
    except FileNotFoundError:
        return None


def load_font(path: str | None, size: int):
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    for n in ["DejaVuSans-Bold.ttf", "Arial Bold.ttf"]:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def fit(draw, text, font_path, max_w, max_h, start):
    size = start
    while size > 18:
        f = load_font(font_path, size)
        lines = wrap(draw, text, f, max_w)
        lh = int(size * 1.15)
        if len(lines) * lh <= max_h and all(draw.textlength(l, font=f) <= max_w for l in lines):
            return f, lines, lh
        size = int(size * 0.92)
    f = load_font(font_path, size)
    return f, wrap(draw, text, f, max_w), int(size * 1.15)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--kind", choices=["title", "number", "quote", "list", "text"], default="title")
    ap.add_argument("--text", required=True)
    ap.add_argument("--sub", default="")
    ap.add_argument("--size", default=None, help="WxH, default from --format")
    ap.add_argument("--format", choices=["shorts", "long"], default=None)
    ap.add_argument("--image", help="background photo")
    ap.add_argument("--bg"), ap.add_argument("--fg"), ap.add_argument("--accent"), ap.add_argument("--font")
    a = ap.parse_args()

    ch = load_channel()
    style = ch.get("style", {})
    pal = style.get("palette", ["#0B0F1A", "#F5F7FF", "#7C5CFF"]) + ["#FFFFFF"] * 3
    bg, fg, accent = hex2rgb(a.bg or pal[0]), hex2rgb(a.fg or pal[1]), hex2rgb(a.accent or pal[2])
    fmt = a.format or ("shorts" if ch.get("format") == "shorts" else "long")
    W, H = map(int, (a.size or ("1080x1920" if fmt == "shorts" else "1920x1080")).split("x"))
    font_path = find_font(a.font or style.get("font", ""))

    if a.image:
        im = Image.open(a.image).convert("RGB")
        scale = max(W / im.width, H / im.height)
        im = im.resize((int(im.width * scale) + 1, int(im.height * scale) + 1))
        l, t = (im.width - W) // 2, (im.height - H) // 2
        im = im.crop((l, t, l + W, t + H))
        im = Image.blend(im, Image.new("RGB", (W, H), (0, 0, 0)), 0.45)
    else:
        im = Image.new("RGB", (W, H), bg)
        glow = Image.new("RGB", (W, H), bg)
        gd = ImageDraw.Draw(glow)
        r = int(min(W, H) * 0.6)
        gd.ellipse([W * 0.75 - r, H * 0.2 - r, W * 0.75 + r, H * 0.2 + r], fill=tuple(int(b * 0.6 + c * 0.4) for b, c in zip(bg, accent)))
        im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(min(W, H) // 5)), 0.6)
    d = ImageDraw.Draw(im)
    margin = int(W * 0.08)
    max_w = W - 2 * margin
    vertical = H > W
    base = int(min(W, H) * (0.14 if a.kind == "number" else 0.09))

    if a.kind == "list":
        items = [s.strip() for s in a.text.split("|") if s.strip()]
        f = load_font(font_path, int(base * 0.8))
        lh = int(base * 1.3)
        y = int(H * (0.40 if vertical else 0.5)) - lh * len(items) // 2
        for i, it in enumerate(items, 1):
            d.ellipse([margin, y + lh * 0.1, margin + lh * 0.7, y + lh * 0.8], fill=accent)
            nf = load_font(font_path, int(base * 0.45))
            d.text((margin + lh * 0.35, y + lh * 0.45), str(i), font=nf, fill=bg, anchor="mm")
            d.text((margin + lh, y + lh * 0.45), it, font=f, fill=fg, anchor="lm")
            y += lh
    else:
        txt = f"“{a.text}”" if a.kind == "quote" else a.text
        main_h = int(H * (0.4 if vertical else 0.5))
        f, lines, lh = fit(d, txt, font_path, max_w, main_h, base)
        sub_f = load_font(font_path, max(int(base * 0.55), 24))
        sub_lines = wrap(d, a.sub, sub_f, max_w) if a.sub else []
        sub_lh = int(sub_f.size * 1.25) if sub_lines else 0
        block = len(lines) * lh + (int(lh * 0.4) + len(sub_lines) * sub_lh if sub_lines else 0)
        # Vertical: centre the block at 40% height so burned captions (lower third) never cover it.
        y = int(H * (0.40 if vertical else 0.5)) - block // 2
        color = accent if a.kind == "number" else fg
        for line in lines:
            d.text((W // 2, y), line, font=f, fill=color, anchor="ma", stroke_width=max(2, f.size // 30) if a.image else 0, stroke_fill=(0, 0, 0))
            y += lh
        if sub_lines:
            y += int(lh * 0.4)
            for line in sub_lines:
                d.text((W // 2, y), line, font=sub_f, fill=fg if a.kind == "number" else accent, anchor="ma")
                y += sub_lh
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    im.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
