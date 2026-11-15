---
name: youtube-channel
description: Runs a YouTube channel end to end — first-time channel setup (niche, style, voice, format), topic research with a cheap subagent, scripting and rendering the actual video file, an independent low-cost judge subagent that rates it and forces revisions until it scores 8+/10 (max 3 rounds), then the full publish pack (title, description, tags, hashtags, chapters, thumbnail, best upload date/time from analytics) and channel management (reading comments, replying to the ones that matter, pulling ideas from them). Use this skill whenever the user wants to make, plan, script, render, review or upload a YouTube video or Short, set up or rebrand a channel, figure out when to post, write titles/descriptions/tags, or check/answer/manage YouTube comments — even if they just say "make the next video", "do a video about X", "what should I post" or "check my comments".
---

# YouTube Channel

You are the showrunner for one YouTube channel. You keep the channel's identity consistent, make videos that are actually good (not just "a video exists"), and look after the audience afterwards. Expensive thinking (creative direction, script, fixing problems) stays with you; cheap, parallelisable work (web research, judging a render) goes to low-cost subagents.

## Where everything lives

All channel state lives in a `channel/` folder at the project root (create it on first run). Read `channel/channel.json` before doing anything else — it is the channel's memory and keeps every video on-brand.

```
channel/
├── channel.json          # identity, style, format, voice, models, reply mode (see references/setup.md)
├── ideas.md              # backlog: ideas from research, comments, analytics
├── history.jsonl         # one line per video: slug, title, topic, score, publish time, video id
├── comments/handled.json # comment ids already triaged, so nothing is answered twice
├── .secrets/             # client_secret.json + token.json for the YouTube API — never commit
└── videos/<YYYY-MM-DD>-<slug>/
    ├── research.md  script.md  scenes.json  publish.json  thumbnail.png
    ├── assets/  audio/  review/
    ├── judge-r1.json  judge-r2.json ...
    └── renders/v1.mp4  v2.mp4 ...  final.mp4
```

Add `channel/.secrets/` to `.gitignore` the first time you create it. Large renders and assets are also worth ignoring (`channel/videos/*/renders/`, `*/assets/`, `*/audio/`) unless the user wants them in git.

Scripts are in `scripts/` next to this file; every `python scripts/…` command in this skill means that path. Run them with the skill's virtualenv: `~/.claude/youtube-channel/venv/bin/python` (Windows: `%USERPROFILE%\.claude\youtube-channel\venv\Scripts\python.exe`). If it doesn't exist yet, run `bash scripts/setup.sh` (Windows: `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`) first. It installs ffmpeg, Python and the packages, and the `/yt-setup` command does the same. Run `python scripts/check_env.py` once per session before producing anything; it tells you what's installed (ffmpeg, TTS, API libraries, credentials) so you pick a production path that will actually work instead of discovering it halfway through.

Everything that talks to YouTube goes through one entry point, `python scripts/yt.py` (`status`, `upload`, `videos`, `set-privacy`, `comments …`, `analytics summary`). It signs in from the `YT_CLIENT_ID` / `YT_CLIENT_SECRET` / `YT_REFRESH_TOKEN` environment variables (cloud sessions) or `channel/.secrets/token.json` (local). Run `yt.py status` before any upload, comment or analytics work. Never print, log or commit those values.

## Decide what the user wants

| The user says something like… | Go to |
|---|---|
| no `channel/channel.json` exists yet, or "set up / rebrand my channel" | **Setup** |
| "make a video", "next video", "video about X", "a Short on Y" | **Make a video** (setup first if needed) |
| "check my comments", "reply to people", "manage the channel" | **Community** |
| "when should I post", "title for this", "write a description" | the matching part of **Publish** |
| "how is the channel doing", "what should I make next" | **Analytics & ideas** |

## Setup (first time only)

Read `references/setup.md`. The short version: collect the channel's identity (niche, audience, language, format, visual style, voice, tone, upload cadence, reply mode), but only ask about what the user hasn't already told you — if they wrote "a faceless science channel for teens, Shorts, chill vibe" you already have four answers. Ask the remaining questions in one batch with AskUserQuestion, offering concrete options with a recommended default, so setup takes one round trip, not ten. Save `channel/channel.json`, then confirm the setup back in two or three lines.

If they want uploads, analytics or comment management, walk them through YouTube API credentials (also in `references/setup.md`). Everything else works without credentials — the skill then hands over the finished files and publish pack for manual upload.

## Make a video

Create the video folder `channel/videos/<YYYY-MM-DD>-<slug>/` and work through the stages below. Tell the user briefly what stage you're on — a video takes a while and silence feels like being stuck.

### 1. Topic

If the user gave a topic, use it. If not, propose three from `ideas.md`, analytics, and the channel's niche, with a one-line angle for each, and let them pick (recommend one).

### 2. Research — subagent (low cost)

Spawn a research subagent with the Agent tool, `model` set to `channel.json → models.research` (default `"sonnet"`; `"haiku"` if the user chose budget mode). Fill in the prompt template in `references/research-agent.md`. It checks whether this video already exists on YouTube (and how well those versions did), finds the gap or angle worth taking, gathers facts with sources, and suggests hooks and keywords. It writes `research.md` in the video folder.

Read it critically when it returns. If the topic is saturated and there's no angle, say so and suggest a pivot rather than making a weaker copy of an existing video — that's the most valuable thing research can tell you.

### 3. Script & storyboard — you

Write `script.md` and `scenes.json` yourself; this is where quality is decided, so don't delegate it. Follow `references/production.md` for structure: a hook in the first 5 seconds (Shorts) or 15 seconds (long-form) that promises a payoff, retention beats every ~30–60 s, one idea per scene, a clear ending (no "that's it for today" fade-out). Stay in the channel's voice and tone. Every factual claim must trace back to `research.md`.

### 4. Produce — you, with scripts

Follow the pipeline in `references/production.md` that matches the channel's style: narration with `scripts/tts.py` (or the user's own recording), visuals (generated graphics, the user's footage, or properly licensed stock), then `scripts/assemble.py scenes.json` to render `renders/v1.mp4` with captions, music ducking and loudness normalised to YouTube's −14 LUFS.

### 5. Judge loop — subagent (lower cost), max 3 rounds

Ratings from the model that made the video are worthless — it knows what it *meant*. So the judge is a separate, cheap agent that only sees the output.

For round `r` = 1, 2, 3:

1. `python scripts/review_pack.py renders/v<r>.mp4 --out review/r<r>` — extracts contact sheets, a dense look at the hook, the transcript, loudness/silence/black-frame stats.
2. Spawn a **fresh** judge subagent with `model` = `models.judge` (default `"haiku"`), using the prompt in `references/judge-agent.md`. Fresh each round, so it doesn't grade on a curve; give it the previous round's must-fix list only so it can check those were fixed. It writes `judge-r<r>.json` with per-criterion scores, an overall score and concrete fixes.
3. If `overall ≥ 8` and there are no `must_fix` items: copy that render to `renders/final.mp4` and move on.
4. Otherwise, fix what the judge found — re-write, re-voice, re-cut, whatever it takes, not just cosmetic tweaks — render `v<r+1>.mp4` and go again.

If it still isn't 8+ after round 3, stop looping. Pick the best-scoring render, show the user the score and the remaining issues, and ask whether to ship it, let you take one more pass, or change direction. Three rounds is a cost cap the user set; don't silently exceed it.

Sanity-check the judge too: if it complains about something that's plainly not in the video, or its scores contradict its own notes, discard that point and say so. A cheap judge can be wrong.

### 6. Publish pack

Read `references/publishing.md` and write `publish.json` + `thumbnail.png`: 3 title options (recommend one), description with hook line, chapters for long-form, sources, hashtags (3–5), tags, category, made-for-kids flag, AI/synthetic-media disclosure where it applies, and the recommended upload date/time with the reasoning (from `scripts/yt_analytics.py` when credentials exist, else from research and the audience's time zones).

### 7. Upload

Show the user the publish pack and the final video path, then **ask before uploading** — publishing is public and hard to undo. On a yes, `scripts/yt_upload.py` uploads it as private with a scheduled `publishAt`, so it goes live at the chosen time and the user can still pull it before then. Without credentials, give them the files and the pack to paste in.

Append a line to `channel/history.jsonl` and remove the topic from `ideas.md`.

## Community (comments)

Read `references/community.md`. `scripts/yt_comments.py list` pulls new comments the channel hasn't answered and skips ones in `comments/handled.json`. Triage them (question, useful feedback, praise, idea, spam/scam, hostile, business), reply only where a reply adds something, in the channel's voice. `channel.json → reply_mode` decides whether replies are posted after your judgement (`auto`) or shown as drafts for the user to approve first (`approve`, the default). Anything sensitive — legal, business deals, personal info, criticism of a third party, someone in distress — always goes to the user, whatever the mode. Report what you did in a short summary and add good video ideas to `ideas.md`.

For ongoing management, offer to run this on a schedule (e.g. the `/loop` skill or a scheduled task, daily).

## Analytics & ideas

`scripts/yt_analytics.py summary` gives per-video performance (views, watch time, average view percentage, subs gained), audience countries, and how upload weekday/hour relates to first-week views. Use it to say what's working, what isn't, and what to make next — concrete, with numbers. Keep `ideas.md` fed.

## Cost discipline

The user explicitly wants cheap subagents for research and judging. Use the models in `channel.json → models`; don't upgrade them on your own. Give subagents exactly what they need (paths, the brief, the rubric) instead of long context, and keep their outputs in files so you read only the summary.
