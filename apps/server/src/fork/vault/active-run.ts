import type { OrchestrationV2ThreadShell, RunId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";

/** Only the provider's prompt guard prepares a persisted run before it is running. */
export class VaultPromptRun extends Context.Service<
  VaultPromptRun,
  { readonly threadId: ThreadId; readonly runId: RunId }
>()("t3/fork/vault/active-run/VaultPromptRun") {}

export const isVaultRunRunning = Effect.fn("Vault.isRunRunning")(function* (
  threads: Pick<ThreadManagementService["Service"], "getThreadRecords">,
  thread: OrchestrationV2ThreadShell,
) {
  if (thread.activeRunId === null) return false;
  // Shell status describes the latest turn, which may have been cancelled while this run continues.
  const records = yield* threads
    .getThreadRecords(thread.id, ["runs"], { runIds: [thread.activeRunId] })
    .pipe(Effect.mapError(() => new VaultError({ reason: "denied" })));
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
