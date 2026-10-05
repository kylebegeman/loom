import {
  extractBraced,
  identifier,
  named,
  skipModifiers,
  type Declaration,
  type DeclarationParser,
  type ParseContext,
} from "./braced";

const modifiers = new Set([
  "export",
  "default",
  "declare",
  "abstract",
  "public",
  "private",
  "protected",
  "static",
  "readonly",
  "override",
  "async",
  "get",
  "set",
  "accessor",
]);
const types = {
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  namespace: "module",
  module: "module",
} as const;

function initializer(
  context: ParseContext,
  nameIndex: number,
): { functionValue: boolean; body?: number | undefined; object: boolean } {
  const { value, pairs, afterGenerics, end, tokens } = context;
  let i = nameIndex + 1;
  for (; i < Math.min(end, nameIndex + 400); i++) {
    if (value(i) === "=") break;
    if (value(i) === ";" || value(i) === "}" || tokens[i]!.line > tokens[nameIndex]!.line + 10)
      return { functionValue: false, object: false };
    if (value(i) === "(" || value(i) === "[" || value(i) === "{") i = pairs.get(i) ?? i;
  }
  if (value(i) !== "=") return { functionValue: false, object: false };
  i++;
  if (value(i) === "async") i++;
  if (value(i) === "function")
    return { functionValue: true, object: false, body: context.bodyAfter(i + 1) };
  if (value(i) === "{") return { functionValue: false, object: true, body: i };
  i = afterGenerics(i);
  if (value(i) === "(") i = (pairs.get(i) ?? i) + 1;
  else if (identifier(value(i))) i++;
  else return { functionValue: false, object: false };
  if (value(i) === ":") {
    for (i++; i < Math.min(end, nameIndex + 400) && value(i) !== "=>"; i++) {
      if (value(i) === ";") break;
      if (value(i) === "{" || value(i) === "[" || value(i) === "(") i = pairs.get(i) ?? i;
    }
  }
  return value(i) === "=>"
    ? { functionValue: true, object: false, ...(value(i + 1) === "{" ? { body: i + 1 } : {}) }
    : { functionValue: false, object: false };
}

const parse: DeclarationParser = (context) => {
  const { value, scope, index, afterGenerics } = context;
  let i = skipModifiers(context, modifiers);
  if (value(i) === "const" && value(i + 1) === "enum") i++;
  const type = Object.hasOwn(types, value(i)) ? types[value(i) as keyof typeof types] : undefined;
  if (type)
    return named(
      context,
      i + 1,
      type,
      type === "module" ? "module" : type === "enum" ? "enum" : "type",
    );
  if (value(i) === "function") {
    const nameIndex = value(i + 1) === "*" ? i + 2 : i + 1;
    return named(context, nameIndex, scope === "type" ? "method" : "function");
  }
  if (["const", "let", "var"].includes(value(i))) {
    const nameIndex = i + 1;
    if (!identifier(value(nameIndex))) return null;
    const init = initializer(context, nameIndex);
    const exported = Array.from({ length: i - index }, (_, n) => value(index + n)).includes(
      "export",
    );
    if (!init.functionValue && !exported) return null;
    return {
      nameIndex,
      kind: init.functionValue ? "function" : value(i) === "const" ? "constant" : "variable",
      body: init.body,
      scope: init.object ? "type" : undefined,
    };
  }
  if (scope !== "type") return null;
  const privateName = value(i) === "#";
  const nameIndex = privateName ? i + 1 : i;
  if (!identifier(value(nameIndex))) return null;
  let next = afterGenerics(nameIndex + 1);
  if (value(next) === "?") next++;
  if (value(next) === "(")
    return {
      ...named(context, nameIndex, "method"),
      nameIndex,
      kind: "method",
      name: (privateName ? "#" : "") + value(nameIndex),
    } satisfies Declaration;
  const init = initializer(context, nameIndex);
  if (init.functionValue) return { nameIndex, kind: "method", body: init.body };
  // Object-literal arrow members use ':' rather than '='.
  if (value(nameIndex + 1) === ":") {
    let start = nameIndex + 2;
    if (value(start) === "async") start++;
    const end = value(start) === "(" ? (context.pairs.get(start) ?? start) + 1 : start + 1;
    if (value(end) === "=>")
      return { nameIndex, kind: "method", body: value(end + 1) === "{" ? end + 1 : undefined };
  }
  return null;
};

export const typescriptOutline = {
  languageId: "typescript" as const,
  extract: (source: string) => extractBraced(source, "typescript", parse),
};
export const javascriptOutline = {
  languageId: "javascript" as const,
  extract: (source: string) => extractBraced(source, "javascript", parse),
};
