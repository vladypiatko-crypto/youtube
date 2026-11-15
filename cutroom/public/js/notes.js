// Notes panel + note composer.
import { S, bus, $, $$, api, fmt, esc, toast } from './util.js';
import { sceneAt } from './engine.js';
import * as draw from './draw.js';

let hooks = {};
let editing = null; // note id being edited, or null for new
let composerOpen = false;

export function initNotes(h) {
  hooks = h;
  $('#notes-filter').addEventListener('change', renderList);
  $('#send-notes').addEventListener('click', () => {
    const ids = S.notes.filter(n => n.status === 'open').map(n => n.id);
    if (ids.length) hooks.sendToClaude(ids);
  });
  $('#cmp-cancel').addEventListener('click', () => closeComposer(true));
  $('#cmp-save').addEventListener('click', () => saveComposer(false));
  $('#cmp-fix').addEventListener('click', () => saveComposer(true));
  $('#cmp-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveComposer(e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeComposer(true); }
    e.stopPropagation();
  });
  $('#notes-list').addEventListener('click', onListClick);
  bus.on('notes', renderList);
}

export function setNotes(items) {
  const prev = new Map(S.notes.map(n => [n.id, n.status]));
  S.notes = items.slice().sort((a, b) => a.t - b.t || a.id - b.id);
  bus.emit('notes', S.notes);
  for (const n of S.notes) if (prev.get(n.id) && prev.get(n.id) !== 'fixed' && n.status === 'fixed') {
    const c = noteCardEl(n.id);
    if (c) { c.classList.remove('just-fixed'); void c.offsetWidth; c.classList.add('just-fixed'); }
  }
}

export function renderList() {
  const filter = $('#notes-filter').value;
  const list = S.notes.filter(n => filter === 'all' ? true : filter === 'fixed' ? n.status === 'fixed' : n.status !== 'fixed');
  const open = S.notes.filter(n => n.status === 'open').length;
  $('#notes-count').textContent = S.notes.filter(n => n.status !== 'fixed').length;
  $('#send-count').textContent = `(${open})`;
  $('#send-notes').disabled = !open || S.claude.running;
  if (!list.length) {
    $('#notes-list').innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/></svg>${
      filter === 'fixed' ? 'Nothing fixed yet.' : 'No open notes.<br>Pause anywhere, click or draw on the frame,<br>say what\'s wrong — then send them to Claude.'}</div>`;
    return;
  }
  $('#notes-list').innerHTML = list.map(n => {
    const [title, ...rest] = n.text.split('\n');
    const statusLabel = { open: 'open', queued: 'queued', fixing: 'Claude is on it', fixed: 'fixed' }[n.status] || n.status;
    return `<div class="note-card ${n.status} ${S.selectedNote === n.id ? 'sel' : ''}" data-id="${n.id}">
      <div class="nh"><b>#${n.id}</b><span>${fmt(n.t)}${n.t2 != null ? `–${fmt(n.t2)}` : ''}</span><span class="kind">${esc(n.kind)}</span><span class="status ${n.status}">${statusLabel}</span></div>
      <div class="nt">${esc(title || '(no text)')}</div>
      ${rest.length ? `<div class="nx">${esc(rest.join(' '))}</div>` : n.scene ? `<div class="nx">${esc(n.scene.name)} · ${esc(n.scene.file)}</div>` : ''}
      ${n.snapshot ? `<img loading="lazy" src="/notes/${n.id}.png?u=${n.updated}" alt="">` : ''}
      <div class="na">
        <button data-act="edit">Edit</button><button data-act="del" class="del">Delete</button>
        ${n.status === 'fixed' ? '<button data-act="reopen">Reopen</button>' : ''}
        ${n.status !== 'fixed' && n.status !== 'fixing' ? '<button data-act="fix" class="fix">Fix with Claude →</button>' : ''}
      </div>
    </div>`;
  }).join('');
}

async function onListClick(e) {
  const card = e.target.closest('.note-card');
  if (!card) return;
  const id = +card.dataset.id;
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'del') {
    if (!confirm(`Delete note #${id}?`)) return;
    await api(`/api/notes/${id}`, { method: 'DELETE' });
    if (S.selectedNote === id) selectNote(null);
    return;
  }
  if (act === 'reopen') { await api(`/api/notes/${id}`, { method: 'PUT', body: { status: 'open' } }); return; }
  if (act === 'fix') { hooks.sendToClaude([id]); return; }
  if (act === 'edit') { selectNote(id); editNote(id); return; }
  selectNote(S.selectedNote === id ? null : id);
}

export function noteCardEl(id) { return $(`.note-card[data-id="${id}"]`); }
export const getNote = id => S.notes.find(n => n.id === id);

export function selectNote(id, { quiet = false } = {}) {
  S.selectedNote = id;
  const n = id != null ? getNote(id) : null;
  $$('.note-card').forEach(c => c.classList.toggle('sel', +c.dataset.id === id));
  if (n) {
    hooks.pause();
    hooks.seek(n.t);
    draw.show(n.shapes);
    const c = noteCardEl(id);
    if (c) c.scrollIntoView({ block: 'nearest', behavior: quiet ? 'auto' : 'smooth' });
  } else draw.show(null);
  bus.emit('notes', S.notes);
}

// ---------- composer ----------
export function openComposer(anchor) {
  hooks.pause();
  const c = $('#composer');
  c.classList.remove('hidden');
  composerOpen = true;
  const t = S.t;
  $('#cmp-id').textContent = editing ? `#${editing}` : '#new';
  $('#cmp-time').textContent = fmt(editing ? getNote(editing).t : t);
  const sec = S.section;
  const hasSec = !editing && sec.in != null && sec.out != null && t >= sec.in - 0.05 && t <= sec.out + 0.05;
  $('#cmp-range-row').classList.toggle('hidden', !hasSec);
  if (hasSec) $('#cmp-range-text').textContent = `${fmt(sec.in)}–${fmt(sec.out)}`;
  // position: next to the anchor, kept on screen
  const st = $('#stage').getBoundingClientRect();
  let x = anchor ? anchor.x + 28 : st.left + st.width / 2 - 180;
  let y = anchor ? anchor.y - 40 : st.top + st.height / 2 - 90;
  if (x + 370 > innerWidth) x = (anchor ? anchor.x : st.right) - 390;
  x = Math.max(8, Math.min(innerWidth - 370, x));
  y = Math.max(56, Math.min(innerHeight - 260, y));
  c.style.left = `${x}px`; c.style.top = `${y}px`;
  setTimeout(() => $('#cmp-text').focus(), 0);
}
export const isComposerOpen = () => composerOpen;

export function editNote(id) {
  const n = getNote(id);
  if (!n) return;
  editing = id;
  draw.show(null);
  draw.setDraft(n.shapes);
  $('#cmp-text').value = n.text;
  $('#cmp-kind').value = n.kind;
  const p = n.pin ? draw.toScreen(n.pin) : null;
  openComposer(p);
}

export function closeComposer(discard) {
  $('#composer').classList.add('hidden');
  composerOpen = false;
  if (discard) {
    draw.clearDraft();
    if (editing) { const n = getNote(editing); draw.show(n?.shapes); }
  }
  editing = null;
  $('#cmp-text').value = '';
}

async function saveComposer(fixNow) {
  const text = $('#cmp-text').value.trim();
  if (!text) { $('#cmp-text').focus(); toast('Say what should change first'); return; }
  const shapes = draw.getDraft();
  const kind = $('#cmp-kind').value;
  try {
    let note;
    if (editing) {
      note = await api(`/api/notes/${editing}`, { method: 'PUT', body: { text, kind, shapes, pin: draw.anchorOf(shapes) } });
    } else {
      const useRange = !$('#cmp-range-row').classList.contains('hidden') && $('#cmp-range').checked;
      const t = useRange ? S.section.in : S.t;
      const at = sceneAt(S.t);
      note = await api('/api/notes', {
        body: {
          t, t2: useRange ? S.section.out : null, frame: Math.round(t * S.fps), kind, text, shapes, pin: draw.anchorOf(shapes),
          scene: at ? { id: at.scene.id, name: at.scene.name, file: at.scene.file, local: at.local, duration: at.scene.duration } : null,
        },
      });
    }
    const blob = await hooks.snapshot(S.t, shapes, note.id);
    await fetch(`/api/notes/${note.id}/snapshot`, { method: 'POST', body: blob });
    closeComposer(false);
    draw.clearDraft();
    toast(`Note #${note.id} saved`);
    if (fixNow) hooks.sendToClaude([note.id]);
    else selectNote(note.id, { quiet: true });
  } catch (e) { toast(`Couldn't save note: ${e.message}`, 'err'); }
}
