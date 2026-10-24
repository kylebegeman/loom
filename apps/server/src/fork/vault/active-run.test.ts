import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { vaultRun } from "./VaultActiveRun.testkit.ts";
import {
  createReaderThread,
  projectionThreads,
  readerDatabase,
  readerRunId,
  readerThreadId,
  updateReaderRun,
  whileWriterHeld,
} from "./VaultReader.testkit.ts";
import { isVaultRunRunning, readVaultThreadShell, VaultPromptRun } from "./active-run.ts";

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
const readerLayer = projectionThreads.pipe(Layer.provideMerge(readerDatabase));
it.effect("reads the thread and its active run on the reader while the writer is held", () =>
  Effect.gen(function* () {
    yield* createReaderThread;
    yield* updateReaderRun("running");
    const threads = yield* ThreadManagementService;
    const running = yield* whileWriterHeld(
      Effect.gen(function* () {
        const shell = yield* readVaultThreadShell(threads, readerThreadId);
        return shell !== null && (yield* isVaultRunRunning(threads, shell));
      }),
    );
    expect(running).toBe(true);
  }).pipe(Effect.provide(readerLayer)),
);
it.effect("the prompt guard sees its committed starting run on the reader", () =>
  Effect.gen(function* () {
    yield* createReaderThread;
    // Turn start commits the run as starting before it calls the guard.
    yield* updateReaderRun("starting");
    const threads = yield* ThreadManagementService;
    const check = Effect.gen(function* () {
      const shell = yield* readVaultThreadShell(threads, readerThreadId);
      expect(shell?.activeRunId).toBe(readerRunId);
      return yield* isVaultRunRunning(threads, shell!);
    });
    const [guarded, unguarded] = yield* whileWriterHeld(
      Effect.all([
        check.pipe(
          Effect.provideService(VaultPromptRun, { threadId: readerThreadId, runId: readerRunId }),
        ),
        check,
      ]),
    );
    expect({ guarded, unguarded }).toEqual({ guarded: true, unguarded: false });
  }).pipe(Effect.provide(readerLayer)),
);
it.effect("the prompt guard inside a write transaction still sees its uncommitted run", () =>
  Effect.gen(function* () {
    yield* createReaderThread;
    const sql = yield* SqlClient.SqlClient;
    const threads = yield* ThreadManagementService;
    const preparing = yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* updateReaderRun("starting");
        const shell = yield* readVaultThreadShell(threads, readerThreadId);
        expect(shell?.activeRunId).toBe(readerRunId);
        return yield* isVaultRunRunning(threads, shell!).pipe(
          Effect.provideService(VaultPromptRun, { threadId: readerThreadId, runId: readerRunId }),
        );
      }),
    );
    expect(preparing).toBe(true);
  }).pipe(Effect.provide(readerLayer)),
);
