import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import {
  LibraryCreateProjectRequest,
  LibraryError,
  LibraryPrepareCopyRequest,
  LibraryProject,
  LibraryUpdateProjectRequest,
  LibraryWorkingCopy,
  type LibraryOperation,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { libraryLaunchCopyMatchesScope, libraryLaunchPathsEqual } from "./libraryLaunchFiles";

export const SubmittedLibraryProjectRequest = Schema.Struct({
  authorityId: EnvironmentId,
  initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
  environmentId: EnvironmentId,
  request: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("create"), input: LibraryCreateProjectRequest }),
    Schema.Struct({ kind: Schema.Literal("update"), input: LibraryUpdateProjectRequest }),
    Schema.Struct({ kind: Schema.Literal("prepare"), input: LibraryPrepareCopyRequest }),
  ]),
  state: Schema.Literals(["ready", "unknown", "succeeded"]),
  result: Schema.NullOr(Schema.Union([LibraryProject, LibraryWorkingCopy])),
  prepareFiles: Schema.Boolean,
  folder: Schema.optional(Schema.Struct({ environmentId: EnvironmentId, rootPath: Schema.String })),
  registration: Schema.optional(Schema.Literals(["ready", "unknown", "succeeded"])),
});
export type SubmittedLibraryProjectRequest = typeof SubmittedLibraryProjectRequest.Type;
const codec = Schema.fromJsonString(SubmittedLibraryProjectRequest);
export const encodeSubmittedLibraryProjectRequest = Schema.encodeSync(codec);
export function readSubmittedLibraryProjectRequest(serialized: string | undefined) {
  if (!serialized) return null;
  try {
    return Schema.decodeSync(codec)(serialized);
  } catch {
    return false as const;
  }
}
const isLibraryError = Schema.is(LibraryError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const isProject = Schema.is(LibraryProject);
const isCopy = Schema.is(LibraryWorkingCopy);

export type LibraryProjectReceiptLookup = (input: {
  readonly environmentId: EnvironmentId;
  readonly requestId: string;
  readonly kind: SubmittedLibraryProjectRequest["request"]["kind"];
}) => Promise<LibraryOperation | null>;

function checkedResult(
  attempt: SubmittedLibraryProjectRequest,
  result: LibraryProject | LibraryWorkingCopy | { readonly threadId: string } | null,
) {
  if (attempt.request.kind !== "prepare") {
    if (
      !isProject(result) ||
      (attempt.request.kind === "update" && result.id !== attempt.request.input.projectId)
    )
      throw new Error("The receipt does not match the saved project request.");
    return result;
  }
  const input = attempt.request.input;
  if (
    !isCopy(result) ||
    result.environmentId !== attempt.environmentId ||
    result.projectId !== input.project.id ||
    result.state !== "ready" ||
    result.registered === false ||
    !libraryLaunchCopyMatchesScope(input.project, result, null) ||
    (input.rootPath !== undefined && !libraryLaunchPathsEqual(input.rootPath, result.rootPath))
  )
    throw new Error("The receipt does not match the selected computer and project files.");
  return result;
}

export function assertLibraryProjectInitiator(
  attempt: SubmittedLibraryProjectRequest,
  identity: SubmittedLibraryProjectRequest["initiator"],
) {
  if (
    attempt.initiator &&
    (attempt.initiator.issuer !== identity?.issuer ||
      attempt.initiator.subject !== identity?.subject)
  )
    throw new Error("Sign in with the account that started this request before continuing.");
}

/** Checking an uncertain outcome never also retries its mutation. */
export async function runSubmittedLibraryProjectRequest(
  attempt: SubmittedLibraryProjectRequest,
  authorityId: EnvironmentId,
  ports: {
    readonly identity?: { readonly issuer: string; readonly subject: string } | undefined;
    readonly currentIdentity?: (() => SubmittedLibraryProjectRequest["initiator"]) | undefined;
    readonly persist: (next: SubmittedLibraryProjectRequest) => Promise<void>;
    readonly execute: (
      request: SubmittedLibraryProjectRequest,
    ) => Promise<LibraryProject | LibraryWorkingCopy>;
    // A listing cannot establish whether the original request was accepted.
    readonly lookup?: LibraryProjectReceiptLookup;
  },
): Promise<SubmittedLibraryProjectRequest> {
  if (attempt.authorityId !== authorityId)
    throw new Error("Reconnect the Library used for this request before continuing.");
  assertLibraryProjectInitiator(
    attempt,
    ports.currentIdentity ? ports.currentIdentity() : ports.identity,
  );
  if (attempt.state === "succeeded") {
    checkedResult(attempt, attempt.result);
    return attempt;
  }
  if (attempt.state === "unknown") {
    if (!ports.lookup)
      throw new Error(
        "This server cannot check the saved result yet. Keep the request for recovery and update Loom before retrying.",
      );
    const operation = await ports.lookup({
      environmentId: attempt.environmentId,
      requestId: attempt.request.input.requestId,
      kind: attempt.request.kind,
    });
    if (
      operation &&
      (operation.kind !== attempt.request.kind || operation.environmentId !== attempt.environmentId)
    )
      throw new Error("The receipt belongs to another request or computer.");
    if (operation?.state === "queued" || operation?.state === "running")
      throw new Error(
        `${operation.phase || "The saved request is still running"}. Check its result again.`,
      );
    if (operation?.state === "cancelled")
      throw new Error(
        "This request was cancelled. Review its completed steps before starting another.",
      );
    const next: SubmittedLibraryProjectRequest =
      operation?.state === "succeeded"
        ? { ...attempt, state: "succeeded", result: checkedResult(attempt, operation.result) }
        : { ...attempt, state: "ready" };
    await ports.persist(next);
    return next;
  }
  const submitted: SubmittedLibraryProjectRequest = { ...attempt, state: "unknown" };
  await ports.persist(submitted);
  assertLibraryProjectInitiator(
    submitted,
    ports.currentIdentity ? ports.currentIdentity() : ports.identity,
  );
  let result: LibraryProject | LibraryWorkingCopy;
  try {
    result = await ports.execute(submitted);
  } catch (cause) {
    if ((isLibraryError(cause) && cause.reason !== "io") || isAuthorizationError(cause))
      await ports.persist({ ...submitted, state: "ready" });
    throw cause;
  }
  const complete: SubmittedLibraryProjectRequest = {
    ...submitted,
    state: "succeeded",
    result: checkedResult(submitted, result),
  };
  await ports.persist(complete);
  return complete;
}

export async function registerSubmittedLibraryProjectCopy(
  attempt: SubmittedLibraryProjectRequest,
  authorityId: EnvironmentId,
  ports: {
    readonly identity?: SubmittedLibraryProjectRequest["initiator"];
    readonly currentIdentity?: (() => SubmittedLibraryProjectRequest["initiator"]) | undefined;
    readonly persist: (next: SubmittedLibraryProjectRequest) => Promise<void>;
    readonly copies: () => Promise<readonly LibraryWorkingCopy[]>;
    readonly register: (input: { requestId: string; copy: LibraryWorkingCopy }) => Promise<void>;
  },
) {
  if (
    attempt.authorityId !== authorityId ||
    attempt.request.kind !== "prepare" ||
    attempt.state !== "succeeded" ||
    !isCopy(attempt.result)
  )
    throw new Error("Reconnect the Library used to prepare these files.");
  assertLibraryProjectInitiator(
    attempt,
    ports.currentIdentity ? ports.currentIdentity() : ports.identity,
  );
  checkedResult(attempt, attempt.result);
  if (attempt.registration === "succeeded") return attempt;
  const copy = attempt.result;
  if (attempt.registration === "unknown") {
    const registered = (await ports.copies()).find((entry) => entry.id === copy.id);
    if (
      registered &&
      (registered.environmentId !== copy.environmentId ||
        registered.rootPath !== copy.rootPath ||
        registered.projectId !== copy.projectId ||
        registered.state !== "ready" ||
        registered.registered === false)
    )
      throw new Error("The saved file location belongs to another computer or project.");
    const next = {
      ...attempt,
      registration: registered ? ("succeeded" as const) : ("ready" as const),
    };
    await ports.persist(next);
    return next;
  }
  const submitted = { ...attempt, registration: "unknown" as const };
  await ports.persist(submitted);
  assertLibraryProjectInitiator(
    submitted,
    ports.currentIdentity ? ports.currentIdentity() : ports.identity,
  );
  try {
    await ports.register({ requestId: `${attempt.request.input.requestId}:copy`, copy });
  } catch (cause) {
    if ((isLibraryError(cause) && cause.reason !== "io") || isAuthorizationError(cause))
      await ports.persist({ ...submitted, registration: "ready" });
    throw cause;
  }
  const complete = { ...submitted, registration: "succeeded" as const };
  await ports.persist(complete);
  return complete;
}
