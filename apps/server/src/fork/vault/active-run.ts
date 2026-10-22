import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";

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
  return (
    records.thread.id === thread.id &&
    records.thread.projectId === thread.projectId &&
    run?.threadId === thread.id &&
    run.providerInstanceId === thread.providerInstanceId &&
    run.status === "running"
  );
});
