export const commandNames = ['recall', 'snippet', 'data'] as const;
export type ToolCommand = typeof commandNames[number];
export interface Directive { command?: ToolCommand; partial: string; argument: string; start: number; text: string }

export function parseDirective(line: string, prefix = '/'): Directive | undefined {
  const start = line.length - line.trimStart().length;
  const text = line.slice(start);
  if (!text.startsWith(prefix)) return;
  const rest = text.slice(prefix.length);
  if (rest.startsWith('*') || rest.startsWith('/')) return;
  // The command word must end at whitespace or the line end, so a slash inside it (`/usr/bin`, `/foo/`, `/recall/g`)
  // makes this a path or regex. Arguments may contain slashes: `/recall src/api`.
  const match = /^(\w*)(?:\s+(.*))?$/.exec(rest);
  if (!match) return;
  const [, partial, argument = ''] = match;
  if (!commandNames.some(c => c.startsWith(partial))) return;
  const command = commandNames.find(c => c === partial);
  if (!command && argument) return;
  // An operator after the word is code, not arguments: with prefix `#`, `#data = 1;` is a private field.
  if (/^[=:(.;,?!+*%&|<>[\]{}^~]/.test(argument)) return;
  return { command, partial, argument, start, text };
}

export interface DataRequest { source: string; fromType: boolean; count: number; format?: 'json' | 'js'; seed?: number; edge?: string }
export function parseDataRequest(argument: string, defaultCount = 5): DataRequest {
  const words = argument.trim().split(/\s+/).filter(Boolean);
  let fromType = false;
  if (words[0] === 'from') { fromType = true; words.shift(); }
  const source = words.shift() || 'users';
  let count = /^(user|product|name|email|id|number|date|boolean|string)$/.test(source) ? 1 : defaultCount;
  if (words[0] && /^\d+$/.test(words[0])) count = Number(words.shift());
  const result: DataRequest = { source, fromType, count };
  for (const word of words) {
    if (word === '--format=json') result.format = 'json';
    else if (word === '--format=js' || word === '--format=ts') result.format = 'js';
    else if (/^--seed=-?\d+$/.test(word)) result.seed = Number(word.slice(7));
    else if (/^--edge=(empty|long|boundary)$/.test(word)) result.edge = word.slice(7);
    else throw new Error(`Unknown data option: ${word}`);
  }
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Record count must be between 1 and 1000.');
  // The generator state is 32 bits; larger seeds would silently collide (1 and 2^32 + 1 gave identical data).
  if (result.seed !== undefined && !(Number.isInteger(result.seed) && result.seed >= 0 && result.seed <= 0xffffffff)) throw new Error('Seed must be an integer from 0 to 4294967295.');
  if (fromType && !/^[A-Za-z_$][\w$]*$/.test(source)) throw new Error('Use a locally declared type name after "from".');
  return result;
}
