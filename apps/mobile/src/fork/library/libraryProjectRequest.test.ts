import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryOperation,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  encodeSubmittedLibraryProjectRequest,
  readSubmittedLibraryProjectRequest,
  runSubmittedLibraryProjectRequest,
  registerSubmittedLibraryProjectCopy,
  type SubmittedLibraryProjectRequest,
} from "./libraryProjectRequest";

const authorityId = EnvironmentId.make("library");
const host = EnvironmentId.make("computer");
const project: LibraryProject = {
  id: "project",
  title: "Rocket",
  brief: "Reviewed brief",
  revision: 1,
  archived: false,
  resources: [
    {
      id: "repo",
      title: "Rocket",
      kind: "repository",
      relativePath: ".",
      remoteUrl: "https://github.com/acme/rocket",
      defaultBranch: null,
    },
  ],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
};
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId: host,
  rootPath: "/Projects/rocket",
  ownership: "managed",
  state: "ready",
  repositories: [
    {
      resourceId: "repo",
      path: "/Projects/rocket",
      localProjectId: ProjectId.make("local-project"),
      branch: null,
      head: null,
    },
  ],
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const create: SubmittedLibraryProjectRequest = {
  authorityId,
  environmentId: authorityId,
  state: "ready",
  result: null,
  prepareFiles: true,
  request: {
    kind: "create",
    input: {
      requestId: "original",
      title: project.title,
      brief: project.brief,
      resources: project.resources,
    },
  },
};
const prepare: SubmittedLibraryProjectRequest = {
  authorityId,
  environmentId: host,
  state: "ready",
  result: null,
  prepareFiles: true,
  request: {
    kind: "prepare",
    input: { requestId: "original:prepare", project, rootPath: copy.rootPath, strategy: "clone" },
  },
};
const update: SubmittedLibraryProjectRequest = {
  ...create,
  prepareFiles: false,
  request: {
    kind: "update",
    input: {
      requestId: "original-update",
      projectId: project.id,
      expectedRevision: project.revision,
      title: "Updated project",
    },
  },
};
const receipt = (
  attempt: SubmittedLibraryProjectRequest,
  result: LibraryProject | LibraryWorkingCopy,
): LibraryOperation => ({
  id: "server-operation",
  kind: attempt.request.kind,
  projectId: project.id,
  environmentId: attempt.environmentId,
  state: "succeeded",
  phase: "Done",
  attempt: 1,
  error: null,
  result,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

describe("submitted mobile project requests", () => {
  it("persists the request before dispatch and retains its input and authority through a refused save", async () => {
    let saved = create;
    const persist = vi.fn(async (next: SubmittedLibraryProjectRequest) => {
      saved = next;
    });
    const execute = vi.fn(async (input: SubmittedLibraryProjectRequest) => {
      expect(saved).toBe(input);
      expect(saved.state).toBe("unknown");
      throw new LibraryError({ reason: "blocked" });
    });
    await expect(
      runSubmittedLibraryProjectRequest(create, authorityId, { persist, execute }),
    ).rejects.toThrow();
    expect(saved.state).toBe("ready");
    expect(saved.request).toBe(create.request);
    expect(saved.authorityId).toBe(authorityId);
    await expect(
      runSubmittedLibraryProjectRequest(saved, EnvironmentId.make("another-library"), {
        persist,
        execute,
      }),
    ).rejects.toThrow("Reconnect");
    expect(execute).toHaveBeenCalledTimes(1);
    const complete = await runSubmittedLibraryProjectRequest(saved, authorityId, {
      persist,
      execute: async (retry) => {
        expect(retry.request).toBe(create.request);
        return project;
      },
    });
    expect(complete.result).toEqual(project);
  });

  it("reconciles lost replies using the original request and kind without executing another mutation", async () => {
    for (const [attempt, result] of [
      [create, project],
      [update, { ...project, title: "Updated project", revision: 2 }],
      [prepare, copy],
    ] as const) {
      const execute = vi.fn(async () => result);
      const persist = vi.fn(async () => undefined);
      const lookup = vi.fn(async () => receipt(attempt, result));
      const complete = await runSubmittedLibraryProjectRequest(
        { ...attempt, state: "unknown" },
        authorityId,
        { persist, execute, lookup },
      );
      expect(lookup).toHaveBeenCalledExactlyOnceWith({
        environmentId: attempt.environmentId,
        requestId: attempt.request.input.requestId,
        kind: attempt.request.kind,
      });
      expect(execute).not.toHaveBeenCalled();
      expect(complete.result).toEqual(result);
    }
  });

  it("requires an explicit retry after a missing or paused receipt, and blocks unsafe fallback without lookup", async () => {
    const execute = vi.fn(async () => copy);
    const persist = vi.fn(async () => undefined);
    const unknown = { ...prepare, state: "unknown" as const };
    await expect(
      runSubmittedLibraryProjectRequest(unknown, authorityId, { execute, persist }),
    ).rejects.toThrow("saved result");
    for (const operation of [null, { ...receipt(prepare, copy), state: "needs-input" as const }]) {
      const ready = await runSubmittedLibraryProjectRequest(unknown, authorityId, {
        execute,
        persist,
        lookup: async () => operation,
      });
      expect(ready.state).toBe("ready");
      expect(ready.request).toBe(prepare.request);
      expect(execute).not.toHaveBeenCalled();
    }
    const running = { ...receipt(prepare, copy), state: "running" as const };
    await expect(
      runSubmittedLibraryProjectRequest(unknown, authorityId, {
        execute,
        persist,
        lookup: async () => running,
      }),
    ).rejects.toThrow("Check its result");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps unknown outcomes and rejects mismatched file receipts without creating conversations", async () => {
    let saved = prepare;
    const persist = async (next: SubmittedLibraryProjectRequest) => {
      saved = next;
    };
    const execute = vi.fn(async () => {
      throw new Error("Lost reply");
    });
    await expect(
      runSubmittedLibraryProjectRequest(prepare, authorityId, { persist, execute }),
    ).rejects.toThrow("Lost reply");
    expect(saved.state).toBe("unknown");
    expect(readSubmittedLibraryProjectRequest(encodeSubmittedLibraryProjectRequest(saved))).toEqual(
      saved,
    );
    expect(readSubmittedLibraryProjectRequest("corrupt request")).toBe(false);
    for (const wrong of [
      { ...copy, environmentId: EnvironmentId.make("other") },
      { ...copy, rootPath: "/Projects/elsewhere" },
      { ...copy, rootPath: "/projects/rocket" },
      { ...copy, state: "preparing" as const },
      { ...copy, repositories: [] },
    ]) {
      await expect(
        runSubmittedLibraryProjectRequest(saved, authorityId, {
          persist,
          execute,
          lookup: async () => receipt(prepare, wrong),
        }),
      ).rejects.toThrow("selected computer");
    }
  });
  it("checks a reopened update before any explicit retry and keeps the original input", async () => {
    let saved = update;
    const persist = async (next: SubmittedLibraryProjectRequest) => {
      saved = next;
    };
    const execute = vi.fn(async () => {
      throw new Error("Lost update reply");
    });
    await expect(
      runSubmittedLibraryProjectRequest(update, authorityId, { persist, execute }),
    ).rejects.toThrow("Lost update reply");
    const reopened = readSubmittedLibraryProjectRequest(
      encodeSubmittedLibraryProjectRequest(saved),
    );
    if (!reopened) throw new Error("Expected the saved update request");
    expect(reopened.state).toBe("unknown");
    const lookup = vi.fn(async () => null);
    const ready = await runSubmittedLibraryProjectRequest(reopened, authorityId, {
      persist,
      execute,
      lookup,
    });
    expect(ready.state).toBe("ready");
    expect(ready.request).toEqual(update.request);
    expect(execute).toHaveBeenCalledTimes(1);
    const result = { ...project, title: "Updated project", revision: 2 };
    const retry = vi.fn(async (_request: SubmittedLibraryProjectRequest) => result);
    expect(
      (
        await runSubmittedLibraryProjectRequest(ready, authorityId, {
          persist,
          execute: retry,
          lookup,
        })
      ).result,
    ).toEqual(result);
    expect(retry.mock.calls[0]?.[0].request).toEqual(update.request);
    expect(lookup).toHaveBeenCalledExactlyOnceWith({
      environmentId: authorityId,
      requestId: "original-update",
      kind: "update",
    });
    await expect(
      runSubmittedLibraryProjectRequest(reopened, authorityId, {
        persist,
        execute: retry,
        lookup: async () => receipt(update, { ...result, id: "different-project" }),
      }),
    ).rejects.toThrow("saved project request");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reconciles a lost registration before allowing another explicit registration", async () => {
    let saved = {
      ...prepare,
      state: "succeeded" as const,
      result: copy,
    } as SubmittedLibraryProjectRequest;
    const persist = async (next: SubmittedLibraryProjectRequest) => {
      saved = next;
    };
    const register = vi.fn(async (): Promise<void> => {
      throw new Error("Lost registration reply");
    });
    await expect(
      registerSubmittedLibraryProjectCopy(saved, authorityId, {
        persist,
        register,
        copies: async () => [],
      }),
    ).rejects.toThrow("Lost registration");
    expect(saved.registration).toBe("unknown");
    const confirmed = await registerSubmittedLibraryProjectCopy(saved, authorityId, {
      persist,
      register,
      copies: async () => [copy],
    });
    expect(confirmed.registration).toBe("succeeded");
    expect(register).toHaveBeenCalledTimes(1);
    const ready = await registerSubmittedLibraryProjectCopy(
      { ...saved, registration: "unknown" },
      authorityId,
      { persist, register, copies: async () => [] },
    );
    expect(ready.registration).toBe("ready");
    expect(register).toHaveBeenCalledTimes(1);
    register.mockResolvedValueOnce(undefined);
    await registerSubmittedLibraryProjectCopy(ready, authorityId, {
      persist,
      register,
      copies: async () => [],
    });
    expect(register).toHaveBeenLastCalledWith({ requestId: "original:prepare:copy", copy });
  });

  it("keeps saved requests bound to their initiating account across recovery and completion", async () => {
    const execute = vi.fn(async () => project);
    const persist = vi.fn(async () => undefined);
    const lookup = vi.fn(async () => receipt(create, project));
    const initiator = { issuer: "https://id.test", subject: "kyle" };
    for (const attempt of [create, update]) {
      for (const state of ["ready", "unknown", "succeeded"] as const) {
        await expect(
          runSubmittedLibraryProjectRequest(
            { ...attempt, initiator, state, result: state === "succeeded" ? project : null },
            authorityId,
            { execute, persist, lookup, identity: { ...initiator, subject: "other" } },
          ),
        ).rejects.toThrow("account that started");
      }
    }
    expect(execute).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rechecks the initiating account after saving and before registering prepared files", async () => {
    const initiator = { issuer: "https://id.test", subject: "kyle" };
    let identity = initiator;
    const execute = vi.fn(async () => project);
    const register = vi.fn(async () => undefined);
    const persist = vi.fn(async () => {
      identity = { ...initiator, subject: "other" };
    });
    await expect(
      runSubmittedLibraryProjectRequest({ ...create, initiator }, authorityId, {
        identity: initiator,
        currentIdentity: () => identity,
        persist,
        execute,
      }),
    ).rejects.toThrow("account that started");
    expect(execute).not.toHaveBeenCalled();
    await expect(
      registerSubmittedLibraryProjectCopy(
        { ...prepare, initiator, state: "succeeded", result: copy },
        authorityId,
        { identity, persist, register, copies: async () => [] },
      ),
    ).rejects.toThrow("account that started");
    expect(register).not.toHaveBeenCalled();
  });

  it("does not submit when the original request cannot be preserved", async () => {
    const execute = vi.fn(async () => project);
    await expect(
      runSubmittedLibraryProjectRequest(create, authorityId, {
        persist: async () => {
          throw new Error("Storage full");
        },
        execute,
      }),
    ).rejects.toThrow("Storage full");
    expect(execute).not.toHaveBeenCalled();
  });
});
