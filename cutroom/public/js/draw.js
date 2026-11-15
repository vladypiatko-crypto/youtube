// Annotation layer over the preview: pen, arrow, box, circle, text, marker, eraser.
// Shapes are stored in normalised 0..1 frame coordinates so they survive any resize/export size.
import { S, bus, $, fmt } from './util.js';

let canvas, ctx;
let draft = [];          // shapes being drawn for the next note
let redoStack = [];
let showing = null;      // shapes of the selected note (read-only)
let live = null;         // shape in progress
let pulse = 0;

export function initDraw({ onShape, onPin }) {
  canvas = $('#overlay');
  ctx = canvas.getContext('2d');
  canvas.dataset.tool = S.tool;

  const norm = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = norm(e);
    const tool = S.tool;
    bus.emit('drawing-start');
    if (tool === 'note' || tool === 'pin') {
      const shape = { type: 'pin', at: p, color: S.color };
      commit(shape);
      onPin(shape, e);
      return;
    }
    if (tool === 'text') {
      const txt = prompt('Text to put on the frame:');
      if (txt) { commit({ type: 'text', at: p, text: txt, color: S.color }); onShape(e); }
      return;
    }
    if (tool === 'eraser') {
      const i = nearest(p);
      if (i >= 0) { redoStack = []; draft.splice(i, 1); render(); }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    live = tool === 'pen' ? { type: 'pen', pts: [p], color: S.color } : { type: tool, a: p, b: p, color: S.color };
    render();
  });
  canvas.addEventListener('pointermove', e => {
    if (!live) return;
    const p = norm(e);
    if (live.type === 'pen') live.pts.push(p); else live.b = p;
    render();
  });
  canvas.addEventListener('pointerup', e => {
    if (!live) return;
    const s = live; live = null;
    const tiny = s.type === 'pen' ? s.pts.length < 3 : Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 0.01;
    if (!tiny) { commit(s); onShape(e); } else render();
  });

  new ResizeObserver(resize).observe(canvas);
  const tick = () => { if (showing) { pulse += 0.05; render(); } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function commit(shape) { draft.push(shape); redoStack = []; render(); }
export function undo() { if (draft.length) { redoStack.push(draft.pop()); render(); return true; } return false; }
export function redo() { if (redoStack.length) { draft.push(redoStack.pop()); render(); return true; } return false; }
export function getDraft() { return draft.slice(); }
export function clearDraft() { draft = []; redoStack = []; render(); }
export function setDraft(shapes) { draft = (shapes || []).map(s => ({ ...s })); redoStack = []; render(); }
export function show(shapes) { showing = shapes && shapes.length ? shapes : null; pulse = 0; render(); }
export function setTool(t) { if (canvas) canvas.dataset.tool = t; }

/** Centre of the draft (or of given shapes) in 0..1 coords — used as the note's pin. */
export function anchorOf(shapes = draft) {
  const s = shapes[0];
  if (!s) return null;
  if (s.type === 'pin' || s.type === 'text') return s.at;
  if (s.type === 'pen') {
    const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  if (s.type === 'arrow') return s.b;
  return [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
}

function nearest(p) {
  let best = -1, bd = 0.04;
  draft.forEach((s, i) => {
    const pts = s.type === 'pen' ? s.pts : s.at ? [s.at] : [s.a, s.b, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]];
    for (const q of pts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } }
  });
  return best;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  render();
}

export function render() {
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  if (showing) {
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(pulse);
    drawShapes(ctx, showing, W, H);
    ctx.globalAlpha = 1;
  }
  drawShapes(ctx, draft, W, H);
  if (live) drawShapes(ctx, [live], W, H);
}

/** Shared by the overlay and the note snapshot renderer. */
export function drawShapes(c, shapes, W, H) {
  const lw = Math.max(2, W / 320);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const s of shapes) {
    c.strokeStyle = c.fillStyle = s.color || '#ff5a4f';
    c.lineWidth = lw;
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = lw * 2;
    const X = v => v[0] * W, Y = v => v[1] * H;
    if (s.type === 'pen') {
      c.beginPath();
      s.pts.forEach((p, i) => (i ? c.lineTo(X(p), Y(p)) : c.moveTo(X(p), Y(p))));
      c.stroke();
    } else if (s.type === 'box') {
      c.strokeRect(X(s.a), Y(s.a), X(s.b) - X(s.a), Y(s.b) - Y(s.a));
    } else if (s.type === 'circle') {
      const cx = (X(s.a) + X(s.b)) / 2, cy = (Y(s.a) + Y(s.b)) / 2;
      const rx = Math.abs(X(s.b) - X(s.a)) / 2, ry = Math.abs(Y(s.b) - Y(s.a)) / 2;
      c.beginPath(); c.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2); c.stroke();
    } else if (s.type === 'arrow') {
      const ax = X(s.a), ay = Y(s.a), bx = X(s.b), by = Y(s.b);
      const ang = Math.atan2(by - ay, bx - ax), head = lw * 5;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      c.beginPath(); c.moveTo(bx, by);
      c.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45));
      c.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45));
      c.closePath(); c.fill();
    } else if (s.type === 'text') {
      c.font = `700 ${Math.round(H * 0.045)}px Inter, system-ui, sans-serif`;
      c.textBaseline = 'middle';
      c.fillText(s.text, X(s.at), Y(s.at));
    } else if (s.type === 'pin') {
      const x = X(s.at), y = Y(s.at), r = Math.max(9, W / 110);
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x - r * 0.4, y - r * 1.1, x - r * 1.2, y - r * 1.6, x - r * 1.2, y - r * 2.3);
      c.arc(x, y - r * 2.3, r * 1.2, Math.PI, 0);
      c.bezierCurveTo(x + r * 1.2, y - r * 1.6, x + r * 0.4, y - r * 1.1, x, y);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x, y - r * 2.3, r * 0.45, 0, Math.PI * 2); c.fill();
    }
    c.shadowBlur = 0;
  }
}

/** Where on screen (px) a 0..1 point is, for the composer and Claude's cursor. */
export function toScreen(p) {
  const r = canvas.getBoundingClientRect();
  return { x: r.left + p[0] * r.width, y: r.top + p[1] * r.height };
}

export const label = (t) => `${fmt(t)} · frame ${Math.round(t * S.fps)}`;
