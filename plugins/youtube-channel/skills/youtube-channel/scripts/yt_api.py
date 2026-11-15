"""YouTube API auth helpers.

Credentials come from, in order:
  1. Environment variables YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN. Best for cloud sessions:
     set them once in the environment's settings and every session can sign in, with nothing on disk
     or in git. Access tokens are refreshed in memory only.
  2. channel/.secrets/token.json, written by yt_auth.py on your own computer.
"""
from __future__ import annotations

import os
from pathlib import Path

from common import channel_dir

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",   # comments: read, reply, moderate
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]


def secrets_dir() -> Path:
    d = channel_dir() / ".secrets"
    d.mkdir(parents=True, exist_ok=True)
    return d


ENV_VARS = ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")
TOKEN_URI = "https://oauth2.googleapis.com/token"


def credential_source() -> str | None:
    """'env', 'token.json' or None. Never returns or prints the secret values themselves."""
    if all(os.environ.get(k) for k in ENV_VARS):
        return "env"
    if (channel_dir() / ".secrets" / "token.json").exists():
        return "token.json"
    return None


def credentials():
    try:
        from google.auth.exceptions import RefreshError
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        raise SystemExit("Missing libraries: pip install google-api-python-client google-auth-oauthlib")
    if credential_source() == "env":
        # No scopes passed: the refresh returns exactly what the account granted.
        creds = Credentials(token=None, refresh_token=os.environ["YT_REFRESH_TOKEN"], token_uri=TOKEN_URI,
                            client_id=os.environ["YT_CLIENT_ID"], client_secret=os.environ["YT_CLIENT_SECRET"])
        try:
            creds.refresh(Request())
        except RefreshError as e:
            reason = str(e.args[0] if e.args else e).split(":")[0]  # error code only, never the token
            raise SystemExit(f"YouTube sign-in from YT_* environment variables failed ({reason}). "
                             "The refresh token may be expired or revoked (apps left in 'Testing' expire it "
                             "after 7 days), or the client ID/secret don't match. See references/setup.md.")
        return creds
    tok = secrets_dir() / "token.json"
    if not tok.exists():
        missing = [k for k in ENV_VARS if not os.environ.get(k)]
        raise SystemExit(f"No YouTube credentials. Set {', '.join(missing)} in the environment settings "
                         f"(cloud), or run scripts/yt_auth.py to create {tok} (see references/setup.md).")
    creds = Credentials.from_authorized_user_file(str(tok), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            tok.write_text(creds.to_json())
        else:
            raise SystemExit("YouTube token is invalid. Re-run: python scripts/yt_auth.py")
    return creds


def youtube():
    from googleapiclient.discovery import build
    return build("youtube", "v3", credentials=credentials(), cache_discovery=False)


def analytics():
    from googleapiclient.discovery import build
    return build("youtubeAnalytics", "v2", credentials=credentials(), cache_discovery=False)


def my_channel(yt) -> dict:
    items = yt.channels().list(part="snippet,contentDetails,statistics", mine=True).execute().get("items", [])
    if not items:
        raise SystemExit("This Google account has no YouTube channel.")
    return items[0]
