import { extractOutline, type OutlineResult } from "./outline";

/** The column and palette share one result, without retaining previously opened files. */
export function createOutlineCache() {
  let cached: { path: string; contents: string; result: OutlineResult | null } | null = null;
  return (path: string, contents: string) => {
    if (cached?.path === path && cached.contents === contents) return cached.result;
    const result = extractOutline(path, contents);
    cached = { path, contents, result };
    return result;
  };
}
export const outlineFor = createOutlineCache();
