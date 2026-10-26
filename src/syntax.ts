import ts from 'typescript';

// The typing listener and the completion provider parse the same document text on every keystroke.
// SourceFiles are immutable, so a few recent parses can be shared; string equality is far cheaper than a parse.
const parsed: { filename: string; text: string; source: ts.SourceFile }[] = [];
export function sourceFile(text: string, filename = 'input.ts'): ts.SourceFile {
  const hit = parsed.findIndex(p => p.filename === filename && p.text === text);
  if (hit >= 0) { const [entry] = parsed.splice(hit, 1); parsed.unshift(entry); return entry.source; }
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true,
    /\.jsx$/.test(filename) ? ts.ScriptKind.JSX : /\.tsx$/.test(filename) ? ts.ScriptKind.TSX : /\.js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  parsed.unshift({ filename, text, source });
  parsed.length = Math.min(parsed.length, 4);
  return source;
}

const identifierChar = /[\w$]/;
// True when [start, end) removes at least one whole identifier. Removing a single character
// from the middle of a word cannot delete a declaration's name, so the caller can skip a full parse.
export function removesWholeIdentifier(text: string, start: number, end: number): boolean {
  for (const match of text.slice(start, end).matchAll(/[A-Za-z_$][\w$]*/g)) {
    const from = start + match.index, to = from + match[0].length;
    if (!identifierChar.test(text[from - 1] ?? '') && !identifierChar.test(text[to] ?? '')) return true;
  }
  return false;
}

export interface Declaration { name: string; text: string; start: number; end: number; nameStart: number; nameEnd: number }
export function declarations(text: string, filename = 'input.ts'): Declaration[] {
  const source = sourceFile(text, filename);
  const found: Declaration[] = [];
  function visit(node: ts.Node) {
    let name: ts.Identifier | undefined;
    let saved: ts.Node = node;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name;
      const parent = node.parent;
      if (ts.isVariableDeclarationList(parent) && ts.isVariableStatement(parent.parent)) {
        if (parent.declarations.length === 1) saved = parent.parent;
        else {
          const keyword = parent.flags & ts.NodeFlags.Const ? 'const' : parent.flags & ts.NodeFlags.Let ? 'let' : 'var';
          found.push({ name: name.text, text: `${keyword} ${node.getText(source)};`, start: node.getStart(source), end: node.end, nameStart: name.getStart(source), nameEnd: name.end });
          ts.forEachChild(node, visit);
          return;
        }
      }
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) name = node.name;
    if (name) {
      const snippet = saved.getText(source);
      if (snippet.trim().length >= 8 && !snippet.trimStart().startsWith('/')) found.push({
        name: name.text, text: snippet, start: saved.getStart(source), end: saved.end,
        nameStart: name.getStart(source), nameEnd: name.end
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

export type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };

export function parseLiteral(text: string): Literal {
  try {
    const parsed = JSON.parse(text) as Literal;
    const validate = (value: Literal): void => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number.');
      if (value && typeof value === 'object') for (const child of Object.values(value)) validate(child);
    };
    validate(parsed);
    return parsed;
  } catch { /* Parse the safe literal subset below. */ }
  const source = ts.createSourceFile('literal.ts', `const __value = (${text.trim().replace(/;$/, '')});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new Error('Select valid JSON or a literal JS object/array.');
  const statement = source.statements[0];
  if (!ts.isVariableStatement(statement) || source.statements.length !== 1) throw new Error('Only literal values are supported.');
  function read(node: ts.Node): Literal {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return read(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) { const value = Number(node.text); if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be represented as JSON data.'); return value; }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) {
      const value = read(node.operand);
      if (typeof value === 'number') return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(read);
    if (ts.isObjectLiteralExpression(node)) {
      const object: Record<string, Literal> = Object.create(null);
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Object methods, shorthand fields, and spreads are not literal data.');
        const key = ts.isComputedPropertyName(property.name) ? (ts.isStringLiteral(property.name.expression) ? property.name.expression.text : undefined) :
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : undefined;
        if (key === undefined) throw new Error('Unsupported object key.');
        Object.defineProperty(object, key, { value: read(property.initializer), enumerable: true, writable: true, configurable: true });
      }
      return object;
    }
    throw new Error('Only literal data is supported. Expressions, references, and function calls are never executed.');
  }
  const initializer = statement.declarationList.declarations[0].initializer;
  if (!initializer) throw new Error('Missing literal value.');
  return read(initializer);
}

export function insideStringOrComment(text: string, offset: number, filename = 'input.ts'): boolean {
  const source = sourceFile(text, filename);
  // Descend to the innermost token whose full span (leading trivia included) holds offset. getChildren()
  // yields real tokens, so regexes and template parts follow the parser — a context-free scanner reads
  // `/\/*$/` as division plus an unterminated block comment and blanks out the rest of the file.
  let node: ts.Node = source;
  for (;;) {
    const child = node.getChildren(source).find(c => offset >= c.getFullStart() && offset < c.end);
    if (!child) break;
    node = child;
  }
  const start = node.getStart(source);
  if (offset < start) {
    // Same-line comments are *trailing* ranges of the previous token; getLeadingCommentRanges skips them.
    const pos = node.getFullStart();
    return [...ts.getTrailingCommentRanges(text, pos) ?? [], ...ts.getLeadingCommentRanges(text, pos) ?? []]
      .some(r => offset >= r.pos && offset < r.end);
  }
  const k = node.kind;
  const stringish = ts.isStringLiteralLike(node) || k === ts.SyntaxKind.RegularExpressionLiteral || k === ts.SyntaxKind.TemplateHead ||
    k === ts.SyntaxKind.TemplateMiddle || k === ts.SyntaxKind.TemplateTail || k === ts.SyntaxKind.JsxText;
  return stringish && offset > start && offset < node.end;
}
