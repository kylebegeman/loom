const LIBRARY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const LIBRARY_CACHE_ENTRY_MAX_BYTES = 8 * 1024 * 1024;
const LIBRARY_CACHE_MAX_ENTRIES = 200;
export const LIBRARY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export interface CachedQuery {
  readonly payload: string;
  readonly bytes: number;
  readonly savedAt: number;
}
export function cachedQuery(value: unknown): CachedQuery | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<CachedQuery>;
  return typeof row.payload === "string" &&
    typeof row.bytes === "number" &&
    Number.isFinite(row.bytes) &&
    row.bytes >= 0 &&
    typeof row.savedAt === "number" &&
    Number.isFinite(row.savedAt)
    ? (row as CachedQuery)
    : null;
}
export function queryCacheRemovals(
  entries: readonly { readonly key: IDBValidKey; readonly value: unknown }[],
  now: number,
): IDBValidKey[] {
  const remove: IDBValidKey[] = [];
  const retained: { key: IDBValidKey; value: CachedQuery }[] = [];
  for (const entry of entries) {
    const value = cachedQuery(entry.value);
    if (
      value === null ||
      value.bytes > LIBRARY_CACHE_ENTRY_MAX_BYTES ||
      now - value.savedAt > LIBRARY_CACHE_MAX_AGE_MS
    )
      remove.push(entry.key);
    else retained.push({ key: entry.key, value });
  }
  retained.sort((a, b) => b.value.savedAt - a.value.savedAt);
  let bytes = 0;
  for (let index = 0; index < retained.length; index++) {
    const entry = retained[index]!;
    bytes += entry.value.bytes;
    if (index >= LIBRARY_CACHE_MAX_ENTRIES || bytes > LIBRARY_CACHE_MAX_BYTES)
      remove.push(entry.key);
  }
  return remove;
}
