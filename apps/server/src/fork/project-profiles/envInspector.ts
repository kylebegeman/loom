import {
  parseEnvSpecDotEnvFile,
  ParsedEnvSpecArrayLiteral,
  ParsedEnvSpecFunctionArgs,
  ParsedEnvSpecFunctionCall,
  ParsedEnvSpecStaticValue,
  type ParsedEnvSpecDecorator,
  type ParsedEnvSpecFile,
  type ParsedEnvSpecConfigItemValue,
} from "@env-spec/parser";
import type { EnvItem, EnvItemStatus, EnvReport } from "@t3tools/contracts/fork";

export interface EnvSource {
  readonly path: string;
  readonly source: string;
}
export interface EnvInspectionInput {
  readonly root: string;
  readonly schemaPath: string;
  readonly schemaSource: string | null;
  readonly imports?: ReadonlyArray<EnvSource>;
  readonly envSources: ReadonlyArray<EnvSource>;
  readonly processEnv: Readonly<Record<string, string | undefined>>;
}
const staticText = (node: unknown): string | undefined => {
  if (!(node instanceof ParsedEnvSpecStaticValue)) return undefined;
  const value: unknown = node.unescapedValue;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : undefined;
};
const args = (node: unknown): ReadonlyArray<unknown> =>
  node instanceof ParsedEnvSpecFunctionCall
    ? node.data.args.values
    : node instanceof ParsedEnvSpecFunctionArgs || node instanceof ParsedEnvSpecArrayLiteral
      ? node.values
      : [];
const decoratorText = (decorator: ParsedEnvSpecDecorator | undefined) =>
  staticText(decorator?.value);
const location = (value: unknown): { line: number; column: number } => {
  if (typeof value !== "object" || value === null || !("start" in value))
    return { line: 1, column: 1 };
  const start = value.start;
  return typeof start === "object" &&
    start !== null &&
    "line" in start &&
    typeof start.line === "number" &&
    "column" in start &&
    typeof start.column === "number"
    ? { line: start.line, column: start.column }
    : { line: 1, column: 1 };
};
export function parseEnvSource(source: string): ParsedEnvSpecFile {
  return parseEnvSpecDotEnvFile(source);
}
export function envImports(file: ParsedEnvSpecFile): string[] {
  return file.decoratorsArray
    .filter((d) => d.name === "import")
    .flatMap((d) => {
      const direct = staticText(d.value);
      return direct === undefined ? args(d.value).flatMap((a) => staticText(a) ?? []) : [direct];
    });
}
function boolRule(
  node: unknown,
  fallback: boolean,
  key: string,
  currentEnv: string | null,
  hasDefault: boolean,
): boolean {
  const text = staticText(node);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "infer") return !hasDefault;
  if (node instanceof ParsedEnvSpecFunctionCall) {
    const values = args(node).flatMap((a) => staticText(a) ?? []);
    if (node.name === "forEnv") return currentEnv !== null && values.includes(currentEnv);
    if (node.name === "inferFromPrefix") return !values.some((prefix) => key.startsWith(prefix));
  }
  return fallback;
}
function typeProblem(
  type: ParsedEnvSpecDecorator | undefined,
  value: string,
): string | null | undefined {
  if (!type) return null;
  const node = type.value;
  const name = node instanceof ParsedEnvSpecFunctionCall ? node.name : staticText(node);
  let valid: boolean;
  switch (name) {
    case "string":
      valid = true;
      break;
    case "number": {
      const number = Number(value);
      valid = value.trim() !== "" && Number.isFinite(number);
      if (node instanceof ParsedEnvSpecFunctionCall) {
        const options: unknown = node.simplifiedArgs;
        if (options && !Array.isArray(options) && typeof options === "object") {
          if ("min" in options && typeof options.min === "number") valid &&= number >= options.min;
          if ("max" in options && typeof options.max === "number") valid &&= number <= options.max;
        }
      }
      break;
    }
    case "boolean":
      valid = ["true", "false", "1", "0"].includes(value.toLowerCase());
      break;
    case "port":
      valid = /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
      break;
    case "url":
      try {
        const url = new URL(value);
        valid = Boolean(url.protocol);
      } catch {
        valid = false;
      }
      break;
    case "email":
      valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      break;
    case "enum":
      valid = args(node).some((a) => staticText(a) === value);
      break;
    case "semver":
      valid = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value);
      break;
    case "isoDate":
      valid = /^\d{4}-\d\d-\d\d(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
      break;
    case "uuid":
      valid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
      break;
    default:
      return undefined;
  }
  const labels: Record<string, string> = {
    url: "a URL",
    email: "an email address",
    port: "a port from 1 to 65535",
    enum: "one of the declared choices",
    number: "a number in the declared range",
    boolean: "a boolean",
    semver: "a semantic version",
    isoDate: "an ISO date",
    uuid: "a UUID",
  };
  return valid ? null : `expected ${labels[name ?? ""] ?? "the declared type"}`;
}
interface Value {
  readonly node: ParsedEnvSpecConfigItemValue | undefined;
  readonly source: string;
}
const unresolved = (node: unknown) =>
  node instanceof ParsedEnvSpecFunctionCall || (staticText(node)?.includes("$") ?? false);
export function currentEnvFor(
  file: ParsedEnvSpecFile,
  sources: ReadonlyArray<EnvSource>,
  processEnv: EnvInspectionInput["processEnv"],
): string | null {
  const currentNode = file.decoratorsObject.currentEnv?.value;
  const reference =
    currentNode instanceof ParsedEnvSpecFunctionCall && currentNode.name === "ref"
      ? staticText(args(currentNode)[0])
      : undefined;
  const raw = reference ? `$${reference}` : decoratorText(file.decoratorsObject.currentEnv);
  if (raw === undefined) return null;
  let value = raw;
  if (/^\$[A-Za-z_][\w]*$/.test(raw)) {
    const key = raw.slice(1);
    const values = new Map<string, string>();
    for (const source of sources)
      for (const item of parseEnvSource(source.source).configItems) {
        const text = staticText(item.value);
        if (text !== undefined && !unresolved(item.value)) values.set(item.key, text);
      }
    value = processEnv[key] ?? values.get(key) ?? "";
  }
  return /^[\w-]{1,80}$/.test(value) ? value : null;
}
export function inspectEnv(input: EnvInspectionInput): Omit<EnvReport, "varlock"> {
  let schema: ParsedEnvSpecFile | null = null;
  const values = new Map<string, Value>();
  const seen = new Set<string>();
  const base = {
    root: input.root,
    items: [] as EnvItem[],
    unschematizedKeys: [] as string[],
    envFiles: input.envSources.map((s) => s.path),
  };
  const invalid = (path: string, error: unknown): Omit<EnvReport, "varlock"> => {
    const point =
      typeof error === "object" && error !== null && "location" in error
        ? location(error.location)
        : { line: 1, column: 1 };
    // Parser messages include the offending source, including private dotenv values.
    return {
      ...base,
      schema: { _tag: "invalid", path, message: "Could not parse env configuration.", ...point },
    };
  };
  try {
    schema = input.schemaSource === null ? null : parseEnvSource(input.schemaSource);
  } catch (error) {
    return invalid(input.schemaPath, error);
  }
  let imported: Array<{ file: ParsedEnvSpecFile; path: string }>;
  try {
    imported = (input.imports ?? []).map((s) => ({ file: parseEnvSource(s.source), path: s.path }));
  } catch (error) {
    return invalid(input.schemaPath, error);
  }
  const definitions = [...imported, ...(schema ? [{ file: schema, path: input.schemaPath }] : [])];
  const items = new Map<
    string,
    { item: ParsedEnvSpecFile["configItems"][number]; file: ParsedEnvSpecFile; path: string }
  >();
  for (const definition of definitions)
    for (const item of definition.file.configItems) {
      items.set(item.key, { item, ...definition });
      if (staticText(item.value) !== undefined || item.value instanceof ParsedEnvSpecFunctionCall)
        values.set(item.key, { node: item.value, source: definition.path });
    }
  try {
    for (const source of input.envSources)
      for (const item of parseEnvSource(source.source).configItems) {
        seen.add(item.key);
        values.set(item.key, { node: item.value, source: source.path });
      }
  } catch (error) {
    return invalid(".env", error);
  }
  for (const [key, value] of Object.entries(input.processEnv))
    if (value !== undefined && (items.has(key) || seen.has(key)))
      values.set(key, {
        node: new ParsedEnvSpecStaticValue({ rawValue: value, skipTrim: true }),
        source: "server environment",
      });
  let currentEnv: string | null = null;
  try {
    currentEnv = schema ? currentEnvFor(schema, input.envSources, input.processEnv) : null;
  } catch (error) {
    return invalid(".env", error);
  }
  for (const { item, file, path } of items.values()) {
    const decorators = item.decoratorsObject;
    const root = file.decoratorsObject;
    const hasDefault = Boolean(staticText(item.value));
    const required = decorators.optional
      ? !boolRule(decorators.optional.value, true, item.key, currentEnv, hasDefault)
      : boolRule(
          decorators.required?.value ?? root.defaultRequired?.value,
          true,
          item.key,
          currentEnv,
          hasDefault,
        );
    const sensitive = decorators.public
      ? !boolRule(decorators.public.value, true, item.key, currentEnv, hasDefault)
      : boolRule(
          decorators.sensitive?.value ?? root.defaultSensitive?.value,
          true,
          item.key,
          currentEnv,
          hasDefault,
        );
    const value = values.get(item.key);
    let status: EnvItemStatus = { _tag: "missing" };
    if (value) {
      const text = staticText(value.node);
      if (unresolved(value.node) && value.source !== "server environment")
        status = {
          _tag: "resolvedByVarlock",
          functionName:
            value.node instanceof ParsedEnvSpecFunctionCall ? value.node.name : "reference",
        };
      else if (text === undefined || text === "") status = { _tag: "empty", source: value.source };
      else {
        const problem = typeProblem(decorators.type, text);
        status =
          problem === undefined
            ? { _tag: "unchecked", source: value.source }
            : problem === null
              ? { _tag: "set", source: value.source }
              : { _tag: "invalid", source: value.source, reason: problem };
      }
    }
    const typeNode = decorators.type?.value;
    const type =
      typeNode instanceof ParsedEnvSpecFunctionCall
        ? typeNode.toString()
        : (staticText(typeNode) ?? null);
    const docs = item.decoratorsArray
      .filter((d) => d.name === "docs")
      .flatMap((d) => {
        const url = staticText(d.value) ?? staticText(args(d.value)[0]);
        return url && /^https?:\/\//.test(url) ? [{ label: null, url }] : [];
      });
    base.items.push({
      key: item.key,
      description: item.description || null,
      type,
      required,
      sensitive,
      example: sensitive ? null : (decoratorText(decorators.example) ?? null),
      docs,
      tags: item.decoratorsArray
        .filter((d) => d.name === "tag" || d.name === "tags")
        .flatMap((d) => staticText(d.value) ?? args(d.value).flatMap((a) => staticText(a) ?? [])),
      line: location(item.data._location as unknown).line,
      status,
    });
    void path;
  }
  base.unschematizedKeys = [...seen].filter((k) => !items.has(k)).sort();
  const priority: Record<EnvItemStatus["_tag"], number> = {
    missing: 0,
    invalid: 1,
    empty: 2,
    resolvedByVarlock: 3,
    unchecked: 4,
    set: 5,
  };
  base.items.sort(
    (a, b) => priority[a.status._tag] - priority[b.status._tag] || a.key.localeCompare(b.key),
  );
  return {
    ...base,
    schema: schema
      ? { _tag: "ok", path: input.schemaPath, currentEnv, imports: envImports(schema) }
      : { _tag: "absent", path: input.schemaPath },
  };
}
