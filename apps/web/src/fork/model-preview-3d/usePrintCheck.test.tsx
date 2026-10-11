import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  activeBed,
  fitOnBed,
  selectBed,
  type PrintCheckReport,
} from "@t3tools/contracts/fork";
const mocks = vi.hoisted(() => ({ run: vi.fn(), check: {}, cancel: {} }));
vi.mock("./state", () => ({
  models: { checkPrint: mocks.check, cancelPrintCheck: mocks.cancel },
  runModelCommand: mocks.run,
}));
import {
  isReportStale,
  printCheckRequestKey,
  usePrintCheck,
  type PrintCheckInput,
} from "./usePrintCheck";

function input(overrides: Partial<PrintCheckInput> = {}): PrintCheckInput {
  return {
    threadRef: { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") },
    path: "bracket.scad",
    format: "scad",
    geometryRevision: "geometry-1",
    session: { applied: { height: "20", width: "10" }, setName: null },
    settings: DEFAULT_MODEL_PREVIEW_SETTINGS,
    orientation: null,
    active: false,
    enabled: true,
    allowLarge: false,
    ...overrides,
  };
}
function report(current = input()): PrintCheckReport {
  const bed = activeBed(current.settings.buildPlate);
  const size = [10, 20, 30] as const,
    fit = fitOnBed(size, bed.volumeMm);
  return {
    version: 1,
    status: "complete",
    verdict: "ready",
    geometryRevision: current.geometryRevision,
    checkedAt: "2026-10-10T00:00:00Z",
    durationMs: 100,
    cached: false,
    orientation: current.orientation?.quaternion ?? null,
    summary: {
      triangles: 12,
      vertices: 8,
      shells: 1,
      watertight: true,
      volumeMm3: 6000,
      surfaceAreaMm2: 2200,
      sizeMm: size,
      contactAreaMm2: 200,
      overhangAreaMm2: 0,
      minThicknessMm: 10,
      thicknessSamples: 1,
    },
    settings: {
      nozzleMm: current.settings.nozzleDiameterMm,
      nozzleSource: "setting",
      overhangAngleDegrees: current.settings.overhangAngleDegrees,
      firstLayerMm: current.settings.firstLayerHeightMm,
      minWallMm: current.settings.nozzleDiameterMm * 2,
    },
    bed: {
      id: bed.id,
      label: bed.label,
      fit: fit.status,
      overMm: fit.status === "too-big" ? fit.overMm : null,
    },
    checks: [],
    findings: [],
    truncated: false,
    stages: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let renderer: ReactTestRenderer | undefined;
let check: ReturnType<typeof usePrintCheck>;
function Harness({ value }: { value: PrintCheckInput }) {
  const state = usePrintCheck(value);
  useLayoutEffect(() => {
    check = state;
  });
  return null;
}
async function update(value = input()) {
  await act(async () => {
    if (renderer) renderer.update(createElement(Harness, { value }));
    else renderer = create(createElement(Harness, { value }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mocks.run.mockReset();
  mocks.run.mockImplementation((command) =>
    command === mocks.cancel
      ? Promise.resolve()
      : Promise.resolve({ status: "ok", report: report() }),
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keys geometry, SCAD inputs and analysis settings while reusing geometry across beds", () => {
  const current = input(),
    key = printCheckRequestKey(current);
  expect(
    printCheckRequestKey({
      ...current,
      session: { applied: { width: "10", height: "20" }, setName: null },
    }),
  ).toBe(key);
  expect(
    printCheckRequestKey({
      ...current,
      settings: {
        ...current.settings,
        buildPlate: selectBed(current.settings.buildPlate, "sheet-a4"),
      },
    }),
  ).toBe(key);
  for (const changed of [
    { ...current, geometryRevision: "geometry-2" },
    { ...current, session: { applied: { height: "21" }, setName: null } },
    { ...current, session: { ...current.session!, setName: "tall" } },
    { ...current, orientation: { quaternion: [1, 0, 0, 0] as const, sourceRevision: "v1" } },
    { ...current, settings: { ...current.settings, nozzleDiameterMm: 0.6 } },
    { ...current, settings: { ...current.settings, overhangAngleDegrees: 35 } },
    { ...current, settings: { ...current.settings, firstLayerHeightMm: 0.3 } },
  ])
    expect(printCheckRequestKey(changed)).not.toBe(key);
  const raw = { ...current, format: "stl" as const };
  expect(
    printCheckRequestKey({ ...raw, session: { applied: { height: "80" }, setName: "ignored" } }),
  ).toBe(printCheckRequestKey(raw));
});

it("marks changed revisions, orientation, settings and bed fit stale but respects a printer nozzle", () => {
  const current = input(),
    saved = report(current);
  expect(isReportStale(saved, current)).toBe(false);
  const changes = [
    { ...current, geometryRevision: "new" },
    { ...current, orientation: { quaternion: [1, 0, 0, 0] as const, sourceRevision: "v1" } },
    { ...current, settings: { ...current.settings, nozzleDiameterMm: 0.6 } },
    { ...current, settings: { ...current.settings, overhangAngleDegrees: 30 } },
    { ...current, settings: { ...current.settings, firstLayerHeightMm: 0.3 } },
    {
      ...current,
      settings: {
        ...current.settings,
        buildPlate: selectBed(current.settings.buildPlate, "sheet-a4"),
      },
    },
  ];
  for (const changed of changes) expect(isReportStale(saved, changed)).toBe(true);
  expect(
    isReportStale(
      { ...saved, settings: { ...saved.settings, nozzleSource: "printer" } },
      changes[2]!,
    ),
  ).toBe(false);
  expect(isReportStale({ ...saved, bed: { ...saved.bed, label: "old label" } }, current)).toBe(
    true,
  );
  expect(
    isReportStale({ ...saved, bed: { ...saved.bed, fit: "too-big", overMm: [1, 0, 0] } }, current),
  ).toBe(true);
});

it("shows and cancels a manual check from Markup while automatic checking is inactive", async () => {
  const pending = deferred<{ status: "ok"; report: PrintCheckReport }>();
  mocks.run.mockImplementation((command) =>
    command === mocks.check ? pending.promise : Promise.resolve(),
  );
  await update();
  let running!: Promise<void>;
  await act(async () => {
    running = check.run();
  });
  expect(check.running).toBe(true);
  expect(check.startedAt).not.toBeNull();
  await act(async () => {
    check.cancel();
  });
  expect(check.running).toBe(false);
  expect(mocks.run).toHaveBeenLastCalledWith(
    mocks.cancel,
    expect.objectContaining({ input: expect.objectContaining({ requestId: expect.any(String) }) }),
  );
  await act(async () => {
    pending.resolve({ status: "ok", report: report() });
    await running;
  });
  expect(check.report).toBeNull();
});

it("prevents a cancelled debounce or stale response from restarting or replacing a manual check", async () => {
  const first = deferred<{ status: "ok"; report: PrintCheckReport }>(),
    second = deferred<{ status: "ok"; report: PrintCheckReport }>();
  let calls = 0;
  mocks.run.mockImplementation((command) =>
    command === mocks.cancel ? Promise.resolve() : ++calls === 1 ? first.promise : second.promise,
  );
  const current = input({ active: true });
  await update(current);
  let firstRun!: Promise<void>, secondRun!: Promise<void>;
  await act(async () => {
    firstRun = check.run();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(calls).toBe(1);
  await act(async () => {
    secondRun = check.run();
  });
  expect(calls).toBe(2);
  await act(async () => {
    first.resolve({ status: "ok", report: { ...report(), checkedAt: "older" } });
    await firstRun;
  });
  expect(check.running).toBe(true);
  expect(check.report).toBeNull();
  await act(async () => {
    second.resolve({ status: "ok", report: { ...report(), checkedAt: "newer" } });
    await secondRun;
  });
  expect(check.report?.checkedAt).toBe("newer");
  expect(check.running).toBe(false);
});

it("debounces applied revisions and cancels the panel lease on tab and visibility changes", async () => {
  const first = deferred<{ status: "ok"; report: PrintCheckReport }>();
  mocks.run.mockImplementation((command) =>
    command === mocks.cancel ? Promise.resolve() : first.promise,
  );
  await update(input({ active: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await update(input({ active: true, geometryRevision: "geometry-2" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(799);
  });
  expect(mocks.run).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(check.running).toBe(true);
  await update(input({ active: false, geometryRevision: "geometry-2" }));
  expect(check.running).toBe(false);
  await act(async () => {
    first.resolve({ status: "ok", report: report(input({ geometryRevision: "geometry-2" })) });
  });
  expect(check.report).toBeNull();
  expect(mocks.run.mock.calls.filter(([command]) => command === mocks.cancel)).toHaveLength(1);
  await update(input({ active: true, enabled: false, geometryRevision: "geometry-2" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(mocks.run.mock.calls.filter(([command]) => command === mocks.check)).toHaveLength(1);
});

it("retains the last report as stale while rechecking and isolates workspace changes and failures", async () => {
  await update();
  await act(async () => {
    await check.run();
  });
  expect(check.report?.geometryRevision).toBe("geometry-1");
  await update(input({ geometryRevision: "geometry-2" }));
  expect(check.stale).toBe(true);
  const pending = deferred<{ status: "ok"; report: PrintCheckReport }>();
  mocks.run.mockImplementation((command) =>
    command === mocks.cancel ? Promise.resolve() : pending.promise,
  );
  let run!: Promise<void>;
  await act(async () => {
    run = check.run();
  });
  await update(input({ path: "other.scad" }));
  expect(check.report).toBeNull();
  expect(check.running).toBe(false);
  await act(async () => {
    pending.reject(new Error("Old workspace failed"));
    await run;
  });
  expect(check.error).toBeNull();
});

it("cleans up manual leases on unmount and lets Cancel stop an automatic debounce", async () => {
  const pending = deferred<{ status: "ok"; report: PrintCheckReport }>();
  mocks.run.mockImplementation((command) =>
    command === mocks.cancel ? Promise.resolve() : pending.promise,
  );
  await update(input());
  let running!: Promise<void>;
  await act(async () => {
    running = check.run();
  });
  await act(async () => {
    renderer?.unmount();
    renderer = undefined;
  });
  expect(mocks.run.mock.calls.filter(([command]) => command === mocks.cancel)).toHaveLength(1);
  await act(async () => {
    pending.resolve({ status: "ok", report: report() });
    await running;
  });
  mocks.run.mockClear();
  await update(input({ active: true }));
  await act(async () => {
    check.cancel();
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("treats scaled stored quaternions as the same rotation when keying and checking staleness", () => {
  const current = input({ orientation: { quaternion: [0, 0, 0, 2], sourceRevision: "legacy" } });
  const normalized = input({ orientation: { quaternion: [0, 0, 0, 1], sourceRevision: "legacy" } });
  expect(printCheckRequestKey(current)).toBe(printCheckRequestKey(normalized));
  expect(isReportStale(report(normalized), current)).toBe(false);
});
