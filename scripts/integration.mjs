import { runTests } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const session = path.join(root, '.vscode-test', `session-${Date.now()}`);
const workspace = path.join(session, 'workspace');
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, 'sample.ts'), '');
const installed = process.env.VSCODE_EXECUTABLE_PATH ?? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe');
await runTests({
  ...(existsSync(installed) ? { vscodeExecutablePath: installed } : {}),
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'out', 'test', 'integration.js'),
  launchArgs: [workspace, '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', path.join(session, 'user-data'), '--extensions-dir', path.join(session, 'extensions')]
});
