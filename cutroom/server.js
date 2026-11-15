#!/usr/bin/env node
// Cutroom — code-to-video studio with Claude in the loop.
// Zero dependencies: Node's http server + your installed `claude` CLI + ffmpeg (for export).
//
//   node server.js [project-dir] [--port 4800] [--open]
//
// If project-dir doesn't exist it is created from ./template.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ClaudeRunner, claudeInfo } from './lib/claude.js';
import { Exporter, ffmpegAvailable } from './lib/exporter.js';
import { History } from './lib/history.js';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const TEMPLATE_DIR = path.join(APP_DIR, 'template');

// ---------- args ----------
const argv = process.argv.slice(2);
let port = Number(process.env.PORT) || 4800;
let projectArg = null;
let openBrowser = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port' || a === '-p') port = Number(argv[++i]);
  else if (a === '--open') openBrowser = true;
  else if (a === '--help' || a === '-h') {
    console.log('usage: node server.js [project-dir] [--port 4800] [--open]');
    process.exit(0);
  } else if (!a.startsWith('-')) projectArg = a;
}
const PROJECT_DIR = path.resolve(projectArg || 'my-film');
const META_DIR = path.join(PROJECT_DIR, '.cutroom');
const NOTES_FILE = path.join(META_DIR, 'notes.json');
const NOTES_IMG_DIR = path.join(META_DIR, 'notes');

// ---------- project bootstrap ----------
async function copyDir(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}
if (!fs.existsSync(path.join(PROJECT_DIR, 'project.json'))) {
  console.log(`  creating new project from template → ${PROJECT_DIR}`);
  await copyDir(TEMPLATE_DIR, PROJECT_DIR);
}
await fsp.mkdir(NOTES_IMG_DIR, { recursive: true });

// ---------- notes store ----------
let notes = { nextId: 1, items: [] };
try { notes = JSON.parse(await fsp.readFile(NOTES_FILE, 'utf8')); } catch {}
let notesWriteTimer = null;
function saveNotes() {
  clearTimeout(notesWriteTimer);
  notesWriteTimer = setTimeout(() => {
    fsp.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2)).catch(() => {});
  }, 80);
  broadcast('notes', notes.items);
}
function setNoteStatus(id, status) {
  const n = notes.items.find(n => n.id === id);
  if (!n || n.status === status) return;
  n.status = status;
  n.updated = Date.now();
  saveNotes();
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

// ---------- file watching (hot reload) ----------
const IGNORED = [/^\.cutroom(\/|$)/, /^exports(\/|$)/, /^node_modules(\/|$)/, /^\.git(\/|$)/, /(^|\/)\.DS_Store$/, /~$/, /\.swp$/];
const isIgnored = rel => IGNORED.some(r => r.test(rel));
const pending = new Map();
function onFsChange(rel) {
  if (!rel) return;
  rel = rel.split(path.sep).join('/');
  if (isIgnored(rel)) return;
  clearTimeout(pending.get(rel));
  pending.set(rel, setTimeout(() => {
    pending.delete(rel);
    const exists = fs.existsSync(path.join(PROJECT_DIR, rel));
    broadcast('file', { path: rel, exists, by: claude.running ? 'claude' : 'disk' });
  }, 60));
}
try {
  fs.watch(PROJECT_DIR, { recursive: true }, (_e, f) => onFsChange(f));
} catch {
  // recursive watch unsupported (older Linux node) → watch top + one level
  const watchDir = d => { try { fs.watch(d, (_e, f) => f && onFsChange(path.relative(PROJECT_DIR, path.join(d, f)))); } catch {} };
  watchDir(PROJECT_DIR);
  for (const e of fs.readdirSync(PROJECT_DIR, { withFileTypes: true }))
    if (e.isDirectory() && !isIgnored(e.name)) watchDir(path.join(PROJECT_DIR, e.name));
}

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.txt', '.css', '.html', '.svg', '.glsl', '.frag', '.vert', '.srt', '.vtt']);

function safeJoin(root, rel) {
  const p = path.resolve(root, '.' + path.sep + rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('bad path'), { status: 400 });
  return p;
}
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readBody(req, limit = 50 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req) { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; }

async function listFiles(dir = PROJECT_DIR, base = '') {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (isIgnored(rel) || e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...await listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

// Append ?v= to relative imports inside project JS so hot reload refreshes shared modules too.
function versionImports(src, v) {
  return src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+)(\2)/g,
    (_m, pre, q, spec, q2) => `${pre}${q}${spec}?v=${v}${q2}`);
}

// ---------- Claude ----------
const history = new History(PROJECT_DIR, isIgnored);
const claude = new ClaudeRunner({
  cwd: PROJECT_DIR,
  onEvent: ev => {
    if (ev.kind === 'marker') setNoteStatus(ev.id, ev.state === 'fixed' ? 'fixed' : 'fixing');
    broadcast('claude', ev);
  },
});

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function buildPrompt({ message, noteIds = [], context = {} }) {
  const parts = [];
  const picked = noteIds.map(id => notes.items.find(n => n.id === id)).filter(Boolean);
  if (picked.length) {
    parts.push(`You have ${picked.length} review note${picked.length > 1 ? 's' : ''} from Cutroom to fix in this video project.`);
    parts.push('For each note: say `[fixing #ID]` on its own line before you start it, make the change, then say `[fixed #ID]` with one short sentence on what you changed. If a note can\'t be done, say `[skipped #ID]` and why.');
    parts.push('Each note\'s snapshot PNG shows the frame with the reviewer\'s drawings (circles, arrows, text) — open it with Read before you fix the note. Times are global film time; "scene t" is the local time inside that scene\'s render function.');
    parts.push('');
    for (const n of picked) {
      const lines = [`#${n.id} · ${fmtTime(n.t)}${n.t2 != null ? `–${fmtTime(n.t2)}` : ''} · ${n.kind}`];
      if (n.scene) lines.push(`  scene: ${n.scene.name} (${n.scene.file}), scene t = ${n.scene.local.toFixed(2)}s of ${n.scene.duration}s`);
      if (n.pin) lines.push(`  points at: x=${Math.round(n.pin.x * 100)}% y=${Math.round(n.pin.y * 100)}% of the frame`);
      if (n.snapshot) lines.push(`  snapshot: .cutroom/notes/${n.id}.png`);
      lines.push(`  note: ${n.text.replace(/\n/g, '\n        ')}`);
      parts.push(lines.join('\n'));
      setNoteStatus(n.id, 'queued');
    }
  }
  if (message && message.trim()) {
    if (picked.length) parts.push('', 'Also from the user:');
    parts.push(message.trim());
  }
  if (context && context.t != null) {
    parts.push('', `(Cutroom context: playhead at ${fmtTime(context.t)}${context.scene ? `, scene "${context.scene.name}" (${context.scene.file}) at scene t = ${context.scene.local.toFixed(2)}s` : ''}.${context.error ? ` Current render error: ${context.error}` : ''})`);
  }
  parts.push('', 'Read CLAUDE.md first if you haven\'t in this conversation. Keep every scene a pure, deterministic function of t. Don\'t start servers or render video — Cutroom hot-reloads the preview the moment you save.');
  return parts.join('\n');
}

// ---------- export ----------
const exporter = new Exporter({ projectDir: PROJECT_DIR, onProgress: p => broadcast('export', p) });

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  // SSE
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ running: claude.running })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/project' && req.method === 'GET') {
    const raw = await fsp.readFile(path.join(PROJECT_DIR, 'project.json'), 'utf8');
    let project = null, error = null;
    try { project = JSON.parse(raw); } catch (e) { error = `project.json: ${e.message}`; }
    return send(res, 200, {
      project, error, dir: PROJECT_DIR, name: path.basename(PROJECT_DIR),
      files: await listFiles(), notes: notes.items,
      claude: await claudeInfo(), ffmpeg: await ffmpegAvailable(),
      session: claude.sessionId, running: claude.running,
    });
  }

  if (p === '/api/file') {
    const rel = url.searchParams.get('path') || '';
    const abs = safeJoin(PROJECT_DIR, rel);
    if (req.method === 'GET') {
      try { return send(res, 200, await fsp.readFile(abs, 'utf8'), 'text/plain; charset=utf-8'); }
      catch { return send(res, 404, { error: 'not found' }); }
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, body);
      return send(res, 200, { ok: true });
    }
  }

  // notes
  if (p === '/api/notes' && req.method === 'POST') {
    const n = await readJson(req);
    const note = {
      id: notes.nextId++, t: +n.t || 0, t2: n.t2 != null ? +n.t2 : null, frame: n.frame | 0,
      kind: n.kind || 'visual', text: String(n.text || '').slice(0, 4000), shapes: n.shapes || [],
      pin: n.pin || null, scene: n.scene || null, status: 'open', snapshot: false,
      created: Date.now(), updated: Date.now(),
    };
    notes.items.push(note);
    saveNotes();
    return send(res, 200, note);
  }
  let m;
  if ((m = p.match(/^\/api\/notes\/(\d+)$/))) {
    const id = +m[1];
    const idx = notes.items.findIndex(n => n.id === id);
    if (idx < 0) return send(res, 404, { error: 'no such note' });
    if (req.method === 'PUT') {
      const patch = await readJson(req);
      for (const k of ['text', 'kind', 'status', 'shapes', 'pin', 't', 't2'])
        if (k in patch) notes.items[idx][k] = patch[k];
      notes.items[idx].updated = Date.now();
      saveNotes();
      return send(res, 200, notes.items[idx]);
    }
    if (req.method === 'DELETE') {
      notes.items.splice(idx, 1);
      fsp.rm(path.join(NOTES_IMG_DIR, `${id}.png`), { force: true });
      saveNotes();
      return send(res, 200, { ok: true });
    }
  }
  if ((m = p.match(/^\/api\/notes\/(\d+)\/snapshot$/)) && req.method === 'POST') {
    const id = +m[1];
    const note = notes.items.find(n => n.id === id);
    if (!note) return send(res, 404, { error: 'no such note' });
    await fsp.writeFile(path.join(NOTES_IMG_DIR, `${id}.png`), await readBody(req));
    note.snapshot = true; note.updated = Date.now();
    saveNotes();
    return send(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/notes\/(\d+)\.png$/))) {
    try { return send(res, 200, await fsp.readFile(path.join(NOTES_IMG_DIR, `${m[1]}.png`)), 'image/png'); }
    catch { return send(res, 404, 'no snapshot', 'text/plain'); }
  }

  // claude
  if (p === '/api/claude' && req.method === 'POST') {
    if (claude.running) return send(res, 409, { error: 'Claude is already working — stop it first.' });
    const body = await readJson(req);
    const prompt = buildPrompt(body);
    const snap = await history.snapshot(body.noteIds?.length ? `Before fixing ${body.noteIds.length} note(s)` : (body.message || '').slice(0, 60));
    broadcast('history', await history.list());
    claude.run({ prompt, model: body.model, newSession: !!body.newSession, useApiKey: !!body.useApiKey, noteIds: body.noteIds || [], snapshotId: snap.id, display: body.message || '' });
    return send(res, 200, { ok: true, snapshot: snap.id });
  }
  if (p === '/api/claude/stop' && req.method === 'POST') { claude.stop(); return send(res, 200, { ok: true }); }
  if (p === '/api/claude/reset' && req.method === 'POST') { claude.sessionId = null; return send(res, 200, { ok: true }); }

  // history (undo Claude)
  if (p === '/api/history' && req.method === 'GET') return send(res, 200, await history.list());
  if ((m = p.match(/^\/api\/history\/([\w-]+)\/restore$/)) && req.method === 'POST') {
    if (claude.running) return send(res, 409, { error: 'Stop Claude first.' });
    await history.snapshot('Before restore');
    const changed = await history.restore(m[1]);
    broadcast('history', await history.list());
    broadcast('reload', { reason: 'restore', changed });
    return send(res, 200, { ok: true, changed });
  }

  // export
  if (p === '/api/export/start' && req.method === 'POST') return send(res, 200, await exporter.start(await readJson(req)));
  if (p === '/api/export/frame' && req.method === 'POST') { await exporter.frame(await readBody(req)); return send(res, 200, { ok: true }); }
  if (p === '/api/export/finish' && req.method === 'POST') return send(res, 200, await exporter.finish());
  if (p === '/api/export/cancel' && req.method === 'POST') { exporter.cancel(); return send(res, 200, { ok: true }); }
  if (p === '/api/reveal' && req.method === 'POST') {
    const { path: rel } = await readJson(req);
    const abs = safeJoin(PROJECT_DIR, rel || '');
    const cmd = process.platform === 'darwin' ? ['open', ['-R', abs]] : process.platform === 'win32' ? ['explorer', [`/select,${abs}`]] : ['xdg-open', [path.dirname(abs)]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    return send(res, 200, { ok: true });
  }

  // project files (scenes, audio, images) — no cache, with versioned relative imports
  if (p.startsWith('/project/')) {
    const rel = p.slice('/project/'.length);
    const abs = safeJoin(PROJECT_DIR, rel);
    let data;
    try { data = await fsp.readFile(abs); } catch { return send(res, 404, 'not found', 'text/plain'); }
    const ext = path.extname(abs).toLowerCase();
    const v = url.searchParams.get('v');
    if ((ext === '.js' || ext === '.mjs') && v) data = Buffer.from(versionImports(data.toString('utf8'), v), 'utf8');
    return serveWithRange(req, res, data, MIME[ext] || 'application/octet-stream');
  }
  if (p.startsWith('/exports/')) {
    const abs = safeJoin(path.join(PROJECT_DIR, 'exports'), p.slice('/exports/'.length));
    try {
      const data = await fsp.readFile(abs);
      return serveWithRange(req, res, data, MIME[path.extname(abs)] || 'application/octet-stream',
        url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${path.basename(abs)}"` } : {});
    } catch { return send(res, 404, 'not found', 'text/plain'); }
  }

  // static app
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const abs = safeJoin(PUBLIC_DIR, rel);
  try {
    const data = await fsp.readFile(abs);
    return send(res, 200, data, MIME[path.extname(abs)] || 'application/octet-stream');
  } catch { return send(res, 404, 'not found', 'text/plain'); }
}

function serveWithRange(req, res, data, type, extra = {}) {
  const range = req.headers.range;
  if (range) {
    const mm = range.match(/bytes=(\d*)-(\d*)/);
    if (mm) {
      const start = mm[1] ? +mm[1] : 0;
      const end = mm[2] ? Math.min(+mm[2], data.length - 1) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', ...extra });
      return res.end(data.subarray(start, end + 1));
    }
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
    else res.end();
  });
});
server.listen(port, '127.0.0.1', async () => {
  const info = await claudeInfo();
  const url = `http://localhost:${port}`;
  console.log(`\n  ▶ Cutroom  ${url}`);
  console.log(`    project  ${PROJECT_DIR}`);
  console.log(`    claude   ${info.installed ? info.version : 'not found — install with: npm i -g @anthropic-ai/claude-code'}`);
  console.log(`    ffmpeg   ${(await ffmpegAvailable()) ? 'ok' : 'not found — export falls back to WebM in the browser'}\n`);
  if (openBrowser) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }
});
process.on('SIGINT', () => { claude.stop(); exporter.cancel(); process.exit(0); });
