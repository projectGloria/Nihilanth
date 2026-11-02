import ts from 'typescript';

// Parse with the document's language, not its file name: untitled buffers have no extension and `.mjs`/`.cjs`
// would otherwise be read as TypeScript. Appending the language's extension makes sourceFile() pick the right grammar.
const scriptExtensions: Record<string, string> = { javascript: '.js', javascriptreact: '.jsx', typescript: '.ts', typescriptreact: '.tsx' };
export function scriptName(file: string, languageId: string): string { const extension = scriptExtensions[languageId]; return extension ? `${file}${extension}` : file; }

// The typing listener and the completion provider parse the same document text on every keystroke.
// SourceFiles are immutable, so a few recent parses can be shared; string equality is far cheaper than a parse.
const parsed: { filename: string; text: string; source: ts.SourceFile }[] = [];
export function sourceFile(text: string, filename = 'input.ts', cache = true): ts.SourceFile {
  const hit = cache ? parsed.findIndex(p => p.filename === filename && p.text === text) : -1;
  if (hit >= 0) { const [entry] = parsed.splice(hit, 1); parsed.unshift(entry); return entry.source; }
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true,
    /\.jsx$/.test(filename) ? ts.ScriptKind.JSX : /\.tsx$/.test(filename) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  if (!cache) return source;
  parsed.unshift({ filename, text, source });
  parsed.length = Math.min(parsed.length, 4);
  return source;
}
const diagnostics = (source: ts.SourceFile) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;

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
    // Only statements: loop heads (`for (const item of …)`) and `catch (error)` bind names, they are not reusable code.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)) {
      name = node.name;
      const parent = node.parent;
      if (parent.declarations.length === 1) saved = parent.parent;
      else {
        const keyword = parent.flags & ts.NodeFlags.Const ? 'const' : parent.flags & ts.NodeFlags.Let ? 'let' : 'var';
        found.push({ name: name.text, text: `${keyword} ${node.getText(source)};`, start: node.getStart(source), end: node.end, nameStart: name.getStart(source), nameEnd: name.end });
        ts.forEachChild(node, visit);
        return;
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

/** False for code that does not parse, or declares a `const` without a value (`const nihil =` caught mid-edit). */
export function isCompleteDeclaration(text: string, filename = 'input.ts'): boolean {
  // Not cached: these are stored entries, and caching them would evict the document parse the keystroke paths share.
  const source = sourceFile(text, filename, false);
  if (diagnostics(source).length) return false;
  let incomplete = false;
  // `declare const x: number;` is complete: ambient declarations have no value by definition.
  const ambient = (node: ts.Node | undefined): boolean => !!node && ((ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) || ambient(node.parent));
  function visit(node: ts.Node) {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const && !ambient(node.parent) &&
      !ts.isForOfStatement(node.parent) && !ts.isForInStatement(node.parent) &&
      node.declarations.some(declaration => !declaration.initializer)) incomplete = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return !incomplete;
}

export type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };
export type LiteralObject = { [key: string]: Literal };

// JS objects list integer-like keys first, so `{"b":1,"2":2}` would come back as `{"2":2,"b":1}`. Objects built here
// remember their source order under a symbol (invisible to JSON.stringify and Object.keys) and entriesOf() honours it.
const keyOrder = Symbol('keyOrder');
export function record(entries: Iterable<[string, Literal]>): LiteralObject {
  const object: LiteralObject = Object.create(null);
  const keys: string[] = [];
  for (const [key, value] of entries) {
    if (!Object.hasOwn(object, key)) keys.push(key);
    // defineProperty, not assignment: `__proto__` must become an own key instead of replacing the prototype.
    Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
  }
  Object.defineProperty(object, keyOrder, { value: keys });
  return object;
}
export function entriesOf(object: LiteralObject): [string, Literal][] {
  return ((object as { [keyOrder]?: string[] })[keyOrder] ?? Object.keys(object)).map(key => [key, object[key]]);
}

// The last token, if it is a `;`, is cut so `{ a: 1 }; // note` parses; comments after it are trivia.
function withoutTrailingSemicolon(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let semicolon = -1;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) semicolon = kind === ts.SyntaxKind.SemicolonToken ? scanner.getTokenStart() : -1;
  return semicolon >= 0 ? text.slice(0, semicolon) : text;
}

export function parseLiteral(text: string): Literal {
  // JSON goes through the same AST walk as JS: JSON.parse would round big integers, reorder keys and drop duplicate
  // keys before any of that could be detected. The newlines keep a trailing `// comment` from swallowing the `)`.
  const source = ts.createSourceFile('literal.ts', `const __value = (\n${withoutTrailingSemicolon(text.trim())}\n);`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (diagnostics(source).length) throw new Error('Select valid JSON or a literal JS object/array.');
  const statement = source.statements[0];
  // One declaration only: `1), b = (2` would otherwise parse as `const __value = (1), b = (2)` and silently drop input.
  if (source.statements.length !== 1 || !ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) throw new Error('Only literal values are supported.');
  function read(node: ts.Node): Literal {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return read(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be represented as JSON data.');
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${node.getText(source)} is too large to keep exactly; quote it as a string first.`);
      return value;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) {
      const value = read(node.operand);
      if (typeof value === 'number') return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(read);
    if (ts.isObjectLiteralExpression(node)) {
      const entries: [string, Literal][] = [];
      const seen = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Object methods, shorthand fields, and spreads are not literal data.');
        const key = ts.isComputedPropertyName(property.name) ? (ts.isStringLiteral(property.name.expression) ? property.name.expression.text : undefined) :
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : undefined;
        if (key === undefined) throw new Error('Unsupported object key.');
        // JSON.parse keeps the last duplicate and silently loses the others; refuse instead of guessing.
        if (seen.has(key)) throw new Error(`Duplicate key "${key}".`);
        seen.add(key);
        entries.push([key, read(property.initializer)]);
      }
      return record(entries);
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
    // JSDoc blocks are children of the node they document, so the descent meets them as nodes, not as comment trivia.
    if (child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) return true;
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
