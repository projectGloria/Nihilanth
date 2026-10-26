import * as vscode from 'vscode';
import * as path from 'node:path';
import { Capture } from './model';
import { declarations } from './syntax';
import { MemoryStore } from './storage';

const supported = new Set(['javascript', 'javascriptreact', 'typescript', 'typescriptreact']);
export class CaptureService implements vscode.Disposable {
  private buffers = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Capture[]>();
  private disposables: vscode.Disposable[];
  constructor(private store: MemoryStore, private report: (e: unknown) => void) {
    this.disposables = [
      vscode.workspace.onDidOpenTextDocument(d => this.open(d)),
      vscode.workspace.onDidChangeTextDocument(e => this.change(e)),
      vscode.workspace.onDidCloseTextDocument(d => this.close(d)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('nihilanth')) {
          for (const timer of this.timers.values()) clearTimeout(timer);
          this.timers.clear(); this.pending.clear(); this.buffers.clear();
          for (const d of vscode.workspace.textDocuments) this.open(d);
        }
      })
    ];
    for (const doc of vscode.workspace.textDocuments) this.open(doc);
  }
  private eligible(doc: vscode.TextDocument): boolean {
    const config = vscode.workspace.getConfiguration('nihilanth');
    if (!config.get('captureEnabled', true) || !supported.has(doc.languageId) || !['file', 'untitled'].includes(doc.uri.scheme)) return false;
    if (Buffer.byteLength(doc.getText()) > config.get('maxDocumentKB', 512) * 1024) return false;
    const segments = doc.uri.path.split('/');
    return !config.get<string[]>('excludedFolders', []).some(folder => segments.includes(folder)) &&
      !config.get<string[]>('excludedFiles', []).includes(path.basename(doc.uri.path));
  }
  metadata(doc: vscode.TextDocument): Pick<Capture, 'file' | 'project' | 'language'> {
    return { file: doc.uri.toString(), project: vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ?? 'Loose files', language: doc.languageId };
  }
  private extract(doc: vscode.TextDocument, text: string): Capture[] {
    return declarations(text, doc.fileName).map(d => ({ ...this.metadata(doc), name: d.name, text: d.text }));
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
        const named = declarations(before, doc.fileName);
        const additions = this.pending.get(key) ?? [];
        for (const c of destructive) {
          const end = c.rangeOffset + c.rangeLength;
          const matching = named.filter(d => (c.rangeOffset <= d.nameStart && end >= d.nameEnd) || (c.rangeOffset <= d.start && end >= d.end));
          additions.push(...matching.map(d => ({ ...this.metadata(doc), name: d.name, text: d.text })));
          const removed = before.slice(c.rangeOffset, end).trim();
          if (removed.length >= 24 && !removed.startsWith(vscode.workspace.getConfiguration('nihilanth').get('prefix', '/'))) additions.push({
            ...this.metadata(doc), name: `Removed: ${removed.split(/\r?\n/)[0].slice(0, 60)}`, text: removed
          });
        }
        this.pending.set(key, additions);
      }
    }
    this.buffers.set(key, doc.getText());
    this.schedule(doc);
  }
  private schedule(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      const captures = [...(this.pending.get(key) ?? []), ...(this.eligible(doc) ? this.extract(doc, doc.getText()) : [])];
      this.pending.delete(key);
      void this.store.capture(captures).catch(this.report);
    }, 750));
  }
  private close(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const text = this.buffers.get(key);
    const captures = [...(this.pending.get(key) ?? []), ...(text !== undefined && this.eligible(doc) ? this.extract(doc, text) : [])];
    this.pending.delete(key); this.buffers.delete(key);
    void this.store.capture(captures).catch(this.report);
  }
  async flushRemoved() {
    const captures = [...this.pending.values()].flat();
    this.pending.clear();
    await this.store.capture(captures);
    await this.store.flush();
  }
  async flush() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const captures = [...this.pending.values()].flat();
    this.pending.clear();
    for (const doc of vscode.workspace.textDocuments) if (this.eligible(doc)) captures.push(...this.extract(doc, doc.getText()));
    await this.store.capture(captures);
    await this.store.flush();
  }
  dispose() { for (const d of this.disposables) d.dispose(); for (const timer of this.timers.values()) clearTimeout(timer); }
}
