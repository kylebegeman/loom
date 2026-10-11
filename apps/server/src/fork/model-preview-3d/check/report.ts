import {
  PRINT_CHECK_VERSION,
  PRINT_CHECK_MAX_FINDINGS,
  type PrintCheckReport,
  type PrintFinding,
} from "@t3tools/contracts/fork";
import type { PrintCheckCore } from "./protocol.ts";
const order = [
  "mesh",
  "shells",
  "bed-fit",
  "first-layer",
  "overhangs",
  "islands",
  "walls",
  "small-features",
] as const;
const caps: Partial<Record<PrintFinding["code"], number>> = {
  OVERHANG_AREA: 10,
  UNSUPPORTED_ISLAND: 20,
  THIN_WALL: 20,
  FEATURE_BELOW_NOZZLE: 20,
  OPEN_EDGES: 5,
  NON_MANIFOLD_EDGES: 5,
  FLIPPED_FACES: 5,
  INTERNAL_SHELL: 10,
};
/** Bed fit is recomputed after a geometry cache hit, so bed changes spend no worker time. */
export const finalizeReport = (
  core: PrintCheckCore,
  input: {
    geometryRevision: string;
    checkedAt: string;
    cached: boolean;
    settings: PrintCheckReport["settings"];
    bed: PrintCheckReport["bed"];
  },
): PrintCheckReport => {
  const findings = [...core.findings];
  if (input.bed.fit !== "fits")
    findings.push({
      id: "",
      check: "bed-fit",
      code: input.bed.fit === "too-big" ? "EXCEEDS_BUILD_VOLUME" : "FITS_ROTATED",
      severity: input.bed.fit === "too-big" ? "fail" : "info",
      message:
        input.bed.fit === "too-big"
          ? `${Math.max(...input.bed.overMm!).toFixed(1)} mm beyond the build volume for ${input.bed.label}.`
          : "Fits when turned 90 degrees on the bed.",
      value: input.bed.overMm ? Math.max(...input.bed.overMm) : null,
      limit: null,
      unit: input.bed.overMm ? "mm" : null,
      location:
        input.bed.fit === "too-big"
          ? {
              point: core.modelCenter,
              normal: null,
              radiusMm: Math.hypot(...core.summary.sizeMm) / 2,
            }
          : null,
    });
  const severity = { fail: 0, warn: 1, info: 2 };
  findings.sort(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      order.indexOf(a.check) - order.indexOf(b.check) ||
      Math.abs((b.value ?? 0) - (b.limit ?? 0)) - Math.abs((a.value ?? 0) - (a.limit ?? 0)),
  );
  const seen = new Map<string, number>(),
    limited = findings.filter((f) => {
      const n = (seen.get(f.code) ?? 0) + 1;
      seen.set(f.code, n);
      return n <= (caps[f.code] ?? Infinity);
    });
  const numbered = new Map<string, number>(),
    kept = limited.slice(0, PRINT_CHECK_MAX_FINDINGS).map((f) => {
      const n = (numbered.get(f.code) ?? 0) + 1;
      numbered.set(f.code, n);
      return { ...f, id: `${f.code}-${n}` };
    });
  return {
    version: PRINT_CHECK_VERSION,
    status: core.status,
    verdict: findings.some((f) => f.severity === "fail")
      ? "blocked"
      : core.status === "incomplete" || findings.some((f) => f.severity === "warn")
        ? "review"
        : "ready",
    geometryRevision: input.geometryRevision,
    checkedAt: input.checkedAt,
    durationMs: core.durationMs,
    cached: input.cached,
    orientation: core.orientation,
    summary: core.summary,
    settings: input.settings,
    bed: input.bed,
    checks: order.map((check) => {
      const row = core.checks.find((r) => r.check === check),
        own = findings.filter((f) => f.check === check);
      return {
        check,
        status: own.some((f) => f.severity === "fail")
          ? "fail"
          : own.some((f) => f.severity === "warn")
            ? "warn"
            : own.length
              ? "info"
              : check === "bed-fit"
                ? "pass"
                : (row?.status ?? "pass"),
        summary:
          check === "bed-fit"
            ? input.bed.fit === "fits"
              ? `Fits ${input.bed.label}`
              : own[0]!.message
            : (row?.summary ?? "No issues found"),
        findings: Math.max(own.length, row?.findings ?? 0),
      };
    }),
    findings: kept,
    truncated: core.truncated || kept.length < findings.length,
    stages: core.stages,
  };
};
