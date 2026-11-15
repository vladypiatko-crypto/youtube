// Snapshots of the project taken before every Claude run, so any run can be undone in one click.
import fsp from 'node:fs/promises';
import path from 'node:path';

const MAX_SNAPSHOTS = 30;
const MAX_FILE = 8 * 1024 * 1024;

export class History {
  constructor(projectDir, isIgnored) {
    this.root = projectDir;
    this.dir = path.join(projectDir, '.cutroom', 'history');
    this.isIgnored = isIgnored;
  }

  async files(dir = this.root, base = '') {
    const out = [];
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (this.isIgnored(rel)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await this.files(abs, rel));
      else if (e.isFile()) {
        const st = await fsp.stat(abs);
        if (st.size <= MAX_FILE) out.push(rel);
      }
    }
    return out;
  }

  async snapshot(label) {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = path.join(this.dir, id);
    const files = await this.files();
    for (const rel of files) {
      const to = path.join(dst, 'files', rel);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(path.join(this.root, rel), to);
    }
    const meta = { id, label: label || 'Snapshot', time: Date.now(), files };
    await fsp.writeFile(path.join(dst, 'meta.json'), JSON.stringify(meta));
    await this.prune();
    return meta;
  }

  async list() {
    let ids = [];
    try { ids = await fsp.readdir(this.dir); } catch { return []; }
    const out = [];
    for (const id of ids.sort().reverse()) {
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(this.dir, id, 'meta.json'), 'utf8'));
        out.push({ id: meta.id, label: meta.label, time: meta.time, count: meta.files.length });
      } catch {}
    }
    return out;
  }

  async prune() {
    const all = await this.list();
    for (const old of all.slice(MAX_SNAPSHOTS)) await fsp.rm(path.join(this.dir, old.id), { recursive: true, force: true });
  }

  // Put the project back exactly as it was: restore every snapshotted file, remove files created since.
  async restore(id) {
    const src = path.join(this.dir, id);
    const meta = JSON.parse(await fsp.readFile(path.join(src, 'meta.json'), 'utf8'));
    const keep = new Set(meta.files);
    const changed = [];
    for (const rel of await this.files()) {
      if (!keep.has(rel)) { await fsp.rm(path.join(this.root, rel), { force: true }); changed.push(rel); }
    }
    for (const rel of meta.files) {
      const from = path.join(src, 'files', rel), to = path.join(this.root, rel);
      const a = await fsp.readFile(from);
      let b = null;
      try { b = await fsp.readFile(to); } catch {}
      if (!b || !a.equals(b)) {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.writeFile(to, a);
        changed.push(rel);
      }
    }
    return changed;
  }
}
