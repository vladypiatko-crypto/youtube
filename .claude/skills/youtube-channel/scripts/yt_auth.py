#!/usr/bin/env python3
"""One-time YouTube sign-in. Needs channel/.secrets/client_secret.json (OAuth "Desktop app" client).

  python yt_auth.py              # opens a browser (or prints the link) and waits for the redirect
  python yt_auth.py --port 8765  # fixed port, handy behind SSH port-forwarding

Saves channel/.secrets/token.json and writes channel_id/handle into channel.json.
In a cloud session the localhost redirect can't reach this machine: run this script on your own
computer instead and copy token.json into channel/.secrets/.
"""
from __future__ import annotations

import argparse

from common import load_channel, save_channel
from yt_api import SCOPES, my_channel, secrets_dir, youtube


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        raise SystemExit("pip install google-api-python-client google-auth-oauthlib")
    cs = secrets_dir() / "client_secret.json"
    if not cs.exists():
        raise SystemExit(f"Put your OAuth client file at {cs} first (see references/setup.md).")
    flow = InstalledAppFlow.from_client_secrets_file(str(cs), SCOPES)
    creds = flow.run_local_server(port=args.port, open_browser=not args.no_browser,
                                  authorization_prompt_message="Open this link to sign in with the channel's Google account:\n{url}\n",
                                  prompt="consent", access_type="offline")
    (secrets_dir() / "token.json").write_text(creds.to_json())
    ch = my_channel(youtube())
    cfg = load_channel()
    cfg["channel_id"] = ch["id"]
    cfg.setdefault("name", ch["snippet"]["title"])
    if ch["snippet"].get("customUrl"):
        cfg["handle"] = ch["snippet"]["customUrl"]
    save_channel(cfg)
    print(f"Signed in. Channel: {ch['snippet']['title']} ({ch['id']}), "
          f"{ch['statistics'].get('subscriberCount', '?')} subscribers.")


if __name__ == "__main__":
    main()
