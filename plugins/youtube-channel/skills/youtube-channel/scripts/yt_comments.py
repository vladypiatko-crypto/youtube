#!/usr/bin/env python3
"""Read and answer comments.

  python yt_comments.py list [--days 14] [--max 200] [--include-handled]
  python yt_comments.py reply --parent <commentId> --text "…"
  python yt_comments.py mark --ids <id> [<id> …] --type question|feedback|idea|praise|spam|hostile|business|other
  python yt_comments.py moderate --id <commentId> --status heldForReview|rejected|published

`list` returns top-level comments the channel hasn't replied to and that aren't in
channel/comments/handled.json, newest first, as JSON.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone

from common import channel_dir, load_channel
from yt_api import my_channel, youtube


def handled_path():
    p = channel_dir() / "comments" / "handled.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_handled() -> dict:
    p = handled_path()
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def cmd_list(yt, args):
    cid = load_channel().get("channel_id") or my_channel(yt)["id"]
    handled = {} if args.include_handled else load_handled()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    out, token = [], None
    while len(out) < args.max:
        r = yt.commentThreads().list(part="snippet,replies", allThreadsRelatedToChannelId=cid, order="time",
                                     maxResults=100, pageToken=token, textFormat="plainText").execute()
        stop = False
        for th in r.get("items", []):
            top = th["snippet"]["topLevelComment"]
            s = top["snippet"]
            when = datetime.fromisoformat(s["publishedAt"].replace("Z", "+00:00"))
            if when < since:
                stop = True
                break
            if top["id"] in handled or s.get("authorChannelId", {}).get("value") == cid:
                continue
            replies = th.get("replies", {}).get("comments", [])
            if th["snippet"]["totalReplyCount"] > len(replies):
                replies = yt.comments().list(part="snippet", parentId=top["id"], maxResults=100, textFormat="plainText").execute()["items"]
            if any(c["snippet"].get("authorChannelId", {}).get("value") == cid for c in replies):
                continue
            out.append({"id": top["id"], "video_id": th["snippet"].get("videoId"), "author": s["authorDisplayName"],
                        "text": s["textDisplay"], "likes": s.get("likeCount", 0), "replies": th["snippet"]["totalReplyCount"],
                        "published": s["publishedAt"],
                        "other_replies": [c["snippet"]["textDisplay"][:200] for c in replies[:3]]})
            if len(out) >= args.max:
                break
        token = r.get("nextPageToken")
        if stop or not token:
            break
    ids = sorted({c["video_id"] for c in out if c["video_id"]})
    titles = {}
    for k in range(0, len(ids), 50):
        for v in yt.videos().list(part="snippet", id=",".join(ids[k:k + 50])).execute().get("items", []):
            titles[v["id"]] = v["snippet"]["title"]
    for c in out:
        c["video_title"] = titles.get(c["video_id"])
        c["url"] = f"https://www.youtube.com/watch?v={c['video_id']}&lc={c['id']}"
    print(json.dumps({"count": len(out), "comments": out}, indent=2, ensure_ascii=False))


def mark(ids, kind, extra=None):
    h = load_handled()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for i in ids:
        h[i] = {"type": kind, "at": now, **(extra or {})}
    handled_path().write_text(json.dumps(h, indent=1, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("list"); l.add_argument("--days", type=int, default=14); l.add_argument("--max", type=int, default=200)
    l.add_argument("--include-handled", action="store_true")
    r = sub.add_parser("reply"); r.add_argument("--parent", required=True); r.add_argument("--text", required=True)
    m = sub.add_parser("mark"); m.add_argument("--ids", nargs="+", required=True); m.add_argument("--type", default="other")
    mo = sub.add_parser("moderate"); mo.add_argument("--id", required=True)
    mo.add_argument("--status", required=True, choices=["heldForReview", "rejected", "published"])
    args = ap.parse_args()

    if args.cmd == "mark":
        mark(args.ids, args.type)
        print(f"marked {len(args.ids)}")
        return
    yt = youtube()
    if args.cmd == "list":
        cmd_list(yt, args)
    elif args.cmd == "reply":
        res = yt.comments().insert(part="snippet", body={"snippet": {"parentId": args.parent, "textOriginal": args.text}}).execute()
        mark([args.parent], "replied", {"reply_id": res["id"], "reply": args.text})
        print(json.dumps({"reply_id": res["id"], "parent": args.parent}))
    elif args.cmd == "moderate":
        yt.comments().setModerationStatus(id=args.id, moderationStatus=args.status).execute()
        mark([args.id], f"moderated:{args.status}")
        print(f"{args.id} -> {args.status}")


if __name__ == "__main__":
    main()
