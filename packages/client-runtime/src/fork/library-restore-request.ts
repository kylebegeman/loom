import type { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryWorkingCopy,
  type LibraryAuthorizeRecoveryRequest,
  type LibraryOperation,
  type LibraryOperationInput,
  type LibraryRecoveryGrant,
} from "@t3tools/contracts/fork";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Schema from "effect/Schema";

const isCopy = Schema.is(LibraryWorkingCopy);

export function libraryRestoreRequestContext(operation: LibraryOperation) {
  const context = operation.restoreRequest;
  if (operation.kind !== "restore" || !context)
    throw new Error(
      "Update the destination computer and refresh this request to recover its original restore selection.",
    );
  if (
    context.destinationEnvironmentId !== operation.environmentId ||
    context.project.id !== operation.projectId
  )
    throw new Error("The saved restore selection does not match this request and computer.");
  return context;
}

function sameRestore(original: LibraryOperation, result: LibraryOperation) {
  if (
    result.id !== original.id ||
    result.environmentId !== original.environmentId ||
    stableStringify(libraryRestoreRequestContext(result)) !==
      stableStringify(libraryRestoreRequestContext(original))
  )
    throw new Error(
      "The restore receipt does not match the original request. Keep its saved selection for recovery.",
    );
  if (result.state === "succeeded") {
    const context = libraryRestoreRequestContext(original);
    const copy = result.result;
    if (
      !isCopy(copy) ||
      copy.projectId !== context.project.id ||
      copy.environmentId !== context.destinationEnvironmentId ||
      copy.state !== "ready" ||
      (context.rootPath !== undefined && copy.rootPath !== context.rootPath)
    )
      throw new Error("The restored files do not match the original project and destination.");
  }
  return result;
}

/** A receipt check cannot also renew authorization or repeat the restore. */
export async function checkLibraryRestoreRequest(
  original: LibraryOperation,
  lookup: (target: {
    environmentId: EnvironmentId;
    input: { requestId: string; kind: "restore" };
  }) => Promise<LibraryOperation | null>,
) {
  const context = libraryRestoreRequestContext(original);
  const result = await lookup({
    environmentId: original.environmentId,
    input: { requestId: context.requestId, kind: "restore" },
  });
  if (!result)
    throw new LibraryError({
      reason: "blocked",
      detail:
        "The original restore is unavailable to this account. Sign in with the account that started it and check again.",
      accessRepair: { kind: "ownership", environmentId: original.environmentId },
    });
  return sameRestore(original, result);
}

function resumable(operation: LibraryOperation) {
  if (operation.state !== "failed" && operation.state !== "needs-input")
    throw new Error(
      operation.state === "succeeded"
        ? "These files have already been restored."
        : operation.state === "cancelled"
          ? "This restore was cancelled. Review its completed steps."
          : "This restore is already in progress. Check its result again.",
    );
}

function checkedGrant(operation: LibraryOperation, grant: LibraryRecoveryGrant) {
  const context = libraryRestoreRequestContext(operation);
  if (
    grant.libraryEnvironmentId !== context.libraryEnvironmentId ||
    grant.destinationEnvironmentId !== context.destinationEnvironmentId ||
    stableStringify(grant.sourceCopy) !== stableStringify(context.sourceCopy)
  )
    throw new Error(
      "The recovery authorization does not match the saved source and destination. Keep the original restore selection.",
    );
}

export async function renewLibraryRestoreRequest(
  operation: LibraryOperation,
  authorityId: EnvironmentId | null,
  ports: {
    assertCurrent: () => void;
    authorize: (target: {
      environmentId: EnvironmentId;
      input: LibraryAuthorizeRecoveryRequest;
    }) => Promise<LibraryRecoveryGrant>;
  },
) {
  const context = libraryRestoreRequestContext(operation);
  resumable(operation);
  if (authorityId !== context.libraryEnvironmentId)
    throw new Error("Reconnect the Library used for this restore before renewing authorization.");
  ports.assertCurrent();
  const grant = await ports.authorize({
    environmentId: context.libraryEnvironmentId,
    input: {
      sourceEnvironmentId: context.sourceCopy.environmentId,
      workingCopyId: context.sourceCopy.id,
      destinationEnvironmentId: context.destinationEnvironmentId,
      sourceCopy: context.sourceCopy,
    },
  });
  ports.assertCurrent();
  checkedGrant(operation, grant);
  return grant;
}

/** The new grant replaces only authorization; both durable request identities stay intact. */
export async function continueLibraryRestoreRequest(
  operation: LibraryOperation,
  grant: LibraryRecoveryGrant,
  now: number,
  ports: {
    assertCurrent: () => void;
    execute: (target: {
      environmentId: EnvironmentId;
      input: { operationId: string; request: LibraryOperationInput };
    }) => Promise<LibraryOperation>;
  },
) {
  const context = libraryRestoreRequestContext(operation);
  resumable(operation);
  checkedGrant(operation, grant);
  if (!(Date.parse(grant.expiresAt) > now))
    throw new Error(
      "This recovery authorization expired. Renew it before explicitly continuing the restore.",
    );
  ports.assertCurrent();
  return sameRestore(
    operation,
    await ports.execute({
      environmentId: context.destinationEnvironmentId,
      input: {
        operationId: operation.id,
        request: {
          kind: "restore",
          input: {
            requestId: context.requestId,
            project: context.project,
            ...(context.rootPath === undefined ? {} : { rootPath: context.rootPath }),
            ...(context.resourceIds === undefined ? {} : { resourceIds: context.resourceIds }),
            grant,
          },
        },
      },
    }),
  );
}

export type LibraryCopyReceiptTarget = {
  readonly environmentId: EnvironmentId;
  readonly requestId: string;
  readonly kind: "prepare" | "restore" | "reopen" | "snapshot";
  readonly projectId: string;
  readonly workingCopyId?: string | undefined;
  readonly rootPath?: string | undefined;
};

export async function checkLibraryCopyRequest(
  target: LibraryCopyReceiptTarget,
  lookup: (target: {
    environmentId: EnvironmentId;
    input: { requestId: string; kind: LibraryCopyReceiptTarget["kind"] };
  }) => Promise<LibraryOperation | null>,
) {
  const operation = await lookup({
    environmentId: target.environmentId,
    input: { requestId: target.requestId, kind: target.kind },
  });
  if (
    operation &&
    (operation.kind !== target.kind ||
      operation.environmentId !== target.environmentId ||
      operation.projectId !== target.projectId)
  )
    throw new Error("The file receipt belongs to another request, project or computer.");
  if (
    operation?.state === "running" ||
    operation?.state === "queued" ||
    operation?.state === "cancelled"
  )
    throw new LibraryError({
      reason: "blocked",
      detail:
        operation.state === "cancelled"
          ? "This file request was cancelled. Review its completed steps before starting another."
          : "This file request is already running. Check its result again.",
      ...(operation.accessRepair ? { accessRepair: operation.accessRepair } : {}),
    });
  const copy = operation?.state === "succeeded" ? operation.result : null;
  if (
    operation?.state === "succeeded" &&
    (!isCopy(copy) ||
      copy.projectId !== target.projectId ||
      copy.environmentId !== target.environmentId ||
      copy.state !== "ready" ||
      (target.workingCopyId !== undefined && copy.id !== target.workingCopyId) ||
      (target.rootPath !== undefined && copy.rootPath !== target.rootPath))
  )
    throw new Error("The completed file receipt does not match the original selection.");
  return { copy: isCopy(copy) ? copy : null, accessRepair: operation?.accessRepair };
}

export function checkedLibraryCopyRegistration(
  copy: LibraryWorkingCopy,
  copies: readonly LibraryWorkingCopy[],
) {
  const registered = copies.find((entry) => entry.id === copy.id);
  if (
    registered &&
    (registered.environmentId !== copy.environmentId ||
      registered.projectId !== copy.projectId ||
      registered.rootPath !== copy.rootPath ||
      registered.state !== "ready" ||
      registered.registered === false ||
      registered.recovery?.sha256 !== copy.recovery?.sha256)
  )
    throw new Error("The registered files do not match the original saved selection.");
  return registered ?? null;
}
