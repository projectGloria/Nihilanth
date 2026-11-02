import * as vscode from 'vscode';
import * as path from 'node:path';
import { Capture, MemoryEntry, looksSecret } from './model';
import { declarations, removesWholeIdentifier, scriptName } from './syntax';
import { DamagedMemoryError, MemoryStore } from './storage';

const supported = new Set(['javascript', 'javascriptreact', 'typescript', 'typescriptreact']);
// Larger removals are bulk replacements (reload after a branch switch, whole-document formatters), not
// fragments worth recalling; any declarations they removed are still captured individually.
const maxFragmentChars = 16 * 1024;
// Bigger declarations (generated tables, bundled data) would bloat memory and every completion list that offers them.
const maxDeclarationChars = 64 * 1024;
export class CaptureService implements vscode.Disposable {
  private buffers = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Capture[]>();
  // Removals taken from `pending` whose write has not finished; recall must still see them meanwhile.
  private writing = new Set<Capture[]>();
  // Removals whose write failed (lock timeout, Windows EPERM, damaged database). They are kept, offered by recall,
  // and written with the next attempt instead of being dropped.
  private failed: Capture[] = [];
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 5_000;
  private disposables: vscode.Disposable[];
  constructor(private store: MemoryStore, private report: (e: unknown) => void) {
    const restart = () => {
      // Persist removals observed under the old settings before resetting; they were eligible when seen.
      void this.writeRemoved(this.takePending()).catch(this.report);
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear(); this.buffers.clear();
      for (const d of vscode.workspace.textDocuments) this.open(d);
    };
    this.disposables = [
      vscode.workspace.onDidOpenTextDocument(d => this.open(d)),
      vscode.workspace.onDidChangeTextDocument(e => this.change(e)),
      vscode.workspace.onDidCloseTextDocument(d => this.close(d)),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('nihilanth')) restart(); }),
      vscode.workspace.onDidGrantWorkspaceTrust(restart)
    ];
    for (const doc of vscode.workspace.textDocuments) this.open(doc);
  }
  /** Over `maxDocumentKB`: automatic capture and automatic recall both skip the document. */
  oversized(doc: vscode.TextDocument): boolean {
    // Size check without copying the document on every keystroke: UTF-16 length bounds UTF-8 bytes to [n, 3n].
    const limit = vscode.workspace.getConfiguration('nihilanth').get('maxDocumentKB', 512) * 1024;
    const length = doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end);
    return length > limit || (length * 3 > limit && Buffer.byteLength(doc.getText()) > limit);
  }
  private eligible(doc: vscode.TextDocument): boolean {
    const config = vscode.workspace.getConfiguration('nihilanth');
    // Untrusted code is not copied into cross-project memory; recall of existing memory still works.
    if (!vscode.workspace.isTrusted || !config.get('captureEnabled', true) || !supported.has(doc.languageId) || !['file', 'untitled'].includes(doc.uri.scheme)) return false;
    if (this.oversized(doc)) return false;
    const segments = doc.uri.path.split('/');
    return !config.get<string[]>('excludedFolders', []).some(folder => segments.includes(folder)) &&
      !config.get<string[]>('excludedFiles', []).includes(path.basename(doc.uri.path));
  }
  metadata(doc: vscode.TextDocument): Pick<Capture, 'file' | 'project' | 'language'> {
    // Every window names its first scratch buffer `untitled:Untitled-1`; the session id keeps unrelated buffers from
    // replacing each other's live entries.
    const file = doc.uri.scheme === 'untitled' ? `${doc.uri.toString()}#${vscode.env.sessionId}` : doc.uri.toString();
    return { file, project: vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ?? 'Loose files', language: doc.languageId };
  }
  private keep(text: string) { return text.length <= maxDeclarationChars && !looksSecret(text); }
  private extract(doc: vscode.TextDocument, text: string): Capture[] {
    return declarations(text, scriptName(doc.fileName, doc.languageId)).filter(d => this.keep(d.text)).map(d => ({ ...this.metadata(doc), name: d.name, text: d.text }));
  }
  private open(doc: vscode.TextDocument) {
    if (!this.eligible(doc)) return;
    this.buffers.set(doc.uri.toString(), doc.getText());
    this.schedule(doc);
  }
  private change(event: vscode.TextDocumentChangeEvent) {
    const doc = event.document;
    const key = doc.uri.toString();
    if (!this.eligible(doc)) {
      // Removals seen while the document was eligible (before it grew past the size limit, say) are still written.
      const removed = this.pending.get(key);
      if (removed) void this.writeRemoved(removed).catch(this.report);
      this.buffers.delete(key); this.pending.delete(key);
      const timer = this.timers.get(key); if (timer) clearTimeout(timer); this.timers.delete(key);
      return;
    }
    if (!event.contentChanges.length) return;
    const before = this.buffers.get(key);
    if (before !== undefined) {
      const destructive = event.contentChanges.filter(c => c.rangeLength > 0);
      if (destructive.length) {
        const additions = this.pending.get(key) ?? [];
        const prefix = vscode.workspace.getConfiguration('nihilanth').get('prefix', '/');
        // Parsing the previous buffer is the expensive part; a deletion that removes no whole identifier
        // (the common single-character backspace) cannot remove a declaration or its name.
        const named = destructive.some(c => removesWholeIdentifier(before, c.rangeOffset, c.rangeOffset + c.rangeLength)) ? declarations(before, scriptName(doc.fileName, doc.languageId)) : [];
        for (const c of destructive) {
          const end = c.rangeOffset + c.rangeLength;
          const matching = named.filter(d => ((c.rangeOffset <= d.nameStart && end >= d.nameEnd) || (c.rangeOffset <= d.start && end >= d.end)) && this.keep(d.text));
          additions.push(...matching.map(d => ({ ...this.metadata(doc), name: d.name, text: d.text })));
          const removed = before.slice(c.rangeOffset, end).trim();
          const wholeDocument = c.rangeOffset === 0 && c.rangeLength === before.length;
          // A removed line that is exactly one declaration is already stored under its name; a second
          // `Removed: …` copy only duplicated it in /recall and Manage.
          const duplicate = matching.some(d => d.text.trim() === removed);
          if (removed.length >= 24 && removed.length <= maxFragmentChars && !wholeDocument && !duplicate && !removed.startsWith(prefix) && !looksSecret(removed)) additions.push({
            ...this.metadata(doc), name: `Removed: ${removed.split(/\r?\n/)[0].slice(0, 60)}`, text: removed
          });
        }
        if (additions.length) this.pending.set(key, additions);
      }
    }
    this.buffers.set(key, doc.getText());
    this.schedule(doc);
  }
  private schedule(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.persist(doc, this.eligible(doc) ? doc.getText() : undefined).catch(this.report); }, 750));
  }
  // Removals go to history first so a live mirror that was just deleted is demoted before the snapshot runs.
  private async persist(doc: vscode.TextDocument, text: string | undefined) {
    const key = doc.uri.toString();
    const removed = this.pending.get(key) ?? [];
    this.pending.delete(key);
    await this.writeRemoved(removed);
    if (text !== undefined) await this.store.snapshot(this.metadata(doc), this.extract(doc, text));
  }
  private close(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const text = this.buffers.get(key);
    this.buffers.delete(key);
    const eligible = text !== undefined && this.eligible(doc);
    void this.persist(doc, eligible ? text : undefined).then(async () => {
      // A closed scratch buffer is gone for good: its last declarations become history instead of staying "live".
      if (eligible && doc.uri.scheme === 'untitled') await this.store.snapshot(this.metadata(doc), []);
    }).catch(this.report);
  }
  private async writeRemoved(captures: Capture[]) {
    const batch = [...this.failed.splice(0), ...captures];
    if (!batch.length) return;
    this.writing.add(batch);
    try {
      await this.store.capture(batch);
      this.retryDelay = 5_000;
    } catch (error) {
      this.failed.push(...batch);
      // A damaged database waits for the user's decision; the next write after it is moved aside includes these.
      if (!(error instanceof DamagedMemoryError) && !this.retryTimer) {
        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.writeRemoved([]).catch(this.report); }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
      }
      throw error;
    } finally { this.writing.delete(batch); }
  }
  private takePending(): Capture[] {
    const captures = [...this.pending.values()].flat();
    this.pending.clear();
    return captures;
  }
  /** Forgets removals not written yet; used when the user clears history. */
  discardPending() { this.pending.clear(); this.failed.length = 0; }
  /** Removals not yet written, shaped as entries so recall can offer them before the idle timer fires. */
  pendingEntries(): MemoryEntry[] {
    const now = Date.now();
    return [...this.pending.values(), ...this.writing, this.failed].flat().map((c, i) => ({ ...c, id: `pending:${i}`, capturedAt: now, pinned: false, tags: [], snippet: false }));
  }
  /** Writes everything observed so far: pending removals and documents with an unfinished idle timer. */
  async flush() {
    const scheduled = vscode.workspace.textDocuments.filter(d => this.timers.has(d.uri.toString()));
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.writeRemoved(this.takePending());
    for (const doc of scheduled) if (this.eligible(doc)) await this.store.snapshot(this.metadata(doc), this.extract(doc, doc.getText()));
    await this.store.flush();
  }
  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const timer of this.timers.values()) clearTimeout(timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }
}
