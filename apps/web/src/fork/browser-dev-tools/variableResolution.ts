import type { DevApiVariable } from "@t3tools/contracts/fork";
import { draftRows, draftText } from "./apiRequestDraft";
export function explainVariables(
  request: Record<string, unknown>,
  inherited: readonly DevApiVariable[],
  environment: readonly DevApiVariable[],
  environmentName: string,
) {
  const definitions = new Map(environment.map((v) => [v.key, { ...v, source: environmentName }]));
  for (const v of inherited) definitions.set(v.key, { ...v, source: "Collection variable" });
  for (const v of draftRows(request.requestVariables)) {
    if (v.active === false) continue;
    const key = draftText(v.key);
    const value =
      v.secret === true
        ? draftText(v.currentValue)
        : draftText(v.currentValue) || draftText(v.initialValue) || draftText(v.value);
    definitions.set(key, { key, value, secret: v.secret === true, source: "Request variable" });
  }
  const created = new Set<string>();
  for (const script of [request.preRequestScript, request.testScript])
    for (const match of draftText(script).matchAll(/pw\.env\.set\(\s*["']([^"']+)["']/g))
      created.add(match[1]!);
  const references = (text: string) => Array.from(text.matchAll(/<<([^<>]+)>>/g), (m) => m[1]!);
  const keys = new Set(references(JSON.stringify(request)));
  const pending = [...keys];
  for (let i = 0; i < pending.length && i < 1000; i++) {
    for (const key of references(definitions.get(pending[i]!)?.value ?? "")) {
      if (!keys.has(key)) {
        keys.add(key);
        pending.push(key);
      }
    }
  }
  const inspect = (key: string, seen = new Set<string>()): string => {
    if (seen.has(key) || seen.size > 30) return "Circular reference";
    const v = definitions.get(key);
    if (v?.vault) return "Supplied by Vault when sending";
    if (!v?.value) return created.has(key) ? "Set by a script at runtime" : "Missing value";
    for (const dependency of references(v.value)) {
      const result = inspect(dependency, new Set([...seen, key]));
      if (result !== "Ready" && result !== "Supplied by Vault when sending")
        return `${dependency}: ${result}`;
    }
    return "Ready";
  };
  return [...keys].sort().map((key) => {
    const v = definitions.get(key);
    return {
      key,
      source: v?.vault
        ? "Vault binding"
        : (v?.source ?? (created.has(key) ? "Script" : environmentName)),
      status: inspect(key),
      secret: v?.secret || Boolean(v?.vault),
      value: v?.secret || v?.vault ? "" : (v?.value ?? ""),
      request: v?.source === "Request variable",
    };
  });
}
