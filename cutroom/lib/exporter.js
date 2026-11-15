// Receives JPEG frames rendered by the browser (deterministic, frame by frame) and pipes them
// into ffmpeg, mixing in the project's audio tracks. Output: exports/<title>-<time>.mp4
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.CUTROOM_FFMPEG || 'ffmpeg';
let ffOk = null;
export function ffmpegAvailable() {
  if (ffOk !== null) return Promise.resolve(ffOk);
  return new Promise(r => execFile(FFMPEG, ['-version'], { timeout: 10000 }, err => r(ffOk = !err)));
}

export class Exporter {
  constructor({ projectDir, onProgress }) {
    this.dir = projectDir;
    this.onProgress = onProgress;
    this.job = null;
  }

  async start({ fps, width, height, from = 0, duration, audio = [], title = 'film' }) {
    if (this.job) this.cancel();
    if (!(await ffmpegAvailable())) throw Object.assign(new Error('ffmpeg not found'), { status: 501 });
    const outDir = path.join(this.dir, 'exports');
    await fsp.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `${String(title).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'film'}-${stamp}.mp4`;
    const out = path.join(outDir, name);

    const args = ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
    const tracks = [];
    for (const a of audio) {
      const abs = path.resolve(this.dir, a.file);
      if (!abs.startsWith(this.dir) || !fs.existsSync(abs)) continue;
      const start = +a.start || 0;
      if (start >= from + duration) continue;
      args.push('-i', abs);
      tracks.push({ ...a, start, idx: tracks.length + 1 });
    }
    if (tracks.length) {
      const chains = tracks.map(t => {
        const skip = Math.max(0, from - t.start);
        const delay = Math.round(Math.max(0, t.start - from) * 1000);
        const fade = [];
        if (t.fadeIn) fade.push(`afade=t=in:st=0:d=${t.fadeIn}`);
        return `[${t.idx}:a]atrim=start=${skip.toFixed(3)},asetpts=PTS-STARTPTS,${fade.length ? fade.join(',') + ',' : ''}adelay=${delay}:all=1,volume=${t.volume ?? 1}[a${t.idx}]`;
      });
      const mix = tracks.length > 1
        ? `${tracks.map(t => `[a${t.idx}]`).join('')}amix=inputs=${tracks.length}:normalize=0:duration=longest[aout]`
        : `[a${tracks[0].idx}]anull[aout]`;
      args.push('-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    }
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-vf', `scale=${width}:${height}:flags=lanczos`, '-movflags', '+faststart', '-t', duration.toFixed(3), out);

    const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    const done = new Promise(resolve => proc.on('close', code => resolve({ code, err })));
    proc.stdin.on('error', () => {});
    this.job = { proc, out, name, done, total: Math.round(duration * fps), count: 0, started: Date.now() };
    this.onProgress({ state: 'rendering', done: 0, total: this.job.total });
    return { ok: true, total: this.job.total, name };
  }

  async frame(buf) {
    const j = this.job;
    if (!j) throw Object.assign(new Error('no export running'), { status: 409 });
    j.count++;
    if (!j.proc.stdin.write(buf)) await new Promise(r => j.proc.stdin.once('drain', r));
    if (j.count % 10 === 0 || j.count === j.total) this.onProgress({ state: 'rendering', done: j.count, total: j.total });
  }

  async finish() {
    const j = this.job;
    if (!j) throw Object.assign(new Error('no export running'), { status: 409 });
    this.onProgress({ state: 'encoding', done: j.count, total: j.total });
    j.proc.stdin.end();
    const { code, err } = await j.done;
    this.job = null;
    if (code !== 0) {
      this.onProgress({ state: 'error', error: err.trim().split('\n').slice(-3).join('\n') });
      throw Object.assign(new Error(`ffmpeg failed: ${err.trim().slice(-400)}`), { status: 500 });
    }
    const size = (await fsp.stat(j.out)).size;
    const result = { state: 'done', file: `exports/${j.name}`, url: `/exports/${encodeURIComponent(j.name)}`, size, seconds: (Date.now() - j.started) / 1000 };
    this.onProgress(result);
    return result;
  }

  cancel() {
    if (!this.job) return;
    try { this.job.proc.kill('SIGKILL'); } catch {}
    fsp.rm(this.job.out, { force: true }).catch(() => {});
    this.job = null;
    this.onProgress({ state: 'cancelled' });
  }
}
