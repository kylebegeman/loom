import { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryOperation,
  LibraryRecoveryGrant,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { expect, it, vi } from "vite-plus/test";
import {
  checkLibraryRestoreRequest,
  checkLibraryCopyRequest,
  checkedLibraryCopyRegistration,
  continueLibraryRestoreRequest,
  renewLibraryRestoreRequest,
} from "./library-restore-request.ts";

const library = EnvironmentId.make("library"),
  destination = EnvironmentId.make("destination");
const project = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  archived: false,
  resources: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
};
const source: LibraryWorkingCopy = {
  id: "source",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("source"),
  rootPath: "/source",
  repositories: [],
  ownership: "managed",
  state: "released",
  recovery: {
    archiveKey: "saved",
    sha256: "a".repeat(64),
    byteLength: 12,
    verifiedAt: project.createdAt,
  },
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const original: LibraryOperation = {
  id: "original-operation",
  kind: "restore",
  projectId: project.id,
  environmentId: destination,
  state: "needs-input",
  phase: "Renew authorization",
  attempt: 1,
  error: null,
  result: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  restoreRequest: {
    requestId: "original-request",
    project,
    rootPath: "/original-destination",
    resourceIds: [],
    sourceCopy: source,
    destinationEnvironmentId: destination,
    libraryEnvironmentId: library,
  },
};
const grant: LibraryRecoveryGrant = {
  sourceCopy: source,
  destinationEnvironmentId: destination,
  libraryEnvironmentId: library,
  expiresAt: "2026-11-11T01:00:00Z",
  accessToken: "test-authorization",
};

it("checks the original receipt and renews authorization without continuing the restore", async () => {
  const lookup = vi.fn(async () => original);
  const checked = await checkLibraryRestoreRequest(original, lookup);
  expect(lookup).toHaveBeenCalledExactlyOnceWith({
    environmentId: destination,
    input: { requestId: "original-request", kind: "restore" },
  });
  const authorize = vi.fn(async () => grant);
  expect(
    await renewLibraryRestoreRequest(checked, library, {
      assertCurrent: () => undefined,
      authorize,
    }),
  ).toBe(grant);
  expect(authorize).toHaveBeenCalledExactlyOnceWith({
    environmentId: library,
    input: {
      sourceEnvironmentId: source.environmentId,
      workingCopyId: source.id,
      destinationEnvironmentId: destination,
      sourceCopy: source,
    },
  });
});

it("continues with both original identities and refuses expired or substituted authorization", async () => {
  const execute = vi.fn(async () => ({ ...original, state: "running" as const }));
  const ports = { execute, assertCurrent: () => undefined };
  await continueLibraryRestoreRequest(original, grant, Date.parse(project.createdAt), ports);
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    environmentId: destination,
    input: {
      operationId: "original-operation",
      request: {
        kind: "restore",
        input: {
          requestId: "original-request",
          project,
          rootPath: "/original-destination",
          resourceIds: [],
          grant,
        },
      },
    },
  });
  for (const invalid of [
    { ...grant, expiresAt: project.createdAt },
    { ...grant, destinationEnvironmentId: source.environmentId },
    {
      ...grant,
      sourceCopy: { ...source, recovery: { ...source.recovery!, archiveKey: "substitute" } },
    },
  ])
    await expect(
      continueLibraryRestoreRequest(original, invalid, Date.parse(project.createdAt), ports),
    ).rejects.toThrow();
  expect(execute).toHaveBeenCalledOnce();
});

it("refuses missing, foreign and running receipts and stops when the account changes during renewal", async () => {
  for (const result of [
    null,
    { ...original, id: "another-operation" },
    { ...original, restoreRequest: { ...original.restoreRequest!, requestId: "another-request" } },
  ])
    await expect(checkLibraryRestoreRequest(original, async () => result)).rejects.toThrow();
  const authorize = vi.fn(async () => grant);
  await expect(
    renewLibraryRestoreRequest({ ...original, state: "running" }, library, {
      authorize,
      assertCurrent: () => undefined,
    }),
  ).rejects.toThrow("in progress");
  expect(authorize).not.toHaveBeenCalled();
  let current = true;
  await expect(
    renewLibraryRestoreRequest(original, library, {
      authorize: async () => {
        current = false;
        return grant;
      },
      assertCurrent: () => {
        if (!current) throw new Error("Account changed");
      },
    }),
  ).rejects.toThrow("Account changed");
});

it("matches recovered file and registration receipts to the original project, computer and archive", async () => {
  const copy: LibraryWorkingCopy = {
    ...source,
    id: "restored",
    environmentId: destination,
    rootPath: "/original-destination",
    state: "ready",
  };
  const target = {
    environmentId: destination,
    requestId: "original-request",
    kind: "restore" as const,
    projectId: project.id,
    rootPath: copy.rootPath,
  };
  const lookup = vi.fn(async () => ({ ...original, state: "succeeded" as const, result: copy }));
  expect((await checkLibraryCopyRequest(target, lookup)).copy).toEqual(copy);
  for (const invalid of [
    { ...copy, projectId: "another-project" },
    { ...copy, rootPath: "/another-folder" },
    { ...copy, environmentId: source.environmentId },
  ])
    await expect(
      checkLibraryCopyRequest(target, async () => ({
        ...original,
        state: "succeeded",
        result: invalid,
      })),
    ).rejects.toThrow("original selection");
  expect(checkedLibraryCopyRegistration(copy, [copy])).toEqual(copy);
  expect(() =>
    checkedLibraryCopyRegistration(copy, [
      { ...copy, recovery: { ...copy.recovery!, sha256: "b".repeat(64) } },
    ]),
  ).toThrow("original saved selection");
});
