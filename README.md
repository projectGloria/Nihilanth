# Nihilanth Toolbox

An offline VS Code toolbox that works where you write code. Recall removed code, reuse snippets, generate dummy data, and transform selections. No AI account, network service, or subscription is required.

## Install

1. In VS Code, open **Extensions** (`Ctrl+Shift+X`).
2. Open the **…** menu and choose **Install from VSIX…**.
3. Select `nihilanth-toolbox-0.1.5.vsix` from this folder.

Alternatively, run:

```powershell
code --install-extension .\nihilanth-toolbox-0.1.5.vsix
```

The extension page and the bottom-right status bar use the same dragon head. Click the status-bar dragon to open toolbox suggestions at the cursor.

For the same dragon beside suggestions, run **Preferences: Product Icon Theme** and select **Nihilanth Dragon**. VS Code assigns suggestion icons by completion kind, so this theme replaces the Event icon used by Nihilanth; other Event-type suggestions also receive the dragon. Other product icons fall back to VS Code's defaults. Choosing a different product icon theme restores its suggestion icons; the status-bar dragon remains available.

## Start at your cursor

In a JavaScript, TypeScript, JSX, TSX, JSON, or JSONC editor, type `/` at the start of a dedicated line (indentation is fine). Choose a command, keep typing its arguments, then accept the desired suggestion. The suggestion's details show a code preview; VS Code's **Toggle Suggest Details** command shows or hides that preview.

```text
/recall exa
/snippet fetch
/data users 5
/data number
/data user --format=json
/data from User 5 --format=json --seed=42
```

**Ctrl+Alt+Space** (macOS: **Cmd+Alt+Space**) opens toolbox suggestions at the current word without requiring a slash command. With an active selection, the same shortcut opens selection actions instead. You can remap it in Keyboard Shortcuts. Normal language completions may appear alongside toolbox suggestions.

Remembered declarations appear automatically while typing a name in JS/TS editors, starting at two characters. Matching ignores case: after creating and deleting `const nihil = 42;`, typing `Ni` offers **nihil — name** (inserts `nihil`) and **nihil — code** (inserts `const nihil = 42;`). Accepting a suggestion replaces the current word and supports Undo. Automatic recall skips strings, comments, and regex literals. Matching memory opens suggestions even when normal quick suggestions are disabled.

Typing `/` on a dedicated line opens explicit toolbox commands. The extension does not modify text until you accept a result. Completed regex literals, comments, strings, paths, and division expressions are not commands. A partially typed regex that starts with a command name can briefly resemble a command; closing its slash dismisses toolbox results, and Escape dismisses suggestions at any point.

## Code memory

Opened JS/TS files are observed automatically, including unsaved documents. The extension stores declaration versions after a short idle period and captures meaningful deletions before their text disappears. It remembers named variables, functions, classes, interfaces, enums, and type aliases, plus removed fragments of at least 24 characters.

Use `/recall exa` to search identifier names, code, tags, project names, and source paths. Results distinguish **name** from **code**, and show the project, file, and capture time. Accepting a **name** inserts only the identifier. Accepting **code** inserts the saved text at the cursor; it does not restore dependencies, import statements, or the original project context automatically.

Completion lists show one name and one code suggestion per identifier, selecting the latest complete declaration and preferring the current file, then the current project. Older versions remain available in the memory manager. History is shared across your local projects and persists across VS Code restarts. Add `--project=current` to a recall or snippet query to filter it to the current project, for example `/recall exa --project=current`. The memory manager also has a folder button to toggle all projects / current project. There is no time expiry. The default **100 MB** cap evicts the oldest automatic entries; pins are exempt. Capture begins when this extension is active and a document is observed—it cannot recover previously deleted code it never saw.

For preview, copy, insertion, pinning, editing metadata, unpinning, or deletion, run **Nihilanth Toolbox: Manage Memory and Snippets** from the Command Palette. Administrative actions use small built-in pickers and inputs; everyday recall stays at your cursor. Use **Pause / Resume Code Capture** or **Clear Automatic History** for history controls. Clearing history preserves pins; subsequently observed code can be captured again.

## Pinned snippets

Select code, right-click, and choose **Pin Selection as Snippet**. Give it an alias and optional comma-separated tags. Choose literal insertion or VS Code snippet placeholders, such as:

```text
fetch(${1:url}).then(response => response.json())$0
```

Find pinned code using `/snippet fetch`. Pins are available across projects and remain until explicitly deleted or unpinned.

## Dummy data

Plural presets generate arrays; singular presets generate one value or object by default:

| Arrays | Single values / objects |
| --- | --- |
| `users`, `products` | `user`, `product` |
| `names`, `emails`, `ids` | `name`, `email`, `id` |
| `numbers`, `dates`, `booleans`, `strings` | `number`, `date`, `boolean`, `string` |

```text
/data emails 10
/data products 4 --format=json
/data dates 3 --seed=42
/data strings 2 --edge=long
/data numbers 10 --edge=boundary
/data users --edge=empty
```

Counts range from 1 to 1000; the default for arrays is five. `--format=json` preserves quoted JSON keys; `--format=js` emits JS/TS literals. A seed reproduces generated values, including dates, within this extension version. Without a seed, generation varies. `--edge=empty` produces an empty result collection, `--edge=long` uses long generated string fields, and `--edge=boundary` chooses numeric endpoints. These are explicit test-data modes, not inferred business constraints.

To generate from a local type, keep the declaration in the same file:

```ts
type User = {
  name: string;
  email: string;
  age?: number;
  role: 'admin' | 'guest';
  tags: string[];
};
```

Then type `/data from User 5 --format=json --seed=42` on a new line. Supported types include primitives, literals, unions, arrays, tuples, nested objects, optional properties (included in output), local aliases, and local interfaces. Field-name rules provide emails, names, IDs, URLs, phones, and ISO date strings; other values use generic samples. Types do not encode every business rule.

Imported types, generic declarations (except `Array<T>`), recursive types, interface inheritance, methods, index signatures, and runtime classes such as `Date` are not supported. Unsupported types show an explanation instead of fabricated data.

You can also select a local type name/declaration or a literal example object, then invoke **Generate Data from Selection**. Choose a count, then copy the result, insert it below the selection, or replace the selection. Example-based generation retains the literal's structure and generates values of matching primitive types.

## Selection transformations

Select text and press the toolbox shortcut, right-click **Transform Selection**, or invoke the command directly:

- JSON ↔ supported JS object literals
- Object keys, values, or entries
- JSON → `type GeneratedType = …`
- Deduplicate primitive arrays
- camelCase, PascalCase, snake_case, and kebab-case

Transformations operate only on the selection and support Undo. Literal transformations parse data without executing code. Calls, arbitrary computed expressions, object methods, spreads, and variable references are rejected. No references are renamed when changing selected text's case. The generated type name is `GeneratedType`; rename it if that name already exists.

## Settings and storage

Search Settings for **Nihilanth** to configure the prefix, default count, capture switch, storage cap, document size limit, and excluded folders/files. Capture skips `node_modules`, `.git`, `dist`, `out`, `build`, and `coverage` by default. The default maximum captured document size is 512 KB. Exclusions apply to future capture; existing history can be deleted using the memory manager.

Memory is stored as a versioned JSON database in VS Code's local extension global-storage directory. It is separate from your source files, does not enter Git or Settings Sync, and is shared between local windows through locked, atomic writes. Pinned records do not count against the automatic-history cap. The extension makes no network requests. Diagnostic failures appear in the **Nihilanth Toolbox** Output channel.

Version 0.1 targets desktop VS Code with local files and untitled editors. Remote and virtual workspaces are deferred.

## Develop and verify

Use Node.js 22 or later:

```powershell
npm ci
npm test
npm run test:integration
npm run package
```

Press **F5** in this workspace to build and launch an Extension Development Host. Integration tests launch an isolated VS Code profile, leaving your regular profile and extension memory untouched. On Windows they use the installed VS Code executable when available; set `VSCODE_EXECUTABLE_PATH` to override it. On other platforms the test runner downloads an isolated stable VS Code unless an executable is supplied.

The core modules cover parsing, generation, transformations, ranking, and persistent storage. Integration tests exercise the actual VS Code completion API, native suggestion acceptance, deletions, selected edits, Undo, and pinned snippets.

Future tools: scratchpads, debug bookmarks, resume notes, project recipes, and repeat-with-variation editing.
