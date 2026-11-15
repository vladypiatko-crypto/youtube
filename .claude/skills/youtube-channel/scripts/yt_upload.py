#!/usr/bin/env python3
"""Upload a finished video with its publish pack.

  python yt_upload.py renders/final.mp4 --meta publish.json            # private, scheduled at publish_at
  python yt_upload.py renders/final.mp4 --meta publish.json --dry-run  # validate only

Default is private (+ scheduled if publish.json has publish_at), so nothing goes public by surprise.
--privacy public/unlisted only when the user explicitly asks to publish right away.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def build_body(meta: dict, privacy: str | None) -> tuple[dict, list[str]]:
    title = meta["title"].strip()
    desc = meta.get("description", "").strip()
    tags = [t for t in meta.get("tags", []) if t]
    problems = []
    if len(title) > 100:
        problems.append(f"title is {len(title)} chars (max 100)")
    if "<" in title + desc or ">" in title + desc:
        problems.append("title/description contain < or > (YouTube rejects them)")
    if len(desc.encode()) > 5000:
        problems.append("description over 5000 bytes")
    if sum(len(t) + 2 for t in tags) > 500:
        problems.append("tags over 500 characters total")
    hashtags = meta.get("hashtags", [])
    missing = [h for h in hashtags if h not in desc]
    if missing:
        desc = f"{desc}\n\n{' '.join(missing)}".strip()
    status = {"selfDeclaredMadeForKids": bool(meta.get("made_for_kids", False)),
              "containsSyntheticMedia": bool(meta.get("contains_synthetic_media", False))}
    publish_at = meta.get("publish_at")
    if privacy in (None, "private") and publish_at:
        when = datetime.fromisoformat(publish_at.replace("Z", "+00:00"))
        if when <= datetime.now(timezone.utc):
            problems.append(f"publish_at {publish_at} is in the past")
        status.update(privacyStatus="private", publishAt=when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    else:
        status["privacyStatus"] = privacy or "private"
    snippet = {"title": title, "description": desc, "tags": tags, "categoryId": str(meta.get("category_id", "22"))}
    if meta.get("default_language"):
        snippet["defaultLanguage"] = snippet["defaultAudioLanguage"] = meta["default_language"]
    return {"snippet": snippet, "status": status}, problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--meta", required=True)
    ap.add_argument("--privacy", choices=["private", "unlisted", "public"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    meta_path = Path(args.meta).resolve()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    body, problems = build_body(meta, args.privacy)
    if problems:
        sys.exit("Fix publish.json first:\n- " + "\n- ".join(problems))
    video = Path(args.video).resolve()
    if not video.exists():
        sys.exit(f"video not found: {video}")
    if args.dry_run:
        print(json.dumps(body, indent=2, ensure_ascii=False))
        return

    from googleapiclient.http import MediaFileUpload
    from yt_api import youtube
    yt = youtube()
    req = yt.videos().insert(part="snippet,status", body=body,
                             media_body=MediaFileUpload(str(video), chunksize=8 * 1024 * 1024, resumable=True))
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print(f"Uploading… {int(status.progress() * 100)}%", file=sys.stderr)
    vid = resp["id"]
    result = {"video_id": vid, "url": f"https://youtu.be/{vid}", "privacy": resp["status"]["privacyStatus"],
              "publish_at": resp["status"].get("publishAt")}

    thumb = meta.get("thumbnail")
    if thumb:
        tp = (meta_path.parent / thumb).resolve()
        if tp.exists():
            try:
                yt.thumbnails().set(videoId=vid, media_body=MediaFileUpload(str(tp))).execute()
                result["thumbnail"] = "set"
            except Exception as e:  # custom thumbnails need a verified channel
                result["thumbnail"] = f"failed: {e} (channel may need phone verification)"
    if meta.get("playlist_id"):
        yt.playlistItems().insert(part="snippet", body={"snippet": {
            "playlistId": meta["playlist_id"], "resourceId": {"kind": "youtube#video", "videoId": vid}}}).execute()
        result["playlist"] = meta["playlist_id"]
    meta["upload"] = result
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
