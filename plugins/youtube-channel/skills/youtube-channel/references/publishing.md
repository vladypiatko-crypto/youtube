# Publishing

## publish.json

```json
{
  "title_options": ["…", "…", "…"],
  "title": "the recommended one",
  "description": "full text, see below",
  "tags": ["…"],
  "hashtags": ["#…", "#…", "#…"],
  "category_id": "27",
  "default_language": "en",
  "made_for_kids": false,
  "contains_synthetic_media": false,
  "thumbnail": "thumbnail.png",
  "publish_at": "2026-11-18T17:00:00Z",
  "publish_at_local": "Wed 18 Nov, 18:00 Europe/Berlin",
  "timing_reason": "…",
  "playlist_id": null,
  "pinned_comment": "optional first comment to post and pin manually"
}
```

Common category ids: 1 Film & Animation, 2 Autos, 10 Music, 15 Pets & Animals, 17 Sports, 19 Travel, 20 Gaming, 22 People & Blogs, 23 Comedy, 24 Entertainment, 25 News & Politics, 26 Howto & Style, 27 Education, 28 Science & Technology.

## Title

Under ~60 characters so it isn't cut off. Specific and curiosity-driving, but the video must deliver what it says — misleading titles kill retention and trust. Front-load the interesting words; use the keyword people search for when it fits naturally. Write 3 genuinely different options (e.g. a question, a bold claim, a number) and recommend one with a reason. For Shorts, the title matters less; make it punchy.

## Description

1. First 1–2 lines: the hook restated with the main keyword — this is what shows in search and above "…more".
2. 2–4 sentences on what the video covers.
3. Chapters (long-form only): `0:00 Intro`-style, first one at 0:00, at least 3, each ≥10 s. Take timestamps from the final render's scene timings (assemble.py writes `renders/<name>.timings.json`).
4. Sources (from research.md) and credits (from `assets/CREDITS.md`).
5. Hashtags on the last line (3–5; the first three appear above the title). Shorts: include #shorts.

## Tags

10–15, mixing exact search phrases from research.md's keywords, broader topic terms, and the channel name. Keep the total under 500 characters. Tags matter little for ranking; don't over-think them.

## Thumbnail (long-form; optional for Shorts)

1280×720 PNG/JPG under 2 MB. One focal subject, 0–4 big words that add to the title rather than repeat it, strong contrast, readable at phone size, channel palette so it's recognisable in a feed. Build it like a visual card (HTML + Playwright screenshot or `scripts/card.py --size 1280x720`). Look at it scaled down to 320 px wide before calling it done. Offer the user 2 variants if they want to A/B test in Studio.

## When to upload

Pick a specific date and time and explain why in one or two sentences.

1. **If credentials exist:** `python scripts/yt_analytics.py summary` → top audience countries (→ their time zones) and the channel's own history of publish weekday/hour vs. first-week views. With ≥10 past videos, trust the channel's own pattern; with fewer, combine it with the defaults below.
2. **Defaults** (for an audience mostly in one region): publish 1–3 hours before that audience's evening peak, i.e. roughly 14:00–17:00 local time on weekdays, late morning on weekends. Thursday–Saturday tend to be strong for entertainment, weekdays for education/tech. Shorts are less sensitive to time.
3. Respect the cadence in channel.json — spacing uploads evenly beats posting two in a day.
4. Something topical (news, anniversary, season, a trend from research) beats any of the above.

Convert to UTC for `publish_at` and also show the user's local time (`channel.json → timezone`).

YouTube Studio shows "When your viewers are on YouTube"; the public API doesn't expose it. If the user can glance at that chart and tell you the peak, it beats any heuristic.

## Upload

After the user OKs the pack:

```bash
python scripts/yt_upload.py channel/videos/<slug>/renders/final.mp4 --meta channel/videos/<slug>/publish.json
```

It uploads as private with `publishAt` (scheduled), sets the thumbnail, and adds to a playlist if given. It prints the video id and URL — record them in `history.jsonl`. Without `publish_at` it stays private until the user publishes it in Studio (use `--privacy public` only if the user explicitly asks to publish immediately).
