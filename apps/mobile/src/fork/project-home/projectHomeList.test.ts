import { buildProjectHome } from "@t3tools/client-runtime/fork";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import { projectHomeListItems } from "./projectHomeList";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");

describe("native project home paging", () => {
  it("pages sections independently and preserves the full count", () => {
    const threads = Array.from({ length: 45 }, (_, index) =>
      makeThreadShellFixture({
        environmentId,
        projectId,
        id: ThreadId.make(`thread-${index}`),
        title: `Thread ${index}`,
        settledOverride: index < 25 ? "settled" : null,
      }),
    );
    const model = buildProjectHome({
      projectRefs: [{ environmentId, projectId }],
      threads,
      connectedEnvironmentIds: new Set([environmentId]),
      getThreadActivity: (thread) => (thread.settledOverride === "settled" ? "settled" : "ready"),
    });
    const initial = projectHomeListItems(model, {});
    expect(initial.filter((item) => item.type === "thread")).toHaveLength(40);
    expect(initial.find((item) => item.type === "more")).toMatchObject({
      id: "history",
      hiddenCount: 5,
    });
    const expanded = projectHomeListItems(model, { history: 40 });
    expect(expanded.filter((item) => item.type === "thread")).toHaveLength(45);
    expect(expanded.find((item) => item.type === "more")).toBeUndefined();
    expect(model.counts.total).toBe(45);
  });
  it("keeps equal thread IDs on separate computers addressable and retains offline rows", () => {
    const remote = EnvironmentId.make("remote");
    const threads = [environmentId, remote].map((id) =>
      makeThreadShellFixture({
        environmentId: id,
        projectId,
        id: ThreadId.make("same"),
        title: "Work",
      }),
    );
    const model = buildProjectHome({
      projectRefs: [environmentId, remote].map((environmentId) => ({ environmentId, projectId })),
      threads,
      connectedEnvironmentIds: new Set([environmentId]),
      getThreadActivity: () => "working",
    });
    const items = projectHomeListItems(model, {});
    const rows = items.filter((item) => item.type === "thread");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(items.find((item) => item.type === "section" && item.id === "offline")).toMatchObject({
      count: 1,
    });
  });
});
