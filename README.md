# YouTube channel skill for Claude

A Claude Code skill that runs a YouTube channel end to end:

1. **Setup (first time)** — Claude asks about niche, audience, format (Shorts / long / both), visual style, voice, tone, cadence and how comment replies should work — only the things you didn't already say — and saves it to `channel/channel.json`.
2. **Research** — a cheap subagent (Sonnet by default, Haiku in budget mode) checks whether the video already exists on YouTube, finds the angle worth taking, and gathers facts with sources, hooks and keywords.
3. **Create** — Claude writes the script and storyboard, generates narration (edge-tts / ElevenLabs / OpenAI / your own voice) and visuals, and renders an MP4 with captions, ducked music and YouTube loudness (−14 LUFS).
4. **Judge loop** — a fresh, cheaper subagent (Haiku) reviews contact sheets, the hook, transcript and audio stats and scores the video. Under 8/10 → Claude fixes it and re-renders, up to 3 rounds.
5. **Publish pack** — title options, description with chapters + sources, tags, hashtags, thumbnail, AI-disclosure flag and a recommended upload date/time (from your analytics when connected).
6. **Upload** — after you OK it, uploads as private + scheduled.
7. **Channel management** — reads new comments, triages them, replies to the ones that matter in the channel's voice (you approve drafts, or `auto` mode), flags spam/business/sensitive stuff, and turns good comments into video ideas.

## Install

You need [git](https://git-scm.com/downloads) and a GitHub login with access to this repo. The installer adds ffmpeg and Python if they're missing, installs the skill for **all** your projects (`~/.claude/skills/youtube-channel`) with its own Python environment, and checks everything.

**macOS / Linux:**

```bash
git clone -b claude/vigilant-goldberg-uqym5w https://github.com/vladypiatko-crypto/youtube.git ~/youtube-skill && bash ~/youtube-skill/install.sh
```

**Windows (PowerShell):**

```powershell
git clone -b claude/vigilant-goldberg-uqym5w https://github.com/vladypiatko-crypto/youtube.git "$HOME\youtube-skill"; powershell -ExecutionPolicy Bypass -File "$HOME\youtube-skill\install.ps1"
```

Update later: `git -C ~/youtube-skill pull` and run the installer again.

## Use

Just talk to Claude:

- "set up my channel — faceless space facts for teens, Shorts, chill vibe"
- "make the next video"
- "make a video about why octopuses have three hearts"
- "check my comments"
- "when should I post this?" / "how's the channel doing?"

Uploading, analytics and comments need a one-time Google sign-in; Claude walks you through it (details in `references/setup.md`). Everything else works without it — you just upload the finished file yourself.

## Layout

```
.claude/skills/youtube-channel/
├── SKILL.md                 # the workflow Claude follows
├── references/              # setup, production, research/judge prompts, publishing, comments
└── scripts/                 # assemble.py (render), tts.py, card.py, review_pack.py, yt_*.py (API)
channel/                     # created on first run: your channel's config, ideas, videos, history
```
