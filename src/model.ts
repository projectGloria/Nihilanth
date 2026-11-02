export interface MemoryEntry {
  id: string;
  name: string;
  text: string;
  language: string;
  project: string;
  file: string;
  capturedAt: number;
  pinned: boolean;
  tags: string[];
  snippet: boolean;
  /** Mirrors a declaration that currently exists in its file; replaced in place as the file is edited. Absent = history. */
  live?: boolean;
  /** When this live version first appeared. A version older than the checkpoint window is kept as history when replaced. */
  since?: number;
}

export type Capture = Omit<MemoryEntry, 'id' | 'capturedAt' | 'pinned' | 'tags' | 'snippet' | 'live' | 'since'>;

// Heuristic, not a guarantee: memory is plaintext and recall crosses projects, so skip code that
// visibly carries credentials — well-known token shapes, or a secret-like name bound to a string literal.
const tokenShapes = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)_(?:live|test)_[\w]{16,}|\bsk-[\w-]{20,}|\bgh[pousr]_[A-Za-z\d]{30,}|\bgithub_pat_\w{30,}|\bxox[abposr]-[\w-]{10,}|\bAKIA[A-Z\d]{16}\b|\bAIza[\w-]{35}\b|\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}|\b(?:Bearer|Basic)\s+[A-Za-z\d\-._~+/]{12,}=*/;
// `postgres://admin:S3cret@db`: a password embedded in any scheme's URL, whatever the variable is called.
const credentialUrl = /\b[a-z][a-z\d+.-]*:\/\/[^\s:@/'"`]*:[^\s@/'"`]+@/i;
const secretName = /(?:secret|passw(?:or)?d|passwd|token|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth[_-]?key)/i;
// `apiKey: "…"`, `const DB_PASSWORD = 'hunter2'`, `secret = "correct horse"`: any literal of 4+ characters, spaces included,
// but not a template that only interpolates (`token = \`${value}\``), which holds no secret itself.
const namedSecret = new RegExp(`[\\w$]*${secretName.source}[\\w$]*["']?\\s*[:=]\\s*(["'\`])(?:(?!\\$\\{)[^"'\`\\n]){4,}\\1`, 'i');
export function looksSecret(text: string): boolean {
  return tokenShapes.test(text) || credentialUrl.test(text) || namedSecret.test(text);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Last path segment of a file or project URI, decoded: `file:///c%3A/Users/me/app/src/a.ts` → `a.ts`.
function segment(uri: string): string {
  const name = uri.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
  try { return decodeURIComponent(name); } catch { return name; }
}

export function searchEntries(entries: MemoryEntry[], query: string, project?: string): MemoryEntry[] {
  // Files and projects match by their last segment only: whole URIs carry the home path, so on Windows a query
  // such as "users" or "desktop" used to match every entry. Case-insensitive regexes avoid lowercasing every text.
  const terms = query.split(/\s+/).filter(Boolean).map(term => new RegExp(escapeRegExp(term), 'i'));
  const needle = query.toLowerCase().trim();
  const rank = (e: MemoryEntry) => {
    const name = e.name.toLowerCase();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
  };
  return entries.filter(e => (!project || e.project === project) && terms.every(t =>
    t.test(e.name) || t.test(e.text) || e.tags.some(tag => t.test(tag)) || t.test(segment(e.file)) || t.test(segment(e.project))))
    .sort((a, b) => rank(a) - rank(b) || Number(b.pinned) - Number(a.pinned) || b.capturedAt - a.capturedAt);
}
