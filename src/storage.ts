import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as lockfile from 'proper-lockfile';
import { Capture, MemoryEntry } from './model';

// v2 layout: a JSON header line, then one operation per line. A write appends only what changed instead of
// re-serializing the whole history (v1 rewrote up to historyLimitMB synchronously per capture, stalling the
// extension host). Compaction rewrites the file atomically once dead lines outweigh live data.
interface Header { version: 2; generation: string }
type Operation = { put: MemoryEntry } | { del: string } | { touch: string; at: number };
interface Transaction {
  readonly entries: ReadonlyMap<string, MemoryEntry>;
  put(entry: MemoryEntry): void;
  del(id: string): void;
  touch(id: string, at: number): void;
}

export class DamagedMemoryError extends Error {
  constructor(readonly file: string) { super('Unsupported or damaged memory database; the original file has been preserved.'); }
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const idOf = (c: Capture) => createHash('sha256').update(`${c.project}\0${c.file}\0${c.language}\0${c.name}\0${c.text}`).digest('hex');
function validEntry(e: any): e is MemoryEntry {
  return !!e && typeof e.id === 'string' && typeof e.text === 'string' && typeof e.name === 'string' &&
    typeof e.project === 'string' && typeof e.file === 'string' && typeof e.language === 'string' &&
    typeof e.capturedAt === 'number' && typeof e.pinned === 'boolean' && Array.isArray(e.tags) &&
    !e.tags.some((t: unknown) => typeof t !== 'string') && typeof e.snippet === 'boolean' &&
    (e.live === undefined || typeof e.live === 'boolean');
}

export class MemoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private refreshing?: Promise<void>;
  // In-memory mirror of the log. Entry objects are never mutated after insertion, so arrays handed out by
  // list() stay valid snapshots while later writes replace entries.
  private entries = new Map<string, MemoryEntry>();
  private sizes = new Map<string, number>();
  private liveBytes = 0;
  private unpinnedBytes = 0;
  private listed?: MemoryEntry[];
  private generation?: string; // header of the log consumed so far; undefined = no log loaded
  private offset = 0;          // bytes of the log already applied to `entries`
  private legacy = false;      // entries came from memory-v1.json and are written as v2 on the next mutation
  readonly filename: string;
  private readonly legacyFilename: string;
  constructor(readonly directory: string, private limitBytes: () => number) {
    this.filename = path.join(directory, 'memory-v2.jsonl');
    this.legacyFilename = path.join(directory, 'memory-v1.json');
  }

  async list(): Promise<MemoryEntry[]> {
    await this.refresh();
    return [...(this.listed ??= [...this.entries.values()])];
  }

  private reset() {
    this.entries.clear(); this.sizes.clear();
    this.liveBytes = this.unpinnedBytes = this.offset = 0;
    this.generation = undefined; this.legacy = false; this.listed = undefined;
  }
  private drop(id: string) {
    const existing = this.entries.get(id);
    if (!existing) return;
    const size = this.sizes.get(id)!;
    this.liveBytes -= size;
    if (!existing.pinned) this.unpinnedBytes -= size;
    this.entries.delete(id); this.sizes.delete(id); this.listed = undefined;
  }
  private set(entry: MemoryEntry) {
    this.drop(entry.id);
    const size = Buffer.byteLength(JSON.stringify(entry));
    this.entries.set(entry.id, entry); this.sizes.set(entry.id, size);
    this.liveBytes += size;
    if (!entry.pinned) this.unpinnedBytes += size;
    this.listed = undefined;
  }
  // Operations are idempotent, so replaying a line that is already applied is harmless.
  private apply(op: Operation) {
    if ('put' in op) this.set(op.put);
    else if ('del' in op) this.drop(op.del);
    else {
      const existing = this.entries.get(op.touch);
      if (existing && existing.capturedAt < op.at) this.set({ ...existing, capturedAt: op.at });
    }
  }

  // Single-flight: list() reads outside the lock while mutate() refreshes inside it.
  private refresh(): Promise<void> {
    return this.refreshing ??= this.load().finally(() => { this.refreshing = undefined; });
  }
  private async load(): Promise<void> {
    let handle: fs.FileHandle;
    try { handle = await fs.open(this.filename, 'r'); } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      if (this.generation !== undefined) this.reset(); // another window quarantined the log
      if (!this.legacy) await this.loadLegacy();
      return;
    }
    try {
      const { size } = await handle.stat();
      const head = Buffer.alloc(Math.min(size, 512));
      await handle.read(head, 0, head.length, 0);
      const newline = head.indexOf(10);
      let header: Header | undefined;
      try { header = newline > 0 ? JSON.parse(head.subarray(0, newline).toString('utf8')) : undefined; } catch { /* damaged below */ }
      if (header?.version !== 2 || typeof header.generation !== 'string') throw new DamagedMemoryError(this.filename);
      // A new generation means another window compacted (atomically replaced) the log: start over.
      if (header.generation !== this.generation || size < this.offset) {
        this.reset();
        this.generation = header.generation;
        this.offset = newline + 1;
      }
      if (size <= this.offset) return;
      const tail = Buffer.alloc(size - this.offset);
      await handle.read(tail, 0, tail.length, this.offset);
      // Only complete lines: a concurrent append may be half-written, and a crash can leave a partial line.
      const end = tail.lastIndexOf(10);
      if (end < 0) return;
      for (const line of tail.subarray(0, end).toString('utf8').split('\n')) {
        if (!line) continue;
        let op: any;
        try { op = JSON.parse(line); } catch { throw new DamagedMemoryError(this.filename); }
        if (op && validEntry(op.put)) this.apply({ put: op.put });
        else if (op && typeof op.del === 'string') this.apply({ del: op.del });
        else if (op && typeof op.touch === 'string' && typeof op.at === 'number') this.apply({ touch: op.touch, at: op.at });
        else throw new DamagedMemoryError(this.filename);
      }
      this.offset += end + 1;
    } finally { await handle.close(); }
  }
  private async loadLegacy() {
    let parsed: { version?: unknown; entries?: unknown };
    try { parsed = JSON.parse(await fs.readFile(this.legacyFilename, 'utf8')); } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw new DamagedMemoryError(this.legacyFilename);
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(validEntry)) throw new DamagedMemoryError(this.legacyFilename);
    this.reset();
    for (const entry of parsed.entries) this.set(entry);
    this.legacy = true;
  }

  private async compact() {
    const generation = randomUUID();
    const body = [JSON.stringify({ version: 2, generation } satisfies Header), ...[...this.entries.values()].map(put => JSON.stringify({ put }))].join('\n') + '\n';
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, body, { mode: 0o600 });
      await fs.rename(temporary, this.filename);
    } finally { await fs.rm(temporary, { force: true }); }
    this.generation = generation;
    this.offset = Buffer.byteLength(body);
    if (this.legacy) {
      this.legacy = false;
      // Keep the v1 file as a backup, renamed so it is never imported again.
      await fs.rename(this.legacyFilename, `${this.legacyFilename}.migrated`).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
    }
  }

  // `purge`: the caller deleted data on purpose, so rewrite now rather than leave its text in dead log lines.
  private mutate(fn: (tx: Transaction) => void, purge = false): Promise<void> {
    const operation = this.queue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const release = await lockfile.lock(this.directory, {
        stale: 30_000, retries: { retries: 20, minTimeout: 30, maxTimeout: 300 }
      });
      try {
        await this.refresh();
        const ops: Operation[] = [];
        const record = (op: Operation) => { this.apply(op); ops.push(op); };
        const tx: Transaction = {
          entries: this.entries,
          put: entry => record({ put: entry }),
          del: id => { if (this.entries.has(id)) record({ del: id }); },
          touch: (id, at) => { const e = this.entries.get(id); if (e && e.capturedAt < at) record({ touch: id, at }); }
        };
        try {
          fn(tx);
          // Evict least recently captured/used unpinned entries; sorting only happens when over the cap.
          const limit = this.limitBytes();
          if (this.unpinnedBytes > limit) {
            for (const e of [...this.entries.values()].filter(e => !e.pinned).sort((a, b) => a.capturedAt - b.capturedAt)) {
              if (this.unpinnedBytes <= limit) break;
              tx.del(e.id);
            }
          }
          if (!ops.length) return;
          if (this.legacy || this.generation === undefined || purge) { await this.compact(); return; }
          // Under the lock nobody else appends, so bytes past our offset are a crash remnant: drop them
          // rather than gluing the next line onto a partial one.
          const { size } = await fs.stat(this.filename);
          if (size > this.offset) await fs.truncate(this.filename, this.offset);
          const lines = ops.map(op => JSON.stringify(op) + '\n').join('');
          await fs.appendFile(this.filename, lines, { mode: 0o600 });
          this.offset += Buffer.byteLength(lines);
          if (this.offset > 2 * this.liveBytes + 1024 * 1024) await this.compact();
        } catch (error) {
          // Memory may now be ahead of disk; force a full reload on the next read.
          this.reset();
          throw error;
        }
      } finally { await release(); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  /** Records captures as history (removed or explicitly saved code). Seeing known content again refreshes its age. */
  async capture(captures: Capture[]): Promise<void> {
    if (!captures.length) return;
    await this.mutate(tx => {
      const now = Date.now();
      for (const c of captures) {
        const id = idOf(c);
        const existing = tx.entries.get(id);
        // A live mirror that was just removed from its file becomes history.
        if (existing?.live) tx.put({ ...existing, live: undefined, capturedAt: now });
        else if (existing) tx.touch(id, now);
        else tx.put({ ...c, id, capturedAt: now, pinned: false, tags: [], snippet: false });
      }
    });
  }

  /**
   * Mirrors the declarations currently present in one file. Earlier live versions of a still-declared name are
   * replaced instead of piling up per idle pause; live entries whose name disappeared are kept as history.
   */
  async snapshot(scope: Pick<Capture, 'project' | 'file'>, captures: Capture[]): Promise<void> {
    await this.mutate(tx => {
      const now = Date.now();
      const wanted = new Map(captures.map(c => [idOf(c), c]));
      const names = new Set(captures.map(c => c.name));
      const stale = [...tx.entries.values()].filter(e => e.live && !e.pinned && e.file === scope.file && e.project === scope.project && !wanted.has(e.id));
      for (const e of stale) {
        if (names.has(e.name)) tx.del(e.id);
        else tx.put({ ...e, live: undefined });
      }
      for (const [id, c] of wanted) {
        // Existing history with identical content stays history, so a later edit can never delete it.
        if (!tx.entries.has(id)) tx.put({ ...c, id, capturedAt: now, pinned: false, tags: [], snippet: false, live: true });
      }
    });
  }

  async pin(capture: Capture, title: string, tags: string[] = [], snippet = false): Promise<void> {
    await this.mutate(tx => {
      const existing = [...tx.entries.values()].find(e => e.text === capture.text && e.file === capture.file && e.project === capture.project);
      // Pinned entries are no longer live mirrors, so later edits of the source file cannot replace them.
      if (existing) tx.put({ ...existing, name: title, tags, snippet, pinned: true, live: undefined });
      else tx.put({ ...capture, name: title, tags, snippet, id: randomUUID(), capturedAt: Date.now(), pinned: true });
    });
  }
  async touch(id: string): Promise<void> { await this.mutate(tx => tx.touch(id, Date.now())); }
  async remove(id: string): Promise<void> { await this.mutate(tx => tx.del(id), true); }
  async update(id: string, changes: Pick<MemoryEntry, 'name' | 'tags' | 'pinned' | 'snippet'>): Promise<void> {
    await this.mutate(tx => { const e = tx.entries.get(id); if (e) tx.put({ ...e, ...changes, live: changes.pinned ? undefined : e.live }); });
  }
  async clearHistory(): Promise<void> {
    await this.mutate(tx => { for (const e of [...tx.entries.values()]) if (!e.pinned) tx.del(e.id); }, true);
  }
  /** Moves a damaged database aside (never deletes it) so memory can start fresh. Returns the backup path. */
  async quarantine(file: string): Promise<string> {
    if (file !== this.filename && file !== this.legacyFilename) throw new Error('Not a Nihilanth memory file.');
    let backup = '';
    const operation = this.queue.then(async () => {
      const release = await lockfile.lock(this.directory, { stale: 30_000, retries: { retries: 20, minTimeout: 30, maxTimeout: 300 } });
      try {
        backup = `${file}.damaged-${Date.now()}`;
        await fs.rename(file, backup);
        this.reset();
      } finally { await release(); }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return backup;
  }
  async flush(): Promise<void> { await this.queue; }
}
