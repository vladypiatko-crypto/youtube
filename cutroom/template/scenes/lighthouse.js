// Shared drawing helpers for the lighthouse (used by several scenes).
import { TAU, linear } from '/kit.js';

/** Draws the lighthouse standing on its rock. (x, baseY) = bottom centre. */
export function drawLighthouse(ctx, x, baseY, scale = 1, { lampOn = 1, windowGlow = 1 } = {}) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(scale, scale);

  // rock
  ctx.fillStyle = '#0d1018';
  ctx.beginPath();
  ctx.moveTo(-260, 0); ctx.quadraticCurveTo(-200, -70, -90, -80);
  ctx.lineTo(110, -86); ctx.quadraticCurveTo(220, -60, 280, 0);
  ctx.closePath(); ctx.fill();

  // tower (tapered, striped)
  const top = -470, botW = 70, topW = 44;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-botW, -80); ctx.lineTo(-topW, top); ctx.lineTo(topW, top); ctx.lineTo(botW, -80); ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#e9e4da'; ctx.fillRect(-botW, top, botW * 2, 400);
  ctx.fillStyle = '#b8322c';
  for (let i = 0; i < 3; i++) ctx.fillRect(-botW, -150 - i * 120, botW * 2, 55);
  // shading
  ctx.fillStyle = linear(ctx, -botW, 0, botW, 0, [[0, 'rgba(0,0,0,0.05)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0.55)']]);
  ctx.fillRect(-botW, top, botW * 2, 400);
  ctx.restore();

  // window
  ctx.fillStyle = `rgba(255,200,110,${0.25 + 0.75 * windowGlow})`;
  ctx.fillRect(-10, -300, 20, 34);

  // gallery + lantern room
  ctx.fillStyle = '#1b1e27';
  ctx.fillRect(-64, top - 10, 128, 14);
  ctx.fillStyle = `rgba(255,236,170,${0.2 + 0.8 * lampOn})`;
  ctx.fillRect(-34, top - 70, 68, 60);
  ctx.strokeStyle = '#1b1e27'; ctx.lineWidth = 5;
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 22, top - 70); ctx.lineTo(i * 22, top - 10); ctx.stroke(); }
  // roof
  ctx.fillStyle = '#1b1e27';
  ctx.beginPath(); ctx.moveTo(-46, top - 68); ctx.lineTo(0, top - 118); ctx.lineTo(46, top - 68); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, top - 122, 7, 0, TAU); ctx.fill();
  ctx.restore();
  return { lampX: x, lampY: baseY + (top - 40) * scale };
}

/** Rotating beam. angle in radians, 0 = pointing right. */
export function drawBeam(ctx, lx, ly, angle, { length = 2400, spread = 0.13, alpha = 0.55 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [0, Math.PI]) {
    const a = angle + side;
    // fake perspective: the beam is brightest when pointing at the camera (sin(a) ~ 1)
    const facing = 0.35 + 0.65 * Math.max(0, Math.cos(a));
    const g = ctx.createRadialGradient(lx, ly, 10, lx, ly, length);
    g.addColorStop(0, `rgba(255,240,190,${alpha * facing})`);
    g.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.arc(lx, ly, length, a - spread, a + spread);
    ctx.closePath();
    ctx.fill();
  }
  // lamp glow
  const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 140);
  glow.addColorStop(0, 'rgba(255,245,210,0.95)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(lx, ly, 140, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Layered sea. calm: 0 = storm, 1 = calm. */
export function drawSea(ctx, w, h, t, { horizon = 0.72, calm = 1, palette = ['#0a1630', '#081127', '#050b1c'] } = {}) {
  const layers = palette.length;
  for (let l = 0; l < layers; l++) {
    const y0 = h * horizon + l * h * 0.08;
    const amp = (6 + l * 10) * (1 + (1 - calm) * 3.2);
    const speed = (0.6 + l * 0.35) * (1 + (1 - calm) * 1.5);
    ctx.fillStyle = palette[l];
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 20; x += 20) {
      const y = y0 + Math.sin(x * 0.006 + t * speed + l * 1.7) * amp + Math.sin(x * 0.017 - t * speed * 1.3 + l) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
}

/** Little fishing boat with a cabin light. */
export function drawBoat(ctx, x, y, t, { scale = 1, rock = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 2.1) * 6 * rock);
  ctx.rotate(Math.sin(t * 1.7) * 0.05 * rock);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#121620';
  ctx.beginPath(); ctx.moveTo(-90, 0); ctx.lineTo(90, 0); ctx.lineTo(65, 34); ctx.lineTo(-70, 34); ctx.closePath(); ctx.fill();
  ctx.fillRect(-30, -40, 50, 40);
  ctx.fillRect(28, -110, 5, 110);
  ctx.fillStyle = 'rgba(255,200,110,0.9)';
  ctx.fillRect(-20, -30, 14, 12);
  ctx.restore();
}
