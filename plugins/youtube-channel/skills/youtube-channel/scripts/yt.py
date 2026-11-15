#!/usr/bin/env python3
"""One tool for everything YouTube: sign-in check, upload, privacy, comments, analytics.

  python yt.py status [--link]                          # signed in? which channel? --link binds channel.json to it
  python yt.py upload VIDEO --meta publish.json [--privacy …] [--dry-run]
  python yt.py videos [--max 20]                        # recent uploads incl. private/scheduled, with stats
  python yt.py set-privacy VIDEO_ID private|unlisted|public [--publish-at 2026-11-20T17:00:00Z]
  python yt.py comments list|reply|mark|moderate …      # see yt_comments.py
  python yt.py analytics summary [--videos 30] [--tz …]   # see yt_analytics.py
  python yt.py branding [--dry-run]                     # description, keywords, banner from channel/branding/branding.json

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


def cmd_status(link: bool) -> None:
    from common import load_channel, save_channel
    from yt_api import credential_source, my_channel, youtube
    src = credential_source()
    if not src:
        sys.exit("Not signed in: no YT_* environment variables and no channel/.secrets/token.json. "
                 "See references/setup.md → 'YouTube API credentials'.")
    ch = my_channel(youtube())
    cfg = load_channel()
    linked = cfg.get("channel_id")
    if link and cfg:
        cfg["channel_id"] = ch["id"]
        save_channel(cfg)
        linked = ch["id"]
    st = ch["statistics"]
    out = {"signed_in": True, "credentials_from": src, "channel": ch["snippet"]["title"],
           "channel_id": ch["id"], "handle": ch["snippet"].get("customUrl"),
           "subscribers": st.get("subscriberCount"), "views": st.get("viewCount"), "videos": st.get("videoCount"),
           "linked_channel_id": linked, "matches_channel_json": linked == ch["id"]}
    if linked != ch["id"]:
        out["warning"] = (f"Signed in as '{ch['snippet']['title']}', but channel.json is for '{cfg.get('name')}' "
                          f"({linked or 'not linked yet'}). Confirm with the user, then run: yt.py status --link")
    print(json.dumps(out, indent=2, ensure_ascii=False))


def guard() -> None:
    """Refuse write actions unless the signed-in channel is the one channel.json was linked to."""
    from common import load_channel
    from yt_api import my_channel, youtube
    linked = load_channel().get("channel_id")
    ch = my_channel(youtube())
    if linked != ch["id"]:
        sys.exit(f"Refusing: signed in as '{ch['snippet']['title']}' ({ch['id']}) but channel.json is linked to "
                 f"{linked or 'no channel'}. Check with the user, then link it with: yt.py status --link")


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


def merged_branding(current: dict, b: dict) -> dict:
    """channels.update resets brandingSettings fields we leave out, so start from the current values."""
    bs = {"channel": dict(current.get("channel", {})), "image": dict(current.get("image", {}))}
    if b.get("description"):
        bs["channel"]["description"] = b["description"]
    if b.get("keywords"):
        bs["channel"]["keywords"] = b["keywords"]
    if b.get("default_language"):
        bs["channel"]["defaultLanguage"] = b["default_language"]
    if b.get("country"):
        bs["channel"]["country"] = b["country"]
    return bs


def cmd_branding(path: str | None, dry_run: bool) -> None:
    """Apply channel/branding/branding.json: description, keywords, language and banner image.
    Profile picture, channel name and handle have no API; they're changed in YouTube Studio."""
    from pathlib import Path
    from common import channel_dir
    f = Path(path) if path else channel_dir() / "branding" / "branding.json"
    b = json.loads(f.read_text(encoding="utf-8"))
    banner = (f.parent / b["banner"]) if b.get("banner") else None
    if banner and not banner.exists():
        sys.exit(f"banner not found: {banner}")
    if dry_run:
        print(json.dumps({"would_set": {k: b.get(k) for k in ("description", "keywords", "default_language", "country")},
                          "banner": str(banner) if banner else None}, indent=2, ensure_ascii=False))
        return
    from googleapiclient.http import MediaFileUpload
    from yt_api import youtube
    yt = youtube()
    ch = yt.channels().list(part="brandingSettings", mine=True).execute()["items"][0]
    bs = merged_branding(ch.get("brandingSettings", {}), b)
    result = {"channel_id": ch["id"]}
    if banner:
        up = yt.channelBanners().insert(media_body=MediaFileUpload(str(banner), mimetype="image/png")).execute()
        bs["image"]["bannerExternalUrl"] = up["url"]
        result["banner"] = "uploaded"
    yt.channels().update(part="brandingSettings", body={"id": ch["id"], "brandingSettings": bs}).execute()
    result.update(description="set", keywords="set",
                  manual_in_studio="profile picture, channel name, handle (YouTube Studio → Customization)")
    print(json.dumps(result, indent=2))


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in DELEGATES:
        name = sys.argv[1]
        if name == "upload" and "--dry-run" not in sys.argv or name == "comments" and sys.argv[2:3] in (["reply"], ["moderate"]):
            guard()
        mod = __import__(DELEGATES[name])
        sys.argv = [f"yt.py {name}", *sys.argv[2:]]
        mod.main()
        return
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status", help="check sign-in and show the channel")
    st.add_argument("--link", action="store_true", help="link channel.json to the signed-in channel (ask the user first)")
    for name, mod in DELEGATES.items():
        sub.add_parser(name, help=f"see {mod}.py")
    v = sub.add_parser("videos", help="recent uploads with privacy + stats")
    v.add_argument("--max", type=int, default=20)
    p = sub.add_parser("set-privacy", help="change a video's privacy or schedule it")
    p.add_argument("video_id")
    p.add_argument("privacy", choices=["private", "unlisted", "public"])
    p.add_argument("--publish-at", help="RFC3339 UTC time; with private, YouTube publishes it then")
    br = sub.add_parser("branding", help="apply description, keywords and banner from branding.json")
    br.add_argument("--file", help="default: channel/branding/branding.json")
    br.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.cmd == "branding":
        if not args.dry_run:
            guard()
        cmd_branding(args.file, args.dry_run)
    elif args.cmd == "status":
        cmd_status(args.link)
    elif args.cmd == "videos":
        cmd_videos(args.max)
    elif args.cmd == "set-privacy":
        guard()
        cmd_set_privacy(args.video_id, args.privacy, args.publish_at)


if __name__ == "__main__":
    main()
