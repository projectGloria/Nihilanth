import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { declarations, insideStringOrComment, parseLiteral } from '../syntax';
import { parseDataRequest, parseDirective } from '../directives';
import { generate, Generator } from '../generator';
import { transform } from '../transforms';
import { MemoryStore } from '../storage';
import { Capture, searchEntries } from '../model';
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
