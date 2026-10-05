import {
  cleanName,
  extractBraced,
  identifier,
  named,
  skipModifiers,
  type DeclarationParser,
} from "./braced";
const modifiers = new Set([
  "public",
  "private",
  "protected",
  "internal",
  "open",
  "abstract",
  "override",
  "final",
  "suspend",
  "inline",
  "tailrec",
  "operator",
  "infix",
  "external",
  "lateinit",
  "inner",
  "expect",
  "actual",
  "data",
  "sealed",
  "annotation",
  "value",
  "const",
  "crossinline",
  "noinline",
  "reified",
]);
const parse: DeclarationParser = (context) => {
  const { value, index, scope } = context;
  let i = skipModifiers(context, modifiers);
  const prefixes = new Set(context.tokens.slice(index, i).map((token) => token.text));
  const enumClass = value(i) === "enum" && value(i + 1) === "class";
  if (enumClass || (value(i) === "fun" && value(i + 1) === "interface")) i++;
  if (value(i) === "class" || value(i) === "interface")
    return named(
      context,
      i + 1,
      enumClass ? "enum" : value(i) === "interface" ? "interface" : "class",
      enumClass ? "enum" : "type",
    );
  if (value(i) === "object" || (value(i) === "companion" && value(i + 1) === "object")) {
    const companion = value(i) === "companion";
    const nameIndex = identifier(value(i + (companion ? 2 : 1))) ? i + (companion ? 2 : 1) : i;
    return {
      nameIndex,
      name: nameIndex === i ? "companion" : cleanName(value(nameIndex)),
      kind: "class",
      detail: "object",
      body: context.bodyAfter(i + (companion ? 2 : 1)),
      scope: "type",
    };
  }
  if (value(i) === "fun") {
    const nameIndex = context.afterGenerics(i + 1);
    if (!identifier(value(nameIndex))) return null;
    let next = context.afterGenerics(nameIndex + 1);
    let name = cleanName(value(nameIndex));
    while (value(next) === "." && identifier(value(next + 1))) {
      name += "." + cleanName(value(next + 1));
      next = context.afterGenerics(next + 2);
    }
    return {
      nameIndex,
      name,
      kind: scope === "type" || scope === "enum" ? "method" : "function",
      body: context.bodyAfter(next),
    };
  }
  if (value(i) === "typealias") return named(context, i + 1, "type");
  if ((value(i) === "val" || value(i) === "var") && !(scope === "file" && prefixes.has("private")))
    return named(context, i + 1, prefixes.has("const") ? "constant" : "variable");
  if (scope === "enum" && identifier(value(i))) {
    return {
      nameIndex: i,
      kind: "constant",
      ...(value(i + 1) === "(" ? { next: (context.pairs.get(i + 1) ?? i + 1) + 1 } : {}),
    };
  }
  return null;
};
export const kotlinOutline = {
  languageId: "kotlin" as const,
  extract: (source: string) => extractBraced(source, "kotlin", parse),
};
