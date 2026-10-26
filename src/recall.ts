import ts from 'typescript';
import { MemoryEntry } from './model';
import { sourceFile } from './syntax';

function complete(entry: MemoryEntry): boolean {
  if (entry.pinned || !/^[A-Za-z_$][\w$]*$/.test(entry.name)) return true;
  const source = sourceFile(entry.text, entry.file);
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return false;
  let incomplete = false;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const &&
      !ts.isForOfStatement(node.parent) && !ts.isForInStatement(node.parent) &&
      node.declarations.some(declaration => !declaration.initializer)) incomplete = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return !incomplete;
}

// Keep history intact; collapse its versions only in completion lists.
export function uniqueRecallEntries(entries: MemoryEntry[], file: string, project: string): MemoryEntry[] {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.name) ?? [];
    group.push(entry);
    groups.set(entry.name, group);
  }
  const result: MemoryEntry[] = [];
  for (const versions of groups.values()) {
    versions.sort((a, b) => Number(b.file === file) - Number(a.file === file) ||
      Number(b.project === project) - Number(a.project === project) ||
      Number(b.pinned) - Number(a.pinned) || b.capturedAt - a.capturedAt);
    const entry = versions.find(complete);
    if (entry) result.push(entry);
  }
  return result;
}
