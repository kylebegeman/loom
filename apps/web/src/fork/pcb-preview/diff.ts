export type DiffLine = { kind: "same" | "added" | "removed"; text: string; line: number };

/**
 * Line diff for reviewing a parameter edit. Parameter writes replace literals in place, so
 * equal line counts compare line by line; anything else falls back to an LCS diff, which is
 * bounded so a pathological source cannot stall the inspector.
 */
export function lineDiff(before: string, after: string, limit = 2000): DiffLine[] {
  const a = before.split("\n"),
    b = after.split("\n");
  if (a.length === b.length)
    return b.flatMap((text, i): DiffLine[] =>
      a[i] === text
        ? [{ kind: "same", text, line: i + 1 }]
        : [
            { kind: "removed", text: a[i]!, line: i + 1 },
            { kind: "added", text, line: i + 1 },
          ],
    );
  if (a.length * b.length > limit * limit)
    return [
      ...a.map((text, i) => ({ kind: "removed" as const, text, line: i + 1 })),
      ...b.map((text, i) => ({ kind: "added" as const, text, line: i + 1 })),
    ];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: b[j]!, line: j + 1 });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ kind: "added", text: b[j]!, line: j + 1 });
      j++;
    } else {
      lines.push({ kind: "removed", text: a[i]!, line: i + 1 });
      i++;
    }
  }
  return lines;
}

/** Changed lines with `context` unchanged lines around them; gaps become `null`. */
export function diffHunks(lines: readonly DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = lines.map((line) => line.kind !== "same");
  const near = lines.map((_, i) =>
    keep.slice(Math.max(0, i - context), i + context + 1).some(Boolean),
  );
  const out: (DiffLine | null)[] = [];
  lines.forEach((line, i) => {
    if (near[i]) out.push(line);
    else if (out.length && out.at(-1) !== null) out.push(null);
  });
  if (out.at(-1) === null) out.pop();
  return out;
}
