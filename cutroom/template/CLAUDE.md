# Cutroom project — how this film is built

This folder is a video made of code. Cutroom (the app the user is looking at) renders it live in the browser
from these files — no render step. Every save hot-reloads the preview instantly, and the user is watching you work.

## Layout
- `project.json` — title, size, fps, the scene list (order = timeline order), captions, audio tracks.
- `scenes/*.js` — one ES module per scene. Helper modules (like `scenes/lighthouse.js`) can be imported with relative paths.
- `audio/` — sound files referenced by `project.json` → `audio`.
- `.cutroom/notes.json` + `.cutroom/notes/<id>.png` — the user's review notes and annotated frame snapshots. Read-only for you.

## Scene contract
```js
import { ease, range, tween, text, rng } from '/kit.js';
export default function render(ctx, t, s) {
  // ctx: CanvasRenderingContext2D sized to project width × height (logical px)
  // t:   seconds since this scene started (0 … s.duration)
  // s:   { w, h, duration, p (0..1 progress), frame (global), fps, time (global seconds), scene }
}
```
Rules:
- **Pure + deterministic**: output depends only on `t`/`s`. No `Math.random()` (use `rng(seed)`), no `Date`, no state kept between calls (the user scrubs backwards).
- Draw the full frame every call (paint a background first).
- Scene timing lives in `project.json` (`duration`, optional `fade` seconds = crossfade from the previous scene).
- New scene → add the file *and* an entry in `project.json` → `scenes`.
- Captions: `project.json` → `captions: [{ start, end, text }]` in global seconds.
- Audio: `project.json` → `audio: [{ name, file, start, volume, fadeIn }]`.

## kit.js (served at `/kit.js`)
`TAU, clamp, lerp, invLerp, range(t,a,b,ease)`, `ease.{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,outQuart,inOutSine,outExpo,outBack,outElastic}`,
`tween(t, [[time, value, easeName], …])` (numbers or arrays), `fadeInOut(t,dur,in,out)`, `rng(seed)` (+ `.range .int .pick`),
`noise(x, seed)` (smooth −1..1), `text(ctx, str, x, y, {size, weight, font, color, align, baseline, alpha, spacing, shadow, shadowBlur, maxWidth})`,
`typewriter(str, t, cps)`, `linear(ctx,x0,y0,x1,y1,stops)`, `radial(ctx,x,y,r0,r1,stops)`, `vignette(ctx,w,h,strength)`,
`grain(ctx,w,h,frame,amount)`, `roundRect(ctx,x,y,w,h,r)`, `hsl(h,s,l,a)`.

## Working with review notes
Notes arrive with a global time, the scene + local scene time, where on the frame the user pointed (x/y %), and a
snapshot PNG with their drawings. Look at the snapshot, find the code that draws that thing at that time, fix it
with the smallest change that does the job, and keep the rest of the film unchanged. Say `[fixing #ID]` before and
`[fixed #ID]` after each note so Cutroom can show your progress.
