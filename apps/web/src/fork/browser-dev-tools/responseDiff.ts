import type { DevHttpExchange } from "@t3tools/contracts/fork";
const missing = Symbol("missing");
const escape = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
export function sameEndpoint(
  a: Pick<DevHttpExchange["request"], "method" | "url">,
  b: Pick<DevHttpExchange["request"], "method" | "url">,
) {
  try {
    return a.method === b.method && new URL(a.url).pathname === new URL(b.url).pathname;
  } catch {
    return false;
  }
}
export function compareResponses(
  before: Pick<DevHttpExchange, "status" | "headers" | "body">,
  after: Pick<DevHttpExchange, "status" | "headers" | "body">,
  ignored: readonly string[],
) {
  const changes: { path: string; before: string; after: string }[] = [];
  const display = (value: unknown) => {
    if (value === missing) return "(missing)";
    try {
      return JSON.stringify(value);
    } catch {
      return "(value is too deeply nested to display)";
    }
  };
  const visit = (before: unknown, after: unknown, root: string) => {
    const pending = [{ a: before, b: after, path: root }];
    while (pending.length && changes.length < 1000) {
      const { a, b, path } = pending.pop()!;
      if (a === b || ignored.some((p) => p && (path === p || path.startsWith(`${p}/`)))) continue;
      if (
        a &&
        b &&
        typeof a === "object" &&
        typeof b === "object" &&
        Array.isArray(a) === Array.isArray(b)
      ) {
        const left = a as Record<string, unknown>,
          right = b as Record<string, unknown>;
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
        for (const key of keys.reverse())
          pending.push({
            a: Object.hasOwn(left, key) ? left[key] : missing,
            b: Object.hasOwn(right, key) ? right[key] : missing,
            path: `${path}/${escape(key)}`,
          });
      } else changes.push({ path, before: display(a) ?? "", after: display(b) ?? "" });
    }
  };
  const body = (e: Pick<DevHttpExchange, "body">): unknown => {
    try {
      return JSON.parse(e.body);
    } catch {
      return e.body;
    }
  };
  visit(before.status, after.status, "/status");
  visit(before.headers, after.headers, "/headers");
  visit(body(before), body(after), "/body");
  return changes;
}
