import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";

export const LIBRARY_FOLDER_CHANGE_REFUSAL =
  "This conversation belongs to a Library project and always runs in the project's folder, so it can't move to a worktree. You can still switch branches in that folder.";

const refused = () =>
  new LibraryError({ reason: "blocked", detail: LIBRARY_FOLDER_CHANGE_REFUSAL });

/**
 * Every turn of a Library-bound conversation prepares and validates its copy folder, so a
 * conversation moved anywhere else is accepted and then fails on its next turn. Callers that
 * change a thread's folder ask here first and refuse up front instead.
 */
export class LibraryFolderGuard extends Context.Service<
  LibraryFolderGuard,
  {
    /** `worktreePath: null` means the project root, as it does on the thread. */
    readonly assertFolderChange: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
    }) => Effect.Effect<void, LibraryError>;
    /** For callers about to create a new folder for the thread, which is never its copy folder. */
    readonly assertMayLeaveFolder: (threadId: ThreadId) => Effect.Effect<void, LibraryError>;
  }
>()("t3/fork/project-library/LibraryFolderGuard") {}

const make = Effect.gen(function* () {
  const store = yield* LibraryWorkspaceStore;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const path = yield* Path.Path;

  const assertFolderChange = Effect.fn("LibraryFolderGuard.assertFolderChange")(function* (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) {
    const resolved = yield* store.getBinding(input.threadId);
    if (resolved === null) return;
    const folder =
      input.worktreePath ??
      Option.getOrUndefined(
        yield* projects
          .get(input.projectId)
          .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause }))),
      )?.workspaceRoot;
    // The binding's cwd is already a realpath, and prepareThreadFiles compares the thread's
    // folder to it after path.resolve only. A symlink or alias of the copy folder would still
    // fail that turn check, so only the folder itself passes here.
    if (folder === undefined || path.resolve(folder) !== resolved.cwd) return yield* refused();
  });

  const assertMayLeaveFolder = Effect.fn("LibraryFolderGuard.assertMayLeaveFolder")(function* (
    threadId: ThreadId,
  ) {
    if ((yield* store.getBinding(threadId)) !== null) return yield* refused();
  });

  return LibraryFolderGuard.of({ assertFolderChange, assertMayLeaveFolder });
});

export const layer = Layer.effect(LibraryFolderGuard, make);
