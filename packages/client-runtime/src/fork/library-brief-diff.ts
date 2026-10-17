export type LibraryBriefDiffLine =
  | { readonly kind: "same" | "added" | "removed"; readonly text: string }
  /** Unchanged lines left out between changes. */
  | { readonly kind: "folded"; readonly count: number };

/** Unchanged lines kept on each side of a change, so it reads in place. */
const CONTEXT_LINES = 2;
/**
 * Beyond this many changed lines the middle shows as removed then added. The search costs the
 * square of the changes in memory, however long the brief, and a rewrite that large reads better
 * whole than as scattered matches.
 */
const MAX_EDITS = 1_000;

const briefLines = (text: string) => (text === "" ? [] : text.replace(/\r\n?/g, "\n").split("\n"));
const same = (text: string) => ({ kind: "same", text }) as const;
const removed = (text: string) => ({ kind: "removed", text }) as const;
const added = (text: string) => ({ kind: "added", text }) as const;

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
  return fold([
    ...a.slice(0, start).map(same),
    ...matchLines(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ]);
}

/** Myers' shortest edit script, so a few changes in a long brief stay cheap to find. */
function matchLines(a: readonly string[], b: readonly string[]): LibraryBriefDiffLine[] {
  if (!a.length || !b.length) return [...a.map(removed), ...b.map(added)];
  const max = Math.min(a.length + b.length, MAX_EDITS);
  const offset = max + 1;
  // The furthest `a` index reached on each diagonal k = x - y, stored at k + offset.
  const furthest = new Int32Array(2 * max + 3);
  // Before each step d, the diagonals -d-1..d+1 the backtrack reads, stored at k + d + 1.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(furthest.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && furthest[offset + k - 1]! < furthest[offset + k + 1]!)
          ? furthest[offset + k + 1]!
          : furthest[offset + k - 1]! + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[offset + k] = x;
      if (x >= a.length && y >= b.length) return backtrack(a, b, trace);
    }
  }
  return [...a.map(removed), ...b.map(added)];
}

function backtrack(
  a: readonly string[],
  b: readonly string[],
  trace: readonly Int32Array[],
): LibraryBriefDiffLine[] {
  const reversed: LibraryBriefDiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const row = trace[d]!;
    const at = (k: number) => row[k + d + 1]!;
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      reversed.push(same(a[x]!));
    }
    if (d === 0) break;
    if (x > previousX) reversed.push(removed(a[previousX]!));
    else reversed.push(added(b[previousY]!));
    x = previousX;
    y = previousY;
  }
  const lines: LibraryBriefDiffLine[] = [];
  let removals: LibraryBriefDiffLine[] = [];
  let additions: LibraryBriefDiffLine[] = [];
  const flush = () => {
    lines.push(...removals, ...additions);
    removals = [];
    additions = [];
  };
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    const line = reversed[index]!;
    if (line.kind === "removed") removals.push(line);
    else if (line.kind === "added") additions.push(line);
    else {
      flush();
      lines.push(line);
    }
  }
  flush();
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
  // A single hidden line takes as much room as its placeholder, so it shows instead.
  const flush = (end: number) => {
    if (skipped === 1) result.push(lines[end - 1]!);
    else if (skipped > 1) result.push({ kind: "folded", count: skipped });
    skipped = 0;
  };
  lines.forEach((line, index) => {
    if (kept[index]) {
      flush(index);
      result.push(line);
    } else skipped += 1;
  });
  flush(lines.length);
  return result;
}
