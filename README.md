# YouTube channel skill for Claude

A Claude Code skill that runs a YouTube channel end to end:

1. **Setup (first time)** — Claude asks about niche, audience, format (Shorts / long / both), visual style, voice, tone, cadence and how comment replies should work — only the things you didn't already say — and saves it to `channel/channel.json`.
2. **Research** — a cheap subagent (Sonnet by default, Haiku in budget mode) checks whether the video already exists on YouTube, finds the angle worth taking, and gathers facts with sources, hooks and keywords.
3. **Create** — Claude writes the script and storyboard, generates narration (edge-tts / ElevenLabs / OpenAI / your own voice) and visuals, and renders an MP4 with captions, ducked music and YouTube loudness (−14 LUFS).
4. **Judge loop** — a fresh, cheaper subagent (Haiku) reviews contact sheets, the hook, transcript and audio stats and scores the video. Under 8/10 → Claude fixes it and re-renders, up to 3 rounds.
5. **Publish pack** — title options, description with chapters + sources, tags, hashtags, thumbnail, AI-disclosure flag and a recommended upload date/time (from your analytics when connected).
6. **Upload** — after you OK it, uploads as private + scheduled.
7. **Channel management** — reads new comments, triages them, replies to the ones that matter in the channel's voice (you approve drafts, or `auto` mode), flags spam/business/sensitive stuff, and turns good comments into video ideas.

## Install (inside Claude Code)

The repo needs to be **public** for this to work without a GitHub login.

1. Open Claude Code (`claude` in a terminal) and run:
   ```
   /plugin install youtube-channel --marketplace vladypiatko-crypto/youtube
   ```
   On an older Claude Code, use two steps: `/plugin marketplace add vladypiatko-crypto/youtube`, then `/plugin install youtube-channel@youtube-tools`.
2. Restart Claude Code. Then, in the folder you want to use for your channel, run:
   ```
   /yt-setup
   ```
   This installs ffmpeg and the Python packages, then sets up your channel. It's a one-time thing.

Update later: `/plugin update youtube-channel`.

## Commands

| Command | What it does |
|---|---|
| `/yt-setup` | install dependencies + set up / rebrand the channel |
| `/yt-video [topic]` | make the next video (no topic → Claude suggests 3) |
| `/yt-comments` | read new comments, reply to the ones that matter, flag the rest |
| `/yt-stats` | how the channel is doing + what to make next |
| `/youtube-channel` | the skill itself; plain language works too |

## Use

Use the commands above, or just talk to Claude:

- "set up my channel — faceless space facts for teens, Shorts, chill vibe"
- "make the next video"
- "make a video about why octopuses have three hearts"
- "check my comments"
- "when should I post this?" / "how's the channel doing?"

Uploading, analytics and comments need a one-time Google sign-in; Claude walks you through it (details in `references/setup.md`). Everything else works without it — you just upload the finished file yourself.

## Layout

```
.claude-plugin/marketplace.json          # makes this repo installable with /plugin
plugins/youtube-channel/
├── .claude-plugin/plugin.json
├── commands/                            # /yt-setup, /yt-video, /yt-comments, /yt-stats
└── skills/youtube-channel/
    ├── SKILL.md                         # the workflow Claude follows
    ├── references/                      # setup, production, research/judge prompts, publishing, comments
    └── scripts/                         # setup.sh/.ps1, assemble.py (render), tts.py, card.py, review_pack.py, yt_*.py
channel/                                 # created in your project on first run: config, ideas, videos, history
```
