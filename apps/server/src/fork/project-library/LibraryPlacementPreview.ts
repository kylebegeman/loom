import type { LibraryPlacementRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as LibraryPublisher from "./LibraryPublisher.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";

/**
 * Previews where a project's files would go on this computer. A computer that is not the Library
 * knows only projects it holds a live copy of, so the project comes from the Library, and from
 * this computer's own catalog when the Library cannot answer.
 */
export const make = Effect.gen(function* () {
  const publisher = yield* LibraryPublisher.LibraryPublisher;
  const library = yield* LibraryService.LibraryService;
  const workspace = yield* LibraryWorkspace.LibraryWorkspace;
  return Effect.fn("LibraryPlacement.preview")(function* (input: LibraryPlacementRequest) {
    const local = library.project({ projectId: input.projectId });
    const project = yield* publisher.enabled
      ? publisher.project(input.projectId).pipe(
          Effect.catchIf(
            (cause) => cause.reason !== "not-found",
            (cause) => local.pipe(Effect.mapError(() => cause)),
          ),
        )
      : local;
    return yield* workspace.placement({ project, resourceIds: input.resourceIds });
  });
});
