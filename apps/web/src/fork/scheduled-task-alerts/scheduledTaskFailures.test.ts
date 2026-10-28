import { ScheduledTaskId, type ScheduledTaskRunStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  newScheduledTaskFailures,
  readScheduledTaskRunMarks,
  writeScheduledTaskRunMarks,
} from "./scheduledTaskFailures";

const run = (id: string, lastRunStatus: ScheduledTaskRunStatus, lastRunAt: string | null) => ({
  id: ScheduledTaskId.make(id),
  lastRunStatus,
  lastRunAt,
});

describe("newScheduledTaskFailures", () => {
  it("records the first list without calling old failures news", () => {
    const first = newScheduledTaskFailures(null, [run("nightly", "failed", "2026-10-25T02:00Z")]);
    expect(first.failed).toEqual([]);
    expect(
      newScheduledTaskFailures(first.marks, [run("nightly", "failed", "2026-10-25T02:00Z")]),
    ).toMatchObject({ failed: [] });
  });

  it("reports a run that failed since, once", () => {
    const seen = newScheduledTaskFailures(null, [
      run("nightly", "running", "2026-10-25T02:00Z"),
      run("weekly", "succeeded", "2026-10-20T02:00Z"),
    ]).marks;
    const failed = newScheduledTaskFailures(seen, [
      run("nightly", "failed", "2026-10-25T02:00Z"),
      run("weekly", "succeeded", "2026-10-20T02:00Z"),
    ]);
    expect(failed.failed.map((task) => task.id)).toEqual(["nightly"]);
    expect(
      newScheduledTaskFailures(failed.marks, [run("nightly", "failed", "2026-10-25T02:00Z")])
        .failed,
    ).toEqual([]);
  });

  it("reports a later failure of a task that failed before, and a task added since", () => {
    const seen = newScheduledTaskFailures(null, [
      run("nightly", "failed", "2026-10-24T02:00Z"),
    ]).marks;
    const next = newScheduledTaskFailures(seen, [
      run("nightly", "failed", "2026-10-25T02:00Z"),
      run("added", "failed", "2026-10-25T03:00Z"),
    ]);
    expect(next.failed.map((task) => task.id)).toEqual(["nightly", "added"]);
  });
});

describe("persisted scheduled-task marks", () => {
  it("reports missed failures on reopening, once and per environment", () => {
    const saved = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    });
    const first = newScheduledTaskFailures(null, [run("nightly", "succeeded", "before")]);
    writeScheduledTaskRunMarks("a", first.marks, storage);
    const missed = newScheduledTaskFailures(readScheduledTaskRunMarks("a", storage), [
      run("nightly", "failed", "after"),
    ]);
    expect(missed.failed).toHaveLength(1);
    writeScheduledTaskRunMarks("a", missed.marks, storage);
    expect(
      newScheduledTaskFailures(readScheduledTaskRunMarks("a", storage), [
        run("nightly", "failed", "after"),
      ]).failed,
    ).toEqual([]);
    expect(readScheduledTaskRunMarks("b", storage)).toBeNull();
  });
  it("ignores unavailable or corrupt storage", () => {
    expect(
      readScheduledTaskRunMarks("a", () => {
        throw new Error("unavailable");
      }),
    ).toBeNull();
    expect(
      readScheduledTaskRunMarks("a", () => ({ getItem: () => "[]", setItem: () => undefined })),
    ).toBeNull();
  });
});
