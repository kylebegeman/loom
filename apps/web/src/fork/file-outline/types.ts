export type OutlineLanguageId =
  | "typescript"
  | "javascript"
  | "swift"
  | "python"
  | "go"
  | "rust"
  | "kotlin"
  | "markdown";
export type OutlineSymbolKind =
  | "class"
  | "struct"
  | "enum"
  | "interface"
  | "protocol"
  | "trait"
  | "extension"
  | "impl"
  | "type"
  | "function"
  | "method"
  | "constant"
  | "variable"
  | "module"
  | "heading";
export interface OutlineSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: OutlineSymbolKind;
  readonly line: number;
  readonly depth: number;
  readonly detail?: string;
}
export interface OutlineResult {
  readonly languageId: OutlineLanguageId;
  readonly symbols: ReadonlyArray<OutlineSymbol>;
  readonly capped: boolean;
}
export interface OutlineExtractor {
  readonly languageId: OutlineLanguageId;
  readonly extract: (source: string) => ReadonlyArray<OutlineSymbol>;
}
export const MAX_OUTLINE_SYMBOLS = 2_000;

export function outlineSymbol(
  name: string,
  kind: OutlineSymbolKind,
  line: number,
  depth: number,
  detail?: string,
): OutlineSymbol {
  return {
    id: line + ":" + name,
    name,
    kind,
    line,
    depth: Math.min(8, depth),
    ...(detail ? { detail: detail.replace(/\s+/g, " ").slice(0, 60) } : {}),
  };
}
