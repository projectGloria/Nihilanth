import { MemoryEntry } from './model';
import { isCompleteDeclaration, scriptName } from './syntax';

// Entries are never mutated after they are stored, so a verdict per entry object stays valid and each stored
// version is parsed once instead of on every keystroke.
const verdicts = new WeakMap<MemoryEntry, boolean>();
function complete(entry: MemoryEntry): boolean {
  if (entry.pinned || !/^[A-Za-z_$][\w$]*$/.test(entry.name)) return true;
  let verdict = verdicts.get(entry);
  if (verdict === undefined) verdicts.set(entry, verdict = isCompleteDeclaration(entry.text, scriptName(entry.file, entry.language)));
  return verdict;
}

// Keep history intact; collapse its versions only in completion lists. Per name this keeps the best unpinned version
// and, separately, the best pinned one: a snippet the user pinned must never be hidden by captured history.
export function uniqueRecallEntries(entries: MemoryEntry[], file: string, project: string): MemoryEntry[] {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.pinned ? 'pinned' : 'memory'}\0${entry.name}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const result: MemoryEntry[] = [];
  for (const versions of groups.values()) {
    versions.sort((a, b) => Number(b.file === file) - Number(a.file === file) ||
      Number(b.project === project) - Number(a.project === project) || b.capturedAt - a.capturedAt);
    const entry = versions.find(complete);
    if (entry) result.push(entry);
  }
  return result;
}
