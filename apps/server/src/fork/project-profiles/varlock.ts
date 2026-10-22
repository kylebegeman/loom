import { ProjectProfileError, type VarlockValidation } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

export function buildVarlockCommandLine(
  command: string,
  os: string,
  schemaPath = ".env.schema",
): string {
  if (os === "win32" || os === "windows") {
    if (/[&|<>^%\r\n`$()]/.test(command) || /[&|<>^%\r\n`$()"]/.test(schemaPath))
      throw new ProjectProfileError({ reason: "unsupported-platform" });
    return `varlock run${schemaPath === ".env.schema" ? "" : ` --path "${schemaPath}"`} -- ${command}`;
  }
  return `varlock run${schemaPath === ".env.schema" ? "" : ` --path '${schemaPath.replaceAll("'", "'\\''")}'`} -- sh -c '${command.replaceAll("'", "'\\''")}'`;
}
const Graph = Schema.Struct({
  config: Schema.Record(Schema.String, Schema.Unknown),
  errors: Schema.optionalKey(
    Schema.Struct({
      configItems: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      root: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
});
const decodeGraph = Schema.decodeUnknownSync(Graph);
export function extractVarlockErrors(json: unknown, durationMs: number): VarlockValidation {
  const graph = decodeGraph(json);
  const values = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      if (text) values.add(text);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(graph.config);
  const secrets = [...values].sort((a, b) => b.length - a.length);
  const sanitize = (value: unknown): string => {
    // Unknown error objects can carry additional config fields. Only known text is retained.
    const text =
      typeof value === "string"
        ? value
        : value &&
            typeof value === "object" &&
            "message" in value &&
            typeof value.message === "string"
          ? value.message
          : "Configuration validation failed.";
    return secrets
      .reduce((result, secret) => result.replaceAll(secret, "[value]"), text)
      .slice(0, 1000);
  };
  const itemErrors = Object.fromEntries(
    Object.entries(graph.errors?.configItems ?? {})
      .slice(0, 1000)
      .map(([key, errors]) => [
        key,
        (Array.isArray(errors) ? errors : [errors]).map(sanitize).join("; "),
      ]),
  );
  const rootErrors = (graph.errors?.root ?? []).slice(0, 50).map(sanitize);
  return {
    ok: Object.keys(itemErrors).length === 0 && rootErrors.length === 0,
    itemErrors,
    rootErrors,
    durationMs,
  };
}
