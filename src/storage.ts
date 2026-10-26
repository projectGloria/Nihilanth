import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as lockfile from 'proper-lockfile';
import { Capture, MemoryEntry } from './model';

interface Database { version: 1; entries: MemoryEntry[] }

export class MemoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private cached?: { mtime: number; size: number; database: Database };
  readonly filename: string;
  constructor(readonly directory: string, private limitBytes: () => number) {
    this.filename = path.join(directory, 'memory-v1.json');
  }

  async list(): Promise<MemoryEntry[]> { return [...(await this.read()).entries]; }

  private async read(): Promise<Database> {
    try {
      const stat = await fs.stat(this.filename);
      if (this.cached && this.cached.mtime === stat.mtimeMs && this.cached.size === stat.size) return this.cached.database;
      const parsed = JSON.parse(await fs.readFile(this.filename, 'utf8')) as Database;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.some(e =>
        !e || typeof e.id !== 'string' || typeof e.text !== 'string' || typeof e.name !== 'string' ||
        typeof e.project !== 'string' || typeof e.file !== 'string' || typeof e.language !== 'string' ||
        typeof e.capturedAt !== 'number' || typeof e.pinned !== 'boolean' || !Array.isArray(e.tags) ||
        e.tags.some(t => typeof t !== 'string') || typeof e.snippet !== 'boolean')) {
        throw new Error('Unsupported or damaged memory database; the original file has been preserved.');
      }
      this.cached = { mtime: stat.mtimeMs, size: stat.size, database: parsed };
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
      throw error;
    }
  }

  private mutate(fn: (db: Database) => boolean | void): Promise<void> {
    const operation = this.queue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const release = await lockfile.lock(this.directory, {
        stale: 30_000, retries: { retries: 20, minTimeout: 30, maxTimeout: 300 }
      });
      try {
        this.cached = undefined;
        const db = await this.read();
        const changed = fn(db);
        let bytes = db.entries.filter(e => !e.pinned).reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);
        const oldest = db.entries.filter(e => !e.pinned).sort((a, b) => a.capturedAt - b.capturedAt);
        const removed = new Set<string>();
        for (const e of oldest) {
          if (bytes <= this.limitBytes()) break;
          bytes -= Buffer.byteLength(JSON.stringify(e));
          removed.add(e.id);
        }
        db.entries = db.entries.filter(e => !removed.has(e.id));
        if (changed === false && !removed.size) return;
        const temporary = `${this.filename}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(db), { mode: 0o600 });
          await fs.rename(temporary, this.filename);
        } finally { await fs.rm(temporary, { force: true }); }
        this.cached = undefined;
      } finally { await release(); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async capture(captures: Capture[]): Promise<void> {
    if (!captures.length) return;
    await this.mutate(db => {
      const ids = new Set(db.entries.map(e => e.id));
      let changed = false;
      for (const c of captures) {
        const id = createHash('sha256').update(`${c.project}\0${c.file}\0${c.language}\0${c.name}\0${c.text}`).digest('hex');
        if (!ids.has(id)) {
          db.entries.push({ ...c, id, capturedAt: Date.now(), pinned: false, tags: [], snippet: false });
          ids.add(id);
          changed = true;
        }
      }
      return changed;
    });
  }

  async pin(capture: Capture, title: string, tags: string[] = [], snippet = false): Promise<void> {
    await this.mutate(db => {
      const existing = db.entries.find(e => e.text === capture.text && e.file === capture.file && e.project === capture.project);
      if (existing) Object.assign(existing, { name: title, tags, snippet, pinned: true });
      else db.entries.push({ ...capture, name: title, tags, snippet, id: randomUUID(), capturedAt: Date.now(), pinned: true });
    });
  }
  async remove(id: string): Promise<void> { await this.mutate(db => { db.entries = db.entries.filter(e => e.id !== id); }); }
  async update(id: string, changes: Pick<MemoryEntry, 'name' | 'tags' | 'pinned' | 'snippet'>): Promise<void> {
    await this.mutate(db => { const e = db.entries.find(e => e.id === id); if (e) Object.assign(e, changes); });
  }
  async clearHistory(): Promise<void> { await this.mutate(db => { db.entries = db.entries.filter(e => e.pinned); }); }
  async flush(): Promise<void> { await this.queue; }
}
