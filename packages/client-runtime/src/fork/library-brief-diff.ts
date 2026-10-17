export type LibraryBriefDiffLine =
  | { readonly kind: "same" | "added" | "removed"; readonly text: string }
  /** Unchanged lines left out between changes. */
  | { readonly kind: "folded"; readonly count: number };

/** Unchanged lines kept on each side of a change, so it reads in place. */
const CONTEXT_LINES = 2;
/**
 * Beyond this many line pairs the changed middle shows as removed then added. Briefs are capped at
 * 64 KB, so only a wholesale rewrite of a long brief gets here, where a line match adds little.
 */
const MAX_MATCH_CELLS = 1_000_000;

const briefLines = (text: string) => (text === "" ? [] : text.replace(/\r\n?/g, "\n").split("\n"));

/**
 * The proposed brief against the current one, line by line, for clients without a diff renderer.
 * Removed lines come before the added lines that replace them, and long unchanged runs fold.
 */
export function libraryBriefDiff(before: string, after: string): LibraryBriefDiffLine[] {
  const a = briefLines(before);
  const b = briefLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const same = (text: string) => ({ kind: "same", text }) as const;
  return fold([
    ...a.slice(0, start).map(same),
    ...matchLines(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ]);
}

function matchLines(a: readonly string[], b: readonly string[]): LibraryBriefDiffLine[] {
  const removed = (text: string) => ({ kind: "removed", text }) as const;
  const added = (text: string) => ({ kind: "added", text }) as const;
  if (a.length * b.length > MAX_MATCH_CELLS) return [...a.map(removed), ...b.map(added)];
  // Longest common subsequence from each position to the end, one row per line of `a`.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  const lines: LibraryBriefDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
    ) {
      lines.push(removed(a[i]!));
      i += 1;
    } else {
      lines.push(added(b[j]!));
      j += 1;
    }
  }
  return lines;
}

function fold(lines: readonly LibraryBriefDiffLine[]): LibraryBriefDiffLine[] {
  const kept = Array.from({ length: lines.length }, () => false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let at = index - CONTEXT_LINES; at <= index + CONTEXT_LINES; at += 1)
      if (at >= 0 && at < lines.length) kept[at] = true;
  });
  const result: LibraryBriefDiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (kept[index]) {
      if (skipped) result.push({ kind: "folded", count: skipped });
      skipped = 0;
      result.push(line);
    } else skipped += 1;
  });
  if (skipped) result.push({ kind: "folded", count: skipped });
  return result;
}
