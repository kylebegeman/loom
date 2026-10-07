// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
export const cacheKey = (
  source: string,
  overrides: Readonly<Record<string, string>>,
  set: string | null,
  sidecar: string,
  version: string | null,
  backend: string,
  format: string,
  dependencies: ReadonlyArray<readonly [string, string]>,
) =>
  NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify([
        source,
        Object.entries(overrides).toSorted(([a], [b]) => a.localeCompare(b)),
        set,
        sidecar,
        version,
        backend,
        format,
        dependencies.toSorted(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
export function pruneList(
  entries: ReadonlyArray<{ path: string; size: number; modified: number }>,
  maxCount = 300,
  maxBytes = 1024 * 1024 * 1024,
): string[] {
  const sorted = entries.toSorted((a, b) => b.modified - a.modified);
  let bytes = 0;
  return sorted.flatMap((entry, i) => {
    bytes += entry.size;
    return i >= maxCount || bytes > maxBytes ? [entry.path] : [];
  });
}

/** Keep immutable outputs protected until every concurrent reader releases them. */
export function createStemProtection() {
  const counts = new Map<string, number>();
  return {
    stems: () => counts.keys(),
    acquire(stem: string) {
      counts.set(stem, (counts.get(stem) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = counts.get(stem) ?? 0;
        if (count <= 1) counts.delete(stem);
        else counts.set(stem, count - 1);
      };
    },
  };
}
