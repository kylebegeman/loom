import { it, expect } from "vite-plus/test";
import { groupOutputs, checklistTone, isPackageStale, checklistText } from "./fabPackage.logic";
import type { PcbFabPackageSummary, PcbFabChecklistItem } from "@t3tools/contracts/fork";
it("groups package files, preserves manual reminders and marks stale revisions", () => {
  expect(
    groupOutputs([
      { path: "gerbers/top.gtl", kind: "gerber", bytes: 5 },
      { path: "CHECKLIST.md", kind: "checklist", bytes: 10 },
    ]).map((g) => g.name),
  ).toEqual(["gerbers", "Package"]);
  const items: PcbFabChecklistItem[] = [
    { id: "polarity", status: "manual", title: "Polarity", detail: "Check pin 1" },
  ];
  expect(checklistTone(items)).toBe("success");
  expect(checklistTone([{ ...items[0]!, status: "fail" }])).toBe("error");
  expect(checklistText({ id: "main", verdict: "ready", checklist: items })).toContain(
    "Check pin 1",
  );
  const summary = { sourceHash: "one" } as PcbFabPackageSummary;
  expect(isPackageStale(summary, "two")).toBe(true);
  expect(isPackageStale(summary, null)).toBe(false);
});
