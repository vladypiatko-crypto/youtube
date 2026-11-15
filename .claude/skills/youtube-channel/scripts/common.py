"""Shared helpers: locating the channel folder, running ffmpeg/ffprobe."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


def channel_dir() -> Path:
    """The channel/ folder: $CHANNEL_DIR, else the nearest channel/ walking up from cwd, else ./channel."""
    env = os.environ.get("CHANNEL_DIR")
    if env:
        return Path(env).resolve()
    here = Path.cwd().resolve()
    for p in [here, *here.parents]:
        if (p / "channel" / "channel.json").exists():
            return p / "channel"
    return here / "channel"


def load_channel() -> dict:
    f = channel_dir() / "channel.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    return {}


def save_channel(data: dict) -> None:
    f = channel_dir() / "channel.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def require_bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"{name} not found. Install ffmpeg (https://ffmpeg.org/download.html) and try again.")
    return path


def run(cmd: list[str], cwd: str | Path | None = None, quiet: bool = True) -> subprocess.CompletedProcess:
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        tail = "\n".join(res.stderr.strip().splitlines()[-25:])
        raise SystemExit(f"Command failed: {' '.join(cmd[:6])} ...\n{tail}")
    if not quiet:
        print(res.stdout)
    return res


def probe(path: str | Path) -> dict:
    res = run([require_bin("ffprobe"), "-v", "error", "-print_format", "json",
               "-show_format", "-show_streams", str(path)])
    return json.loads(res.stdout)


def duration(path: str | Path) -> float:
    return float(probe(path)["format"]["duration"])


def fmt_ts(seconds: float) -> str:
    seconds = max(0, seconds)
    m, s = divmod(int(round(seconds)), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
