import type { ScadParameter } from "@t3tools/contracts/fork";

export function literalValue(literal: string): unknown {
  const text = literal.trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value)) return value;
  }
  if (text === "true" || text === "false") return text === "true";
  if (text.startsWith('"') && text.endsWith('"')) {
    const value: unknown = JSON.parse(text);
    if (typeof value === "string") return value;
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const value: unknown = JSON.parse(text);
    if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every(
        (v) =>
          typeof v === "string" ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)),
      )
    )
      return value;
  }
  throw new Error("Expected an OpenSCAD literal");
}
export function validateLiteral(kind: ScadParameter["kind"], literal: string): boolean {
  try {
    const value = literalValue(literal);
    return kind === "vector" ? Array.isArray(value) : typeof value === kind;
  } catch {
    return false;
  }
}
export function parseCustomizer(source: string): ScadParameter[] {
  const parameters: ScadParameter[] = [];
  let group = "",
    description: string | null = null,
    hidden = false;
  let depth = 0,
    blockComment = false;
  for (const originalLine of source.split(/\r?\n/)) {
    let line = originalLine;
    const tab = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\//.exec(line);
    if (tab && !blockComment) {
      group = tab[1] ?? "";
      hidden = group === "Hidden";
      description = null;
      continue;
    }
    // Strip block comments with a small scanner so braces and assignments inside them are inert.
    let codeLine = "",
      quoted = false,
      escaped = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!,
        next = line[i + 1];
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          i++;
          codeLine += " ";
        }
        continue;
      }
      if (!quoted && char === "/" && next === "*") {
        blockComment = true;
        i++;
        continue;
      }
      codeLine += char;
      if (char === '"' && !escaped) quoted = !quoted;
      if (!quoted && char === "/" && next === "/") {
        codeLine += line.slice(i + 1);
        break;
      }
      escaped = char === "\\" && !escaped;
    }
    line = codeLine;
    if (/^\s*(module|function)\s+[a-zA-Z_$]/.test(line)) break;
    if (/^\s*\/\//.test(line)) {
      description = line.replace(/^\s*\/\/\s*/, "").trim() || null;
      continue;
    }
    const match =
      depth === 0 ? /^\s*([A-Za-z_$][\w$]*)\s*=\s*(.*?)\s*;\s*(?:\/\/\s*(.*))?$/.exec(line) : null;
    if (match && !hidden) {
      const name = match[1]!,
        value = match[2]!,
        hint = match[3] ?? "";
      try {
        const parsed = literalValue(value);
        const kind = Array.isArray(parsed) ? "vector" : typeof parsed;
        if (kind !== "vector" && kind !== "number" && kind !== "boolean" && kind !== "string")
          continue;
        let range: ScadParameter["range"] = null,
          options: ScadParameter["options"] = null;
        const spec = /\[([^\]]+)\]/.exec(hint)?.[1];
        if (spec) {
          const numbers = spec.split(":").map(Number);
          if (
            kind === "number" &&
            !spec.includes(",") &&
            (numbers.length === 2 || numbers.length === 3) &&
            numbers.every(Number.isFinite)
          ) {
            range = {
              min: numbers[0]!,
              max: numbers.at(-1)!,
              step: numbers.length === 3 ? numbers[1]! : null,
            };
          } else {
            options = spec
              .split(",")
              .map((item) => {
                const [raw, ...label] = item.trim().split(":");
                const option =
                  kind === "string" ? JSON.stringify(raw!.replace(/^"|"$/g, "")) : raw!;
                return { value: option, label: label.join(":").trim() || raw! };
              })
              .filter((option) => validateLiteral(kind, option.value));
          }
        }
        parameters.push({ name, group, description, kind, defaultValue: value, range, options });
      } catch {
        /* Expressions are not customizer parameters. */
      }
    }
    // Only top-level assignments are customizer inputs. Strings/comments do not affect depth.
    const code = line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, "");
    depth += (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
    description = null;
  }
  return parameters;
}
