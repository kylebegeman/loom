import { describe, expect, it } from "vite-plus/test";
import { isAppModalPage, isSidebarUtilityPage } from "./mainAppLocation";

describe("sidebar return destination", () => {
  it("does not remember Computers as the thread destination for Back", () => {
    expect(isSidebarUtilityPage("/computers")).toBe(true);
    expect(isAppModalPage("/settings/connections")).toBe(true);
    expect(isSidebarUtilityPage("/pull-requests")).toBe(true);
  });

  it("returns from project management to the previous thread rather than remembering it as chat", () => {
    expect(isSidebarUtilityPage("/projects")).toBe(true);
    expect(isSidebarUtilityPage("/projects/")).toBe(true);
    expect(isSidebarUtilityPage("/library")).toBe(true);
    expect(isSidebarUtilityPage("/library/")).toBe(true);
    expect(isSidebarUtilityPage("/")).toBe(false);
  });

  it("still remembers native thread and draft routes", () => {
    expect(isSidebarUtilityPage("/environment-id/computers")).toBe(false);
    expect(isSidebarUtilityPage("/draft/draft-id")).toBe(false);
  });
});
