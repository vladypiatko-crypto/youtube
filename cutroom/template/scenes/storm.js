// The storm: rain, lightning, heavy sea. The lamp flickers but holds.
import { linear, rng, noise, clamp, vignette } from '/kit.js';
import { drawLighthouse, drawBeam, drawSea, drawBoat } from './lighthouse.js';

const drops = (() => { const r = rng(99); return Array.from({ length: 700 }, () => [r(), r(), r.range(0.6, 1.4)]); })();
const STRIKES = [1.3, 3.9, 4.25];

export default function render(ctx, t, { w, h, frame }) {
  // lightning brightness
  let flash = 0;
  for (const s of STRIKES) if (t >= s) flash = Math.max(flash, clamp(1 - (t - s) / 0.35));

  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#0b0e16'], [0.7, '#1c2333'], [1, '#121722']]);
  ctx.fillRect(0, 0, w, h);
  if (flash) { ctx.fillStyle = `rgba(200,215,255,${flash * 0.55})`; ctx.fillRect(0, 0, w, h); }

  // camera shake
  const sx = noise(t * 6, 1) * 6, sy = noise(t * 6, 2) * 4;
  ctx.save();
  ctx.translate(sx, sy);

  const lamp = clamp(0.75 + noise(t * 9, 3) * 0.35);
  const { lampX, lampY } = drawLighthouse(ctx, w * 0.62, h * 0.8, 1.05, { lampOn: lamp, windowGlow: lamp });
  drawBeam(ctx, lampX, lampY, 1.6 + t * 1.4, { alpha: 0.4 * lamp + 0.2 });
  drawBoat(ctx, w * 0.2, h * 0.8, t * 1.8, { scale: 0.75, rock: 3 });
  drawSea(ctx, w, h, t, { calm: 0, palette: ['#18213a', '#111a2e', '#0b1222'] });
  ctx.restore();

  // rain (wind-blown)
  ctx.strokeStyle = 'rgba(180,200,235,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [x0, y0, sp] of drops) {
    const y = ((y0 + t * 1.6 * sp) % 1) * (h + 100) - 50;
    const x = ((x0 + t * 0.35 * sp) % 1) * (w + 200) - 100;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 14 * sp, y + 38 * sp);
  }
  ctx.stroke();

  vignette(ctx, w, h, 0.7);
}
