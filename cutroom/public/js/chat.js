// Claude panel: send messages/notes, stream Claude Code's work, undo a run.
import { S, $, $$, api, esc, toast, fmt } from './util.js';

let hooks = {};
let bubble = null;        // current streaming text element
let bubbleText = '';
let tools = new Map();    // tool id → row element
let thinkingEl = null;
let runEl = null;         // container for the current run
let ctxOn = true;

const SUGGESTIONS = [
  'Make the title text pulse with a soft glow',
  'Add a seagull that flies across the night sea',
  'Make the lightning in the storm more dramatic, with a visible bolt',
  'Add a 4-second credits scene at the end',
];

export function initChat(h) {
  hooks = h;
  const input = $('#chat-input');
  try { $('#model').value = localStorage.getItem('cutroom.model') || 'default'; $('#watch').checked = localStorage.getItem('cutroom.watch') !== '0'; } catch {}
  $('#model').addEventListener('change', () => { try { localStorage.setItem('cutroom.model', $('#model').value); } catch {} });
  $('#watch').addEventListener('change', () => { try { localStorage.setItem('cutroom.watch', $('#watch').checked ? '1' : '0'); } catch {} });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    e.stopPropagation();
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(200, input.scrollHeight)}px`; });
  $('#chat-send').addEventListener('click', submit);
  $('#chat-stop').addEventListener('click', () => api('/api/claude/stop', { body: {} }));
  $('#chat-new').addEventListener('click', async () => {
    if (S.claude.running) return toast('Claude is still working — stop it first');
    await api('/api/claude/reset', { body: {} });
    $('#chat-log').innerHTML = '';
    $('#chat-title').textContent = 'New conversation';
    renderEmpty();
  });
  $('#ctx-chip').addEventListener('click', () => { ctxOn = !ctxOn; $('#ctx-chip').classList.toggle('off', !ctxOn); });
  $('#chat-log').addEventListener('click', e => {
    const row = e.target.closest('[data-open]');
    if (row) hooks.openFile(row.dataset.open);
    const undo = e.target.closest('[data-undo]');
    if (undo) hooks.restore(undo.dataset.undo);
    const sug = e.target.closest('[data-sugg]');
    if (sug) { input.value = sug.dataset.sugg; input.focus(); }
  });
  renderEmpty();
}

export const isWatching = () => $('#watch').checked;

export function updateContext(t, scene) {
  $('#ctx-text').textContent = scene ? `${fmt(t)} · ${scene.name}` : fmt(t);
}

export function renderEmpty() {
  const log = $('#chat-log');
  if (log.children.length) return;
  if (!S.claude.installed) {
    log.innerHTML = `<div class="banner"><b>Claude Code isn't installed (or not on PATH).</b><br>
      Install it, log in once with your Claude subscription, then restart Cutroom:<br><br>
      <code>npm i -g @anthropic-ai/claude-code</code><br><code>claude</code> → sign in</div>`;
    return;
  }
  log.innerHTML = `<div class="chat-empty">
    <b>Claude edits this film's code while you watch.</b><br>
    Leave notes on frames and hit <b>Send to Claude</b>, or just ask for something here — Claude gets the playhead time and scene with every message.
    Runs on your Claude subscription via Claude Code.
    <div class="sugg">${SUGGESTIONS.map(s => `<button data-sugg="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
}

function submit() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || S.claude.running) return;
  input.value = '';
  input.style.height = '';
  send({ message: text });
}

export async function send({ message = '', noteIds = [] }) {
  if (S.claude.running) { toast('Claude is already working on something'); return; }
  if (!S.claude.installed) { toast('Claude Code isn\'t installed — see the Claude tab', 'err'); hooks.showTab('claude'); return; }
  hooks.showTab('claude');
  try {
    await api('/api/claude', { body: { message, noteIds, model: $('#model').value, context: ctxOn ? hooks.context() : null } });
  } catch (e) { toast(e.message, 'err'); }
}

function log() { return $('#chat-log'); }
function scroll() { const l = log(); if (l.scrollHeight - l.scrollTop - l.clientHeight < 200) l.scrollTop = l.scrollHeight; }
function append(html, parent = runEl || log()) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  parent.append(el);
  scroll();
  return el;
}

function fmtClaude(text) {
  return esc(text)
    .replace(/\[(fixing|fixed|skipped)\s+#(\d+)\]/gi, (_m, s, id) => `<span class="mk ${s.toLowerCase()}">${s.toLowerCase()} #${id}</span>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

function setThinking(on) {
  if (on && !thinkingEl) thinkingEl = append('<div class="thinking"><i></i>Claude is thinking…</div>');
  if (!on && thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  if (on && thinkingEl) { (runEl || log()).append(thinkingEl); scroll(); }
}

const ICONS = {
  Read: '<svg viewBox="0 0 24 24"><path d="M4 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/></svg>',
  Edit: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1L19 8l-3-3L5 16z"/></svg>',
  Write: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4"/></svg>',
  Search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
};

export function onClaude(ev) {
  switch (ev.kind) {
    case 'start': {
      if (log().querySelector('.chat-empty, .banner')) log().innerHTML = '';
      runEl = append('<div class="run" style="display:flex;flex-direction:column;gap:10px"></div>', log());
      const notesRef = ev.noteIds?.length ? `<span class="notes-ref">${ev.noteIds.length === 1 ? `Note #${ev.noteIds[0]}` : `${ev.noteIds.length} notes (#${ev.noteIds.join(', #')})`} from Cutroom — please fix</span>` : '';
      append(`<div class="msg-user">${notesRef}${esc(ev.display || '')}</div>`);
      if ($('#chat-title').textContent === 'New conversation') $('#chat-title').textContent = (ev.display || (ev.noteIds?.length ? `Fix ${ev.noteIds.length} note${ev.noteIds.length > 1 ? 's' : ''}` : 'Conversation')).slice(0, 48);
      runEl.dataset.snapshot = ev.snapshotId || '';
      tools = new Map(); bubble = null; bubbleText = '';
      setThinking(true);
      return;
    }
    case 'thinking': setThinking(true); return;
    case 'delta': {
      setThinking(false);
      if (!bubble) { bubble = append('<div class="msg-claude"></div>'); bubbleText = ''; }
      bubbleText += ev.text;
      bubble.innerHTML = fmtClaude(bubbleText);
      scroll();
      return;
    }
    case 'text': {
      setThinking(false);
      if (!bubble) bubble = append('<div class="msg-claude"></div>');
      bubble.innerHTML = fmtClaude(ev.text);
      bubble = null; bubbleText = '';
      scroll();
      return;
    }
    case 'tool': {
      setThinking(false);
      bubble = null;
      const row = toolRow(ev);
      if (row) tools.set(ev.id, row);
      return;
    }
    case 'tool_result': {
      const row = tools.get(ev.id);
      if (row) { row.classList.remove('pending'); if (ev.error) { row.classList.add('err'); row.title = ev.text; } }
      setThinking(true);
      return;
    }
    case 'result': {
      setThinking(false);
      return;
    }
    case 'error': setThinking(false); append(`<div class="msg-error">${esc(ev.text)}</div>`); return;
    case 'end': {
      setThinking(false);
      for (const r of tools.values()) r.classList.remove('pending');
      const secs = ev.ms ? `${(ev.ms / 1000).toFixed(0)}s` : '';
      const snap = runEl?.dataset.snapshot;
      append(`<div class="run-end">${ev.code === 0 ? '✓ done' : ev.code == null ? 'stopped' : `exited (${ev.code})`}${secs ? ` · ${secs}` : ''}${snap ? `<button data-undo="${snap}" title="Put every file back the way it was before this run">↺ Undo this run</button>` : ''}</div>`);
      runEl = null;
      return;
    }
  }
}

function toolRow({ name, input = {} }) {
  const file = input.file_path || input.path || '';
  if (name === 'TodoWrite') {
    const todos = input.todos || [];
    return append(`<div class="todo">${todos.map(t => `<div class="${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : ''}">${esc(t.content)}</div>`).join('')}</div>`);
  }
  if (name === 'Read') {
    const img = /\.png$/.test(file);
    return append(`<div class="tool-row pending" ${img ? '' : `data-open="${esc(file)}"`}>${ICONS.Read}<span>${img ? 'Looked at' : 'Read'}</span><span class="tp">${esc(file.replace(/^\.cutroom\/notes\//, 'note snapshot '))}</span></div>`);
  }
  if (name === 'Edit' || name === 'MultiEdit') {
    const edits = name === 'Edit' ? [input] : input.edits || [];
    let a = 0, d = 0;
    for (const e of edits) { d += (e.old_string || '').split('\n').length; a += (e.new_string || '').split('\n').length; }
    return append(`<div class="tool-row pending" data-open="${esc(file)}">${ICONS.Edit}<span>Edited</span><span class="tp">${esc(file)}</span><span class="diff"><span class="a">+${a}</span> <span class="d">−${d}</span></span></div>`);
  }
  if (name === 'Write') {
    const n = (input.content || '').split('\n').length;
    return append(`<div class="tool-row pending" data-open="${esc(file)}">${ICONS.Write}<span>Wrote</span><span class="tp">${esc(file)}</span><span class="diff"><span class="a">+${n}</span></span></div>`);
  }
  if (name === 'Grep' || name === 'Glob') {
    return append(`<div class="tool-row pending">${ICONS.Search}<span>Searched</span><span class="tp">${esc(input.pattern || '')}</span></div>`);
  }
  return append(`<div class="tool-row pending">${ICONS.Search}<span>${esc(name)}</span><span class="tp"></span></div>`);
}

export function setRunning(on) {
  $('#chat-stop').classList.toggle('hidden', !on);
  $('#chat-send').disabled = on;
  $('#claude-dot').classList.toggle('on', on);
}
