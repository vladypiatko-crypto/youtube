# Community: reading and answering comments

## Pull

```bash
python scripts/yt_comments.py list --days 14 --max 200 > channel/comments/new.json
```

Returns top-level comments on the channel's videos that the channel hasn't replied to yet and that aren't in `comments/handled.json`, with video title, author, text, likes, reply count and date.

## Triage

Sort each comment into one of these and act accordingly:

| Type | What to do |
|---|---|
| **question** (about the video/topic/channel) | Reply with a short, correct answer. If it needs more than 2–3 sentences, it's probably a video idea — reply briefly and add it to `ideas.md`. |
| **useful feedback / correction** | Thank them, acknowledge specifically. If they caught a real mistake, say so plainly and suggest a pinned correction to the user. Never argue. |
| **idea / request** | Add to `ideas.md` (with the comment link and like count). Reply if it's a good one ("adding this to the list"). |
| **praise** | Reply to some, not all — prioritise early comments, high-liked ones, and regulars. Short and genuine, never copy-paste the same line. |
| **hostile / troll** | Don't reply. Mention to the user only if it's harassment or a pile-on. |
| **spam / scam / impersonation** ("message me on Telegram", fake giveaways, "@channel-name" copycats) | Don't reply. List them for the user; with their OK, `yt_comments.py moderate --id … --status rejected`. |
| **business / collab / legal / personal or sensitive** (someone in distress, health, money, a dispute) | Never answer on your own. Summarise for the user. |

Rough priority when there are many: questions and corrections first, then comments with the most likes, then the newest videos (replies in the first 24–48 h help most).

## Writing replies

- In the channel's voice (`channel.json → persona`, `tone`, `language` — reply in the commenter's language when you can).
- Short: 1–2 sentences usually. Specific to what they said; no generic "Thanks for watching!".
- Accurate — if you're not sure, don't guess; flag it for the user.
- No promises on the user's behalf (upload dates, collabs, giveaways) and no links except the channel's own videos.
- Never pretend to be a human if asked directly; the user decides how they want to handle that, so flag such comments.

## Posting

- `reply_mode: "approve"` (default): show the user a compact list — comment → proposed reply — and post only the ones they approve (they can edit). 
- `reply_mode: "auto"`: post replies for questions, praise, ideas and feedback that fit the rules above; everything in the "never answer on your own" row still goes to the user. Report what was posted afterwards.

```bash
python scripts/yt_comments.py reply --parent <commentId> --text "…"
```

Then add every triaged comment id (replied or not) to `comments/handled.json` with its type, so the next run skips it:

```bash
python scripts/yt_comments.py mark --ids <id1> <id2> ... --type praise
```

## Report

End with a short summary: how many comments, how many replied, ideas added, things that need the user (with links). Keep it scannable.
