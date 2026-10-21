import * as Schema from "effect/Schema";
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
  type LibraryRecoveryGrant,
  type LibraryAuthorizeRecoveryRequest,
  type LibraryRestoreCopyRequest,
  type LibrarySnapshotCopyRequest,
} from "@t3tools/contracts/fork";

export const PortableLaunchAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    project: LibraryProject,
    rootPath: Schema.String,
    resourceIds: Schema.Array(Schema.String),
    sourceCopy: LibraryWorkingCopy,
    requestId: Schema.String,
    registerRequestId: Schema.String,
    snapshotRequestId: Schema.String,
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
    copy = await commands.restore({
      environmentId: attempt.environmentId,
      input: {
        requestId: attempt.requestId,
        project: attempt.project,
        rootPath: attempt.rootPath,
        grant,
        ...(attempt.resourceIds.length ? { resourceIds: attempt.resourceIds } : {}),
      },
    });
  }
  const matches = (candidate: LibraryWorkingCopy) =>
    candidate.id !== attempt.sourceCopy.id &&
    candidate.environmentId === attempt.environmentId &&
    candidate.projectId === attempt.project.id &&
    candidate.rootPath === attempt.rootPath &&
    candidate.ownership === "managed" &&
    candidate.state === "ready" &&
    candidate.keepOnComputer !== false;
  if (!matches(copy)) throw new Error("The restored files do not match the selected destination.");
  if (!attempt.copy) {
    attempt = { ...attempt, copy };
    commands.save(attempt);
  }
  const registered = await commands.register({ requestId: attempt.registerRequestId, copy });
  if (!matches(registered) || registered.id !== copy.id)
    throw new Error("The restored files were not registered for this conversation.");
  return registered;
}
