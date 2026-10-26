import ts from 'typescript';
import { DataRequest } from './directives';
import { Literal, parseLiteral, sourceFile } from './syntax';

const names = ['Ada', 'Deniz', 'Maya', 'Emre', 'Noah', 'Lina', 'Ece', 'Omar', 'Sofia', 'Alex'];
const words = ['cedar', 'ocean', 'amber', 'river', 'meadow', 'silver', 'violet', 'maple'];
const singlePresets: Record<string, string> = { user: 'users', product: 'products', name: 'names', email: 'emails', id: 'ids', number: 'numbers', date: 'dates', boolean: 'booleans', string: 'strings' };
export const presets = ['users', 'products', 'names', 'emails', 'ids', 'numbers', 'dates', 'booleans', 'strings', ...Object.keys(singlePresets)];

export class Generator {
  private state: number;
  private readonly reference: number;
  constructor(seed?: number, private edge?: string) {
    this.state = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.reference = seed === undefined ? Date.now() : Date.UTC(2025, 0, 1);
  }
  random(): number { this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0; return this.state / 0x100000000; }
  int(min = 0, max = 100): number { return this.edge === 'boundary' ? (this.random() < .5 ? min : max) : Math.floor(this.random() * (max - min + 1)) + min; }
  pick<T>(values: readonly T[]): T { return values[this.int(0, values.length - 1)]; }
  field(key: string, index: number, kind: 'string' | 'number' | 'boolean' = 'string'): Literal {
    if (kind === 'number') return this.int(0, 100);
    if (kind === 'boolean') return this.random() >= .5;
    if (this.edge === 'empty') return '';
    if (this.edge === 'long') return 'x'.repeat(1024);
    const lower = key.toLowerCase();
    if (/email/.test(lower)) return `${this.pick(names).toLowerCase()}.${index + 1}@example.com`;
    if (/^(id|uuid)$|Id$|_id$/.test(key)) return `id-${index + 1}-${this.int(1000, 9999)}`;
    if (/date|createdat|updatedat|timestamp/.test(lower)) return new Date(this.reference - this.int(0, 365) * 86400000).toISOString();
    if (/name/.test(lower)) return this.pick(names);
    if (/url|website/.test(lower)) return `https://example.com/${this.pick(words)}`;
    if (/phone/.test(lower)) return `+1-202-555-${String(this.int(100, 199)).padStart(4, '0')}`;
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
        case 'products': return { id: i + 1, name: `${this.pick(words)} product`, price: this.int(1, 10000) / 100, inStock: this.field('inStock', i, 'boolean') };
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

  example(value: Literal, index = 0, key = 'value', depth = 0): Literal {
    if (depth > 12) throw new Error('Example nesting exceeds 12 levels.');
    if (value === null) return null;
    if (Array.isArray(value)) return this.edge === 'empty' || !value.length ? [] : [this.example(value[0], index, key, depth + 1)];
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.example(v, index, k, depth + 1)]));
    return this.field(key, index, typeof value as 'string' | 'number' | 'boolean');
  }

  fromType(text: string, typeName: string, count: number): Literal {
    const source = sourceFile(text);
    const types = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) types.set(statement.name.text, statement);
    }
    const root = types.get(typeName);
    if (!root) throw new Error(`Type "${typeName}" must be declared in the current file. Imported types are not supported yet.`);
    const members = (items: ts.NodeArray<ts.TypeElement>, index: number, seen: Set<string>): Literal => {
      const values: [string, Literal][] = [];
      for (const item of items) {
        if (!ts.isPropertySignature(item) || !item.type || !item.name || ts.isComputedPropertyName(item.name)) throw new Error('Only typed data properties are supported; methods and index signatures cannot be generated.');
        if (!(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) || ts.isNumericLiteral(item.name))) throw new Error('Unsupported property name.');
        values.push([item.name.text, read(item.type, index, item.name.text, seen)]);
      }
      return Object.fromEntries(values);
    };
    const resolve = (declaration: ts.TypeAliasDeclaration | ts.InterfaceDeclaration, index: number, key: string, seen: Set<string>): Literal => {
      if (seen.has(declaration.name.text)) throw new Error(`Recursive type "${declaration.name.text}" requires a custom preset.`);
      if (seen.size > 12) throw new Error('Type nesting exceeds 12 levels.');
      if (declaration.typeParameters?.length || (ts.isInterfaceDeclaration(declaration) && declaration.heritageClauses?.length)) throw new Error('Generic types and interface inheritance are not supported yet.');
      const next = new Set(seen).add(declaration.name.text);
      return ts.isInterfaceDeclaration(declaration) ? members(declaration.members, index, next) : read(declaration.type, index, key, next);
    };
    const read = (node: ts.TypeNode, index: number, key: string, seen: Set<string>): Literal => {
      if (node.kind === ts.SyntaxKind.StringKeyword) return this.field(key, index);
      if (node.kind === ts.SyntaxKind.NumberKeyword) return this.field(key, index, 'number');
      if (node.kind === ts.SyntaxKind.BooleanKeyword) return this.field(key, index, 'boolean');
      if (ts.isParenthesizedTypeNode(node)) return read(node.type, index, key, seen);
      if (ts.isLiteralTypeNode(node)) return parseLiteral(node.literal.getText(source));
      if (ts.isArrayTypeNode(node)) return this.edge === 'empty' ? [] : [read(node.elementType, index, key, seen)];
      if (ts.isTupleTypeNode(node)) return node.elements.map(n => {
        if (ts.isNamedTupleMember(n)) return read(n.type, index, key, seen);
        if (ts.isOptionalTypeNode(n) || ts.isRestTypeNode(n)) throw new Error('Optional and rest tuple elements are not supported yet.');
        return read(n, index, key, seen);
      });
      if (ts.isUnionTypeNode(node)) {
        const choices = node.types.filter(t => t.kind !== ts.SyntaxKind.UndefinedKeyword);
        if (!choices.length) throw new Error('Cannot generate an undefined-only type as JSON data.');
        return read(this.pick(choices), index, key, seen);
      }
      if (ts.isTypeLiteralNode(node)) return members(node.members, index, seen);
      if (ts.isTypeReferenceNode(node)) {
        if (node.typeName.getText(source) === 'Array' && node.typeArguments?.length === 1) return this.edge === 'empty' ? [] : [read(node.typeArguments[0], index, key, seen)];
        if (node.typeArguments?.length) throw new Error('Generic type references are not supported yet.');
        const target = types.get(node.typeName.getText(source));
        if (target) return resolve(target, index, key, seen);
      }
      throw new Error(`Unsupported type: ${node.getText(source)}. Use primitives, literals, arrays, objects, or local type references.`);
    };
    if (this.edge === 'empty') { resolve(root, 0, typeName, new Set()); return []; }
    return Array.from({ length: count }, (_, i) => resolve(root, i, typeName, new Set()));
  }
}

export function formatLiteral(value: Literal, format: 'json' | 'js' = 'js'): string {
  const json = JSON.stringify(value, null, 2);
  if (format === 'json') return json;
  return json.replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, (_, indent: string, key: string) => `${indent}${key === '__proto__' ? '["__proto__"]' : key}:`);
}

export function generate(request: DataRequest, documentText = '', defaultFormat: 'json' | 'js' = 'js'): string {
  const generator = new Generator(request.seed, request.edge);
  const value = request.fromType ? generator.fromType(documentText, request.source, request.count) : generator.preset(request.source, request.count);
  return formatLiteral(value, request.format ?? defaultFormat);
}
