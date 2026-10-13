import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectNavigationEntries,
  PROJECT_NAVIGATION_PREVIEW_LIMIT,
  resolveLoomNavigatorView,
  type ProjectNavigationGroup,
  type ProjectNavigationThread,
  type ProjectNavigationThreadActivity,
} from "./project-navigation.ts";

const mac = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const projectId = ProjectId.make("project");
const group: ProjectNavigationGroup = {
  key: "github.com/kyle/loom",
  title: "Loom",
  projectRefs: [
    { environmentId: mac, projectId },
    { environmentId: pi, projectId },
  ],
};

interface TestThread extends ProjectNavigationThread {
  readonly activity: ProjectNavigationThreadActivity;
}

function thread(id: string, patch: Partial<TestThread> = {}): TestThread {
  return {
    id: ThreadId.make(id),
    environmentId: mac,
    projectId,
    title: id,
    createdAt: "2026-10-13T10:00:00Z",
    updatedAt: "2026-10-13T11:00:00Z",
    activity: "ready",
    ...patch,
  };
}

function entries(threads: ReadonlyArray<TestThread>, searchQuery = "") {
  return buildProjectNavigationEntries({
    groups: [group],
    threads,
    searchQuery,
    getThreadActivity: (value) => value.activity,
  });
}

describe("durable project navigation", () => {
  it("retains a project with no threads or present checkout", () => {
    const releasedProject = { ...group, checkoutPresent: false };
    const result = buildProjectNavigationEntries({
      groups: [releasedProject],
      threads: [],
      getThreadActivity: () => "ready",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.group).toBe(releasedProject);
    expect(result[0]?.threadCount).toBe(0);
    expect(result[0]?.environmentIds).toEqual([mac, pi]);
  });

  it("joins the same repository across computers without thread ID collisions", () => {
    const result = entries([
      thread("same", { activity: "working" }),
      thread("same", { environmentId: pi, activity: "settled" }),
      thread("other-project", { projectId: ProjectId.make("unrelated") }),
    ])[0]!;
    expect(result.threadCount).toBe(2);
    expect(result.workingCount).toBe(1);
    expect(result.settledCount).toBe(1);
    expect(result.previewThreads.map((value) => value.environmentId)).toEqual([mac, pi]);
  });

  it("retains settled history without calling idle threads completed", () => {
    const result = entries([thread("ready"), thread("history", { activity: "settled" })])[0]!;
    expect(result.activeCount).toBe(1);
    expect(result.readyCount).toBe(1);
    expect(result.settledCount).toBe(1);
  });

  it("keeps offline snapshots discoverable without reporting live work or attention", () => {
    const result = buildProjectNavigationEntries({
      groups: [group],
      threads: [
        thread("live", { activity: "ready" }),
        thread("stale-running", { environmentId: pi, activity: "working" }),
        thread("stale-approval", { environmentId: pi, activity: "attention" }),
        thread("stale-failure", { environmentId: pi, activity: "failed" }),
      ],
      getThreadActivity: (value) => value.activity,
      connectedEnvironmentIds: new Set([mac]),
    })[0]!;
    expect(result.threadCount).toBe(4);
    expect(result.offlineCount).toBe(3);
    expect(result.workingCount).toBe(0);
    expect(result.attentionCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.previewThreads[0]?.id).toBe("live");
  });

  it("counts offline settled history as history", () => {
    const result = buildProjectNavigationEntries({
      groups: [group],
      threads: [thread("history", { environmentId: pi, activity: "settled" })],
      getThreadActivity: (value) => value.activity,
      connectedEnvironmentIds: new Set<EnvironmentId>(),
    })[0]!;
    expect(result.settledCount).toBe(1);
    expect(result.offlineCount).toBe(1);
    expect(result.activeCount).toBe(0);
  });

  it("filters projects by a member thread title and previews the matching conversation", () => {
    const matching = thread("receipt", { title: "Repair the Dropbox intake" });
    const result = entries([thread("other", { activity: "attention" }), matching], " DROPBOX ")[0]!;
    expect(result.threadCount).toBe(2);
    expect(result.previewThreads).toEqual([matching]);
    expect(entries([matching], "not present")).toEqual([]);
  });

  it("matches an empty project by its name and shows all previews when the name matches", () => {
    expect(entries([], "loom")).toHaveLength(1);
    expect(entries([thread("unrelated title")], "LooM")[0]?.previewThreads).toHaveLength(1);
  });

  it("omits deleted or archived conversations and honors the newest duplicate snapshot", () => {
    const result = entries([
      thread("archived", { archivedAt: "2026-10-13T12:00:00Z" }),
      thread("deleted", { deletedAt: "2026-10-13T12:00:00Z" }),
      thread("duplicate", { activity: "working" }),
      thread("duplicate", { activity: "settled", updatedAt: "2026-10-13T12:00:00Z" }),
      thread("archived-later"),
      thread("archived-later", {
        archivedAt: "2026-10-13T12:00:00Z",
        updatedAt: "2026-10-13T12:00:00Z",
      }),
    ])[0]!;
    expect(result.threadCount).toBe(1);
    expect(result.settledCount).toBe(1);
  });

  it("prioritizes attention, then failures and work, while bounding inline history", () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      thread(`history-${index}`, { activity: "settled" }),
    );
    const result = entries([
      ...history,
      thread("working", { activity: "working" }),
      thread("failed", { activity: "failed" }),
      thread("attention", { activity: "attention" }),
    ])[0]!;
    expect(result.previewThreads.map((value) => value.id).slice(0, 3)).toEqual([
      "attention",
      "failed",
      "working",
    ]);
    expect(result.previewThreads).toHaveLength(PROJECT_NAVIGATION_PREVIEW_LIMIT);
    expect(result.hiddenThreadCount).toBe(15);
    expect(result.threadCount).toBe(23);
  });

  it("keeps the supplied project ordering and deduplicates repeated member references", () => {
    const repeated = { ...group, projectRefs: [...group.projectRefs, group.projectRefs[0]!] };
    const empty = { ...group, key: "empty", title: "Empty", projectRefs: [] };
    const result = buildProjectNavigationEntries({
      groups: [empty, repeated],
      threads: [thread("work")],
      getThreadActivity: (value) => value.activity,
    });
    expect(result.map((entry) => entry.key)).toEqual(["empty", group.key]);
    expect(result[1]?.threadCount).toBe(1);
  });

  it("uses valid timestamps and a stable tiebreak for malformed history", () => {
    const result = entries([
      thread("bad", { createdAt: "invalid", updatedAt: "invalid" }),
      thread("new", { updatedAt: "2026-10-13T13:00:00Z" }),
      thread("old", { updatedAt: "2026-10-13T12:00:00Z" }),
    ])[0]!;
    expect(result.previewThreads.map((value) => value.id)).toEqual(["new", "old", "bad"]);
  });
});

describe("navigation preference compatibility", () => {
  it("accepts Projects and safely defaults missing, corrupt or future values to Threads", () => {
    expect(resolveLoomNavigatorView("projects")).toBe("projects");
    for (const value of [undefined, null, "files", {}, [], 1, "threads"]) {
      expect(resolveLoomNavigatorView(value)).toBe("threads");
    }
  });
});
