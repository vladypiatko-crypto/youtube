// Claude's on-screen cursor + the "director" that turns Claude Code's live tool calls into
// visible actions: flying to the note it's fixing, opening the file, selecting the old code,
// typing the new code, then refreshing the preview — so you can watch it build.
import { $, sleep, api } from './util.js';
import * as editor from './editor.js';

const el = () => $('#claude-cursor');
let pos = { x: innerWidth / 2, y: innerHeight / 2 };
let hooks = {};
const queue = [];
let busy = false;
const pendingReload = new Set();
let running = false;
let hideTimer = null;

export function initCursor(h) { hooks = h; }

// ---------- cursor primitives ----------
function place(x, y, fast = false) {
  const c = el();
  c.classList.toggle('fast', fast);
  c.classList.toggle('flip', x > innerWidth - 300);
  pos = { x, y };
  c.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
export function show() { clearTimeout(hideTimer); el().classList.remove('hidden'); }
export function hide(delay = 0) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el().classList.add('hidden'), delay);
}
export function say(text) { $('#cc-say').textContent = text || ''; }
async function moveTo(x, y, { fast = false } = {}) {
  show();
  const d = Math.hypot(x - pos.x, y - pos.y);
  place(x, y, fast);
  if (d > 4) await sleep(fast ? 260 : Math.min(650, 250 + d * 0.5));
}
function click() {
  const r = $('#cc-ripple');
  r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
}
async function moveToEl(target, { dx = 0.5, dy = 0.5, fast } = {}) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  if (!r.width && !r.height) return;
  await moveTo(r.left + r.width * dx, r.top + r.height * dy, { fast });
}

// ---------- queue ----------
const speedy = () => queue.length > 6;
function enqueue(job) {
  queue.push(job);
  if (!busy) pump();
}
async function pump() {
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try { await job(); } catch (e) { console.warn('cursor job failed', e); }
  }
  busy = false;
  if (pendingReload.size) await flushReload();
  if (running && !queue.length) say('thinking…');
}
async function flushReload() {
  const paths = [...pendingReload];
  pendingReload.clear();
  await hooks.reloadPreview(paths);
  if (watching() && running) {
    const st = hooks.stageEl().getBoundingClientRect();
    await moveTo(st.left + st.width * 0.5, st.top + st.height * 0.5);
    click();
    hooks.flashStage();
    say('preview updated');
    await sleep(500);
  }
}
const watching = () => hooks.isWatching();

/** Returns true if the reload should wait for the cursor animation to catch up. */
export function onFileChanged(path) {
  if (!running || !watching() || (!busy && !queue.length)) return false;
  pendingReload.add(path);
  return true;
}

// ---------- Claude events ----------
export function onClaude(ev) {
  switch (ev.kind) {
    case 'start': {
      running = true;
      if (!watching()) return;
      const send = $('#chat-send').getBoundingClientRect();
      place(send.left + 20, send.top + 10, true);
      show();
      say(ev.noteIds?.length ? `reading ${ev.noteIds.length} note${ev.noteIds.length > 1 ? 's' : ''}…` : 'reading your message…');
      return;
    }
    case 'thinking': if (!busy) say('thinking…'); return;
    case 'tool_start': if (!busy && watching()) say(labelFor(ev.name)); return;
    case 'marker': return enqueue(() => onMarker(ev));
    case 'tool': return enqueue(() => onTool(ev));
    case 'tool_result':
      if (ev.error && watching()) enqueue(async () => { say('hmm, that didn\'t work — adjusting'); await sleep(500); });
      return;
    case 'end':
      enqueue(async () => {
        running = false;
        if (pendingReload.size) await flushReload();
        editor.claudeMode(false);
        if (!watching()) return hide();
        const st = hooks.stageEl().getBoundingClientRect();
        await moveTo(st.left + st.width * 0.72, st.top + st.height * 0.82);
        say(ev.code === 0 ? 'done ✨ have a look' : 'stopped');
        hide(2600);
      });
      return;
  }
}

function labelFor(name) {
  return { Read: 'opening a file…', Edit: 'writing an edit…', MultiEdit: 'writing edits…', Write: 'writing a file…', Grep: 'searching…', Glob: 'looking around…', TodoWrite: 'making a plan…' }[name] || `${name}…`;
}

async function onMarker({ state, id }) {
  hooks.onMarker?.(state, id);
  if (!watching()) return;
  const note = hooks.getNote(id);
  if (!note) return;
  if (state === 'fixing') {
    hooks.selectNote(id, { quiet: true });
    await sleep(120);
    const p = hooks.notePoint(note);
    await moveTo(p.x, p.y);
    click();
    say(`on it: #${id} — ${note.text.split('\n')[0].slice(0, 40)}`);
    await sleep(speedy() ? 200 : 900);
  } else if (state === 'fixed') {
    const card = hooks.noteCardEl(id);
    if (card && card.offsetParent) await moveToEl(card, { dx: 0.85, dy: 0.25 });
    say(`fixed #${id} ✓`);
    click();
    await sleep(speedy() ? 150 : 600);
  } else {
    say(`skipping #${id}`);
    await sleep(400);
  }
}

async function onTool({ name, input }) {
  const file = input?.file_path || input?.path || '';
  if (!watching()) {
    if (/^(Edit|MultiEdit|Write)$/.test(name)) editor.claudeMode(false);
    return;
  }
  if (name === 'Read') {
    const m = file.match(/\.cutroom\/notes\/(\d+)\.png$/);
    if (m) {
      const note = hooks.getNote(+m[1]);
      if (note) {
        hooks.selectNote(note.id, { quiet: true });
        const p = hooks.notePoint(note);
        await moveTo(p.x, p.y);
        say(`looking at your drawing on #${note.id}`);
        await sleep(speedy() ? 200 : 800);
      }
      return;
    }
    if (/\.(png|jpe?g|webp|gif|mp3|wav)$/i.test(file) || file.startsWith('/') || file.includes('..')) { say(`reading ${short(file)}`); return; }
    await openFile(file);
    say(`reading ${short(file)}`);
    const r = editor.scrollEl().getBoundingClientRect();
    await moveTo(r.left + 60, r.top + 40);
    if (!speedy()) await editor.scrollThrough(600);
    return;
  }
  if (name === 'Grep' || name === 'Glob') {
    await moveToEl(editor.fileSelectEl(), { dx: 0.7 });
    say(`searching ${input.pattern ? `“${String(input.pattern).slice(0, 30)}”` : ''}`);
    await sleep(speedy() ? 100 : 450);
    return;
  }
  if (name === 'Edit') return animateEdits(file, [{ old: input.old_string || '', new: input.new_string || '' }]);
  if (name === 'MultiEdit') return animateEdits(file, (input.edits || []).map(e => ({ old: e.old_string || '', new: e.new_string || '' })));
  if (name === 'Write') return animateWrite(file, input.content || '');
  if (name === 'TodoWrite') { say('planning the fixes'); await sleep(300); }
}

const short = p => p.split('/').slice(-2).join('/');

async function openFile(path) {
  if (!hooks.codeOpen()) { hooks.openCode(); await sleep(340); }
  if (editor.currentPath() !== path) await editor.open(path);
}

async function diskText(path) { return api(`/api/file?path=${encodeURIComponent(path)}`).catch(() => null); }

async function animateEdits(path, edits) {
  await openFile(path);
  editor.claudeMode(true, `Claude is editing ${short(path)}`);
  let base = editor.currentText();
  for (const ed of edits) {
    let idx = base.indexOf(ed.old);
    if (idx < 0 || !ed.old) {
      // the file on disk is already ahead of us — rebuild the "before" text from it
      const disk = await diskText(path);
      const j = disk ? disk.indexOf(ed.new) : -1;
      if (j >= 0 && ed.new) { base = disk.slice(0, j) + ed.old + disk.slice(j + ed.new.length); idx = j; editor.setText(base); }
      else { if (disk != null) editor.setText(disk), base = disk; continue; }
    }
    const fast = speedy();
    const at = editor.locate(idx);
    await moveTo(at.x, at.y);
    say(`editing ${short(path)}:${at.line + 1}`);
    if (ed.old) {
      editor.showSel(idx, idx + ed.old.length, true);
      await sleep(fast ? 120 : 420);
    }
    base = base.slice(0, idx) + base.slice(idx + ed.old.length);
    editor.hideSel();
    editor.setText(base);
    await typeAt(base, idx, ed.new, fast);
    base = base.slice(0, idx) + ed.new + base.slice(idx);
    const endLine = editor.locate(idx + ed.new.length, { scroll: false }).line;
    editor.flash(at.line, endLine);
  }
  const disk = await diskText(path);
  if (disk != null) editor.markSaved(disk);
  editor.hideCaret();
  editor.claudeMode(false);
}

async function typeAt(base, idx, str, fast) {
  if (!str) return;
  const c = el();
  c.classList.add('typing');
  const total = fast ? 250 : Math.min(1800, 200 + str.length * 14);
  const steps = Math.max(1, Math.min(str.length, fast ? 6 : 48));
  for (let i = 1; i <= steps; i++) {
    const n = Math.round(str.length * i / steps);
    editor.setText(base.slice(0, idx) + str.slice(0, n) + base.slice(idx));
    editor.showCaret(idx + n);
    const at = editor.locate(idx + n);
    place(at.x + 2, at.y, true);
    await sleep(total / steps);
  }
  c.classList.remove('typing');
}

async function animateWrite(path, content) {
  await openFile(path);
  editor.claudeMode(true, `Claude is writing ${short(path)}`);
  const at = editor.locate(0);
  await moveTo(at.x, at.y);
  say(`writing ${short(path)}`);
  editor.setText('');
  await typeAt('', 0, content, speedy());
  const disk = await diskText(path);
  editor.markSaved(disk ?? content);
  editor.hideCaret();
  editor.claudeMode(false);
}
