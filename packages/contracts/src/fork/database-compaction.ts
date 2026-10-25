import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

/**
 * A desktop shell compacts its local database while no backend has it open:
 * at the first launch of a new version, or at any launch after Settings asked
 * for it. Both files live beside the database. The server, which clients
 * reach, writes the request; the desktop, which owns the restart, writes the
 * result before it starts the backend.
 */
export const DATABASE_COMPACTION_REQUEST_FILE = "compact-at-restart";
export const DATABASE_COMPACTION_RESULT_FILE = "restart-compaction.json";

export const RestartCompactionOutcome = Schema.Literals([
  "completed",
  "skipped",
  "failed",
  "interrupted",
]);
export type RestartCompactionOutcome = typeof RestartCompactionOutcome.Type;

export const RestartCompactionResult = Schema.Struct({
  /** ISO time the attempt ended. */
  at: Schema.String,
  outcome: RestartCompactionOutcome,
  /** Shown in Settings: what changed, or why nothing did. */
  detail: Schema.String,
});
export type RestartCompactionResult = typeof RestartCompactionResult.Type;

/** Present only where a desktop shell compacts this database when it restarts. */
export const RestartCompactionState = Schema.Struct({
  requested: Schema.Boolean,
  lastAttempt: Schema.NullOr(RestartCompactionResult),
});
export type RestartCompactionState = typeof RestartCompactionState.Type;

export class DatabaseCompactionRequestError extends Schema.TaggedError<DatabaseCompactionRequestError>()(
  "DatabaseCompactionRequestError",
  {
    reason: Schema.Literals(["unavailable", "write"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "unavailable"
      ? "This environment is not run by the Loom desktop app, so it cannot compact at restart. Run the doctor command instead."
      : "Loom could not save the compaction request.";
  }
}

export const DATABASE_COMPACTION_WS_METHODS = {
  setRequest: "loom.database-compaction.setRequest",
} as const;

/** Sets or withdraws the request the desktop answers at its next launch. */
export const DatabaseCompactionRpcGroup = RpcGroup.make(
  Rpc.make(DATABASE_COMPACTION_WS_METHODS.setRequest, {
    payload: Schema.Struct({ requested: Schema.Boolean }),
    error: Schema.Union([DatabaseCompactionRequestError, EnvironmentAuthorizationError]),
  }),
);
