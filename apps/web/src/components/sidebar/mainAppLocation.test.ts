import { describe, expect, it } from "vite-plus/test";
import { isSidebarUtilityPage } from "./mainAppLocation";

describe("sidebar return destination", () => {
  it("does not remember Computers as the thread destination for Back", () => {
    expect(isSidebarUtilityPage("/computers")).toBe(true);
    expect(isSidebarUtilityPage("/settings/connections")).toBe(true);
    expect(isSidebarUtilityPage("/pull-requests")).toBe(true);
  });

  it("still remembers native thread and draft routes", () => {
    expect(isSidebarUtilityPage("/environment-id/computers")).toBe(false);
    expect(isSidebarUtilityPage("/draft/draft-id")).toBe(false);
  });
});
