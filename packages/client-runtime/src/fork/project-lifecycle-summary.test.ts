import { ProjectId, ThreadId } from "@t3tools/contracts";
import type { ProjectLifecycleLane, ProjectLifecycleStatus } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  projectTemporaryResourceLabels,
  summarizeProjectTemporaryResources,
} from "./project-lifecycle-summary.ts";

const location = {
  rootPath: "/work/project",
  repositories: [
    {
      resourceId: "web",
      path: "/work/project/web",
      localProjectId: ProjectId.make("web"),
      head: null,
      branch: "main",
    },
    {
      resourceId: "shared",
      path: "/work/shared",
      localProjectId: ProjectId.make("shared"),
      head: null,
      branch: "main",
    },
  ],
};
function lane(overrides: Partial<ProjectLifecycleLane> = {}): ProjectLifecycleLane {
  return {
    id: "lane",
    projectId: ProjectId.make("a-different-project"),
    projectName: "Another project",
    name: "main",
    checkoutPath: location.rootPath,
    laneDir: "/lanes/lane",
    spacePath: "/lanes/lane/space",
    tmpPath: "/lanes/lane/space/tmp",
    buildPath: "/lanes/lane/space/build",
    dataPath: "/lanes/lane/space/data",
    backend: "folder",
    state: "ready",
    capBytes: 40e9,
    usedBytes: 2e9,
    imageBytes: 8e9,
    threadIds: [],
    running: false,
    createdAt: "2026-10-21T12:00:00.000Z",
    message: null,
    ports: null,
    leases: [],
    helpers: { run: "/helpers/run", slot: "/helpers/slot" },
    ...overrides,
  };
}
function status(lanes: readonly ProjectLifecycleLane[], enabled = true): ProjectLifecycleStatus {
  return {
    enabled,
    lanesRoot: "/lanes",
    backend: "folder",
    hostFreeBytes: null,
    hostTotalBytes: null,
    reserveBytes: 40e9,
    belowReserve: false,
    shell: { installed: false, profilePath: "/profile" },
    lanes,
    buildSlots: { count: 1, holders: [] },
  };
}
const labels = (lanes: readonly ProjectLifecycleLane[], enabled = true) =>
  projectTemporaryResourceLabels({
    location,
    status: status(lanes, enabled),
    connected: true,
    supported: true,
    failed: false,
  });

describe("temporary resources for a physical working location", () => {
  it("matches exact root and repository paths without guessing project identities or descendants", () => {
    const summary = summarizeProjectTemporaryResources(location, [
      lane(),
      lane({ id: "web", checkoutPath: "/work/project/web" }),
      lane({ id: "shared", checkoutPath: "/work/shared" }),
      lane({ id: "prefix", checkoutPath: "/work/project-other" }),
      lane({ id: "nested", checkoutPath: "/work/project/web/unregistered" }),
      lane({ id: "trailing", checkoutPath: "/work/project/" }),
      lane({ id: "case", checkoutPath: "/work/Project" }),
      lane({
        id: "same-project",
        projectId: location.repositories[0]!.localProjectId,
        projectName: "project",
        checkoutPath: "/other/project",
      }),
    ]);
    expect(summary.laneCount).toBe(3);
    expect(summary.measuredBytes).toBe(6e9);
  });

  it("deduplicates a lane, duplicate checkout references, conversations and attached resources", () => {
    const shared = lane({
      threadIds: [ThreadId.make("one"), ThreadId.make("two"), ThreadId.make("two")],
      running: true,
      leases: [{ kind: "simulator", ref: "device", label: "Simulator" }],
    });
    const another = lane({
      id: "other",
      checkoutPath: "/work/shared",
      threadIds: [ThreadId.make("two")],
      leases: shared.leases,
    });
    const summary = summarizeProjectTemporaryResources(
      {
        ...location,
        repositories: [
          ...location.repositories,
          { ...location.repositories[0]!, path: location.rootPath },
        ],
      },
      [shared, shared, another],
    );
    expect(summary).toMatchObject({
      laneCount: 2,
      measuredBytes: 4e9,
      conversationCount: 2,
      attachedResourceCount: 1,
      running: true,
      shared: true,
      waitingCleanupCount: 0,
    });
    expect(labels([shared, another]).activity).toBe(
      "Work running · 2 conversations holding resources (shared) · 1 attached resource",
    );
  });

  it("reports the same shared checkout for each project that explicitly includes it", () => {
    const shared = lane({ checkoutPath: "/work/shared" });
    expect(summarizeProjectTemporaryResources(location, [shared]).laneCount).toBe(1);
    expect(
      summarizeProjectTemporaryResources(
        { rootPath: "/another/project", repositories: [location.repositories[1]!] },
        [shared],
      ).laneCount,
    ).toBe(1);
    expect(
      summarizeProjectTemporaryResources({ rootPath: "/another/project", repositories: [] }, [
        shared,
      ]).laneCount,
    ).toBe(0);
  });

  it("keeps unknown and partial usage distinct from a measured zero, cap and image size", () => {
    expect(labels([lane({ usedBytes: null })]).usage).toBe("Usage not measured");
    expect(labels([lane({ usedBytes: 0 })]).usage).toBe("0 B used");
    expect(labels([lane(), lane({ id: "unknown", usedBytes: null })]).usage).toBe(
      "2.0 GB measured; some usage unknown",
    );
    expect(labels([lane()]).usage).toBe("2.0 GB used");
    expect(summarizeProjectTemporaryResources(location, [lane({ usedBytes: null })])).toMatchObject(
      {
        measuredBytes: null,
        unknownUsageCount: 1,
      },
    );
  });

  it("distinguishes held conversations, pending cleanup and failed resources", () => {
    expect(labels([lane({ threadIds: [ThreadId.make("held")] })]).activity).toBe(
      "1 conversation holding resources",
    );
    expect(
      labels([lane({ message: "Waiting for the project's finish action to complete." })]).activity,
    ).toBe("Waiting for cleanup");
    expect(labels([lane({ state: "error" })]).activity).toBe(
      "Waiting for cleanup · Resources need attention",
    );
    expect(labels([])).toEqual({ usage: "No temporary resources for these files", activity: null });
  });

  it("reports disabled cleanup while retaining measured usage for existing resources", () => {
    expect(labels([lane()], false)).toEqual({
      usage: "2.0 GB used",
      activity: "Temporary resource cleanup is off on this computer",
    });
    expect(labels([], false).activity).toBe("Temporary resource cleanup is off on this computer");
  });

  it.each([
    {
      connected: false,
      supported: true,
      failed: false,
      usage: "Computer offline. Reconnect to check temporary resources.",
    },
    {
      connected: true,
      supported: false,
      failed: false,
      usage: "Temporary resource status is unavailable on this computer.",
    },
    {
      connected: true,
      supported: true,
      failed: true,
      usage: "Temporary resource status could not be read.",
    },
  ])("does not display cached usage when $usage", ({ usage, ...availability }) => {
    expect(
      projectTemporaryResourceLabels({ location, status: status([lane()]), ...availability }),
    ).toEqual({ usage, activity: null });
  });

  it("does not treat a pending first read as an empty resource list", () => {
    expect(
      projectTemporaryResourceLabels({
        location,
        status: null,
        connected: true,
        supported: true,
        failed: false,
      }),
    ).toEqual({ usage: "Checking temporary resources…", activity: null });
  });
});
