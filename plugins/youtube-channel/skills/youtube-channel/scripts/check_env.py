#!/usr/bin/env python3
"""What can this machine do? Run once per session before producing a video."""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess

from common import channel_dir


def has_mod(m: str) -> bool:
    return importlib.util.find_spec(m) is not None


def main() -> None:
    ok, warn = "OK  ", "--  "
    lines = []
    ff = shutil.which("ffmpeg")
    lines.append(f"{ok if ff else warn}ffmpeg {'found' if ff else 'MISSING - required for rendering'}")
    if ff:
        filters = subprocess.run([ff, "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        lines.append(f"{ok if ' subtitles ' in filters else warn}ffmpeg libass (burned captions){'' if ' subtitles ' in filters else ' MISSING - set captions.enabled=false or install a full ffmpeg build'}")
    lines.append(f"{ok if shutil.which('ffprobe') else warn}ffprobe")
    for mod, pkg, why in [("PIL", "pillow", "cards, thumbnails, review sheets"),
                          ("edge_tts", "edge-tts", "free AI voice"),
                          ("googleapiclient", "google-api-python-client", "upload/analytics/comments"),
                          ("google_auth_oauthlib", "google-auth-oauthlib", "YouTube sign-in"),
                          ("playwright", "playwright", "HTML -> PNG/clip visuals (optional)")]:
        lines.append(f"{ok if has_mod(mod) else warn}{pkg:26} {why}")
    lines.append(f"{ok if shutil.which('node') else warn}node (optional: Remotion / JS Playwright)")
    for k, why in [("ELEVENLABS_API_KEY", "ElevenLabs voice"), ("OPENAI_API_KEY", "OpenAI voice"),
                   ("PEXELS_API_KEY", "Pexels stock"), ("PIXABAY_API_KEY", "Pixabay stock/music")]:
        lines.append(f"{ok if os.environ.get(k) else warn}{k:26} {why}")
    cd = channel_dir()
    lines.append(f"{ok if (cd / 'channel.json').exists() else warn}channel.json at {cd} {'' if (cd / 'channel.json').exists() else '(run setup)'}")
    env_creds = all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"))
    tok = (cd / ".secrets" / "token.json").exists()
    src = "YT_* environment variables" if env_creds else "channel/.secrets/token.json" if tok else \
        "MISSING - set YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN or run yt_auth.py"
    lines.append(f"{ok if env_creds or tok else warn}YouTube sign-in (upload/analytics/comments): {src}")
    if env_creds or tok:
        lines.append("    verify it works with: python scripts/yt.py status")
    print("\n".join(lines))
    print("\nMissing something? Run scripts/setup.sh (Windows: scripts/setup.ps1) or /yt-setup.")


if __name__ == "__main__":
    main()
