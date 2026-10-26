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
}

export type Capture = Omit<MemoryEntry, 'id' | 'capturedAt' | 'pinned' | 'tags' | 'snippet' | 'live'>;

// Heuristic, not a guarantee: memory is plaintext and recall crosses projects, so skip code that
// visibly carries credentials — well-known token shapes, or a secret-like name bound to a string literal.
const tokenShapes = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)_(?:live|test)_[\w]{16,}|\bsk-[\w-]{20,}|\bgh[pousr]_[A-Za-z\d]{30,}|\bgithub_pat_\w{30,}|\bxox[abposr]-[\w-]{10,}|\bAKIA[A-Z\d]{16}\b|\bAIza[\w-]{35}\b|\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/;
const secretName = /(?:secret|passw(?:or)?d|passwd|token|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth[_-]?key)/i;
export function looksSecret(text: string): boolean {
  if (tokenShapes.test(text)) return true;
  // `apiKey: "…"`, `const DB_PASSWORD = '…'`, `token = \`…\`` with a non-trivial literal value.
  return new RegExp(`[\\w$]*${secretName.source}[\\w$]*["']?\\s*[:=]\\s*["'\`][^"'\`\\s]{8,}["'\`]`, 'i').test(text);
}

export function searchEntries(entries: MemoryEntry[], query: string, project?: string): MemoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (e: MemoryEntry) => {
    const name = e.name.toLowerCase();
    const needle = query.toLowerCase().trim();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
  };
  return entries.filter(e => (!project || e.project === project) && terms.every(t =>
    `${e.name}\n${e.text}\n${e.tags.join(' ')}\n${e.project}\n${e.file}`.toLowerCase().includes(t)))
    .sort((a, b) => rank(a) - rank(b) || Number(b.pinned) - Number(a.pinned) || b.capturedAt - a.capturedAt);
}
