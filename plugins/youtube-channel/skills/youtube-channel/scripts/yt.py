#!/usr/bin/env python3
"""One tool for everything YouTube: sign-in check, upload, privacy, comments, analytics.

  python yt.py status                                   # are we signed in? which channel? (no secrets printed)
  python yt.py upload VIDEO --meta publish.json [--privacy …] [--dry-run]
  python yt.py videos [--max 20]                        # recent uploads incl. private/scheduled, with stats
  python yt.py set-privacy VIDEO_ID private|unlisted|public [--publish-at 2026-11-20T17:00:00Z]
  python yt.py comments list|reply|mark|moderate …      # see yt_comments.py
  python yt.py analytics summary [--videos 30] [--tz …]   # see yt_analytics.py

Credentials: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN environment variables (cloud), or
channel/.secrets/token.json (local). Neither is ever written to git. See references/setup.md.
Uploads default to private (+ scheduled when publish.json has publish_at), so nothing goes public by surprise.
"""
from __future__ import annotations

import argparse
import json
import sys

DELEGATES = {"upload": "yt_upload", "comments": "yt_comments", "analytics": "yt_analytics"}
# videos.update(part=status) resets any writable field we leave out, so send all of them back.
WRITABLE_STATUS = ("privacyStatus", "publishAt", "embeddable", "license", "publicStatsViewable",
                   "selfDeclaredMadeForKids", "containsSyntheticMedia")


def cmd_status() -> None:
    from common import load_channel, save_channel
    from yt_api import credential_source, my_channel, youtube
    src = credential_source()
    if not src:
        sys.exit("Not signed in: no YT_* environment variables and no channel/.secrets/token.json. "
                 "See references/setup.md → 'YouTube API credentials'.")
    ch = my_channel(youtube())
    cfg = load_channel()
    if cfg and cfg.get("channel_id") != ch["id"]:
        cfg["channel_id"] = ch["id"]
        cfg["name"] = cfg.get("name") or ch["snippet"]["title"]
        cfg["handle"] = cfg.get("handle") or ch["snippet"].get("customUrl")
        save_channel(cfg)
    st = ch["statistics"]
    print(json.dumps({"signed_in": True, "credentials_from": src, "channel": ch["snippet"]["title"],
                      "channel_id": ch["id"], "handle": ch["snippet"].get("customUrl"),
                      "subscribers": st.get("subscriberCount"), "views": st.get("viewCount"),
                      "videos": st.get("videoCount")}, indent=2, ensure_ascii=False))


def cmd_videos(n: int) -> None:
    from yt_api import my_channel, youtube
    yt = youtube()
    uploads = my_channel(yt)["contentDetails"]["relatedPlaylists"]["uploads"]
    ids, token = [], None
    while len(ids) < n:
        r = yt.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=50, pageToken=token).execute()
        ids += [i["contentDetails"]["videoId"] for i in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    out = []
    for k in range(0, min(len(ids), n), 50):
        for v in yt.videos().list(part="snippet,status,statistics", id=",".join(ids[k:min(k + 50, n)])).execute()["items"]:
            out.append({"id": v["id"], "title": v["snippet"]["title"], "published": v["snippet"]["publishedAt"],
                        "privacy": v["status"]["privacyStatus"], "publish_at": v["status"].get("publishAt"),
                        "upload_status": v["status"].get("uploadStatus"),
                        "views": v["statistics"].get("viewCount"), "likes": v["statistics"].get("likeCount"),
                        "comments": v["statistics"].get("commentCount"), "url": f"https://youtu.be/{v['id']}"})
    print(json.dumps(out, indent=2, ensure_ascii=False))


def new_status(current: dict, privacy: str, publish_at: str | None) -> dict:
    status = {k: current[k] for k in WRITABLE_STATUS if k in current}
    status["privacyStatus"] = privacy
    status.pop("publishAt", None)
    if publish_at:
        if privacy != "private":
            raise SystemExit("--publish-at only works with private (YouTube makes it public at that time).")
        status["publishAt"] = publish_at
    return status


def cmd_set_privacy(video_id: str, privacy: str, publish_at: str | None) -> None:
    from yt_api import youtube
    yt = youtube()
    items = yt.videos().list(part="status", id=video_id).execute().get("items", [])
    if not items:
        sys.exit(f"No video {video_id} on this channel.")
    status = new_status(items[0]["status"], privacy, publish_at)
    res = yt.videos().update(part="status", body={"id": video_id, "status": status}).execute()
    print(json.dumps({"id": video_id, "privacy": res["status"]["privacyStatus"],
                      "publish_at": res["status"].get("publishAt")}, indent=2))


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in DELEGATES:
        name = sys.argv[1]
        mod = __import__(DELEGATES[name])
        sys.argv = [f"yt.py {name}", *sys.argv[2:]]
        mod.main()
        return
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="check sign-in and show the channel")
    for name, mod in DELEGATES.items():
        sub.add_parser(name, help=f"see {mod}.py")
    v = sub.add_parser("videos", help="recent uploads with privacy + stats")
    v.add_argument("--max", type=int, default=20)
    p = sub.add_parser("set-privacy", help="change a video's privacy or schedule it")
    p.add_argument("video_id")
    p.add_argument("privacy", choices=["private", "unlisted", "public"])
    p.add_argument("--publish-at", help="RFC3339 UTC time; with private, YouTube publishes it then")
    args = ap.parse_args()
    if args.cmd == "status":
        cmd_status()
    elif args.cmd == "videos":
        cmd_videos(args.max)
    elif args.cmd == "set-privacy":
        cmd_set_privacy(args.video_id, args.privacy, args.publish_at)


if __name__ == "__main__":
    main()
