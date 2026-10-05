import { maskSource } from "../scanner";
import { MAX_OUTLINE_SYMBOLS, outlineSymbol } from "../types";
export const pythonOutline = {
  languageId: "python" as const,
  extract(source: string) {
    const lines = maskSource(source, "python").split("\n");
    const symbols = [];
    const scopes: { indent: number; function: boolean }[] = [];
    let brackets = 0;
    for (let index = 0; index < lines.length && symbols.length <= MAX_OUTLINE_SYMBOLS; index++) {
      const line = lines[index]!;
      const text = line.trim();
      if (!text) continue;
      const continuation = brackets > 0;
      for (const char of line) {
        if ("([{".includes(char)) brackets++;
        else if (")]}".includes(char)) brackets = Math.max(0, brackets - 1);
      }
      if (continuation) continue;
      const whitespace = /^\s*/.exec(line)![0].replace(/\t/g, "        ");
      const indent = whitespace.length;
      while (scopes.length && indent <= scopes.at(-1)!.indent) scopes.pop();
      if (scopes.some((scope) => scope.function)) continue;
      const declaration = /^(class|(?:async\s+)?def)\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(text);
      if (declaration) {
        const isFunction = declaration[1] !== "class";
        symbols.push(
          outlineSymbol(
            declaration[2]!,
            isFunction ? (scopes.length ? "method" : "function") : "class",
            index + 1,
            scopes.length,
          ),
        );
        scopes.push({ indent, function: isFunction });
      } else if (scopes.length === 0) {
        const constant = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/.exec(text);
        if (constant) symbols.push(outlineSymbol(constant[1]!, "constant", index + 1, 0));
      }
    }
    return symbols;
  },
};
