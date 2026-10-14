import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { createProjectLibraryPresentation } from "./project-library-presentation.ts";
const mac = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const names = new Map([
  [mac, "Dorothy"],
  [pi, "Dorothy"],
]);
const entry = {
  threadCount: 70,
  attentionCount: 0,
  failedCount: 0,
  workingCount: 0,
  readyCount: 17,
  snoozedCount: 0,
  settledCount: 53,
  offlineCount: 0,
  environmentIds: [mac, pi],
};
describe("Project library summaries", () => {
  it("counts distinct computers rather than labels or working copies", () => {
    const result = createProjectLibraryPresentation(
      { ...entry, environmentIds: [mac, mac, pi] },
      names,
      new Set([mac, pi]),
    );
    expect(result.metadata).toBe("70 threads on 2 computers");
    expect(result.status).toEqual({ kind: "ready", label: "17 ready" });
    expect(result.accessibilitySummary).toContain("17 ready to continue");
    expect(result.accessibilitySummary).toContain("53 settled");
  });
  it("shows the highest priority live work and preserves every count in the full summary", () => {
    const result = createProjectLibraryPresentation(
      { ...entry, attentionCount: 1, failedCount: 2, workingCount: 3, snoozedCount: 4 },
      names,
      new Set([mac, pi]),
    );
    expect(result.status).toEqual({ kind: "attention", label: "1 attention" });
    for (const count of ["1 needs attention", "2 failed", "3 working", "4 snoozed"])
      expect(result.accessibilitySummary).toContain(count);
  });
  it("does not present disconnected cached work as live or settled", () => {
    const result = createProjectLibraryPresentation(
      { ...entry, workingCount: 2, settledCount: 70, offlineCount: 70 },
      names,
      new Set(),
    );
    expect(result.status).toEqual({ kind: "offline", label: "Offline" });
    expect(result.accessibilitySummary).toContain("Dorothy (offline)");
    expect(result.accessibilitySummary).toContain("Last known activity:");
    expect(result.accessibilitySummary).toContain("70 last known on offline computers");
  });
  it.each([
    { failedCount: 2, kind: "failed", label: "2 failed" },
    { workingCount: 3, kind: "working", label: "3 working" },
    { snoozedCount: 4, kind: "snoozed", label: "4 snoozed" },
  ])("distinguishes %s from inactive history", ({ kind, label, ...counts }) => {
    const result = createProjectLibraryPresentation(
      { ...entry, readyCount: 0, ...counts },
      names,
      new Set([mac, pi]),
    );
    expect(result.status).toEqual({ kind, label });
  });
  it("handles empty projects and missing computer labels", () => {
    const result = createProjectLibraryPresentation(
      { ...entry, threadCount: 0, readyCount: 0, settledCount: 0, environmentIds: [mac] },
      new Map(),
      new Set([mac]),
    );
    expect(result.status).toBeNull();
    expect(result.metadata).toBe("No threads yet on Computer");
  });
  it("marks settled history quietly and names a single computer", () => {
    const result = createProjectLibraryPresentation(
      { ...entry, readyCount: 0, settledCount: 70, environmentIds: [mac] },
      names,
      new Set([mac]),
    );
    expect(result.status).toEqual({ kind: "settled", label: "Settled" });
    expect(result.metadata).toBe("70 threads on Dorothy");
  });
});
