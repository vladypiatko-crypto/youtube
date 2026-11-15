// Loads scene modules from the project and renders any time t → pixels.
import { S, bus } from './util.js';

let version = Date.now() % 100000;
const off = { canvas: null, ctx: null }; // offscreen buffer for crossfades

export const errors = new Map(); // sceneId → { message, file, line, col, kind }

export function computeTimeline(project) {
  let start = 0;
  const scenes = (project.scenes || []).map((s, i) => {
    const sc = { ...s, index: i, id: s.id || `scene${i + 1}`, name: s.name || s.id || `Scene ${i + 1}`, duration: +s.duration || 1, start };
    sc.end = start + sc.duration;
    start = sc.end;
    return sc;
  });
  return { scenes, duration: start };
}

export async function loadProject(project) {
  const { scenes, duration } = computeTimeline(project);
  const prev = new Map(S.scenes.map(s => [s.id, s]));
  S.project = project;
  S.w = +project.width || 1920;
  S.h = +project.height || 1080;
  S.fps = +project.fps || 30;
  S.duration = duration;
  version++;
  await Promise.all(scenes.map(async sc => {
    try {
      const mod = await import(`/project/${sc.file}?v=${version}`);
      sc.render = mod.default || mod.render;
      if (typeof sc.render !== 'function') throw new Error(`${sc.file} has no default export render(ctx, t, s)`);
      errors.delete(sc.id);
    } catch (e) {
      // keep the last good render so the preview doesn't go black while Claude is mid-edit
      const old = prev.get(sc.id);
      if (old?.render && old.file === sc.file) sc.render = old.render, sc.stale = true;
      setError(sc, e, 'load');
    }
  }));
  S.scenes = scenes;
  if (S.t > duration) S.t = duration;
  bus.emit('project', S);
  bus.emit('errors', errors);
}

function setError(sc, e, kind) {
  const stack = String(e?.stack || '');
  const m = stack.match(/\/project\/([^?:\s)]+)(?:\?v=\d+)?:(\d+):(\d+)/);
  const info = {
    message: String(e?.message || e), kind, scene: sc.id, sceneName: sc.name,
    file: m ? m[1] : sc.file, line: m ? +m[2] : null, col: m ? +m[3] : null,
  };
  const had = errors.get(sc.id);
  errors.set(sc.id, info);
  if (!had || had.message !== info.message) bus.emit('errors', errors);
}

export function sceneAt(t) {
  const sc = S.scenes;
  if (!sc.length) return null;
  for (let i = 0; i < sc.length; i++) if (t < sc[i].end || i === sc.length - 1) return { scene: sc[i], local: Math.max(0, Math.min(sc[i].duration, t - sc[i].start)), index: i };
  return null;
}

function callScene(ctx, sc, local, t, w, h) {
  ctx.save();
  try {
    sc.render(ctx, local, { w, h, duration: sc.duration, p: local / sc.duration, frame: Math.round(t * S.fps), fps: S.fps, time: t, scene: sc });
    if (errors.has(sc.id) && errors.get(sc.id).kind === 'render') { errors.delete(sc.id); bus.emit('errors', errors); }
  } catch (e) {
    setError(sc, e, 'render');
    ctx.restore(); ctx.save();
    drawErrorFrame(ctx, w, h, sc, e);
  }
  ctx.restore();
}

function drawErrorFrame(ctx, w, h, sc, e) {
  ctx.fillStyle = '#1a0b0b'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,90,79,.15)'; ctx.lineWidth = 40;
  for (let x = -h; x < w; x += 120) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
  ctx.fillStyle = '#ff8f86'; ctx.font = `700 ${h * 0.045}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(`Scene "${sc.name}" crashed`, w / 2, h * 0.45);
  ctx.fillStyle = '#ffc9c4'; ctx.font = `${h * 0.026}px "JetBrains Mono", monospace`;
  ctx.fillText(String(e?.message || e).slice(0, 90), w / 2, h * 0.53);
}

/**
 * Render global time t into ctx. scale = canvas px per project px.
 */
export function renderFrame(ctx, t, { scale = 1, captions = S.cc } = {}) {
  const w = S.w, h = S.h;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = S.project?.background || '#000';
  ctx.fillRect(0, 0, w, h);
  const at = sceneAt(t);
  if (!at) return;
  const { scene: sc, local, index } = at;
  const fade = +sc.fade || 0;
  const prev = S.scenes[index - 1];
  if (fade > 0 && local < fade && prev?.render) {
    // crossfade: previous scene underneath, current one faded in via an offscreen buffer
    callScene(ctx, prev, Math.min(prev.duration, t - prev.start), t, w, h);
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (!off.canvas || off.canvas.width !== cw || off.canvas.height !== ch) {
      off.canvas = new OffscreenCanvas(cw, ch);
      off.ctx = off.canvas.getContext('2d');
    }
    off.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    off.ctx.clearRect(0, 0, w, h);
    if (sc.render) callScene(off.ctx, sc, local, t, w, h);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = local / fade;
    ctx.drawImage(off.canvas, 0, 0);
    ctx.restore();
  } else if (sc.render) {
    callScene(ctx, sc, local, t, w, h);
  } else {
    drawErrorFrame(ctx, w, h, sc, errors.get(sc.id)?.message || 'failed to load');
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (captions) drawCaption(ctx, t, w, h);
}

export function captionAt(t) {
  return (S.project?.captions || []).find(c => t >= c.start && t < c.end);
}

function drawCaption(ctx, t, w, h) {
  const c = captionAt(t);
  if (!c) return;
  const fadeIn = Math.min(1, (t - c.start) / 0.15), fadeOut = Math.min(1, (c.end - t) / 0.15);
  const size = Math.round(h * 0.036);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
  ctx.font = `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // wrap
  const maxW = w * 0.72, words = String(c.text).split(/\s+/), lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  const lh = size * 1.35, padX = size * 0.7, padY = size * 0.45;
  const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
  const boxH = lines.length * lh + padY * 2;
  const y0 = h * 0.9 - boxH;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(w / 2 - boxW / 2, y0, boxW, boxH, size * 0.35) : ctx.rect(w / 2 - boxW / 2, y0, boxW, boxH);
  ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + padY + lh * i + lh / 2));
  ctx.restore();
}
