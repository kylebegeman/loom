import type { DevApiWorkflow, DevHttpExchange } from "@t3tools/contracts/fork";
export function workflowValue(
  exchange: DevHttpExchange,
  source: "body" | "header" | "status",
  path: string,
): unknown {
  if (source === "status") return exchange.status;
  if (source === "header") return exchange.headers[path.toLowerCase()];
  let value: unknown;
  try {
    value = JSON.parse(exchange.body);
  } catch {
    return path ? undefined : exchange.body;
  }
  if (path && !path.startsWith("/")) return undefined;
  for (const part of path ? path.slice(1).split("/") : []) {
    if (!value || typeof value !== "object") return undefined;
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    value = Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
  }
  return value;
}
export function workflowChecks(
  exchange: DevHttpExchange,
  assertions: DevApiWorkflow["steps"][number]["assertions"],
) {
  return assertions.map((assertion) => {
    const value = workflowValue(exchange, assertion.source, assertion.path);
    const actual = typeof value === "string" ? value : JSON.stringify(value);
    return {
      name: assertion.key,
      passed:
        assertion.operator === "exists"
          ? value !== undefined && value !== null
          : assertion.operator === "contains"
            ? actual?.includes(assertion.expected) === true
            : actual === assertion.expected,
    };
  });
}
