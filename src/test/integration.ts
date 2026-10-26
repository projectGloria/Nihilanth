import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { MemoryStore } from '../storage';
import { CaptureService } from '../capture';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function run() {
  const extension = vscode.extensions.getExtension('Nihilnia.nihilanth-toolbox');
  assert.ok(extension, 'Extension is installed in development host');
  const api = await extension.activate() as { store: MemoryStore; capture: CaptureService };
  assert.ok(api.store);
  const icon = extension.packageJSON.contributes.icons['nihilanth-dragon'].default;
  assert.equal(icon.fontCharacter, '\\e001');
  assert.ok((await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, icon.fontPath))).size > 0);
  assert.ok((await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, extension.packageJSON.icon))).size > 0);
  const workspace = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace, 'sample.ts'));
  const editor = await vscode.window.showTextDocument(doc);
  const replace = async (text: string) => {
    await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text));
    const end = doc.positionAt(doc.getText().length);
    editor.selection = new vscode.Selection(end, end);
  };
  const completions = async () => {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, editor.selection.active);
    return list?.items ?? [];
  };
  const label = (item: vscode.CompletionItem) => typeof item.label === 'string' ? item.label : item.label.label;

  await replace('const exampleArray = [1, 2, 3];\n');
  await api.capture.flush();
  await replace('/recall exa');
  await api.capture.flush();
  let items = await completions();
  assert.ok(items.some(i => label(i) === 'exampleArray — name'), 'Recall offers the saved name');
  const code = items.find(i => label(i) === 'exampleArray — code');
  assert.ok(code, 'Recall offers the full declaration');
  assert.equal(code.kind, vscode.CompletionItemKind.Event, 'Recall uses the kind mapped to the dragon theme');
  assert.equal(code.insertText, 'const exampleArray = [1, 2, 3];');
  console.log('PASS: deleted unsaved declaration can be recalled');

  await replace('const transientArray = [9, 8];');
  await replace('/recall transient');
  await api.capture.flush();
  assert.ok((await completions()).some(i => label(i) === 'transientArray — code'), 'Immediate deletion is captured before the idle timer');
  console.log('PASS: immediate unsaved deletion before idle capture');

  await replace('exa');
  assert.ok((await completions()).some(i => label(i) === 'exampleArray — code'), 'Ordinary typing recalls matching declarations');
  await vscode.commands.executeCommand('nihilanth.recall');
  assert.ok((await completions()).some(i => label(i) === 'exampleArray — name'), 'Shortcut command enables recall');
  await vscode.commands.executeCommand('nihilanth.finish');
  await vscode.commands.executeCommand('hideSuggestWidget');
  console.log('PASS: automatic recall and manual invocation');

  await replace('const nihil = { value: 42 };');
  await replace('');
  await vscode.commands.executeCommand('hideSuggestWidget');
  const editorConfig = vscode.workspace.getConfiguration('editor', doc.uri);
  const previousQuickSuggestions = editorConfig.inspect('quickSuggestions')?.workspaceValue;
  const previousWordSuggestions = editorConfig.inspect('wordBasedSuggestions')?.workspaceValue;
  try {
    await editorConfig.update('quickSuggestions', { other: 'on', comments: 'off', strings: 'off' }, vscode.ConfigurationTarget.Workspace);
    await editorConfig.update('wordBasedSuggestions', 'off', vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('type', { text: 'N' });
    await delay(1200);
    await vscode.commands.executeCommand('type', { text: 'i' });
    await delay(700);
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    await delay(150);
    assert.equal(doc.getText(), 'nihil', 'Recall joins an already open built-in suggestion list at Ni');
    await replace('');
    await vscode.commands.executeCommand('hideSuggestWidget');
    await editorConfig.update('quickSuggestions', false, vscode.ConfigurationTarget.Workspace);
    await editorConfig.update('wordBasedSuggestions', 'off', vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('type', { text: 'N' });
    await delay(400);
    await vscode.commands.executeCommand('type', { text: 'i' });
    await delay(700);
    // Do not call the completion API or triggerSuggest here: those mask a broken typing trigger.
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    await delay(150);
    assert.equal(doc.getText(), 'nihil', 'Typing N then i opens recall even with quick suggestions disabled');
  } finally {
    await editorConfig.update('quickSuggestions', previousQuickSuggestions, vscode.ConfigurationTarget.Workspace);
    await editorConfig.update('wordBasedSuggestions', previousWordSuggestions, vscode.ConfigurationTarget.Workspace);
  }
  await replace('Ni');
  items = await completions();
  const rememberedName = items.find(i => label(i) === 'nihil — name');
  const rememberedCode = items.find(i => label(i) === 'nihil — code');
  assert.equal(rememberedName?.insertText, 'nihil', 'Case-insensitive prefix offers the original name');
  assert.equal(rememberedCode?.insertText, 'const nihil = { value: 42 };', 'Full declaration includes its value before idle capture');
  console.log('PASS: deleted variable automatically offers name and value for Ni');

  await replace('Ni');
  await editor.edit(edit => edit.replace(rememberedCode!.range as vscode.Range, rememberedCode!.insertText as string));
  assert.equal(doc.getText(), 'const nihil = { value: 42 };');
  await vscode.commands.executeCommand('undo');
  assert.equal(doc.getText(), 'Ni', 'Full declaration insertion supports Undo');
  await replace('console.log(Ni);');
  const inline = doc.positionAt(doc.getText().indexOf('Ni') + 2);
  editor.selection = new vscode.Selection(inline, inline);
  const inlineName = (await completions()).find(i => label(i) === 'nihil — name');
  assert.ok(inlineName, 'Automatic recall works before trailing code');
  await editor.edit(edit => edit.replace(inlineName.range as vscode.Range, inlineName.insertText as string));
  assert.equal(doc.getText(), 'console.log(nihil);', 'Only the current identifier is replaced');
  console.log('PASS: automatic recall replaces the current word and supports Undo');

  for (const text of ['N', 'valueNi', '// Ni', 'const text = "Ni";', 'const text = `Ni`;', 'const pattern = /Ni/;']) {
    await replace(text);
    const offset = text.includes('Ni') ? text.indexOf('Ni') + 2 : text.length;
    const at = doc.positionAt(offset);
    editor.selection = new vscode.Selection(at, at);
    assert.ok(!(await completions()).some(i => label(i) === 'nihil — name'), `No automatic recall in ${text}`);
  }
  console.log('PASS: automatic recall requires a name prefix outside strings, comments and regexes');

  await api.store.capture(Array.from({ length: 60 }, (_, i) => ({
    name: 'nihil', text: `const nihil = ${'('.repeat(i + 1)}`, file: doc.uri.toString(), project: workspace.toString(), language: 'typescript'
  })));
  await api.store.capture([{ name: 'nihil', text: 'const nihil = 99;', file: 'file:///other/a.ts', project: 'file:///other', language: 'typescript' }]);
  for (const text of ['ni', '/recall nihil']) {
    await replace(text);
    const recalled = (await completions()).filter(i => label(i).startsWith('nihil —'));
    assert.deepEqual(recalled.map(label), ['nihil — name', 'nihil — code']);
    assert.equal(recalled[1].insertText, 'const nihil = { value: 42 };', 'The complete local declaration wins over partial and foreign versions');
  }
  assert.ok((await api.store.list()).filter(e => e.name === 'nihil').length >= 62, 'Completion grouping preserves stored history');
  console.log('PASS: many saved versions produce exactly one name and one complete-code suggestion');

  await replace('/data users 2 --format=json --seed=42');
  items = await completions();
  const data = items.find(i => label(i) === 'Generate 2 users');
  assert.ok(data && typeof data.insertText === 'string');
  assert.equal(JSON.parse(data.insertText).length, 2);
  assert.equal((data.range as vscode.Range).start.character, 0);
  await editor.edit(edit => edit.replace(data.range as vscode.Range, data.insertText as string));
  assert.equal(JSON.parse(doc.getText()).length, 2);
  await vscode.commands.executeCommand('undo');
  assert.equal(doc.getText(), '/data users 2 --format=json --seed=42');
  console.log('PASS: generation replaces only directive and supports undo');

  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await delay(300);
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await delay(150);
  assert.equal(JSON.parse(doc.getText()).length, 2, 'Native suggestion acceptance replaces slash command');
  console.log('PASS: native at-cursor suggestion acceptance');

  await replace('type User = { name: string; email: string; active?: boolean };\n/data from User 3 --format=json --seed=42');
  items = await completions();
  const typed = items.find(i => label(i) === 'Generate 3 User');
  assert.ok(typed && typeof typed.insertText === 'string', JSON.stringify(items.map(i => ({ label: label(i), detail: i.detail, insertionType: typeof i.insertText }))));
  assert.equal(JSON.parse(typed.insertText).length, 3);
  console.log('PASS: generation from local TypeScript type');

  for (const text of ['// /recall exa', '/*\n/recall exa\n*/', 'const text = `\n/recall exa\n`;', '/recall/']) {
    await replace(text);
    if (text.includes('\n')) editor.selection = new vscode.Selection(new vscode.Position(1, '/recall exa'.length), new vscode.Position(1, '/recall exa'.length));
    assert.ok(!(await completions()).some(i => label(i) === 'exampleArray — name'), `No recall in ${text}`);
  }
  console.log('PASS: comments, strings and regexes are not rewritten');

  await replace('{ a: 1, b: 2 }');
  editor.selection = new vscode.Selection(doc.positionAt(0), doc.positionAt(doc.getText().length));
  await vscode.commands.executeCommand('nihilanth.transform', 'keys');
  assert.deepEqual(JSON.parse(doc.getText()), ['a', 'b']);
  await vscode.commands.executeCommand('undo');
  assert.equal(doc.getText(), '{ a: 1, b: 2 }');
  console.log('PASS: selected code transforms and undoes');

  editor.selection = new vscode.Selection(doc.positionAt(0), doc.positionAt(doc.getText().length));
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, editor.selection, 'refactor.rewrite.nihilanth');
  assert.ok(actions.some(a => a.command?.command === 'nihilanth.transform'), 'Selection action menu contains toolbox transformations');
  console.log('PASS: native selection action menu');

  await api.store.pin({ name: 'fetch', text: 'fetch(${1:url})$0', file: doc.uri.toString(), project: workspace.toString(), language: 'typescript' }, 'fetch', ['network'], true);
  await replace('/snippet fetch');
  const pinned = (await completions()).find(i => label(i) === 'fetch — snippet');
  assert.ok(pinned?.insertText instanceof vscode.SnippetString);
  await api.store.clearHistory();
  assert.ok((await api.store.list()).some(e => e.pinned && e.name === 'fetch'));
  console.log('PASS: snippet placeholders and pin persistence');

  await api.store.pin({ name: 'foreignOnly', text: 'const foreignOnly = 123;', file: 'file:///elsewhere/other.ts', project: 'file:///elsewhere', language: 'typescript' }, 'foreignOnly');
  await replace('/recall foreignOnly');
  assert.ok((await completions()).some(i => label(i) === 'foreignOnly — code'));
  await replace('/recall foreignOnly --project=current');
  assert.ok(!(await completions()).some(i => label(i) === 'foreignOnly — code'));
  console.log('PASS: shared history with current-project filter');

  await api.capture.flush();
  console.log('All 15 extension-host integration scenarios passed.');
}
