import { extractBraced, identifier, named, skipModifiers, type DeclarationParser } from "./braced";
const modifiers = new Set(["pub", "async", "unsafe", "extern", "default"]);
const types = {
  struct: "struct",
  enum: "enum",
  trait: "trait",
  mod: "module",
  type: "type",
} as const;
const parse: DeclarationParser = (context) => {
  const { value } = context;
  let i = skipModifiers(context, modifiers);
  if (value(i) === "const" && value(i + 1) === "fn") i++;
  const type = Object.hasOwn(types, value(i)) ? types[value(i) as keyof typeof types] : undefined;
  if (type) return named(context, i + 1, type, type === "module" ? "module" : "type");
  if (value(i) === "fn")
    return named(context, i + 1, context.scope === "type" ? "method" : "function");
  if (value(i) === "impl") {
    const nameIndex = context.afterGenerics(i + 1);
    if (!identifier(value(nameIndex))) return null;
    let next = context.afterGenerics(nameIndex + 1);
    let name = value(nameIndex);
    if (value(next) === "for") name += " for " + value(++next);
    return { nameIndex, name, kind: "impl", body: context.bodyAfter(next), scope: "type" };
  }
  if (value(i) === "const" || value(i) === "static") {
    const nameIndex = value(i + 1) === "mut" ? i + 2 : i + 1;
    return named(context, nameIndex, value(i) === "const" ? "constant" : "variable");
  }
  if (value(i) === "macro_rules" && value(i + 1) === "!") return named(context, i + 2, "function");
  return null;
};
export const rustOutline = {
  languageId: "rust" as const,
  extract: (source: string) => extractBraced(source, "rust", parse),
};
