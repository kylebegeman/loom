import { ProjectOperations } from "./ProjectOperations.ts";
import {
  LibraryProject,
  LibraryWorkingCopy,
  LibraryError,
  type LibraryOperationInput,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import * as Replication from "./LibraryReplication.ts";
import * as LibraryHistorySource from "./LibraryHistorySource.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import {
  LIBRARY_HEALTH_WS_METHODS as LH,
  LIBRARY_READINESS_WS_METHODS as LR,
  LIBRARY_SEARCH_WS_METHODS,
  LIBRARY_DECISIONS_WS_METHODS,
  LIBRARY_TIMELINE_WS_METHODS as LT,
  LIBRARY_BRIEF_WS_METHODS as BRIEF,
  LIBRARY_BRIEF_SUGGESTION_WS_METHODS as SUGGEST,
  LIBRARY_WS_METHODS as L,
  type LibraryReplicationStatusRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as LibraryBriefSuggestions from "./LibraryBriefSuggestions.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryTimeline from "./LibraryTimeline.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";

const decodeOperationProject = Schema.decodeUnknownEffect(LibraryProject);
const decodeOperationCopy = Schema.decodeUnknownEffect(LibraryWorkingCopy);
const isLibraryFailure = Schema.is(LibraryError);

export const makeProjectLibraryRpcHandlers = Effect.fn("ProjectLibrary.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  session: AuthenticatedSession,
) {
  const replication = yield* Replication.LibraryReplication;
  const history = yield* LibraryHistorySource.LibraryHistorySource;
  const library = yield* LibraryService.LibraryService;
  const timeline = yield* LibraryTimeline.LibraryTimeline;
  const assets = yield* Assets.LibraryAssetService;
  const workspace = yield* LibraryWorkspace.LibraryWorkspace;
  const suggestions = yield* LibraryBriefSuggestions.LibraryBriefSuggestions;
  const operations = yield* ProjectOperations;
  const execute = Effect.fn("ProjectLibrary.executeOperation")(function* (
    request: Exclude<LibraryOperationInput, { kind: "launch" }>,
  ) {
    const id = yield* operations.operationId(request.input.requestId, request.kind);
    return yield* operations.execute(id, request, session);
  });

  return {
    [L.subscribeRefreshes]: () => auth.stream(L.subscribeRefreshes, library.subscribeRefreshes),
    [L.replicationStatus]: (input: LibraryReplicationStatusRequest) =>
      auth.effect(L.replicationStatus, replication.statusFor(input.threadIds)),
    [L.flushHistory]: (input: LibraryReplicationStatusRequest) =>
      auth.effect(
        L.flushHistory,
        replication.flush.pipe(Effect.andThen(replication.statusFor(input.threadIds))),
      ),
    [L.preparation]: (input: { readonly requestId: string }) =>
      auth.effect(L.preparation, workspace.preparation(input)),
    [L.snapshotThread]: (input: Parameters<typeof history.snapshotThread>[0]) =>
      auth.effect(L.snapshotThread, history.snapshotThread(input)),
    [L.registerThread]: (input: Parameters<typeof library.registerThread>[0]) =>
      auth.effect(L.registerThread, library.registerThread(input)),
    [L.info]: () =>
      auth.effect(
        L.info,
        library.info.pipe(Effect.map((info) => ({ ...info, assets: assets.mode }))),
      ),
    [L.projects]: (input: Parameters<typeof library.projects>[0]) =>
      auth.effect(L.projects, library.projects(input)),
    [L.project]: (input: Parameters<typeof library.project>[0]) =>
      auth.effect(L.project, library.project(input)),
    [L.createProject]: (input: Parameters<typeof library.createProject>[0]) =>
      auth.effect(
        L.createProject,
        execute({ kind: "create", input }).pipe(
          Effect.flatMap((operation) => decodeOperationProject(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.updateProject]: (input: Parameters<typeof library.updateProject>[0]) =>
      auth.effect(L.updateProject, library.updateProject(input)),
    [L.archiveProject]: (input: Parameters<typeof library.archiveProject>[0]) =>
      auth.effect(L.archiveProject, library.archiveProject(input)),
    [L.registerCopy]: (input: Parameters<typeof library.registerCopy>[0]) =>
      auth.effect(L.registerCopy, library.registerCopy(input)),
    [L.copies]: (input: Parameters<typeof library.copies>[0]) =>
      auth.effect(L.copies, library.copies(input)),
    [L.threads]: (input: Parameters<typeof library.threads>[0]) =>
      auth.effect(L.threads, library.threads(input)),
    [L.lookupThread]: (input: Parameters<typeof library.lookupThread>[0]) =>
      auth.effect(L.lookupThread, library.lookupThread(input)),
    [L.threadIndex]: (input: Parameters<typeof library.threadIndex>[0]) =>
      auth.effect(L.threadIndex, library.threadIndex(input)),
    [L.threadBinding]: (input: Parameters<typeof workspace.threadBinding>[0]) =>
      auth.effect(L.threadBinding, workspace.threadBinding(input)),
    [L.history]: (input: Parameters<typeof library.history>[0]) =>
      auth.effect(L.history, library.history(input)),
    [LT.timeline]: (input: Parameters<typeof timeline.page>[0]) =>
      auth.effect(LT.timeline, timeline.page(input)),
    [L.ingestHistory]: (input: Parameters<typeof library.ingestHistory>[0]) =>
      auth.effect(L.ingestHistory, library.ingestHistory(input)),
    [L.importShadow]: (input: Parameters<typeof library.importShadow>[0]) =>
      auth.effect(L.importShadow, library.importShadow(input)),
    [L.verifyImport]: (input: Parameters<typeof library.verifyImport>[0]) =>
      auth.effect(L.verifyImport, library.verifyImport(input)),
    [L.inspectFolder]: (input: Parameters<typeof workspace.inspectFolder>[0]) =>
      auth.effect(L.inspectFolder, workspace.inspectFolder(input)),
    [L.prepareCopy]: (input: Parameters<typeof workspace.prepareCopy>[0]) =>
      auth.effect(
        L.prepareCopy,
        execute({ kind: "prepare", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.copyStatus]: (input: Parameters<typeof workspace.status>[0]) =>
      auth.effect(L.copyStatus, workspace.status(input)),
    [LH.copyHealth]: (input: Parameters<typeof workspace.health>[0]) =>
      auth.effect(LH.copyHealth, workspace.health(input)),
    [LR.readiness]: (input: Parameters<typeof workspace.readiness>[0]) =>
      auth.effect(LR.readiness, workspace.readiness(input)),
    [LR.profileSettings]: (input: Parameters<typeof workspace.profileSettings>[0]) =>
      auth.effect(LR.profileSettings, workspace.profileSettings(input)),
    [LR.applyProfile]: (input: Parameters<typeof workspace.applyProfile>[0]) =>
      auth.effect(LR.applyProfile, workspace.applyProfile(input)),
    [L.unregisterCopy]: (input: Parameters<typeof workspace.unregister>[0]) =>
      auth.effect(
        L.unregisterCopy,
        execute({ kind: "unregister", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.setCopyRetention]: (input: Parameters<typeof workspace.setCopyRetention>[0]) =>
      auth.effect(L.setCopyRetention, workspace.setCopyRetention(input)),
    [L.reopenCopy]: (input: Parameters<typeof workspace.reopenCopy>[0]) =>
      auth.effect(
        L.reopenCopy,
        execute({ kind: "reopen", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.snapshotCopy]: (input: Parameters<typeof workspace.snapshotCopy>[0]) =>
      auth.effect(
        L.snapshotCopy,
        execute({ kind: "snapshot", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.authorizeRecovery]: (input: Parameters<typeof library.authorizeRecovery>[0]) =>
      auth.effect(L.authorizeRecovery, library.authorizeRecovery(input, session)),
    [L.restoreCopy]: (input: Parameters<typeof workspace.restoreCopy>[0]) =>
      auth.effect(
        L.restoreCopy,
        execute({ kind: "restore", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.releaseCopy]: (input: Parameters<typeof workspace.release>[0]) =>
      auth.effect(
        L.releaseCopy,
        execute({ kind: "release", input }).pipe(
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        ),
      ),
    [L.resolveBinding]: (input: Parameters<typeof workspace.resolveBinding>[0]) =>
      auth.effect(L.resolveBinding, workspace.resolveBinding(input)),
    [L.bindThread]: (input: Parameters<typeof workspace.bindThread>[0]) =>
      auth.effect(L.bindThread, workspace.bindThread(input)),
    [LIBRARY_DECISIONS_WS_METHODS.search]: (input: Parameters<typeof library.decisions>[0]) =>
      auth.effect(LIBRARY_DECISIONS_WS_METHODS.search, library.decisions(input)),
    [LIBRARY_SEARCH_WS_METHODS.search]: (input: Parameters<typeof library.search>[0]) =>
      auth.effect(LIBRARY_SEARCH_WS_METHODS.search, library.search(input)),
    [BRIEF.propose]: (input: Parameters<typeof library.proposeBrief>[0]) =>
      auth.effect(BRIEF.propose, library.proposeBrief(input, { kind: "user" })),
    [BRIEF.proposals]: (input: Parameters<typeof library.briefProposals>[0]) =>
      auth.effect(BRIEF.proposals, library.briefProposals(input)),
    [BRIEF.accept]: (input: Parameters<typeof library.acceptBriefProposal>[0]) =>
      auth.effect(BRIEF.accept, library.acceptBriefProposal(input)),
    [BRIEF.dismiss]: (input: Parameters<typeof library.dismissBriefProposal>[0]) =>
      auth.effect(BRIEF.dismiss, library.dismissBriefProposal(input)),
    [SUGGEST.suggestion]: (input: Parameters<typeof suggestions.suggestion>[0]) =>
      auth.effect(SUGGEST.suggestion, suggestions.suggestion(input)),
    [SUGGEST.start]: (input: Parameters<typeof suggestions.start>[0]) =>
      auth.effect(SUGGEST.start, suggestions.start(input)),
    [SUGGEST.decline]: (input: Parameters<typeof suggestions.decline>[0]) =>
      auth.effect(SUGGEST.decline, suggestions.decline(input)),
  };
});
