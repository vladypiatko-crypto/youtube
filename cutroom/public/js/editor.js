// Lightweight code editor: textarea over a highlighted <pre>. Also exposes the hooks
// Claude's cursor uses to "type" its edits on screen.
import { S, bus, $, api, toast } from './util.js';

const LINE_H = 20;
const PAD_TOP = 12, PAD_LEFT = 10;
const els = {};
let charW = 7.5;
const state = { path: null, text: '', saved: '', claude: false, errLine: null };

const KW = new Set('import export from default function return const let var if else for while of in new class extends this true false null undefined async await break continue switch case try catch throw typeof'.split(' '));

export function initEditor() {
  Object.assign(els, {
    drawer: $('#code-drawer'), main: $('#main'), file: $('#code-file'), follow: $('#code-follow'), stateEl: $('#code-state'),
    save: $('#code-save'), close: $('#code-close'), gutter: $('#gutter'), scroll: $('#code-scroll'), hl: $('#code-hl'),
    input: $('#code-input'), sel: $('#code-sel'), caret: $('#code-caret'),
  });
  // measure monospace char width
  const m = document.createElement('canvas').getContext('2d');
  m.font = getComputedStyle(els.hl).font || '12.5px monospace';
  charW = m.measureText('MMMMMMMMMM').width / 10;

  els.input.addEventListener('input', () => { state.text = els.input.value; paint(); dirty(); });
  els.input.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.input.selectionStart, en = els.input.selectionEnd;
      els.input.setRangeText('  ', s, en, 'end');
      state.text = els.input.value; paint(); dirty();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    e.stopPropagation();
  });
  els.scroll.addEventListener('scroll', () => { els.gutter.scrollTop = els.scroll.scrollTop; });
  els.save.addEventListener('click', save);
  els.close.addEventListener('click', () => toggle(false));
  els.file.addEventListener('change', () => open(els.file.value));
  $('#btn-code').addEventListener('click', () => toggle());
}

export const isOpen = () => els.main.classList.contains('code-open');
export function toggle(force) {
  const on = force ?? !isOpen();
  els.main.classList.toggle('code-open', on);
  $('#btn-code').classList.toggle('toggle', true);
  $('#btn-code').classList.toggle('on', on);
  setTimeout(() => bus.emit('layout'), 320);
  if (on && !state.path) followPlayhead(true);
}

export function setFiles(files) {
  const text = files.filter(f => /\.(js|mjs|json|md|txt|css|glsl|frag|vert)$/i.test(f));
  els.file.innerHTML = text.map(f => `<option value="${f}">${f}</option>`).join('');
  if (state.path) els.file.value = state.path;
}

export function currentPath() { return state.path; }
export function currentText() { return state.text; }

export async function open(path, { text, keepScroll = false } = {}) {
  if (state.path && state.path !== path && state.text !== state.saved && !state.claude) {
    if (!confirm(`Discard unsaved changes to ${state.path}?`)) { els.file.value = state.path; return; }
  }
  const content = text ?? await api(`/api/file?path=${encodeURIComponent(path)}`).catch(() => '');
  const samePath = state.path === path;
  state.path = path; state.text = content; state.saved = content;
  if (![...els.file.options].some(o => o.value === path)) els.file.insertAdjacentHTML('beforeend', `<option value="${path}">${path}</option>`);
  els.file.value = path;
  els.input.value = content;
  if (!(samePath && keepScroll)) els.scroll.scrollTop = 0;
  updateErrLine();
  paint(); dirty();
}

/** Reload from disk if the file changed and the user has no unsaved edits. */
export async function refreshIfOpen(path) {
  if (path !== state.path || state.claude) return;
  if (state.text !== state.saved) { setStatus('changed on disk — save to overwrite, or reopen', 'dirty'); return; }
  const content = await api(`/api/file?path=${encodeURIComponent(path)}`).catch(() => null);
  if (content != null && content !== state.text) {
    const top = els.scroll.scrollTop;
    await open(path, { text: content, keepScroll: true });
    els.scroll.scrollTop = top;
  }
}

export function followPlayhead(force = false) {
  if (!force && (!els.follow.checked || !isOpen() || state.claude)) return;
  const sc = S.scenes.find(s => S.t >= s.start && S.t < s.end) || S.scenes[S.scenes.length - 1];
  if (sc && sc.file !== state.path && (state.text === state.saved)) open(sc.file);
}

async function save() {
  if (!state.path || state.claude) return;
  try {
    await api(`/api/file?path=${encodeURIComponent(state.path)}`, { method: 'PUT', body: state.text });
    state.saved = state.text;
    dirty();
    setStatus('saved · preview updated', '');
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
}

function dirty() {
  const d = state.text !== state.saved;
  els.save.disabled = !d || state.claude;
  if (!state.claude) setStatus(d ? '● unsaved — ⌘/Ctrl+S' : '', d ? 'dirty' : '');
}
export function setStatus(text, cls = '') { els.stateEl.textContent = text; els.stateEl.className = `code-state ${cls}`; }

export function setErrors(errors) {
  state.errors = errors;
  updateErrLine();
  paint();
}
function updateErrLine() {
  state.errLine = null;
  for (const e of state.errors?.values?.() || []) if (e.file === state.path && e.line) state.errLine = e.line;
}

// ---------- highlighting ----------
function highlight(src) {
  const out = [];
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)|([{}()[\];,.=+\-*/<>!?:&|%^~])/g;
  let last = 0, m;
  const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(e(src.slice(last, m.index)));
    if (m[1]) out.push(`<span class="c">${e(m[1])}</span>`);
    else if (m[2]) out.push(`<span class="s">${e(m[2])}</span>`);
    else if (m[3]) out.push(`<span class="n">${m[3]}</span>`);
    else if (m[4]) out.push(KW.has(m[4]) ? `<span class="k">${m[4]}</span>` : `<span class="f">${m[4]}</span>`);
    else if (m[5]) out.push(KW.has(m[5]) ? `<span class="k">${m[5]}</span>` : (m[5] === 'ctx' || m[5] === 'Math' ? `<span class="b">${m[5]}</span>` : m[5]));
    else if (m[6]) out.push(`<span class="p">${e(m[6])}</span>`);
    last = re.lastIndex;
  }
  out.push(e(src.slice(last)));
  return out.join('');
}

let flashLines = null;
function paint() {
  let html = highlight(state.text);
  const lines = html.split('\n');
  // spans can cross lines (block comments / template strings) — they still render fine in a <pre>
  const errL = state.errLine;
  if (errL && lines[errL - 1] != null) lines[errL - 1] = `<span class="line-err">${lines[errL - 1] || ' '}</span>`;
  if (flashLines) for (let i = flashLines[0]; i <= flashLines[1]; i++) if (lines[i] != null && i !== errL - 1) lines[i] = `<span class="flash-line">${lines[i] || ' '}</span>`;
  els.hl.innerHTML = lines.join('\n') + '\n';
  const n = state.text.split('\n').length;
  let g = '';
  for (let i = 1; i <= n; i++) g += i === errL ? `<div class="err">${i}</div>` : `<div>${i}</div>`;
  els.gutter.innerHTML = g;
  els.input.style.height = `${Math.max(els.scroll.clientHeight, (n + 3) * LINE_H + PAD_TOP)}px`;
  els.input.style.width = `${Math.max(els.scroll.clientWidth, els.hl.scrollWidth)}px`;
}

// ---------- Claude typing API ----------
function lineCol(offset) {
  const before = state.text.slice(0, offset);
  const line = before.split('\n').length - 1;
  const lineStart = before.lastIndexOf('\n') + 1;
  const colText = before.slice(lineStart).replace(/\t/g, '  ');
  return { line, col: colText.length };
}
/** Screen coords for a character offset (scrolls it into view first). */
export function locate(offset, { scroll = true } = {}) {
  const { line, col } = lineCol(offset);
  const y = PAD_TOP + line * LINE_H, x = PAD_LEFT + col * charW;
  if (scroll) {
    const sc = els.scroll;
    if (y < sc.scrollTop + 30 || y > sc.scrollTop + sc.clientHeight - 60) sc.scrollTop = Math.max(0, y - sc.clientHeight * 0.35);
    if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.5);
  }
  const r = els.scroll.getBoundingClientRect();
  return { x: r.left + x - els.scroll.scrollLeft, y: r.top + y - els.scroll.scrollTop + LINE_H * 0.7, line, col, localX: x, localY: y };
}

export function claudeMode(on, label = '') {
  state.claude = on;
  els.input.readOnly = on;
  els.drawer.classList.toggle('claude-edit', on);
  if (on) setStatus(label || 'Claude is editing…', 'claude');
  else { hideSel(); hideCaret(); dirty(); els.scroll.scrollLeft = 0; }
}

export function showSel(start, end, del = false) {
  const a = lineCol(start), b = lineCol(end);
  const s = els.sel;
  s.classList.toggle('del', del);
  if (a.line === b.line) {
    Object.assign(s.style, { display: 'block', top: `${PAD_TOP + a.line * LINE_H}px`, left: `${PAD_LEFT + a.col * charW}px`, width: `${Math.max(2, (b.col - a.col) * charW)}px`, height: `${LINE_H}px` });
  } else {
    Object.assign(s.style, { display: 'block', top: `${PAD_TOP + a.line * LINE_H}px`, left: `${PAD_LEFT}px`, width: `${Math.max(els.hl.scrollWidth - PAD_LEFT * 2, 200)}px`, height: `${(b.line - a.line + 1) * LINE_H}px` });
  }
}
export function hideSel() { els.sel.style.display = 'none'; }
export function showCaret(offset) {
  const { line, col } = lineCol(offset);
  els.caret.classList.remove('hidden');
  Object.assign(els.caret.style, { top: `${PAD_TOP + line * LINE_H + 1}px`, left: `${PAD_LEFT + col * charW}px` });
}
export function hideCaret() { els.caret.classList.add('hidden'); }

/** Replace the editor text (used while Claude types). Doesn't touch the saved copy. */
export function setText(text) { state.text = text; els.input.value = text; paint(); }
export function markSaved(text) { state.text = text; state.saved = text; els.input.value = text; paint(); dirty(); }
export function flash(fromLine, toLine) {
  flashLines = [fromLine, toLine]; paint();
  setTimeout(() => { flashLines = null; paint(); }, 1400);
}
export function scrollEl() { return els.scroll; }
export function fileSelectEl() { return els.file; }
export async function scrollThrough(ms = 700) {
  const sc = els.scroll, max = sc.scrollHeight - sc.clientHeight;
  if (max <= 0) return;
  const t0 = performance.now();
  await new Promise(res => {
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      sc.scrollTop = max * (p < 0.5 ? p * 2 : 2 - p * 2) * 0.6;
      p < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
}
