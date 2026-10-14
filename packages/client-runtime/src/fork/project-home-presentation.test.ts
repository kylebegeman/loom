import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildProjectHome } from "./project-home.ts";
import { selectProjectHomeConversations } from "./project-home-presentation.ts";
import type { ProjectNavigationThreadActivity } from "./project-navigation.ts";

const mac = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const projectId = ProjectId.make("project");
function home(
  rows: readonly { title: string; activity: ProjectNavigationThreadActivity; offline?: boolean }[],
) {
  const threads = rows.map((row, index) => ({
    ...row,
    id: ThreadId.make(`thread-${index}`),
    environmentId: row.offline ? pi : mac,
    projectId,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T01:00:00Z",
  }));
  return buildProjectHome({
    projectRefs: [mac, pi].map((environmentId) => ({ environmentId, projectId })),
    threads,
    getThreadActivity: (thread) => thread.activity,
    connectedEnvironmentIds: new Set([mac]),
  });
}
function titles(result: ReturnType<typeof selectProjectHomeConversations>) {
  return result.sections.flatMap((section) => section.rows.map((row) => row.thread.title));
}

describe("project conversation views", () => {
  it("keeps open work focused without dropping snoozed work or history from the inventory", () => {
    const model = home([
      { title: "Approval", activity: "attention" },
      { title: "Retry", activity: "failed" },
      { title: "Build", activity: "working" },
      { title: "Continue", activity: "ready" },
      { title: "Later", activity: "snoozed" },
      { title: "Done", activity: "settled" },
    ]);
    const result = selectProjectHomeConversations({ sections: model.sections, view: null });
    expect(result.view).toBe("open");
    expect(titles(result)).toEqual(["Approval", "Retry", "Build", "Continue"]);
    expect(result.counts).toEqual({ open: 4, snoozed: 1, history: 1, all: 6 });
  });
  it("classifies offline snapshots by stored activity while preserving their offline section", () => {
    const model = home([
      { title: "Cached open", activity: "working", offline: true },
      { title: "Cached later", activity: "snoozed", offline: true },
      { title: "Cached done", activity: "settled", offline: true },
    ]);
    const result = selectProjectHomeConversations({ sections: model.sections, view: "history" });
    expect(result.counts).toEqual({ open: 1, snoozed: 1, history: 1, all: 3 });
    expect(titles(result)).toEqual(["Cached done"]);
    const cached = result.sections.find((section) => section.id === "offline")!;
    expect(cached.rows).toHaveLength(1);
    expect(cached.rows[0]!.connected).toBe(false);
  });
  it("finds history globally while retaining the selected view and full counts", () => {
    const model = home([
      { title: "Current task", activity: "ready" },
      ...Array.from({ length: 70 }, (_, index) => ({
        title: `Archived task ${index + 1}`,
        activity: "settled" as const,
      })),
    ]);
    const result = selectProjectHomeConversations({
      sections: model.sections,
      view: "open",
      query: "  ARCHIVED TASK 70  ",
    });
    expect(result.searching).toBe(true);
    expect(result.view).toBe("open");
    expect(result.matchingCount).toBe(1);
    expect(titles(result)).toEqual(["Archived task 70"]);
    expect(result.counts.all).toBe(71);
    expect(
      titles(
        selectProjectHomeConversations({ sections: model.sections, view: result.view, query: "" }),
      ),
    ).toEqual(["Current task"]);
  });
  it("opens a history-only project on its history rather than an empty work view", () => {
    const model = home([{ title: "Done", activity: "settled" }]);
    const result = selectProjectHomeConversations({ sections: model.sections, view: null });
    expect(result.view).toBe("history");
    expect(titles(result)).toEqual(["Done"]);
  });
  it("retains an explicit empty view and makes snoozed-only work discoverable by default", () => {
    const model = home([{ title: "Tomorrow", activity: "snoozed" }]);
    expect(selectProjectHomeConversations({ sections: model.sections, view: null }).view).toBe(
      "snoozed",
    );
    const explicit = selectProjectHomeConversations({ sections: model.sections, view: "open" });
    expect(explicit.view).toBe("open");
    expect(explicit.matchingCount).toBe(0);
  });
  it("retains an empty project and exposes all work without changing section priority", () => {
    expect(selectProjectHomeConversations({ sections: home([]).sections, view: null }).view).toBe(
      "open",
    );
    const model = home([
      { title: "Done", activity: "settled" },
      { title: "Next", activity: "ready" },
      { title: "Later", activity: "snoozed" },
    ]);
    expect(
      titles(selectProjectHomeConversations({ sections: model.sections, view: "all" })),
    ).toEqual(["Next", "Later", "Done"]);
    expect(model.counts.total).toBe(3);
  });
});
