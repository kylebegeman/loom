import { type ThreadId, WorktreeMcpFailure } from "@t3tools/contracts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { LibraryWorkspace } from "./LibraryWorkspace.ts";

const asFailure = Effect.mapError(
  (error: LibraryError) =>
    new WorktreeMcpFailure({
      code: "operation_failed",
      message: error.message,
    }),
);

export const libraryWorktreeHandoff = Effect.gen(function* () {
  const workspace = yield* Effect.serviceOption(LibraryWorkspace);
  return Effect.fn("LibraryWorkspace.worktreeHandoff")(function* (
    threadId: ThreadId,
    repositoryPath?: string,
  ) {
    if (Option.isNone(workspace)) return null;
    const binding = yield* workspace.value.threadBinding({ threadId });
    if (binding === null) return null;
    const project = yield* workspace.value.threadProject({ threadId });
    const source = yield* workspace.value.resolveBinding({
      binding,
      ...(project === null ? {} : { project }),
    });
    if (repositoryPath !== undefined && !source.repositoryPaths.includes(repositoryPath))
      return yield* new LibraryError({
        reason: "blocked",
        detail: `Choose repositoryPath from this project: ${source.repositoryPaths.join(", ")}.`,
      });
    return {
      cwd:
        repositoryPath ??
        (source.repositoryPaths.length === 1 ? source.repositoryPaths[0]! : source.cwd),
      boundCwd: source.cwd,
      repositoryPaths: source.repositoryPaths,
      canCreate: repositoryPath !== undefined || source.repositoryPaths.length === 1,
      bind: (worktreePath: string, move: Effect.Effect<boolean, WorktreeMcpFailure>) =>
        workspace.value
          .moveThread({
            threadId,
            worktreePath,
            move: move.pipe(
              Effect.mapError((error) => new LibraryError({ reason: "io", detail: error.message })),
            ),
          })
          .pipe(asFailure),
    };
  }, asFailure);
});
