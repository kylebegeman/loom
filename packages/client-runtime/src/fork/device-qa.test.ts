import type { DeviceQaRun, DeviceQaRunEvent } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { applyDeviceQaRunEvent, EMPTY_DEVICE_QA_RUN_VIEW } from "./device-qa.ts";

const run = {
  id: "run-1",
  status: "failed",
  flows: [
    { path: "a.yaml", status: "failed" },
    { path: "b.yaml", status: "skipped" },
  ],
} as unknown as DeviceQaRun;

const fold = (events: ReadonlyArray<DeviceQaRunEvent>) =>
  events.reduce(applyDeviceQaRunEvent, EMPTY_DEVICE_QA_RUN_VIEW);

describe("applyDeviceQaRunEvent", () => {
  it("collects steps per flow and takes the final statuses from runFinished", () => {
    const view = fold([
      { _tag: "flowStarted", path: "a.yaml" },
      { _tag: "step", path: "a.yaml", step: { index: 0, kind: "tap", status: "pass" } },
      { _tag: "step", path: "a.yaml", step: { index: 1, kind: "snapshot", status: "fail" } },
      { _tag: "flowFinished", path: "a.yaml", status: "failed" },
      { _tag: "runFinished", run },
    ]);
    expect(view.finished).toBe(run);
    expect(view.flows.map(({ path, status, steps }) => [path, status, steps.length])).toEqual([
      ["a.yaml", "failed", 2],
      ["b.yaml", "skipped", 0],
    ]);
  });

  it("shows a flow that is still running while later events have not arrived", () => {
    const view = fold([
      { _tag: "flowStarted", path: "a.yaml" },
      { _tag: "step", path: "a.yaml", step: { index: 0, kind: "tap", status: "pass" } },
    ]);
    expect(view.finished).toBeNull();
    expect(view.flows).toEqual([
      { path: "a.yaml", status: "running", steps: [{ index: 0, kind: "tap", status: "pass" }] },
    ]);
  });
});
