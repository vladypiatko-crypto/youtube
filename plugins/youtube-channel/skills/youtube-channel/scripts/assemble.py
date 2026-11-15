#!/usr/bin/env python3
"""Render a video from scenes.json: per-scene visuals + narration, burned captions,
optional ducked music, loudness normalised to -14 LUFS, H.264/AAC MP4.

Usage: python assemble.py path/to/scenes.json --out path/to/renders/v1.mp4
Writes <out>.timings.json (scene start/end + text) next to the output — review_pack.py
and the chapter list in the description use it.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from pathlib import Path

from common import duration, fmt_ts, require_bin, run

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def ass_color(hex_color: str, alpha: int = 0) -> str:
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def chunk_words(text: str, n: int) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i + n]) for i in range(0, len(words), n)]


def build_ass(scenes: list[dict], cfg: dict, W: int, H: int) -> str:
    size = cfg.get("size", round(H * (0.04 if H > W else 0.055)))
    # Default: lower third. On vertical video that means ~30% up from the bottom, clear of the Shorts UI
    # and below the 35-45% band where cards put their main text.
    pos = cfg.get("position", "bottom")
    align = {"center": 5, "bottom": 2, "top": 8}.get(pos, 2)
    margin_v = cfg.get("margin_v", round(H * (0.30 if H > W else 0.08)) if pos == "bottom" else round(H * 0.08))
    style = (
        f"Style: Cap,{cfg.get('font', 'Inter')},{size},{ass_color(cfg.get('color', '#FFFFFF'))},"
        f"&H000000FF,{ass_color(cfg.get('outline', '#000000'))},&H80000000,"
        f"{-1 if cfg.get('bold', True) else 0},0,0,0,100,100,0,0,1,{cfg.get('outline_width', max(3, size // 14))},"
        f"{cfg.get('shadow', 2)},{align},60,60,{margin_v},1"
    )
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding",
        style, "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    n = int(cfg.get("words_per_chunk", 3 if H > W else 7))
    upper = cfg.get("uppercase", False)
    for sc in scenes:
        text = (sc.get("caption") if sc.get("caption") is not None else sc.get("text", "")).strip()
        if not text:
            continue
        chunks = chunk_words(text, n)
        span = sc["speech_dur"]
        weights = [max(len(c), 1) for c in chunks]
        total = sum(weights)
        t = sc["start"]
        for c, w in zip(chunks, weights):
            d = span * w / total
            safe = re.sub(r"[{}]", "", c).replace("\n", " ")
            if upper:
                safe = safe.upper()
            lines.append(f"Dialogue: 0,{ass_time(t)},{ass_time(t + d)},Cap,,0,0,0,,{safe}")
            t += d
    return "\n".join(lines) + "\n"


def motion_filter(motion: str, frames: int, W: int, H: int, fps: int) -> str:
    N = max(frames - 1, 1)
    zmax = 1.10
    center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if motion == "zoom_in":
        z, xy = f"z='1+{zmax - 1}*on/{N}'", center
    elif motion == "zoom_out":
        z, xy = f"z='{zmax}-{zmax - 1}*on/{N}'", center
    elif motion == "pan_right":
        z, xy = "z='1.06'", f"x='(iw-iw/zoom)*on/{N}':y='ih/2-(ih/zoom/2)'"
    elif motion == "pan_left":
        z, xy = "z='1.06'", f"x='(iw-iw/zoom)*(1-on/{N})':y='ih/2-(ih/zoom/2)'"
    else:
        z, xy = "z='1'", "x=0:y=0"
    # Upscale 2x before zoompan to avoid the integer-pixel jitter zoompan has at native size.
    return (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
            f"zoompan={z}:{xy}:d={frames}:s={W}x{H}:fps={fps},setsar=1,format=yuv420p")


def render_scene(sc: dict, base: Path, work: Path, W: int, H: int, fps: int, ffmpeg: str) -> Path:
    out = work / f"{sc['_idx']:03d}_v.mp4"
    dur = sc["dur"]
    frames = max(int(round(dur * fps)), 1)
    enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(fps), "-an"]
    vis = sc.get("visual")
    if not vis:
        color = sc.get("background", "#000000").lstrip("#")
        run([ffmpeg, "-y", "-f", "lavfi", "-i", f"color=c=0x{color}:s={W}x{H}:r={fps}", "-t", f"{dur:.3f}", *enc, str(out)])
        return out
    src = (base / vis).resolve()
    if not src.exists():
        raise SystemExit(f"Scene {sc.get('id')}: visual not found: {src}")
    if src.suffix.lower() in IMAGE_EXT:
        vf = motion_filter(sc.get("motion", "zoom_in"), frames, W, H, fps)
        run([ffmpeg, "-y", "-i", str(src), "-vf", vf, "-frames:v", str(frames), *enc, str(out)])
    else:
        vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
              f"fps={fps},format=yuv420p")
        start = float(sc.get("clip_start", 0))
        run([ffmpeg, "-y", "-stream_loop", "-1", "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{dur:.3f}",
             "-vf", vf, *enc, str(out)])
    return out


def render_audio(sc: dict, base: Path, work: Path, ffmpeg: str) -> Path:
    out = work / f"{sc['_idx']:03d}_a.wav"
    fmt = ["-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le"]
    if sc.get("audio"):
        run([ffmpeg, "-y", "-i", str((base / sc["audio"]).resolve()), "-af", "apad", "-t", f"{sc['dur']:.3f}", *fmt, str(out)])
    else:
        run([ffmpeg, "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{sc['dur']:.3f}", *fmt, str(out)])
    return out


def concat(files: list[Path], out: Path, work: Path, ffmpeg: str) -> None:
    lst = work / f"{out.stem}_list.txt"
    lst.write_text("".join(f"file '{f.name}'\n" for f in files))
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", out.name], cwd=work)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenes")
    ap.add_argument("--out", required=True)
    ap.add_argument("--crf", default="18")
    ap.add_argument("--keep-work", action="store_true")
    args = ap.parse_args()

    ffmpeg = require_bin("ffmpeg")
    require_bin("ffprobe")
    spec_path = Path(args.scenes).resolve()
    base = spec_path.parent
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    W, H = spec.get("resolution", [1920, 1080])
    fps = int(spec.get("fps", 30))
    pad = float(spec.get("padding", 0.25))
    scenes = spec["scenes"]
    if not scenes:
        raise SystemExit("scenes.json has no scenes")

    t = 0.0
    for i, sc in enumerate(scenes):
        sc["_idx"] = i
        if sc.get("audio"):
            ap_ = (base / sc["audio"]).resolve()
            if not ap_.exists():
                raise SystemExit(f"Scene {sc.get('id', i)}: audio not found: {ap_} (run tts.py first?)")
            speech = duration(ap_)
            sc["speech_dur"] = speech
            sc["dur"] = max(speech + pad, float(sc.get("duration", 0)))
        else:
            if "duration" not in sc:
                raise SystemExit(f"Scene {sc.get('id', i)} has no audio, so it needs a 'duration'")
            sc["dur"] = float(sc["duration"])
            sc["speech_dur"] = sc["dur"]
        sc["start"] = t
        t += sc["dur"]
    total = t

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="assemble_"))
    try:
        print(f"Rendering {len(scenes)} scenes, {fmt_ts(total)} at {W}x{H}@{fps} ...")
        vids = [render_scene(sc, base, work, W, H, fps, ffmpeg) for sc in scenes]
        auds = [render_audio(sc, base, work, ffmpeg) for sc in scenes]
        concat(vids, work / "video.mp4", work, ffmpeg)
        concat(auds, work / "voice.wav", work, ffmpeg)

        # Audio: voice (+ ducked music) -> loudnorm -14 LUFS.
        music = spec.get("music") or {}
        inputs = ["-i", "voice.wav"]
        if music.get("path"):
            mpath = (base / music["path"]).resolve()
            if not mpath.exists():
                raise SystemExit(f"music not found: {mpath}")
            inputs += ["-stream_loop", "-1", "-i", str(mpath)]
            vol = float(music.get("volume", 0.12))
            fade_out = max(total - 2.5, 0)
            mchain = f"[1:a]aresample=48000,volume={vol},afade=t=in:d=1.5,afade=t=out:st={fade_out:.2f}:d=2.5,atrim=0:{total:.3f}[m]"
            if music.get("duck", True):
                af = (f"[0:a]asplit=2[v][sc];{mchain};"
                      "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];"
                      "[v][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")
            else:
                af = f"{mchain};[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
        else:
            af = "[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]"
        run([ffmpeg, "-y", *inputs, "-filter_complex", af, "-map", "[a]", "-ar", "48000", "-c:a", "pcm_s16le", "mix.wav"], cwd=work)

        cap = spec.get("captions", {"enabled": True})
        if isinstance(cap, bool):
            cap = {"enabled": cap}
        vf = []
        if cap.get("enabled", True) and any((sc.get("text") or sc.get("caption")) for sc in scenes):
            (work / "captions.ass").write_text(build_ass(scenes, cap, W, H), encoding="utf-8")
            sub = "subtitles=captions.ass"
            if cap.get("fonts_dir"):
                fd = str((base / cap["fonts_dir"]).resolve()).replace(":", r"\:")
                sub += f":fontsdir='{fd}'"
            vf = ["-vf", sub]
        run([ffmpeg, "-y", "-i", "video.mp4", "-i", "mix.wav", *vf, "-map", "0:v", "-map", "1:a",
             "-c:v", "libx264", "-preset", "medium", "-crf", str(args.crf), "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)], cwd=work)

        timings = [{"id": sc.get("id", f"s{sc['_idx'] + 1:02d}"), "start": round(sc["start"], 3),
                    "end": round(sc["start"] + sc["dur"], 3), "start_ts": fmt_ts(sc["start"]),
                    "text": sc.get("text", ""), "visual": sc.get("visual")} for sc in scenes]
        tfile = out.with_suffix(".timings.json")
        tfile.write_text(json.dumps({"duration": round(total, 3), "resolution": [W, H], "fps": fps,
                                     "scenes": timings}, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Done: {out} ({fmt_ts(total)})\nTimings: {tfile}")
    finally:
        if args.keep_work:
            print(f"Work dir kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
