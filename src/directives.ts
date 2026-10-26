export const commandNames = ['recall', 'snippet', 'data'] as const;
export type ToolCommand = typeof commandNames[number];
export interface Directive { command?: ToolCommand; partial: string; argument: string; start: number; text: string }

export function parseDirective(line: string, prefix = '/'): Directive | undefined {
  const start = line.length - line.trimStart().length;
  const text = line.slice(start);
  if (!text.startsWith(prefix)) return;
  const rest = text.slice(prefix.length);
  // A closing slash makes this a regex/path, not a toolbox directive.
  if (rest.includes('/') || rest.startsWith('*') || rest.startsWith('/')) return;
  const match = /^(\w*)(?:\s+(.*))?$/.exec(rest);
  if (!match) return;
  const [, partial, argument = ''] = match;
  if (!commandNames.some(c => c.startsWith(partial))) return;
  const command = commandNames.find(c => c === partial);
  if (!command && argument) return;
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
  if (result.seed !== undefined && !Number.isSafeInteger(result.seed)) throw new Error('Seed must be a safe integer.');
  if (fromType && !/^[A-Za-z_$][\w$]*$/.test(source)) throw new Error('Use a locally declared type name after "from".');
  return result;
}
