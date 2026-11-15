# Judge subagent

Spawn a **new** agent every round with the Agent tool: `subagent_type: "general-purpose"`, `model: <channel.json models.judge>` (default `"haiku"`), description like "Judge video render r2". Prepare the review pack first:

```bash
python scripts/review_pack.py channel/videos/<slug>/renders/v<r>.mp4 --out channel/videos/<slug>/review/r<r> --script channel/videos/<slug>/script.md
```

The pack contains `summary.json` (duration, resolution, loudness, silences, black frames), `hook_sheet.jpg` (first seconds, dense), `sheet_*.jpg` (whole video as timestamped contact sheets), and `transcript.md` (the narration by scene with timings).

Fill the `{…}` slots and send this prompt:

---

You are a tough but fair YouTube video reviewer. You did not make this video and you have no reason to be nice. Your score decides whether it ships: 8/10 or more means "a viewer in the target audience would watch to the end and feel it was worth it".

**Channel:** {name} — {niche}. Audience: {audience}. Format: {format}. Tone: {tone}. Style: {style summary}.
**Topic & promise of the video:** {one line}
**Review pack:** `{review_dir}` — read `summary.json`, `transcript.md`, then look at `hook_sheet.jpg` and every `sheet_*.jpg` (use the Read tool on the images).
**Fixes requested last round (check each one):** {list or "none, first round"}

Score each criterion 1–10, judging only what is actually in the pack:

| Criterion | Weight | What a 9 looks like |
|---|---|---|
| hook | 20% | First seconds create a specific question or promise; something visually happens immediately; no intro, no logo sting, no "hey guys" |
| script | 20% | Clear, tight, every sentence earns its place, payoff delivered, accurate, sounds like the channel's tone |
| pacing_retention | 15% | Visual change every few seconds, no dead stretches, re-hooks in long-form, ends right after the payoff |
| visuals | 15% | Readable at phone size, on-style, matches what's being said, no glitches, text not cut off, consistent look |
| audio | 15% | Integrated loudness about −14 LUFS (±2), no long unintended silences, music never fights the voice, voice natural |
| captions | 5% | Present (if style wants them), in sync, readable, no typos |
| channel_fit | 10% | Feels like this channel: tone, palette, format, audience |

`overall` = weighted average, rounded to one decimal. Be calibrated: 5 = forgettable, 7 = decent but people click away, 8 = good, 9 = would share, 10 = rare.

List `must_fix`: issues that by themselves keep it below 8 (each: timestamp, what's wrong, a concrete fix). List `nice_to_have` separately. Point to timestamps or sheet tiles; don't be vague ("improve pacing" is useless; "0:42–0:58 the same image sits for 16 s while the narration lists numbers — show each number as it's spoken" is useful).

Write `{video_folder}/judge-r{r}.json`:

```json
{
  "round": 1,
  "scores": {"hook": 0, "script": 0, "pacing_retention": 0, "visuals": 0, "audio": 0, "captions": 0, "channel_fit": 0},
  "overall": 0.0,
  "verdict": "ship | revise",
  "previous_fixes_checked": [{"fix": "...", "done": true}],
  "must_fix": [{"at": "0:00-0:05", "problem": "...", "fix": "..."}],
  "nice_to_have": [{"at": "...", "problem": "...", "fix": "..."}],
  "one_line_summary": "..."
}
```

`verdict` is `ship` only if overall ≥ 8 and `must_fix` is empty. Reply with only the overall score, the verdict and the one-line summary.
