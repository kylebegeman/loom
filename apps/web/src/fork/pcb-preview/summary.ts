import type { PcbCheckResult, PcbDesign } from "@t3tools/contracts/fork";

export function checkSummary(
  design: Pick<PcbDesign, "name" | "id">,
  result: PcbCheckResult,
  stale = false,
) {
  const { errors, warnings } = result.counts;
  const title = `${result.kind.toUpperCase()} for ${design.name} (${design.id})`;
  const header = [
    title,
    `Run: ${result.ranAt}; KiCad ${result.kicadVersion ?? "unknown"}.`,
    ...(stale ? ["Files changed since this run. Re-run before relying on these findings."] : []),
    ...(result.kind === "drc" ? ["Zones as saved; no refill performed."] : []),
  ];
  if (result.outcome === "failed" || result.outcome === "timed-out")
    return [
      ...header,
      `The check ${result.outcome === "timed-out" ? "timed out" : "failed to run"}.`,
      result.log,
    ]
      .filter(Boolean)
      .join("\n");
  const findings = result.violations.filter((v) => !v.excluded);
  const lines = findings.slice(0, 100).map((v) => {
    const items = v.items
      .map(
        (i) =>
          `${i.description}${i.x !== undefined && i.y !== undefined ? ` (${i.x}, ${i.y} ${result.coordinateUnits ?? "mm"})` : ""}`,
      )
      .join("; ");
    return `- ${v.severity}: ${v.type}: ${v.description}${v.sheet ? ` [${v.sheet}]` : ""}${items ? `; ${items}` : ""}`;
  });
  const omitted = Math.max(0, errors + warnings - lines.length);
  return [
    ...header,
    errors + warnings === 0 ? "No violations." : `${errors} errors, ${warnings} warnings.`,
    ...lines,
    ...(omitted ? [`and ${omitted} more findings.`] : []),
    ...(result.truncated
      ? ["The preview report was truncated; use the full KiCad report for every detail."]
      : []),
  ].join("\n");
}
export function electronicsDesignUrl(base: string, absolutePath: string) {
  try {
    const url = new URL(base.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/$/, "") + "/designs/by-path";
    url.search = "";
    url.hash = "";
    url.searchParams.set("path", absolutePath);
    return url.href;
  } catch {
    return null;
  }
}
export const appendSummary = (draft: string, summary: string) =>
  draft.trim().length ? `${draft}\n\n${summary}` : summary;
