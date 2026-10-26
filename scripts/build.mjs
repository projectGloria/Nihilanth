import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
await build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js', sourcemap: true, minify: true, legalComments: 'eof' });
const licenses = [
  ['typescript', 'LICENSE.txt'], ['proper-lockfile', 'LICENSE'], ['graceful-fs', 'LICENSE'],
  ['retry', 'License'], ['signal-exit', 'LICENSE.txt']
];
const notices = ['# Bundled third-party licenses\n\nThese dependencies are included in the extension bundle. Build-only dependencies are not shipped.\n'];
for (const [name, license] of licenses) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  notices.push(`## ${name} ${pkg.version}\n\n${await readFile(`node_modules/${name}/${license}`, 'utf8')}`);
}
notices.push(`## TypeScript third-party notices\n\n${await readFile('node_modules/typescript/ThirdPartyNoticeText.txt', 'utf8')}`);
await writeFile('THIRD_PARTY_NOTICES.md', notices.join('\n\n'));
