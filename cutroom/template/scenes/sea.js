// Calm night sea. The beam sweeps; a fishing boat crosses right → left.
import { linear, rng, range, ease, TAU, vignette } from '/kit.js';
import { drawLighthouse, drawBeam, drawSea, drawBoat } from './lighthouse.js';

const stars = (() => { const r = rng(7); return Array.from({ length: 140 }, () => [r(), r() * 0.6, r.range(0.5, 1.8)]); })();

export default function render(ctx, t, { w, h, duration }) {
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#050814'], [0.72, '#13224a'], [1, '#0a1430']]);
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#cfd8ff';
  for (const [x, y, s] of stars) { ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(x * w, y * h, s, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;

  // moon
  ctx.fillStyle = '#f1ecd9';
  ctx.beginPath(); ctx.arc(w * 0.78, h * 0.2, 46, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(241,236,217,0.08)';
  ctx.beginPath(); ctx.arc(w * 0.78, h * 0.2, 120, 0, TAU); ctx.fill();

  // camera drifts slightly left
  const pan = range(t, 0, duration, ease.inOutSine) * 80;
  ctx.save();
  ctx.translate(-pan, 0);

  const { lampX, lampY } = drawLighthouse(ctx, w * 0.3, h * 0.78, 1);
  drawBeam(ctx, lampX, lampY, t * 1.1);
  drawSea(ctx, w + 200, h, t, { calm: 1 });

  const bx = w * 1.15 - range(t, 0, duration) * w * 0.6;
  drawBoat(ctx, bx, h * 0.8, t, { scale: 0.9 });
  ctx.restore();

  vignette(ctx, w, h, 0.5);
}
