// Export: render every frame deterministically in the browser and stream it to ffmpeg on the server.
// Without ffmpeg, falls back to a real-time WebM recording via MediaRecorder.
import { S, api, modal, esc, fmt, $ } from './util.js';
import { renderFrame } from './engine.js';

export function openExport({ pause }) {
  pause();
  const hasSec = S.section.in != null && S.section.out != null;
  const hasCaps = (S.project?.captions || []).length > 0;
  const ar = S.w / S.h;
  const sizes = [[1920, Math.round(1920 / ar / 2) * 2], [1280, Math.round(1280 / ar / 2) * 2], [3840, Math.round(3840 / ar / 2) * 2]];
  const m = modal(`
    <h2>Export video</h2>
    <p class="sub">${S.ffmpeg ? 'Frame-perfect MP4 (H.264 + AAC), rendered from the same code as the preview.' : 'ffmpeg wasn\'t found, so this records a WebM in real time. Install ffmpeg for frame-perfect MP4.'}</p>
    <div class="row"><label>Resolution</label><select id="ex-size">${sizes.map(([w, h], i) => `<option value="${w}x${h}" ${i === 0 ? 'selected' : ''}>${w}×${h}${w === 3840 ? ' (4K, slow)' : ''}</option>`).join('')}</select></div>
    <div class="row"><label>Frame rate</label><select id="ex-fps"><option ${S.fps === 24 ? 'selected' : ''}>24</option><option ${S.fps === 30 ? 'selected' : ''}>30</option><option ${S.fps === 60 ? 'selected' : ''}>60</option></select></div>
    <div class="row"><label>Range</label><select id="ex-range"><option value="all">Whole film (${fmt(S.duration)})</option>${hasSec ? `<option value="sec">Section ${fmt(S.section.in)}–${fmt(S.section.out)}</option>` : ''}</select></div>
    <div class="row"><label>Captions</label><label><input type="checkbox" id="ex-cc" ${hasCaps && S.cc ? 'checked' : ''} ${hasCaps ? '' : 'disabled'}> burn into the video</label></div>
    <div id="ex-progress" class="hidden"><div class="progress"><i id="ex-bar"></i></div><div class="hint" id="ex-stat">Starting…</div></div>
    <div id="ex-done"></div>
    <div class="actions"><button class="ghost" id="ex-cancel">Close</button><button class="primary" id="ex-go">Export</button></div>
  `, { onClose: () => { cancelled = true; } });
  let cancelled = false;
  let active = false;
  const el = m.el;
  el.querySelector('#ex-cancel').onclick = () => {
    if (active) { cancelled = true; api('/api/export/cancel', { body: {} }).catch(() => {}); }
    m.close();
  };
  el.querySelector('#ex-go').onclick = async () => {
    const [w, h] = el.querySelector('#ex-size').value.split('x').map(Number);
    const fps = +el.querySelector('#ex-fps').value;
    const sec = el.querySelector('#ex-range').value === 'sec';
    const from = sec ? S.section.in : 0, to = sec ? S.section.out : S.duration;
    const captions = el.querySelector('#ex-cc').checked;
    el.querySelector('#ex-go').disabled = true;
    el.querySelector('#ex-progress').classList.remove('hidden');
    el.querySelector('#ex-done').innerHTML = '';
    active = true; cancelled = false;
    const bar = el.querySelector('#ex-bar'), stat = el.querySelector('#ex-stat');
    try {
      const result = S.ffmpeg
        ? await exportMp4({ w, h, fps, from, to, captions, onProgress: (d, n, eta) => { bar.style.width = `${(d / n) * 100}%`; stat.textContent = d < n ? `Rendering frame ${d} / ${n} · ~${eta}s left` : 'Encoding…'; }, isCancelled: () => cancelled })
        : await exportWebm({ w, h, fps, from, to, captions, onProgress: (d, n) => { bar.style.width = `${(d / n) * 100}%`; stat.textContent = `Recording ${fmt(d / fps)} / ${fmt(n / fps)}`; }, isCancelled: () => cancelled });
      if (!result) return;
      bar.style.width = '100%';
      stat.textContent = result.size ? `Done in ${result.seconds?.toFixed(1) ?? '?'}s · ${(result.size / 1e6).toFixed(1)} MB · ${esc(result.file || '')}` : 'Done';
      el.querySelector('#ex-done').innerHTML = `<video src="${result.url}" controls></video>
        <div class="actions"><button class="ghost" id="ex-reveal" ${result.file ? '' : 'disabled'}>Show in folder</button><a class="primary" style="text-decoration:none;display:inline-flex;align-items:center;padding:7px 13px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-weight:600" href="${result.download || result.url + '?download'}" download="${esc(result.name || 'film.webm')}">Download</a></div>`;
      el.querySelector('#ex-reveal')?.addEventListener('click', () => api('/api/reveal', { body: { path: result.file } }));
    } catch (e) {
      if (!cancelled) stat.textContent = `Export failed: ${e.message}`;
    } finally {
      active = false;
      el.querySelector('#ex-go').disabled = false;
    }
  };
}

async function exportMp4({ w, h, fps, from, to, captions, onProgress, isCancelled }) {
  const duration = to - from;
  const audio = (S.project?.audio || []);
  const { total } = await api('/api/export/start', { body: { fps, width: w, height: h, from, duration, audio, title: S.project?.title || 'film' } });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const scale = w / S.w;
  const t0 = performance.now();
  let inflight = Promise.resolve();
  for (let i = 0; i < total; i++) {
    if (isCancelled()) { await api('/api/export/cancel', { body: {} }).catch(() => {}); return null; }
    renderFrame(ctx, from + i / fps, { scale, captions });
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
    await inflight; // keep frames in order, but overlap encode of the next frame with upload of this one
    inflight = fetch('/api/export/frame', { method: 'POST', body: blob }).then(r => { if (!r.ok) throw new Error('frame upload failed'); });
    if (i % 5 === 0) {
      const el = (performance.now() - t0) / 1000;
      onProgress(i + 1, total, Math.round(el / (i + 1) * (total - i - 1)));
      await new Promise(r => setTimeout(r, 0));
    }
  }
  await inflight;
  onProgress(total, total, 0);
  const res = await api('/api/export/finish', { body: {} });
  return { ...res, name: res.file.split('/').pop(), download: `${res.url}?download` };
}

async function exportWebm({ w, h, fps, from, to, captions, onProgress, isCancelled }) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 12e6 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(250);
  const total = Math.round((to - from) * fps);
  const start = performance.now();
  await new Promise(resolve => {
    const step = () => {
      if (isCancelled()) return resolve();
      const el = (performance.now() - start) / 1000;
      const t = from + el;
      if (t >= to) return resolve();
      renderFrame(ctx, t, { scale: w / S.w, captions });
      onProgress(Math.round(el * fps), total);
      requestAnimationFrame(step);
    };
    step();
  });
  rec.stop();
  await stopped;
  if (isCancelled()) return null;
  const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  return { url, download: url, name: `${(S.project?.title || 'film').replace(/\W+/g, '-').toLowerCase()}.webm` };
}
