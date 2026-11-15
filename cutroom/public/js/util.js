// Shared state, event bus and small helpers.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const listeners = new Map();
export const bus = {
  on(evt, fn) { (listeners.get(evt) || listeners.set(evt, new Set()).get(evt)).add(fn); return () => listeners.get(evt).delete(fn); },
  emit(evt, data) { listeners.get(evt)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};

export const S = {
  project: null, scenes: [], duration: 0, fps: 30, w: 1920, h: 1080,
  t: 0, playing: false, speed: 1, loop: false, muted: false, cc: true, quality: 1,
  section: { in: null, out: null },
  notes: [], selectedNote: null,
  tool: 'note', color: '#ff5a4f',
  files: [], claude: { installed: false, running: false }, ffmpeg: false,
};

export function fmt(t, frac = 2) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(frac).padStart(frac ? 3 + frac : 2, '0')}`;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {} };
  if (opts.body !== undefined) {
    if (opts.body instanceof Blob || typeof opts.body === 'string') init.body = opts.body;
    else { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, init);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || res.statusText);
  return data;
}

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, kind === 'err' ? 5000 : 2600);
}

export function modal(html, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').append(back);
  return { el: back.firstElementChild, close };
}

export const isTyping = () => {
  const a = document.activeElement;
  return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'color' || a.tagName === 'SELECT' || a.isContentEditable);
};
