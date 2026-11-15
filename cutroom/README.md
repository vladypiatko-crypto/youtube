# Cutroom — code-to-video studio with Claude in the loop

Write a video as code, watch it **live in the browser (no render step)**, draw notes right on the frame,
and hit **Send to Claude** — Claude Code fixes the code while **its own cursor flies across the screen**:
it jumps to the thing you circled, opens the scene file, selects the old code, types the new code,
and the preview hot-reloads. Then export a frame-perfect MP4.

Runs on **your Claude subscription** through the Claude Code CLI you're already logged into — no API key needed.

## Start

Needs Node 18+, [Claude Code](https://docs.claude.com/en/docs/claude-code) (`npm i -g @anthropic-ai/claude-code`, run `claude` once and sign in) and ffmpeg for MP4 export.

```bash
cd cutroom
node server.js my-film --open
```

`my-film` is created from the example film (*The Last Keeper*, a 24-second lighthouse short) if it doesn't exist.
Point it at any folder with a `project.json` to open that instead. No `npm install` — zero dependencies.

## What you can do

| | |
|---|---|
| **Live preview** | Every scene is a pure function `render(ctx, t)`. Scrub, step frames, loop a section, play at ¼×–2×. Save a file → preview updates instantly. |
| **Notes on frames** | Note / pen / arrow / box / circle / text / marker tools. Each note stores the time, scene, where you pointed, your drawings and an annotated snapshot PNG that Claude actually looks at. |
| **Send to Claude** | Sends all open notes (or one: *Fix with Claude →*, or *Save & fix now* straight from the composer). Notes go *queued → Claude is on it → fixed* live. |
| **Watch Claude work** | Claude's cursor shows every step: looking at your drawing, reading files, selecting + typing edits in the code panel, refreshing the preview. Toggle *watch Claude work* off to let it run silently. |
| **Chat** | Ask for anything ("add a seagull", "make the storm darker"). Claude gets the playhead time + scene with each message. Conversations continue until you hit **+**. |
| **Undo any run** | A snapshot is taken before every Claude run — *↺ Undo this run* or **History** puts every file back. |
| **Crash-proof preview** | If a scene throws, you see the error, the line is highlighted in the code panel and **Ask Claude to fix** is one click. The last good version keeps playing meanwhile. |
| **Code panel** | Follows the playhead, syntax highlighted, editable (⌘/Ctrl+S saves). |
| **Timeline** | Scenes, notes, captions, audio waveforms. Ctrl/⌘+scroll zooms, shift+drag marks a section. |
| **Export** | Renders every frame from the same code and pipes it to ffmpeg → H.264 MP4 with your audio mixed in, captions optionally burned in. 720p / 1080p / 4K. |

Press <kbd>?</kbd> in the app for all shortcuts.

## Project format

```
my-film/
├── project.json        # title, size, fps, scenes (order + duration + crossfade), captions, audio
├── CLAUDE.md           # tells Claude how this project works (scene contract, kit.js API)
├── scenes/*.js         # export default function render(ctx, t, s) { … }
├── audio/*.mp3
├── exports/            # rendered videos
└── .cutroom/           # notes, snapshots, history (undo)
```

```js
import { text, range, ease, rng } from '/kit.js';
export default function render(ctx, t, { w, h, duration }) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  text(ctx, 'Hello', w / 2, h / 2, { size: 120, alpha: range(t, 0, 1, ease.outCubic) });
}
```

`kit.js` has easing, keyframe tweens, seeded random, noise, text, gradients, vignette, grain — see `template/CLAUDE.md`.

## How the Claude part works

The server spawns `claude -p --output-format stream-json --include-partial-messages --permission-mode acceptEdits`
in your project folder, limited to file tools (Read/Edit/Write/Glob/Grep). It streams Claude's text and tool calls
to the browser, which animates them. `ANTHROPIC_API_KEY` is removed from Claude's environment so it uses your
subscription login, not API billing. Claude marks progress with `[fixing #3]` / `[fixed #3]`, which drive the note states.

Options: `--port 4800`, `--open`. Env: `CUTROOM_CLAUDE_BIN` (path to claude), `CUTROOM_FFMPEG`.
