import * as Schema from "effect/Schema";
import {
  checkLibraryCopyRequest,
  checkedLibraryCopyRegistration,
  type LibraryCopyReceiptTarget,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryAuthorizeRecoveryRequest,
  type LibraryCopyStatus,
  type LibraryProject,
  type LibraryOperation,
  type LibraryRecoveryGrant,
  type LibraryRegisterCopyRequest,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchReceipt } from "./libraryLaunch";

const isLibraryErrorValue = Schema.is(LibraryError);

const sameSource = (left: LibraryWorkingCopy, right: LibraryWorkingCopy) =>
  left.id === right.id &&
  left.environmentId === right.environmentId &&
  left.projectId === right.projectId &&
  left.rootPath === right.rootPath;

/** Accepted snapshots survive registration failures; temporary access grants never enter the receipt. */
export async function preparePortableLibraryLaunchCopy(
  input: {
    readonly sourceCopy: LibraryWorkingCopy;
    readonly project: LibraryProject;
    readonly destinationEnvironmentId: EnvironmentId;
    readonly authorityEnvironmentId: EnvironmentId;
    /** Empty lets a computer with `serverChosenFolders` pick a new folder for the restore. */
    readonly rootPath: string;
    readonly resourceIds: readonly string[];
    readonly requestId: string;
  },
  receipt: LibraryLaunchReceipt,
  ports: {
    lookup?:
      | ((target: {
          environmentId: EnvironmentId;
          input: { requestId: string; kind: LibraryCopyReceiptTarget["kind"] };
        }) => Promise<LibraryOperation | null>)
      | undefined;
    copies?: (() => Promise<readonly LibraryWorkingCopy[]>) | undefined;
    readStatus: (input: {
      environmentId: EnvironmentId;
      input: { workingCopyId: string };
    }) => Promise<LibraryCopyStatus>;
    snapshot: (input: {
      environmentId: EnvironmentId;
      input: { requestId: string; workingCopyId: string; reviewToken: string };
    }) => Promise<LibraryWorkingCopy>;
    registerCopy: (input: LibraryRegisterCopyRequest) => Promise<void>;
    authorize: (input: {
      environmentId: EnvironmentId;
      input: LibraryAuthorizeRecoveryRequest;
    }) => Promise<LibraryRecoveryGrant>;
    restore: (input: {
      environmentId: EnvironmentId;
      input: {
        requestId: string;
        project: LibraryProject;
        rootPath?: string;
        grant: LibraryRecoveryGrant;
        resourceIds: readonly string[];
      };
    }) => Promise<LibraryWorkingCopy>;
    persist: () => Promise<void>;
    progress: (label: string) => void;
  },
) {
  const { sourceCopy } = input;
  const checked = (accessRepair?: LibraryError["accessRepair"]) =>
    new LibraryError({
      reason: "blocked",
      detail: "The saved file request has been checked. Continue explicitly when you are ready.",
      ...(accessRepair ? { accessRepair } : {}),
    });
  if (receipt.recoverySnapshotRejected && !receipt.recoverySnapshot)
    throw new Error("Review the latest source files before trying another snapshot.");
  if (receipt.snapshotState === "unknown" && !receipt.recoverySnapshot) {
    if (!ports.lookup || !receipt.recoverySnapshotReview)
      throw new Error("Update this computer to check the original snapshot before retrying.");
    const result = await checkLibraryCopyRequest(
      {
        environmentId: sourceCopy.environmentId,
        requestId: receipt.recoverySnapshotReview.requestId,
        kind: "snapshot",
        projectId: input.project.id,
        workingCopyId: sourceCopy.id,
      },
      ports.lookup,
    );
    receipt.snapshotState = "ready";
    if (result.copy) receipt.recoverySnapshot = result.copy;
    await ports.persist();
    throw checked(result.accessRepair);
  }
  if (receipt.restoreState === "unknown" && !receipt.copy) {
    if (!ports.lookup)
      throw new Error("Update this computer to check the original restore before retrying.");
    const result = await checkLibraryCopyRequest(
      {
        environmentId: input.destinationEnvironmentId,
        requestId: `${input.requestId}:restore`,
        kind: "restore",
        projectId: input.project.id,
        ...(input.rootPath ? { rootPath: input.rootPath } : {}),
      },
      ports.lookup,
    );
    receipt.restoreState = "ready";
    if (result.copy) receipt.copy = result.copy;
    await ports.persist();
    throw checked(result.accessRepair);
  }
  const checkedDestination = (restored: LibraryWorkingCopy) => {
    if (
      restored.id === sourceCopy.id ||
      restored.projectId !== input.project.id ||
      restored.projectRevision !== input.project.revision ||
      restored.environmentId !== input.destinationEnvironmentId ||
      (input.rootPath !== "" && restored.rootPath !== input.rootPath) ||
      restored.ownership !== "managed" ||
      restored.state !== "ready" ||
      restored.registered === false ||
      restored.keepOnComputer !== true
    )
      throw new Error("The restored files do not match the selected destination.");
    return restored;
  };
  if (receipt.copy) return checkedDestination(receipt.copy);
  if (!receipt.recoverySnapshot && sourceCopy.state === "ready") {
    if (receipt.recoverySnapshotRejected)
      throw new Error("Review the latest source files before trying another snapshot.");
    ports.progress("Saving the latest source files…");
    if (!receipt.recoverySnapshotReview) {
      const reviewed = await ports.readStatus({
        environmentId: sourceCopy.environmentId,
        input: { workingCopyId: sourceCopy.id },
      });
      if (
        !sameSource(reviewed.copy, sourceCopy) ||
        reviewed.copy.state !== "ready" ||
        reviewed.copy.registered === false ||
        !reviewed.reviewToken
      )
        throw new Error(
          reviewed.blockers[0] ?? "The source files changed. Review them before continuing here.",
        );
      receipt.recoverySnapshotReview = {
        requestId: `${input.requestId}:source-snapshot${receipt.recoverySnapshotAttempt ? `:${receipt.recoverySnapshotAttempt}` : ""}`,
        reviewToken: reviewed.reviewToken,
      };
      await ports.persist();
    }
    receipt.snapshotState = "unknown";
    await ports.persist();
    const snapshot = await ports
      .snapshot({
        environmentId: sourceCopy.environmentId,
        input: {
          requestId: receipt.recoverySnapshotReview.requestId,
          workingCopyId: sourceCopy.id,
          reviewToken: receipt.recoverySnapshotReview.reviewToken,
        },
      })
      .catch(async (cause: unknown) => {
        if (isLibraryErrorValue(cause) && cause.reason === "blocked") {
          receipt.recoverySnapshotRejected = true;
          await ports.persist();
        }
        throw cause;
      });
    if (!sameSource(snapshot, sourceCopy) || snapshot.state !== "ready" || !snapshot.recovery)
      throw new Error("The saved source files do not match this preparation.");
    receipt.recoverySnapshot = snapshot;
    await ports.persist();
  }
  const source = receipt.recoverySnapshot ?? sourceCopy;
  if (
    !sameSource(source, sourceCopy) ||
    !source.recovery ||
    (source.state === "ready" && source.registered === false) ||
    (source.state !== "ready" && source.state !== "released")
  )
    throw new Error(
      "Saved files are unavailable for this source. Reconnect its computer to save them.",
    );
  if (receipt.recoverySnapshot && !receipt.recoverySnapshotRegistered) {
    if (receipt.sourceRegistration === "unknown") {
      if (!ports.copies)
        throw new Error(
          "Reconnect the Library to check the saved source registration before retrying.",
        );
      const registered = checkedLibraryCopyRegistration(source, await ports.copies());
      receipt.sourceRegistration = registered ? "succeeded" : "ready";
      receipt.recoverySnapshotRegistered = registered !== null;
      await ports.persist();
      throw checked();
    }
    ports.progress("Saving the source file location…");
    receipt.sourceRegistration = "unknown";
    await ports.persist();
    await ports.registerCopy({ requestId: `${input.requestId}:source-copy`, copy: source });
    receipt.recoverySnapshotRegistered = true;
    receipt.sourceRegistration = "succeeded";
    await ports.persist();
  }
  ports.progress("Restoring saved project files…");
  const grant = await ports.authorize({
    environmentId: input.authorityEnvironmentId,
    input: {
      sourceEnvironmentId: source.environmentId,
      workingCopyId: source.id,
      destinationEnvironmentId: input.destinationEnvironmentId,
      sourceCopy: source,
    },
  });
  if (
    !sameSource(grant.sourceCopy, source) ||
    grant.sourceCopy.recovery?.sha256 !== source.recovery.sha256 ||
    grant.destinationEnvironmentId !== input.destinationEnvironmentId ||
    grant.libraryEnvironmentId !== input.authorityEnvironmentId
  )
    throw new Error("The authorized saved files changed. Review the source before continuing.");
  receipt.restoreState = "unknown";
  await ports.persist();
  const restored = await ports.restore({
    environmentId: input.destinationEnvironmentId,
    input: {
      requestId: `${input.requestId}:restore`,
      project: input.project,
      ...(input.rootPath ? { rootPath: input.rootPath } : {}),
      grant,
      resourceIds: input.resourceIds,
    },
  });
  return checkedDestination(restored);
}
