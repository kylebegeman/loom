import {
  extractBraced,
  identifier,
  named,
  skipModifiers,
  type Declaration,
  type DeclarationParser,
} from "./braced";

const modifiers = new Set([
  "public",
  "private",
  "fileprivate",
  "internal",
  "open",
  "static",
  "final",
  "override",
  "mutating",
  "nonmutating",
  "nonisolated",
  "convenience",
  "required",
  "indirect",
  "lazy",
  "weak",
  "unowned",
  "distributed",
  "package",
  "borrowing",
  "consuming",
]);
const types = {
  class: "class",
  struct: "struct",
  enum: "enum",
  protocol: "protocol",
  extension: "extension",
  actor: "class",
} as const;
const parse: DeclarationParser = (context) => {
  let i = skipModifiers(context, modifiers);
  if (context.value(i) === "class" && context.value(i + 1) === "func") i++;
  const keyword = context.value(i);
  const type = Object.hasOwn(types, keyword) ? types[keyword as keyof typeof types] : undefined;
  if (type) return named(context, i + 1, type, type === "enum" ? "enum" : "type");
  if (keyword === "func")
    return named(
      context,
      i + 1,
      context.scope === "file" || context.scope === "module" ? "function" : "method",
    );
  if (["init", "deinit", "subscript"].includes(keyword))
    return { nameIndex: i, kind: "method", body: context.bodyAfter(i + 1) };
  if (keyword === "typealias") return named(context, i + 1, "type");
  if (["var", "let"].includes(keyword) && context.scope !== "file")
    return named(context, i + 1, keyword === "let" ? "constant" : "variable");
  if (keyword === "case" && context.scope === "enum") {
    const declarations: Declaration[] = [];
    for (
      let j = i + 1;
      j < context.end && context.tokens[j]!.line === context.tokens[i]!.line;
      j++
    ) {
      if (identifier(context.value(j)) && (j === i + 1 || context.value(j - 1) === ","))
        declarations.push({ nameIndex: j, kind: "constant" });
      if (context.value(j) === "(") j = context.pairs.get(j) ?? j;
      if (context.value(j) === "}") break;
    }
    return declarations.length ? declarations : null;
  }
  return null;
};
export const swiftOutline = {
  languageId: "swift" as const,
  extract: (source: string) => extractBraced(source, "swift", parse),
};
