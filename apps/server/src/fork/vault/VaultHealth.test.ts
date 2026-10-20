import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  VaultError,
  VaultGitHubError,
  VaultSshError,
  type VaultItemSummary,
  type VaultHealthMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultHealthChecks from "./VaultHealthChecks.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import { observeVaultHealth } from "./health-observation.ts";
const itemId = "a".repeat(32);
const fixture = Effect.sync(() => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = {
    others: new Map<string, VaultItemSummary>(),
    version: 1,
    kind: "service-connection" as "service-connection" | "ssh-key",
    sshCalls: 0,
    sshFailure: null as "timeout" | "failed" | "untrusted-host" | null,
    probeCalls: 0,
    failure: null as "unavailable" | "unauthorized" | null,
    probe: Effect.void as Effect.Effect<void>,
  };
  const item = (): VaultItemSummary => ({
    id: itemId,
    label: "Synthetic test identity",
    kind: state.kind,
    state: "active",
    version: state.version,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const backend = Layer.succeed(
    OpenBaoStore.OpenBaoStore,
    OpenBaoStore.OpenBaoStore.of({
      status: Effect.succeed({ backend: "openbao", state: "ready", origin: "http://127.0.0.1" }),
      read: (key) => Effect.sync(() => records.get(key) ?? null),
      write: (key, value, expectedVersion) =>
        Effect.suspend(() => {
          const version = records.get(key)?.version ?? 0;
          if (version !== expectedVersion)
            return Effect.fail(new VaultError({ reason: "conflict" }));
          records.set(key, { value, version: version + 1 });
          return Effect.succeed(version + 1);
        }),
      keys: () => Effect.succeed([]),
    }),
  );
  const dependencies = Layer.mergeAll(
    backend,
    Layer.mock(VaultCore.VaultCore)({
      inspect: (id) => Effect.sync(() => (id === itemId ? item() : (state.others.get(id) ?? null))),
    }),
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("health-test")),
    }),
    NodeServices.layer,
  );
  const layer = VaultHealth.layer.pipe(Layer.provide(dependencies));
  const checks = VaultHealthChecks.layer.pipe(
    Layer.provideMerge(layer),
    Layer.provide(
      Layer.merge(
        Layer.mock(VaultSsh.VaultSsh)({
          info: () =>
            Effect.succeed({
              item: item(),
              target: { hostname: "qa.example", username: "qa", port: 22, hostKey: null },
              publicKey: "synthetic",
              fingerprint: "synthetic",
              hostFingerprint: null,
              destination: "ssh://qa@qa.example:22",
            }),
          probe: () =>
            Effect.gen(function* () {
              state.sshCalls++;
              yield* state.probe;
              if (state.sshFailure) return yield* new VaultSshError({ reason: state.sshFailure });
              return {
                id: itemId,
                version: state.version,
                destination: "ssh://qa.example:22",
                fingerprint: "synthetic-key",
                hostFingerprint: "synthetic-host",
                checkedAt: 0,
                authenticated: true as const,
              };
            }),
        }),
        Layer.mock(VaultGitHub.VaultGitHub)({
          test: () =>
            Effect.gen(function* () {
              state.probeCalls++;
              yield* state.probe;
              if (state.failure) return yield* new VaultGitHubError({ reason: state.failure });
              return {
                account: "test",
                repository: "owner/repo",
                checkedAt: "2026-01-01T00:00:00Z",
                tokenExpiresAt: null,
                api: "ready" as const,
              };
            }),
        }),
      ),
    ),
  );
  return { state, records, layer: checks };
});
const test = <A, E, R>(
  use: (
    f: Effect.Success<typeof fixture>,
    service: VaultHealth.VaultHealth["Service"],
    checks: VaultHealthChecks.VaultHealthChecks["Service"],
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    return yield* Effect.gen(function* () {
      return yield* use(
        f,
        yield* VaultHealth.VaultHealth,
        yield* VaultHealthChecks.VaultHealthChecks,
      );
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(NodeServices.layer));
let seq = 0;
const operationId = () => (++seq).toString(16).padStart(32, "0");
const change = (
  health: VaultHealth.VaultHealth["Service"],
  change: VaultHealthMutation["change"],
) =>
  Effect.gen(function* () {
    const snapshot = yield* health.snapshot;
    return yield* health.apply(
      { operationId: operationId(), expectedRevision: snapshot.revision, change },
      "test-admin",
    );
  });
const configure = (health: VaultHealth.VaultHealth["Service"], automatic = false) =>
  change(health, {
    action: "configure",
    rule: {
      itemId,
      expiresAt: 86400_000,
      warningDays: 7,
      githubRepository: "owner/repo",
      automatic,
      nextCheckAt: 0,
    },
  });
it.effect(
  "deduplicates repeated delivery failures, keeps outages separate, and resolves only from confirmed success",
  () =>
    test((_f, health) =>
      Effect.gen(function* () {
        for (let i = 0; i < 100; i++)
          yield* health.report({
            itemId,
            itemVersion: 1,
            category: "authentication",
            healthy: false,
          });
        let snapshot = yield* health.snapshot;
        expect(snapshot.issues).toHaveLength(1);
        expect(snapshot.issues[0]?.occurrences).toBe(100);
        yield* health.report({ itemId, itemVersion: 1, category: "outage", healthy: false });
        snapshot = yield* health.snapshot;
        expect(snapshot.issues).toHaveLength(2);
        expect(snapshot.issues.find((i) => i.category === "authentication")?.state).toBe("open");
        yield* health.report({ itemId, itemVersion: 1, category: "outage", healthy: true });
        expect((yield* health.snapshot).issues.find((i) => i.category === "outage")?.state).toBe(
          "resolved",
        );
      }),
    ),
);
it.effect(
  "snoozes until the controlled deadline, supports unsnooze/dismiss/reopen, and rejects stale revisions",
  () =>
    test((_f, health) =>
      Effect.gen(function* () {
        yield* health.report({
          itemId,
          itemVersion: 1,
          category: "authentication",
          healthy: false,
        });
        const issueId = `${itemId}:authentication`;
        let snapshot = yield* change(health, { action: "snooze", issueId, until: 60_000 });
        expect(snapshot.issues[0]?.state).toBe("snoozed");
        yield* TestClock.adjust("1 minute");
        expect((yield* health.snapshot).issues[0]?.state).toBe("open");
        yield* change(health, { action: "snooze", issueId, until: 120_000 });
        expect(
          (yield* change(health, { action: "unsnooze", issueId, until: null })).issues[0]?.state,
        ).toBe("open");
        snapshot = yield* change(health, { action: "dismiss", issueId, until: null });
        yield* health.report({
          itemId,
          itemVersion: 1,
          category: "authentication",
          healthy: false,
        });
        expect((yield* health.snapshot).issues[0]?.state).toBe("dismissed");
        expect(
          (yield* health
            .apply(
              {
                operationId: operationId(),
                expectedRevision: snapshot.revision,
                change: { action: "reopen", issueId, until: null },
              },
              "test-admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* change(health, { action: "reopen", issueId, until: null })).issues[0]?.state,
        ).toBe("open");
      }),
    ),
);
it.effect(
  "checks only opted-in rules in the background, rate limits rechecks, and classifies network outages safely",
  () =>
    test((f, health, checks) =>
      Effect.gen(function* () {
        expect((yield* checks.recheck(itemId)).outcome).toBe("unconfigured");
        yield* configure(health);
        yield* checks.sweep;
        expect(f.state.probeCalls).toBe(0);
        f.state.failure = "unavailable";
        expect((yield* checks.recheck(itemId)).outcome).toBe("checked");
        expect(f.state.probeCalls).toBe(1);
        let snapshot = yield* health.snapshot;
        expect(snapshot.issues.map((i) => i.category).sort()).toEqual(["expiry", "outage"]);
        expect((yield* checks.recheck(itemId)).outcome).toBe("rate-limited");
        expect(f.state.probeCalls).toBe(1);
        yield* TestClock.adjust("15 minutes");
        f.state.failure = null;
        yield* checks.recheck(itemId);
        snapshot = yield* health.snapshot;
        expect(snapshot.issues.find((i) => i.category === "outage")?.state).toBe("resolved");
        expect(snapshot.issues.find((i) => i.category === "authentication")).toBeUndefined();
      }),
    ),
);
it.effect(
  "an old provider check cannot reopen a newer resolved issue or change a replaced item",
  () =>
    test((f, health, checks) =>
      Effect.gen(function* () {
        yield* configure(health, true);
        const started = yield* Deferred.make<void>(),
          finish = yield* Deferred.make<void>();
        f.state.failure = "unauthorized";
        f.state.probe = observeVaultHealth(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.andThen(Effect.fail(new VaultGitHubError({ reason: "unauthorized" }))),
          ),
          itemId,
          1,
        ).pipe(Effect.ignore);
        const running = yield* checks.recheck(itemId).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("1 second");
        yield* health.report({
          itemId,
          itemVersion: 1,
          category: "authentication",
          healthy: false,
        });
        yield* TestClock.adjust("1 second");
        yield* health.report({ itemId, itemVersion: 1, category: "authentication", healthy: true });
        yield* Deferred.succeed(finish, undefined);
        yield* Fiber.join(running);
        expect(
          (yield* health.snapshot).issues.find((i) => i.category === "authentication")?.state,
        ).toBe("resolved");
        f.state.version = 2;
        yield* health.report({ itemId, itemVersion: 1, category: "outage", healthy: false });
        expect(
          (yield* health.snapshot).issues.find((i) => i.category === "outage"),
        ).toBeUndefined();
      }),
    ),
);

it.effect(
  "validates only explicitly configured SSH keys, distinguishes timeout from configuration and never infers revocation",
  () =>
    test((f, health, checks) =>
      Effect.gen(function* () {
        const rule = {
          itemId,
          expiresAt: null,
          warningDays: 7,
          githubRepository: null,
          sshValidation: true,
          automatic: false,
          nextCheckAt: 0,
        };
        expect(
          (yield* change(health, { action: "configure", rule }).pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect(f.state.sshCalls).toBe(0);
        f.state.kind = "ssh-key";
        yield* change(health, { action: "configure", rule });
        yield* checks.sweep;
        expect(f.state.sshCalls).toBe(0);
        f.state.sshFailure = "timeout";
        yield* checks.recheck(itemId);
        expect(f.state.sshCalls).toBe(1);
        expect(f.state.probeCalls).toBe(0);
        expect((yield* health.snapshot).issues.map((i) => i.category)).toEqual(["outage"]);
        expect((yield* health.snapshot).issues[0]?.outageTarget).toEqual({
          kind: "ssh",
          hostname: "qa.example",
          port: 22,
        });
        yield* TestClock.adjust("15 minutes");
        f.state.sshFailure = "untrusted-host";
        yield* checks.recheck(itemId);
        expect((yield* health.snapshot).issues.some((i) => i.category === "configuration")).toBe(
          true,
        );
        expect((yield* health.snapshot).issues.some((i) => i.category === "authentication")).toBe(
          false,
        );
        yield* TestClock.adjust("15 minutes");
        f.state.sshFailure = null;
        yield* checks.recheck(itemId);
        expect((yield* health.snapshot).issues.every((i) => i.state === "resolved")).toBe(true);
        yield* change(health, { action: "configure", rule: { ...rule, automatic: true } });
        f.state.sshFailure = "failed";
        yield* checks.sweep;
        expect(
          (yield* health.snapshot).issues.find((i) => i.category === "configuration")?.state,
        ).toBe("open");
        expect(
          (yield* change(health, {
            action: "configure",
            rule: { ...rule, githubRepository: "owner/repo" },
          }).pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
      }),
    ),
);

it.effect(
  "groups only attributed unresolved outages by endpoint and preserves independent item actions",
  () =>
    test((f, health) =>
      Effect.gen(function* () {
        const ids = [itemId, ...["b", "c", "d", "e", "f"].map((letter) => letter.repeat(32))];
        for (const id of ids.slice(1))
          f.state.others.set(id, {
            id,
            label: `Synthetic ${id[0]}`,
            kind: "ssh-key",
            state: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          });
        for (const [index, id] of ids.entries())
          yield* health.report({
            itemId: id,
            itemVersion: 1,
            category: "outage",
            healthy: false,
            ...(index < 2
              ? { outageTarget: { kind: "github" as const } }
              : index < 5
                ? {
                    outageTarget: {
                      kind: "ssh" as const,
                      hostname: "qa.example",
                      port: index === 4 ? 2222 : 22,
                    },
                  }
                : {}),
          });
        let snapshot = yield* health.snapshot;
        expect(snapshot.outageGroups?.map((group) => group.issueIds.length)).toEqual([2, 2]);
        expect(snapshot.outageGroups?.flatMap((group) => group.issueIds)).not.toContain(
          `${ids[5]}:outage`,
        );
        yield* health.report({
          itemId,
          itemVersion: 1,
          category: "authentication",
          healthy: false,
          outageTarget: { kind: "github" },
        });
        expect(
          (yield* health.snapshot).issues.find((issue) => issue.category === "authentication")
            ?.outageTarget,
        ).toBeUndefined();
        yield* health.report({ itemId, itemVersion: 1, category: "outage", healthy: true });
        snapshot = yield* health.snapshot;
        expect(snapshot.outageGroups).toHaveLength(1);
        expect(snapshot.issues.find((issue) => issue.itemId === ids[1])?.state).toBe("open");
        yield* change(health, { action: "snooze", issueId: `${ids[2]}:outage`, until: 60_000 });
        expect((yield* health.snapshot).outageGroups).toHaveLength(1);
        yield* change(health, { action: "dismiss", issueId: `${ids[3]}:outage`, until: null });
        expect((yield* health.snapshot).outageGroups).toEqual([]);
        yield* change(health, { action: "reopen", issueId: `${ids[3]}:outage`, until: null });
        expect((yield* health.snapshot).outageGroups).toHaveLength(1);
        yield* health.report({
          itemId: ids[2]!,
          itemVersion: 1,
          category: "outage",
          healthy: false,
        });
        expect((yield* health.snapshot).outageGroups).toEqual([]);
        yield* health.report({
          itemId: ids[2]!,
          itemVersion: 0,
          category: "outage",
          healthy: false,
          outageTarget: { kind: "github" },
        });
        expect(
          (yield* health.snapshot).issues.find((issue) => issue.itemId === ids[2])?.outageTarget,
        ).toBeUndefined();
      }),
    ),
);
