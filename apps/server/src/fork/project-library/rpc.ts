import * as Replication from "./LibraryReplication.ts";
import * as LibraryHistorySource from "./LibraryHistorySource.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import {
  LIBRARY_HEALTH_WS_METHODS as LH,
  LIBRARY_SEARCH_WS_METHODS,
  LIBRARY_WS_METHODS as L,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";

export const makeProjectLibraryRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const replication = yield* Replication.LibraryReplication;
    const history = yield* LibraryHistorySource.LibraryHistorySource;
    const library = yield* LibraryService.LibraryService;
    const assets = yield* Assets.LibraryAssetService;
    const workspace = yield* LibraryWorkspace.LibraryWorkspace;
    return {
      [L.subscribeRefreshes]: () => auth.stream(L.subscribeRefreshes, library.subscribeRefreshes),
      [L.replicationStatus]: () => auth.effect(L.replicationStatus, replication.status),
      [L.flushHistory]: () =>
        auth.effect(L.flushHistory, replication.drain.pipe(Effect.andThen(replication.status))),
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
        auth.effect(L.createProject, library.createProject(input)),
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
      [L.ingestHistory]: (input: Parameters<typeof library.ingestHistory>[0]) =>
        auth.effect(L.ingestHistory, library.ingestHistory(input)),
      [L.importShadow]: (input: Parameters<typeof library.importShadow>[0]) =>
        auth.effect(L.importShadow, library.importShadow(input)),
      [L.verifyImport]: (input: Parameters<typeof library.verifyImport>[0]) =>
        auth.effect(L.verifyImport, library.verifyImport(input)),
      [L.inspectFolder]: (input: Parameters<typeof workspace.inspectFolder>[0]) =>
        auth.effect(L.inspectFolder, workspace.inspectFolder(input)),
      [L.prepareCopy]: (input: Parameters<typeof workspace.prepareCopy>[0]) =>
        auth.effect(L.prepareCopy, workspace.prepareCopy(input)),
      [L.copyStatus]: (input: Parameters<typeof workspace.status>[0]) =>
        auth.effect(L.copyStatus, workspace.status(input)),
      [LH.copyHealth]: (input: Parameters<typeof workspace.health>[0]) =>
        auth.effect(LH.copyHealth, workspace.health(input)),
      [L.unregisterCopy]: (input: Parameters<typeof workspace.unregister>[0]) =>
        auth.effect(L.unregisterCopy, workspace.unregister(input)),
      [L.releaseCopy]: (input: Parameters<typeof workspace.release>[0]) =>
        auth.effect(L.releaseCopy, workspace.release(input)),
      [L.resolveBinding]: (input: Parameters<typeof workspace.resolveBinding>[0]) =>
        auth.effect(L.resolveBinding, workspace.resolveBinding(input)),
      [L.bindThread]: (input: Parameters<typeof workspace.bindThread>[0]) =>
        auth.effect(L.bindThread, workspace.bindThread(input)),
      [LIBRARY_SEARCH_WS_METHODS.search]: (input: Parameters<typeof library.search>[0]) =>
        auth.effect(LIBRARY_SEARCH_WS_METHODS.search, library.search(input)),
    };
  });
