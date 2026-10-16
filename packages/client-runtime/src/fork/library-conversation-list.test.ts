import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";
import {
  conversationStatus,
  filterConversations,
  sortConversations,
} from "./library-conversation-list.ts";

const dorothy = EnvironmentId.make("dorothy");
const nora = EnvironmentId.make("nora");
const project: LibraryProject = {
  id: "project",
  title: "Presence",
  brief: "",
  revision: 1,
  resources: [
    {
      id: "app",
      kind: "repository",
      title: "presence-app",
      remoteUrl: "https://github.com/kyle/presence-app",
      relativePath: "presence-app",
      defaultBranch: null,
    },
  ],
  archived: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const thread = (patch: Partial<LibraryThreadSummary>): LibraryThreadSummary => ({
  id: "summary",
  projectId: "project",
  environmentId: dorothy,
  threadId: ThreadId.make("thread"),
  localProjectId: ProjectId.make("local"),
  workingCopyId: null,
  resourceIds: [],
  title: "Thread",
  status: "idle",
  archived: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  syncedAt: "2026-10-01T00:00:00.000Z",
  sequence: 0,
  ...patch,
});

const collector = thread({
  id: "collector",
  title: "Wire the timeline collector",
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
});
const pricing = thread({
  id: "pricing",
  title: "draft the pricing page",
  environmentId: nora,
  resourceIds: ["app"],
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
const untitled = thread({
  id: "untitled",
  title: "",
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
});
const threads = [collector, pricing, untitled];
const label = (id: EnvironmentId) => (id === nora ? "Nora" : "Dorothy");
const ids = (list: readonly LibraryThreadSummary[]) => list.map((entry) => entry.id);
const none = { search: "", computer: null, resourceId: null };

describe("filterConversations", () => {
  it("searches titles, computers and repositories without regard to case", () => {
    expect(
      ids(filterConversations(threads, project, { ...none, search: "TIMELINE" }, label)),
    ).toEqual(["collector"]);
    expect(ids(filterConversations(threads, project, { ...none, search: "nora" }, label))).toEqual([
      "pricing",
    ]);
    expect(
      ids(filterConversations(threads, project, { ...none, search: "presence-app" }, label)),
    ).toEqual(["pricing"]);
    expect(
      ids(filterConversations(threads, project, { ...none, search: "untitled" }, label)),
    ).toEqual(["untitled"]);
  });

  it("narrows to one computer or one repository", () => {
    expect(
      ids(filterConversations(threads, project, { ...none, computer: dorothy }, label)),
    ).toEqual(["collector", "untitled"]);
    expect(
      ids(filterConversations(threads, project, { ...none, resourceId: "app" }, label)),
    ).toEqual(["pricing"]);
  });
});

describe("sortConversations", () => {
  it("orders by activity, creation or name, with untitled conversations sorted by their label", () => {
    expect(ids(sortConversations(threads, "activity"))).toEqual([
      "collector",
      "untitled",
      "pricing",
    ]);
    expect(ids(sortConversations(threads, "created"))).toEqual([
      "untitled",
      "pricing",
      "collector",
    ]);
    expect(ids(sortConversations(threads, "name"))).toEqual(["pricing", "untitled", "collector"]);
  });
});

describe("conversationStatus", () => {
  it("files saved conversations by what the Library recorded", () => {
    expect(conversationStatus(collector, null)).toEqual({ lane: "active", activity: null });
    expect(conversationStatus(thread({ settled: true }), null)).toEqual({
      lane: "settled",
      activity: "settled",
    });
    expect(conversationStatus(thread({ settled: true, archived: true }), null).lane).toBe(
      "archived",
    );
  });

  it("keeps a saved failure but never claims a saved run is still working", () => {
    expect(conversationStatus(thread({ status: "failed" }), null).activity).toBe("failed");
    expect(conversationStatus(thread({ status: "running" }), null).activity).toBeNull();
  });

  it("prefers what a connected computer reports right now", () => {
    const saved = thread({ settled: true });
    expect(conversationStatus(saved, { archived: false, activity: "working" })).toEqual({
      lane: "active",
      activity: "working",
    });
    expect(conversationStatus(collector, { archived: false, activity: "settled" }).lane).toBe(
      "settled",
    );
    expect(conversationStatus(collector, { archived: true, activity: "ready" }).lane).toBe(
      "archived",
    );
  });
});
