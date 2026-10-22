import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { vaultRun } from "./VaultActiveRun.testkit.ts";
import { isVaultRunRunning } from "./active-run.ts";

it.effect("rejects authority and lifecycle changes between the shell and run reads", () =>
  Effect.gen(function* () {
    const thread = liveThreadShell(ThreadId.make("vault-run-race"));
    const projection = idleThreadProjection(thread);
    for (const patch of [
      { runtimeMode: "approval-required" as const },
      { interactionMode: "plan" as const },
      { providerInstanceId: ProviderInstanceId.make("other-provider") },
      { archivedAt: thread.createdAt },
      { deletedAt: thread.createdAt },
    ]) {
      const records = {
        ...projection,
        thread: { ...projection.thread, ...patch },
        runs: [vaultRun(thread)],
      };
      expect(
        yield* isVaultRunRunning({ getThreadRecords: () => Effect.succeed(records) }, thread),
      ).toBe(false);
    }
  }),
);
