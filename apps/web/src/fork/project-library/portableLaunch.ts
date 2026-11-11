import * as Schema from "effect/Schema";
import {
  checkLibraryCopyRequest,
  checkedLibraryCopyRegistration,
  type LibraryCopyReceiptTarget,
} from "@t3tools/client-runtime/fork";
import {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
} from "@t3tools/contracts";
import {
  LibraryProject,
  LibraryContinuation,
  LibraryWorkingCopy,
  LibraryError,
  type LibraryCopyStatus,
  type LibraryOperation,
  type LibraryRecoveryGrant,
  type LibraryAuthorizeRecoveryRequest,
  type LibraryRestoreCopyRequest,
  type LibrarySnapshotCopyRequest,
} from "@t3tools/contracts/fork";

export const PortableLaunchAttempt = Schema.NullOr(
  Schema.Struct({
    authorityId: Schema.optionalKey(EnvironmentId),
    initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
    authorityInitiator: Schema.optionalKey(
      Schema.Struct({ issuer: Schema.String, subject: Schema.String }),
    ),
    environmentId: EnvironmentId,
    project: LibraryProject,
    /** Absent lets a computer with `serverChosenFolders` pick a new folder for the restore. */
    rootPath: Schema.optional(Schema.String),
    resourceIds: Schema.Array(Schema.String),
    sourceCopy: LibraryWorkingCopy,
    requestId: Schema.String,
    registerRequestId: Schema.String,
    snapshotRequestId: Schema.String,
    snapshotState: Schema.optional(Schema.Literals(["unknown", "ready"])),
    restoreState: Schema.optional(Schema.Literals(["unknown", "ready"])),
    sourceRegistration: Schema.optional(Schema.Literals(["unknown", "ready", "succeeded"])),
    registration: Schema.optional(Schema.Literals(["unknown", "ready", "succeeded"])),
    sourceReviewToken: Schema.optional(Schema.String),
    sourceSnapshotRejected: Schema.optional(Schema.Boolean),
    sourceSnapshot: Schema.optional(LibraryWorkingCopy),
    copy: Schema.NullOr(LibraryWorkingCopy),
    keepOnComputer: Schema.Boolean,
    launch: Schema.optional(
      Schema.Struct({
        title: Schema.String,
        context: Schema.String,
        modelSelection: ModelSelection,
        runtimeMode: RuntimeMode,
        interactionMode: ProviderInteractionMode,
        requestedModelSelection: Schema.optional(ModelSelection),
        requestedRuntimeMode: Schema.optional(RuntimeMode),
        continuationOf: Schema.optional(LibraryContinuation),
      }),
    ),
  }),
);
export type PortableLaunchFiles = NonNullable<typeof PortableLaunchAttempt.Type>;

const isLibraryError = Schema.is(LibraryError);

/** Persist receipts and identities, while short-lived download access stays only in memory. */
export async function restoreLibraryLaunchCopy(
  initial: PortableLaunchFiles,
  commands: {
    readonly lookup?:
      | ((target: {
          environmentId: EnvironmentId;
          input: { requestId: string; kind: LibraryCopyReceiptTarget["kind"] };
        }) => Promise<LibraryOperation | null>)
      | undefined;
    readonly copies?: (() => Promise<readonly LibraryWorkingCopy[]>) | undefined;
    readonly readStatus: (input: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly workingCopyId: string };
    }) => Promise<LibraryCopyStatus>;
    readonly snapshot: (input: {
      readonly environmentId: EnvironmentId;
      readonly input: LibrarySnapshotCopyRequest;
    }) => Promise<LibraryWorkingCopy>;
    readonly authorize: (input: LibraryAuthorizeRecoveryRequest) => Promise<LibraryRecoveryGrant>;
    readonly restore: (input: {
      readonly environmentId: EnvironmentId;
      readonly input: LibraryRestoreCopyRequest;
    }) => Promise<LibraryWorkingCopy>;
    readonly register: (input: {
      readonly requestId: string;
      readonly copy: LibraryWorkingCopy;
    }) => Promise<LibraryWorkingCopy>;
    readonly save: (attempt: PortableLaunchFiles) => void;
  },
) {
  let attempt = initial;
  const checked = (accessRepair?: LibraryError["accessRepair"]) =>
    new LibraryError({
      reason: "blocked",
      detail: "The saved file request has been checked. Continue explicitly when you are ready.",
      ...(accessRepair ? { accessRepair } : {}),
    });
  if (attempt.sourceSnapshotRejected && !attempt.sourceSnapshot)
    throw new Error("Review the latest source files before trying another snapshot.");
  if (attempt.snapshotState === "unknown" && !attempt.sourceSnapshot) {
    if (!commands.lookup)
      throw new Error("Update this computer to check the original snapshot before retrying.");
    const result = await checkLibraryCopyRequest(
      {
        environmentId: attempt.sourceCopy.environmentId,
        requestId: attempt.snapshotRequestId,
        kind: "snapshot",
        projectId: attempt.project.id,
        workingCopyId: attempt.sourceCopy.id,
      },
      commands.lookup,
    );
    attempt = {
      ...attempt,
      snapshotState: "ready",
      ...(result.copy ? { sourceSnapshot: result.copy } : {}),
    };
    commands.save(attempt);
    throw checked(result.accessRepair);
  }
  if (attempt.restoreState === "unknown" && !attempt.copy) {
    if (!commands.lookup)
      throw new Error("Update this computer to check the original restore before retrying.");
    const result = await checkLibraryCopyRequest(
      {
        environmentId: attempt.environmentId,
        requestId: attempt.requestId,
        kind: "restore",
        projectId: attempt.project.id,
        rootPath: attempt.rootPath,
      },
      commands.lookup,
    );
    attempt = { ...attempt, restoreState: "ready", ...(result.copy ? { copy: result.copy } : {}) };
    commands.save(attempt);
    throw checked(result.accessRepair);
  }
  if (!attempt.copy && attempt.sourceCopy.state === "ready") {
    if (!attempt.sourceSnapshot) {
      if (attempt.sourceSnapshotRejected)
        throw new Error("Review the latest source files before trying another snapshot.");
      if (!attempt.sourceReviewToken) {
        const status = await commands.readStatus({
          environmentId: attempt.sourceCopy.environmentId,
          input: { workingCopyId: attempt.sourceCopy.id },
        });
        if (
          status.copy.id !== attempt.sourceCopy.id ||
          status.copy.environmentId !== attempt.sourceCopy.environmentId ||
          status.copy.projectId !== attempt.project.id ||
          status.copy.state !== "ready" ||
          !status.reviewToken ||
          status.blockers.length
        )
          throw new Error(
            status.blockers.join(" ") ||
              "The source files cannot be saved right now. Retry on their computer.",
          );
        attempt = { ...attempt, sourceReviewToken: status.reviewToken };
        commands.save(attempt);
      }
      attempt = { ...attempt, snapshotState: "unknown" };
      commands.save(attempt);
      const sourceSnapshot = await commands
        .snapshot({
          environmentId: attempt.sourceCopy.environmentId,
          input: {
            requestId: attempt.snapshotRequestId,
            workingCopyId: attempt.sourceCopy.id,
            reviewToken: attempt.sourceReviewToken!,
          },
        })
        .catch((cause: unknown) => {
          if (isLibraryError(cause) && cause.reason === "blocked") {
            attempt = { ...attempt, sourceSnapshotRejected: true };
            commands.save(attempt);
          }
          throw cause;
        });
      if (
        sourceSnapshot.id !== attempt.sourceCopy.id ||
        sourceSnapshot.environmentId !== attempt.sourceCopy.environmentId ||
        sourceSnapshot.projectId !== attempt.project.id ||
        !sourceSnapshot.recovery
      )
        throw new Error("The saved files do not match the selected source.");
      attempt = { ...attempt, sourceSnapshot };
      commands.save(attempt);
    }
    if (attempt.sourceRegistration === "unknown") {
      if (!commands.copies)
        throw new Error(
          "Reconnect the Library to check the saved source registration before retrying.",
        );
      const registered = checkedLibraryCopyRegistration(
        attempt.sourceSnapshot!,
        await commands.copies(),
      );
      commands.save({ ...attempt, sourceRegistration: registered ? "succeeded" : "ready" });
      throw checked();
    }
    if (attempt.sourceRegistration !== "succeeded") {
      attempt = { ...attempt, sourceRegistration: "unknown" };
      commands.save(attempt);
      const registeredSource = await commands.register({
        requestId: `${attempt.registerRequestId}:source`,
        copy: attempt.sourceSnapshot!,
      });
      if (
        registeredSource.id !== attempt.sourceCopy.id ||
        registeredSource.environmentId !== attempt.sourceCopy.environmentId ||
        registeredSource.projectId !== attempt.project.id ||
        registeredSource.recovery?.sha256 !== attempt.sourceSnapshot!.recovery?.sha256
      )
        throw new Error("The latest source files were not registered for this conversation.");
      attempt = { ...attempt, sourceRegistration: "succeeded" };
      commands.save(attempt);
    }
  }
  let copy = attempt.copy;
  if (!copy) {
    const source = attempt.sourceSnapshot ?? attempt.sourceCopy;
    const grant = await commands.authorize({
      sourceEnvironmentId: source.environmentId,
      workingCopyId: source.id,
      destinationEnvironmentId: attempt.environmentId,
      sourceCopy: source,
    });
    if (
      grant.destinationEnvironmentId !== attempt.environmentId ||
      grant.sourceCopy.id !== source.id ||
      grant.sourceCopy.environmentId !== source.environmentId ||
      grant.sourceCopy.projectId !== attempt.project.id ||
      !source.recovery ||
      grant.sourceCopy.recovery?.sha256 !== source.recovery.sha256
    )
      throw new Error("The selected saved files changed. Review the source before starting again.");
    attempt = { ...attempt, restoreState: "unknown" };
    commands.save(attempt);
    copy = await commands.restore({
      environmentId: attempt.environmentId,
      input: {
        requestId: attempt.requestId,
        project: attempt.project,
        ...(attempt.rootPath === undefined ? {} : { rootPath: attempt.rootPath }),
        grant,
        ...(attempt.resourceIds.length ? { resourceIds: attempt.resourceIds } : {}),
      },
    });
  }
  // Without a requested folder, the one the computer chose must hold through registration.
  const rootPath = attempt.rootPath ?? copy.rootPath;
  const matches = (candidate: LibraryWorkingCopy) =>
    candidate.id !== attempt.sourceCopy.id &&
    candidate.environmentId === attempt.environmentId &&
    candidate.projectId === attempt.project.id &&
    candidate.rootPath === rootPath &&
    candidate.ownership === "managed" &&
    candidate.state === "ready" &&
    candidate.keepOnComputer !== false;
  if (!matches(copy)) throw new Error("The restored files do not match the selected destination.");
  if (!attempt.copy) {
    attempt = { ...attempt, copy };
    commands.save(attempt);
  }
  if (attempt.registration === "succeeded") return copy;
  if (attempt.registration === "unknown") {
    if (!commands.copies)
      throw new Error(
        "Reconnect the Library to check the saved file registration before retrying.",
      );
    const registered = checkedLibraryCopyRegistration(copy, await commands.copies());
    commands.save({ ...attempt, registration: registered ? "succeeded" : "ready" });
    throw checked();
  }
  attempt = { ...attempt, registration: "unknown" };
  commands.save(attempt);
  const registered = await commands.register({ requestId: attempt.registerRequestId, copy });
  if (!matches(registered) || registered.id !== copy.id)
    throw new Error("The restored files were not registered for this conversation.");
  commands.save({ ...attempt, copy: registered, registration: "succeeded" });
  return registered;
}
