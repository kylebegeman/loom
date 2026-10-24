import type { OrchestrationV2ThreadShell, RunId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";

/** Only the provider's prompt guard prepares a persisted run before it is running. */
export class VaultPromptRun extends Context.Service<
  VaultPromptRun,
  { readonly threadId: ThreadId; readonly runId: RunId }
>()("t3/fork/vault/active-run/VaultPromptRun") {}

/**
 * A shell read in the current check whose active run `isVaultRunRunning` has just confirmed,
 * so a nested access decision in the same check need not read either again.
 */
export interface VaultLiveThread {
  readonly shell: OrchestrationV2ThreadShell;
  readonly running: true;
}

// Vault checks only read, and on the writer they queued behind every open write transaction.
// The prompt guard runs after its "starting" run has committed, so the reader sees that run.
// A read inside an open write transaction keeps using that transaction's connection and sees
// its uncommitted writes.
export const readVaultThreadShell = (
  threads: Pick<ThreadManagementService["Service"], "getThreadShell">,
  threadId: ThreadId,
) => threads.getThreadShell(threadId).pipe(NodeSqliteClient.readOnly);

export const isVaultRunRunning = Effect.fn("Vault.isRunRunning")(function* (
  threads: Pick<ThreadManagementService["Service"], "getThreadRecords">,
  thread: OrchestrationV2ThreadShell,
) {
  if (thread.activeRunId === null) return false;
  // Shell status describes the latest turn, which may have been cancelled while this run continues.
  // A thread with an active run already had its legacy transcript imported when the run was
  // dispatched, so this read never needs the writer; if it ever did, the read fails closed.
  const records = yield* threads
    .getThreadRecords(thread.id, ["runs"], { runIds: [thread.activeRunId] })
    .pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(() => new VaultError({ reason: "denied" })),
    );
  const run = records.runs.find((run) => run.id === thread.activeRunId);
  const prompt = yield* Effect.serviceOption(VaultPromptRun);
  const preparing =
    Option.isSome(prompt) &&
    prompt.value.threadId === thread.id &&
    prompt.value.runId === thread.activeRunId;
  return (
    records.thread.id === thread.id &&
    records.thread.projectId === thread.projectId &&
    records.thread.providerInstanceId === thread.providerInstanceId &&
    records.thread.runtimeMode === thread.runtimeMode &&
    records.thread.interactionMode === thread.interactionMode &&
    records.thread.archivedAt === null &&
    records.thread.deletedAt === null &&
    run?.threadId === thread.id &&
    run.providerInstanceId === thread.providerInstanceId &&
    (run.status === "running" || (preparing && run.status === "starting"))
  );
});
