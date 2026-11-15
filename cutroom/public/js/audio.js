// Preview audio: one <audio> per track, kept in sync with the playhead. Also decodes peaks for waveforms.
import { S, bus } from './util.js';

const tracks = []; // { def, el, peaks, duration }
let actx = null;

export async function loadAudio() {
  for (const tr of tracks) { tr.el.pause(); tr.el.src = ''; }
  tracks.length = 0;
  const defs = S.project?.audio || [];
  for (const def of defs) {
    const el = new Audio(`/project/${def.file}?v=${Date.now()}`);
    el.preload = 'auto';
    const tr = { def, el, peaks: null, duration: 0 };
    el.addEventListener('loadedmetadata', () => { tr.duration = el.duration; bus.emit('audio', tracks); });
    tracks.push(tr);
    decodePeaks(tr).catch(() => {});
  }
  bus.emit('audio', tracks);
}

async function decodePeaks(tr) {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  const buf = await (await fetch(`/project/${tr.def.file}`)).arrayBuffer();
  const audio = await actx.decodeAudioData(buf);
  tr.duration = audio.duration;
  const data = audio.getChannelData(0);
  const perSec = 50, n = Math.ceil(audio.duration * perSec), step = Math.floor(data.length / n);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = j + step; j < e; j += 4) { const v = Math.abs(data[j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  tr.peaks = peaks; tr.peaksPerSec = perSec;
  bus.emit('audio', tracks);
}

export function getTracks() { return tracks; }

function volumeAt(tr, t) {
  const local = t - (+tr.def.start || 0);
  let v = tr.def.volume ?? 1;
  if (tr.def.fadeIn && local < tr.def.fadeIn) v *= Math.max(0, local / tr.def.fadeIn);
  return S.muted ? 0 : Math.max(0, Math.min(1, v));
}

/** Called every animation frame while playing, and on seek/pause. */
export function syncAudio(force = false) {
  for (const tr of tracks) {
    const start = +tr.def.start || 0;
    const local = S.t - start;
    const inside = local >= 0 && (!tr.duration || local < tr.duration);
    tr.el.volume = volumeAt(tr, S.t);
    tr.el.playbackRate = S.speed;
    if (S.playing && inside) {
      if (force || Math.abs(tr.el.currentTime - local) > 0.2) tr.el.currentTime = local;
      if (tr.el.paused) tr.el.play().catch(() => {});
    } else if (!tr.el.paused) tr.el.pause();
  }
}
