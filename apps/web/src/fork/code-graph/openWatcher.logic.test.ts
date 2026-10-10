import { describe, expect, it } from "vite-plus/test";

import {
  REMEMBERED_PROJECTS,
  REPORT_INTERVAL_MS,
  shouldReportProjectOpen,
} from "./openWatcher.logic";

describe("shouldReportProjectOpen", () => {
  it("reports a project once per interval", () => {
    const reported = new Map<string, number>();
    expect(shouldReportProjectOpen(reported, "env:p1", 0)).toBe(true);
    expect(shouldReportProjectOpen(reported, "env:p1", REPORT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldReportProjectOpen(reported, "env:p2", 1)).toBe(true);
    expect(shouldReportProjectOpen(reported, "env:p1", REPORT_INTERVAL_MS)).toBe(true);
  });

  it("forgets the least recently reported project beyond the limit", () => {
    const reported = new Map<string, number>();
    for (let i = 0; i <= REMEMBERED_PROJECTS; i += 1) shouldReportProjectOpen(reported, `p${i}`, 0);
    expect(reported.size).toBe(REMEMBERED_PROJECTS);
    expect(reported.has("p0")).toBe(false);
    expect(shouldReportProjectOpen(reported, "p0", 1)).toBe(true);
  });
});
