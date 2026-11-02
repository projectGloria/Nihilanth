import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as lockfile from 'proper-lockfile';
import { Capture, MemoryEntry } from './model';
import { isCompleteDeclaration, scriptName } from './syntax';

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
export interface StoreOptions {
  now?: () => number;
  /** Receives problems that must not fail the current operation, such as a compromised lock. */
  report?: (error: unknown) => void;
  /** Bytes read per step while loading; the log may be larger than V8's maximum string length. */
  chunkBytes?: number;
}

export class DamagedMemoryError extends Error {
  constructor(readonly file: string) { super('Unsupported or damaged memory database; the original file has been preserved.'); }
}

// A live version older than this is a checkpoint: replacing it keeps it as history instead of deleting it.
export const checkpointMs = 10 * 60_000;
// An unchanged live declaration refreshes its LRU age at most this often, which bounds the extra log lines.
export const seenRefreshMs = 60 * 60_000;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const idOf = (c: Capture) => createHash('sha256').update(`${c.project}\0${c.file}\0${c.language}\0${c.name}\0${c.text}`).digest('hex');
const demote = (e: MemoryEntry, capturedAt = e.capturedAt): MemoryEntry => ({ ...e, live: undefined, since: undefined, capturedAt });
const complete = (c: Pick<Capture, 'text' | 'file' | 'language'>) => isCompleteDeclaration(c.text, scriptName(c.file, c.language));
function validEntry(e: any): e is MemoryEntry {
  return !!e && typeof e.id === 'string' && typeof e.text === 'string' && typeof e.name === 'string' &&
    typeof e.project === 'string' && typeof e.file === 'string' && typeof e.language === 'string' &&
    typeof e.capturedAt === 'number' && typeof e.pinned === 'boolean' && Array.isArray(e.tags) &&
    !e.tags.some((t: unknown) => typeof t !== 'string') && typeof e.snippet === 'boolean' &&
    (e.live === undefined || typeof e.live === 'boolean') && (e.since === undefined || typeof e.since === 'number');
}
// Antivirus and indexers briefly hold new files open on Windows, which makes the atomic rename fail with EPERM/EBUSY.
async function rename(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await fs.rename(from, to); } catch (error) {
      if (attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(errorCode(error) ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
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
  private readonly now: () => number;
  private readonly report: (error: unknown) => void;
  private readonly chunkBytes: number;
  readonly filename: string;
  private readonly legacyFilename: string;
  constructor(readonly directory: string, private limitBytes: () => number, options: StoreOptions = {}) {
    this.filename = path.join(directory, 'memory-v2.jsonl');
    this.legacyFilename = path.join(directory, 'memory-v1.json');
    this.now = options.now ?? Date.now;
    this.report = options.report ?? (() => undefined);
    this.chunkBytes = options.chunkBytes ?? 8 * 1024 * 1024;
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
  private applyLine(line: string) {
    if (!line) return;
    let op: any;
    try { op = JSON.parse(line); } catch { throw new DamagedMemoryError(this.filename); }
    if (op && validEntry(op.put)) this.apply({ put: op.put });
    else if (op && typeof op.del === 'string') this.apply({ del: op.del });
    else if (op && typeof op.touch === 'string' && typeof op.at === 'number') this.apply({ touch: op.touch, at: op.at });
    else throw new DamagedMemoryError(this.filename);
  }

  // Single-flight: concurrent list() calls share one read.
  private refresh(): Promise<void> {
    return this.refreshing ??= this.load().finally(() => { this.refreshing = undefined; });
  }
  // Runs `fn` as the only reader of this store's state. A read that began before the caller took the lock can miss
  // another window's append (the write would then truncate it away), and a read overlapping an append counts the
  // appended bytes twice. So wait out reads in flight, then make list() wait until `fn` is done.
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (this.refreshing) await this.refreshing.catch(() => undefined);
    let done!: () => void;
    this.refreshing = new Promise<void>(resolve => { done = resolve; });
    try { return await fn(); } finally { this.refreshing = undefined; done(); }
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
      // Chunks, not one string: a large log can exceed V8's maximum string length. Only complete lines are applied;
      // a concurrent append may be half-written, and a crash can leave a partial line.
      let position = this.offset;
      let carry = Buffer.alloc(0);
      while (position < size) {
        const chunk = Buffer.alloc(Math.min(this.chunkBytes, size - position));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
        const end = data.lastIndexOf(10);
        if (end < 0) { carry = data; continue; }
        for (const line of data.subarray(0, end).toString('utf8').split('\n')) this.applyLine(line);
        this.offset += end + 1;
        carry = data.subarray(end + 1);
      }
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
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, 'w', 0o600);
      let bytes = 0;
      try {
        // Line by line, for the same string-length reason as load().
        for (const line of [JSON.stringify({ version: 2, generation } satisfies Header), ...[...this.entries.values()].map(put => JSON.stringify({ put }))]) {
          const buffer = Buffer.from(`${line}\n`);
          await file.write(buffer);
          bytes += buffer.length;
        }
      } finally { await file.close(); }
      await rename(temporary, this.filename);
      this.generation = generation;
      this.offset = bytes;
    } finally { await fs.rm(temporary, { force: true }); }
    if (this.legacy) {
      this.legacy = false;
      // Keep the v1 file as a backup, renamed so it is never imported again.
      await rename(this.legacyFilename, `${this.legacyFilename}.migrated`).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
    }
  }
  // Under the lock and after a fresh read, bytes past our offset can only be a crash remnant without a newline.
  // Anything else means the log changed in a way this window does not understand: write nothing rather than cut it.
  private async dropPartialTail(size: number) {
    const handle = await fs.open(this.filename, 'r+');
    try {
      const tail = Buffer.alloc(size - this.offset);
      await handle.read(tail, 0, tail.length, this.offset);
      if (tail.includes(10)) throw new Error('The memory log changed unexpectedly; nothing was written. Try again.');
      await handle.truncate(this.offset);
    } finally { await handle.close(); }
  }
  private async lock() {
    const release = await lockfile.lock(this.directory, {
      stale: 30_000, retries: { retries: 20, minTimeout: 30, maxTimeout: 300 },
      // The default handler throws from a timer, which surfaces as an uncaught exception in the extension host.
      onCompromised: error => this.report(error)
    });
    return () => release().catch(error => this.report(error));
  }

  // `purge`: the caller deleted data on purpose, so rewrite now rather than leave its text in dead log lines.
  private mutate(fn: (tx: Transaction, now: number) => void, purge = false): Promise<void> {
    const operation = this.queue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const release = await this.lock();
      try {
        await this.exclusive(async () => {
          await this.load();
          const ops: Operation[] = [];
          const record = (op: Operation) => { this.apply(op); ops.push(op); };
          const tx: Transaction = {
            entries: this.entries,
            put: entry => record({ put: entry }),
            del: id => { if (this.entries.has(id)) record({ del: id }); },
            touch: (id, at) => { const e = this.entries.get(id); if (e && e.capturedAt < at) record({ touch: id, at }); }
          };
          try {
            fn(tx, this.now());
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
            const { size } = await fs.stat(this.filename);
            if (size > this.offset) await this.dropPartialTail(size);
            const lines = ops.map(op => JSON.stringify(op) + '\n').join('');
            await fs.appendFile(this.filename, lines, { mode: 0o600 });
            this.offset += Buffer.byteLength(lines);
            if (this.offset > 2 * this.liveBytes + 1024 * 1024) await this.compact();
          } catch (error) {
            // Memory may now be ahead of disk; force a full reload on the next read.
            this.reset();
            throw error;
          }
        });
      } finally { await release(); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  /** Records captures as history (removed or explicitly saved code). Seeing known content again refreshes its age. */
  async capture(captures: Capture[]): Promise<void> {
    if (!captures.length) return;
    await this.mutate((tx, now) => {
      for (const c of captures) {
        const id = idOf(c);
        const existing = tx.entries.get(id);
        // A live mirror that was just removed from its file becomes history.
        if (existing?.live) tx.put(demote(existing, now));
        else if (existing) tx.touch(id, now);
        else tx.put({ ...c, id, capturedAt: now, pinned: false, tags: [], snippet: false });
      }
    });
  }

  /**
   * Mirrors the declarations currently present in one file. A new version of a name replaces the previous live one
   * instead of piling up per idle pause, with three exceptions that keep the previous version as history:
   * it was live for longer than the checkpoint window, or the new version is broken (`const nihil = ;` mid-edit).
   * Broken versions never become live, so the last good one keeps mirroring the file until the code parses again.
   * Live entries whose name vanished become history, unless the name was only being typed (`getU` → `getUser`).
   */
  async snapshot(scope: Pick<Capture, 'project' | 'file'>, captures: Capture[]): Promise<void> {
    await this.mutate((tx, now) => {
      const usable = captures.filter(complete);
      const wanted = new Map(usable.map(c => [idOf(c), c]));
      const present = new Set(captures.map(c => c.name));
      const replaced = new Set(usable.map(c => c.name));
      const stale = [...tx.entries.values()].filter(e => e.live && !e.pinned && e.file === scope.file && e.project === scope.project);
      for (const e of stale) {
        if (wanted.has(e.id)) {
          // Still present unchanged: refresh its LRU age now and then, so stable code is not evicted as "old".
          if (now - e.capturedAt > seenRefreshMs) tx.touch(e.id, now);
          continue;
        }
        const draft = now - (e.since ?? e.capturedAt) < checkpointMs;
        if (present.has(e.name)) {
          // Only broken versions of the name exist right now: keep this one live as the last good version.
          if (!replaced.has(e.name)) continue;
          if (draft) tx.del(e.id); else tx.put(demote(e));
        } else if (draft && [...present].some(name => name.startsWith(e.name) || e.name.startsWith(name))) tx.del(e.id);
        else tx.put(demote(e));
      }
      for (const [id, c] of wanted) {
        // Existing history with identical content stays history, so a later edit can never delete it.
        if (!tx.entries.has(id)) tx.put({ ...c, id, capturedAt: now, since: now, pinned: false, tags: [], snippet: false, live: true });
      }
    });
  }

  async pin(source: Capture & { id?: string }, title: string, tags: string[] = [], snippet = false): Promise<void> {
    await this.mutate((tx, now) => {
      // The entry the user picked, by id; only a fresh selection is matched by its text (several entries can share it).
      const existing = (source.id !== undefined ? tx.entries.get(source.id) : undefined) ??
        [...tx.entries.values()].find(e => e.text === source.text && e.file === source.file && e.project === source.project);
      // Pinned entries are no longer live mirrors, so later edits of the source file cannot replace them.
      if (existing) tx.put({ ...existing, name: title, tags, snippet, pinned: true, live: undefined, since: undefined });
      else tx.put({ name: title, text: source.text, file: source.file, project: source.project, language: source.language, tags, snippet, id: randomUUID(), capturedAt: now, pinned: true });
    });
  }
  async touch(id: string): Promise<void> { await this.mutate((tx, now) => tx.touch(id, now)); }
  async remove(id: string): Promise<void> { await this.mutate(tx => tx.del(id), true); }
  async update(id: string, changes: Pick<MemoryEntry, 'name' | 'tags' | 'pinned' | 'snippet'>): Promise<void> {
    await this.mutate(tx => { const e = tx.entries.get(id); if (e) tx.put({ ...e, ...changes, live: changes.pinned ? undefined : e.live }); });
  }
  /** Deletes unpinned entries, then the v1 backup, which holds the same history in plaintext (its pins live on in v2). */
  async clearHistory(): Promise<void> {
    await this.mutate(tx => { for (const e of [...tx.entries.values()]) if (!e.pinned) tx.del(e.id); }, true);
    await fs.rm(`${this.legacyFilename}.migrated`, { force: true });
  }
  /** Quarantined databases (see quarantine()); they may still hold history the user cleared. */
  async backups(): Promise<string[]> {
    const names = await fs.readdir(this.directory).catch(error => { if (errorCode(error) === 'ENOENT') return [] as string[]; throw error; });
    return names.filter(name => /^memory-v[12]\.jsonl?\.damaged-\d+$/.test(name)).map(name => path.join(this.directory, name));
  }
  async deleteBackups(): Promise<void> { for (const file of await this.backups()) await fs.rm(file, { force: true }); }
  /** Moves a damaged database aside (never deletes it) so memory can start fresh. Returns the backup path. */
  async quarantine(file: string): Promise<string> {
    if (file !== this.filename && file !== this.legacyFilename) throw new Error('Not a Nihilanth memory file.');
    let backup = '';
    const operation = this.queue.then(async () => {
      const release = await this.lock();
      try {
        await this.exclusive(async () => {
          backup = `${file}.damaged-${this.now()}`;
          await rename(file, backup);
          this.reset();
        });
      } finally { await release(); }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return backup;
  }
  async flush(): Promise<void> { await this.queue; }
}
