// kit.js — tiny helper library for Cutroom scenes. Import with:
//   import { ease, tween, text, rng } from '/kit.js';
// Everything here is deterministic: same t → same pixels, which is what makes
// scrubbing, notes and frame-exact export work.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : clamp((v - a) / (b - a)));
/** 0→1 progress of t between a and b (clamped), optionally eased. */
export const range = (t, a, b, e = ease.linear) => e(invLerp(a, b, t));
export const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: t => 1 - Math.pow(1 - t, 4),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: t => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

/**
 * Keyframes: tween(t, [[0, 0], [1, 100, 'outCubic'], [2, 50]])
 * Each key is [time, value, easeIntoThisKey?]. Values can be numbers or arrays of numbers.
 */
export function tween(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const p = (ease[e] || (typeof e === 'function' ? e : ease.inOutCubic))((t - t0) / (t1 - t0));
      return Array.isArray(v0) ? mix(v0, v1, p) : lerp(v0, v1, p);
    }
  }
  return keys[keys.length - 1][1];
}

/** Fade multiplier: 0→1 over `inDur` at the start, 1→0 over `outDur` before `dur`. */
export const fadeInOut = (t, dur, inDur = 0.5, outDur = 0.5) =>
  Math.min(inDur ? clamp(t / inDur) : 1, outDur ? clamp((dur - t) / outDur) : 1);

/** Seeded random generator (mulberry32). Never use Math.random in scenes. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  return next;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise(x, seed = 0) {
  const h = n => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

/** Draw text. opts: size, weight, font, color, align, baseline, alpha, spacing, shadow, maxWidth */
export function text(ctx, str, x, y, o = {}) {
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.font = `${o.style || ''} ${o.weight || 600} ${o.size || 64}px ${o.font || 'Inter, "Segoe UI", system-ui, sans-serif'}`;
  ctx.fillStyle = o.color || '#fff';
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.baseline || 'middle';
  if (o.spacing) ctx.letterSpacing = `${o.spacing}px`;
  if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.shadowBlur ?? 24; }
  ctx.fillText(str, x, y, o.maxWidth);
  ctx.restore();
}

/** Characters of `str` visible after t seconds at `cps` chars/sec. */
export const typewriter = (str, t, cps = 24) => str.slice(0, Math.max(0, Math.floor(t * cps)));

export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
export function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

export function vignette(ctx, w, h, strength = 0.55) {
  ctx.save();
  ctx.fillStyle = radial(ctx, w / 2, h / 2, Math.min(w, h) * 0.35, Math.max(w, h) * 0.75, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${strength})`]]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Film grain that changes every frame but deterministically (seeded by frame). */
export function grain(ctx, w, h, frame, amount = 0.06) {
  const r = rng(frame * 9973 + 7);
  ctx.save();
  ctx.globalAlpha = amount;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = r() > 0.5 ? '#fff' : '#000';
    ctx.fillRect(r() * w, r() * h, 2, 2);
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

/** hsl helper → css string */
export const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
