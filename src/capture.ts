import * as vscode from 'vscode';
import * as path from 'node:path';
import { Capture, MemoryEntry, looksSecret } from './model';
import { declarations, removesWholeIdentifier } from './syntax';
import { MemoryStore } from './storage';

const supported = new Set(['javascript', 'javascriptreact', 'typescript', 'typescriptreact']);
// Larger removals are bulk replacements (reload after a branch switch, whole-document formatters), not
// fragments worth recalling; any declarations they removed are still captured individually.
const maxFragmentChars = 16 * 1024;
export class CaptureService implements vscode.Disposable {
  private buffers = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Capture[]>();
  // Removals taken from `pending` whose write has not finished; recall must still see them meanwhile.
  private writing = new Set<Capture[]>();
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
  private eligible(doc: vscode.TextDocument): boolean {
    const config = vscode.workspace.getConfiguration('nihilanth');
    // Untrusted code is not copied into cross-project memory; recall of existing memory still works.
    if (!vscode.workspace.isTrusted || !config.get('captureEnabled', true) || !supported.has(doc.languageId) || !['file', 'untitled'].includes(doc.uri.scheme)) return false;
    // Size check without copying the document on every keystroke: UTF-16 length bounds UTF-8 bytes to [n, 3n].
    const limit = config.get('maxDocumentKB', 512) * 1024;
    const length = doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end);
    if (length > limit || (length * 3 > limit && Buffer.byteLength(doc.getText()) > limit)) return false;
    const segments = doc.uri.path.split('/');
    return !config.get<string[]>('excludedFolders', []).some(folder => segments.includes(folder)) &&
      !config.get<string[]>('excludedFiles', []).includes(path.basename(doc.uri.path));
  }
  metadata(doc: vscode.TextDocument): Pick<Capture, 'file' | 'project' | 'language'> {
    return { file: doc.uri.toString(), project: vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ?? 'Loose files', language: doc.languageId };
  }
  private extract(doc: vscode.TextDocument, text: string): Capture[] {
    return declarations(text, doc.fileName).filter(d => !looksSecret(d.text)).map(d => ({ ...this.metadata(doc), name: d.name, text: d.text }));
  }
  private open(doc: vscode.TextDocument) {
    if (!this.eligible(doc)) return;
    this.buffers.set(doc.uri.toString(), doc.getText());
    this.schedule(doc);
  }
  private change(event: vscode.TextDocumentChangeEvent) {
    const doc = event.document;
    const key = doc.uri.toString();
    if (!this.eligible(doc)) { this.buffers.delete(key); this.pending.delete(key); const timer = this.timers.get(key); if (timer) clearTimeout(timer); this.timers.delete(key); return; }
    if (!event.contentChanges.length) return;
    const before = this.buffers.get(key);
    if (before !== undefined) {
      const destructive = event.contentChanges.filter(c => c.rangeLength > 0);
      if (destructive.length) {
        const additions = this.pending.get(key) ?? [];
        const prefix = vscode.workspace.getConfiguration('nihilanth').get('prefix', '/');
        // Parsing the previous buffer is the expensive part; a deletion that removes no whole identifier
        // (the common single-character backspace) cannot remove a declaration or its name.
        const named = destructive.some(c => removesWholeIdentifier(before, c.rangeOffset, c.rangeOffset + c.rangeLength)) ? declarations(before, doc.fileName) : [];
        for (const c of destructive) {
          const end = c.rangeOffset + c.rangeLength;
          const matching = named.filter(d => (c.rangeOffset <= d.nameStart && end >= d.nameEnd) || (c.rangeOffset <= d.start && end >= d.end));
          additions.push(...matching.filter(d => !looksSecret(d.text)).map(d => ({ ...this.metadata(doc), name: d.name, text: d.text })));
          const removed = before.slice(c.rangeOffset, end).trim();
          const wholeDocument = c.rangeOffset === 0 && c.rangeLength === before.length;
          if (removed.length >= 24 && removed.length <= maxFragmentChars && !wholeDocument && !removed.startsWith(prefix) && !looksSecret(removed)) additions.push({
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
    void this.persist(doc, text !== undefined && this.eligible(doc) ? text : undefined).catch(this.report);
  }
  private async writeRemoved(captures: Capture[]) {
    if (!captures.length) return;
    this.writing.add(captures);
    try { await this.store.capture(captures); } finally { this.writing.delete(captures); }
  }
  private takePending(): Capture[] {
    const captures = [...this.pending.values()].flat();
    this.pending.clear();
    return captures;
  }
  /** Removals not yet written, shaped as entries so recall can offer them before the idle timer fires. */
  pendingEntries(): MemoryEntry[] {
    const now = Date.now();
    return [...this.pending.values(), ...this.writing].flat().map((c, i) => ({ ...c, id: `pending:${i}`, capturedAt: now, pinned: false, tags: [], snippet: false }));
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
  dispose() { for (const d of this.disposables) d.dispose(); for (const timer of this.timers.values()) clearTimeout(timer); }
}
