import { scanSource } from "../scanner";
import {
  MAX_OUTLINE_SYMBOLS,
  outlineSymbol,
  type OutlineLanguageId,
  type OutlineSymbol,
  type OutlineSymbolKind,
} from "../types";

export interface Token {
  readonly text: string;
  readonly line: number;
  readonly offset: number;
}
export type Scope = "file" | "type" | "enum" | "module" | "go-type" | "go-const" | "go-var";
export interface Declaration {
  readonly nameIndex: number;
  readonly name?: string;
  readonly kind: OutlineSymbolKind;
  readonly body?: number | undefined;
  readonly scope?: Scope | undefined;
  readonly next?: number | undefined;
  readonly detail?: string | undefined;
}
export interface ParseContext {
  readonly tokens: ReadonlyArray<Token>;
  readonly index: number;
  readonly scope: Scope;
  readonly end: number;
  readonly pairs: ReadonlyMap<number, number>;
  readonly value: (index: number) => string;
  readonly afterGenerics: (index: number) => number;
  readonly bodyAfter: (index: number) => number | undefined;
}
export type DeclarationParser = (
  context: ParseContext,
) => Declaration | ReadonlyArray<Declaration> | null;
export const identifier = (value: string) =>
  /^(?:r#)?[\p{L}_$][\p{L}\p{N}_$]*$|^\x60[^\x60]+\x60$/u.test(value);
export const cleanName = (value: string) => value.replace(/^\x60|\x60$/g, "").replace(/^r#/, "");

const declarationStarts = new Set([
  "class",
  "struct",
  "interface",
  "enum",
  "protocol",
  "extension",
  "actor",
  "func",
  "fun",
  "fn",
  "function",
  "const",
  "let",
  "var",
  "val",
  "type",
  "typealias",
  "export",
  "public",
  "private",
  "pub",
  "impl",
  "mod",
  "trait",
  "static",
  "async",
  "@",
]);

export function skipModifiers(context: ParseContext, modifiers: ReadonlySet<string>): number {
  let i = context.index;
  while (i < context.end) {
    if (context.value(i) === "@") {
      i += 2;
      while (context.value(i) === "." && identifier(context.value(i + 1))) i += 2;
      if (context.value(i) === "(") i = (context.pairs.get(i) ?? i) + 1;
    } else if (context.value(i) === "#" && context.value(i + 1) === "[") {
      i = (context.pairs.get(i + 1) ?? i + 1) + 1;
    } else if (modifiers.has(context.value(i))) {
      const modifier = context.value(i++);
      if (
        (modifier === "pub" ||
          modifier === "nonisolated" ||
          modifier === "private" ||
          modifier === "internal") &&
        context.value(i) === "("
      )
        i = (context.pairs.get(i) ?? i) + 1;
    } else break;
  }
  return i;
}

export function named(
  context: ParseContext,
  nameIndex: number,
  kind: OutlineSymbolKind,
  scope?: Scope,
): Declaration | null {
  if (!identifier(context.value(nameIndex))) return null;
  return { nameIndex, kind, body: context.bodyAfter(nameIndex + 1), scope };
}

/** Walks declaration-owned scopes; all other braces and parameter lists are skipped. */
export function extractBraced(
  source: string,
  language: OutlineLanguageId,
  parse: DeclarationParser,
): OutlineSymbol[] {
  const { masked, comments } = scanSource(source, language);
  const tokens: Token[] = [];
  let line = 1,
    cursor = 0;
  for (const match of masked.matchAll(
    /(?:r#)?[\p{L}_$][\p{L}\p{N}_$]*|\x60[^\x60\r\n]+\x60|=>|->|::|[^\s]/gu,
  )) {
    while (cursor < match.index) if (source[cursor++] === "\n") line++;
    tokens.push({ text: match[0], offset: match.index, line });
  }
  if (language === "swift") {
    let commentCursor = 0,
      commentLine = 1;
    for (const comment of comments) {
      while (commentCursor < comment.start) if (source[commentCursor++] === "\n") commentLine++;
      const mark = /^\/\/\s*MARK:\s*(?:-\s*)?(.+?)\s*$/.exec(comment.text);
      if (mark)
        tokens.push({ text: "// MARK:" + mark[1], offset: comment.start, line: commentLine });
    }
    tokens.sort((a, b) => a.offset - b.offset);
  }
  const pairs = new Map<number, number>();
  const stacks: Record<string, number[]> = { "(": [], "[": [], "{": [] };
  const opening: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  tokens.forEach((token, index) => {
    if (Object.hasOwn(stacks, token.text)) stacks[token.text]!.push(index);
    else if (Object.hasOwn(opening, token.text)) {
      const start = stacks[opening[token.text]!]!.pop();
      if (start !== undefined) pairs.set(start, index);
    }
  });
  const value = (index: number) => tokens[index]?.text ?? "";
  const afterGenerics = (index: number): number => {
    if (value(index) !== "<") return index;
    let depth = 0;
    for (let i = index; i < Math.min(tokens.length, index + 400); i++) {
      if (value(i) === "<") depth++;
      if (value(i) === ">" && --depth === 0) return i + 1;
    }
    return index;
  };
  const symbols: OutlineSymbol[] = [];
  const walk = (start: number, end: number, scope: Scope, depth: number) => {
    if (depth > 32) return;
    const bodyAfter = (startIndex: number): number | undefined => {
      const firstLine = tokens[startIndex - 1]?.line ?? 0;
      for (let i = startIndex; i < Math.min(end, startIndex + 400); i++) {
        const text = value(i);
        if (text === "{") {
          // A TS return type can itself be an object, followed by the real body.
          const close = pairs.get(i);
          if (
            value(i - 1) === ":" &&
            close !== undefined &&
            (value(close + 1) === "{" || value(close + 1) === "=>")
          )
            return value(close + 1) === "{" ? close + 1 : close + 2;
          return i;
        }
        if (text === ";" || text === "=" || text === "}" || text.startsWith("// MARK:")) return;
        if (tokens[i]!.line > firstLine && declarationStarts.has(text)) return;
        if (text === "(" || text === "[") i = pairs.get(i) ?? i;
      }
    };
    for (let i = start; i < end && symbols.length <= MAX_OUTLINE_SYMBOLS; i++) {
      const token = tokens[i]!;
      if (token.text.startsWith("// MARK:")) {
        symbols.push(outlineSymbol(token.text.slice(8), "heading", token.line, depth));
        continue;
      }
      const previous = tokens[i - 1];
      const statementStart =
        i === start ||
        [";", "}", "{"].includes(previous?.text ?? "") ||
        (["enum", "type"].includes(scope) && previous?.text === ",") ||
        (token.line > (previous?.line ?? 0) &&
          !["=", ".", ",", "=>", ":", "->"].includes(previous?.text ?? ""));
      const declaration = statementStart
        ? parse({ tokens, index: i, scope, end, pairs, value, afterGenerics, bodyAfter })
        : null;
      if (declaration) {
        const declarations = Array.isArray(declaration) ? declaration : [declaration];
        for (const item of declarations) {
          const nameToken = tokens[item.nameIndex]!;
          symbols.push(
            outlineSymbol(
              item.name ?? cleanName(nameToken.text),
              item.kind,
              nameToken.line,
              depth,
              item.detail,
            ),
          );
          if (item.body !== undefined && item.scope) {
            const close = pairs.get(item.body) ?? end;
            walk(item.body + 1, close, item.scope, depth + 1);
          }
        }
        const last = declarations.at(-1)!;
        i = Math.max(
          i,
          last.next !== undefined
            ? last.next - 1
            : last.body !== undefined
              ? (pairs.get(last.body) ?? end)
              : last.nameIndex,
        );
      } else if (token.text === "(" || token.text === "[" || token.text === "{") {
        // Go declaration groups recurse without creating a visible parent.
        if (
          language === "go" &&
          token.text === "(" &&
          ["type", "const", "var"].includes(previous?.text ?? "")
        ) {
          walk(i + 1, pairs.get(i) ?? end, ("go-" + previous!.text) as Scope, depth);
        }
        i = pairs.get(i) ?? end;
      }
    }
  };
  walk(0, tokens.length, "file", 0);
  return symbols;
}
