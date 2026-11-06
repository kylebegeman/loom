// @effect-diagnostics nodeBuiltinImport:off -- Dotenv parsing does not evaluate commands or expand the process environment.
import * as NodeUtil from "node:util";
import { parseEnvSource } from "../project-profiles/envInspector.ts";
import { HoppscotchInputError, nativeObject } from "./hoppscotch.ts";
import type { ApiVariable } from "./hoppscotch.ts";
function location(node: unknown): { start: number; end: number } | null {
  if (!node || typeof node !== "object" || !("_location" in node)) return null;
  const range = nativeObject(node._location);
  const start = nativeObject(range.start).offset;
  const end = nativeObject(range.end).offset;
  return typeof start === "number" && typeof end === "number" ? { start, end } : null;
}
export function updateDotenv(source: string, variables: readonly ApiVariable[]): string {
  const values = NodeUtil.parseEnv(source);
  const items = parseEnvSource(source).configItems;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const additions: string[] = [];
  for (const variable of variables) {
    const { key, value } = variable;
    if (!/^[A-Za-z_][A-Za-z\d_]*$/.test(key) || value.includes("\0"))
      throw HoppscotchInputError.new("invalid-format");
    if (values[key] === value) continue;
    const quote = ["'", "`", '"'].find((q) => !value.includes(q));
    if (!quote) throw HoppscotchInputError.new("invalid-format");
    const text = `${quote}${value}${quote}`;
    if (NodeUtil.parseEnv(`${key}=${text}\n`)[key] !== value)
      throw HoppscotchInputError.new("invalid-format");
    const item = items.findLast((i) => i.key === key);
    const valueRange = item?.value && "data" in item.value ? location(item.value.data) : null;
    if (valueRange) {
      const trailing = source.slice(valueRange.start, valueRange.end).match(/[\t ]+$/)?.[0] ?? "";
      edits.push({ ...valueRange, text: text + trailing });
    } else if (item) {
      const range = location(item.data);
      if (!range) throw HoppscotchInputError.new("invalid-format");
      const section = source.slice(range.start, range.end);
      const match = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=[\\t ]*`, "m").exec(
        section,
      );
      if (!match) throw HoppscotchInputError.new("invalid-format");
      const start = range.start + match.index + match[0].length;
      edits.push({ start, end: start, text });
    } else additions.push(`${key}=${text}`);
  }
  let result = source;
  for (const edit of edits.toSorted((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  if (additions.length)
    result += `${result.endsWith("\n") || !result ? "" : "\n"}${additions.join("\n")}\n`;
  return result;
}
