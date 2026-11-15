# Production

## Script (`script.md`)

Write for the ear, not the page: short sentences, concrete words, one idea per sentence. Read it in your head at speaking speed (~150 words/min; a 50 s Short is ~120 words, a 10 min video ~1,500).

Structure that holds attention:

- **Hook (0–5 s Shorts / 0–15 s long-form):** open on the most surprising true thing or a specific question, and show something moving at second zero. No greetings, no channel intro, no "in this video".
- **Promise:** make clear what the viewer gets by staying (one line, can be part of the hook).
- **Body:** beats that each answer one question and raise the next. Long-form: a re-hook every 60–90 s ("but that's not the weird part…"). Specific numbers and examples beat generalities.
- **Payoff:** deliver the promise fully.
- **End:** one line that lands (callback to the hook works well), optionally a short CTA tied to the next video. Then stop. Shorts should loop nicely into their own start if possible.

Format `script.md` as numbered scenes: narration text + what's on screen. This becomes `scenes.json`.

## scenes.json (input for `scripts/assemble.py`)

```json
{
  "resolution": [1080, 1920],
  "fps": 30,
  "captions": {"enabled": true, "words_per_chunk": 3, "font": "Inter", "size": 78, "color": "#FFFFFF", "outline": "#000000", "position": "center"},
  "music": {"path": "assets/music.mp3", "volume": 0.12, "duck": true},
  "padding": 0.25,
  "scenes": [
    {"id": "s01", "visual": "assets/s01.png", "motion": "zoom_in", "audio": "audio/s01.mp3", "text": "Narration for this scene, also used for captions."},
    {"id": "s02", "visual": "assets/s02.mp4", "audio": "audio/s02.mp3", "text": "…"},
    {"id": "s03", "visual": "assets/s03.png", "motion": "pan_right", "duration": 2.5, "text": ""}
  ]
}
```

- Paths are relative to the scenes.json file.
- A scene lasts as long as its audio + `padding`; scenes without audio need `duration`.
- `visual` is an image (png/jpg, gets `motion`: `zoom_in`, `zoom_out`, `pan_left`, `pan_right`, `none`) or a video clip (trimmed or looped to fit).
- Resolution: `[1080, 1920]` for Shorts, `[1920, 1080]` for long-form.
- Music is optional; with `duck: true` it gets pushed down under the voice.
- Output: `python scripts/assemble.py channel/videos/<slug>/scenes.json --out channel/videos/<slug>/renders/v1.mp4`. It burns captions from scene text (timed by word count within each scene), normalises loudness to −14 LUFS, and encodes H.264/AAC that YouTube likes.

## Narration

- **AI voice:** `python scripts/tts.py --scenes scenes.json` generates `audio/<id>.mp3` for every scene using `channel.json → voice` (edge-tts by default: free, decent, needs internet; ElevenLabs/OpenAI if their API key is set in the environment). Re-run for single scenes with `--only s03`. List edge voices with `python scripts/tts.py --list-voices en-`.
- If edge-tts can't connect (some cloud sandboxes block it), don't stall: ask for an ElevenLabs/OpenAI key, ask the user to record, or make a robotic draft with `--engine flite` just to get the judge loop going — and never ship a flite voice as final without telling the user.
- **The user's own voice:** ask them to record each scene as `audio/<id>.mp3` (or one take you split at silences with ffmpeg `silencedetect`). Their voice is a real advantage — use it if they're up for it.
- **No narration:** give each scene a `duration` and put the words on screen.

Disclose synthetic voices/visuals where YouTube requires it (realistic-looking altered or synthetic content) — `publish.json → contains_synthetic_media`.

## Visuals — pick the pipeline that fits `style.visual`

**Faceless motion graphics / text-driven.** Generate a frame per scene. Two ways:
- `python scripts/card.py` for quick on-brand cards (title, big number, quote, list) in the channel palette and font.
- For richer layouts, write a small HTML page per scene (CSS, SVG, the channel's palette/font) and screenshot it with Playwright at the exact resolution. HTML gives you real typography, icons, charts and diagrams. For animated scenes, record a short clip with Playwright's video recording or render frames and stitch with ffmpeg.
- Remotion (React → MP4) is a great upgrade for complex animation if Node is available and the user wants to invest in it.

**Narrated stock / B-roll.** Use freely licensed sources only (Pexels, Pixabay — both have APIs if the user provides a key — Wikimedia Commons, NASA and other public-domain archives). Record each asset's source and licence in `assets/CREDITS.md` and put required credits in the description. Never use clips from other YouTube videos, films, TV or music the channel doesn't have rights to — it gets the channel copyright strikes.

**The user's footage.** Cut it with ffmpeg: trim dead air (silencedetect), punch-in zooms to hide jump cuts, B-roll or cards over long talking stretches, captions. Ask them what's in each file if names aren't obvious.

**Screen recordings / tutorials.** Zoom into the area being discussed, keep the cursor visible, speed up waiting/loading, add step labels.

Captions are burned in the lower third (on Shorts ~30% up from the bottom). Keep a scene's own text above that — `card.py` already centres vertical cards at 40% height — or set `captions.position`/`margin_v` in scenes.json.

Keep text big (Shorts: nothing important in the top 15% or bottom 25% — UI covers it), high contrast, and on screen long enough to read twice.

## Music

Only music the channel can legally use: YouTube Audio Library, Pixabay Music, or tracks the user owns/licenses. Note the source in `assets/CREDITS.md`. Instrumental, below the voice. If there's no suitable track, ship without music rather than risk a claim.

## Shorts cut from a long video

When `format` is `both`, after the long-form ships pick 2–3 self-contained 30–50 s moments, rewrite a 2 s hook for each, re-frame to 1080×1920 (crop or re-layout the graphics), and run each through the same judge loop (they're cheap to judge).
