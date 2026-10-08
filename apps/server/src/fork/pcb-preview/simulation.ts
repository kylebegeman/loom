import type { PcbSimulationResult, PcbSimulationSetup } from "@t3tools/contracts/fork";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function simulationNetlist(
  source: string,
  setup: PcbSimulationSetup,
  parameterValue?: number,
): string {
  if (source.length > 1024 * 1024) throw new Error("The simulation netlist exceeds 1 MiB.");
  // Exporters include analysis commands. Strip only recognised commands; never execute
  // arbitrary ngspice control code from a saved netlist on the environment host.
  let inControl = false;
  const safeLines: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*\.control\s*$/i.test(line)) {
      if (inControl) throw new Error("Nested SPICE control block.");
      inControl = true;
      continue;
    }
    if (/^\s*\.endc\s*$/i.test(line)) {
      if (!inControl) throw new Error("Unbalanced SPICE control block.");
      inControl = false;
      continue;
    }
    if (inControl) {
      if (
        line.trim() &&
        !/^\s*(?:\*|(?:op|tran|ac|dc|save|plot|print|write|wrdata|quit|run)\b|set\s+(?:filetype|numdgt)\s*=)/i.test(
          line,
        )
      )
        throw new Error("Unsupported SPICE control command. Use a self-contained netlist.");
      continue;
    }
    if (/^\s*\.(?:include|inc|lib|shell|exec|load|source)\b/im.test(line))
      throw new Error(
        "Inline the required SPICE models; external file directives are unavailable.",
      );
    safeLines.push(line);
  }
  if (inControl) throw new Error("Unterminated SPICE control block.");
  if (setup.sweep && !IDENTIFIER.test(setup.sweep.parameter))
    throw new Error("Sweep names must be SPICE parameter identifiers.");
  if (setup.analysis === "tran" && (setup.step > setup.stop || setup.stop / setup.step > 10000))
    throw new Error("Choose a transient step no larger than stop, with at most 10,000 samples.");
  if (setup.analysis === "ac" && setup.stopFrequency <= setup.startFrequency)
    throw new Error("Stop frequency must exceed start frequency.");
  const lines = safeLines.filter((l) => !/^\s*\.(?:end|op|tran|ac|dc|save|plot|print)\b/i.test(l));
  if (setup.sweep && parameterValue !== undefined) {
    const name = setup.sweep.parameter;
    const expression = new RegExp(`\\b${name}\\s*=\\s*(?:\\{[^}]*\\}|[^\\s]+)`, "i");
    let replaced = false;
    for (let i = 0; i < lines.length; i++)
      if (/^\s*\.param\b/i.test(lines[i]!) && expression.test(lines[i]!)) {
        lines[i] = lines[i]!.replace(expression, `${name}=${parameterValue}`);
        replaced = true;
      }
    if (!replaced) lines.push(`.param ${name}=${parameterValue}`);
  }
  const analysis =
    setup.analysis === "op"
      ? "op"
      : setup.analysis === "tran"
        ? `tran ${setup.step} ${setup.stop}`
        : `ac lin ${setup.points} ${setup.startFrequency} ${setup.stopFrequency}`;
  return [
    ...lines,
    ".control",
    "set filetype=ascii",
    analysis,
    "write results.raw all",
    "quit",
    ".endc",
    ".end",
  ].join("\n");
}
export function parseSpiceRaw(
  source: string,
  probes: readonly string[],
): PcbSimulationResult["runs"][number] {
  const variables = Number(source.match(/^No\. Variables:\s*(\d+)/m)?.[1]),
    points = Number(source.match(/^No\. Points:\s*(\d+)/m)?.[1]);
  if (
    !Number.isInteger(variables) ||
    variables < 1 ||
    variables > 5000 ||
    !Number.isInteger(points) ||
    points < 1 ||
    points > 1000000
  )
    throw new Error("Invalid or oversized SPICE result.");
  const vars =
    source
      .split(/(?:^|\n)Variables:\s*\n/)[1]
      ?.split("Values:")[0]
      ?.trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/)) ?? [];
  if (vars.length !== variables || vars.some((v, i) => Number(v[0]) !== i))
    throw new Error("Invalid SPICE variable table.");
  const values = source.split("Values:")[1]?.trim().split(/\s+/) ?? [];
  let cursor = 0;
  const axis = ["time", "frequency"].includes(vars[0]?.[1] ?? "");
  const selected = vars
    .map((v, i) => ({ name: v[1] ?? `trace${i}`, unit: v[2] ?? "", i }))
    .filter((v) => (!axis || v.i > 0) && (!probes.length || probes.includes(v.name)))
    .slice(0, 24);
  const x: number[] = [],
    data = selected.map((v) => ({ ...v, values: [] as number[], imaginary: [] as number[] }));
  const traceByColumn = new Map(data.map((v) => [v.i, v]));
  const stride = Math.max(1, Math.ceil(points / 10000)),
    complex = /^Flags:.*complex/m.test(source);
  for (let row = 0; row < points; row++) {
    const index = Number(values[cursor++]);
    if (!axis && row % stride === 0) x.push(row);
    if (index !== row) throw new Error("Invalid SPICE sample index.");
    for (let column = 0; column < variables; column++) {
      const token = values[cursor++];
      if (!token) throw new Error("Truncated SPICE result.");
      const pair = token.split(",").map(Number);
      if (!pair.every(Number.isFinite)) throw new Error("Non-finite simulation result.");
      if (row % stride !== 0) continue;
      if (axis && column === 0) x.push(pair[0]!);
      const trace = traceByColumn.get(column);
      if (trace) {
        trace.values.push(pair[0]!);
        if (complex) trace.imaginary.push(pair[1] ?? 0);
      }
    }
  }
  return {
    label: "",
    x,
    series: data.map(({ name, unit, values, imaginary }) => ({
      name,
      unit,
      values,
      ...(complex ? { imaginary } : {}),
    })),
  };
}
