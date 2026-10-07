import type { ScadParameter } from "@t3tools/contracts/fork";
export function sweepValues(parameter: ScadParameter, input: string): string[] {
  const tokens = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!tokens.length || tokens.length > 6)
    throw new Error("Enter one to six values per parameter.");
  return tokens.map((value) => {
    if (parameter.kind === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Invalid number for ${parameter.name}.`);
      return String(number);
    }
    if (parameter.kind === "boolean") {
      if (value !== "true" && value !== "false") throw new Error("Use true or false for switches.");
      return value;
    }
    if (parameter.kind === "string") return JSON.stringify(value);
    throw new Error("Use a saved set to explore vector parameters.");
  });
}
export function generateVariants(
  base: Readonly<Record<string, string>>,
  axes: readonly { name: string; values: readonly string[] }[],
) {
  if (
    !axes.length ||
    new Set(axes.map((axis) => axis.name)).size !== axes.length ||
    axes.some((axis) => !axis.values.length)
  )
    throw new Error("Choose distinct parameters with at least one value each.");
  let candidates = [{ name: "", values: { ...base } }];
  for (const axis of axes) {
    if (candidates.length * axis.values.length > 12)
      throw new Error(
        "Limit a sweep to 12 candidates. Reduce the values or generate another batch.",
      );
    candidates = candidates.flatMap((candidate) =>
      axis.values.map((value) => ({
        name: [candidate.name, `${axis.name} ${value}`].filter(Boolean).join(" / "),
        values: { ...candidate.values, [axis.name]: value },
      })),
    );
  }
  return candidates;
}
