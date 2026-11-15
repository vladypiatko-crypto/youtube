"""YouTube API auth helpers. Credentials live in channel/.secrets/ (client_secret.json, token.json)."""
from __future__ import annotations

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


def credentials():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        raise SystemExit("Missing libraries: pip install google-api-python-client google-auth-oauthlib")
    tok = secrets_dir() / "token.json"
    if not tok.exists():
        raise SystemExit(f"No YouTube token at {tok}. Run: python scripts/yt_auth.py (see references/setup.md)")
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
