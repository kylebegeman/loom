import type { OutlineSymbol } from "./outline";

export function matchesSymbol(name: string, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  let matched = 0;
  for (const char of name.toLocaleLowerCase()) if (char === needle[matched]) matched++;
  return matched === needle.length;
}

/** Retains ancestors of matched children so the visible hierarchy remains meaningful. */
export function filterOutline(symbols: ReadonlyArray<OutlineSymbol>, query: string) {
  const matches = symbols.map((symbol) => matchesSymbol(symbol.name, query.trim()));
  const visible = new Set<number>();
  const ancestors: number[] = [];
  for (let i = 0; i < symbols.length; i++) {
    while (ancestors.length && symbols[ancestors.at(-1)!]!.depth >= symbols[i]!.depth)
      ancestors.pop();
    if (matches[i]) {
      visible.add(i);
      for (const ancestor of ancestors) visible.add(ancestor);
    }
    ancestors.push(i);
  }
  return symbols.flatMap((symbol, index) =>
    visible.has(index) ? [{ symbol, matched: matches[index]! }] : [],
  );
}

export function nearestOutlineSymbol(symbols: ReadonlyArray<OutlineSymbol>, line: number | null) {
  if (line === null) return null;
  let nearest: OutlineSymbol | null = null;
  for (const symbol of symbols)
    if (symbol.line <= line && (!nearest || symbol.line >= nearest.line)) nearest = symbol;
  return nearest;
}

export function moveOutlineSelection(index: number, count: number, key: string): number {
  if (count === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return Math.max(0, Math.min(count - 1, index + (key === "ArrowUp" ? -1 : 1)));
}
