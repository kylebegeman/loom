import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { makeThreadFixture } from "~/test-fixtures";
import { readyAgentCount, recentConversationForComputer } from "./presentation";

it("does not call disabled, missing or unroutable providers ready", () => {
  const ready = {
    enabled: true,
    installed: true,
    status: "ready" as const,
    models: [{} as import("@t3tools/contracts").ServerProviderModel],
  };
  expect(
    readyAgentCount([
      ready,
      { ...ready, enabled: false },
      { ...ready, installed: false },
      { ...ready, availability: "unavailable" as const },
      { ...ready, status: "error" as const },
      { ...ready, models: [] },
    ]),
  ).toBe(1);
});

describe("recentConversationForComputer", () => {
  const environmentId = EnvironmentId.make("computer");
  const projectId = ProjectId.make("project");
  const projects = [{ environmentId, id: projectId }];
  const thread = (id: string, updatedAt: string) =>
    makeThreadFixture({
      environmentId,
      projectId,
      id: ThreadId.make(id),
      updatedAt,
      visibleItemCount: 1,
    });

  it("continues the most recently used conversation in this computer's projects", () => {
    const older = thread("older", "2026-10-10T00:00:00Z");
    const recent = thread("recent", "2026-10-12T00:00:00Z");
    expect(recentConversationForComputer([older, recent], projects, environmentId)).toBe(recent);
  });

  it("does not choose archived, deleted, delegated, orphaned or another computer's conversations", () => {
    const eligible = thread("eligible", "2026-10-10T00:00:00Z");
    const newer = thread("newer", "2026-10-12T00:00:00Z");
    expect(
      recentConversationForComputer(
        [
          eligible,
          { ...newer, archivedAt: newer.updatedAt },
          { ...newer, deletedAt: newer.updatedAt },
          {
            ...newer,
            lineage: {
              rootThreadId: eligible.id,
              parentThreadId: eligible.id,
              relationshipToParent: "subagent",
            },
          },
          { ...newer, projectId: ProjectId.make("missing") },
          { ...newer, environmentId: EnvironmentId.make("other") },
        ],
        projects,
        environmentId,
      ),
    ).toBe(eligible);
  });

  it("continues a user fork while skipping newer delegated work", () => {
    const parent = thread("parent", "2026-10-10T00:00:00Z");
    const fork = makeThreadFixture({
      environmentId,
      projectId,
      id: ThreadId.make("fork"),
      updatedAt: "2026-10-11T00:00:00Z",
      visibleItemCount: 1,
      lineage: { rootThreadId: parent.id, parentThreadId: parent.id, relationshipToParent: "fork" },
    });
    const delegated = makeThreadFixture({
      environmentId,
      projectId,
      id: ThreadId.make("delegated"),
      updatedAt: "2026-10-12T00:00:00Z",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent",
      },
    });
    expect(recentConversationForComputer([parent, fork, delegated], projects, environmentId)).toBe(
      fork,
    );
  });

  it("skips a newer empty unstarted thread instead of hiding existing work", () => {
    const existing = thread("existing", "2026-10-10T00:00:00Z");
    const empty = makeThreadFixture({
      environmentId,
      projectId,
      id: ThreadId.make("empty"),
      updatedAt: "2026-10-12T00:00:00Z",
    });
    expect(recentConversationForComputer([existing, empty], projects, environmentId)).toBe(
      existing,
    );
    expect(recentConversationForComputer([empty], projects, environmentId)).toBeNull();
  });

  it("keeps started conversations before their first visible response arrives", () => {
    const active = makeThreadFixture({
      environmentId,
      projectId,
      runtime: {
        status: "running",
        activeRunId: RunId.make("active-run"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: null,
        updatedAt: "2026-10-12T00:00:00Z",
      },
    });
    const attempted = makeThreadFixture({
      environmentId,
      projectId,
      latestRun: {
        runId: RunId.make("attempted-run"),
        status: "failed",
        requestedAt: "2026-10-12T00:00:00Z",
        startedAt: null,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    expect(recentConversationForComputer([active], projects, environmentId)).toBe(active);
    expect(recentConversationForComputer([attempted], projects, environmentId)).toBe(attempted);
  });

  it("returns no continuation when this computer has no usable history", () => {
    expect(recentConversationForComputer([], projects, environmentId)).toBeNull();
    expect(
      recentConversationForComputer([thread("orphan", "2026-10-12T00:00:00Z")], [], environmentId),
    ).toBeNull();
  });
});
