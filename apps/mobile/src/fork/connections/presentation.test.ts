import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { makeThreadShellFixture } from "../../test-fixtures";
import { readyAgentCount, recentConversationForComputer } from "./presentation";

const machine = EnvironmentId.make("mac");
const other = EnvironmentId.make("pi");
const projectId = ProjectId.make("project");
const project: EnvironmentProject = {
  environmentId: machine,
  id: projectId,
  title: "Project",
  workspaceRoot: "/workspace",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
};

function thread(id: string) {
  return makeThreadShellFixture({
    environmentId: machine,
    id: ThreadId.make(id),
    projectId,
    updatedAt: "2026-10-13T12:00:00.000Z",
    visibleItemCount: 2,
  });
}

describe("computer work presentation", () => {
  it("continues only visible user conversations belonging to this computer and project", () => {
    const recent = thread("visible");
    const newer = { ...thread("newer"), updatedAt: "2026-10-13T14:00:00.000Z" };
    const threads = [
      recent,
      { ...newer, environmentId: other },
      { ...newer, projectId: ProjectId.make("removed-project") },
      { ...newer, archivedAt: newer.updatedAt },
      { ...newer, deletedAt: newer.updatedAt },
      { ...newer, lineage: { ...newer.lineage, relationshipToParent: "subagent" as const } },
      { ...newer, visibleItemCount: 0, latestRun: null, runtime: null },
    ];
    expect(recentConversationForComputer(threads, [project], machine)).toBe(recent);
    expect(recentConversationForComputer(threads, [], machine)).toBeNull();
  });

  it("chooses the latest conversation while retaining cached finished work", () => {
    const older = { ...thread("older"), updatedAt: "2026-10-12T12:00:00.000Z" };
    const latest = thread("latest");
    expect(recentConversationForComputer([older, latest], [project], machine)).toBe(latest);
    expect(recentConversationForComputer([latest, older], [project], machine)).toBe(latest);
  });

  it("requires a usable installed provider with selectable models before starting a conversation", () => {
    const ready: Parameters<typeof readyAgentCount>[0][number] = {
      enabled: true,
      installed: true,
      status: "ready",
      availability: "available",
      models: [{ slug: "model", name: "Model", isCustom: false, capabilities: null }],
    };
    expect(
      readyAgentCount([
        ready,
        { ...ready, enabled: false },
        { ...ready, installed: false },
        { ...ready, status: "error" },
        { ...ready, availability: "unavailable" },
        { ...ready, models: [] },
      ]),
    ).toBe(1);
  });
});
