// Title card: starfield, slow push-in, title + subtitle reveal.
import { text, range, ease, rng, vignette, linear, TAU } from '/kit.js';

const stars = (() => {
  const r = rng(42);
  return Array.from({ length: 260 }, () => ({ x: r(), y: r() * 0.85, s: r.range(0.6, 2.4), tw: r.range(0, TAU) }));
})();

export default function render(ctx, t, { w, h, duration }) {
  // sky
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#04050c'], [0.7, '#0b1430'], [1, '#14203f']]);
  ctx.fillRect(0, 0, w, h);

  // stars with a slow push-in
  const zoom = 1 + t * 0.02;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2, -h / 2);
  for (const s of stars) {
    const a = 0.45 + 0.55 * Math.sin(s.tw + t * 2.2);
    ctx.globalAlpha = a * range(t, 0, 1.2);
    ctx.fillStyle = '#dfe7ff';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // horizon glow
  ctx.fillStyle = linear(ctx, 0, h * 0.7, 0, h, [[0, 'rgba(80,110,200,0)'], [1, 'rgba(80,110,200,0.25)']]);
  ctx.fillRect(0, h * 0.7, w, h * 0.3);

  // title
  const inT = range(t, 0.6, 1.8, ease.outCubic);
  const out = 1 - range(t, duration - 0.7, duration);
  text(ctx, 'THE LAST KEEPER', w / 2, h / 2 - 20 + (1 - inT) * 30, {
    size: 132, weight: 800, spacing: 18 - inT * 6, alpha: inT * out, shadow: 'rgba(120,150,255,0.6)', shadowBlur: 40,
  });
  const subT = range(t, 1.6, 2.6, ease.outCubic);
  text(ctx, 'a short film made entirely of code', w / 2, h / 2 + 90, {
    size: 34, weight: 400, color: '#a9b6e0', spacing: 4, alpha: subT * out,
  });

  vignette(ctx, w, h, 0.6);
}
