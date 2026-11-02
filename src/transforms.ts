import { formatLiteral } from './generator';
import { entriesOf, Literal, LiteralObject, parseLiteral } from './syntax';

export const transforms = [
  ['json', 'Convert to JSON'], ['object', 'Convert to JS object literal'],
  ['keys', 'Extract object keys'], ['values', 'Extract object values'], ['entries', 'Extract object entries'],
  ['type', 'JSON → TypeScript type'], ['dedupe', 'Deduplicate primitive array'],
  ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['kebab', 'kebab-case']
] as const;
export type Transform = typeof transforms[number][0];

const isObject = (value: Literal): value is LiteralObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const typeKey = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

// The objects of one array merge into a single shape; a key missing from some of them becomes optional.
function shape(objects: LiteralObject[]): string {
  const fields = new Map<string, { types: Set<string>; count: number }>();
  for (const object of objects) for (const [key, value] of entriesOf(object)) {
    const field = fields.get(key) ?? { types: new Set<string>(), count: 0 };
    field.types.add(infer(value));
    field.count++;
    fields.set(key, field);
  }
  if (!fields.size) return '{}';
  return `{\n${[...fields].map(([key, f]) => `  ${typeKey(key)}${f.count < objects.length ? '?' : ''}: ${[...f.types].join(' | ').replace(/\n/g, '\n  ')};`).join('\n')}\n}`;
}

function infer(value: Literal): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const objects = value.filter(isObject);
    const unique = [...new Set([...(objects.length ? [shape(objects)] : []), ...value.filter(v => !isObject(v)).map(infer)])];
    return unique.length ? `Array<${unique.join(' | ')}>` : 'unknown[]';
  }
  if (isObject(value)) return shape([value]);
  return typeof value;
}

export function transform(text: string, action: Transform): string {
  if (['camel', 'pascal', 'snake', 'kebab'].includes(action)) {
    // Leading `_`/`$` and trailing `_` are sigils (`_private`, `$el`, `class_`), not word separators: keep them.
    const [, lead, core, trail] = /^([_$]*)([\s\S]*?)(_*)$/.exec(text.trim())!;
    // Lowercasing `İ` yields `i` + U+0307 (combining dot); drop the dot so `İstanbul` becomes `istanbul`.
    const words = core.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      .map(w => w.toLowerCase().replace(/i\u0307/g, 'i'));
    if (!words.length) throw new Error('Select a name or some words.');
    const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const joined = action === 'snake' || action === 'kebab' ? words.join(action === 'snake' ? '_' : '-') : words.map((w, i) => action === 'pascal' || i > 0 ? upper(w) : w).join('');
    return `${lead}${joined}${trail}`;
  }
  const value = parseLiteral(text);
  if (action === 'json') return formatLiteral(value, 'json');
  if (action === 'object') return formatLiteral(value, 'js');
  if (action === 'type') return `type GeneratedType = ${infer(value)};`;
  if (action === 'dedupe') {
    if (!Array.isArray(value) || value.some(v => v !== null && typeof v === 'object')) throw new Error('Deduplication supports primitive arrays only.');
    return formatLiteral([...new Set(value)]);
  }
  if (!isObject(value)) throw new Error('Select an object to extract keys, values, or entries.');
  const entries = entriesOf(value);
  return formatLiteral(action === 'keys' ? entries.map(([key]) => key) : action === 'values' ? entries.map(([, v]) => v) : entries);
}
