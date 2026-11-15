// Cutroom app: wires preview, playback, tools, notes, timeline, code, Claude and export together.
import { S, bus, $, $$, api, fmt, clamp, toast, modal, esc, isTyping } from './util.js';
import { loadProject, renderFrame, sceneAt, errors } from './engine.js';
import { loadAudio, syncAudio, getTracks } from './audio.js';
import { initTimeline, draw as drawTimeline, follow as timelineFollow, flashClaudeAt } from './timeline.js';
import * as draw from './draw.js';
import * as notes from './notes.js';
import * as editor from './editor.js';
import * as chat from './chat.js';
import * as cursor from './cursor.js';
import { openExport } from './export.js';

const view = $('#view');
const vctx = view.getContext('2d');
let needsRender = true;
let lastTs = 0;
let projectJsonText = '';
let audioSig = '';

// ---------------- boot ----------------
async function boot() {
  const info = await api('/api/project');
  S.files = info.files;
  S.claude.installed = info.claude.installed;
  S.claude.running = info.running;
  S.ffmpeg = info.ffmpeg;
  document.title = `${info.project?.title || info.name} — Cutroom`;
  if (info.error || !info.project) {
    toast(info.error || 'project.json is missing', 'err');
    return;
  }
  projectJsonText = JSON.stringify(info.project);
  await applyProject(info.project);
  notes.setNotes(info.notes);
  editor.setFiles(info.files);
  chat.renderEmpty();
  setRunning(info.running);
  connectEvents();
  restoreUi();
}

async function applyProject(project) {
  await loadProject(project);
  $('#project-title').textContent = project.title || 'Untitled';
  $('#project-meta').textContent = `${S.w}×${S.h} · ${S.fps} fps · ${fmt(S.duration, 1)}`;
  const sig = JSON.stringify(project.audio || []);
  if (sig !== audioSig) { audioSig = sig; await loadAudio(); renderSounds(); }
  sizeView();
  needsRender = true;
}

// ---------------- live updates ----------------
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('file', e => onFile(JSON.parse(e.data)));
  es.addEventListener('notes', e => notes.setNotes(JSON.parse(e.data)));
  es.addEventListener('claude', e => onClaude(JSON.parse(e.data)));
  es.addEventListener('reload', async () => { await reloadPreview(['project.json']); editor.refreshIfOpen(editor.currentPath()); toast('Restored ✓'); });
  es.addEventListener('hello', e => { const d = JSON.parse(e.data); setRunning(d.running); });
  es.onerror = () => { $('#live-pill span').textContent = 'Reconnecting…'; };
  es.onopen = () => updatePill();
}

const reloadQueue = new Set();
let reloadTimer = null;
function onFile({ path, exists }) {
  if (exists && !S.files.includes(path)) { S.files.push(path); S.files.sort(); editor.setFiles(S.files); }
  if (!exists) { S.files = S.files.filter(f => f !== path); editor.setFiles(S.files); }
  if (cursor.onFileChanged(path)) return; // Claude's cursor is still "typing" — reload when it finishes
  reloadQueue.add(path);
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { const p = [...reloadQueue]; reloadQueue.clear(); reloadPreview(p); }, 40);
  editor.refreshIfOpen(path);
}

async function reloadPreview(paths) {
  if (paths.includes('project.json')) {
    try {
      const txt = await api('/api/file?path=project.json');
      const project = JSON.parse(txt);
      projectJsonText = JSON.stringify(project);
      await applyProject(project);
    } catch (e) {
      toast(`project.json: ${e.message}`, 'err');
      return;
    }
  } else if (paths.some(p => /\.(m?js)$/.test(p))) {
    await loadProject(S.project);
    needsRender = true;
  } else if (paths.some(p => (S.project?.audio || []).some(a => a.file === p))) {
    await loadAudio();
  }
  needsRender = true;
  drawTimeline();
}

// ---------------- Claude ----------------
function setRunning(on) {
  S.claude.running = on;
  chat.setRunning(on);
  $('#stage').classList.toggle('claude-on', on);
  updatePill();
  notes.renderList();
}

function onClaude(ev) {
  if (ev.kind === 'start') setRunning(true);
  if (ev.kind === 'end') {
    setRunning(false);
    const fixed = S.notes.filter(n => n.status === 'fixed' && Date.now() - n.updated < 10 * 60 * 1000);
    if (ev.code === 0) toast(fixed.length ? `Claude finished — ${fixed.length} note${fixed.length > 1 ? 's' : ''} fixed` : 'Claude finished');
    // anything left "queued"/"fixing" after the run goes back to open
    for (const n of S.notes) if (n.status === 'queued' || n.status === 'fixing') api(`/api/notes/${n.id}`, { method: 'PUT', body: { status: 'open' } }).catch(() => {});
  }
  if (ev.kind === 'marker' && ev.state === 'fixing') { const n = notes.getNote(ev.id); if (n) flashClaudeAt(n.t); }
  chat.onClaude(ev);
  cursor.onClaude(ev);
}

function updatePill() {
  const pill = $('#live-pill');
  const errs = [...errors.values()];
  pill.className = 'live-pill';
  if (S.claude.running) { pill.classList.add('working'); pill.querySelector('span').textContent = 'Claude is editing · preview updates live'; }
  else if (errs.length) { pill.classList.add('error'); pill.querySelector('span').textContent = `${errs.length} scene error${errs.length > 1 ? 's' : ''}`; }
  else pill.querySelector('span').textContent = 'Live preview · from code, no render';
}

bus.on('errors', () => {
  updatePill();
  editor.setErrors(errors);
  const card = $('#error-card');
  const e = [...errors.values()][0];
  const at = sceneAt(S.t);
  if (e && (!at || at.scene.id === e.scene || errors.size)) {
    card.classList.remove('hidden');
    card.innerHTML = `<pre>${esc(e.sceneName)} · ${esc(e.file)}${e.line ? `:${e.line}` : ''}\n${esc(e.message)}</pre>
      <button class="outline small" id="err-open">Open</button><button class="primary small" id="err-fix">Ask Claude to fix</button>`;
    $('#err-open').onclick = () => openFile(e.file);
    $('#err-fix').onclick = () => chat.send({ message: `The preview crashes: ${e.message} (in ${e.file}${e.line ? ` line ${e.line}` : ''}, scene "${e.sceneName}"). Please fix it.` });
  } else card.classList.add('hidden');
});

// ---------------- stage + playback ----------------
function sizeView() {
  const wrap = $('#stage-wrap');
  const pad = 32;
  const aw = wrap.clientWidth - pad, ah = wrap.clientHeight - pad;
  const ar = S.w / S.h;
  let w = aw, h = aw / ar;
  if (h > ah) { h = ah; w = ah * ar; }
  const st = $('#stage');
  st.style.width = `${Math.max(10, Math.floor(w))}px`;
  st.style.height = `${Math.max(10, Math.floor(h))}px`;
  const q = S.quality;
  const cw = Math.round(S.w * q), ch = Math.round(S.h * q);
  if (view.width !== cw || view.height !== ch) { view.width = cw; view.height = ch; }
  needsRender = true;
}
new ResizeObserver(sizeView).observe($('#stage-wrap'));
bus.on('layout', sizeView);

function seek(t) {
  S.t = clamp(t, 0, S.duration);
  needsRender = true;
  if (S.playing) syncAudio(true);
}
function play() {
  if (S.playing) return;
  if (S.t >= S.duration - 1e-3) S.t = S.section.in ?? 0;
  if (S.selectedNote != null) notes.selectNote(null);
  S.playing = true;
  document.body.classList.add('playing');
  lastTs = performance.now();
  syncAudio(true);
}
function pause() {
  if (!S.playing) return;
  S.playing = false;
  document.body.classList.remove('playing');
  // snap to frame
  S.t = Math.round(S.t * S.fps) / S.fps;
  syncAudio();
  needsRender = true;
}
const toggle = () => (S.playing ? pause() : play());

let lastSceneId = null;
function frame(ts) {
  if (S.playing) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * S.speed;
    S.t += dt;
    const { in: si, out: so } = S.section;
    if (si != null && so != null && S.t >= so && S.t - dt < so + 0.001) { S.t = si; syncAudio(true); }
    else if (S.t >= S.duration) {
      if (S.loop) { S.t = 0; syncAudio(true); } else { S.t = S.duration; pause(); }
    }
    syncAudio();
    needsRender = true;
    timelineFollow();
  }
  lastTs = ts;
  if (needsRender && S.scenes.length) {
    needsRender = false;
    renderFrame(vctx, S.t, { scale: S.quality });
    $('#tc').textContent = fmt(S.t);
    $('#fc').textContent = Math.round(S.t * S.fps);
    drawTimeline();
    const at = sceneAt(S.t);
    chat.updateContext(S.t, at?.scene);
    if (at && at.scene.id !== lastSceneId) { lastSceneId = at.scene.id; if (!S.playing) editor.followPlayhead(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- snapshots for notes ----------------
async function snapshot(t, shapes, id) {
  const W = 1280, H = Math.round(1280 * S.h / S.w);
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  renderFrame(ctx, t, { scale: W / S.w, captions: S.cc });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draw.drawShapes(ctx, shapes, W, H);
  // label
  const label = `#${id} · ${fmt(t)} · frame ${Math.round(t * S.fps)}`;
  ctx.font = '600 20px "JetBrains Mono", monospace';
  const lw = ctx.measureText(label).width + 20;
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(12, 12, lw, 34);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, 22, 30);
  return c.convertToBlob({ type: 'image/png' });
}

function notePoint(note) {
  const st = $('#stage').getBoundingClientRect();
  if (note.pin) return draw.toScreen(note.pin);
  return { x: st.left + st.width / 2, y: st.top + st.height / 2 };
}

// ---------------- tools ----------------
function setTool(t) {
  S.tool = t;
  $$('#tools [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  draw.setTool(t);
}
$$('#tools [data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#color').addEventListener('input', e => { S.color = e.target.value; $('#color-dot').style.background = S.color; });
$('#undo').addEventListener('click', () => draw.undo());
$('#redo').addEventListener('click', () => draw.redo());

draw.initDraw({
  onPin: (shape, e) => { if (!notes.isComposerOpen()) notes.openComposer({ x: e.clientX, y: e.clientY }); },
  onShape: e => { if (!notes.isComposerOpen()) notes.openComposer({ x: e.clientX, y: e.clientY }); },
});
bus.on('drawing-start', () => { pause(); if (S.selectedNote != null && !notes.isComposerOpen()) { S.selectedNote = null; draw.show(null); notes.renderList(); } });

// ---------------- transport ----------------
$('#t-play').addEventListener('click', toggle);
$('#t-start').addEventListener('click', () => seek(S.section.in ?? 0));
$('#t-end').addEventListener('click', () => seek(S.section.out ?? S.duration));
$('#t-back').addEventListener('click', () => seek(S.t - 5));
$('#t-prev').addEventListener('click', () => { pause(); seek(Math.round(S.t * S.fps - 1) / S.fps); });
$('#t-next').addEventListener('click', () => { pause(); seek(Math.round(S.t * S.fps + 1) / S.fps); });
$('#speed').addEventListener('change', e => { S.speed = +e.target.value; syncAudio(true); });
$('#quality').addEventListener('change', e => { S.quality = +e.target.value; sizeView(); saveUi(); });
$('#t-loop').addEventListener('click', () => { S.loop = !S.loop; $('#t-loop').classList.toggle('on', S.loop); saveUi(); });
$('#t-mute').addEventListener('click', () => { S.muted = !S.muted; $('#t-mute').classList.toggle('on', S.muted); syncAudio(); saveUi(); });
$('#t-cc').addEventListener('click', () => { S.cc = !S.cc; $('#t-cc').classList.toggle('on', S.cc); needsRender = true; saveUi(); });
$('#add-note').addEventListener('click', () => { pause(); draw.clearDraft(); notes.openComposer(null); });

function setSection(a, b) {
  S.section.in = a; S.section.out = b;
  $('#sec-in').classList.toggle('set', a != null);
  $('#sec-out').classList.toggle('set', b != null);
  $('#sec-in').textContent = a != null ? `[ ${fmt(a)}` : '[ Section start';
  $('#sec-out').textContent = b != null ? `${fmt(b)} ]` : 'Section end ]';
  $('#sec-clear').classList.toggle('hidden', a == null && b == null);
  bus.emit('section');
}
$('#sec-in').addEventListener('click', () => setSection(S.t, S.section.out != null && S.section.out > S.t ? S.section.out : null));
$('#sec-out').addEventListener('click', () => setSection(S.section.in != null && S.section.in < S.t ? S.section.in : 0, S.t));
$('#sec-clear').addEventListener('click', () => setSection(null, null));

// ---------------- side tabs ----------------
function showTab(name) {
  $$('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}
$$('#side-tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

function renderSounds() {
  const tracks = getTracks();
  $('#sounds-list').innerHTML = tracks.length ? tracks.map((tr, i) => `<div class="sound-card" data-i="${i}"><div class="sh">${esc(tr.def.name || tr.def.file)}<span>${fmt(+tr.def.start || 0)} · vol ${tr.def.volume ?? 1}</span></div><div class="hint">${esc(tr.def.file)}</div></div>`).join('')
    : '<div class="empty">No sounds yet.</div>';
}
bus.on('audio', renderSounds);

// ---------------- modules ----------------
initTimeline({
  seek: t => { seek(t); },
  selectNote: id => { notes.selectNote(id); showTab('notes'); },
  selectScene: sc => { editor.toggle(true); openFile(sc.file); },
  setSection,
});
editor.initEditor();
notes.initNotes({
  seek, pause, snapshot,
  sendToClaude: ids => chat.send({ noteIds: ids }),
});
chat.initChat({
  context: () => {
    const at = sceneAt(S.t);
    const e = [...errors.values()][0];
    return { t: S.t, scene: at ? { id: at.scene.id, name: at.scene.name, file: at.scene.file, local: at.local } : null, error: e ? `${e.message} (${e.file}${e.line ? `:${e.line}` : ''})` : null };
  },
  showTab,
  openFile,
  restore,
});
cursor.initCursor({
  isWatching: chat.isWatching,
  getNote: notes.getNote,
  selectNote: (id, o) => notes.selectNote(id, o),
  noteCardEl: notes.noteCardEl,
  notePoint,
  stageEl: () => $('#stage'),
  codeOpen: editor.isOpen,
  openCode: () => editor.toggle(true),
  reloadPreview: async paths => { await reloadPreview(paths); for (const p of paths) editor.refreshIfOpen(p); },
  flashStage: () => { const f = $('#stage-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
});

async function openFile(path) {
  if (!editor.isOpen()) editor.toggle(true);
  $('#code-follow').checked = false;
  await editor.open(path);
}

// ---------------- history / undo ----------------
async function restore(id) {
  if (S.claude.running) return toast('Stop Claude first');
  if (!confirm('Put every file back the way it was before this run? (Your notes are kept.)')) return;
  try {
    const r = await api(`/api/history/${id}/restore`, { body: {} });
    toast(r.changed.length ? `Restored ${r.changed.length} file${r.changed.length > 1 ? 's' : ''}` : 'Nothing to restore');
  } catch (e) { toast(e.message, 'err'); }
}
$('#btn-history').addEventListener('click', async () => {
  const list = await api('/api/history');
  const m = modal(`<h2>History</h2><p class="sub">A snapshot is taken before every Claude run. Restoring one puts all project files back (notes stay).</p>
    <div class="history-list">${list.length ? list.map(h => `<div class="history-item"><div class="hl"><div>${esc(h.label)}</div><span>${new Date(h.time).toLocaleString()} · ${h.count} files</span></div><button class="outline small" data-id="${h.id}">Restore</button></div>`).join('') : '<div class="empty">No snapshots yet — they appear after Claude\'s first run.</div>'}</div>
    <div class="actions"><button class="ghost" data-close>Close</button></div>`);
  m.el.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) m.close();
    const b = e.target.closest('[data-id]');
    if (b) { m.close(); restore(b.dataset.id); }
  });
});

// ---------------- export / help ----------------
$('#btn-export').addEventListener('click', () => openExport({ pause }));
function help() {
  const keys = [['Space', 'play / pause'], ['← →', 'previous / next frame (Shift = 1 s)'], ['J', 'back 5 s'], ['Home / End', 'start / end'], ['I / O', 'section start / end'],
    ['N', 'add note at playhead'], ['V P A R E T M X', 'note, pen, arrow, box, circle, text, marker, eraser'], ['Ctrl/⌘ Z', 'undo drawing'], ['C', 'captions'], ['L', 'loop'], ['U', 'mute'],
    ['Ctrl/⌘ E', 'show code'], ['/', 'talk to Claude'], ['Ctrl/⌘ Enter', 'save note (Shift = save & fix now)'], ['Esc', 'close / deselect']];
  const m = modal(`<h2>Shortcuts</h2><p class="sub">Everything you see is rendered live from <code>${esc(S.project?.title || '')}</code>'s code — edit it, or let Claude.</p>
    <div class="keys">${keys.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div><div class="actions"><button class="primary" data-close>Got it</button></div>`);
  m.el.querySelector('[data-close]').onclick = m.close;
}
$('#btn-help').addEventListener('click', help);
$('#live-pill').addEventListener('click', () => { const e = [...errors.values()][0]; if (e) { const sc = S.scenes.find(s => s.id === e.scene); if (sc) seek(sc.start + 0.01); openFile(e.file); } });

// ---------------- keyboard ----------------
document.addEventListener('keydown', e => {
  if (isTyping()) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? draw.redo() : draw.undo(); return; }
  if (mod && k.toLowerCase() === 'e') { e.preventDefault(); editor.toggle(); return; }
  if (mod) return;
  const step = e.shiftKey ? 1 : 1 / S.fps;
  switch (k) {
    case ' ': e.preventDefault(); toggle(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seek(Math.round((S.t - step) * S.fps) / S.fps); break;
    case 'ArrowRight': e.preventDefault(); pause(); seek(Math.round((S.t + step) * S.fps) / S.fps); break;
    case 'Home': seek(0); break;
    case 'End': seek(S.duration); break;
    case 'j': case 'J': seek(S.t - 5); break;
    case 'i': case 'I': $('#sec-in').click(); break;
    case 'o': case 'O': $('#sec-out').click(); break;
    case 'n': case 'N': e.preventDefault(); $('#add-note').click(); break;
    case 'c': case 'C': $('#t-cc').click(); break;
    case 'l': case 'L': $('#t-loop').click(); break;
    case 'u': case 'U': $('#t-mute').click(); break;
    case '/': e.preventDefault(); showTab('claude'); $('#chat-input').focus(); break;
    case '?': help(); break;
    case 'Escape':
      if (notes.isComposerOpen()) notes.closeComposer(true);
      else if (S.selectedNote != null) notes.selectNote(null);
      else draw.clearDraft();
      break;
    default: {
      const tool = { v: 'note', p: 'pen', a: 'arrow', r: 'box', e: 'circle', t: 'text', m: 'pin', x: 'eraser' }[k.toLowerCase()];
      if (tool) setTool(tool);
    }
  }
});

// ---------------- persisted UI prefs ----------------
function saveUi() {
  try { localStorage.setItem('cutroom.ui', JSON.stringify({ cc: S.cc, loop: S.loop, muted: S.muted, quality: S.quality, code: editor.isOpen() })); } catch {}
}
function restoreUi() {
  let ui = {};
  try { ui = JSON.parse(localStorage.getItem('cutroom.ui') || '{}'); } catch {}
  if (ui.cc === false) $('#t-cc').click();
  if (ui.loop) $('#t-loop').click();
  if (ui.muted) $('#t-mute').click();
  if (ui.quality) { S.quality = ui.quality; $('#quality').value = String(ui.quality); sizeView(); }
  if (ui.code) editor.toggle(true);
  $('#btn-code').addEventListener('click', saveUi);
}

boot().catch(e => { console.error(e); toast(`Failed to load: ${e.message}`, 'err'); });
