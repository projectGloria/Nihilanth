import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { declarations, insideStringOrComment, parseLiteral, removesWholeIdentifier } from '../syntax';
import { parseDataRequest, parseDirective } from '../directives';
import { generate, Generator } from '../generator';
import { transform } from '../transforms';
import { DamagedMemoryError, MemoryStore } from '../storage';
import { Capture, looksSecret, searchEntries } from '../model';
import { uniqueRecallEntries } from '../recall';

test('slash commands require a dedicated line and distinguish ordinary slash syntax', () => {
  assert.equal(parseDirective('  /recall exa')?.argument, 'exa');
  assert.equal(parseDirective('/data from User 5 --format=json --seed=42')?.command, 'data');
  assert.equal(parseDirective('/')?.partial, '');
  assert.equal(parseDirective('/sn')?.partial, 'sn');
  for (const line of ['const x = a / b', '// recall', '/* recall */', '/recall/g', '/usr/bin/node', '/foo/', '</div>', '/nonsense', 'const str = "/recall x"']) assert.equal(parseDirective(line), undefined, line);
  assert.equal(parseDirective(';;recall exa', ';;')?.command, 'recall');
});

test('commands inside multiline strings and comments are excluded', () => {
  for (const text of ['const x = `\n/recall exa\n`;', '/*\n/recall exa\n*/', '// /recall exa']) {
    const at = text.indexOf('/recall');
    assert.equal(insideStringOrComment(text, at), true, text);
  }
  const ordinary = 'const a = 1;\n/recall exa';
  assert.equal(insideStringOrComment(ordinary, ordinary.indexOf('/recall')), false);
});

test('data options validate counts, flags, and safe seeds', () => {
  assert.deepEqual(parseDataRequest('from User 5 --format=json --seed=42'), { source: 'User', fromType: true, count: 5, format: 'json', seed: 42 });
  for (const bad of ['users 0', 'users 1001', 'users -1', 'users --bogus', 'users --seed=9007199254740993']) assert.throws(() => parseDataRequest(bad), Error, bad);
  assert.equal(parseDataRequest('numbers --edge=boundary').edge, 'boundary');
});

test('declarations retain correct names and self-contained multivariable declarations', () => {
  const entries = declarations('const exampleArray = [1, 2];\nlet a = 1, b = 2;\nfunction hello() { return 3; }\ntype User = { name: string };');
  assert.deepEqual(entries.map(e => e.name), ['exampleArray', 'a', 'b', 'hello', 'User']);
  assert.equal(entries[1].text, 'let a = 1;');
  assert.equal(entries[2].text, 'let b = 2;');
});

test('literal parsing does not evaluate expressions or permit statement injection', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseLiteral('{ name: "Ada", age: -2, tags: [true, null], }'))), { name: 'Ada', age: -2, tags: [true, null] });
  for (const unsafe of ['{ value: process.exit() }', '{ ...secret }', '{ get name() { return 1; } }', '(() => 1)()', '1); globalThis.injected = true; (2', '{ value: reference }', '{ [reference]: 1 }', '1e999']) assert.throws(() => parseLiteral(unsafe), Error, unsafe);
  assert.equal(Object.prototype.hasOwnProperty.call(parseLiteral('{ "__proto__": 5 }'), '__proto__'), true);
});

test('singular presets produce single values and objects, plural presets produce arrays', () => {
  assert.equal(typeof JSON.parse(generate(parseDataRequest('number --seed=42 --format=json'))), 'number');
  const user = JSON.parse(generate(parseDataRequest('user --seed=42 --format=json')));
  assert.ok(!Array.isArray(user)); assert.equal(typeof user.email, 'string');
  assert.equal(JSON.parse(generate(parseDataRequest('user 3 --seed=42 --format=json'))).length, 3);
  const js = transform('{"__proto__": {"x": 1}}', 'object');
  assert.match(js, /\["__proto__"\]/);
  assert.equal(Object.prototype.hasOwnProperty.call(parseLiteral(js), '__proto__'), true);
});

test('seeded data is repeatable including dates and generates valid JSON', () => {
  for (const source of ['users', 'products', 'names', 'emails', 'ids', 'numbers', 'dates', 'booleans', 'strings']) {
    const request = parseDataRequest(`${source} 5 --format=json --seed=42`);
    const a = generate(request);
    assert.equal(a, generate(request));
    assert.equal(JSON.parse(a).length, 5);
  }
  assert.deepEqual(JSON.parse(generate(parseDataRequest('users 5 --format=json --edge=empty'))), []);
});

test('type generator handles local references, literals, arrays, tuples, optional fields, and unions', () => {
  const text = 'type Role = "admin" | "guest"; interface User { name: string; email: string; age?: number; active: boolean; role: Role; tags: string[]; nested: { ok: true }; tuple: [string, number] }';
  const output = JSON.parse(generate(parseDataRequest('from User 5 --format=json --seed=3'), text));
  assert.equal(output.length, 5);
  for (const u of output) {
    assert.equal(typeof u.name, 'string'); assert.match(u.email, /@example\.com$/); assert.equal(typeof u.age, 'number');
    assert.ok(['admin', 'guest'].includes(u.role)); assert.equal(u.nested.ok, true); assert.equal(u.tuple.length, 2);
  }
});

test('unsupported types fail explicitly, including recursive arrays and generic declarations', () => {
  for (const text of ['type User = { next: User }', 'type User = { children: User[] }', 'type User = { fn: () => void }', 'type User<T> = { name: string }', 'interface User extends Other { name: string }', 'type User = Date', 'type User = { [key: string]: string }']) {
    assert.throws(() => generate(parseDataRequest('from User 2'), text), Error, text);
  }
  assert.throws(() => generate(parseDataRequest('from Missing 2'), 'type Other = string'), /current file/);
});

test('example generator preserves structure and transformation output is safe', () => {
  const value = new Generator(42).example(parseLiteral('{ name: "", age: 1, tags: ["x"], nullable: null }')) as any;
  assert.equal(typeof value.name, 'string'); assert.equal(typeof value.age, 'number'); assert.equal(value.tags.length, 1); assert.equal(value.nullable, null);
  assert.deepEqual(JSON.parse(transform('{ a: 1, b: 2 }', 'keys')), ['a', 'b']);
  assert.deepEqual(JSON.parse(transform('[1, 1, "1", null, null, true, false]', 'dedupe')), [1, '1', null, true, false]);
  assert.equal(transform('HTTPResponseStatus', 'snake'), 'http_response_status');
  assert.equal(transform('hello_world', 'camel'), 'helloWorld');
  assert.match(transform('{ "user": { "name": "Ada" }, "tags": [1, "a"] }', 'type'), /Array<number \| string>/);
  assert.throws(() => transform('[{}]', 'dedupe'), /primitive/);
  assert.throws(() => transform('{ a: getValue() }', 'json'), /never executed/);
});

test('memory persists across projects, deduplicates captures, and ranks exact names first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nihilanth-memory-'));
  try {
    const store = new MemoryStore(dir, () => 100_000);
    const capture: Capture = { name: 'exampleArray', text: 'const exampleArray = [1, 2];', project: 'file:///project-a', file: 'file:///project-a/a.ts', language: 'typescript' };
    await store.capture([capture, capture]);
    await store.capture([{ ...capture, name: 'exampleArrayExtended', project: 'file:///project-b' }]);
    const reopened = new MemoryStore(dir, () => 100_000);
    const entries = await reopened.list();
    assert.equal(entries.length, 2);
    assert.equal(searchEntries(entries, 'exampleArray')[0].name, 'exampleArray');
    assert.equal(searchEntries(entries, 'example', 'file:///project-a').length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('recall groups history by name and chooses the latest complete declaration from the current file', () => {
  const base = { name: 'nihil', language: 'typescript', project: 'local', file: 'file:///a.ts', pinned: false, tags: [], snippet: false };
  const versions = [
    { ...base, id: 'partial', text: 'const nihil =', capturedAt: 9 },
    { ...base, id: 'missing-value', text: 'const nihil', capturedAt: 8 },
    { ...base, id: 'foreign', file: 'file:///b.ts', text: 'const nihil = 99;', capturedAt: 7 },
    { ...base, id: 'latest', text: 'const nihil = 42;', capturedAt: 6 },
    { ...base, id: 'older', text: 'const nihil = 1;', capturedAt: 5 },
    { ...base, id: 'other', name: 'nihilOther', text: 'let nihilOther = true;', capturedAt: 4 }
  ];
  assert.deepEqual(uniqueRecallEntries(versions, base.file, base.project).map(e => e.id), ['latest', 'other']);
  assert.equal(versions.length, 6, 'History is preserved');
  assert.deepEqual(uniqueRecallEntries(versions.slice(0, 2), base.file, base.project), []);
  assert.equal(uniqueRecallEntries([{ ...versions[0], pinned: true, snippet: true, text: 'fetch(${1:url})$0' }], base.file, base.project).length, 1);
  assert.equal(uniqueRecallEntries([{ ...versions[0], name: 'loop', text: 'function loop() { for (const value of [1]) console.log(value); }' }], base.file, base.project).length, 1);
});

test('history eviction preserves pins and clearing history does not remove snippets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nihilanth-evict-'));
  try {
    const store = new MemoryStore(dir, () => 500);
    const capture: Capture = { name: 'first', text: 'const first = 1;', project: 'a', file: 'file:///a.ts', language: 'typescript' };
    await store.pin(capture, 'pinned', ['reusable'], true);
    for (let i = 0; i < 5; i++) await store.capture([{ ...capture, name: `item${i}`, text: `const item${i} = ${i};` }]);
    const entries = await store.list();
    assert.ok(entries.some(e => e.pinned && e.name === 'pinned'));
    assert.ok(entries.filter(e => !e.pinned).length < 5);
    assert.ok(entries.some(e => e.name === 'item4'));
    await store.clearHistory();
    assert.deepEqual((await store.list()).map(e => e.name), ['pinned']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('two window stores serialize writes and corruption is never overwritten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nihilanth-concurrent-'));
  try {
    const a = new MemoryStore(dir, () => 100_000);
    const b = new MemoryStore(dir, () => 100_000);
    const capture: Capture = { name: 'a', text: 'const a = 1;', project: 'p', file: 'file:///a.ts', language: 'typescript' };
    await Promise.all([a.capture([capture]), b.capture([{ ...capture, name: 'b', text: 'const b = 2;' }])]);
    assert.equal((await a.list()).length, 2);
    await fs.writeFile(a.filename, 'broken-json');
    await assert.rejects(a.capture([capture]));
    assert.equal(await fs.readFile(a.filename, 'utf8'), 'broken-json');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('regexes and template parts that look like comment openers do not hide the rest of the file', () => {
  const tail = '\nconst value = 1;\nfoo';
  for (const head of [String.raw`const trim = (s: string) => s.replace(/\/*$/, '');`, String.raw`const glob = /src\/*.ts/;`, 'const s = `${a} /* x`;', 'const s = `${a} // x`;']) {
    const text = head + tail;
    assert.equal(insideStringOrComment(text, text.length - 1), false, head);
  }
  const trailing = 'const a = 1; // tail';
  assert.equal(insideStringOrComment(trailing, trailing.length - 1), true, 'Same-line trailing comment');
  const jsx = 'const el = <div>hello there</div>;';
  assert.equal(insideStringOrComment(jsx, jsx.indexOf('there'), 'a.tsx'), true, 'JSX text');
});

test('only removals of a whole identifier require re-parsing the previous buffer', () => {
  const text = 'const exampleArray = [1];';
  assert.equal(removesWholeIdentifier(text, 8, 9), false, 'One character inside a name');
  assert.equal(removesWholeIdentifier(text, 20, 21), false, 'Whitespace only');
  assert.equal(removesWholeIdentifier(text, 6, 18), true, 'The whole name');
  assert.equal(removesWholeIdentifier(text, 0, text.length), true, 'The whole declaration');
});

test('credential-looking code is recognized and ordinary code is not', () => {
  for (const secret of ['const API_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456";', "const dbPassword = 'hunter2hunter2';", 'const config = { apiKey: "AIzaSyA-1234567890abcdefghijklmnopqrstu" };',
    'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";', 'const k = `-----BEGIN RSA PRIVATE KEY-----`;', 'const aws = "AKIAABCDEFGHIJKLMNOP";']) assert.equal(looksSecret(secret), true, secret);
  for (const ordinary of ['function getToken(id: string) { return store.get(id); }', 'const tokenCount = 42;', 'type Credentials = { password: string };', "const label = 'Password';", 'const exampleArray = [1, 2, 3];']) assert.equal(looksSecret(ordinary), false, ordinary);
});

test('boundary edge emits the documented numeric extremes and users have matching emails', () => {
  const numbers = JSON.parse(generate(parseDataRequest('numbers 200 --edge=boundary --seed=7 --format=json'))) as number[];
  for (const extreme of [0, -1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) assert.ok(numbers.includes(extreme), String(extreme));
  for (const user of JSON.parse(generate(parseDataRequest('users 20 --seed=3 --format=json')))) assert.ok(user.email.startsWith(`${user.name.toLowerCase()}.`), JSON.stringify(user));
});

const capture = (name: string, text: string, file = 'file:///p/a.ts'): Capture => ({ name, text, project: 'file:///p', file, language: 'typescript' });
async function withStore(fn: (dir: string, store: MemoryStore) => Promise<void>, limit = 100_000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nihilanth-v2-'));
  try { await fn(dir, new MemoryStore(dir, () => limit)); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('snapshots keep one live version per declaration and turn vanished names into history', () => withStore(async (_, store) => {
  const scope = { project: 'file:///p', file: 'file:///p/a.ts' };
  for (let i = 0; i < 30; i++) await store.snapshot(scope, [capture('grow', `const grow = ${'1+'.repeat(i)}1;`), capture('stable', 'const stable = true;')]);
  let entries = await store.list();
  assert.equal(entries.filter(e => e.name === 'grow').length, 1, 'Edits replace the live version instead of piling up');
  assert.equal(entries.length, 2);
  await store.snapshot(scope, [capture('stable', 'const stable = true;')]);
  entries = await store.list();
  const grow = entries.find(e => e.name === 'grow');
  assert.ok(grow && !grow.live, 'A name that disappeared from the file is kept as history');
  await store.snapshot(scope, [capture('grow', 'const grow = 2;'), capture('stable', 'const stable = true;')]);
  await store.snapshot(scope, [capture('grow', 'const grow = 3;'), capture('stable', 'const stable = true;')]);
  entries = (await store.list()).filter(e => e.name === 'grow');
  assert.equal(entries.filter(e => !e.live).length, 1, 'History survives later edits of a re-declared name');
  assert.equal(entries.filter(e => e.live).length, 1);
}));

test('removing a live declaration demotes it to history, and pins are never replaced by edits', () => withStore(async (_, store) => {
  const scope = { project: 'file:///p', file: 'file:///p/a.ts' };
  const fn = capture('greet', 'function greet() { return 1; }');
  await store.snapshot(scope, [fn]);
  await store.capture([fn]);
  assert.equal((await store.list()).find(e => e.name === 'greet')?.live, undefined);
  await store.snapshot(scope, [capture('kept', 'const kept = 1;')]);
  await store.pin(capture('kept', 'const kept = 1;'), 'kept');
  await store.snapshot(scope, [capture('kept', 'const kept = 2;')]);
  const kept = (await store.list()).filter(e => e.name === 'kept');
  assert.ok(kept.some(e => e.pinned && e.text === 'const kept = 1;'));
}));

test('eviction is least recently used: touching an old entry protects it', () => withStore(async (_, store) => {
  const tick = () => new Promise(r => setTimeout(r, 5));
  await store.capture([capture('oldest', 'const oldest = 1;')]);
  await tick();
  for (let i = 0; i < 3; i++) { await store.capture([capture(`mid${i}`, `const mid${i} = ${i};`)]); await tick(); }
  const oldest = (await store.list()).find(e => e.name === 'oldest')!;
  await store.touch(oldest.id);
  const bytes = (await store.list()).reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);
  const tight = new MemoryStore(store.directory, () => bytes - 1);
  await tight.capture([capture('newest', 'const newest = 9;')]);
  const names = (await tight.list()).map(e => e.name);
  assert.ok(names.includes('oldest'), 'Recently used entry survives');
  assert.ok(!names.includes('mid0'), 'Least recently used entry is evicted first');
}));

test('writes append instead of rewriting, and other windows see appends and compactions', () => withStore(async (dir, a) => {
  const b = new MemoryStore(dir, () => 100_000);
  await a.capture([capture('one', 'const one = 1;')]);
  const before = await fs.readFile(a.filename, 'utf8');
  await a.capture([capture('two', 'const two = 2;')]);
  const after = await fs.readFile(a.filename, 'utf8');
  assert.ok(after.startsWith(before), 'Existing lines are left untouched');
  assert.deepEqual((await b.list()).map(e => e.name).sort(), ['one', 'two']);
  for (let i = 0; i < 400; i++) await a.capture([capture('churn', `const churn = ${i};`)]);
  await a.clearHistory();
  assert.ok((await fs.stat(a.filename)).size < 1024, 'Dead lines are compacted away');
  assert.deepEqual(await b.list(), [], 'A compaction by another window is picked up');
  await b.capture([capture('three', 'const three = 3;')]);
  assert.deepEqual((await a.list()).map(e => e.name), ['three']);
}));

test('a crash-truncated final line is ignored and repaired on the next write', () => withStore(async (dir, store) => {
  await store.capture([capture('one', 'const one = 1;')]);
  await fs.appendFile(store.filename, '{"put":{"id":"half');
  const reader = new MemoryStore(dir, () => 100_000);
  assert.deepEqual((await reader.list()).map(e => e.name), ['one']);
  await reader.capture([capture('two', 'const two = 2;')]);
  assert.deepEqual((await new MemoryStore(dir, () => 100_000).list()).map(e => e.name).sort(), ['one', 'two']);
}));

test('v1 databases migrate on first write and are kept as a backup', () => withStore(async (dir, store) => {
  const legacy = { version: 1, entries: [{ id: 'x', name: 'legacy', text: 'const legacy = 1;', language: 'typescript', project: 'p', file: 'f', capturedAt: 1, pinned: true, tags: [], snippet: false }] };
  await fs.writeFile(path.join(dir, 'memory-v1.json'), JSON.stringify(legacy));
  assert.deepEqual((await store.list()).map(e => e.name), ['legacy'], 'Readable before migration');
  await store.capture([capture('fresh', 'const fresh = 1;')]);
  assert.deepEqual((await new MemoryStore(dir, () => 100_000).list()).map(e => e.name).sort(), ['fresh', 'legacy']);
  await fs.access(path.join(dir, 'memory-v1.json.migrated'));
  await assert.rejects(fs.access(path.join(dir, 'memory-v1.json')));
}));

test('a damaged database can be moved aside without being deleted', () => withStore(async (_, store) => {
  await store.capture([capture('one', 'const one = 1;')]);
  await fs.appendFile(store.filename, 'not json\n');
  const error = await store.list().then(() => undefined, e => e);
  assert.ok(error instanceof DamagedMemoryError);
  const backup = await store.quarantine(error.file);
  assert.match(await fs.readFile(backup, 'utf8'), /not json/);
  assert.deepEqual(await store.list(), []);
  await store.capture([capture('two', 'const two = 2;')]);
  assert.deepEqual((await store.list()).map(e => e.name), ['two']);
}));
