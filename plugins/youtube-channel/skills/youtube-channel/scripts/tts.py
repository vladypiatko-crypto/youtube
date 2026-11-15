#!/usr/bin/env python3
"""Generate narration per scene.

  python tts.py --scenes channel/videos/<slug>/scenes.json            # every scene with text -> audio/<id>.mp3
  python tts.py --scenes scenes.json --only s03 s07                     # just some scenes
  python tts.py --text "Hello there" --out test.mp3                     # one-off
  python tts.py --list-voices en-                                       # edge-tts voices starting with en-

Engine and voice come from channel.json -> voice, overridable with --engine/--voice/--rate.
Engines: edge (free, needs internet, `pip install edge-tts`), elevenlabs ($ELEVENLABS_API_KEY,
voice = voice id), openai ($OPENAI_API_KEY, voice = alloy/ash/coral/...),
flite (offline robot voice via ffmpeg — drafts/tests only).
Writes "audio": "audio/<id>.mp3" into each scene of scenes.json.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.request
from pathlib import Path

from common import load_channel


def _die(msg: str):
    raise SystemExit(msg)


def edge_tts_save(text: str, voice: str, rate: str, out: Path) -> None:
    try:
        import edge_tts
    except ImportError:
        raise SystemExit("edge-tts not installed: pip install edge-tts")
    # edge-tts pins certifi's CA list; behind a TLS-inspecting proxy (corporate networks, cloud sandboxes)
    # also trust the bundle named by SSL_CERT_FILE / REQUESTS_CA_BUNDLE.
    extra = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if extra and Path(extra).exists():
        import ssl
        import certifi
        from edge_tts import communicate
        ctx = ssl.create_default_context(cafile=certifi.where())
        ctx.load_verify_locations(cafile=extra)
        communicate._SSL_CTX = ctx

    async def go():
        await edge_tts.Communicate(text, voice, rate=rate or "+0%").save(str(out))
    try:
        asyncio.run(go())
    except Exception as e:
        raise SystemExit(f"edge-tts failed ({type(e).__name__}: {e}).\n"
                         "It needs internet access to speech.platform.bing.com. Alternatives: --engine elevenlabs/openai "
                         "with an API key, the user's own recording, or --engine flite for a robotic draft.")


def http_tts(url: str, headers: dict, body: dict, out: Path) -> None:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        out.write_bytes(r.read())


def synth(text: str, engine: str, voice: str, rate: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if engine == "edge":
        edge_tts_save(text, voice or "en-US-AndrewNeural", rate, out)
    elif engine == "elevenlabs":
        key = os.environ.get("ELEVENLABS_API_KEY") or _die("ELEVENLABS_API_KEY is not set")
        http_tts(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
                 {"xi-api-key": key},
                 {"text": text, "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")}, out)
    elif engine == "openai":
        key = os.environ.get("OPENAI_API_KEY") or _die("OPENAI_API_KEY is not set")
        http_tts("https://api.openai.com/v1/audio/speech", {"Authorization": f"Bearer {key}"},
                 {"model": os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"), "voice": voice or "alloy",
                  "input": text, "response_format": "mp3"}, out)
    elif engine == "flite":
        # Offline, robotic. Only for drafts/tests or when no network voice works; needs ffmpeg built with libflite.
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as tf:
            tf.write(text)
        res = subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=textfile={tf.name}:voice={voice or 'slt'}",
                              "-ar", "44100", str(out)], capture_output=True, text=True)
        os.unlink(tf.name)
        if res.returncode != 0:
            raise SystemExit("flite failed (ffmpeg needs --enable-libflite): " + res.stderr[-400:])
    else:
        raise SystemExit(f"unknown engine {engine}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--text")
    ap.add_argument("--out")
    ap.add_argument("--engine")
    ap.add_argument("--voice")
    ap.add_argument("--rate")
    ap.add_argument("--list-voices", metavar="PREFIX", nargs="?", const="")
    args = ap.parse_args()

    if args.list_voices is not None:
        import edge_tts
        voices = asyncio.run(edge_tts.list_voices())
        for v in voices:
            if v["ShortName"].startswith(args.list_voices):
                print(f"{v['ShortName']:32} {v['Gender']:7} {', '.join(v.get('VoiceTag', {}).get('VoicePersonalities', []))}")
        return

    vcfg = load_channel().get("voice", {})
    engine = args.engine or vcfg.get("tts_engine", "edge")
    voice = args.voice or vcfg.get("tts_voice", "")
    rate = args.rate or vcfg.get("rate", "+0%")

    if args.text:
        out = Path(args.out or "tts.mp3")
        synth(args.text, engine, voice, rate, out)
        print(out)
        return
    if not args.scenes:
        ap.error("give --scenes or --text")

    sp = Path(args.scenes).resolve()
    spec = json.loads(sp.read_text(encoding="utf-8"))
    for i, sc in enumerate(spec["scenes"]):
        sid = sc.setdefault("id", f"s{i + 1:02d}")
        text = (sc.get("narration") or sc.get("text") or "").strip()
        if not text or (args.only and sid not in args.only):
            continue
        rel = f"audio/{sid}.mp3"
        synth(text, engine, voice, rate, sp.parent / rel)
        sc["audio"] = rel
        print(f"{sid}: {rel}")
    sp.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
