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
}

export type Capture = Omit<MemoryEntry, 'id' | 'capturedAt' | 'pinned' | 'tags' | 'snippet'>;

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
