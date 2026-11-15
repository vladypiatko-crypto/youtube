#!/usr/bin/env python3
"""Channel analytics for deciding what to make and when to post.

  python yt_analytics.py summary [--videos 30] [--tz Europe/Berlin]

Prints JSON: channel totals, last-28-day trend, top countries, per-video stats
(views, watch time, avg view %, subs gained, first-7-day views) and first-week views
grouped by publish weekday and hour in the given time zone.
Note: the public API has no "when your viewers are online" data; that chart is Studio-only.
"""
from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from common import load_channel
from yt_api import analytics, my_channel, youtube


def q(ya, **kw):
    r = ya.reports().query(ids="channel==MINE", **kw).execute()
    cols = [h["name"] for h in r.get("columnHeaders", [])]
    return [dict(zip(cols, row)) for row in r.get("rows", [])]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["summary"])
    ap.add_argument("--videos", type=int, default=30)
    ap.add_argument("--tz", default=None)
    args = ap.parse_args()
    tz = ZoneInfo(args.tz or load_channel().get("timezone") or "UTC")

    yt, ya = youtube(), analytics()
    ch = my_channel(yt)
    today = date.today()
    start_all = ch["snippet"]["publishedAt"][:10]

    uploads = ch["contentDetails"]["relatedPlaylists"]["uploads"]
    vids, token = [], None
    while len(vids) < args.videos:
        r = yt.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=50, pageToken=token).execute()
        vids += [i["contentDetails"]["videoId"] for i in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    vids = vids[:args.videos]
    meta = {}
    for k in range(0, len(vids), 50):
        for v in yt.videos().list(part="snippet,contentDetails,statistics", id=",".join(vids[k:k + 50])).execute()["items"]:
            meta[v["id"]] = v

    per_video = {r["video"]: r for r in q(ya, startDate=start_all, endDate=str(today), dimensions="video",
                 metrics="views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments",
                 sort="-views", maxResults=200)}

    rows, by_day, by_hour = [], defaultdict(list), defaultdict(list)
    for vid in vids:
        m = meta.get(vid)
        if not m:
            continue
        pub = datetime.fromisoformat(m["snippet"]["publishedAt"].replace("Z", "+00:00")).astimezone(tz)
        first_week = None
        if (today - pub.date()).days >= 7:
            fw = q(ya, startDate=str(pub.date()), endDate=str(pub.date() + timedelta(days=6)), metrics="views", filters=f"video=={vid}")
            first_week = int(fw[0]["views"]) if fw else 0
            by_day[pub.strftime("%A")].append(first_week)
            by_hour[pub.hour].append(first_week)
        s = per_video.get(vid, {})
        rows.append({"id": vid, "title": m["snippet"]["title"], "published_local": pub.strftime("%a %Y-%m-%d %H:%M"),
                     "duration": m["contentDetails"]["duration"], "views": int(m["statistics"].get("viewCount", 0)),
                     "first_7d_views": first_week, "avg_view_pct": s.get("averageViewPercentage"),
                     "avg_view_s": s.get("averageViewDuration"), "watch_min": s.get("estimatedMinutesWatched"),
                     "subs_gained": s.get("subscribersGained"), "likes": s.get("likes"), "comments": s.get("comments")})

    def agg(d):
        return {str(k): {"videos": len(v), "median_first_7d_views": statistics.median(v)} for k, v in sorted(d.items(), key=lambda x: str(x[0]))}

    out = {
        "channel": {"title": ch["snippet"]["title"], "id": ch["id"], **{k: ch["statistics"].get(k) for k in ("subscriberCount", "viewCount", "videoCount")}},
        "last_28_days": q(ya, startDate=str(today - timedelta(days=28)), endDate=str(today),
                          metrics="views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewPercentage"),
        "top_countries": q(ya, startDate=str(today - timedelta(days=90)), endDate=str(today), dimensions="country",
                           metrics="views,estimatedMinutesWatched", sort="-views", maxResults=10),
        "age_gender": q(ya, startDate=str(today - timedelta(days=90)), endDate=str(today), dimensions="ageGroup,gender",
                        metrics="viewerPercentage"),
        "videos": rows,
        "first_week_by_weekday": agg(by_day),
        "first_week_by_hour_local": agg(by_hour),
        "timezone": str(tz),
        "caveat": "Few videos = noisy patterns; topic and title usually matter more than posting time.",
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
