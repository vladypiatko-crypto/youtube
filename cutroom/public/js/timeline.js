// Canvas timeline: ruler, scenes, notes, captions, audio waveforms, section, playhead.
import { S, bus, $, fmt, clamp } from './util.js';
import { getTracks } from './audio.js';

const LABEL_W = 92;
const RULER_H = 26;
const ROW = { scenes: 30, notes: 22, captions: 22, audio: 34 };
const NOTE_COLORS = { open: '#f4c152', queued: '#5aa2ff', fixing: '#d97757', fixed: '#4cc38a' };

let canvas, ctx, dpr = 1;
let view = { start: 0, pps: 0, fit: true }; // pixels per second
let hover = null;
let drag = null;
let claudeMark = null; // { t, until }

export function initTimeline({ seek, selectNote, selectScene, setSection }) {
  canvas = $('#tl');
  ctx = canvas.getContext('2d');
  const ro = new ResizeObserver(() => { resize(); draw(); });
  ro.observe(canvas);

  const tAtX = x => view.start + (x - LABEL_W) / view.pps;

  canvas.addEventListener('mousedown', e => {
    const { x, y } = pos(e);
    const hit = hitTest(x, y);
    if (e.shiftKey) { drag = { kind: 'section', from: clamp(tAtX(x), 0, S.duration) }; return; }
    if (hit?.kind === 'note') { selectNote(hit.note.id); return; }
    if (hit?.kind === 'scene' && e.detail === 2) { selectScene(hit.scene); return; }
    drag = { kind: 'scrub' };
    seek(clamp(tAtX(Math.max(LABEL_W, x)), 0, S.duration));
  });
  window.addEventListener('mousemove', e => {
    if (!drag) {
      const r = canvas.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) { if (hover) { hover = null; draw(); } return; }
      const { x, y } = pos(e);
      const h = hitTest(x, y);
      if ((h && h.key) !== (hover && hover.key)) { hover = h; canvas.style.cursor = h?.kind === 'note' ? 'pointer' : 'default'; draw(); }
      return;
    }
    const { x } = pos(e);
    const t = clamp(tAtX(Math.max(LABEL_W, x)), 0, S.duration);
    if (drag.kind === 'scrub') seek(t);
    else if (drag.kind === 'section') { setSection(Math.min(drag.from, t), Math.max(drag.from, t)); }
  });
  window.addEventListener('mouseup', () => { drag = null; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const { x } = pos(e);
    if (e.ctrlKey || e.metaKey) {
      const t = tAtX(x);
      const minPps = (canvas.clientWidth - LABEL_W - 20) / Math.max(1, S.duration);
      view.pps = clamp(view.pps * Math.exp(-e.deltaY * 0.0025), minPps, 600);
      view.fit = view.pps <= minPps * 1.001;
      view.start = t - (x - LABEL_W) / view.pps;
    } else {
      view.start += (e.deltaX || e.deltaY) / view.pps;
    }
    clampView();
    draw();
  }, { passive: false });

  bus.on('project', () => { if (view.fit) fit(); draw(); });
  bus.on('notes', draw);
  bus.on('audio', draw);
  bus.on('section', draw);
}

function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  if (view.fit) fit();
}
function fit() {
  view.pps = (canvas.clientWidth - LABEL_W - 20) / Math.max(1, S.duration);
  view.start = 0;
  view.fit = true;
}
function clampView() {
  const visible = (canvas.clientWidth - LABEL_W) / view.pps;
  view.start = clamp(view.start, 0, Math.max(0, S.duration - visible + 1 / view.pps * 20));
}
const xAt = t => LABEL_W + (t - view.start) * view.pps;

function rows() {
  const out = [];
  let y = RULER_H + 4;
  out.push({ id: 'scenes', label: 'Scenes', y, h: ROW.scenes }); y += ROW.scenes + 4;
  out.push({ id: 'notes', label: 'Notes', y, h: ROW.notes }); y += ROW.notes + 4;
  out.push({ id: 'captions', label: 'Captions', y, h: ROW.captions }); y += ROW.captions + 4;
  for (const tr of getTracks()) { out.push({ id: 'audio', label: tr.def.name || 'Audio', y, h: ROW.audio, track: tr }); y += ROW.audio + 4; }
  return out;
}

function hitTest(x, y) {
  if (x < LABEL_W) return null;
  const t = view.start + (x - LABEL_W) / view.pps;
  for (const r of rows()) {
    if (y < r.y || y > r.y + r.h) continue;
    if (r.id === 'notes') {
      let best = null, bd = 9;
      for (const n of S.notes) { const d = Math.abs(xAt(n.t) - x); if (d < bd) { bd = d; best = n; } }
      if (best) return { kind: 'note', note: best, key: `n${best.id}` };
    }
    if (r.id === 'scenes') {
      const sc = S.scenes.find(s => t >= s.start && t < s.end);
      if (sc) return { kind: 'scene', scene: sc, key: `s${sc.id}` };
    }
  }
  return null;
}

export function flashClaudeAt(t) { claudeMark = { t, until: performance.now() + 2500 }; draw(); }

export function draw() {
  if (!ctx) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // ruler
  const step = niceStep(80 / view.pps);
  ctx.fillStyle = '#8b8f9a';
  ctx.strokeStyle = '#2a2d35';
  ctx.lineWidth = 1;
  const t0 = Math.floor(view.start / step) * step;
  for (let t = t0; xAt(t) < W; t += step) {
    const x = Math.round(xAt(t)) + 0.5;
    if (x < LABEL_W) continue;
    ctx.beginPath(); ctx.moveTo(x, RULER_H - 8); ctx.lineTo(x, H); ctx.strokeStyle = '#1f2228'; ctx.stroke();
    ctx.fillText(fmt(t, step < 1 ? 1 : 0), x + 4, 11);
  }
  // minor ticks
  ctx.strokeStyle = '#2f333b';
  for (let t = t0; xAt(t) < W; t += step / 4) {
    const x = Math.round(xAt(t)) + 0.5;
    if (x < LABEL_W) continue;
    ctx.beginPath(); ctx.moveTo(x, RULER_H - 4); ctx.lineTo(x, RULER_H); ctx.stroke();
  }

  // section
  const { in: si, out: so } = S.section;
  if (si != null && so != null) {
    ctx.fillStyle = 'rgba(236,138,60,0.08)';
    ctx.fillRect(xAt(si), 0, (so - si) * view.pps, H);
    ctx.fillStyle = '#ec8a3c';
    ctx.fillRect(xAt(si), 0, 2, H); ctx.fillRect(xAt(so) - 2, 0, 2, H);
  } else if (si != null) { ctx.fillStyle = '#ec8a3c'; ctx.fillRect(xAt(si), 0, 2, H); }

  for (const r of rows()) {
    // label
    ctx.fillStyle = '#8b8f9a';
    ctx.fillText(r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label, 14, r.y + r.h / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(LABEL_W, r.y, W - LABEL_W, r.h); ctx.clip();
    if (r.id === 'scenes') drawScenes(r);
    else if (r.id === 'notes') drawNotes(r);
    else if (r.id === 'captions') drawCaptions(r);
    else if (r.id === 'audio') drawAudio(r);
    ctx.restore();
  }

  // Claude marker
  if (claudeMark && performance.now() < claudeMark.until) {
    const x = xAt(claudeMark.t);
    ctx.fillStyle = 'rgba(217,119,87,0.9)';
    ctx.fillRect(x - 1, 0, 2, H);
    requestAnimationFrame(draw);
  }

  // playhead
  const px = Math.round(xAt(S.t));
  if (px >= LABEL_W) {
    ctx.fillStyle = '#ff5a4f';
    ctx.fillRect(px - 1, 0, 2, H);
    ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
  }
  // label column divider
  ctx.fillStyle = '#262931';
  ctx.fillRect(LABEL_W - 8, 0, 1, H);
}

function drawScenes(r) {
  for (const sc of S.scenes) {
    const x = xAt(sc.start) + 1, w = sc.duration * view.pps - 2;
    const active = S.t >= sc.start && S.t < sc.end;
    const col = sc.color || '#6d5dfc';
    ctx.fillStyle = hexA(col, active ? 0.55 : 0.32);
    roundRect(x, r.y, w, r.h, 6); ctx.fill();
    if (active) { ctx.strokeStyle = hexA(col, 1); ctx.lineWidth = 1.5; roundRect(x + .5, r.y + .5, w - 1, r.h - 1, 6); ctx.stroke(); }
    if (sc.fade) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.moveTo(x, r.y + r.h); ctx.lineTo(x + sc.fade * view.pps, r.y); ctx.lineTo(x, r.y); ctx.fill(); }
    ctx.fillStyle = '#fff';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const label = `${sc.index + 1} · ${sc.name}`;
    if (w > 30) ctx.fillText(fitText(label, w - 16), x + 8, r.y + r.h / 2);
    ctx.font = '11px Inter, system-ui, sans-serif';
  }
}

function drawNotes(r) {
  for (const n of S.notes) {
    const x = xAt(n.t), cy = r.y + r.h / 2;
    const col = NOTE_COLORS[n.status] || NOTE_COLORS.open;
    if (n.t2 != null) { ctx.fillStyle = hexA(col, 0.25); ctx.fillRect(x, cy - 3, (n.t2 - n.t) * view.pps, 6); }
    const sel = S.selectedNote === n.id || hover?.note?.id === n.id;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, cy, sel ? 7 : 5.5, 0, Math.PI * 2); ctx.fill();
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  if (hover?.kind === 'note') {
    const n = hover.note, x = xAt(n.t);
    const label = `#${n.id} ${n.text.split('\n')[0]}`.slice(0, 48);
    ctx.font = '12px Inter, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 14;
    ctx.fillStyle = '#23252c'; roundRect(x + 10, r.y - 1, w, 22, 6); ctx.fill();
    ctx.fillStyle = '#e9e9ec'; ctx.fillText(label, x + 17, r.y + 10);
    ctx.font = '11px Inter, system-ui, sans-serif';
  }
}

function drawCaptions(r) {
  for (const c of S.project?.captions || []) {
    const x = xAt(c.start), w = (c.end - c.start) * view.pps;
    ctx.fillStyle = '#2a2d35'; roundRect(x + 1, r.y + 2, w - 2, r.h - 4, 4); ctx.fill();
    ctx.fillStyle = '#b5b8c2';
    if (w > 24) ctx.fillText(fitText(c.text, w - 12), x + 6, r.y + r.h / 2);
  }
}

function drawAudio(r) {
  const tr = r.track, start = +tr.def.start || 0;
  const dur = tr.duration || 0;
  const x0 = xAt(start), w = dur * view.pps;
  ctx.fillStyle = 'rgba(76,195,138,0.08)'; roundRect(x0, r.y, w, r.h, 5); ctx.fill();
  if (!tr.peaks) return;
  ctx.fillStyle = 'rgba(76,195,138,0.75)';
  const mid = r.y + r.h / 2;
  const fromX = Math.max(LABEL_W, x0), toX = Math.min(canvas.clientWidth, x0 + w);
  for (let x = fromX; x < toX; x += 2) {
    const t = (x - x0) / view.pps;
    const i = Math.floor(t * tr.peaksPerSec);
    const pk = tr.peaks[i] || 0;
    const hh = Math.max(1, pk * (r.h - 6) * (tr.def.volume ?? 1));
    ctx.fillRect(x, mid - hh / 2, 1.2, hh);
  }
}

function niceStep(min) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s >= min) return s;
  return 600;
}
function fitText(s, w) {
  if (ctx.measureText(s).width <= w) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s.length > 1 ? s + '…' : '';
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, Math.max(0, w), h, r) : ctx.rect(x, y, w, h); }
function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
/** Keep playhead visible while playing. */
export function follow() {
  if (view.fit) return;
  const W = canvas.clientWidth;
  const x = xAt(S.t);
  if (x > W - 40 || x < LABEL_W) { view.start = S.t - 2 / view.pps * 40; clampView(); }
}
