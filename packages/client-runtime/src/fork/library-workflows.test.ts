import { describe, expect, it } from "vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryOperation,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  sortLibraryOperations,
  sortWorkstreams,
  workstreamLinkOptions,
  workstreamProgress,
  workstreamReferenceThread,
} from "./library-workflows.ts";
import { libraryProjectAttention } from "./library-attention.ts";

const computer = EnvironmentId.make("computer");
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const operation = (patch: Partial<LibraryOperation>): LibraryOperation => ({
  id: "op",
  kind: "prepare",
  projectId: "project",
  environmentId: computer,
  state: "succeeded",
  phase: "Done",
  attempt: 1,
  error: null,
  result: null,
  createdAt: at(1),
  updatedAt: at(1),
  ...patch,
});

const thread = (patch: Partial<LibraryThreadSummary>): LibraryThreadSummary => ({
  id: "summary",
  projectId: "project",
  environmentId: computer,
  threadId: ThreadId.make("thread"),
  localProjectId: ProjectId.make("local"),
  workingCopyId: null,
  resourceIds: [],
  title: "Thread",
  status: "idle",
  archived: false,
  createdAt: at(1),
  updatedAt: at(1),
  syncedAt: at(1),
  sequence: 0,
  ...patch,
});

const copy = (patch: Partial<LibraryWorkingCopy>) =>
  ({
    id: "copy",
    projectId: "project",
    environmentId: computer,
    rootPath: "/work/project",
    state: "ready",
    repositories: [],
    ...patch,
  }) as LibraryWorkingCopy;

describe("library workflow presentation", () => {
  it("leads operations with work that can still change, then newest", () => {
    const sorted = sortLibraryOperations([
      operation({ id: "old-done", updatedAt: at(1) }),
      operation({ id: "new-done", updatedAt: at(5) }),
      operation({ id: "failed", state: "failed", updatedAt: at(2) }),
      operation({ id: "running", state: "running", updatedAt: at(3) }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["running", "failed", "new-done", "old-done"]);
  });

  it("offers only files still on a computer as linkable work", () => {
    const options = workstreamLinkOptions(
      { resources: [] },
      [thread({ title: "Plan" }), thread({ id: "gone", deleted: true })],
      [copy({ id: "here" }), copy({ id: "removed", state: "released" })],
    );
    expect(options.map((option) => `${option.kind}:${option.id}`)).toEqual([
      "thread:thread",
      "copy:here",
    ]);
  });

  it("counts finished and blocked references toward progress", () => {
    expect(
      workstreamProgress({
        references: [
          { kind: "verification", id: "a", label: "Tests", state: "passed" },
          { kind: "branch", id: "b", label: "main", state: "open" },
          { kind: "pull-request", id: "c", label: "PR", state: "blocked" },
          { kind: "thread", id: "d", label: "Chat", state: "completed" },
        ],
      }),
    ).toEqual({ done: 2, blocked: 1, total: 4 });
  });

  it("finds a linked conversation by native or Library id on its computer", () => {
    const saved = thread({ id: "library-id" });
    expect(
      workstreamReferenceThread({ kind: "thread", id: "library-id", environmentId: computer }, [
        saved,
      ]),
    ).toBe(saved);
    expect(
      workstreamReferenceThread(
        { kind: "thread", id: "thread", environmentId: EnvironmentId.make("elsewhere") },
        [saved],
      ),
    ).toBeUndefined();
  });

  it("keeps active workstreams ahead of finished and archived ones", () => {
    const stream = (id: string, state: "active" | "completed" | "archived", day: number) => ({
      id,
      projectId: "project",
      revision: 1,
      title: id,
      goal: "",
      state,
      references: [],
      createdAt: at(day),
      updatedAt: at(day),
    });
    expect(
      sortWorkstreams([
        stream("archived", "archived", 9),
        stream("done", "completed", 8),
        stream("older", "active", 1),
        stream("newer", "active", 2),
      ]).map((entry) => entry.id),
    ).toEqual(["newer", "older", "done", "archived"]);
  });

  it("marks the latest quiet conversation as a resume suggestion, not a problem", () => {
    const [suggestion] = libraryProjectAttention([thread({ id: "quiet" })], []);
    expect(suggestion).toMatchObject({ id: "quiet", kind: "resume", environmentId: computer });
  });
});
