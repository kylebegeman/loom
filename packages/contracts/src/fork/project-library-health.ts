import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { LibraryError, LibraryId } from "./project-library.ts";
import { LibraryCopyHealth } from "./project-library-health-schema.ts";

export * from "./project-library-health-schema.ts";

/** Live copy health, read on the computer that holds the copy. */
export const LIBRARY_COPY_HEALTH_FEATURE = "library-copy-health";
/** The Library keeps each copy's last reported health and serves it with the copy. */
export const LIBRARY_COPY_HEALTH_PUBLISHED_FEATURE = "library-copy-health-published";

export const LIBRARY_HEALTH_WS_METHODS = {
  copyHealth: "loom.library.copy-health",
} as const;

export const LibraryCopyHealthRequest = Schema.Struct({
  workingCopyId: LibraryId,
  /** Fetch each repository's remotes first. Otherwise counts compare with the last fetch. */
  refreshRemote: Schema.optional(Schema.Boolean),
});
export type LibraryCopyHealthRequest = typeof LibraryCopyHealthRequest.Type;

export const ProjectLibraryHealthRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_HEALTH_WS_METHODS.copyHealth, {
    payload: LibraryCopyHealthRequest,
    success: LibraryCopyHealth,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
);
