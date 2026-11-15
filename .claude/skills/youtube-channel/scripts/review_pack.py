#!/usr/bin/env python3
"""Turn a render into something a (cheap, non-video) model can review.

  python review_pack.py renders/v1.mp4 --out review/r1 [--script script.md]

Writes to --out:
  summary.json    duration, resolution, loudness (LUFS, true peak), silences, black frames,
                  frozen stretches (same picture for a long time = pacing problem)
  hook_sheet.jpg  dense look at the opening (first 5 s for vertical/short videos, 15 s otherwise)
  sheet_01.jpg …  the whole video as timestamped contact sheets (12 frames each)
  transcript.md   narration per scene with timestamps (from <render>.timings.json), else the script
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from pathlib import Path

from common import fmt_ts, probe, require_bin, run

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Pillow is required: pip install pillow")


def font(size: int):
    for name in ["DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Arial.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def grab(ffmpeg: str, video: Path, t: float, out: Path, w: int) -> None:
    run([ffmpeg, "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", "-vf", f"scale={w}:-2", "-q:v", "3", str(out)])


def sheet(frames: list[tuple[float, Path]], cols: int, out: Path, title: str) -> None:
    ims = [Image.open(p).convert("RGB") for _, p in frames]
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    head = 40
    canvas = Image.new("RGB", (cols * w + (cols + 1) * 8, rows * h + (rows + 1) * 8 + head), (24, 24, 28))
    d = ImageDraw.Draw(canvas)
    d.text((10, 8), title, fill=(230, 230, 230), font=font(22))
    f = font(max(16, w // 14))
    for i, ((t, _), im) in enumerate(zip(frames, ims)):
        x = 8 + (i % cols) * (w + 8)
        y = head + 8 + (i // cols) * (h + 8)
        canvas.paste(im, (x, y))
        label = fmt_ts(t) if t >= 10 else f"0:{t:04.1f}"
        tb = d.textbbox((0, 0), label, font=f)
        d.rectangle([x, y, x + tb[2] + 12, y + tb[3] + 10], fill=(0, 0, 0))
        d.text((x + 6, y + 4), label, fill=(255, 220, 0), font=f)
    canvas.save(out, quality=88)


def analyse(ffmpeg: str, video: Path) -> dict:
    res = {}
    r = run([ffmpeg, "-hide_banner", "-nostats", "-i", str(video), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"])
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    m = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    res["integrated_lufs"] = float(m.group(1)) if m else None
    res["true_peak_dbfs"] = float(p.group(1)) if p and p.group(1) != "-inf" else None

    r = run([ffmpeg, "-hide_banner", "-nostats", "-i", str(video), "-af", "silencedetect=noise=-40dB:d=1.2", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", r.stderr)]
    durs = [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", r.stderr)]
    res["silences"] = [{"at": fmt_ts(s), "seconds": round(d, 1)} for s, d in zip(starts, durs)]

    r = run([ffmpeg, "-hide_banner", "-nostats", "-i", str(video), "-vf", "blackdetect=d=0.4:pix_th=0.08,freezedetect=n=0.002:d=5", "-an", "-f", "null", "-"])
    res["black_frames"] = [{"at": fmt_ts(float(a)), "seconds": round(float(b) - float(a), 1)}
                           for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", r.stderr)]
    fs = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    fd = [float(x) for x in re.findall(r"freeze_duration: ([\d.]+)", r.stderr)]
    res["frozen_over_5s"] = [{"at": fmt_ts(s), "seconds": round(d, 1)} for s, d in zip(fs, fd)]
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--script", help="script.md, used for the transcript if there is no timings file")
    args = ap.parse_args()

    ffmpeg = require_bin("ffmpeg")
    video = Path(args.video).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    info = probe(video)
    vs = next(s for s in info["streams"] if s["codec_type"] == "video")
    W, H = int(vs["width"]), int(vs["height"])
    dur = float(info["format"]["duration"])
    vertical = H > W
    shortish = vertical or dur <= 75
    thumb_w = 270 if vertical else 480

    tmp = Path(tempfile.mkdtemp(prefix="review_"))
    try:
        hook_len = min(5.0 if shortish else 15.0, dur)
        n_hook = 8 if shortish else 10
        hook = []
        for i in range(n_hook):
            t = hook_len * i / n_hook
            p = tmp / f"h{i:02d}.jpg"
            grab(ffmpeg, video, t, p, thumb_w)
            hook.append((t, p))
        sheet(hook, 4 if vertical else 5, out / "hook_sheet.jpg", f"HOOK: first {hook_len:.0f}s")

        step = 2.0 if shortish else max(5.0, dur / 60)
        times = [min(i * step, dur - 0.1) for i in range(int(dur // step) + 1)][:72]
        frames = []
        for i, t in enumerate(times):
            p = tmp / f"f{i:03d}.jpg"
            grab(ffmpeg, video, t, p, thumb_w)
            frames.append((t, p))
        per = 12
        cols = 6 if vertical else 4
        sheets = []
        for k in range(0, len(frames), per):
            name = f"sheet_{k // per + 1:02d}.jpg"
            chunk = frames[k:k + per]
            sheet(chunk, cols, out / name, f"{fmt_ts(chunk[0][0])} - {fmt_ts(chunk[-1][0])} (every {step:.0f}s)")
            sheets.append(name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    stats = analyse(ffmpeg, video)
    summary = {"file": str(video), "duration_s": round(dur, 2), "duration": fmt_ts(dur), "resolution": f"{W}x{H}",
               "vertical": vertical, "fps": vs.get("r_frame_rate"), "sheets": sheets, "frame_step_s": step,
               "hook_seconds": hook_len, **stats,
               "notes": "YouTube normalises to about -14 LUFS; silences > 1.2 s and frozen pictures > 5 s are listed."}
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    tfile = video.with_suffix(".timings.json")
    lines = [f"# Transcript — {video.name} ({fmt_ts(dur)})", ""]
    if tfile.exists():
        for sc in json.loads(tfile.read_text(encoding="utf-8"))["scenes"]:
            lines.append(f"**[{fmt_ts(sc['start'])}–{fmt_ts(sc['end'])}] {sc['id']}** — {sc.get('text') or '(no narration)'}")
            lines.append("")
    elif args.script and Path(args.script).exists():
        lines += ["(No timings file; this is the script, not a timed transcript.)", "", Path(args.script).read_text(encoding="utf-8")]
    else:
        lines.append("(No transcript available.)")
    (out / "transcript.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Review pack: {out}  ({len(sheets)} sheets + hook sheet, LUFS {stats['integrated_lufs']})")


if __name__ == "__main__":
    main()
