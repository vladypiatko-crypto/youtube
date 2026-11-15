# Channel setup

Goal: a `channel/channel.json` that makes every future video feel like it came from the same channel, collected with as few questions as possible.

## 1. Pull answers from what the user already said

Before asking anything, map the user's message (and any existing channel URL, past videos, or files they mention) onto the fields below. If they linked an existing channel, have the research subagent skim its recent uploads so you can propose a style that matches what's already there.

## 2. Ask the rest in one batch

Use AskUserQuestion (max 4 questions per call; two calls at most). Give concrete options and put the recommended one first. Good questions, in priority order:

1. **Niche & audience** — "What's the channel about and who is it for?" (options inferred from context; "Other" is always available)
2. **Format** — Shorts (vertical, ≤60 s) / long-form (8–15 min) / both (long-form + 2–3 Shorts cut from it)
3. **Visual style** — faceless motion graphics & text / narrated stock + B-roll / screen recording & tutorials / the user's own footage that you edit
4. **Voice** — AI voice (pick a voice) / the user records the narration / no narration (music + on-screen text)
5. **Tone** — e.g. chill & funny / energetic / calm & educational / dark & documentary
6. **Upload cadence** — how many videos per week
7. **Comment replies** — `approve` (draft replies, user okays them; recommended at first) / `auto` (post replies that fit the rules, report afterwards)
8. **Budget mode** — default (research on Sonnet, judging on Haiku) / budget (both on Haiku)

Language defaults to the language the user writes in; ask only if it's ambiguous.

## 3. channel.json

```json
{
  "name": "Channel name",
  "handle": "@handle or null",
  "channel_id": "UC... or null (filled after auth)",
  "niche": "pop-science explainers about space",
  "audience": "teens and young adults, curious, short attention span",
  "language": "en",
  "format": "shorts | long | both",
  "style": {
    "visual": "faceless motion graphics",
    "palette": ["#0B0F1A", "#F5F7FF", "#7C5CFF"],
    "font": "Inter",
    "captions": "big, centered, 2–4 words at a time, highlight key word",
    "music": "lo-fi, low volume, no lyrics",
    "references": ["channels or videos the user likes"]
  },
  "voice": {
    "source": "tts | user | none",
    "tts_engine": "edge | elevenlabs | openai",
    "tts_voice": "en-US-AndrewNeural",
    "rate": "+5%"
  },
  "tone": "chill, a bit ironic, never cringe",
  "persona": "how the channel talks in replies, 1–2 sentences",
  "cadence_per_week": 3,
  "reply_mode": "approve | auto",
  "models": { "research": "sonnet", "judge": "haiku" },
  "timezone": "Europe/Berlin",
  "made_for_kids": false,
  "created": "YYYY-MM-DD"
}
```

Also create `channel/ideas.md` (seed it with 5 ideas from the niche) and an empty `channel/history.jsonl`.

## 4. YouTube API credentials (only for upload / analytics / comments)

Explain this simply; the user may not be technical.

1. Go to console.cloud.google.com → create a project.
2. "APIs & Services" → enable **YouTube Data API v3** and **YouTube Analytics API**.
3. "OAuth consent screen" → External, add their own Google account as a test user.
4. "Credentials" → Create credentials → OAuth client ID → **Desktop app** → download the JSON.
5. Save it as `channel/.secrets/client_secret.json`.
6. Run `python scripts/yt_auth.py`. It prints a Google sign-in link; after they approve, it saves `channel/.secrets/token.json` and writes the `channel_id` into channel.json.

### Cloud sessions (claude.ai/code): environment variables, no Python needed

A cloud container is wiped between sessions and can't receive the `localhost` redirect, so a `token.json` there doesn't last. Instead the user gets a refresh token in the browser and stores it in the cloud environment's settings, where every session can read it and no repo ever sees it:

1. Do steps 1–3 above. Then on the OAuth consent screen, click **Publish app** (push to production). Apps left in "Testing" have their refresh tokens expire after 7 days. Google shows an "unverified app" warning when they sign in; that's expected for their own app.
2. "Credentials" → Create credentials → OAuth client ID → **Web application**. Under *Authorized redirect URIs* add `https://developers.google.com/oauthplayground`. Copy the client ID and client secret.
3. Open https://developers.google.com/oauthplayground → gear icon (top right) → tick **Use your own OAuth credentials** → paste the client ID and secret.
4. In "Step 1", type these scopes into the box at the bottom, separated by spaces, then **Authorize APIs** and sign in with the channel's Google account (pick the channel if it's a Brand Account):
   `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly`
5. "Step 2" → **Exchange authorization code for tokens** → copy the **Refresh token**.
6. In Claude: the cloud environment menu in the session's title bar → Edit → Environment variables. Add `YT_CLIENT_ID`, `YT_CLIENT_SECRET` and `YT_REFRESH_TOKEN`. They're picked up when the next session starts.
7. Check with `python scripts/yt.py status`. It prints the channel name and writes `channel_id` into channel.json; it never prints the secrets.

They can revoke access anytime at https://myaccount.google.com/permissions.

(Local alternative: run `yt_auth.py` on their own computer, which needs `pip install google-auth-oauthlib`, and put the resulting `token.json` into `channel/.secrets/`. It refreshes itself afterwards.)

### Using it

`scripts/yt.py` is the one entry point: `status`, `upload`, `videos`, `set-privacy`, `comments …`, `analytics summary`. Uploads default to private (+ scheduled with `publish_at`).

Notes worth telling the user:
- The default API quota is 10,000 units/day; one upload costs ~1,600, so ~6 uploads/day max. Listing comments is cheap; each reply costs ~50.
- **Unaudited projects:** Google locks videos uploaded through an API project that hasn't passed the YouTube API Services audit as private, and they may not be able to switch them to public in Studio either. To lift it, apply for the free audit (YouTube API Services → "Audit and Quota Extension" form). Until it's approved, hand over the final file + publish pack for a manual upload. Comments and analytics work without the audit.
- Never paste the token or client secret into chat; they go only into the environment settings (cloud) or `channel/.secrets/` (local).
