import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { LibraryOperation, LibraryProject } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryProjectRequestOutcome,
  selectLibraryProjectRequests,
} from "./library-project-request-outcomes.ts";

const at = "2026-11-11T12:00:00.000Z";
const operation = (patch: Partial<LibraryOperation> = {}): LibraryOperation => ({
  id: "original-request:import",
  kind: "import",
  projectId: "project",
  environmentId: EnvironmentId.make("computer"),
  state: "failed",
  phase: "Registering existing files",
  attempt: 1,
  error: "Connection lost",
  result: null,
  createdAt: at,
  updatedAt: at,
  ...patch,
});
const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: at,
  updatedAt: at,
};

describe("Library user request outcomes", () => {
  it("retains confirmed partial outcomes and original identity across resume and cancellation", () => {
    const repair = {
      kind: "github-host-setup" as const,
      environmentId: EnvironmentId.make("computer"),
      label: "Computer",
      agentTool: "loom_github_host_setup" as const,
      action: "start" as const,
    };
    const accessRepair = { kind: "sign-in" as const };
    const partial = operation({ result: project, repair, accessRepair });
    const outcome = libraryProjectRequestOutcome(partial);
    expect(outcome).toMatchObject({
      requestId: partial.id,
      completed: ["Project saved"],
      remaining: ["Finish registering existing files"],
      canResume: true,
      canCancel: true,
      repair,
      accessRepair,
      error: "Connection lost",
    });
    expect(libraryProjectRequestOutcome({ ...partial, attempt: 3 }).requestId).toBe(
      outcome.requestId,
    );
    const cancelled = libraryProjectRequestOutcome({ ...partial, state: "cancelled" });
    expect(cancelled).toMatchObject({
      completed: outcome.completed,
      remaining: [],
      canResume: false,
      canCancel: false,
      repair: undefined,
      accessRepair: undefined,
      error: null,
    });
    expect(cancelled.detail).toContain("Completed steps were kept");
    expect(
      libraryProjectRequestOutcome(
        operation({ kind: "create", state: "succeeded", result: project }),
      ),
    ).toMatchObject({
      completed: ["Project saved"],
      remaining: [],
      conversation: "No conversation requested",
    });
  });

  it("does not turn missing receipts or internal phases into proof that a request never ran", () => {
    expect(selectLibraryProjectRequests([], 4)).toEqual({ shown: [], total: 0, unfinished: 0 });
    const unknown = libraryProjectRequestOutcome(
      operation({ kind: "launch", phase: "Creating conversation" }),
    );
    expect(unknown.completed).toEqual([]);
    expect(unknown.conversation).toBe("Conversation creation not confirmed");
    expect(unknown.detail).toContain("Check");
    expect(
      libraryProjectRequestOutcome(operation({ kind: "create", phase: "Done" })).completed,
    ).toEqual([]);
  });

  it("keeps an existing conversation visible when its files or setup still need work", () => {
    const partial = operation({
      kind: "launch",
      phase: "Downloading files",
      result: { threadId: ThreadId.make("thread") },
    });
    expect(libraryProjectRequestOutcome(partial)).toMatchObject({
      completed: ["Conversation created"],
      remaining: ["Finish preparing files and conversation setup"],
      threadId: "thread",
    });
    expect(libraryProjectRequestOutcome({ ...partial, state: "running" })).toMatchObject({
      canResume: false,
      canCancel: false,
    });
    expect(libraryProjectRequestOutcome({ ...partial, state: "succeeded" })).toMatchObject({
      completed: ["Conversation created", "Conversation setup completed"],
      remaining: [],
    });
  });

  it("never folds unfinished requests away or merges separate requests with the same kind", () => {
    const requests = [
      operation({ id: "done", state: "succeeded" }),
      ...Array.from({ length: 6 }, (_, i) =>
        operation({ id: `unfinished-${i}`, state: i === 0 ? "running" : "needs-input" }),
      ),
    ];
    const selected = selectLibraryProjectRequests(requests, 4);
    expect(selected.shown).toHaveLength(6);
    expect(new Set(selected.shown.map((request) => request.id)).size).toBe(6);
    expect(selected).toMatchObject({ total: 7, unfinished: 6 });
    expect(selectLibraryProjectRequests(requests, null).shown).toHaveLength(7);
  });
});
