import * as vscode from 'vscode';
import * as path from 'node:path';
import { CaptureService } from './capture';
import { parseDataRequest, parseDirective, commandNames } from './directives';
import { formatLiteral, generate, Generator, presets } from './generator';
import { MemoryEntry, searchEntries } from './model';
import { uniqueRecallEntries } from './recall';
import { DamagedMemoryError, MemoryStore } from './storage';
import { insideStringOrComment, parseLiteral, scriptName } from './syntax';
import { transform, Transform, transforms } from './transforms';

const languages = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'jsonc'];
const scripts = languages.slice(0, 4);
const selector: vscode.DocumentSelector = languages.flatMap(language => ['file', 'untitled'].map(scheme => ({ language, scheme })));
const identifier = /^[A-Za-z_$][\w$]*$/;
const actionKind = vscode.CodeActionKind.RefactorRewrite.append('nihilanth');
interface ManualSession { uri: string; line: number; until: number; onlyRecall: boolean }
let store: MemoryStore;
let capture: CaptureService;

// Whether VS Code itself opens suggestions while typing code. Automatic recall only refreshes a list the user would
// see anyway; it never opens one against `editor.quickSuggestions: false` or `"inline"`.
function quickSuggestions(doc: vscode.TextDocument): boolean {
  const value = vscode.workspace.getConfiguration('editor', doc).get<unknown>('quickSuggestions');
  const other = value && typeof value === 'object' ? (value as { other?: unknown }).other : value;
  return other === true || other === 'on';
}

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
  store = new MemoryStore(context.globalStorageUri.fsPath, () => vscode.workspace.getConfiguration('nihilanth').get('historyLimitMB', 100) * 1024 * 1024, { report });
  capture = new CaptureService(store, report);
  let manual: ManualSession | undefined;
  // The context key lets Escape end a manual session; otherwise its unfiltered list stayed on that line for 2 minutes.
  const setManual = (session?: ManualSession) => { manual = session; void vscode.commands.executeCommand('setContext', 'nihilanth.manualSession', !!session); };
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  const config = () => vscode.workspace.getConfiguration('nihilanth');
  const register = (name: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`nihilanth.${name}`, guard(fn)));
  // A damaged database used to make every completion request throw, silently disabling recall.
  // Degrade to "no memory" and offer, once per session, to move the file aside.
  let damagedNotified = false;
  async function memory(): Promise<MemoryEntry[]> {
    let stored: MemoryEntry[] = [];
    try { stored = await store.list(); } catch (error) {
      if (!(error instanceof DamagedMemoryError)) throw error;
      report(error);
      if (!damagedNotified) {
        damagedNotified = true;
        void vscode.window.showErrorMessage(`Nihilanth: ${error.message}`, 'Move aside and start fresh').then(async choice => {
          if (choice) vscode.window.showInformationMessage(`Nihilanth: damaged memory saved as ${await store.quarantine(error.file)}`);
        }).then(undefined, report);
      }
    }
    // Unwritten removals are merged in memory instead of forcing a disk write on every keystroke.
    return [...stored, ...capture.pendingEntries()];
  }

  const preview = (code: string, language: string, detail: string) => new vscode.MarkdownString().appendText(detail).appendCodeblock(code, language);
  // Documentation is built in resolveCompletionItem for the focused item only: the list is re-queried on every
  // keystroke, and each item embedding its full code made that payload as large as the code itself.
  const previews = new WeakMap<vscode.CompletionItem, { code: string; language: string; detail: string }>();
  function item(label: string, insertion: string | vscode.SnippetString, range: vscode.Range, filter: string, detail: string, code: string, language: string, order: number, entryId?: string) {
    const result = new vscode.CompletionItem({ label, detail: '  Nihilanth' }, vscode.CompletionItemKind.Event);
    result.insertText = insertion;
    result.range = range;
    result.filterText = filter;
    result.sortText = String(order).padStart(6, '0');
    result.detail = detail;
    previews.set(result, { code, language, detail });
    // Accepting a memory item passes its id so the store can refresh its LRU age.
    result.command = { command: 'nihilanth.finish', title: 'Finish toolbox insertion', arguments: entryId ? [entryId] : [] };
    return result;
  }
  // Unseeded data is random; generating it once per request keeps the preview stable while the list is re-queried,
  // and avoids regenerating every preset (up to 1000 records each) on each keystroke. Cleared after an insertion.
  const generated = new Map<string, string>();
  const cached = (key: string, make: () => string) => {
    let code = generated.get(key);
    if (code === undefined) { code = make(); if (generated.size >= 64) generated.clear(); generated.set(key, code); }
    return code;
  };
  const fileLabel = (file: string) => vscode.workspace.asRelativePath(vscode.Uri.parse(file));

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
      if (automatic && (!scripts.includes(doc.languageId) || typed.length < 2 || capture.oversized(doc))) return;
      const here = capture.metadata(doc);
      const recall = !directive || directive.command === 'recall' || directive.command === 'snippet';
      const stored = recall ? await memory() : [];
      // Declarations that exist in this file right now are the language server's job: offering them again inserted
      // duplicate declarations. Automatic recall offers other files, other projects, and removed code.
      const liveHere = new Set(stored.filter(e => e.live && e.file === here.file).map(e => e.name));
      let candidates = stored;
      if (automatic) {
        const lower = typed.toLowerCase();
        candidates = stored.filter(e => !(e.live && e.file === here.file) && identifier.test(e.name) && e.name.toLowerCase().startsWith(lower));
        // Most keystrokes match no stored name; return before parsing the document.
        if (!candidates.length) return;
      }
      const contextOffset = directive ? doc.offsetAt(new vscode.Position(position.line, directive.start)) : Math.max(0, doc.offsetAt(position) - 1);
      if (insideStringOrComment(doc.getText(), contextOffset, scriptName(doc.fileName, doc.languageId))) return;
      const range = directive ? new vscode.Range(position.line, directive.start, position.line, line.text.length) :
        word ?? new vscode.Range(position, position);
      const filter = directive?.text ?? typed;
      const results: vscode.CompletionItem[] = [];
      const defaultFormat = doc.languageId.startsWith('json') ? 'json' : 'js';
      const count = config().get('defaultCount', 5);
      if (directive && !directive.command) {
        for (const command of commandNames.filter(c => c.startsWith(directive.partial))) {
          const commandText = `${prefix}${command} `;
          const entry = item(`${prefix}${command}`, commandText, range, `${directive.text}${command.slice(directive.partial.length)}`, `Nihilanth • ${command}`, command === 'data' ? `${prefix}data users 5\n${prefix}data from User 5 --format=json --seed=42` : `${prefix}${command} ${command === 'recall' ? 'exampleArray' : 'fetch'}`, 'text', results.length);
          entry.command = { command: 'nihilanth.trigger', title: 'Show command results' };
          results.push(entry);
        }
        return new vscode.CompletionList(results, true);
      }
      if (recall) {
        const snippetOnly = directive?.command === 'snippet';
        const rawQuery = directive?.argument ?? filter;
        const currentOnly = /(?:^|\s)--project=current(?:\s|$)/.test(rawQuery);
        const query = rawQuery.replace(/(?:^|\s)--project=(?:current|all)(?=\s|$)/g, '').trim();
        const project = currentOnly ? here.project : undefined;
        const matches = searchEntries(candidates.filter(e => !snippetOnly || e.pinned), query, project);
        const entries = uniqueRecallEntries(matches, here.file, here.project).slice(0, 40);
        if (token.isCancellationRequested) return;
        const named = new Set<string>();
        for (const e of entries) {
          const origin = `${e.pinned ? 'Pinned' : 'Memory'} • ${projectLabel(e.project)} • ${fileLabel(e.file)} • ${new Date(e.capturedAt).toLocaleString()}`;
          // One name item per name (a pinned and a captured version may both be listed), and none for a name the
          // language server already offers from this file.
          if (!snippetOnly && identifier.test(e.name) && !named.has(e.name) && !(automatic && liveHere.has(e.name))) {
            named.add(e.name);
            results.push(item(`${e.name} — name`, e.name, range, directive ? filter : e.name, origin, e.text, e.language, results.length, e.id));
          }
          results.push(item(`${e.name} — ${e.snippet ? 'snippet' : 'code'}`, e.snippet ? new vscode.SnippetString(e.text) : e.text, range, directive ? filter : `${e.name} ${query}`, origin, e.text, e.language, results.length, e.id));
        }
      }
      if ((directive?.command === 'data' && !directive.argument.trim()) || (!directive && !manual?.onlyRecall && !filter)) {
        for (const preset of presets) {
          const request = parseDataRequest(preset, count);
          const code = cached(`${preset}|${count}|${defaultFormat}`, () => generate(request, '', defaultFormat));
          results.push(item(`Generate ${request.count} ${preset}`, code, range, directive ? filter : '', `Nihilanth • ${preset}`, code, defaultFormat === 'json' ? 'json' : 'javascript', results.length));
        }
      } else if (directive?.command === 'data') {
        const argument = directive.argument.trim();
        const candidates = presets.filter(p => p.startsWith(argument));
        if (candidates.length && !presets.includes(argument)) {
          for (const preset of candidates) {
            const request = parseDataRequest(preset, count);
            const code = cached(`${preset}|${count}|${defaultFormat}`, () => generate(request, '', defaultFormat));
            results.push(item(`Generate ${request.count} ${preset}`, code, range, filter, `Nihilanth • ${preset}`, code, doc.languageId, results.length));
          }
        } else {
          try {
            const request = parseDataRequest(argument, count);
            const text = doc.getText();
            const safeSource = text.slice(0, doc.offsetAt(new vscode.Position(position.line, directive.start))) + text.slice(doc.offsetAt(new vscode.Position(position.line, line.text.length)));
            const code = cached(`${argument}|${count}|${defaultFormat}|${request.fromType ? `${doc.uri}@${doc.version}` : ''}`, () => generate(request, safeSource, defaultFormat, scriptName(doc.fileName, doc.languageId)));
            results.push(item(`Generate ${request.count} ${request.source}`, code, range, filter, `Nihilanth • ${request.seed === undefined ? 'random' : `seed ${request.seed}`} • ${request.format ?? defaultFormat}`, code, doc.languageId, 0));
          } catch (error) {
            const hint = item('Nihilanth — check command', directive.text, range, filter, error instanceof Error ? error.message : String(error), `${prefix}data users 5\n${prefix}data from User 5 --format=json --seed=42`, 'text', 0);
            // The hint is the only item, so it is preselected and Enter accepts it: make that still start a new line.
            hint.command = { command: 'editor.action.insertLineAfter', title: 'New line' };
            results.push(hint);
          }
        }
      }
      // Ties with the language server's items go to the language server: with `editor.suggestSelection: "first"`,
      // Enter used to accept a remembered name, possibly from another project, over the symbol in scope.
      if (automatic) for (const result of results) result.sortText = `~${result.sortText}`;
      return new vscode.CompletionList(results, true);
    },
    resolveCompletionItem(completion) {
      const data = previews.get(completion);
      if (data) completion.documentation = preview(data.code, data.language, data.detail);
      return completion;
    }
  };
  context.subscriptions.push(output, capture, vscode.languages.registerCompletionItemProvider(selector, completionProvider, '/', ' ', '=', '-'));

  const suggest = () => { if (suggestTimer) clearTimeout(suggestTimer); suggestTimer = setTimeout(() => { void vscode.commands.executeCommand('editor.action.triggerSuggest'); }, 75); };
  register('finish', (id?: string) => {
    setManual(undefined);
    generated.clear();
    if (typeof id === 'string' && !id.startsWith('pending:')) void store.touch(id).catch(report);
  });
  register('trigger', suggest);
  register('endSession', async () => { setManual(undefined); await vscode.commands.executeCommand('hideSuggestWidget'); });
  const open = async (onlyRecall = false) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!editor.selection.isEmpty && !onlyRecall) {
      await vscode.commands.executeCommand('editor.action.codeAction', { kind: actionKind.value, apply: 'never' });
      return;
    }
    setManual({ uri: editor.document.uri.toString(), line: editor.selection.active.line, until: Date.now() + 120_000, onlyRecall });
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
  };
  register('open', () => open());
  register('recall', () => open(true));
  const updateStatus = (editor = vscode.window.activeTextEditor) => { if (editor && languages.includes(editor.document.languageId)) status.show(); else status.hide(); };
  updateStatus();
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus), vscode.workspace.onDidOpenTextDocument(() => updateStatus()));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== e.document || e.contentChanges.length !== 1) return;
    const doc = e.document;
    const change = e.contentChanges[0];
    // editor.selection is not updated yet when this event fires (deleting the last lines left it past the end, and
    // lineAt threw). The caret is where the change ended.
    const at = doc.positionAt(change.rangeOffset + change.text.length);
    // The dedicated slash line is an explicit request; re-open suggestions after spaces/options too.
    const directive = parseDirective(doc.lineAt(at.line).text, config().get('prefix', '/'));
    if (directive) {
      if (!insideStringOrComment(doc.getText(), doc.offsetAt(new vscode.Position(at.line, directive.start)), scriptName(doc.fileName, doc.languageId))) suggest();
      return;
    }
    if (e.reason || change.rangeLength || !identifier.test(change.text) || !scripts.includes(doc.languageId) || !quickSuggestions(doc) || capture.oversized(doc)) return;
    const version = doc.version;
    if (suggestTimer) clearTimeout(suggestTimer);
    // Read the caret after VS Code finishes applying the typing event.
    suggestTimer = setTimeout(() => {
      void (async () => {
        const current = () => vscode.window.activeTextEditor === editor && doc.version === version &&
          editor.selection.isEmpty && editor.selection.active.isEqual(at);
        if (!current()) return;
        const word = doc.getWordRangeAtPosition(at, /[A-Za-z_$][\w$]*/);
        const typed = word ? doc.getText(new vscode.Range(word.start, at)) : '';
        // Only at the second character: the list VS Code opened at the first one was queried while recall still had
        // nothing to say (it needs two characters), and VS Code only re-queries providers that returned items.
        // From then on recall's own incomplete list is re-queried, so reopening on every keystroke only flickered.
        if (typed.length !== 2) return;
        const here = capture.metadata(doc).file;
        const matches = (await memory()).some(entry => !(entry.live && entry.file === here) && identifier.test(entry.name) && entry.name.toLowerCase().startsWith(typed.toLowerCase()));
        if (!matches || !current() || insideStringOrComment(doc.getText(), doc.offsetAt(at) - 1, scriptName(doc.fileName, doc.languageId))) return;
        await vscode.commands.executeCommand('hideSuggestWidget');
        if (current()) await vscode.commands.executeCommand('editor.action.triggerSuggest');
      })().catch(report);
    }, 75);
  }), vscode.window.onDidChangeTextEditorSelection(e => {
    if (manual && (manual.uri !== e.textEditor.document.uri.toString() || e.selections[0].active.line !== manual.line)) setManual(undefined);
  }), new vscode.Disposable(() => { if (suggestTimer) clearTimeout(suggestTimer); }));

  function projectLabel(project: string) { return project === 'Loose files' ? project : path.basename(vscode.Uri.parse(project).path) || project; }
  const sourceCapture = (editor: vscode.TextEditor, text: string) => ({ ...capture.metadata(editor.document), name: 'Snippet', text });
  async function pin(text?: string, entry?: MemoryEntry) {
    const editor = vscode.window.activeTextEditor;
    const selected = text ?? (editor && editor.document.getText(editor.selection));
    if (!selected?.trim() || (!entry && !editor)) throw new Error('Select some code first.');
    const name = await vscode.window.showInputBox({ title: 'Pin snippet', prompt: 'Name / search alias', value: entry?.name ?? selected.match(/(?:const|let|var|function|class|type|interface)\s+([\w$]+)/)?.[1] ?? 'My snippet', validateInput: value => value.trim() ? undefined : 'Enter a name.' });
    if (name === undefined) return;
    const tags = await vscode.window.showInputBox({ title: 'Snippet tags', prompt: 'Optional comma-separated tags', value: entry?.tags.join(', ') ?? '' });
    if (tags === undefined) return;
    const mode = await vscode.window.showQuickPick([
      { label: 'Literal code', snippet: false, description: 'Insert exactly as saved' },
      { label: 'Snippet placeholders', snippet: true, description: 'Interpret ${1:name} and $0 as editable placeholders' }
    ], { title: 'Snippet insertion mode' });
    if (!mode) return;
    // An entry from Manage is pinned by its id; several entries can share the same text.
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
    const typeName = selected.match(/^(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([\w$]+)/)?.[1] ?? (identifier.test(selected) ? selected : undefined);
    const generator = new Generator();
    const count = Number(input);
    const example = typeName ? undefined : parseLiteral(selected);
    const value = typeName ? generator.fromType(editor.document.getText(), typeName, count, scriptName(editor.document.fileName, editor.document.languageId)) : Array.from({ length: count }, (_, i) => generator.example(example!, i));
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
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('nihilanth-preview', { provideTextDocumentContent: uri => virtual.get(uri.toString()) ?? '' }),
    // Previews hold full entry text; release it once the preview document is closed.
    vscode.workspace.onDidCloseTextDocument(d => { if (d.uri.scheme === 'nihilanth-preview') virtual.delete(d.uri.toString()); }));
  register('manage', async () => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { entry: MemoryEntry }>();
    picker.title = 'Memory & snippets — all projects';
    picker.placeholder = 'Search names, code, tags, or projects';
    const editor = vscode.window.activeTextEditor;
    const currentProject = editor ? capture.metadata(editor.document).project : undefined;
    let currentOnly = false;
    if (currentProject) picker.buttons = [{ iconPath: new vscode.ThemeIcon('folder'), tooltip: 'Toggle all projects / current project' }];
    // Unwritten removals cannot be deleted or unpinned yet; they appear here once the idle write lands.
    const entries = (await memory()).filter(e => !e.id.startsWith('pending:'));
    const update = () => {
      picker.title = `Memory & snippets — ${currentOnly ? 'current project' : 'all projects'}`;
      // alwaysShow: searchEntries already filtered by code, tags and projects. Without it the quick pick filtered
      // again by label alone and hid every match that was not in the name.
      picker.items = searchEntries(entries, picker.value, currentOnly ? currentProject : undefined).slice(0, 200).map(entry => ({ entry, alwaysShow: true,
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
      if (entry) { picker.hide(); void guard(() => manageEntry(entry, editor))(); }
    });
    picker.onDidHide(() => picker.dispose());
    picker.show();
  });
  async function manageEntry(entry: MemoryEntry, target?: vscode.TextEditor) {
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
      // The editor that was active when Manage opened; a read-only preview may be active by now.
      const editor = target && !target.document.isClosed ? target : vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme === 'nihilanth-preview') throw new Error('Open an editor to insert into.');
      if (entry.snippet) await editor.insertSnippet(new vscode.SnippetString(entry.text), editor.selection);
      else await editor.edit(edit => edit.replace(editor.selection, entry.text));
    } else if (choice === 'Pin / edit snippet') await pin(entry.text, entry);
    else if (choice === 'Unpin') await store.update(entry.id, { name: entry.name, tags: entry.tags, pinned: false, snippet: entry.snippet });
    else if (choice === 'Delete entry') {
      const confirm = await vscode.window.showWarningMessage(`Delete “${entry.name}” from memory? This cannot be undone.`, { modal: true }, 'Delete');
      if (confirm === 'Delete') await store.remove(entry.id);
    }
  }
  register('toggleCapture', async () => {
    const inspected = config().inspect<boolean>('captureEnabled');
    const enabled = !config().get<boolean>('captureEnabled', true);
    // Write where the effective value comes from: a workspace value overrides a global one, so toggling only the
    // global setting used to report "resumed" while capture stayed paused.
    await config().update('captureEnabled', enabled, inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    const now = config().get<boolean>('captureEnabled', true);
    if (now !== enabled) throw new Error(`Code capture is still ${now ? 'on' : 'paused'}: a more specific setting overrides it.`);
    vscode.window.setStatusBarMessage(`Code capture ${enabled ? 'resumed' : 'paused'}`, 4000);
  });
  register('clearHistory', async () => {
    const choice = await vscode.window.showWarningMessage('Clear automatic code history across all projects? Pinned snippets will stay.', { modal: true }, 'Clear history');
    if (choice !== 'Clear history') return;
    capture.discardPending();
    await store.clearHistory();
    const backups = await store.backups();
    if (backups.length) {
      const remove = await vscode.window.showWarningMessage(`${backups.length} damaged-database backup(s) in ${store.directory} still contain old history in plain text.`, { modal: true }, 'Delete backups');
      if (remove === 'Delete backups') await store.deleteBackups();
    }
  });
  // Useful to integration tests and other local extensions; no external service is involved.
  return { store, capture, completionProvider };
}

export async function deactivate() { if (capture) await capture.flush(); }
