<div align="center">

<p align="center">
  <img src="media/hero-banner.png" alt="Nihilanth Toolbox Hero Banner" width="100%" />
</p>

# Nihilanth Toolbox

**The offline, editor-first developer suite crafted for VS Code**

*Recall removed code, pin cross-project snippets, generate type-driven mock data, and transform selections — directly at your cursor.*

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Nihilnia.nihilanth-toolbox"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-v0.1.5-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Marketplace Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2dd4bf?style=for-the-badge" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Offline-100%25%20Local-success?style=for-the-badge" alt="100% Local" />
  <img src="https://img.shields.io/badge/Telemetry-Zero-blueviolet?style=for-the-badge" alt="Zero Telemetry" />
  <img src="https://img.shields.io/badge/Cloud%20Dependencies-None-10b981?style=for-the-badge" alt="No Cloud Dependencies" />
</p>

---

<p align="center">
  <a href="#-quick-start-in-30-seconds">Quick Start</a> •
  <a href="#-visual-feature-tour">Visual Tour</a> •
  <a href="#-key-capabilities">Capabilities</a> •
  <a href="#-slash-commands-reference">Slash Commands</a> •
  <a href="#-dummy-data--type-mocking">Data Generation</a> •
  <a href="#-selection-transformations">Transformations</a> •
  <a href="#-privacy--offline-architecture">Architecture</a> •
  <a href="#-settings--configuration">Settings</a> •
  <a href="#-license">License</a>
</p>

</div>

---

## ⚡ Quick Start in 30 Seconds

```shell
code --install-extension Nihilnia.nihilanth-toolbox
```

1. **Summon Slash Commands**: On a dedicated line in any `.ts`, `.js`, or `.json` file, type `/` or press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> on macOS).
2. **Instant Dummy Data**: Type `/data users 3 --format=json` and hit <kbd>Tab</kbd> or <kbd>Enter</kbd>.
3. **Type-Driven Mocking**: Highlight or define any TypeScript `type` or `interface` and run `/data from UserProfile 5`.
4. **Recall Lost Code**: Accidentally delete a function or type declaration? Just type the first two letters of its name in any JS/TS file to restore it, even after editing it through a broken state first.

---

## 📸 Visual Feature Tour

### 1. Type-Driven Mock Data &amp; Slash Commands
Parse local TypeScript interfaces, types, unions, and tuples directly at your cursor to generate deterministic, structurally matched mock datasets in milliseconds.

<p align="center">
  <img src="media/feature-data-generation.png" alt="Type-driven mock generation and slash commands" width="880" />
</p>

---

### 2. Automatic Workspace Code Memory
Passively observes declarations and deleted code fragments (&gt;24 characters) across JS/TS/JSX/TSX files. As soon as you type two letters of any past identifier, Nihilanth offers both the standalone identifier name and the complete implementation body. Recall joins the suggestion list VS Code opens while you type and follows `editor.quickSuggestions` (with quick suggestions off, press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd>). Declarations that exist in the current file are left to the language server, and its suggestions win ties.

<p align="center">
  <img src="media/feature-code-memory.png" alt="Automatic code memory and instant recall" width="880" />
</p>

---

### 3. Selection Transformations
Select any snippet or JSON payload and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> (or right-click) to trigger instant transformations: convert JSON to TypeScript types, switch JSON to JS object literals, deduplicate arrays, extract keys, or convert naming conventions.

<p align="center">
  <img src="media/feature-transformations.png" alt="Selection transformations and type generation" width="880" />
</p>

---

### 4. 100% Offline &amp; Private Architecture
Your code never leaves your workstation. No background telemetry pings, no cloud models, no API quotas, and no subscription paywalls.

<p align="center">
  <img src="media/feature-architecture.png" alt="100% Offline local architecture and privacy guarantees" width="880" />
</p>

---

## 🌟 Key Capabilities

<table>
  <tr>
    <td width="50%">
      <h3>🕒 Automatic Workspace Code Memory</h3>
      <p>Passively captures function, class, type, and interface declarations as well as deleted blocks across your files. Restores deleted implementations right from your cursor suggestions.</p>
    </td>
    <td width="50%">
      <h3>📌 Cross-Project Snippet Pins</h3>
      <p>Save reusable code blocks with custom aliases, tags, and dynamic VS Code placeholder syntax (<code>${1:param}</code>). Pinned snippets are available across all workspaces and never expire.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🎲 Deterministic Dummy Data</h3>
      <p>Generate arrays or single instances of common schemas (users, products, emails, IDs, timestamps) with reproducible seed control (<code>--seed=42</code>) and edge-case boundary testing.</p>
    </td>
    <td width="50%">
      <h3>🧬 TypeScript Type Mocking</h3>
      <p>Understands your active file's TypeScript AST. Run <code>/data from &lt;Type&gt; [count]</code> to produce conforming mock data with zero manual configuration.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🔄 Selection Transformations</h3>
      <p>Instantly convert between strict JSON and JavaScript object literals, infer TypeScript types from JSON payloads, deduplicate arrays, and switch casing (camel, Pascal, snake, kebab).</p>
    </td>
    <td width="50%">
      <h3>🐉 Nihilanth Dragon Theme &amp; Status Launcher</h3>
      <p>Features an embedded vector dragon status bar launcher and an optional bespoke product icon theme for sleek, high-contrast suggestion badges.</p>
    </td>
  </tr>
</table>

---

## ⌨️ Keyboard Shortcuts &amp; Context Actions

| Shortcut (Win / Linux) | Shortcut (macOS) | Context | Action |
| :--- | :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Space</kbd> | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | Editor (no selection) | Open toolbox completion suggestions at cursor |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Space</kbd> | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | Editor (text selected) | Open Selection Transformation quick-pick menu |
| `/` | `/` | Start of dedicated line | Trigger slash command completions |
| <kbd>Esc</kbd> | <kbd>Esc</kbd> | Completion widget | Dismiss suggestions (also ends a <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> session) |

*macOS reserves <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> for Finder search, so the macOS default is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>. Rebind `nihilanth.open` in Keyboard Shortcuts if it collides with your input-source switcher.*

You can also right-click anywhere in the editor to access:
- **Nihilanth Toolbox: Open at Cursor**
- **Nihilanth Toolbox: Pin Selection as Snippet**
- **Nihilanth Toolbox: Transform Selection**
- **Nihilanth Toolbox: Generate Data from Selection**

---

## ⚡ Slash Commands Reference

Type `/` at the beginning of a dedicated line (leading indentation is preserved). Suggestions filter dynamically as you type arguments.

### Supported Commands

| Command | Arguments | Description | Example |
| :--- | :--- | :--- | :--- |
| `/recall` | `<query> [--project=current]` | Search stored identifiers, declarations, and deleted code fragments. | `/recall authService` |
| `/snippet` | `<alias \| tag> [--project=current]` | Insert a pinned snippet across workspaces. Expands TabStops. | `/snippet fetchUsers` |
| `/data` | `<preset> [count] [flags]` | Generate synthetic test data from built-in schemas. | `/data users 5 --format=json` |
| `/data from` | `<Type> [count] [flags]` | Parse a local TypeScript type or interface and output conforming mock data. | `/data from Order 3 --seed=101` |

### Built-in Presets

| Plural (Generates Array) | Singular (Generates Single Value / Object) |
| :--- | :--- |
| `users`, `products` | `user`, `product` |
| `names`, `emails`, `ids` | `name`, `email`, `id` |
| `numbers`, `dates`, `booleans`, `strings` | `number`, `date`, `boolean`, `string` |

### CLI Flags &amp; Edge Cases

- `--format=json`: Emits strict JSON with quoted keys.
- `--format=js`: Emits native JavaScript / TypeScript object literals.
- `--seed=<0–4294967295>`: Creates deterministic, reproducible pseudo-random output. Seeds outside that range are rejected instead of silently colliding.
- `--edge=empty`: Generates an empty array (tests zero-state UI).
- `--edge=long`: Stretches string fields to extreme lengths (tests UI overflow & wrapping).
- `--edge=boundary`: Uses extreme numeric limits (`0`, `-1`, `Number.MIN_SAFE_INTEGER`, `Number.MAX_SAFE_INTEGER`).

---

## 🔄 Selection Transformations Reference

Highlight any text and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> or choose **Transform Selection**:

| Transformation | Description |
| :--- | :--- |
| **JSON ↔ JS Object** | Seamlessly toggle between strict JSON format and clean JS object literals. |
| **JSON → TypeScript Type** | Infers and generates a clean `type GeneratedType = { ... }` from a JSON sample. |
| **Extract Keys / Values / Entries** | Pulls out object keys, values, or `[key, value]` tuple pairs from selected objects. |
| **Deduplicate Array** | Removes duplicates from selected primitive lists or JSON arrays. |
| **Case Conversions** | Switch text between `camelCase`, `PascalCase`, `snake_case`, and `kebab-case`. |

*All transformations operate purely in memory on the selected text and are fully reversible with native **Undo** (<kbd>Ctrl</kbd>+<kbd>Z</kbd>).*

**Data fidelity:** key order is preserved (including numeric-looking keys). Integers beyond `Number.MAX_SAFE_INTEGER` (such as 64-bit IDs) and duplicate keys are rejected with an error instead of being silently rounded or dropped; quote big IDs as strings first. Comments inside a converted object are not carried over. Case conversions keep leading `_`/`$` and trailing `_`.

### Field-Aware Mock Values
Generated fields are chosen by whole words in the property name: numeric `id`/`userId`/`user_id` fields are sequential (unique per record), `uuid`/`guid` are RFC 4122 v4-shaped, `email` matches the record's `name`, `createdAt`/`birthDate`/`timestamp` are ISO dates, and `username`, `fileName`, `hostName`, `lastName`, `fullName`, `url`, and `phone` get matching shapes. A substring such as the "date" in `candidate` no longer counts.

---

## 🐉 Dragon Product Icon Theme (Optional)

<p align="center">
  <img src="media/dragon-preview.png" alt="Nihilanth dragon badge and status bar launcher" width="360" />
</p>

To display the custom teal dragon glyph beside Nihilanth completion items:
1. Open the Command Palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> / <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).
2. Run **Preferences: Product Icon Theme**.
3. Select **Nihilanth Dragon**.

*(Standard VS Code icons gracefully fall back to defaults; switching themes retains the dragon launcher in your status bar).*

---

## ⚙️ Settings &amp; Configuration

Configure Nihilanth in your VS Code settings (`settings.json`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `nihilanth.prefix` | `"/"` | The character sequence used to trigger slash commands on dedicated lines. |
| `nihilanth.captureEnabled` | `true` | Automatically record observed declarations and deleted fragments. |
| `nihilanth.historyLimitMB` | `100` | Storage cap in MB for automatic memory, shared by all projects. Least recently seen or used items are evicted first; pins never expire. User setting only: a repository's workspace settings cannot shrink it. |
| `nihilanth.defaultCount` | `5` | Default number of items generated for array presets. |
| `nihilanth.maxDocumentKB` | `512` | Upper file size limit (in KB) for automatic capture and automatic recall; larger files are never re-parsed per keystroke. |
| `nihilanth.excludedFolders` | `["node_modules", ".git", "dist", "out", "build", "coverage"]` | Folders excluded from capture. |
| `nihilanth.excludedFiles` | `[".env", ".env.local"]` | Specific files ignored to safeguard secrets. |

---

## 🛡️ Privacy &amp; Storage Architecture

- **Local Storage Only**: Memory entries are stored unencrypted in VS Code's local extension `globalStorage` as a versioned, append-only JSON Lines log (`memory-v2.jsonl`). Older `memory-v1.json` databases are migrated automatically and kept as `memory-v1.json.migrated`.
- **Isolated from Source Control**: History is never committed to Git, workspace files, or Settings Sync.
- **Concurrency Safe**: Every write takes a cross-window lock and re-reads the log before appending, and atomic compaction rewrites it in place. A damaged database is never overwritten; Nihilanth offers to move it aside and start fresh. Removed code whose write fails (for example, a lock held by another window) is kept and retried instead of dropped.
- **Edit History**: Each declaration keeps one live copy while you edit. A version that stood for more than 10 minutes, or the last version that parsed before you broke it mid-edit, is kept as history when replaced.
- **Secret Safeguards (best effort)**: Only JS/TS/JSX/TSX documents are observed, and excluded folders and files are skipped. Declarations and fragments that look like credentials (private keys, well-known token formats such as `sk-…`, `ghp_…`, `AKIA…`, a string literal of 4+ characters assigned to names like `apiKey`, `password`, `token`, URLs with embedded passwords such as `postgres://user:pass@host`, and `Bearer …` tokens) are not captured. This is a heuristic — remembered code can be offered in other projects, so pause capture (or add exclusions) for sensitive codebases.
- **Untrusted Workspaces**: Automatic capture is paused until you trust the workspace; everything else keeps working.
- **Remote Windows (WSL, SSH, Dev Containers, Codespaces)**: The extension runs next to your files, so it works in remote windows; memory is kept per machine (the remote host has its own).
- **Management Controls**:
  - `Nihilanth Toolbox: Manage Memory and Snippets` — Browse, filter, pin, or delete stored entries.
  - `Nihilanth Toolbox: Pause / Resume Code Capture` — Temporarily suspend code observation.
  - `Nihilanth Toolbox: Clear Automatic History` — Purge unpinned history, unwritten removals, and the `memory-v1.json.migrated` backup while preserving saved snippets. If damaged-database backups exist, it offers to delete them too. Declarations in files you edit afterwards are remembered again.

---

## 📦 Distribution &amp; Installation

### Via Marketplace
Install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Nihilnia.nihilanth-toolbox) or search `Nihilanth Toolbox` in the Extensions view (`Ctrl+Shift+X`).

### Via VSIX File
Download `nihilanth-toolbox-0.1.5.vsix` and install via command line:
```shell
code --install-extension nihilanth-toolbox-0.1.5.vsix
```
Or via the Extensions view: **…** menu → **Install from VSIX…**.

---

## 📜 License

Distributed under the **[MIT License](LICENSE)**.

Copyright &copy; 2026 Nihil.
