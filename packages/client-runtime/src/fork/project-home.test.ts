import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildProjectHome, resolveProjectHomeDestination } from "./project-home.ts";
import type {
  ProjectNavigationThread,
  ProjectNavigationThreadActivity,
} from "./project-navigation.ts";

const mac = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const projectId = ProjectId.make("loom");
const refs = [mac, pi].map((environmentId) => ({ environmentId, projectId }));
interface TestThread extends ProjectNavigationThread {
  readonly activity: ProjectNavigationThreadActivity;
}
function thread(id: string, patch: Partial<TestThread> = {}): TestThread {
  return {
    id: ThreadId.make(id),
    environmentId: mac,
    projectId,
    title: id,
    createdAt: "2026-10-13T12:00:00Z",
    updatedAt: "2026-10-13T13:00:00Z",
    activity: "ready",
    ...patch,
  };
}
function home(threads: ReadonlyArray<TestThread>, connected = new Set([mac, pi])) {
  return buildProjectHome({
    projectRefs: refs,
    threads,
    getThreadActivity: (value) => value.activity,
    connectedEnvironmentIds: connected,
  });
}

describe("project home work", () => {
  it("includes all conversations beyond the library preview and keeps work states separate", () => {
    const ready = Array.from({ length: 25 }, (_, index) => thread(`ready-${index}`));
    const model = home([
      ...ready,
      thread("approval", { activity: "attention" }),
      thread("failed", { activity: "failed" }),
      thread("running", { activity: "working" }),
      thread("paused", { activity: "snoozed" }),
      thread("settled", { activity: "settled" }),
    ]);
    expect(model.counts).toEqual({
      total: 30,
      ready: 25,
      attention: 2,
      working: 1,
      snoozed: 1,
      settled: 1,
      offline: 0,
    });
    expect(
      model.sections
        .find((section) => section.id === "attention")
        ?.rows.map((row) => row.thread.id),
    ).toEqual(["approval", "failed"]);
    expect(model.sections.find((section) => section.id === "ready")?.rows).toHaveLength(25);
  });

  it("joins by computer and project, keeps the newest duplicate and excludes removed work", () => {
    const model = home([
      thread("same", { title: "old" }),
      thread("same", { title: "new", updatedAt: "2026-10-13T14:00:00Z" }),
      thread("same", { environmentId: pi, title: "Pi" }),
      thread("unrelated", { projectId: ProjectId.make("other") }),
      thread("archived", { archivedAt: "2026-10-13T14:00:00Z" }),
      thread("deleted", { deletedAt: "2026-10-13T14:00:00Z" }),
    ]);
    expect(model.counts.total).toBe(2);
    expect(
      model.sections.find((section) => section.id === "ready")?.rows.map((row) => row.thread.title),
    ).toEqual(["new", "Pi"]);
  });

  it("treats cached running and waiting threads as last known, while retaining settled history counts", () => {
    const model = home(
      [
        thread("live", { activity: "working" }),
        thread("old-approval", { environmentId: pi, activity: "attention" }),
        thread("old-running", { environmentId: pi, activity: "working" }),
        thread("old-history", { environmentId: pi, activity: "settled" }),
      ],
      new Set([mac]),
    );
    expect(model.counts.attention).toBe(0);
    expect(model.counts.working).toBe(1);
    expect(model.counts.offline).toBe(3);
    expect(model.counts.settled).toBe(1);
    expect(
      model.sections
        .find((section) => section.id === "offline")
        ?.rows.every((row) => !row.connected),
    ).toBe(true);
  });

  it("orders recent work deterministically when timestamps are missing or invalid", () => {
    const model = home([
      thread("z", { updatedAt: "invalid", createdAt: "invalid" }),
      thread("a", { updatedAt: "invalid", createdAt: "invalid" }),
      thread("recent", { updatedAt: "2026-10-13T15:00:00Z" }),
    ]);
    expect(
      model.sections.find((section) => section.id === "ready")?.rows.map((row) => row.thread.id),
    ).toEqual(["recent", "a", "z"]);
  });

  it("retains an empty project with empty sections", () => {
    expect(home([]).counts.total).toBe(0);
    expect(home([]).sections.every((section) => section.rows.length === 0)).toBe(true);
  });
});

describe("explicit project execution computer", () => {
  const members = [mac, pi].map((environmentId) => ({ environmentId, id: projectId }));
  const defaults = {
    memberProjects: members,
    preferredProjectRef: refs[0]!,
    connectedEnvironmentIds: new Set([mac, pi]),
    permittedEnvironmentIds: new Set([mac, pi]),
  };
  it("prefers the current member then falls back to an eligible computer before any explicit choice", () => {
    expect(resolveProjectHomeDestination(defaults)).toBe(members[0]);
    expect(
      resolveProjectHomeDestination({ ...defaults, permittedEnvironmentIds: new Set([pi]) }),
    ).toBe(members[1]);
  });
  it("uses the explicitly selected computer", () => {
    expect(resolveProjectHomeDestination({ ...defaults, chosenProjectRef: refs[1]! })).toBe(
      members[1],
    );
  });
  it("does not switch computers silently when the chosen host becomes offline or read-only", () => {
    expect(
      resolveProjectHomeDestination({
        ...defaults,
        chosenProjectRef: refs[0]!,
        connectedEnvironmentIds: new Set([pi]),
      }),
    ).toBeNull();
    expect(
      resolveProjectHomeDestination({
        ...defaults,
        chosenProjectRef: refs[0]!,
        permittedEnvironmentIds: new Set([pi]),
      }),
    ).toBeNull();
  });
  it("rejects removed or unrelated explicit members", () => {
    expect(
      resolveProjectHomeDestination({
        ...defaults,
        memberProjects: members.slice(1),
        chosenProjectRef: refs[0]!,
      }),
    ).toBeNull();
    expect(
      resolveProjectHomeDestination({
        ...defaults,
        chosenProjectRef: { environmentId: mac, projectId: ProjectId.make("other") },
      }),
    ).toBeNull();
  });
});
