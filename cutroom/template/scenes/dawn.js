// Dawn: storm gone, sun rises, boats home. End card.
import { linear, radial, range, ease, text, tween, TAU, vignette } from '/kit.js';
import { drawLighthouse, drawSea, drawBoat } from './lighthouse.js';

export default function render(ctx, t, { w, h, duration }) {
  const sun = range(t, 0, duration * 0.8, ease.outCubic);
  const top = tween(sun, [[0, [40, 50, 90]], [1, [120, 170, 230]]]);
  const bottom = tween(sun, [[0, [200, 110, 90]], [1, [255, 214, 160]]]);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, `rgb(${top})`], [0.72, `rgb(${bottom})`]]);
  ctx.fillRect(0, 0, w, h);

  // sun
  const sy = h * 0.78 - sun * h * 0.28;
  ctx.fillStyle = radial(ctx, w * 0.7, sy, 0, 360, [[0, 'rgba(255,240,200,0.9)'], [0.25, 'rgba(255,200,120,0.5)'], [1, 'rgba(255,170,100,0)']]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff4d6';
  ctx.beginPath(); ctx.arc(w * 0.7, sy, 70, 0, TAU); ctx.fill();

  drawLighthouse(ctx, w * 0.25, h * 0.78, 0.95, { lampOn: 1 - sun, windowGlow: 1 - sun });
  drawSea(ctx, w, h, t * 0.6, { calm: 1, palette: ['#3d5a80', '#2e4766', '#22354d'] });

  // boats coming home into harbour (left)
  drawBoat(ctx, w * 0.62 - t * 40, h * 0.81, t, { scale: 0.6 });
  drawBoat(ctx, w * 0.85 - t * 55, h * 0.83, t + 1, { scale: 0.8 });

  // end card
  const card = range(t, 3.6, 4.6, ease.outCubic);
  text(ctx, 'Keep the light on.', w / 2, h * 0.32, { size: 88, weight: 700, color: '#1d2433', alpha: card, spacing: 2 });
  vignette(ctx, w, h, 0.35);
}
