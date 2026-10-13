import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import {
  projectThreadActivity,
  projectTaskDestination,
  resolveProjectSettingsScope,
} from "./projectNavigation.logic";
import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { buildHomeProjectScopes } from "../../features/home/homeThreadList";

const environmentId = EnvironmentId.make("local");
const now = "2026-10-13T12:00:00.000Z";
const options = {
  now,
  settlementEnvironmentIds: new Set([environmentId]),
  snoozeEnvironmentIds: new Set([environmentId]),
  queuedThreadKeys: new Set<string>(),
};
function thread(fields: Partial<EnvironmentThreadShell> = {}) {
  return makeThreadShellFixture({
    id: ThreadId.make("thread"),
    projectId: ProjectId.make("project"),
    environmentId,
    ...fields,
  });
}

describe("project library native activity", () => {
  it("uses pending approval and input as attention", () => {
    expect(projectThreadActivity(thread({ hasPendingApprovals: true }), options)).toBe("attention");
    expect(projectThreadActivity(thread({ hasPendingUserInput: true }), options)).toBe("attention");
  });
  it("preserves settlement capability boundaries", () => {
    const settled = thread({ settledOverride: "settled" });
    expect(projectThreadActivity(settled, options)).toBe("settled");
    expect(
      projectThreadActivity(settled, { ...options, settlementEnvironmentIds: new Set() }),
    ).toBe("ready");
  });
  it("keeps an outbox message active on a settled thread", () => {
    const settled = thread({ settledOverride: "settled" });
    expect(
      projectThreadActivity(settled, {
        ...options,
        queuedThreadKeys: new Set([`${environmentId}:${settled.id}`]),
      }),
    ).toBe("ready");
  });
  it("snooze takes precedence until wake or raised hand", () => {
    const snoozed = thread({
      settledOverride: "settled",
      snoozedUntil: "2026-10-13T13:00:00.000Z",
    });
    expect(projectThreadActivity(snoozed, options)).toBe("snoozed");
    expect(
      projectThreadActivity(
        { ...snoozed, settledOverride: null, hasPendingApprovals: true },
        options,
      ),
    ).toBe("attention");
    expect(projectThreadActivity(snoozed, { ...options, now: "2026-10-13T14:00:00.000Z" })).toBe(
      "settled",
    );
  });
  it("does not apply unsupported snooze", () => {
    const snoozed = thread({ snoozedUntil: "2026-10-13T13:00:00.000Z" });
    expect(projectThreadActivity(snoozed, { ...options, snoozeEnvironmentIds: new Set() })).toBe(
      "ready",
    );
  });
  it("maps background waiting and failed native runtimes through the existing status model", () => {
    const base = thread();
    const runtime = {
      threadId: base.id,
      status: "idle" as const,
      providerName: "codex" as const,
      providerInstanceId: base.providerInstanceId,
      providerThreadId: null,
      activeRunId: null,
      modelSelection: base.modelSelection,
      runtimeMode: base.runtimeMode,
      lastError: null,
      lastErrorClass: null,
      updatedAt: now,
    };
    expect(projectThreadActivity({ ...base, runtime }, options)).toBe("working");
    expect(
      projectThreadActivity({ ...base, runtime: { ...runtime, status: "failed" } }, options),
    ).toBe("failed");
  });
});

function project(
  environmentId: EnvironmentId,
  fields: Partial<EnvironmentProject> = {},
): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make("same-project-id"),
    title: "Loom",
    workspaceRoot: `/work/${environmentId}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

describe("project navigation destinations", () => {
  const local = project(environmentId);
  const remoteEnvironmentId = EnvironmentId.make("remote");
  const remote = project(remoteEnvironmentId);
  const scope = {
    key: "loom",
    title: "Loom",
    representative: local,
    projects: [local, remote],
    projectRefs: [local, remote].map((entry) => ({
      environmentId: entry.environmentId,
      projectId: entry.id,
    })),
  };
  it("prefers the representative only when its destination grants task access", () => {
    const connected = new Set([environmentId, remoteEnvironmentId]);
    expect(
      projectTaskDestination(scope, connected, new Set([environmentId, remoteEnvironmentId])),
    ).toBe(local);
    expect(projectTaskDestination(scope, connected, new Set([remoteEnvironmentId]))).toBe(remote);
  });
  it("disables new work when all project members are offline or read-only", () => {
    expect(projectTaskDestination(scope, new Set(), new Set([environmentId]))).toBeNull();
    expect(projectTaskDestination(scope, new Set([environmentId]), new Set())).toBeNull();
    expect(
      projectTaskDestination(scope, new Set([environmentId]), new Set([remoteEnvironmentId])),
    ).toBeNull();
  });
  it("resolves grouped Scratch navigation to the selected computer's separate settings owner", () => {
    const scratchProjects = [
      project(environmentId, { title: "No project", isScratch: true }),
      project(remoteEnvironmentId, { title: "No project", isScratch: true }),
    ];
    const library = buildHomeProjectScopes({
      projects: scratchProjects,
      environmentId: null,
      projectGroupingMode: "repository",
    });
    const settings = buildProjectGroups({
      projects: scratchProjects,
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    });
    expect(library).toHaveLength(1);
    expect(settings).toHaveLength(2);
    const localKey = resolveProjectSettingsScope(settings, { environmentId, projectId: local.id });
    const remoteKey = resolveProjectSettingsScope(settings, {
      environmentId: remoteEnvironmentId,
      projectId: remote.id,
    });
    expect(localKey).toBe(
      settings.find((group) => group.representative.environmentId === environmentId)?.key,
    );
    expect(remoteKey).toBe(
      settings.find((group) => group.representative.environmentId === remoteEnvironmentId)?.key,
    );
    expect(localKey).not.toBe(remoteKey);
    expect(
      resolveProjectSettingsScope(settings, {
        environmentId: EnvironmentId.make("missing"),
        projectId: local.id,
      }),
    ).toBeNull();
  });
});
