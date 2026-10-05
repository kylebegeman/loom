import { goOutline } from "./languages/go";
import { kotlinOutline } from "./languages/kotlin";
import { markdownOutline } from "./languages/markdown";
import { pythonOutline } from "./languages/python";
import { rustOutline } from "./languages/rust";
import { swiftOutline } from "./languages/swift";
import { javascriptOutline, typescriptOutline } from "./languages/typescript";
import {
  MAX_OUTLINE_SYMBOLS,
  type OutlineExtractor,
  type OutlineLanguageId,
  type OutlineResult,
} from "./types";
export * from "./types";

const extensions: Readonly<Record<string, OutlineLanguageId>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  swift: "swift",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
};
const extractors: Readonly<Record<OutlineLanguageId, OutlineExtractor>> = {
  typescript: typescriptOutline,
  javascript: javascriptOutline,
  swift: swiftOutline,
  python: pythonOutline,
  go: goOutline,
  rust: rustOutline,
  kotlin: kotlinOutline,
  markdown: markdownOutline,
};
const reportedErrors = new Set<string>();

export function outlineLanguageForPath(path: string): OutlineLanguageId | null {
  const name = path.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const extension = name.slice(dot + 1).toLowerCase();
  return dot < 0 || !Object.hasOwn(extensions, extension) ? null : (extensions[extension] ?? null);
}

/** An extractor failure must never take down the file viewer. */
export function extractOutline(
  path: string,
  source: string,
  extractor?: OutlineExtractor,
): OutlineResult | null {
  const languageId = outlineLanguageForPath(path);
  if (languageId === null) return null;
  try {
    const symbols = (extractor ?? extractors[languageId]).extract(source);
    const usedIds = new Map<string, number>();
    const uniqueSymbols = symbols.slice(0, MAX_OUTLINE_SYMBOLS).map((symbol) => {
      const count = usedIds.get(symbol.id) ?? 0;
      usedIds.set(symbol.id, count + 1);
      return count === 0 ? symbol : { ...symbol, id: symbol.id + ":" + count };
    });
    return {
      languageId,
      symbols: uniqueSymbols,
      capped: symbols.length > MAX_OUTLINE_SYMBOLS,
    };
  } catch (error) {
    if (!reportedErrors.has(path)) {
      if (reportedErrors.size >= 100) reportedErrors.clear();
      reportedErrors.add(path);
      console.warn("Could not extract file outline", path, error);
    }
    return { languageId, symbols: [], capped: false };
  }
}
