import * as Schema from "effect/Schema";
import {
  PcbParameter,
  type PcbParameters,
  type PcbApplyParametersInput,
} from "@t3tools/contracts/fork";
export const ParameterFile = Schema.Struct({
  parameters: Schema.Array(PcbParameter).check(Schema.isMaxLength(100)),
});
/** Only explicit loom:param markers are writable. Unrelated circuit source stays byte-for-byte intact. */
export function applyCircuitParameters(
  source: string,
  parameters: PcbParameters["parameters"],
  values: PcbApplyParametersInput["values"],
): string {
  let next = source;
  for (const [key, value] of Object.entries(values)) {
    const parameter = parameters.find((p) => p.key === key);
    if (!parameter || typeof value !== parameter.type) throw new Error(`Invalid value for ${key}.`);
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (parameter.min !== undefined && value < parameter.min) ||
        (parameter.max !== undefined && value > parameter.max))
    )
      throw new Error(`${key} is outside its allowed range.`);
    if (parameter.choices && !parameter.choices.includes(value as string | number))
      throw new Error(`Choose a listed value for ${key}.`);
    const expression = parameterExpression(key);
    let matches = 0;
    next = next.replace(expression, (_, marker: string) => {
      matches++;
      return marker + JSON.stringify(value);
    });
    if (matches !== 1)
      throw new Error(`Expected one loom:param marker for ${key}; found ${matches}.`);
  }
  return next;
}

const parameterExpression = (key: string) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(/\\*\\s*loom:param\\s+${escaped}\\s*\\*/\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|true|false|[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?)(?=\\s*[,;)}\\]])`,
    "g",
  );
};
/** Read only the same explicit literals that parameter updates are allowed to replace. */
export function readCircuitParameterValues(
  source: string,
  parameters: PcbParameters["parameters"],
) {
  return Object.fromEntries(
    parameters.map((parameter) => {
      const matches = [...source.matchAll(parameterExpression(parameter.key))];
      if (matches.length !== 1)
        throw new Error(`Expected one loom:param marker for ${parameter.key}.`);
      const literal = matches[0]![2]!;
      let value: string | number | boolean;
      if (literal.startsWith("'")) {
        value = literal.slice(1, -1).replace(/\\(?:u[\da-fA-F]{4}|x[\da-fA-F]{2}|.)/g, (escape) => {
          const code = escape.slice(1);
          if (/^[ux]/.test(code)) return String.fromCharCode(parseInt(code.slice(1), 16));
          const controls: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            b: "\b",
            f: "\f",
            v: "\v",
            "0": "\0",
          };
          return controls[code] ?? code;
        });
      } else value = /^(?:"|true|false)/.test(literal) ? JSON.parse(literal) : Number(literal);
      if (typeof value !== parameter.type)
        throw new Error(`The source type does not match ${parameter.key}.`);
      return [parameter.key, value];
    }),
  );
}
