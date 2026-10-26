import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryWorkingCopy,
  type LibraryAuthorizeRecoveryRequest,
} from "@t3tools/contracts/fork";
import { restoreLibraryLaunchCopy, type PortableLaunchFiles } from "./portableLaunch";

const source: LibraryWorkingCopy = {
  id: "source-files",
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("source-computer"),
  rootPath: "/work/source",
  repositories: [],
  ownership: "managed",
  state: "released",
  recovery: {
    sha256: "a".repeat(64),
    byteLength: 100,
    archiveKey: "archive",
    verifiedAt: "2026-10-21T12:00:00.000Z",
  },
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
};
const destination: LibraryWorkingCopy = {
  ...source,
  id: "destination-files",
  environmentId: EnvironmentId.make("destination-computer"),
  rootPath: "/projects/project",
  state: "ready",
  keepOnComputer: true,
};
const initial: PortableLaunchFiles = {
  environmentId: destination.environmentId,
  project: {
    id: "project",
    title: "Project",
    brief: "",
    revision: 1,
    resources: [],
    archived: false,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  },
  rootPath: destination.rootPath,
  resourceIds: [],
  sourceCopy: source,
  requestId: "restore-request",
  registerRequestId: "registration-request",
  snapshotRequestId: "snapshot-request",
  copy: null,
  keepOnComputer: false,
};
function commands() {
  return {
    readStatus: vi.fn(async () => ({
      copy: { ...source, state: "ready" as const },
      blockers: [],
      reviewToken: "review-token",
    })),
    snapshot: vi.fn(async () => ({ ...source, state: "ready" as const })),
    authorize: vi.fn(async () => ({
      sourceCopy: source,
      destinationEnvironmentId: destination.environmentId,
      libraryEnvironmentId: EnvironmentId.make("library"),
      expiresAt: "2026-10-21T12:05:00.000Z",
      accessToken: "short-lived-access",
    })),
    restore: vi.fn(
      async (_input: Parameters<Parameters<typeof restoreLibraryLaunchCopy>[1]["restore"]>[0]) =>
        destination,
    ),
    register: vi.fn(async ({ copy }: { copy: LibraryWorkingCopy }) => copy),
    save: vi.fn(),
  };
}

describe("portable launch receipts", () => {
  it("restores an offline released source into a new identity, saving before authority registration", async () => {
    const c = commands();
    c.register.mockImplementation(async ({ copy }) => {
      expect(c.save).toHaveBeenLastCalledWith({ ...initial, copy: destination });
      return copy;
    });
    expect(await restoreLibraryLaunchCopy(initial, c)).toEqual(destination);
    expect(c.readStatus).not.toHaveBeenCalled();
    expect(c.snapshot).not.toHaveBeenCalled();
    expect(c.restore).toHaveBeenCalledWith({
      environmentId: destination.environmentId,
      input: {
        requestId: initial.requestId,
        project: initial.project,
        rootPath: initial.rootPath,
        grant: await c.authorize.mock.results[0]!.value,
      },
    });
    expect(JSON.stringify(c.save.mock.calls)).not.toContain("short-lived-access");
    expect(c.register).toHaveBeenCalledWith({
      requestId: initial.registerRequestId,
      copy: destination,
    });
  });

  it("leaves the folder to a computer that chooses one, then holds the folder it chose", async () => {
    const c = commands();
    const { rootPath: _rootPath, ...unplaced } = initial;
    expect(await restoreLibraryLaunchCopy(unplaced, c)).toEqual(destination);
    expect(c.restore.mock.calls[0]![0].input).not.toHaveProperty("rootPath");
    c.register.mockResolvedValueOnce({ ...destination, rootPath: "/elsewhere" });
    await expect(restoreLibraryLaunchCopy({ ...unplaced, copy: destination }, c)).rejects.toThrow(
      "The restored files were not registered for this conversation.",
    );
  });
  it("obtains fresh access after a lost restore response and replays the same destination request", async () => {
    const c = commands();
    c.restore.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(restoreLibraryLaunchCopy(initial, c)).rejects.toThrow("Disconnected");
    await expect(restoreLibraryLaunchCopy(initial, c)).resolves.toEqual(destination);
    expect(c.authorize).toHaveBeenCalledTimes(2);
    expect(c.restore.mock.calls[0]).toEqual(c.restore.mock.calls[1]);
  });

  it("pins the selected archive across catalog changes and fresh authorization tokens", async () => {
    const c = commands();
    let saved = initial;
    c.save.mockImplementation((attempt: PortableLaunchFiles) => {
      saved = attempt;
    });
    let current = source;
    let authorization = 0;
    const authorize = vi.fn(async (input: LibraryAuthorizeRecoveryRequest) => ({
      sourceCopy: input.sourceCopy ?? current,
      destinationEnvironmentId: destination.environmentId,
      libraryEnvironmentId: EnvironmentId.make("library"),
      expiresAt: "2026-10-21T12:05:00.000Z",
      accessToken: `ephemeral-token-${++authorization}`,
    }));
    c.restore.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(restoreLibraryLaunchCopy(saved, { ...c, authorize })).rejects.toThrow(
      "Disconnected",
    );
    current = { ...source, recovery: { ...source.recovery!, sha256: "b".repeat(64) } };
    await expect(restoreLibraryLaunchCopy(saved, { ...c, authorize })).resolves.toEqual(
      destination,
    );
    expect(authorize).toHaveBeenNthCalledWith(1, {
      sourceEnvironmentId: source.environmentId,
      workingCopyId: source.id,
      destinationEnvironmentId: destination.environmentId,
      sourceCopy: source,
    });
    expect(authorize.mock.calls[1]![0]).toEqual(authorize.mock.calls[0]![0]);
    const transfers = c.restore.mock.calls;
    expect(transfers[0]![0].input.requestId).toBe(transfers[1]![0].input.requestId);
    expect(transfers[0]![0].input.grant.accessToken).not.toBe(
      transfers[1]![0].input.grant.accessToken,
    );
    expect(transfers[1]![0].input.grant.sourceCopy.recovery?.sha256).toBe(source.recovery!.sha256);
    expect(JSON.stringify(c.save.mock.calls)).not.toContain("ephemeral-token");
  });

  it("retries authority registration from the saved destination receipt without authorizing or restoring again", async () => {
    const c = commands();
    let saved = initial;
    c.save.mockImplementation((attempt: PortableLaunchFiles) => {
      saved = attempt;
    });
    c.register.mockRejectedValueOnce(new Error("Library offline"));
    await expect(restoreLibraryLaunchCopy(saved, c)).rejects.toThrow("Library offline");
    await expect(restoreLibraryLaunchCopy(saved, c)).resolves.toEqual(destination);
    expect(c.authorize).toHaveBeenCalledOnce();
    expect(c.restore).toHaveBeenCalledOnce();
    expect(c.register.mock.calls[0]).toEqual(c.register.mock.calls[1]);
  });

  it("saves ready source files before authorizing their transfer and preserves the snapshot across retries", async () => {
    const c = commands();
    const active = { ...initial, sourceCopy: { ...source, state: "ready" as const } };
    let saved: PortableLaunchFiles = active;
    c.save.mockImplementation((attempt: PortableLaunchFiles) => {
      saved = attempt;
    });
    c.register.mockRejectedValueOnce(new Error("Library offline"));
    await expect(restoreLibraryLaunchCopy(saved, c)).rejects.toThrow("Library offline");
    expect(saved.sourceSnapshot).toEqual(await c.snapshot.mock.results[0]!.value);
    expect(c.authorize).not.toHaveBeenCalled();
    await expect(restoreLibraryLaunchCopy(saved, c)).resolves.toEqual(destination);
    expect(c.readStatus).toHaveBeenCalledOnce();
    expect(c.snapshot).toHaveBeenCalledOnce();
    expect(c.register.mock.calls[0]).toEqual(c.register.mock.calls[1]);
    expect(c.register.mock.invocationCallOrder[1]).toBeLessThan(
      c.authorize.mock.invocationCallOrder[0]!,
    );
  });

  it("preserves the reviewed snapshot identity after a lost snapshot response", async () => {
    const c = commands();
    let saved: PortableLaunchFiles = { ...initial, sourceCopy: { ...source, state: "ready" } };
    c.save.mockImplementation((attempt: PortableLaunchFiles) => {
      saved = attempt;
    });
    c.snapshot.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(restoreLibraryLaunchCopy(saved, c)).rejects.toThrow("Disconnected");
    expect(saved.sourceSnapshotRejected).not.toBe(true);
    c.readStatus.mockResolvedValue({
      copy: { ...source, state: "ready" },
      blockers: [],
      reviewToken: "changed-review",
    });
    await expect(restoreLibraryLaunchCopy(saved, c)).resolves.toEqual(destination);
    expect(c.readStatus).toHaveBeenCalledOnce();
    expect(c.snapshot.mock.calls[0]).toEqual(c.snapshot.mock.calls[1]);
  });

  it("requires an explicit new source review after a definitive blocked snapshot", async () => {
    const c = commands();
    let saved: PortableLaunchFiles = { ...initial, sourceCopy: { ...source, state: "ready" } };
    c.save.mockImplementation((attempt: PortableLaunchFiles) => {
      saved = attempt;
    });
    c.snapshot.mockRejectedValueOnce(new LibraryError({ reason: "blocked" }));
    await expect(restoreLibraryLaunchCopy(saved, c)).rejects.toThrow();
    expect(saved).toMatchObject({
      sourceReviewToken: "review-token",
      snapshotRequestId: initial.snapshotRequestId,
      sourceSnapshotRejected: true,
    });
    await expect(restoreLibraryLaunchCopy(saved, c)).rejects.toThrow(
      "Review the latest source files",
    );
    expect(c.snapshot).toHaveBeenCalledOnce();
    expect(c.authorize).not.toHaveBeenCalled();
    expect(c.restore).not.toHaveBeenCalled();

    saved = {
      ...saved,
      sourceReviewToken: undefined,
      sourceSnapshotRejected: undefined,
      snapshotRequestId: `${initial.snapshotRequestId}:review-1`,
    };
    c.readStatus.mockResolvedValue({
      copy: { ...source, state: "ready" },
      blockers: [],
      reviewToken: "latest-review",
    });
    await expect(restoreLibraryLaunchCopy(saved, c)).resolves.toEqual(destination);
    expect(c.readStatus).toHaveBeenCalledTimes(2);
    expect(c.snapshot).toHaveBeenLastCalledWith({
      environmentId: source.environmentId,
      input: {
        requestId: `${initial.snapshotRequestId}:review-1`,
        workingCopyId: source.id,
        reviewToken: "latest-review",
      },
    });
    expect(c.restore).toHaveBeenCalledWith({
      environmentId: initial.environmentId,
      input: expect.objectContaining({ requestId: initial.requestId, rootPath: initial.rootPath }),
    });
    expect(c.register).toHaveBeenLastCalledWith({
      requestId: initial.registerRequestId,
      copy: destination,
    });
  });

  it("does not transfer stale saved files when a ready source cannot be checked", async () => {
    const c = commands();
    c.readStatus.mockRejectedValue(new Error("Source offline"));
    await expect(
      restoreLibraryLaunchCopy({ ...initial, sourceCopy: { ...source, state: "ready" } }, c),
    ).rejects.toThrow("Source offline");
    expect(c.authorize).not.toHaveBeenCalled();
    expect(c.restore).not.toHaveBeenCalled();
  });

  it("rejects changed saved state and unrelated destination receipts before publication", async () => {
    const c = commands();
    c.authorize.mockResolvedValueOnce({
      ...(await c.authorize()),
      sourceCopy: { ...source, recovery: { ...source.recovery!, sha256: "b".repeat(64) } },
    });
    await expect(restoreLibraryLaunchCopy(initial, c)).rejects.toThrow("saved files changed");
    expect(c.restore).not.toHaveBeenCalled();
    expect(c.register).not.toHaveBeenCalled();
    for (const copy of [
      source,
      { ...destination, id: source.id },
      { ...destination, rootPath: "/wrong" },
      { ...destination, state: "missing" as const },
    ]) {
      const invalid = commands();
      invalid.restore.mockResolvedValue(copy);
      await expect(restoreLibraryLaunchCopy(initial, invalid)).rejects.toThrow(
        "selected destination",
      );
      expect(invalid.register).not.toHaveBeenCalled();
    }
  });
});
