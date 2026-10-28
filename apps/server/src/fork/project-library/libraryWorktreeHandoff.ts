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
  return Effect.fn("LibraryWorkspace.worktreeHandoff")(function* (threadId: ThreadId) {
    if (Option.isNone(workspace)) return null;
    const binding = yield* workspace.value.threadBinding({ threadId });
    if (binding === null) return null;
    const source = yield* workspace.value.resolveBinding({ binding });
    return {
      cwd: source.cwd,
      canCreate: source.repositoryPaths.length === 1 && source.repositoryPaths[0] === source.cwd,
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
