import { EnvironmentId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryResolveBindingRequest,
  LibraryThreadArchive,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeRawThreadShell } from "../../test-fixtures";
import {
  emptyLibraryLaunchReceipt,
  bindLibraryLaunchConversation,
  launchLibraryConversation,
  encodeLibraryLaunchAttempt,
  readLibraryLaunchAttempt,
} from "./libraryLaunch";
const host = EnvironmentId.make("chosen-host"),
  threadId = ThreadId.make("thread"),
  localProjectId = ProjectId.make("compat-local");
const project: LibraryProject = {
  id: "durable-project",
  title: "AspectAvy",
  brief: "Cross-component work",
  revision: 3,
  resources: [
    {
      id: "ios",
      title: "iOS",
      remoteUrl: "https://github.com/team/ios",
      relativePath: "ios",
      defaultBranch: null,
    },
  ],
  archived: false,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
};
const copy: LibraryWorkingCopy = {
  id: "copy",
  projectId: project.id,
  projectRevision: 3,
  environmentId: host,
  rootPath: "/Projects/AspectAvy",
  repositories: [
    {
      resourceId: "ios",
      path: "/Projects/AspectAvy/ios",
      localProjectId,
      head: null,
      branch: null,
    },
  ],
  ownership: "managed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const input = { project, executionEnvironmentId: host, threadId, resourceIds: ["ios"] };
function harness() {
  const order: string[] = [];
  const rawThread = makeRawThreadShell({ id: threadId, projectId: localProjectId });
  const archive: LibraryThreadArchive = {
    summary: {
      id: "archive",
      projectId: project.id,
      environmentId: host,
      threadId,
      localProjectId,
      workingCopyId: copy.id,
      resourceIds: ["ios"],
      title: "Discussion",
      status: "idle",
      archived: false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      syncedAt: project.updatedAt,
      sequence: 1,
    },
    projection: {
      thread: { ...rawThread, lastVisitedAt: null },
      runs: [],
      attempts: [],
      nodes: [],
      subagents: [],
      providerSessions: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      messages: [],
      plans: [],
      turnItems: [],
      checkpointScopes: [],
      checkpoints: [],
      contextHandoffs: [],
      contextTransfers: [],
      visibleTurnItems: [],
      updatedAt: rawThread.updatedAt,
    },
  };
  const ports = {
    prepare: vi.fn(async () => {
      order.push("prepare");
      return copy;
    }),
    registerCopy: vi.fn(async () => {
      order.push("register-copy");
    }),
    resolve: vi.fn(async ({ binding }: LibraryResolveBindingRequest) => {
      order.push("resolve");
      return {
        binding,
        cwd: copy.repositories[0]!.path,
        localProjectId,
        repositoryPaths: [copy.repositories[0]!.path],
      };
    }),
    create: vi.fn(async () => {
      order.push("create");
    }),
    bind: vi.fn(async () => {
      order.push("bind");
    }),
    snapshot: vi.fn(async () => {
      order.push("snapshot");
      return archive;
    }),
    registerHistory: vi.fn(async () => {
      order.push("register-history");
    }),
    progress: vi.fn(),
  };
  return { ports, order, archive };
}
describe("library conversation launch", () => {
  it("saves intent before dispatch and resumes accepted steps after an app restart", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    let serialized = "";
    const review = {
      authorityEnvironmentId: EnvironmentId.make("authority"),
      model: {
        key: "codex",
        selection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "model",
          options: [{ id: "reasoningEffort", value: "max" }],
        },
      },
      title: "Project discussion",
      mode: "reuse" as const,
      rootPath: copy.rootPath,
      copy,
      carryContext: "Reviewed context",
      runtimeMode: "approval-required" as const,
      interactionMode: "plan" as const,
    };
    h.ports.bind.mockRejectedValueOnce(new Error("offline"));
    const persist = async () => {
      serialized = encodeLibraryLaunchAttempt({
        version: 1,
        requestId: "stable-request",
        threadId,
        receipt,
        review,
      });
    };
    await expect(
      launchLibraryConversation(input, receipt, { ...h.ports, persist }),
    ).rejects.toThrow("offline");
    const restored = readLibraryLaunchAttempt(serialized)!;
    expect(restored.receipt.threadCreated).toBe(true);
    expect(restored.review.carryContext).toBe("Reviewed context");
    expect(restored.review.model.selection).toEqual(review.model.selection);
    expect(restored.review.runtimeMode).toBe("approval-required");
    expect(restored.review.interactionMode).toBe("plan");
    await launchLibraryConversation(input, restored.receipt, h.ports);
    expect(h.ports.create).toHaveBeenCalledTimes(1);
    expect(h.ports.prepare).toHaveBeenCalledTimes(1);
  });
  it("refuses dispatch when durable intent cannot be saved", async () => {
    const h = harness();
    await expect(
      launchLibraryConversation(input, emptyLibraryLaunchReceipt(), {
        ...h.ports,
        persist: async () => {
          throw new Error("storage full");
        },
      }),
    ).rejects.toThrow("storage full");
    expect(h.ports.prepare).not.toHaveBeenCalled();
    expect(h.ports.create).not.toHaveBeenCalled();
  });

  it("pins the reviewed project before preparation and keeps it across query refreshes", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    h.ports.prepare.mockRejectedValueOnce(new Error("connection lost"));
    await expect(launchLibraryConversation(input, receipt, h.ports)).rejects.toThrow(
      "connection lost",
    );
    const refreshed = {
      ...project,
      revision: 4,
      resources: [...project.resources, { ...project.resources[0]!, id: "new-component" }],
    };
    await launchLibraryConversation({ ...input, project: refreshed }, receipt, h.ports);
    expect(h.ports.prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ project, resourceIds: ["ios"] }),
    );
    expect(h.ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({ projectRevision: 3, resourceIds: ["ios"] }),
        project,
      }),
    );
  });
  it("rejects changed scope or computer on retry before sending more commands", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    h.ports.prepare.mockRejectedValueOnce(new Error("connection lost"));
    await expect(launchLibraryConversation(input, receipt, h.ports)).rejects.toThrow(
      "connection lost",
    );
    await expect(
      launchLibraryConversation({ ...input, resourceIds: ["another"] }, receipt, h.ports),
    ).rejects.toThrow("reviewed destination");
    await expect(
      launchLibraryConversation(
        { ...input, executionEnvironmentId: EnvironmentId.make("different-host") },
        receipt,
        h.ports,
      ),
    ).rejects.toThrow("reviewed destination");
    expect(h.ports.prepare).toHaveBeenCalledTimes(1);
    expect(h.ports.registerCopy).not.toHaveBeenCalled();
  });
  it("registers a copy and binds the thread before exposing the composer", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    expect(await launchLibraryConversation(input, receipt, h.ports)).toEqual({
      environmentId: host,
      threadId,
    });
    expect(h.order).toEqual([
      "prepare",
      "register-copy",
      "resolve",
      "create",
      "bind",
      "snapshot",
      "register-history",
    ]);
    expect(receipt.threadBound && receipt.historyRegistered).toBe(true);
  });
  it("retries a failed bind without preparing or creating another thread", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    h.ports.bind.mockRejectedValueOnce(new Error("connection lost"));
    await expect(launchLibraryConversation(input, receipt, h.ports)).rejects.toThrow(
      "connection lost",
    );
    expect(h.ports.snapshot).not.toHaveBeenCalled();
    await launchLibraryConversation(input, receipt, h.ports);
    expect(h.ports.prepare).toHaveBeenCalledTimes(1);
    expect(h.ports.create).toHaveBeenCalledTimes(1);
    expect(h.ports.bind).toHaveBeenCalledTimes(2);
    expect(h.ports.registerHistory).toHaveBeenCalledTimes(1);
  });
  it("protects restored files with a binding before applying temporary retention", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    const restored = { ...copy, keepOnComputer: true };
    const retained = { ...restored, keepOnComputer: false };
    h.ports.prepare.mockImplementationOnce(async () => {
      h.order.push("prepare");
      return restored;
    });
    const setRetention = vi.fn(async () => {
      h.order.push("retention");
      return retained;
    });
    const registerRetention = vi.fn(async () => {
      h.order.push("register-retention");
    });
    const ports = {
      ...h.ports,
      bind: (input: Parameters<typeof bindLibraryLaunchConversation>[0]) =>
        bindLibraryLaunchConversation(input, receipt, false, "stable-request", {
          bind: h.ports.bind,
          setRetention,
          registerCopy: registerRetention,
          persist: async () => undefined,
        }),
    };
    h.ports.bind.mockRejectedValueOnce(new Error("bind reply lost"));
    await expect(launchLibraryConversation(input, receipt, ports)).rejects.toThrow(
      "bind reply lost",
    );
    expect(setRetention).not.toHaveBeenCalled();
    expect(registerRetention).not.toHaveBeenCalled();
    expect(h.ports.snapshot).not.toHaveBeenCalled();
    await launchLibraryConversation(input, receipt, ports);
    expect(h.order).toEqual([
      "prepare",
      "register-copy",
      "resolve",
      "create",
      "bind",
      "retention",
      "register-retention",
      "snapshot",
      "register-history",
    ]);
    expect(h.ports.prepare).toHaveBeenCalledOnce();
    expect(h.ports.create).toHaveBeenCalledOnce();
    expect(setRetention).toHaveBeenCalledWith({ workingCopyId: copy.id, keepOnComputer: false });
    expect(registerRetention).toHaveBeenCalledWith({
      requestId: "stable-request:retention",
      copy: retained,
    });
  });

  it("resumes a failed retention publication after restart with the same copy and request", async () => {
    const h = harness();
    let receipt = emptyLibraryLaunchReceipt();
    const retained = { ...copy, keepOnComputer: false };
    const setRetention = vi.fn(async () => retained);
    const registerRetention = vi.fn(async () => undefined);
    registerRetention.mockRejectedValueOnce(new Error("library reply lost"));
    let serialized = "";
    const persist = async () => {
      serialized = encodeLibraryLaunchAttempt({
        version: 1,
        requestId: "stable-request",
        threadId,
        receipt,
        review: {
          authorityEnvironmentId: EnvironmentId.make("authority"),
          model: {
            key: "codex",
            selection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
          },
          title: "Project discussion",
          mode: "reuse",
          rootPath: copy.rootPath,
          copy,
          carryContext: "",
          keepOnComputer: false,
        },
      });
    };
    const ports = {
      ...h.ports,
      persist,
      bind: (input: Parameters<typeof bindLibraryLaunchConversation>[0]) =>
        bindLibraryLaunchConversation(input, receipt, false, "stable-request", {
          bind: h.ports.bind,
          setRetention,
          registerCopy: registerRetention,
          persist,
        }),
    };
    await expect(launchLibraryConversation(input, receipt, ports)).rejects.toThrow(
      "library reply lost",
    );
    expect(h.ports.snapshot).not.toHaveBeenCalled();
    const restored = readLibraryLaunchAttempt(serialized)!;
    expect(restored.receipt.retentionCopy).toEqual(retained);
    expect(restored.receipt.threadBound).toBe(false);
    receipt = restored.receipt;
    await launchLibraryConversation(input, receipt, ports);
    expect(setRetention).toHaveBeenCalledOnce();
    expect(registerRetention.mock.calls).toEqual([
      [{ requestId: "stable-request:retention", copy: retained }],
      [{ requestId: "stable-request:retention", copy: retained }],
    ]);
    expect(h.ports.prepare).toHaveBeenCalledOnce();
    expect(h.ports.create).toHaveBeenCalledOnce();
    expect(receipt.threadBound && receipt.historyRegistered).toBe(true);
  });

  it("resumes the same component thread with its reviewed context when reusing an earlier copy after a brief edit", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt();
    h.ports.prepare.mockResolvedValueOnce({ ...copy, projectRevision: 1 });
    h.ports.bind.mockRejectedValueOnce(new Error("Reviewed project context was missing"));
    await expect(launchLibraryConversation(input, receipt, h.ports)).rejects.toThrow(
      "project context was missing",
    );
    expect(receipt.threadCreated).toBe(true);
    expect(receipt.threadBound).toBe(false);
    const refreshed = {
      ...project,
      revision: 4,
      brief: "Updated elsewhere after the original review",
    };
    await launchLibraryConversation({ ...input, project: refreshed }, receipt, h.ports);
    expect(h.ports.prepare).toHaveBeenCalledOnce();
    expect(h.ports.create).toHaveBeenCalledOnce();
    expect(h.ports.bind).toHaveBeenCalledTimes(2);
    expect(h.ports.bind).toHaveBeenLastCalledWith({
      threadId,
      project,
      binding: expect.objectContaining({
        projectRevision: 3,
        workingCopyId: copy.id,
        resourceIds: ["ios"],
      }),
    });
    expect(h.ports.resolve).toHaveBeenCalledWith({
      project,
      binding: expect.objectContaining({ projectRevision: 3, resourceIds: ["ios"] }),
    });
    expect(receipt.threadBound && receipt.historyRegistered).toBe(true);
  });
  it("rejects a copy from another host before creating any thread", async () => {
    const h = harness();
    h.ports.prepare.mockResolvedValueOnce({
      ...copy,
      environmentId: EnvironmentId.make("other-host"),
    });
    await expect(
      launchLibraryConversation(input, emptyLibraryLaunchReceipt(), h.ports),
    ).rejects.toThrow("another computer");
    expect(h.ports.create).not.toHaveBeenCalled();
    expect(h.ports.registerCopy).not.toHaveBeenCalled();
  });
  it("pins explicit continuation provenance and rejects mismatched archive registration", async () => {
    const h = harness(),
      receipt = emptyLibraryLaunchReceipt(),
      continuationOf = {
        environmentId: EnvironmentId.make("source"),
        threadId: ThreadId.make("source-thread"),
        sequence: 17,
      };
    h.ports.snapshot.mockResolvedValueOnce({
      ...h.archive,
      summary: { ...h.archive.summary, threadId: ThreadId.make("wrong") },
    });
    await expect(
      launchLibraryConversation({ ...input, continuationOf }, receipt, h.ports),
    ).rejects.toThrow("reviewed binding");
    expect(h.ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ binding: expect.objectContaining({ continuationOf }) }),
    );
    expect(h.ports.registerHistory).not.toHaveBeenCalled();
  });
});

it("uses the durable launch boundary and preserves the same identity after a lost response", async () => {
  const { ports } = harness();
  const receipt = emptyLibraryLaunchReceipt();
  const durableLaunch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValue(undefined);
  await expect(
    launchLibraryConversation(input, receipt, { ...ports, durableLaunch }),
  ).rejects.toThrow("Disconnected");
  expect(receipt.threadCreated).toBe(false);
  await expect(
    launchLibraryConversation(input, receipt, { ...ports, durableLaunch }),
  ).resolves.toEqual({ environmentId: host, threadId });
  expect(durableLaunch).toHaveBeenCalledTimes(2);
  expect(durableLaunch.mock.calls[0]).toEqual(durableLaunch.mock.calls[1]);
  expect(ports.create).not.toHaveBeenCalled();
  expect(ports.bind).not.toHaveBeenCalled();
  expect(ports.registerHistory).not.toHaveBeenCalled();
  expect(receipt.historyRegistered).toBe(true);
});
