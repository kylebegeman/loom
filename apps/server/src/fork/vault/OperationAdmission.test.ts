import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import {
  vaultGitDestination,
  vaultGitHubDestination,
  type VaultApprovalRetryInput,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import type * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as OperationAdmission from "./OperationAdmission.ts";
import * as OperationJournal from "./OperationJournal.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
import { makeJournalFixture } from "./OperationJournal.testkit.ts";

type Kind = VaultApprovalRetryInput["operation"]["kind"];
const encodeStored = Schema.encodeEffect(Schema.fromJsonString(VaultGitHub.Stored));
const fixture = (kind: Kind, options: { app?: boolean; repositoryAllowed?: boolean } = {}) =>
  Effect.gen(function* () {
    let remoteCalls = 0;
    const external = <A>(): Effect.Effect<A> =>
      Effect.sync(() => {
        remoteCalls++;
        throw new Error("Admission must not call a provider or command transport");
      });
    const f = yield* makeJournalFixture(
      Layer.mergeAll(
        Layer.succeed(GitHubTransport.GitHubTransport, {
          session: external,
          release: external,
          probe: external,
        }),
        Layer.succeed(GitHubCli.GitHubCli, { run: external }),
      ),
    );
    const controls = { metadata: 0, afterMetadata: Effect.void as Effect.Effect<void> };
    let input = f.input;
    if (kind !== "ssh") {
      const id = yield* f.id;
      let operation: VaultApprovalRetryInput["operation"];
      let destination: string;
      if (kind === "git-ssh") {
        operation = {
          kind,
          target: f.key.target,
          input: {
            id: f.itemId,
            expectedVersion: 1,
            repository: "team/repo.git",
            action: "ls-remote",
            timeoutMs: 1000,
          },
        };
        destination = vaultGitDestination(f.key.target, operation.input.repository);
      } else {
        const itemId = yield* f.id;
        const stored = yield* encodeStored({
          schemaVersion: 1,
          provider: "github.com",
          account: "synthetic-bot",
          credential: options.app
            ? {
                type: "app",
                appId: "1",
                installationId: "2",
                privateKey: Redacted.make("synthetic-key-not-for-signing"),
              }
            : { type: "token", token: Redacted.make("synthetic_token_not_for_provider_use") },
          repositories: [options.repositoryAllowed === false ? "owner/other" : "owner/repo"],
        });
        // Direct synthetic seed avoids any provider validation during fixture setup as well.
        yield* f.core.save(
          {
            id: itemId,
            expectedVersion: 0,
            operationId: yield* f.id,
            label: "Synthetic connector",
            kind: "service-connection",
            value: Redacted.make(stored),
          },
          "fixture",
        );
        operation = {
          kind,
          input: {
            id: itemId,
            expectedVersion: 1,
            repository: "owner/repo",
            operation: { action: "repo-view" },
          },
        };
        destination = vaultGitHubDestination(operation.input.repository);
      }
      yield* f.access.approvalCreate(
        {
          id,
          waitingOperationId: id,
          threadId: f.threadId,
          itemId: operation.input.id,
          action: "use",
          destination,
        },
        `thread:${f.threadId}`,
        Effect.void,
      );
      yield* f.access.approvalChange(
        {
          id,
          operationId: yield* f.id,
          expectedRevision: 1,
          expectedPolicyRevision: (yield* f.access.snapshot).revision,
          decision: "approve",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      input = {
        id,
        waitingOperationId: id,
        expectedRevision: 2,
        previousOutcome: "not-started",
        operation,
      };
    }
    yield* f.journal.prepare(input, f.threadId);
    const acquired = yield* f.journal.acquire(
      input,
      { id: input.id, expectedRevision: 1, reservationId: yield* f.id },
      f.threadId,
    );
    const observe = Effect.suspend(() => {
      controls.metadata++;
      return controls.afterMetadata;
    });
    const github = Context.get(f.context, VaultGitHub.VaultGitHub);
    // Keep real adapter checks; add deterministic fault boundaries after their metadata observations.
    const buildAdmission = (journal: OperationJournal.OperationJournal["Service"]) =>
      OperationAdmission.OperationAdmission.pipe(
        Effect.provide(
          OperationAdmission.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeedContext(f.context),
                Layer.succeed(OperationJournal.OperationJournal, journal),
                Layer.succeed(
                  VaultLaunch.VaultLaunch,
                  VaultLaunch.VaultLaunch.of({
                    ...f.launch,
                    admission: (op, thread) =>
                      f.launch.admission(op, thread).pipe(Effect.tap(() => observe)),
                  }),
                ),
                Layer.succeed(
                  VaultGitHub.VaultGitHub,
                  VaultGitHub.VaultGitHub.of({
                    ...github,
                    admission: (op, thread) =>
                      github.admission(op, thread).pipe(Effect.tap(() => observe)),
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    const admission = yield* buildAdmission(f.journal);
    const rebuildAdmission = Effect.gen(function* () {
      const journal = yield* f.rebuild;
      return { journal, admission: yield* buildAdmission(journal) };
    });
    return {
      ...f,
      input,
      acquired,
      admission,
      rebuildAdmission,
      controls,
      remoteCalls: () => remoteCalls,
      admit: () => admission.admit(input, acquired.acquisition, f.threadId),
    };
  });
const withAdmission = <A, E>(
  kind: Kind,
  use: (f: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E, Crypto.Crypto>,
  options = {},
) =>
  Effect.flatMap(fixture(kind, options), use).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "admits only %s metadata without transport, credential delivery or a reusable permit",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        const before = [...f.records.entries()];
        expect(yield* f.admit()).toMatchObject({
          adapter: kind,
          adapterValidation: "local-metadata-only",
          liveValidation: "required",
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(f.controls.metadata).toBe(2);
        expect(f.remoteCalls()).toBe(0);
        expect(yield* f.workloads.list(f.threadId)).toEqual([]);
        expect([...f.records.entries()]).toEqual(before);
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
);

it.effect("GitHub App admission never signs or mints an installation session", () =>
  withAdmission(
    "github-api",
    (f) =>
      Effect.gen(function* () {
        expect((yield* f.admit()).liveValidation).toBe("required");
        expect(f.remoteCalls()).toBe(0);
      }),
    { app: true },
  ),
);

it.effect("connector repository restrictions refuse admission without calling GitHub", () =>
  withAdmission(
    "github-api",
    (f) =>
      Effect.gen(function* () {
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("repository-denied");
        expect(f.remoteCalls()).toBe(0);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    { repositoryAllowed: false },
  ),
);

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "rejects changed %s proposals before adapter metadata",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        const changed = { ...f.input, waitingOperationId: "0".repeat(32) };
        expect(
          (yield* f.admission.admit(changed, f.acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(f.controls.metadata).toBe(0);
        expect(f.remoteCalls()).toBe(0);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    ),
);

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "detects %s authority withdrawal during metadata checks",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        const operationId = yield* f.id;
        f.controls.afterMetadata = Effect.suspend(() =>
          f.controls.metadata === 1
            ? f.access
                .approvalChange(
                  {
                    id: f.input.id,
                    operationId,
                    expectedRevision: 2,
                    expectedPolicyRevision: kind === "ssh" ? 1 : 2,
                    decision: "revoke",
                    durationMs: 300_000,
                  },
                  "human",
                  Effect.void,
                )
                .pipe(Effect.asVoid, Effect.orDie)
            : Effect.void,
        );
        yield* f.admit().pipe(Effect.flip);
        expect(f.remoteCalls()).toBe(0);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    ),
);

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "detects %s provider/worktree context changes between metadata observations",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        f.controls.afterMetadata = Effect.sync(() => {
          if (f.controls.metadata !== 1) return;
          const changed = ProviderInstanceId.make("changed-provider");
          // The fixture derives the active run from the model selection. A thread whose provider
          // differs from its running run is denied as not live before the stamps are compared.
          f.state.thread = {
            ...f.state.thread,
            providerInstanceId: changed,
            modelSelection: { ...f.state.thread.modelSelection, instanceId: changed },
            worktreePath: "/private/changed-worktree",
          };
        });
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("conflict");
        expect(f.controls.metadata).toBe(2);
        expect(f.remoteCalls()).toBe(0);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    ),
);

it.effect.each(["ssh", "git-ssh"] as const)(
  "refuses an offline %s broker without opening a workload",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        yield* TestClock.adjust((yield* f.brokers.snapshot).machines[0]!.leaseUntil + 1);
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("host-offline");
        expect(yield* f.workloads.list(f.threadId)).toEqual([]);
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect("invalidated reservation evidence cannot pass the final admission recheck", () =>
  withAdmission("ssh", (f) =>
    Effect.gen(function* () {
      f.controls.afterMetadata = Effect.suspend(() =>
        f.controls.metadata === 1
          ? f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      );
      expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("conflict");
      expect(f.remoteCalls()).toBe(0);
    }),
  ),
);

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "cancelling a paused %s admission consumes the handle and reconciles unknown",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const never = yield* Deferred.make<void>();
        f.controls.afterMetadata = Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(never)),
        );
        const fiber = yield* f.admit().pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
        expect(f.remoteCalls()).toBe(0);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
);

it.effect.each(["ssh", "git-ssh"] as const)(
  "requires the exact pinned %s host key in adapter admission",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        if (f.input.operation.kind === "github-api") throw new Error("fixture");
        expect(
          (yield* f.launch
            .admission(
              { ...f.input.operation, target: { ...f.input.operation.target, hostKey: null } },
              f.threadId,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(yield* f.workloads.list(f.threadId)).toEqual([]);
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect("Git admission rejects a relative working directory", () =>
  withAdmission("git-ssh", (f) =>
    Effect.gen(function* () {
      f.state.thread = { ...f.state.thread, worktreePath: "relative/worktree" };
      expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
      expect(f.remoteCalls()).toBe(0);
    }),
  ),
);

it.effect("SSH admission rejects a broker connected to a different environment", () =>
  withAdmission("ssh", (f) =>
    Effect.gen(function* () {
      const connection = f.identity.connection;
      Object.assign(f.identity, {
        connection: (directory: string) =>
          connection(directory).pipe(
            Effect.map((saved) => ({ ...saved, environmentId: "wrong-environment" })),
          ),
      });
      expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }),
  ),
);

it.effect("a disabled broker cannot pass Git admission", () =>
  withAdmission("git-ssh", (f) =>
    Effect.gen(function* () {
      yield* f.brokers.apply(
        {
          operationId: yield* f.id,
          expectedRevision: (yield* f.brokers.snapshot).revision,
          change: { type: "disable", machineId: f.machineId },
        },
        "human",
      );
      expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }),
  ),
);

it.effect.each(["ssh", "git-ssh", "github-api"] as const)(
  "%s admission result loss and service reconstruction never restore an acquisition",
  (kind) =>
    withAdmission(kind, (f) =>
      Effect.gen(function* () {
        const result = yield* f.admit();
        const before = [...f.records.entries()];
        const rebuilt = yield* f.rebuildAdmission;
        expect([...f.records.entries()]).toEqual(before);
        const serialized: unknown = JSON.parse(JSON.stringify(result));
        expect(
          (yield* rebuilt.admission
            .admit(f.input, serialized as never, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* rebuilt.admission
            .admit(f.input, f.acquired.acquisition, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* rebuilt.journal
            .acquire(
              f.input,
              { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id },
              f.threadId,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* rebuilt.journal.status(f.input.id, f.threadId)).journal?.state).toBe(
          "unknown",
        );
        expect((yield* rebuilt.journal.previewRetry(f.input, f.threadId)).retryState).toBe(
          "requires-outcome-review",
        );
        expect(f.controls.metadata).toBe(2);
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect(
  "one concurrent caller can finish admission while a duplicate handle call is refused",
  () =>
    withAdmission("ssh", (f) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        f.controls.afterMetadata = Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const first = yield* f.admit().pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        expect((yield* f.admit().pipe(Effect.flip)).reason).toBe("denied");
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("reserved");
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(first)).canExecute).toBe(false);
        expect(f.controls.metadata).toBe(2);
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect(
  "restored storage after admission cannot turn a prior observation into a fresh opportunity",
  () =>
    withAdmission("github-api", (f) =>
      Effect.gen(function* () {
        yield* f.admit();
        const rebuilt = yield* f.rebuildAdmission;
        const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
        const before = [...f.records.entries()];
        f.faults.reads = true;
        expect(
          (yield* rebuilt.journal.acquire(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        expect(
          (yield* f.access.approvalInbox).requests.find((request) => request.id === f.input.id)
            ?.state,
        ).toBe("approved");
        expect([...f.records.entries()]).toEqual(before);
        f.faults.reads = false;
        expect(
          (yield* rebuilt.journal.acquire(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* rebuilt.journal.status(f.input.id, f.threadId)).journal?.state).toBe(
          "unknown",
        );
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect(
  "aged evidence after admission is unavailable even while the request remains approved",
  () =>
    withAdmission("git-ssh", (f) =>
      Effect.gen(function* () {
        yield* f.admit();
        const record = f.records.get(f.path())!;
        const stored = Redacted.value(record.value) as {
          entries: Array<{ requestId: string; retireAt: number }>;
        };
        f.records.set(f.path(), {
          ...record,
          value: Redacted.make({
            ...stored,
            entries: stored.entries.map((entry) =>
              entry.requestId === f.input.id ? { ...entry, retireAt: 100 } : entry,
            ),
          }),
        });
        yield* TestClock.adjust("100 millis");
        const rebuilt = yield* f.rebuildAdmission;
        const before = f.records.get(f.path());
        expect(yield* rebuilt.journal.status(f.input.id, f.threadId)).toMatchObject({
          status: { request: { state: "approved" } },
          recoveryState: "no-retained-evidence",
        });
        expect(
          (yield* rebuilt.journal
            .acquire(
              f.input,
              { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id },
              f.threadId,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("not-found");
        expect(f.records.get(f.path())).toEqual(before);
        expect(f.controls.metadata).toBe(2);
        expect(f.remoteCalls()).toBe(0);
      }),
    ),
);

it.effect("withdrawal after a successful observation remains authoritative on recovery", () =>
  withAdmission("github-api", (f) =>
    Effect.gen(function* () {
      const stale = yield* f.admit();
      yield* f.access.approvalChange(
        {
          id: f.input.id,
          operationId: yield* f.id,
          expectedRevision: 2,
          expectedPolicyRevision: (yield* f.access.snapshot).revision,
          decision: "revoke",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      const rebuilt = yield* f.rebuildAdmission;
      const report = yield* rebuilt.journal.previewRetry(
        { ...f.input, expectedRevision: 3 },
        f.threadId,
      );
      expect(stale.canExecute).toBe(false);
      expect(report).toMatchObject({
        retryState: "blocked-request",
        status: { request: { state: "revoked" } },
        canExecute: false,
      });
      expect(f.controls.metadata).toBe(2);
      expect(f.remoteCalls()).toBe(0);
    }),
  ),
);
