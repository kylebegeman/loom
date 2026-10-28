import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import type { LibraryResolvedBinding } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as CommandReceiptStore from "../../orchestration-v2/CommandReceiptStore.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "../../orchestration-v2/UserFacingErrors.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as LibraryFolderGuard from "./LibraryFolderGuard.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";

const environmentId = EnvironmentId.make("environment:library-folder-guard");
const projectId = ProjectId.make("library-copy:copy:folder-guard");
const boundThreadId = ThreadId.make("thread:library-folder-guard:bound");
const unboundThreadId = ThreadId.make("thread:library-folder-guard:unbound");

/** Real folders, so the copy folder is a realpath the way bindThread records it. */
const makeFolders = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "library-folder-guard-" }),
  );
  const copy = path.join(root, "copy");
  const other = path.join(root, "other");
  yield* fs.makeDirectory(copy);
  yield* fs.makeDirectory(other);
  return { root, copy, other };
});

const bindingFor = (cwd: string): LibraryResolvedBinding => ({
  cwd,
  localProjectId: projectId,
  repositoryPaths: [cwd],
  binding: {
    projectId: "library-project",
    projectRevision: 1,
    workingCopyId: "copy",
    environmentId,
    resourceIds: [],
  },
});

const projectRow = (workspaceRoot: string): ProjectStore.ProjectRow => ({
  projectId,
  title: "Library copy",
  workspaceRoot,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
  deletedAt: null,
});

const guardLayer = (input: { readonly copy: string; readonly projectRoot: string }) =>
  LibraryFolderGuard.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LibraryWorkspaceStore)({
          getBinding: (threadId) =>
            Effect.succeed(threadId === boundThreadId ? bindingFor(input.copy) : null),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (id) =>
            Effect.succeed(
              id === projectId ? Option.some(projectRow(input.projectRoot)) : Option.none(),
            ),
        }),
        NodeServices.layer,
      ),
    ),
  );

const check = (
  layer: ReturnType<typeof guardLayer>,
  input: { readonly threadId: ThreadId; readonly worktreePath: string | null },
) =>
  Effect.flatMap(LibraryFolderGuard.LibraryFolderGuard, (guard) =>
    guard.assertFolderChange({ ...input, projectId }),
  ).pipe(Effect.provide(layer), Effect.flip, Effect.option);

const expectRefused = (outcome: Option.Option<{ readonly message: string }>) =>
  expect(Option.getOrUndefined(outcome)?.message).toBe(
    LibraryFolderGuard.LIBRARY_FOLDER_CHANGE_REFUSAL,
  );

describe("LibraryFolderGuard", () => {
  it.effect("refuses moving a bound conversation to another folder", () =>
    Effect.gen(function* () {
      const { copy, other } = yield* makeFolders;
      const layer = guardLayer({ copy, projectRoot: copy });
      expectRefused(yield* check(layer, { threadId: boundThreadId, worktreePath: other }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("allows the copy folder itself, however the path is written", () =>
    Effect.gen(function* () {
      const { copy, other } = yield* makeFolders;
      const layer = guardLayer({ copy, projectRoot: other });
      expect(yield* check(layer, { threadId: boundThreadId, worktreePath: copy })).toEqual(
        Option.none(),
      );
      expect(
        yield* check(layer, { threadId: boundThreadId, worktreePath: `${other}/../copy/` }),
      ).toEqual(Option.none());
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a symlink to the copy folder, which the next turn would refuse too", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, copy } = yield* makeFolders;
      const alias = path.join(root, "alias");
      yield* fs.symlink(copy, alias);
      expect(yield* fs.realPath(alias)).toBe(copy);
      const layer = guardLayer({ copy, projectRoot: copy });
      expectRefused(yield* check(layer, { threadId: boundThreadId, worktreePath: alias }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves unbound conversations free to move", () =>
    Effect.gen(function* () {
      const { copy, other } = yield* makeFolders;
      const layer = guardLayer({ copy, projectRoot: copy });
      expect(yield* check(layer, { threadId: unboundThreadId, worktreePath: other })).toEqual(
        Option.none(),
      );
      expect(
        yield* Effect.flatMap(LibraryFolderGuard.LibraryFolderGuard, (guard) =>
          guard.assertMayLeaveFolder(unboundThreadId),
        ).pipe(Effect.provide(layer), Effect.flip, Effect.option),
      ).toEqual(Option.none());
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves a cleared worktree to the project root", () =>
    Effect.gen(function* () {
      const { copy, other } = yield* makeFolders;
      expect(
        yield* check(guardLayer({ copy, projectRoot: copy }), {
          threadId: boundThreadId,
          worktreePath: null,
        }),
      ).toEqual(Option.none());
      expectRefused(
        yield* check(guardLayer({ copy, projectRoot: other }), {
          threadId: boundThreadId,
          worktreePath: null,
        }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("moving a bound conversation", () => {
  it.effect("is refused at dispatch with readable text, before the orchestrator runs", () =>
    Effect.gen(function* () {
      const { copy, other } = yield* makeFolders;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const layer = ThreadManagementService.layer.pipe(
        Layer.provide(guardLayer({ copy, projectRoot: copy })),
        Layer.provide(Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({})),
        Layer.provide(
          Layer.mock(Orchestrator.OrchestratorV2)({
            getThreadRecords: (threadId) =>
              Effect.succeed({
                thread: { id: threadId, projectId, worktreePath: copy },
              } as OrchestrationV2ThreadProjection),
            dispatch: (command) =>
              Effect.sync(() => {
                dispatched.push(command);
                return { sequence: dispatched.length, storedEvents: [] };
              }),
          }),
        ),
        Layer.provide(ServerSettings.layerTest()),
        Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
      );
      const service = yield* ThreadManagementService.ThreadManagementService.pipe(
        Effect.provide(layer),
      );
      const move = (worktreePath: string, suffix: string) =>
        service.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`command:library-folder-guard:${suffix}`),
          threadId: boundThreadId,
          branch: "feature/elsewhere",
          worktreePath,
        });

      const error = yield* Effect.flip(move(other, "other"));
      expect(error).toBeInstanceOf(Orchestrator.OrchestratorCommandRejectedError);
      expect(userFacingDispatchErrorMessage(error)).toBe(
        LibraryFolderGuard.LIBRARY_FOLDER_CHANGE_REFUSAL,
      );
      expect(dispatched).toEqual([]);

      // An unchanged folder, such as a branch rename inside the copy, still goes through.
      yield* move(copy, "same");
      expect(dispatched.map((command) => command.commandId)).toEqual([
        "command:library-folder-guard:same",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
