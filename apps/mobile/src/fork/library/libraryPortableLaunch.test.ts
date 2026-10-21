import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProject,
  type LibraryRecoveryGrant,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  emptyLibraryLaunchReceipt,
  encodeLibraryLaunchAttempt,
  readLibraryLaunchAttempt,
} from "./libraryLaunch";
import { preparePortableLibraryLaunchCopy } from "./libraryPortableLaunch";

const sourceEnvironmentId = EnvironmentId.make("source"),
  destinationEnvironmentId = EnvironmentId.make("destination"),
  authorityEnvironmentId = EnvironmentId.make("library");
const project: LibraryProject = {
  id: "project",
  revision: 1,
  title: "Local work",
  brief: "",
  resources: [],
  archived: false,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const source: LibraryWorkingCopy = {
  id: "source-copy",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId: sourceEnvironmentId,
  rootPath: "/source/local-work",
  rootLocalProjectId: ProjectId.make("source-local-project"),
  repositories: [],
  ownership: "managed",
  state: "released",
  recovery: {
    sha256: "a".repeat(64),
    byteLength: 2048,
    archiveKey: "source-files",
    verifiedAt: project.updatedAt,
  },
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const destination: LibraryWorkingCopy = {
  ...source,
  id: "new-destination-copy",
  rootLocalProjectId: ProjectId.make("new-destination-project"),
  environmentId: destinationEnvironmentId,
  rootPath: "/destination/local-work",
  state: "ready",
  keepOnComputer: true,
};
const input = {
  sourceCopy: source,
  project,
  destinationEnvironmentId,
  authorityEnvironmentId,
  rootPath: destination.rootPath,
  resourceIds: [],
  requestId: "launch",
};
function harness() {
  const grant: LibraryRecoveryGrant = {
    sourceCopy: source,
    destinationEnvironmentId,
    libraryEnvironmentId: authorityEnvironmentId,
    expiresAt: "2026-10-21T01:00:00Z",
    accessToken: "temporary-grant",
  };
  const ports = {
    readStatus: vi.fn<Parameters<typeof preparePortableLibraryLaunchCopy>[2]["readStatus"]>(
      async () => ({
        copy: source,
        blockers: [],
        reviewToken: "review",
      }),
    ),
    snapshot: vi.fn<Parameters<typeof preparePortableLibraryLaunchCopy>[2]["snapshot"]>(
      async () => source,
    ),
    registerCopy: vi.fn(async () => undefined),
    authorize: vi.fn<Parameters<typeof preparePortableLibraryLaunchCopy>[2]["authorize"]>(
      async () => grant,
    ),
    restore: vi.fn<Parameters<typeof preparePortableLibraryLaunchCopy>[2]["restore"]>(
      async () => destination,
    ),
    persist: vi.fn(async () => undefined),
    progress: vi.fn(),
  };
  return { grant, ports, receipt: emptyLibraryLaunchReceipt() };
}

describe("mobile portable recovery preparation", () => {
  it("restores released local-only files without connecting to or changing the source", async () => {
    const { ports, receipt } = harness();
    await expect(preparePortableLibraryLaunchCopy(input, receipt, ports)).resolves.toBe(
      destination,
    );
    expect(ports.readStatus).not.toHaveBeenCalled();
    expect(ports.snapshot).not.toHaveBeenCalled();
    expect(ports.registerCopy).not.toHaveBeenCalled();
    expect(ports.authorize).toHaveBeenCalledWith({
      environmentId: authorityEnvironmentId,
      input: {
        sourceEnvironmentId,
        workingCopyId: source.id,
        destinationEnvironmentId,
        sourceCopy: source,
      },
    });
    expect(ports.restore).toHaveBeenCalledWith({
      environmentId: destinationEnvironmentId,
      input: expect.objectContaining({ requestId: "launch:restore", project, resourceIds: [] }),
    });
    expect(source.state).toBe("released");
    expect(JSON.stringify(receipt)).not.toContain("temporary-grant");
  });

  it("restores an unregistered released snapshot while its source computer is offline", async () => {
    const { ports, receipt, grant } = harness();
    const released = { ...source, registered: false };
    ports.readStatus.mockRejectedValue(new Error("Source computer offline"));
    ports.snapshot.mockRejectedValue(new Error("Source computer offline"));
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: released });
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: released }, receipt, ports),
    ).resolves.toBe(destination);
    expect(ports.readStatus).not.toHaveBeenCalled();
    expect(ports.snapshot).not.toHaveBeenCalled();
    expect(ports.restore).toHaveBeenCalledOnce();
    expect(released.registered).toBe(false);
  });

  it("saves ready files again and registers their accepted snapshot before authorizing recovery", async () => {
    const { ports, receipt, grant } = harness();
    const ready = { ...source, state: "ready" as const };
    const fresh = { ...ready, recovery: { ...source.recovery!, sha256: "b".repeat(64) } };
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "latest-review" });
    ports.snapshot.mockResolvedValue(fresh);
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: fresh });
    ports.registerCopy.mockRejectedValueOnce(new Error("Library disconnected"));
    const args = { ...input, sourceCopy: ready };
    await expect(preparePortableLibraryLaunchCopy(args, receipt, ports)).rejects.toThrow(
      "Library disconnected",
    );
    expect(receipt.recoverySnapshot).toEqual(fresh);
    expect(ports.authorize).not.toHaveBeenCalled();
    await preparePortableLibraryLaunchCopy(args, receipt, ports);
    expect(ports.snapshot).toHaveBeenCalledTimes(1);
    expect(ports.snapshot).toHaveBeenCalledWith({
      environmentId: sourceEnvironmentId,
      input: {
        requestId: "launch:source-snapshot",
        workingCopyId: source.id,
        reviewToken: "latest-review",
      },
    });
    expect(ports.registerCopy).toHaveBeenLastCalledWith({
      requestId: "launch:source-copy",
      copy: fresh,
    });
    expect(receipt.recoverySnapshotRegistered).toBe(true);
    expect(ports.registerCopy.mock.invocationCallOrder[1]).toBeLessThan(
      ports.authorize.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(receipt)).not.toContain("temporary-grant");
  });

  it("persists and retries the exact snapshot review after a lost response", async () => {
    const { ports, receipt, grant } = harness();
    const ready = { ...source, state: "ready" as const };
    ports.readStatus.mockResolvedValue({
      copy: ready,
      blockers: [],
      reviewToken: "original-review",
    });
    ports.snapshot.mockRejectedValueOnce(new Error("Response lost"));
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, receipt, ports),
    ).rejects.toThrow("Response lost");
    expect(receipt.recoverySnapshotReview).toEqual({
      requestId: "launch:source-snapshot",
      reviewToken: "original-review",
    });
    expect(ports.persist.mock.invocationCallOrder[0]).toBeLessThan(
      ports.snapshot.mock.invocationCallOrder[0]!,
    );
    const saved = readLibraryLaunchAttempt(
      encodeLibraryLaunchAttempt({
        version: 1,
        requestId: input.requestId,
        threadId: ThreadId.make("destination-thread"),
        receipt,
        review: {
          authorityEnvironmentId,
          model: {
            key: "codex:model",
            selection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
          },
          title: "Continue work",
          mode: "clone",
          rootPath: input.rootPath,
          copy: null,
          recoverySource: ready,
          carryContext: "Continue the saved work",
          keepOnComputer: false,
        },
      }),
    )!;
    expect(saved.review.recoverySource).toEqual(ready);
    expect(saved.receipt.recoverySnapshotReview).toEqual(receipt.recoverySnapshotReview);
    ports.readStatus.mockResolvedValue({
      copy: ready,
      blockers: [],
      reviewToken: "changed-review",
    });
    ports.snapshot.mockResolvedValue(ready);
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: ready });
    await preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, saved.receipt, ports);
    expect(ports.readStatus).toHaveBeenCalledTimes(1);
    expect(ports.snapshot.mock.calls.map(([call]) => call.input)).toEqual([
      {
        requestId: "launch:source-snapshot",
        workingCopyId: source.id,
        reviewToken: "original-review",
      },
      {
        requestId: "launch:source-snapshot",
        workingCopyId: source.id,
        reviewToken: "original-review",
      },
    ]);
  });

  it("does not dispatch a snapshot until its exact review can be saved", async () => {
    const { ports, receipt } = harness();
    const ready = { ...source, state: "ready" as const };
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "review" });
    ports.persist.mockRejectedValue(new Error("Storage full"));
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, receipt, ports),
    ).rejects.toThrow("Storage full");
    expect(ports.snapshot).not.toHaveBeenCalled();
  });

  it("requires a deliberate new review after a definitive blocked snapshot", async () => {
    const { ports, receipt, grant } = harness();
    const ready = { ...source, state: "ready" as const };
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "old-review" });
    ports.snapshot.mockRejectedValueOnce(new LibraryError({ reason: "blocked" }));
    const args = { ...input, sourceCopy: ready };
    await expect(preparePortableLibraryLaunchCopy(args, receipt, ports)).rejects.toThrow();
    expect(receipt.recoverySnapshotRejected).toBe(true);
    await expect(preparePortableLibraryLaunchCopy(args, receipt, ports)).rejects.toThrow(
      "Review the latest source files",
    );
    expect(ports.snapshot).toHaveBeenCalledTimes(1);
    delete receipt.recoverySnapshotReview;
    delete receipt.recoverySnapshotRejected;
    receipt.recoverySnapshotAttempt = 1;
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "new-review" });
    ports.snapshot.mockResolvedValue(ready);
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: ready });
    await preparePortableLibraryLaunchCopy(args, receipt, ports);
    expect(ports.snapshot).toHaveBeenLastCalledWith({
      environmentId: sourceEnvironmentId,
      input: {
        requestId: "launch:source-snapshot:1",
        workingCopyId: source.id,
        reviewToken: "new-review",
      },
    });
  });

  it("refreshes the grant while retrying the same destination request after a lost response", async () => {
    const { ports, receipt, grant } = harness();
    ports.restore.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(preparePortableLibraryLaunchCopy(input, receipt, ports)).rejects.toThrow(
      "Connection lost",
    );
    ports.authorize.mockResolvedValue({ ...grant, accessToken: "fresh-grant" });
    await preparePortableLibraryLaunchCopy(input, receipt, ports);
    expect(ports.authorize).toHaveBeenCalledTimes(2);
    expect(ports.restore.mock.calls.map(([call]) => call.input.requestId)).toEqual([
      "launch:restore",
      "launch:restore",
    ]);
    expect(ports.restore.mock.calls[1]![0].input.grant.accessToken).toBe("fresh-grant");
    expect(JSON.stringify(receipt)).not.toContain("grant");
  });

  it("regrants the pinned snapshot after another client publishes a newer source snapshot", async () => {
    const { ports, receipt, grant } = harness();
    const ready = { ...source, state: "ready" as const };
    const snapshotA = { ...ready, recovery: { ...source.recovery!, sha256: "a".repeat(64) } };
    const catalogB = { ...ready, recovery: { ...source.recovery!, sha256: "b".repeat(64) } };
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "review-a" });
    ports.snapshot.mockResolvedValue(snapshotA);
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: snapshotA });
    ports.restore.mockRejectedValueOnce(new Error("Destination response lost"));
    const args = { ...input, sourceCopy: ready };
    await expect(preparePortableLibraryLaunchCopy(args, receipt, ports)).rejects.toThrow(
      "Destination response lost",
    );
    ports.authorize.mockImplementation(async ({ input: request }) => ({
      ...grant,
      sourceCopy: request.sourceCopy ?? catalogB,
      accessToken: "renewed-token",
    }));
    await preparePortableLibraryLaunchCopy(args, receipt, ports);
    expect(ports.authorize.mock.calls.map(([call]) => call.input.sourceCopy)).toEqual([
      snapshotA,
      snapshotA,
    ]);
    expect(ports.restore.mock.calls.map(([call]) => call.input.requestId)).toEqual([
      "launch:restore",
      "launch:restore",
    ]);
    expect(ports.restore.mock.calls[1]![0].input.grant.sourceCopy.recovery?.sha256).toBe(
      snapshotA.recovery.sha256,
    );
    expect(ports.restore.mock.calls[1]![0].input.grant.accessToken).toBe("renewed-token");
    expect(ports.snapshot).toHaveBeenCalledOnce();
    expect(JSON.stringify(receipt)).not.toContain("renewed-token");
    expect(JSON.stringify(receipt)).not.toContain("temporary-grant");
  });

  it("refuses an old ready backup when a fresh source snapshot cannot be read", async () => {
    const { ports, receipt } = harness();
    ports.readStatus.mockRejectedValue(new Error("Source computer offline"));
    await expect(
      preparePortableLibraryLaunchCopy(
        { ...input, sourceCopy: { ...source, state: "ready" } },
        receipt,
        ports,
      ),
    ).rejects.toThrow("Source computer offline");
    expect(ports.authorize).not.toHaveBeenCalled();
    expect(ports.restore).not.toHaveBeenCalled();
  });

  it("snapshots idle kept files without requiring their removal or settlement", async () => {
    const { ports, receipt, grant } = harness();
    const ready = { ...source, state: "ready" as const, keepOnComputer: true };
    ports.readStatus.mockResolvedValue({
      copy: ready,
      blockers: [],
      reviewToken: "snapshot-review",
    });
    ports.snapshot.mockResolvedValue(ready);
    ports.authorize.mockResolvedValue({ ...grant, sourceCopy: ready });
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, receipt, ports),
    ).resolves.toBe(destination);
    expect(ports.snapshot).toHaveBeenCalledWith({
      environmentId: sourceEnvironmentId,
      input: {
        requestId: "launch:source-snapshot",
        workingCopyId: source.id,
        reviewToken: "snapshot-review",
      },
    });
    expect(ready.keepOnComputer).toBe(true);
  });

  it("rejects an unregistered ready source before dispatching a snapshot", async () => {
    const { ports, receipt } = harness();
    const ready = { ...source, state: "ready" as const, registered: false };
    ports.readStatus.mockResolvedValue({ copy: ready, blockers: [], reviewToken: "review" });
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, receipt, ports),
    ).rejects.toThrow("source files changed");
    expect(ports.snapshot).not.toHaveBeenCalled();
  });

  it("requires a snapshot review token when source activity blocks status", async () => {
    const { ports, receipt } = harness();
    const ready = { ...source, state: "ready" as const };
    ports.readStatus.mockResolvedValue({
      copy: ready,
      blockers: ["A conversation is still running in this working folder."],
      reviewToken: null,
    });
    await expect(
      preparePortableLibraryLaunchCopy({ ...input, sourceCopy: ready }, receipt, ports),
    ).rejects.toThrow("A conversation is still running");
    expect(ports.snapshot).not.toHaveBeenCalled();
    expect(ports.authorize).not.toHaveBeenCalled();
  });

  it("rejects changed authority grants and destination identity", async () => {
    for (const grantChange of [
      { destinationEnvironmentId: sourceEnvironmentId },
      { libraryEnvironmentId: sourceEnvironmentId },
      { sourceCopy: { ...source, recovery: { ...source.recovery!, sha256: "c".repeat(64) } } },
    ]) {
      const { ports, receipt, grant } = harness();
      ports.authorize.mockResolvedValue({ ...grant, ...grantChange });
      await expect(preparePortableLibraryLaunchCopy(input, receipt, ports)).rejects.toThrow(
        "authorized saved files changed",
      );
      expect(ports.restore).not.toHaveBeenCalled();
    }
    for (const change of [
      { id: source.id },
      { rootPath: source.rootPath },
      { environmentId: sourceEnvironmentId },
      { keepOnComputer: false },
      { registered: false },
    ]) {
      const { ports, receipt } = harness();
      ports.restore.mockResolvedValue({ ...destination, ...change });
      await expect(preparePortableLibraryLaunchCopy(input, receipt, ports)).rejects.toThrow(
        "selected destination",
      );
    }
  });
});
