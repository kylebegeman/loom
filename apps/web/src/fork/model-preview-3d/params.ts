import type { ScadParameter } from "@t3tools/contracts/fork";
export function changedOverrides(
  parameters: readonly ScadParameter[],
  values: Readonly<Record<string, string>>,
) {
  return Object.fromEntries(
    parameters
      .filter((p) => values[p.name] !== undefined && values[p.name] !== p.defaultValue)
      .map((p) => [p.name, values[p.name]!]),
  );
}
export function parameterValues(
  parameters: readonly ScadParameter[],
  overrides: Readonly<Record<string, string>>,
) {
  return Object.fromEntries(parameters.map((p) => [p.name, overrides[p.name] ?? p.defaultValue]));
}

/** Keep literal parsing forgiving so source edits cannot crash the inspector. */
export function stringParameterValue(literal: string) {
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === "string" ? value : literal;
  } catch {
    return literal;
  }
}
export function vectorParameterValue(literal: string): number[] | null {
  try {
    const value: unknown = JSON.parse(literal);
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "number" && Number.isFinite(item))
      ? value
      : null;
  } catch {
    return null;
  }
}
export function parameterLabel(name: string) {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Validate edits with OpenSCAD literal syntax, before persistence or promotion. */
export function validParameterLiteral(parameter: ScadParameter, literal: string): boolean {
  const text = literal.trim();
  if (parameter.kind === "number")
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text));
  try {
    const value: unknown = JSON.parse(text);
    return parameter.kind === "vector"
      ? Array.isArray(value) &&
          value.length <= 100 &&
          value.every(
            (item) =>
              typeof item === "string" ||
              typeof item === "boolean" ||
              (typeof item === "number" && Number.isFinite(item)),
          )
      : typeof value === parameter.kind;
  } catch {
    return false;
  }
}
/** Source edits discard removed or incompatible values and fill new source defaults. */
export function rebaseParameterValues(
  parameters: readonly ScadParameter[],
  values: Readonly<Record<string, string>>,
) {
  return Object.fromEntries(
    parameters.map((parameter) => [
      parameter.name,
      values[parameter.name] !== undefined &&
      validParameterLiteral(parameter, values[parameter.name]!)
        ? values[parameter.name]!
        : parameter.defaultValue,
    ]),
  );
}
/** Human-readable value: option labels, quoted strings unwrapped, switches as On or Off. */
export function displayParameterValue(parameter: ScadParameter, literal: string) {
  const option = parameter.options?.find((item) => item.value === literal);
  if (option) return option.label;
  if (parameter.kind === "boolean") return literal === "true" ? "On" : "Off";
  if (parameter.kind === "string") return stringParameterValue(literal);
  const vector = parameter.kind === "vector" ? vectorParameterValue(literal) : null;
  return vector ? vector.join(" × ") : literal;
}
/** Parameters whose value differs from the baseline, in source order. */
export function changedParameters(
  parameters: readonly ScadParameter[],
  values: Readonly<Record<string, string>>,
  baseline: Readonly<Record<string, string>>,
) {
  return parameters.filter(
    (parameter) =>
      (values[parameter.name] ?? parameter.defaultValue) !==
      (baseline[parameter.name] ?? parameter.defaultValue),
  );
}
/** Short summary such as "Width 120, Rows 3" for the parameters that differ from the baseline. */
export function describeValues(
  parameters: readonly ScadParameter[],
  values: Readonly<Record<string, string>>,
  baseline: Readonly<Record<string, string>>,
) {
  return changedParameters(parameters, values, baseline)
    .map(
      (parameter) =>
        `${parameterLabel(parameter.name)} ${displayParameterValue(parameter, values[parameter.name] ?? parameter.defaultValue)}`,
    )
    .join(", ");
}
