import ts from 'typescript';
import { DataRequest } from './directives';
import { entriesOf, Literal, parseLiteral, record, sourceFile } from './syntax';

const names = ['Ada', 'Deniz', 'Maya', 'Emre', 'Noah', 'Lina', 'Ece', 'Omar', 'Sofia', 'Alex'];
const surnames = ['Lovelace', 'Yılmaz', 'Chen', 'Okafor', 'Silva', 'Kaya', 'Novak', 'Haddad', 'Rossi', 'Tanaka'];
const words = ['cedar', 'ocean', 'amber', 'river', 'meadow', 'silver', 'violet', 'maple'];
const singlePresets: Record<string, string> = { user: 'users', product: 'products', name: 'names', email: 'emails', id: 'ids', number: 'numbers', date: 'dates', boolean: 'booleans', string: 'strings' };
export const presets = ['users', 'products', 'names', 'emails', 'ids', 'numbers', 'dates', 'booleans', 'strings', ...Object.keys(singlePresets)];

// The extremes `--edge=boundary` promises: zero, negatives, and the safe-integer limits.
const boundaryNumbers = [0, -1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];

// Field names are matched by whole words, not substrings: `candidate` contains "date" and `filename` contains "name".
const keyWords = (key: string) => key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z\d]+/).filter(Boolean);
const isId = (w: string[]) => w.at(-1) === 'id';
const isUuid = (w: string[]) => ['uuid', 'guid'].includes(w.at(-1) ?? '');
const isDate = (w: string[]) => w.some(x => ['date', 'time', 'timestamp', 'datetime', 'dob', 'birthday'].includes(x)) || (w.length > 1 && w.at(-1) === 'at');
const personNames = new Set(['first', 'last', 'full', 'display', 'given', 'family', 'middle', 'person', 'customer', 'author', 'owner', 'contact', 'user', 'sur', 'nick']);

export class Generator {
  private state: number;
  // One person per record and nesting path, so a record's email matches its name in either field order, and a nested
  // `manager: { name, email }` gets its own person instead of the parent's.
  private people = new Map<string, string>();
  private readonly reference: number;
  constructor(seed?: number, private edge?: string) {
    this.state = (seed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
    this.reference = seed === undefined ? Date.now() : Date.UTC(2025, 0, 1);
  }
  random(): number { this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0; return this.state / 0x100000000; }
  int(min = 0, max = 100): number { return this.edge === 'boundary' ? (this.random() < .5 ? min : max) : Math.floor(this.random() * (max - min + 1)) + min; }
  pick<T>(values: readonly T[]): T { return values[this.int(0, values.length - 1)]; }
  number(min = 0, max = 100): number {
    // Not pick(): under the boundary edge pick() itself only reaches the first and last element.
    return this.edge === 'boundary' ? boundaryNumbers[Math.floor(this.random() * boundaryNumbers.length)] : this.int(min, max);
  }
  private person(index: number, scope: string): string {
    const key = `${index}\0${scope}`;
    let name = this.people.get(key);
    if (name === undefined) this.people.set(key, name = this.pick(names));
    return name;
  }
  private uuid(): string {
    const hex = (length: number) => Array.from({ length }, () => this.int(0, 15).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[this.int(0, 3)]}${hex(3)}-${hex(12)}`;
  }
  field(key: string, index: number, kind: 'string' | 'number' | 'boolean' = 'string', scope = ''): Literal {
    const w = keyWords(key);
    // Numeric ids are sequential: random ones collide, and colliding ids break keyed lists (React keys, Maps).
    if (kind === 'number') return isId(w) ? index + 1 : this.number();
    if (kind === 'boolean') return this.random() >= .5;
    if (this.edge === 'empty') return '';
    if (this.edge === 'long') return 'x'.repeat(1024);
    const single = w.length === 1 ? w[0] : '';
    if (w.includes('email')) return `${this.person(index, scope).toLowerCase()}.${index + 1}@example.com`;
    if (isUuid(w)) return this.uuid();
    if (isId(w)) return `id-${index + 1}-${this.int(1000, 9999)}`;
    if (isDate(w)) return new Date(this.reference - this.int(0, 365) * 86400000).toISOString();
    if (['username', 'nickname', 'login', 'handle'].includes(single) || (w.at(-1) === 'name' && ['user', 'nick'].includes(w.at(-2) ?? ''))) return `${this.person(index, scope).toLowerCase()}${index + 1}`;
    if (single === 'filename' || (w.at(-1) === 'name' && w.at(-2) === 'file')) return `${this.pick(words)}-${index + 1}.txt`;
    if (single === 'hostname' || (w.at(-1) === 'name' && w.at(-2) === 'host')) return `${this.pick(words)}.example.com`;
    if (['surname', 'lastname'].includes(single) || (w.at(-1) === 'name' && ['last', 'family', 'sur'].includes(w.at(-2) ?? ''))) return this.pick(surnames);
    if (single === 'fullname' || (w.at(-1) === 'name' && ['full', 'display'].includes(w.at(-2) ?? ''))) return `${this.person(index, scope)} ${this.pick(surnames)}`;
    if (single === 'name' || single === 'firstname' || (w.at(-1) === 'name' && personNames.has(w.at(-2) ?? ''))) return this.person(index, scope);
    if (w.some(x => ['url', 'uri', 'website', 'href', 'link'].includes(x))) return `https://example.com/${this.pick(words)}`;
    if (w.some(x => ['phone', 'mobile', 'tel', 'telephone'].includes(x))) return `+1-202-555-${String(this.int(100, 199)).padStart(4, '0')}`;
    return `${this.pick(words)}-${index + 1}`;
  }

  preset(name: string, count: number): Literal {
    if (!presets.includes(name)) throw new Error(`Unknown preset "${name}". Try ${presets.join(', ')}.`);
    const single = name in singlePresets;
    name = singlePresets[name] ?? name;
    if (this.edge === 'empty') return [];
    const values = Array.from({ length: count }, (_, i): Literal => {
      switch (name) {
        case 'users': return { id: i + 1, name: this.field('name', i), email: this.field('email', i), active: this.field('active', i, 'boolean') };
        case 'products': return { id: i + 1, name: this.edge === 'long' ? this.field('name', i) : `${this.pick(words)} product`, price: this.edge === 'boundary' ? this.number() : this.int(1, 10000) / 100, inStock: this.field('inStock', i, 'boolean') };
        case 'numbers': return this.field('number', i, 'number');
        case 'booleans': return this.field('boolean', i, 'boolean');
        case 'names': return this.field('name', i);
        case 'emails': return this.field('email', i);
        case 'ids': return this.field('id', i);
        case 'dates': return this.field('date', i);
        default: return this.field('string', i);
      }
    });
    return single && count === 1 ? values[0] : values;
  }

  example(value: Literal, index = 0, key = 'value', depth = 0, scope = ''): Literal {
    if (depth > 12) throw new Error('Example nesting exceeds 12 levels.');
    if (value === null) return null;
    if (Array.isArray(value)) return this.edge === 'empty' || !value.length ? [] : [this.example(value[0], index, key, depth + 1, scope)];
    if (typeof value === 'object') {
      const inner = depth ? `${scope}/${key}` : scope;
      return record(entriesOf(value).map(([k, v]) => [k, this.example(v, index, k, depth + 1, inner)]));
    }
    return this.field(key, index, typeof value as 'string' | 'number' | 'boolean', scope);
  }

  fromType(text: string, typeName: string, count: number, filename = 'input.ts'): Literal {
    // Parse with the document's real kind: in a .tsx file, JSX parsed as plain TS is error-recovered unpredictably.
    const source = sourceFile(text, filename);
    const types = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) types.set(statement.name.text, statement);
    }
    const root = types.get(typeName);
    if (!root) throw new Error(`Type "${typeName}" must be declared in the current file. Imported types are not supported yet.`);
    // `scope` is the path of the object being filled; undefined only for the root record.
    const nest = (scope: string | undefined, key: string) => scope === undefined ? '' : `${scope}/${key}`;
    const members = (items: ts.NodeArray<ts.TypeElement>, index: number, seen: Set<string>, scope: string): Literal => {
      const values: [string, Literal][] = [];
      for (const item of items) {
        if (!ts.isPropertySignature(item) || !item.type || !item.name || ts.isComputedPropertyName(item.name)) throw new Error('Only typed data properties are supported; methods and index signatures cannot be generated.');
        if (!(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) || ts.isNumericLiteral(item.name))) throw new Error('Unsupported property name.');
        values.push([item.name.text, read(item.type, index, item.name.text, seen, scope)]);
      }
      return record(values);
    };
    const resolve = (declaration: ts.TypeAliasDeclaration | ts.InterfaceDeclaration, index: number, key: string, seen: Set<string>, scope: string | undefined): Literal => {
      if (seen.has(declaration.name.text)) throw new Error(`Recursive type "${declaration.name.text}" requires a custom preset.`);
      if (seen.size > 12) throw new Error('Type nesting exceeds 12 levels.');
      if (declaration.typeParameters?.length || (ts.isInterfaceDeclaration(declaration) && declaration.heritageClauses?.length)) throw new Error('Generic types and interface inheritance are not supported yet.');
      const next = new Set(seen).add(declaration.name.text);
      return ts.isInterfaceDeclaration(declaration) ? members(declaration.members, index, next, nest(scope, key)) : read(declaration.type, index, key, next, scope);
    };
    const read = (node: ts.TypeNode, index: number, key: string, seen: Set<string>, scope: string | undefined): Literal => {
      if (node.kind === ts.SyntaxKind.StringKeyword) return this.field(key, index, 'string', scope ?? '');
      if (node.kind === ts.SyntaxKind.NumberKeyword) return this.field(key, index, 'number', scope ?? '');
      if (node.kind === ts.SyntaxKind.BooleanKeyword) return this.field(key, index, 'boolean', scope ?? '');
      if (ts.isParenthesizedTypeNode(node)) return read(node.type, index, key, seen, scope);
      if (ts.isLiteralTypeNode(node)) return parseLiteral(node.literal.getText(source));
      if (ts.isArrayTypeNode(node)) return this.edge === 'empty' ? [] : [read(node.elementType, index, key, seen, scope)];
      if (ts.isTupleTypeNode(node)) return node.elements.map(n => {
        if (ts.isNamedTupleMember(n)) return read(n.type, index, key, seen, scope);
        if (ts.isOptionalTypeNode(n) || ts.isRestTypeNode(n)) throw new Error('Optional and rest tuple elements are not supported yet.');
        return read(n, index, key, seen, scope);
      });
      if (ts.isUnionTypeNode(node)) {
        const choices = node.types.filter(t => t.kind !== ts.SyntaxKind.UndefinedKeyword);
        if (!choices.length) throw new Error('Cannot generate an undefined-only type as JSON data.');
        return read(this.pick(choices), index, key, seen, scope);
      }
      if (ts.isTypeLiteralNode(node)) return members(node.members, index, seen, nest(scope, key));
      if (ts.isTypeReferenceNode(node)) {
        if (node.typeName.getText(source) === 'Array' && node.typeArguments?.length === 1) return this.edge === 'empty' ? [] : [read(node.typeArguments[0], index, key, seen, scope)];
        if (node.typeArguments?.length) throw new Error('Generic type references are not supported yet.');
        const target = types.get(node.typeName.getText(source));
        if (target) return resolve(target, index, key, seen, scope);
      }
      throw new Error(`Unsupported type: ${node.getText(source)}. Use primitives, literals, arrays, objects, or local type references.`);
    };
    if (this.edge === 'empty') { resolve(root, 0, typeName, new Set(), undefined); return []; }
    return Array.from({ length: count }, (_, i) => resolve(root, i, typeName, new Set(), undefined));
  }
}

// JSON.stringify(value, null, 2), except that objects keep their source key order (see record() in syntax.ts).
function stringify(value: Literal, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) return value.length ? `[\n${value.map(v => inner + stringify(v, inner)).join(',\n')}\n${indent}]` : '[]';
  const entries = entriesOf(value);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, inner)}`).join(',\n')}\n${indent}}` : '{}';
}

export function formatLiteral(value: Literal, format: 'json' | 'js' = 'js'): string {
  const json = stringify(value);
  if (format === 'json') return json;
  return json.replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, (_, indent: string, key: string) => `${indent}${key === '__proto__' ? '["__proto__"]' : key}:`);
}

export function generate(request: DataRequest, documentText = '', defaultFormat: 'json' | 'js' = 'js', filename = 'input.ts'): string {
  const generator = new Generator(request.seed, request.edge);
  const value = request.fromType ? generator.fromType(documentText, request.source, request.count, filename) : generator.preset(request.source, request.count);
  return formatLiteral(value, request.format ?? defaultFormat);
}
