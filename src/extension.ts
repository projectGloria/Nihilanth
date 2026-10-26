import * as vscode from 'vscode';
import * as path from 'node:path';
import { CaptureService } from './capture';
import { parseDataRequest, parseDirective, commandNames } from './directives';
import { formatLiteral, generate, Generator, presets } from './generator';
import { MemoryEntry, searchEntries } from './model';
import { uniqueRecallEntries } from './recall';
import { MemoryStore } from './storage';
import { insideStringOrComment, parseLiteral } from './syntax';
import { transform, Transform, transforms } from './transforms';

const selector: vscode.DocumentSelector = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'jsonc'].map(language => ({ language, scheme: 'file' })).concat(
  ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'jsonc'].map(language => ({ language, scheme: 'untitled' }))
);
const actionKind = vscode.CodeActionKind.RefactorRewrite.append('nihilanth');
interface ManualSession { uri: string; line: number; until: number; onlyRecall: boolean }
let store: MemoryStore;
let capture: CaptureService;

export async function activate(context: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem('nihilanth.toolbox', vscode.StatusBarAlignment.Right, 100);
  status.name = 'Nihilanth Toolbox';
  status.text = '$(nihilanth-dragon) Nihilanth';
  status.tooltip = 'Nihilanth Toolbox — open suggestions at cursor';
  status.accessibilityInformation = { label: 'Nihilanth Toolbox: open suggestions at cursor' };
  status.command = 'nihilanth.open';
  context.subscriptions.push(status);
  const output = vscode.window.createOutputChannel('Nihilanth Toolbox');
  const report = (error: unknown) => output.appendLine(`${new Date().toISOString()} ${String(error)}`);
  const guard = (fn: (...args: any[]) => unknown) => async (...args: any[]) => {
    try { return await fn(...args); } catch (error) { report(error); void vscode.window.showErrorMessage(`Nihilanth: ${error instanceof Error ? error.message : String(error)}`); }
  };
  store = new MemoryStore(context.globalStorageUri.fsPath, () => vscode.workspace.getConfiguration('nihilanth').get('historyLimitMB', 100) * 1024 * 1024);
  capture = new CaptureService(store, report);
  let manual: ManualSession | undefined;
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  const config = () => vscode.workspace.getConfiguration('nihilanth');
  const register = (name: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`nihilanth.${name}`, guard(fn)));

  const preview = (code: string, language: string, detail: string) => new vscode.MarkdownString().appendText(detail).appendCodeblock(code, language);
  function item(label: string, insertion: string | vscode.SnippetString, range: vscode.Range, filter: string, detail: string, code: string, language: string, order: number) {
    const result = new vscode.CompletionItem({ label, detail: '  Nihilanth' }, vscode.CompletionItemKind.Event);
    result.insertText = insertion;
    result.range = range;
    result.filterText = filter;
    result.sortText = String(order).padStart(6, '0');
    result.detail = detail;
    result.documentation = preview(code, language, detail);
    result.command = { command: 'nihilanth.finish', title: 'Finish toolbox insertion' };
    return result;
  }

  const completionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(doc, position, token) {
      const prefix = config().get('prefix', '/');
      const line = doc.lineAt(position.line);
      const lineBefore = line.text.slice(0, position.character);
      const directive = parseDirective(lineBefore, prefix);
      const explicit = manual && manual.uri === doc.uri.toString() && manual.line === position.line && Date.now() <= manual.until;
      const word = doc.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/);
      const typed = word ? doc.getText(new vscode.Range(word.start, position)) : '';
      const automatic = !directive && !explicit;
      if (directive && line.text.slice(position.character).trim()) return;
      if (automatic && (!['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(doc.languageId) || typed.length < 2)) return;
      const contextOffset = directive ? doc.offsetAt(new vscode.Position(position.line, directive.start)) : Math.max(0, doc.offsetAt(position) - 1);
      if (insideStringOrComment(doc.getText(), contextOffset, doc.fileName)) return;
      const range = directive ? new vscode.Range(position.line, directive.start, position.line, line.text.length) :
        word ?? new vscode.Range(position, position);
      const filter = directive?.text ?? typed;
      const results: vscode.CompletionItem[] = [];
      const defaultFormat = doc.languageId.startsWith('json') ? 'json' : 'js';
      const count = config().get('defaultCount', 5);
      if (directive && !directive.command) {
        for (const command of commandNames.filter(c => c.startsWith(directive.partial))) {
          const commandText = `${prefix}${command} `;
          const entry = item(`/${command}`, commandText, range, `${directive.text}${command.slice(directive.partial.length)}`, `Nihilanth • ${command}`, command === 'data' ? `${prefix}data users 5\n${prefix}data from User 5 --format=json --seed=42` : `${prefix}${command} ${command === 'recall' ? 'exampleArray' : 'fetch'}`, 'text', results.length);
          entry.command = { command: 'nihilanth.trigger', title: 'Show command results' };
          results.push(entry);
        }
        return new vscode.CompletionList(results, true);
      }
      if (!directive || directive.command === 'recall' || directive.command === 'snippet') {
        const snippetOnly = directive?.command === 'snippet';
        const rawQuery = directive?.argument ?? filter;
        const currentOnly = /(?:^|\s)--project=current(?:\s|$)/.test(rawQuery);
        const query = rawQuery.replace(/(?:^|\s)--project=(?:current|all)(?=\s|$)/g, '').trim();
        const project = currentOnly ? vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ?? 'Loose files' : undefined;
        await capture.flushRemoved();
        const matches = searchEntries((await store.list()).filter(e => (!snippetOnly || e.pinned) &&
          (!automatic || (/^[A-Za-z_$][\w$]*$/.test(e.name) && e.name.toLowerCase().startsWith(typed.toLowerCase())))), query, project);
        const entries = uniqueRecallEntries(matches, doc.uri.toString(), capture.metadata(doc).project).slice(0, 40);
        if (token.isCancellationRequested) return;
        for (const e of entries) {
          const origin = `${e.pinned ? 'Pinned' : 'Memory'} • ${projectLabel(e.project)} • ${e.file} • ${new Date(e.capturedAt).toLocaleString()}`;
          if (!snippetOnly && /^[A-Za-z_$][\w$]*$/.test(e.name)) results.push(item(`${e.name} — name`, e.name, range, directive ? filter : e.name, origin, e.text, e.language, results.length));
          results.push(item(`${e.name} — ${e.snippet ? 'snippet' : 'code'}`, e.snippet ? new vscode.SnippetString(e.text) : e.text, range, directive ? filter : `${e.name} ${query}`, origin, e.text, e.language, results.length));
        }
      }
      if ((directive?.command === 'data' && !directive.argument.trim()) || (!directive && !manual?.onlyRecall && !filter)) {
        for (const preset of presets) {
          const request = parseDataRequest(preset, count);
          const code = generate(request, '', defaultFormat);
          results.push(item(`Generate ${request.count} ${preset}`, code, range, directive ? filter : '', `Nihilanth • ${preset}`, code, defaultFormat === 'json' ? 'json' : 'javascript', results.length));
        }
      } else if (directive?.command === 'data') {
        const argument = directive.argument.trim();
        const candidates = presets.filter(p => p.startsWith(argument));
        if (candidates.length && !presets.includes(argument)) {
          for (const preset of candidates) {
            const request = parseDataRequest(preset, count);
            const code = generate(request, '', defaultFormat);
            results.push(item(`Generate ${request.count} ${preset}`, code, range, filter, `Nihilanth • ${preset}`, code, doc.languageId, results.length));
          }
        } else {
          try {
            const request = parseDataRequest(argument, count);
            const text = doc.getText();
            const safeSource = text.slice(0, doc.offsetAt(new vscode.Position(position.line, directive.start))) + text.slice(doc.offsetAt(new vscode.Position(position.line, line.text.length)));
            const code = generate(request, safeSource, defaultFormat);
            results.push(item(`Generate ${request.count} ${request.source}`, code, range, filter, `Nihilanth • ${request.seed === undefined ? 'random' : `seed ${request.seed}`} • ${request.format ?? defaultFormat}`, code, doc.languageId, 0));
          } catch (error) {
            const hint = item('Nihilanth — check command', directive.text, range, filter, error instanceof Error ? error.message : String(error), `${prefix}data users 5\n${prefix}data from User 5 --format=json --seed=42`, 'text', 0);
            results.push(hint);
          }
        }
      }
      return new vscode.CompletionList(results, true);
    }
  };
  context.subscriptions.push(output, capture, vscode.languages.registerCompletionItemProvider(selector, completionProvider, '/', ' ', '=', '-'));

  const suggest = () => { if (suggestTimer) clearTimeout(suggestTimer); suggestTimer = setTimeout(() => { void vscode.commands.executeCommand('editor.action.triggerSuggest'); }, 75); };
  register('finish', () => { manual = undefined; });
  register('trigger', suggest);
  const open = async (onlyRecall = false) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!editor.selection.isEmpty && !onlyRecall) {
      await vscode.commands.executeCommand('editor.action.codeAction', { kind: actionKind.value, apply: 'never' });
      return;
    }
    manual = { uri: editor.document.uri.toString(), line: editor.selection.active.line, until: Date.now() + 120_000, onlyRecall };
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
  };
  register('open', () => open());
  register('recall', () => open(true));
  status.show();
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== e.document || !e.contentChanges.length) return;
    // The dedicated slash line is an explicit request; re-open suggestions after spaces/options too.
    const position = editor.selection.active;
    const directive = parseDirective(e.document.lineAt(position.line).text, config().get('prefix', '/'));
    if (directive && !insideStringOrComment(e.document.getText(), e.document.offsetAt(new vscode.Position(position.line, directive.start)), e.document.fileName)) suggest();
    else if (!e.reason && e.contentChanges.length === 1 && ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(e.document.languageId)) {
      const change = e.contentChanges[0];
      if (change.rangeLength || !/^[A-Za-z_$][\w$]*$/.test(change.text)) return;
      const doc = e.document;
      const version = doc.version;
      const at = doc.positionAt(change.rangeOffset + change.text.length);
      if (suggestTimer) clearTimeout(suggestTimer);
      // Read the caret after VS Code finishes applying the typing event.
      // Explicitly trigger matching memory instead of relying on quickSuggestions.
      suggestTimer = setTimeout(() => {
        void (async () => {
          const current = () => vscode.window.activeTextEditor === editor && doc.version === version &&
            editor.selection.isEmpty && editor.selection.active.isEqual(at);
          if (!current()) return;
          const word = doc.getWordRangeAtPosition(at, /[A-Za-z_$][\w$]*/);
          const typed = word ? doc.getText(new vscode.Range(word.start, at)) : '';
          if (typed.length < 2 || insideStringOrComment(doc.getText(), doc.offsetAt(at) - 1, doc.fileName)) return;
          await capture.flushRemoved();
          const matches = (await store.list()).some(entry => /^[A-Za-z_$][\w$]*$/.test(entry.name) && entry.name.toLowerCase().startsWith(typed.toLowerCase()));
          if (matches && current()) {
            // triggerSuggest alone reuses the list opened at the first letter,
            // where recall had no results yet. Reopen to query every provider.
            await vscode.commands.executeCommand('hideSuggestWidget');
            if (current()) await vscode.commands.executeCommand('editor.action.triggerSuggest');
          }
        })().catch(report);
      }, 75);
    }
  }), vscode.window.onDidChangeTextEditorSelection(e => {
    if (manual && (manual.uri !== e.textEditor.document.uri.toString() || e.selections[0].active.line !== manual.line)) manual = undefined;
  }), new vscode.Disposable(() => { if (suggestTimer) clearTimeout(suggestTimer); }));

  function projectLabel(project: string) { return project === 'Loose files' ? project : path.basename(vscode.Uri.parse(project).path) || project; }
  const sourceCapture = (editor: vscode.TextEditor, text: string) => ({ ...capture.metadata(editor.document), name: 'Snippet', text });
  async function pin(text?: string, entry?: MemoryEntry) {
    const editor = vscode.window.activeTextEditor;
    const selected = text ?? (editor && editor.document.getText(editor.selection));
    if (!selected?.trim()) throw new Error('Select some code first.');
    const name = await vscode.window.showInputBox({ title: 'Pin snippet', prompt: 'Name / search alias', value: entry?.name ?? selected.match(/(?:const|let|var|function|class|type|interface)\s+([\w$]+)/)?.[1] ?? 'My snippet', validateInput: value => value.trim() ? undefined : 'Enter a name.' });
    if (name === undefined) return;
    const tags = await vscode.window.showInputBox({ title: 'Snippet tags', prompt: 'Optional comma-separated tags', value: entry?.tags.join(', ') ?? '' });
    if (tags === undefined) return;
    const mode = await vscode.window.showQuickPick([
      { label: 'Literal code', snippet: false, description: 'Insert exactly as saved' },
      { label: 'Snippet placeholders', snippet: true, description: 'Interpret ${1:name} and $0 as editable placeholders' }
    ], { title: 'Snippet insertion mode' });
    if (!mode) return;
    await store.pin(entry ?? sourceCapture(editor!, selected), name.trim(), tags.split(',').map(t => t.trim()).filter(Boolean), mode.snippet);
    vscode.window.setStatusBarMessage(`Pinned “${name.trim()}”`, 3000);
  }
  register('pin', () => pin());

  async function applySelection(editor: vscode.TextEditor, selection: vscode.Selection, version: number, code: string) {
    if (editor.document.version !== version) throw new Error('The document changed while this action was open. Select the code and try again.');
    await editor.edit(edit => edit.replace(selection, code), { undoStopBefore: true, undoStopAfter: true });
  }
  register('transform', async (action?: Transform) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error('Select code or text to transform.');
    const selection = editor.selection;
    const version = editor.document.version;
    const text = editor.document.getText(selection);
    if (!action) {
      const choice = await vscode.window.showQuickPick(transforms.map(([id, label]) => ({ label, id })), { title: 'Transform selection' });
      if (!choice) return;
      action = choice.id;
    }
    await applySelection(editor, selection, version, transform(text, action));
  });
  register('generateType', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error('Select a local type name, a type declaration, or an example object.');
    const selection = editor.selection;
    const version = editor.document.version;
    const selected = editor.document.getText(selection).trim();
    const input = await vscode.window.showInputBox({ title: 'Generate sample data', prompt: 'Record count (1–1000)', value: String(config().get('defaultCount', 5)), validateInput: v => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 1000 ? undefined : 'Use a number from 1 to 1000.' });
    if (!input) return;
    const typeName = selected.match(/^(?:export\s+)?(?:type|interface)\s+([\w$]+)/)?.[1] ?? (/^[A-Za-z_$][\w$]*$/.test(selected) ? selected : undefined);
    const generator = new Generator();
    const count = Number(input);
    const value = typeName ? generator.fromType(editor.document.getText(), typeName, count) : Array.from({ length: count }, (_, i) => generator.example(parseLiteral(selected), i));
    const code = formatLiteral(value, editor.document.languageId.startsWith('json') ? 'json' : 'js');
    const choice = await vscode.window.showQuickPick([
      { label: 'Copy generated data', action: 'copy', description: 'Keep the selected source' },
      { label: 'Insert below selection', action: 'insert' },
      { label: 'Replace selection', action: 'replace' }
    ], { title: 'Generated data', placeHolder: code.slice(0, 180) });
    if (!choice) return;
    if (choice.action === 'copy') { await vscode.env.clipboard.writeText(code); return; }
    if (choice.action === 'replace') await applySelection(editor, selection, version, code);
    else {
      if (editor.document.version !== version) throw new Error('Document changed. Run the action again.');
      await editor.edit(edit => edit.insert(selection.end, `\n${code}\n`), { undoStopBefore: true, undoStopAfter: true });
    }
  });
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider(selector, {
    provideCodeActions(_document, range, actionContext) {
      if (range.isEmpty || actionContext.triggerKind !== vscode.CodeActionTriggerKind.Invoke) return [];
      const action = (title: string, command: string, args?: unknown[]) => {
        const a = new vscode.CodeAction(`Toolbox: ${title}`, actionKind);
        a.command = { command: `nihilanth.${command}`, title, arguments: args };
        return a;
      };
      return [action('Pin selection as snippet', 'pin'), action('Generate sample data', 'generateType'), ...transforms.map(([id, title]) => action(title, 'transform', [id]))];
    }
  }, { providedCodeActionKinds: [actionKind] }));

  const virtual = new Map<string, string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('nihilanth-preview', { provideTextDocumentContent: uri => virtual.get(uri.toString()) ?? '' }));
  register('manage', async () => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { entry: MemoryEntry }>();
    picker.title = 'Memory & snippets — all projects';
    picker.placeholder = 'Search names, code, tags, or projects';
    const editor = vscode.window.activeTextEditor;
    const currentProject = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString() ?? 'Loose files' : undefined;
    let currentOnly = false;
    if (currentProject) picker.buttons = [{ iconPath: new vscode.ThemeIcon('folder'), tooltip: 'Toggle all projects / current project' }];
    const entries = await store.list();
    const update = () => {
      picker.title = `Memory & snippets — ${currentOnly ? 'current project' : 'all projects'}`;
      picker.items = searchEntries(entries, picker.value, currentOnly ? currentProject : undefined).slice(0, 200).map(entry => ({ entry,
        label: `${entry.pinned ? '$(pinned)' : '$(history)'} ${entry.name}`,
        description: `${projectLabel(entry.project)} • ${path.basename(vscode.Uri.parse(entry.file).path)}`,
        detail: `${new Date(entry.capturedAt).toLocaleString()} • ${entry.tags.join(', ')}`
      }));
    };
    update();
    picker.onDidChangeValue(update);
    picker.onDidTriggerButton(() => { currentOnly = !currentOnly; update(); });
    picker.onDidAccept(() => {
      const entry = picker.selectedItems[0]?.entry;
      if (entry) { picker.hide(); void guard(() => manageEntry(entry))(); }
    });
    picker.onDidHide(() => picker.dispose());
    picker.show();
  });
  async function manageEntry(entry: MemoryEntry) {
    const choice = await vscode.window.showQuickPick([
      'Preview code', 'Copy code', 'Copy name', 'Insert code at cursor', 'Pin / edit snippet',
      ...(entry.pinned ? ['Unpin'] : []), 'Delete entry'
    ], { title: entry.name });
    if (choice === 'Preview code') {
      const uri = vscode.Uri.parse(`nihilanth-preview:/${entry.id}/${encodeURIComponent(entry.name)}.${entry.language.startsWith('typescript') ? 'ts' : 'js'}`);
      virtual.set(uri.toString(), entry.text);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    } else if (choice === 'Copy code' || choice === 'Copy name') await vscode.env.clipboard.writeText(choice === 'Copy name' ? entry.name : entry.text);
    else if (choice === 'Insert code at cursor') {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        if (entry.snippet) await editor.insertSnippet(new vscode.SnippetString(entry.text));
        else await editor.edit(edit => edit.replace(editor.selection, entry.text));
      }
    } else if (choice === 'Pin / edit snippet') await pin(entry.text, entry);
    else if (choice === 'Unpin') await store.update(entry.id, { name: entry.name, tags: entry.tags, pinned: false, snippet: entry.snippet });
    else if (choice === 'Delete entry') await store.remove(entry.id);
  }
  register('toggleCapture', async () => {
    const enabled = !config().get('captureEnabled', true);
    await config().update('captureEnabled', enabled, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(`Code capture ${enabled ? 'resumed' : 'paused'}`, 4000);
  });
  register('clearHistory', async () => {
    const choice = await vscode.window.showWarningMessage('Clear automatic code history across all projects? Pinned snippets will stay.', { modal: true }, 'Clear history');
    if (choice === 'Clear history') await store.clearHistory();
  });
  // Useful to integration tests and other local extensions; no external service is involved.
  return { store, capture, completionProvider };
}

export async function deactivate() { if (capture) await capture.flush(); }
