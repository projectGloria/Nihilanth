import { formatLiteral } from './generator';
import { Literal, parseLiteral } from './syntax';

export const transforms = [
  ['json', 'Convert to JSON'], ['object', 'Convert to JS object literal'],
  ['keys', 'Extract object keys'], ['values', 'Extract object values'], ['entries', 'Extract object entries'],
  ['type', 'JSON → TypeScript type'], ['dedupe', 'Deduplicate primitive array'],
  ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['kebab', 'kebab-case']
] as const;
export type Transform = typeof transforms[number][0];

function infer(value: Literal): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const unique = [...new Set(value.map(infer))];
    return unique.length ? `Array<${unique.join(' | ')}>` : 'unknown[]';
  }
  if (typeof value === 'object') return `{\n${Object.entries(value).map(([key, v]) => `  ${JSON.stringify(key)}: ${infer(v).replace(/\n/g, '\n  ')};`).join('\n')}\n}`;
  return typeof value;
}

export function transform(text: string, action: Transform): string {
  if (['camel', 'pascal', 'snake', 'kebab'].includes(action)) {
    const words = text.trim().replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w.toLowerCase());
    if (!words.length) throw new Error('Select a name or some words.');
    const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (action === 'snake' || action === 'kebab') return words.join(action === 'snake' ? '_' : '-');
    return words.map((w, i) => action === 'pascal' || i > 0 ? upper(w) : w).join('');
  }
  const value = parseLiteral(text);
  if (action === 'json') return formatLiteral(value, 'json');
  if (action === 'object') return formatLiteral(value, 'js');
  if (action === 'type') return `type GeneratedType = ${infer(value)};`;
  if (action === 'dedupe') {
    if (!Array.isArray(value) || value.some(v => v !== null && typeof v === 'object')) throw new Error('Deduplication supports primitive arrays only.');
    return formatLiteral([...new Set(value)]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Select an object to extract keys, values, or entries.');
  return formatLiteral(action === 'keys' ? Object.keys(value) : action === 'values' ? Object.values(value) : Object.entries(value));
}
