import { outlineSymbol } from "../types";
import { cleanName, extractBraced, identifier, named, type DeclarationParser } from "./braced";

const parse: DeclarationParser = (context) => {
  const { value, index: i, scope } = context;
  const keyword = value(i);
  if (keyword === "type" || scope === "go-type") {
    const nameIndex = scope === "go-type" ? i : i + 1;
    const next = context.afterGenerics(nameIndex + 1);
    if (!identifier(value(nameIndex))) return null;
    return named(
      context,
      nameIndex,
      value(next) === "struct" ? "struct" : value(next) === "interface" ? "interface" : "type",
      "type",
    );
  }
  if (["const", "var"].includes(keyword) || scope === "go-const" || scope === "go-var") {
    const nameIndex = scope.startsWith("go-") ? i : i + 1;
    return identifier(value(nameIndex))
      ? { nameIndex, kind: keyword === "const" || scope === "go-const" ? "constant" : "variable" }
      : null;
  }
  if (keyword === "func") {
    let nameIndex = i + 1;
    let receiver = "";
    if (value(nameIndex) === "(") {
      const end = context.pairs.get(nameIndex);
      if (end === undefined) return null;
      const words = context.tokens
        .slice(nameIndex + 1, end)
        .filter((token) => identifier(token.text));
      receiver = cleanName(words[1]?.text ?? words[0]?.text ?? "");
      nameIndex = end + 1;
    }
    const declaration = named(context, nameIndex, receiver ? "method" : "function");
    return declaration && receiver
      ? { ...declaration, name: "(" + receiver + ")." + value(nameIndex) }
      : declaration;
  }
  if (scope === "type" && identifier(keyword) && value(i + 1) === "(")
    return named(context, i, "method");
  return null;
};
export const goOutline = {
  languageId: "go" as const,
  extract(source: string) {
    const symbols = extractBraced(source, "go", parse);
    const typeNames = new Set(
      symbols
        .filter((symbol) => ["struct", "interface", "type"].includes(symbol.kind))
        .map((symbol) => symbol.name),
    );
    const methods = new Map<string, typeof symbols>();
    const flat = symbols.filter((symbol) => {
      const receiver = /^\(([^)]+)\)\.(.+)$/.exec(symbol.name);
      if (!receiver || !typeNames.has(receiver[1]!)) return true;
      const group = methods.get(receiver[1]!) ?? [];
      group.push(outlineSymbol(receiver[2]!, symbol.kind, symbol.line, 1, symbol.detail));
      methods.set(receiver[1]!, group);
      return false;
    });
    return flat.flatMap((symbol, index) => {
      if (flat[index + 1]?.depth !== 0 && flat[index + 1] !== undefined) return [symbol];
      let parent = symbol;
      for (let i = index; parent.depth > 0 && i > 0; i--) parent = flat[i - 1]!;
      return [symbol, ...(methods.get(parent.name) ?? [])];
    });
  },
};
