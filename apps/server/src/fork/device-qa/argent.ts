import type {
  DeviceQaArgentStatus,
  DeviceQaFlowRunStatus,
  DeviceQaSnapshotArtifacts,
  DeviceQaStep,
  DeviceQaStepStatus,
} from "@t3tools/contracts/fork";

export { ARGENT_PINNED_VERSION } from "@t3tools/contracts/fork";

/**
 * argent honours `DO_NOT_TRACK` over every config file. Every argent process Loom starts runs
 * with it, whatever the user's own setting is.
 */
export const argentEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...base,
  DO_NOT_TRACK: "1",
});

/** One flow per process: `--json-stream` refuses directories. */
export const flowRunArgs = (input: {
  readonly path: string;
  readonly deviceId: string;
  readonly platform: "ios" | "android";
  readonly outputDir: string;
  readonly updateBaselines: boolean;
}) => [
  "flow",
  "run",
  input.path,
  "--device",
  input.deviceId,
  "--platform",
  input.platform,
  "--json-stream",
  "--output",
  input.outputDir,
  ...(input.updateBaselines ? ["--update-baselines"] : []),
];

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringOf = (value: unknown) => (typeof value === "string" ? value : undefined);
const numberOf = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const intOf = (value: unknown) => {
  const number = numberOf(value);
  return number === undefined ? undefined : Math.trunc(number);
};

/** A step record as argent reports it; every field but `status` is optional. */
export type ArgentStepReport = JsonObject & { readonly status: DeviceQaStepStatus };

export interface ArgentFlowReport {
  readonly ok: boolean | undefined;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errored: number;
  readonly durationMs: number | null;
  readonly steps: ReadonlyArray<JsonObject>;
}

export type ArgentRecord =
  | { readonly _tag: "progress"; readonly step: JsonObject }
  | { readonly _tag: "result"; readonly report: ArgentFlowReport }
  | { readonly _tag: "error"; readonly message: string; readonly code: string | undefined }
  | { readonly _tag: "text"; readonly line: string };

const STEP_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "skip", "error"]);

const reportOf = (data: JsonObject): ArgentFlowReport => {
  const steps = Array.isArray(data.steps) ? data.steps.filter(isObject) : [];
  const count = (status: string) => steps.filter((step) => step.status === status).length;
  return {
    ok: typeof data.ok === "boolean" ? data.ok : undefined,
    passed: intOf(data.passed) ?? count("pass"),
    failed: intOf(data.failed) ?? count("fail"),
    skipped: intOf(data.skipped) ?? count("skip"),
    errored: intOf(data.errored) ?? count("error"),
    durationMs: numberOf(data.durationMs) ?? null,
    steps,
  };
};

/**
 * One `--json-stream` line. Unknown fields are ignored so an argent upgrade degrades instead of
 * breaking; anything that is not a known record is plain text.
 */
export const parseArgentLine = (line: string): ArgentRecord => {
  const text = { _tag: "text", line } as const;
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }
  if (!isObject(parsed)) return text;
  switch (parsed.event) {
    case "progress":
      return isObject(parsed.data) ? { _tag: "progress", step: parsed.data } : text;
    case "result":
      return isObject(parsed.data) && Array.isArray(parsed.data.steps)
        ? { _tag: "result", report: reportOf(parsed.data) }
        : text;
    case "error":
      return {
        _tag: "error",
        message: stringOf(parsed.error) ?? "argent reported an error without a message.",
        code: stringOf(parsed.error_code),
      };
    default:
      return text;
  }
};

/**
 * Snapshot artifacts as file paths. Live progress records still carry argent's artifact handles;
 * only the final report resolves them, so a handle keeps only its host path when it has one.
 */
const artifactsOf = (value: unknown): DeviceQaSnapshotArtifacts | undefined => {
  if (!isObject(value)) return undefined;
  const pathOf = (entry: unknown) =>
    stringOf(entry) ?? (isObject(entry) ? stringOf(entry.hostPath) : undefined);
  const artifacts: { baseline?: string; current?: string; diff?: string } = {};
  for (const role of ["baseline", "current", "diff"] as const) {
    const path = pathOf(value[role]);
    if (path !== undefined && path !== "") artifacts[role] = path;
  }
  return Object.keys(artifacts).length === 0 ? undefined : artifacts;
};

/** Maps argent's `StepReport`. Null when the record has no recognizable status. */
export const stepFromReport = (raw: JsonObject, fallbackIndex: number): DeviceQaStep | null => {
  const status = raw.status;
  if (typeof status !== "string" || !STEP_STATUSES.has(status)) return null;
  const optional = {
    reason: stringOf(raw.reason),
    warning: stringOf(raw.warning),
    target: stringOf(raw.target),
    tool: stringOf(raw.tool),
    flow: stringOf(raw.flow),
    message: stringOf(raw.message),
    depth: intOf(raw.depth),
    durationMs: numberOf(raw.durationMs),
    artifacts: artifactsOf(raw.artifacts),
  };
  return {
    index: intOf(raw.index) ?? fallbackIndex,
    kind: stringOf(raw.kind) ?? "step",
    status: status as DeviceQaStepStatus,
    ...Object.fromEntries(Object.entries(optional).filter((entry) => entry[1] !== undefined)),
  };
};

export const stepsFromReport = (report: ArgentFlowReport) =>
  report.steps.flatMap((raw, index) => stepFromReport(raw, index) ?? []);

/** The flow's status from its last record; the exit code decides only when there was none. */
export const flowStatusOf = (
  last: ArgentRecord | null,
  exitCode: number | null,
): DeviceQaFlowRunStatus => {
  if (last?._tag === "error") return "error";
  if (last?._tag === "result") {
    const { report } = last;
    if (report.errored > 0) return "error";
    if (report.ok === false || report.failed > 0) return "failed";
    if (report.ok === true || report.passed + report.skipped > 0) return "passed";
    return report.steps.length === 0 ? "skipped" : "passed";
  }
  if (exitCode === 0) return "passed";
  return "error";
};

/** `argent --version` prints a bare version, sometimes after a name. */
export const parseArgentVersion = (stdout: string) =>
  /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(stdout)?.[0] ?? null;

/**
 * Telemetry as argent decides it for the user's own runs (Loom's runs always pass
 * `DO_NOT_TRACK=1`): an environment opt-out, else `telemetry.enabled: false` in the global or
 * project config wins, else argent's default, on. `unknown` when a config file cannot be read.
 */
export const telemetryFromConfig = (input: {
  readonly env: NodeJS.ProcessEnv;
  /** File text, or null when the file does not exist. */
  readonly globalConfig: string | null;
  readonly projectConfig: string | null;
}): DeviceQaArgentStatus["telemetry"] => {
  const doNotTrack = input.env.DO_NOT_TRACK;
  if (doNotTrack !== undefined && doNotTrack !== "" && doNotTrack !== "0") return "disabled";
  const argentTelemetry = input.env.ARGENT_TELEMETRY?.toLowerCase();
  if (argentTelemetry === "0" || argentTelemetry === "false" || argentTelemetry === "off")
    return "disabled";
  let unreadable = false;
  for (const text of [input.globalConfig, input.projectConfig]) {
    if (text === null) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      const telemetry = isObject(parsed) ? parsed.telemetry : undefined;
      const value = isObject(telemetry) ? telemetry.enabled : undefined;
      if (value === false) return "disabled";
    } catch {
      unreadable = true;
    }
  }
  return unreadable ? "unknown" : "enabled";
};
