import { describe, expect, it } from "vite-plus/test";
import { decodeProjectNavigationView, readProjectNavigationView } from "./preference";
import { projectNavigationViewForKey } from "./ProjectNavigationSwitch";

describe("project navigation preference", () => {
  it("defaults to Threads for absent, old or invalid saved preferences", () => {
    for (const value of [null, undefined, "files", "", {}, '"projects"']) {
      expect(decodeProjectNavigationView(value)).toBe("threads");
    }
    expect(decodeProjectNavigationView("projects")).toBe("projects");
    expect(decodeProjectNavigationView("threads")).toBe("threads");
  });

  it("keeps navigation available when client storage is blocked", () => {
    expect(readProjectNavigationView(null)).toBe("threads");
    expect(
      readProjectNavigationView({
        getItem: () => {
          throw new Error("Storage disabled");
        },
      }),
    ).toBe("threads");
    expect(readProjectNavigationView({ getItem: () => "projects" })).toBe("projects");
  });
});

describe("project navigation keyboard selection", () => {
  it("cycles tabs using arrows and supports Home and End", () => {
    expect(projectNavigationViewForKey("threads", "ArrowRight")).toBe("projects");
    expect(projectNavigationViewForKey("projects", "ArrowRight")).toBe("threads");
    expect(projectNavigationViewForKey("threads", "ArrowLeft")).toBe("projects");
    expect(projectNavigationViewForKey("projects", "ArrowLeft")).toBe("threads");
    expect(projectNavigationViewForKey("projects", "Home")).toBe("threads");
    expect(projectNavigationViewForKey("threads", "End")).toBe("projects");
    expect(projectNavigationViewForKey("threads", "Enter")).toBeNull();
  });
});
