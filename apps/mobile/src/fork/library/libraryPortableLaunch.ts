import type { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryAuthorizeRecoveryRequest,
  type LibraryCopyStatus,
  type LibraryProject,
  type LibraryRecoveryGrant,
  type LibraryRegisterCopyRequest,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchReceipt } from "./libraryLaunch";

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
    readonly rootPath: string;
    readonly resourceIds: readonly string[];
    readonly requestId: string;
  },
  receipt: LibraryLaunchReceipt,
  ports: {
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
        rootPath: string;
        grant: LibraryRecoveryGrant;
        resourceIds: readonly string[];
      };
    }) => Promise<LibraryWorkingCopy>;
    persist: () => Promise<void>;
    progress: (label: string) => void;
  },
) {
  const { sourceCopy } = input;
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
        if (cause instanceof LibraryError && cause.reason === "blocked") {
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
    ports.progress("Saving the source file location…");
    await ports.registerCopy({ requestId: `${input.requestId}:source-copy`, copy: source });
    receipt.recoverySnapshotRegistered = true;
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
  const restored = await ports.restore({
    environmentId: input.destinationEnvironmentId,
    input: {
      requestId: `${input.requestId}:restore`,
      project: input.project,
      rootPath: input.rootPath,
      grant,
      resourceIds: input.resourceIds,
    },
  });
  if (
    restored.id === source.id ||
    restored.projectId !== input.project.id ||
    restored.projectRevision !== input.project.revision ||
    restored.environmentId !== input.destinationEnvironmentId ||
    restored.rootPath !== input.rootPath ||
    restored.ownership !== "managed" ||
    restored.state !== "ready" ||
    restored.registered === false ||
    restored.keepOnComputer !== true
  )
    throw new Error("The restored files do not match the selected destination.");
  return restored;
}
