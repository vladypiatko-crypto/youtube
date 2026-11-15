// Runs the Claude Code CLI headless and turns its stream-json output into small UI events.
// Uses whatever login `claude` has — your Pro/Max subscription — and by default strips
// ANTHROPIC_API_KEY from the child env so a stray key doesn't silently bill the API instead.
import { spawn, execFile } from 'node:child_process';

const BIN = process.env.CUTROOM_CLAUDE_BIN || 'claude';
const WIN = process.platform === 'win32';
const TOOLS = 'Read,Edit,MultiEdit,Write,Glob,Grep,TodoWrite';

let cachedInfo = null;
export function claudeInfo() {
  if (cachedInfo) return Promise.resolve(cachedInfo);
  return new Promise(resolve => {
    execFile(BIN, ['--version'], { shell: WIN, timeout: 15000 }, (err, stdout) => {
      cachedInfo = err ? { installed: false } : { installed: true, version: String(stdout).trim() };
      resolve(cachedInfo);
    });
  });
}

const MARKER = /\[(fixing|fixed|skipped)\s+#(\d+)\]/gi;

export class ClaudeRunner {
  constructor({ cwd, onEvent }) {
    this.cwd = cwd;
    this.emit = onEvent;
    this.child = null;
    this.sessionId = null;
    this.running = false;
  }

  run({ prompt, model, newSession, useApiKey, noteIds, snapshotId, display }) {
    if (newSession) this.sessionId = null;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS];
    if (model && model !== 'default') args.push('--model', model);
    if (this.sessionId) args.push('--resume', this.sessionId);

    const env = { ...process.env };
    if (!useApiKey) delete env.ANTHROPIC_API_KEY;

    this.running = true;
    this.startedAt = Date.now();
    this.emit({ kind: 'start', noteIds, snapshotId, display, prompt, resumed: !!this.sessionId });

    let child;
    try {
      child = spawn(BIN, args, { cwd: this.cwd, env, shell: WIN, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.running = false;
      this.emit({ kind: 'error', text: `Couldn't start claude: ${e.message}` });
      this.emit({ kind: 'end', code: -1 });
      return;
    }
    this.child = child;
    child.stdin.end(prompt);

    let buf = '';
    const seenMarkers = new Set();
    child.stdout.on('data', chunk => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { this.emit({ kind: 'log', text: line }); continue; }
        this.handle(msg, seenMarkers);
      }
    });
    let errBuf = '';
    child.stderr.on('data', c => { errBuf += c.toString('utf8'); if (errBuf.length > 20000) errBuf = errBuf.slice(-20000); });
    child.on('error', e => {
      this.emit({ kind: 'error', text: e.code === 'ENOENT'
        ? 'The `claude` command was not found. Install Claude Code (npm i -g @anthropic-ai/claude-code), run `claude` once to log in, then restart Cutroom.'
        : `claude failed: ${e.message}` });
    });
    child.on('close', code => {
      this.running = false;
      this.child = null;
      if (code && errBuf.trim()) this.emit({ kind: 'error', text: errBuf.trim().split('\n').slice(-6).join('\n') });
      if (code && /log ?in|auth|credential|unauthori/i.test(errBuf)) this.emit({ kind: 'error', text: 'Looks like Claude Code isn\'t logged in. Run `claude` in a terminal once and sign in with your Claude account, then try again.' });
      this.emit({ kind: 'end', code, ms: Date.now() - this.startedAt });
    });
  }

  handle(msg, seenMarkers) {
    if (msg.session_id && !this.sessionId) this.sessionId = msg.session_id;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id;
          this.emit({ kind: 'init', session: msg.session_id, model: msg.model });
        } else if (msg.subtype === 'task_summary' && msg.detail) {
          this.emit({ kind: 'status', text: msg.detail });
        }
        return;
      case 'stream_event': {
        const ev = msg.event;
        if (msg.parent_tool_use_id) return; // ignore subagent chatter
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') this.emit({ kind: 'delta', text: ev.delta.text });
        else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') this.emit({ kind: 'tool_start', id: ev.content_block.id, name: ev.content_block.name });
        else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'thinking') this.emit({ kind: 'thinking' });
        return;
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) return;
        for (const block of msg.message?.content || []) {
          if (block.type === 'text' && block.text) {
            this.emit({ kind: 'text', text: block.text });
            for (const m of block.text.matchAll(MARKER)) {
              const key = `${m[1].toLowerCase()}#${m[2]}`;
              if (seenMarkers.has(key)) continue;
              seenMarkers.add(key);
              this.emit({ kind: 'marker', state: m[1].toLowerCase(), id: +m[2] });
            }
          } else if (block.type === 'tool_use') {
            this.emit({ kind: 'tool', id: block.id, name: block.name, input: relInput(block.input, this.cwd) });
          }
        }
        return;
      }
      case 'user': {
        for (const block of msg.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          let text = block.content;
          if (Array.isArray(text)) text = text.map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
          this.emit({ kind: 'tool_result', id: block.tool_use_id, error: !!block.is_error, text: String(text || '').slice(0, 1200) });
        }
        return;
      }
      case 'result':
        this.emit({ kind: 'result', error: !!msg.is_error, text: msg.result || '', cost: msg.total_cost_usd, turns: msg.num_turns, ms: msg.duration_ms });
        return;
    }
  }

  stop() {
    if (!this.child) return;
    const c = this.child;
    try { WIN ? spawn('taskkill', ['/pid', String(c.pid), '/t', '/f']) : c.kill('SIGINT'); } catch {}
    setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, 2500);
    this.emit({ kind: 'status', text: 'Stopping…' });
  }
}

// Make file paths relative to the project so the UI can open them.
function relInput(input, cwd) {
  if (!input || typeof input !== 'object') return input;
  const out = { ...input };
  for (const k of ['file_path', 'path', 'notebook_path']) {
    if (typeof out[k] === 'string') {
      let p = out[k].replace(/\\/g, '/');
      const root = cwd.replace(/\\/g, '/').replace(/\/$/, '') + '/';
      if (p.startsWith(root)) p = p.slice(root.length);
      out[k] = p;
    }
  }
  return out;
}
