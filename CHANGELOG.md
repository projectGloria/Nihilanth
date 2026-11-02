# Changelog

## Unreleased

- Store memory as an append-only log (`memory-v2.jsonl`) instead of rewriting the whole database on every capture, which stalled the extension host as history grew. Existing `memory-v1.json` data migrates automatically.
- Keep one live version per declaration while you edit instead of a new history entry per typing pause; removed code still goes to history. Eviction is now truly least-recently-used: seeing or accepting an entry refreshes it.
- Fix slash commands and recall silently turning off for the rest of a file after a regex such as `/\/*$/` or a template literal containing `/*`.
- Stop writing to disk and re-parsing the document on every keystroke in completion paths.
- Skip whole-document replacements and removals over 16 KB as "Removed" fragments.
- Skip capture of code that looks like credentials, and pause capture in untrusted workspaces.
- Offer to move a damaged memory database aside instead of disabling recall silently.
- `--edge=boundary` now emits `0`, `-1`, and the safe-integer limits; generated users get matching names and emails.
- Keep pending removals when settings change, parse `/data from` types with the document's real file kind, and release closed previews.

### Memory integrity
- Fix losing the last good version of a declaration edited through a broken state (`const nihil = ;` paused mid-edit): broken versions never replace the live copy, and versions that stood for 10+ minutes are kept as history when replaced.
- Fix a race where one window could truncate another window's freshly appended entries: writes now re-read the log under the lock and reads wait for writes.
- `historyLimitMB` is a user-only setting: a repository's workspace settings could shrink the shared history of every project.
- Removed code whose write fails (lock timeout, Windows EPERM, damaged database) is kept and retried instead of dropped; removals seen before a document outgrew `maxDocumentKB` are written too.
- Untitled buffers in different windows no longer replace each other's entries; closing one turns its declarations into history.
- "Pin / edit snippet" in Manage pins the chosen entry, not another entry with the same text. Deleting a whole declaration line no longer stores a duplicate `Removed: …` copy.
- Typing a name with pauses (`getU`, `getUse`, …) no longer leaves junk history; loop variables and `catch` bindings are not captured as code.
- Unchanged live declarations refresh their eviction age, so the most stable code is no longer evicted first.
- Logs are read and compacted in chunks (no V8 string-length crash at large `historyLimitMB`); compaction retries a rename blocked by antivirus; a compromised lock is reported instead of throwing an uncaught exception.
- Clear History also discards unwritten removals and the `memory-v1.json.migrated` backup, and offers to delete damaged-database backups.

### Suggestions
- Automatic recall follows `editor.quickSuggestions` and only reopens the list at the second typed character, instead of hiding and reopening it on every keystroke.
- Language-server items win ties with recall items; recall skips declarations that exist in the current file.
- Fix an exception from reading a stale selection after deleting lines, and suggestions reopening on the new line after Enter on a slash command.
- `/recall` and Manage no longer match every entry through the home-folder path; Manage search by code, tags, and project works.
- Recall no longer pops up inside JSDoc comments; a pinned snippet is listed even when history has the same name.
- `/recall src/api` accepts slashes in the query; a custom prefix such as `#` no longer turns `#data = 1;` into a command.
- Esc ends a Ctrl+Alt+Space session; Enter on a `/data` error hint starts a new line; deleting an entry asks for confirmation; Pause/Resume Capture reports the real state.
- Automatic recall skips documents over `maxDocumentKB` and parses only when a stored name matches; previews load when an item is focused; generated data is reused while the list is open.

### Data and transforms
- Numeric `id` fields generated from types are sequential; `uuid`/`guid` are UUIDs; name heuristics match whole words (`candidate` is not a date, `fileName` is not a person); email and name agree in any field order and per nested object.
- Seeds must be within 0–4294967295 (larger seeds silently collided).
- Transforms keep key order, reject integers beyond `MAX_SAFE_INTEGER` and duplicate keys instead of corrupting them, accept trailing comments, reject `1), b = (2`, keep `_`/`$` prefixes in case conversions, and lowercase `İ` correctly. "JSON → TypeScript type" merges object shapes in arrays with optional keys.

### Platform
- Runs in remote windows (WSL, SSH, Dev Containers, Codespaces); memory is per machine there.
- Activates on JS/TS/JSON instead of at every startup; the status bar item shows only for those files.
- macOS shortcut is Ctrl+Shift+Space (Cmd+Alt+Space is Finder search).
- Untitled and `.mjs`/`.cjs` documents are parsed with their real language.
- Note: seeded `/data` output changed for types with numeric ids, UUIDs, and name-like fields.

## 0.1.5

- Add a matching dragon-head extension icon and clickable bottom-right status-bar icon.
- Include the optional Nihilanth Dragon product icon theme for dragon-head Event suggestions.

## 0.1.4

- Collapse saved versions into one name suggestion and one code suggestion per identifier.
- Prefer the latest complete declaration from the current file, then the current project. Skip incomplete automatic captures in completion lists and preserve all stored history.

## 0.1.3

- Use VS Code's lightning Event icon for all Nihilanth suggestions, replacing the rabbit badge.

## 0.1.2

- Mark every toolbox completion with a rabbit icon and Nihilanth label beside the suggestion name.

## 0.1.1

- Refresh an already open VS Code suggestion list when a remembered name matches two typed characters. Recall now joins built-in suggestions at `Ni` instead of waiting for the full name.
- Add an integration regression test with normal quick suggestions enabled and separate `N` / `i` typing.

## 0.1.0

- Automatic, case-insensitive declaration recall from two typed characters, offering both the name and complete saved code.
- Editor slash commands and a configurable keyboard shortcut.
- Local code memory with shared project history and persistent pins.
- Dummy data from presets, local types, and literal examples.
- Selection transformations for JSON, objects, arrays, names, and TypeScript types.
- Configurable capture exclusions, automatic-history cap, and management commands.
