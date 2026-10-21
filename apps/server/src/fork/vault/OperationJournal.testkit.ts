import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import type { VaultApprovalRetryInput } from "@t3tools/contracts/fork";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as OperationJournal from "./OperationJournal.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture } from "./VaultLaunch.testkit.ts";

export const makeJournalFixture = (githubAdapters?: Parameters<typeof launchFixture>[1]) =>
  Effect.gen(function* () {
    const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
    const faults = {
      write: "none" as "none" | "before" | "after",
      conflict: false,
      reads: false,
      journalReads: 0,
      onJournalRead: null as null | (() => void),
      beforeJournalRead: null as null | (() => Effect.Effect<void, VaultError>),
      beforePolicyRead: null as null | (() => Effect.Effect<void, VaultError>),
      beforePolicyWrite: null as null | (() => Effect.Effect<void, VaultError>),
      afterPolicyWrite: null as null | (() => Effect.Effect<void, VaultError>),
      beforeJournalWrite: null as null | ((value: unknown) => Effect.Effect<void, VaultError>),
      afterJournalWrite: null as null | ((value: unknown) => Effect.Effect<void, VaultError>),
    };
    const store = Layer.succeed(OpenBaoStore.OpenBaoStore, {
      status: Effect.succeed({
        backend: "openbao" as const,
        state: "ready" as const,
        origin: null,
      }),
      keys: (prefix: string) =>
        Effect.sync(() =>
          [...records.keys()]
            .filter((k) => k.startsWith(prefix + "/"))
            .map((k) => k.slice(prefix.length + 1)),
        ),
      read: (path: string) =>
        Effect.gen(function* () {
          if (path.endsWith("/access-policy") && faults.beforePolicyRead)
            yield* faults.beforePolicyRead();
          if (path.endsWith("approval-journal-v1")) {
            if (faults.beforeJournalRead) yield* faults.beforeJournalRead();
            faults.journalReads++;
            faults.onJournalRead?.();
          }
          if (faults.reads && path.endsWith("approval-journal-v1"))
            return yield* new VaultError({ reason: "unavailable" });
          return records.get(path) ?? null;
        }),
      write: (path: string, value: Redacted.Redacted<unknown>, expected: number) =>
        Effect.gen(function* () {
          const journal = path.endsWith("approval-journal-v1");
          if (path.endsWith("/access-policy") && faults.beforePolicyWrite)
            yield* faults.beforePolicyWrite();
          if (journal && faults.beforeJournalWrite)
            yield* faults.beforeJournalWrite(Redacted.value(value));
          if (journal && faults.write === "before")
            return yield* new VaultError({ reason: "unavailable" });
          const version = records.get(path)?.version ?? 0;
          if (version !== expected || (journal && faults.conflict))
            return yield* new VaultError({ reason: "conflict" });
          records.set(path, { value, version: version + 1 });
          if (path.endsWith("/access-policy") && faults.afterPolicyWrite)
            yield* faults.afterPolicyWrite();
          if (journal && faults.afterJournalWrite)
            yield* faults.afterJournalWrite(Redacted.value(value));
          if (journal && faults.write === "after") {
            faults.write = "none";
            return yield* new VaultError({ reason: "unavailable" });
          }
          return version + 1;
        }),
    });
    const f = yield* launchFixture(
      Layer.succeed(SshTransport.SshTransport, {
        execute: () => Effect.die("The journal must never invoke an execution adapter"),
      }),
      githubAdapters,
    ).pipe(Effect.provide(store));
    const rebuild = OperationJournal.OperationJournal.pipe(
      Effect.provide(
        Layer.fresh(
          OperationJournal.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeedContext(f.context),
                store,
                Layer.succeed(ServerEnvironmentIdentity, {
                  getEnvironmentId: Effect.succeed(f.environmentId),
                }),
              ),
            ),
          ),
        ),
      ),
    );
    const journal = yield* rebuild;
    const id = yield* f.id;
    yield* f.access.approvalCreate(
      { id, threadId: f.threadId, itemId: f.itemId, action: "use", destination: f.key.destination },
      `thread:${f.threadId}`,
      Effect.void,
    );
    const decision = {
      id,
      operationId: yield* f.id,
      expectedRevision: 1,
      expectedPolicyRevision: 0,
      decision: "approve" as const,
      durationMs: 300_000 as const,
    };
    yield* f.access.approvalChange(decision, "human", Effect.void);
    const input: VaultApprovalRetryInput = {
      id,
      waitingOperationId: id,
      expectedRevision: 2,
      previousOutcome: "not-started",
      operation: {
        kind: "ssh",
        target: f.key.target,
        input: { id: f.itemId, command: { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 } },
      },
    };
    const path = () => [...records.keys()].find((k) => k.endsWith("approval-journal-v1"))!;
    return { ...f, journal, input, decision, rebuild, records, faults, path };
  });

export const journalFixture = makeJournalFixture();
