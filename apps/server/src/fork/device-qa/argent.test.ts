// @effect-diagnostics nodeBuiltinImport:off - Reads synthetic argent output.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";

import {
  argentEnv,
  flowRunArgs,
  flowStatusOf,
  parseArgentLine,
  parseArgentVersion,
  stepFromReport,
  stepsFromReport,
  telemetryFromConfig,
  type ArgentRecord,
} from "./argent.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__fixtures__", name), "utf8");
const records = (name: string) =>
  fixture(name)
    .split("\n")
    .filter((line) => line !== "")
    .map(parseArgentLine);

describe("parseArgentLine", () => {
  it("reads progress and result records and keeps other lines as text", () => {
    const parsed = records("flow-pass.ndjson");
    expect(parsed.map((record) => record._tag)).toEqual([
      "text",
      "progress",
      "progress",
      "text",
      "progress",
      "progress",
      "result",
    ]);
    const result = parsed.at(-1) as Extract<ArgentRecord, { _tag: "result" }>;
    expect(result.report).toMatchObject({ ok: true, passed: 4, failed: 0, durationMs: 2210 });
    expect(flowStatusOf(result, 0)).toBe("passed");
  });

  it("reads error records with their code", () => {
    const record = records("flow-validation-error.ndjson").find(
      (candidate) => candidate._tag !== "text",
    );
    expect(record).toEqual({
      _tag: "error",
      message: 'Invalid flow file: unknown key "tapp"',
      code: "FLOW_FILE_INVALID",
    });
    expect(flowStatusOf(record ?? null, 1)).toBe("error");
  });

  it("treats malformed or unknown JSON as text", () => {
    expect(parseArgentLine("{not json")._tag).toBe("text");
    expect(parseArgentLine('{"event":"heartbeat"}')._tag).toBe("text");
    expect(parseArgentLine('{"event":"progress","data":3}')._tag).toBe("text");
  });
});

describe("stepFromReport", () => {
  it("keeps snapshot artifact paths from the final report and drops nulls", () => {
    const result = records("flow-snapshot-fail.ndjson").at(-1) as Extract<
      ArgentRecord,
      { _tag: "result" }
    >;
    const steps = stepsFromReport(result.report);
    expect(steps[2]).toEqual({
      index: 2,
      kind: "snapshot",
      status: "fail",
      flow: "settings",
      depth: 1,
      reason: "3.2% of pixels differ (max 0.5%)",
      artifacts: {
        baseline: "/Users/test/runs/artifacts/settings/settings__ios-1206x2622-baseline.png",
        current: "/Users/test/runs/artifacts/settings/settings__ios-1206x2622-current.png",
        diff: "/Users/test/runs/artifacts/settings/settings__ios-1206x2622-diff.png",
      },
    });
    expect(flowStatusOf(result, 1)).toBe("failed");
    const passing = stepFromReport(
      { status: "pass", kind: "snapshot", artifacts: { current: null } },
      7,
    );
    expect(passing).toEqual({ index: 7, kind: "snapshot", status: "pass" });
  });

  it("keeps only host paths from live artifact handles", () => {
    const progress = records("flow-snapshot-fail.ndjson").filter(
      (record): record is Extract<ArgentRecord, { _tag: "progress" }> => record._tag === "progress",
    );
    const step = stepFromReport(progress[2]!.step, 0);
    expect(step?.artifacts).toEqual({
      baseline:
        "/Users/test/project/.argent/flows/__baselines__/settings/settings__ios-1206x2622.png",
    });
  });

  it("refuses records without a known status", () => {
    expect(stepFromReport({ kind: "tap" }, 0)).toBeNull();
    expect(stepFromReport({ kind: "tap", status: "maybe" }, 0)).toBeNull();
  });
});

describe("argent processes", () => {
  it("builds one flow run with a relative path and optional baseline update", () => {
    const base = {
      path: ".argent/flows/login.yaml",
      deviceId: "SIM-1",
      platform: "ios" as const,
      outputDir: "/state/runs/dqa_1/artifacts",
    };
    expect(flowRunArgs({ ...base, updateBaselines: false })).toEqual([
      "flow",
      "run",
      ".argent/flows/login.yaml",
      "--device",
      "SIM-1",
      "--platform",
      "ios",
      "--json-stream",
      "--output",
      "/state/runs/dqa_1/artifacts",
    ]);
    expect(flowRunArgs({ ...base, updateBaselines: true }).at(-1)).toBe("--update-baselines");
  });

  it("always turns telemetry off in the spawn environment", () => {
    expect(argentEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin", DO_NOT_TRACK: "1" });
    expect(argentEnv({ DO_NOT_TRACK: "0" }).DO_NOT_TRACK).toBe("1");
  });

  it("finds the version in --version output", () => {
    expect(parseArgentVersion("0.25.2\n")).toBe("0.25.2");
    expect(parseArgentVersion("argent v0.27.1-next.3")).toBe("0.27.1-next.3");
    expect(parseArgentVersion("")).toBeNull();
  });
});

describe("telemetryFromConfig", () => {
  it("is enabled by default, as argent ships", () => {
    expect(telemetryFromConfig({ env: {}, globalConfig: null, projectConfig: null })).toBe(
      "enabled",
    );
  });

  it("is disabled by an environment opt-out or a false in either config", () => {
    expect(
      telemetryFromConfig({ env: { DO_NOT_TRACK: "1" }, globalConfig: null, projectConfig: null }),
    ).toBe("disabled");
    expect(
      telemetryFromConfig({
        env: {},
        globalConfig: '{"telemetry":{"enabled":true}}',
        projectConfig: '{"telemetry":{"enabled":false}}',
      }),
    ).toBe("disabled");
  });

  it("is unknown when a config cannot be read", () => {
    expect(telemetryFromConfig({ env: {}, globalConfig: "{oops", projectConfig: null })).toBe(
      "unknown",
    );
  });
});
