import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import {
  VaultError,
  type VaultItemSummary,
  type VaultReplacementPrepare,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as MigrationGitMetadata from "./MigrationGitMetadata.ts";
import * as VaultMigrationInventory from "./VaultMigrationInventory.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
const itemId = "a".repeat(32);
const originalItemId = "9".repeat(32);
const project = (i = 0): OrchestrationProjectShell => ({
  id: ProjectId.make(`project-${String(i).padStart(2, "0")}`),
  title: `Project ${i}`,
  workspaceRoot: `/synthetic/${i}`,
  repositoryIdentity: null,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const fixture = Effect.sync(() => {
  const state = {
    raw: "remote.origin.url\ngit@github.com:dev/repo.git\0",
    unavailable: false,
    version: 1,
    active: true,
    pinned: false,
    permit: true,
    probeCalls: 0,
    originalVersion: 1,
    originalActive: true,
    originalPinned: true,
    originalUsername: "git",
    failOriginalReceipt: false,
    probeIds: [] as string[],
    failReceipt: false,
    upstreamExpiry: null as string | null,
    onProbe: Effect.void as Effect.Effect<void, VaultError>,
    root: "/synthetic/0",
    github: false,
    allowed: true,
    host: "github.com",
    count: 1,
    reads: [] as string[],
  };
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const item = (id = itemId): VaultItemSummary => ({
    id,
    label: "Dedicated development",
    kind: id === originalItemId ? "ssh-key" : state.github ? "service-connection" : "ssh-key",
    state: (id === originalItemId ? state.originalActive : state.active) ? "active" : "archived",
    version: id === originalItemId ? state.originalVersion : state.version,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const deps = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("migration-inventory")),
    }),
    Layer.mock(ProjectStoreV2)({
      listShells: () => Effect.succeed(Array.from({ length: state.count }, (_, i) => project(i))),
      getShell: (id) =>
        Effect.succeed(
          id === project().id
            ? Option.some({ ...project(), workspaceRoot: state.root })
            : Option.none(),
        ),
    }),
    Layer.succeed(MigrationGitMetadata.MigrationGitMetadata, {
      read: (cwd) =>
        Effect.suspend(() => {
          state.reads.push(cwd);
          return state.unavailable || cwd === "/synthetic/1"
            ? Effect.fail(new VaultError({ reason: "unavailable" }))
            : Effect.succeed({
                raw: Redacted.make(state.raw),
                metadata: MigrationGitMetadata.parseMigrationGitMetadata(state.raw),
              });
        }),
    }),
    Layer.mock(VaultCore.VaultCore)({ inspect: (id) => Effect.succeed(item(id)) }),
    Layer.mock(VaultSsh.VaultSsh)({
      verifyGit: (input, authorize) =>
        Effect.gen(function* () {
          yield* authorize;
          state.probeCalls++;
          state.probeIds.push(input.id);
          yield* state.onProbe;
          yield* authorize;
          return {
            id: input.id,
            version: input.expectedVersion,
            repository: input.repository,
            destination: `ssh://${input.id === originalItemId ? state.originalUsername : "git"}@${state.host}:22`,
            fingerprint: "synthetic-key",
            hostFingerprint:
              input.id === originalItemId ? "synthetic-original-host" : "synthetic-host",
            checkedAt: yield* Clock.currentTimeMillis,
            authenticated: true as const,
            readable: true as const,
          };
        }),
      info: (id) =>
        Effect.succeed({
          item: item(id),
          target: {
            hostname: state.host,
            username: id === originalItemId ? state.originalUsername : "git",
            port: 22,
            hostKey: null,
          },
          publicKey: "",
          fingerprint: "synthetic",
          hostFingerprint:
            id === originalItemId
              ? state.originalPinned
                ? "synthetic-original-host"
                : null
              : state.pinned
                ? "synthetic-host"
                : null,
          destination: `ssh://${id === originalItemId ? state.originalUsername : "git"}@${state.host}:22`,
        }),
    }),
    Layer.mock(VaultGitHub.VaultGitHub)({
      test: (input, authorize) =>
        Effect.gen(function* () {
          yield* authorize;
          state.probeCalls++;
          yield* state.onProbe;
          yield* authorize;
          return {
            account: "dev",
            repository: input.repository,
            checkedAt: "2026-01-01T00:00:00Z",
            tokenExpiresAt: state.upstreamExpiry,
            api: "ready" as const,
          };
        }),
      info: () =>
        Effect.succeed({
          item: item(),
          account: "dev",
          mechanism: "token",
          repositories: state.allowed ? ["dev/repo"] : ["dev/other"],
        }),
    }),
    Layer.mock(OpenBaoStore.OpenBaoStore)({
      read: (key) => Effect.sync(() => records.get(key) ?? null),
      keys: (prefix) =>
        Effect.succeed(
          [...records.keys()]
            .filter((k) => k.startsWith(prefix + "/"))
            .map((k) => k.slice(prefix.length + 1)),
        ),
      write: (key, value, expected) =>
        Effect.suspend(() => {
          const stored = Redacted.value(value) as {
            verification?: { receipt: { state: string } };
            originalVerification?: { receipt: { state: string } };
          };
          if (state.failOriginalReceipt && stored.originalVerification?.receipt.state === "passed")
            return Effect.fail(new VaultError({ reason: "unavailable" }));
          if (state.failReceipt && stored.verification?.receipt.state === "passed")
            return Effect.fail(new VaultError({ reason: "unavailable" }));
          const version = records.get(key)?.version ?? 0;
          if (version !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
          records.set(key, { value, version: version + 1 });
          return Effect.succeed(version + 1);
        }),
    }),
  );
  return { state, records, layer: VaultMigrationInventory.layer.pipe(Layer.provide(deps)) };
});
const prepareInput = (raw: string): VaultReplacementPrepare => ({
  id: "b".repeat(32),
  projectId: project().id,
  dependency: MigrationGitMetadata.parseMigrationGitMetadata(raw).dependencies[0]!,
  replacement: { adapter: "ssh", itemId, expectedVersion: 1 },
  developmentOnly: true,
});
it.effect(
  "inventories only a bounded page of registered projects and makes unknown coverage explicit",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.count = 12;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const first = yield* service.inventory({ cursor: null });
        expect(first.projects).toHaveLength(10);
        expect(f.state.reads).toHaveLength(10);
        expect(first.projects[1]?.state).toBe("unavailable");
        expect(first).toMatchObject({
          coverage: "registered-project-local-config-only",
          credentialIdentity: "unknown",
          externalConsumers: "not-discovered",
          accessVerification: "not-performed",
        });
        const next = yield* service.inventory({ cursor: first.nextCursor });
        expect(next.projects).toHaveLength(2);
        expect(next.nextCursor).toBeNull();
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "binds a reviewed replacement to local config and item version without granting or cutting over",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = prepareInput(f.state.raw),
          prepared = yield* service.prepare(input, "admin");
        expect(prepared).toMatchObject({
          validation: "current",
          verification: "required",
          canCutover: false,
          plan: {
            state: "prepared",
            replacement: { scope: "ssh-git-transport", hostTrust: "missing" },
          },
        });
        expect(yield* service.prepare(input, "admin")).toEqual(prepared);
        const reviewed = yield* service.review({ id: input.id, reviewed: true }, "admin");
        expect(reviewed.plan.state).toBe("reviewed");
        expect(reviewed.canCutover).toBe(false);
        expect(yield* service.review({ id: input.id, reviewed: true }, "admin")).toEqual(reviewed);
        f.state.raw += "core.sshcommand\nssh custom\0";
        expect((yield* service.inspect(input.id)).validation).toBe("source-changed");
        expect(
          (yield* service.review({ id: input.id, reviewed: true }, "admin").pipe(Effect.flip))
            .reason,
        ).toBe("source-changed");
        expect((yield* service.cancel(input.id)).plan.state).toBe("cancelled");
        expect(
          (yield* service.review({ id: input.id, reviewed: true }, "admin").pipe(Effect.flip))
            .reason,
        ).toBe("invalid-state");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "rejects stale item/root, expires reviews, and allows cancellation during a source outage",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        f.state.version++;
        expect((yield* service.inspect(input.id)).validation).toBe("item-changed");
        expect(
          (yield* service.review({ id: input.id, reviewed: true }, "admin").pipe(Effect.flip))
            .reason,
        ).toBe("item-changed");
        f.state.version = 1;
        f.state.root = "/synthetic/moved";
        expect((yield* service.inspect(input.id)).validation).toBe("source-changed");
        f.state.root = "/synthetic/0";
        yield* TestClock.adjust("10 minutes");
        expect((yield* service.inspect(input.id)).plan.state).toBe("expired");
        expect(
          (yield* service.review({ id: input.id, reviewed: true }, "admin").pipe(Effect.flip))
            .reason,
        ).toBe("expired");
        f.state.unavailable = true;
        expect((yield* service.inspect(input.id)).validation).toBe("source-unavailable");
        expect((yield* service.cancel(input.id)).plan.state).toBe("cancelled");
        expect((yield* service.list({ cursor: null })).items[0]?.validation).toBe("not-checked");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "keeps raw URL authentication and helper commands out of inventory and replacement ledgers",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.github = true;
      f.state.raw =
        "remote.origin.url\nhttps://dev:synthetic-private-token@github.com/dev/repo.git?access_token=private-query\0credential.helper\n!secret-helper-contents\0";
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const inventory = yield* service.inventory({ cursor: null });
        const input = {
          ...prepareInput(f.state.raw),
          replacement: { adapter: "github" as const, itemId, expectedVersion: 1 },
        };
        const result = yield* service.prepare(input, "admin");
        expect(result.plan.replacement.scope).toBe("github-api-and-gh-only");
        expect(result.plan.dependency.embeddedAuthentication).toBe(true);
        for (const value of [
          inventory,
          result,
          ...[...f.records.values()].map((r) => Redacted.value(r.value)),
        ]) {
          const encoded = JSON.stringify(value);
          for (const secret of [
            "synthetic-private-token",
            "private-query",
            "secret-helper-contents",
          ])
            expect(encoded).not.toContain(secret);
        }
        f.state.allowed = false;
        expect((yield* service.inspect(input.id)).validation).toBe("replacement-unavailable");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect("refuses mismatched endpoints, local URL rewrites and stale inventory descriptors", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory,
        original = prepareInput(f.state.raw);
      f.state.host = "different.invalid";
      expect((yield* service.prepare(original, "admin").pipe(Effect.flip)).reason).toBe(
        "unsupported-source",
      );
      f.state.host = "github.com";
      f.state.raw += "url.ssh://alias/.insteadof\ngit@github.com:\0";
      expect((yield* service.prepare(original, "admin").pipe(Effect.flip)).reason).toBe(
        "unsupported-source",
      );
      f.state.raw = "remote.origin.url\ngit@github.com:dev/other.git\0";
      expect((yield* service.prepare(original, "admin").pipe(Effect.flip)).reason).toBe(
        "source-changed",
      );
      expect(f.records.size).toBe(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

const attempt = (id: string, expectedOperationId: string | null = null, letter = "c") => ({
  id,
  operationId: letter.repeat(32),
  expectedOperationId,
  contactDestination: true as const,
});
it.effect(
  "requires review and explicit contact, persists bounded SSH evidence and never authorizes cutover",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        expect(
          (yield* service.verify(attempt(input.id), "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("invalid-state");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        f.state.onProbe = Effect.sync(() => {
          const stored = [...f.records.values()].map(
            (r) => Redacted.value(r.value) as { verification?: { receipt: { state: string } } },
          );
          expect(stored[0]?.verification?.receipt.state).toBe("running");
        });
        const verified = yield* service.verify(attempt(input.id), "admin", Effect.void);
        expect(verified).toMatchObject({
          freshness: "current",
          workloadAuthorization: "not-evaluated",
          canCutover: false,
          receipt: {
            state: "passed",
            scope: "ssh-git-transport",
            gitPath: "dev/repo.git",
            hostFingerprint: "synthetic-host",
          },
        });
        expect(yield* service.verify(attempt(input.id), "admin", Effect.void)).toEqual(verified);
        const before = [...f.records.values()].map((r) => r.version);
        expect((yield* service.verification(input.id)).freshness).toBe("current");
        expect([...f.records.values()].map((r) => r.version)).toEqual(before);
        expect(f.state.probeCalls).toBe(1);
        yield* TestClock.adjust("61 seconds");
        expect((yield* service.verification(input.id)).freshness).toBe("expired");
        expect(f.state.probeCalls).toBe(1);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect("keeps GitHub repository API evidence separate from Git and clamps token lifetime", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.github = true;
    f.state.upstreamExpiry = DateTime.formatIso(
      DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 30_000),
    );
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory;
      const input = {
        ...prepareInput(f.state.raw),
        replacement: { adapter: "github" as const, itemId, expectedVersion: 1 },
      };
      yield* service.prepare(input, "admin");
      yield* service.review({ id: input.id, reviewed: true }, "admin");
      const result = yield* service.verify(attempt(input.id), "admin", Effect.void);
      expect(result).toMatchObject({
        freshness: "current",
        canCutover: false,
        receipt: {
          scope: "github-api-and-gh-only",
          gitPath: null,
          hostFingerprint: null,
          validUntil: Date.parse(f.state.upstreamExpiry!),
        },
      });
      yield* TestClock.adjust("30 seconds");
      expect((yield* service.verification(input.id)).freshness).toBe("expired");
      expect(f.state.probeCalls).toBe(1);
    }).pipe(Effect.provide(f.layer));
  }),
);
it.effect.each(["source", "item", "permission"] as const)(
  "rejects a successful probe when %s changes in flight",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        f.state.onProbe = Effect.sync(() => {
          if (kind === "source") f.state.raw += "core.sshcommand\nchanged\0";
          if (kind === "item") f.state.active = false;
          if (kind === "permission") f.state.permit = false;
        });
        const authorize = Effect.suspend(() =>
          f.state.permit ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
        );
        const result = yield* service.verify(attempt(input.id), "admin", authorize);
        expect(result.receipt?.state).toBe("failed");
        expect(result.receipt?.failure).toBe(
          kind === "source" ? "source-changed" : kind === "item" ? "item-changed" : "denied",
        );
        expect(result.canCutover).toBe(false);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "supports cancelling in-flight checks without letting late results restore the plan",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      const started = yield* Deferred.make<void>(),
        finish = yield* Deferred.make<void>();
      f.state.onProbe = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(finish)),
      );
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        const running = yield* service
          .verify(attempt(input.id), "admin", Effect.void)
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        expect((yield* service.verify(attempt(input.id), "admin", Effect.void)).freshness).toBe(
          "running",
        );
        expect(
          (yield* service
            .verify(attempt(input.id, "c".repeat(32), "d"), "admin", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("verification-busy");
        expect(
          (yield* service.verify(attempt(input.id), "other-admin", Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("receipt-changed");
        yield* service.cancel(input.id);
        yield* Deferred.succeed(finish, undefined);
        const result = yield* Fiber.join(running);
        expect(result).toMatchObject({
          planState: "cancelled",
          freshness: "invalidated",
          invalidatedBy: "cancelled",
          receipt: { state: "failed", failure: "cancelled" },
        });
        expect(f.state.probeCalls).toBe(1);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "preserves unknown outcome after receipt-write failure, never replaying the same network request",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        f.state.failReceipt = true;
        expect(
          (yield* service.verify(attempt(input.id), "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        expect((yield* service.verify(attempt(input.id), "admin", Effect.void)).freshness).toBe(
          "running",
        );
      }).pipe(Effect.provide(f.layer));
      yield* TestClock.adjust("31 seconds");
      f.state.failReceipt = false;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          id = prepareInput(f.state.raw).id;
        expect((yield* service.verification(id)).freshness).toBe("interrupted");
        expect(f.state.probeCalls).toBe(1);
        expect(
          (yield* service.verify(attempt(id, "c".repeat(32), "d"), "admin", Effect.void)).freshness,
        ).toBe("current");
        expect(f.state.probeCalls).toBe(2);
        expect(
          (yield* service.verify(attempt(id), "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("receipt-changed");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect("records missing host trust without any network request", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory,
        input = prepareInput(f.state.raw);
      yield* service.prepare(input, "admin");
      yield* service.review({ id: input.id, reviewed: true }, "admin");
      const blocked = yield* service.verify(attempt(input.id), "admin", Effect.void);
      expect(blocked).toMatchObject({
        freshness: "failed",
        receipt: { failure: "untrusted-host" },
      });
      expect(f.state.probeCalls).toBe(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect(
  "invalidates historical success when source or item metadata changes and makes no extra probes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        f.state.active = false;
        expect(yield* service.verification(input.id)).toMatchObject({
          freshness: "invalidated",
          invalidatedBy: "item-changed",
        });
        f.state.active = true;
        f.state.unavailable = true;
        expect(yield* service.verification(input.id)).toMatchObject({
          freshness: "invalidated",
          invalidatedBy: "source-unavailable",
        });
        expect(f.state.probeCalls).toBe(1);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect("times out an unfinished probe with a controlled clock and records no success", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.pinned = true;
    const started = yield* Deferred.make<void>();
    f.state.onProbe = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory,
        input = prepareInput(f.state.raw);
      yield* service.prepare(input, "admin");
      yield* service.review({ id: input.id, reviewed: true }, "admin");
      const running = yield* service
        .verify(attempt(input.id), "admin", Effect.void)
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(running);
      expect(result).toMatchObject({
        freshness: "failed",
        receipt: { state: "failed", failure: "timeout", validUntil: null },
      });
      expect(f.state.probeCalls).toBe(1);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect(
  "previews only the verified repository read route and its conditional inverse without IO or ledger writes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      f.state.raw =
        "remote.origin.url\ngit@github.com:/dev/repo.git\0remote.other.url\ngit@other.invalid:keep/me.git\0";
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        const request = {
          id: input.id,
          kind: "cutover" as const,
          expectedOperationId: "c".repeat(32),
        };
        expect((yield* service.preview(request, Effect.void).pipe(Effect.flip)).reason).toBe(
          "verification-required",
        );
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        const before = [...f.records.entries()];
        const forward = yield* service.preview(request, Effect.void);
        expect(forward).toMatchObject({
          source: { remote: "origin", direction: "fetch", position: 0, gitPath: "/dev/repo.git" },
          replacement: { itemId, expectedVersion: 1, repository: "/dev/repo.git" },
          verificationOperationId: request.expectedOperationId,
          verifiedOperation: "ssh-repository-read",
          hostFingerprint: "synthetic-host",
          from: "existing-project-git",
          to: "vault-mediated-git-read",
          workloadAuthorization: "not-evaluated",
          configurationWrites: false,
          canCutover: false,
          canRollback: false,
        });
        expect(yield* service.preview(request, Effect.void)).toEqual(forward);
        const reverse = yield* service.preview({ ...request, kind: "rollback" }, Effect.void);
        expect(reverse).toMatchObject({
          from: forward.to,
          to: forward.from,
          verificationOperationId: forward.verificationOperationId,
          originalAccess: "not-verified",
          rollbackBasis: "hypothetical-forward-route",
          conflictGuard: "exact-source-and-forward-route-required",
          configurationSnapshot: "not-captured",
          canCutover: false,
          canRollback: false,
        });
        expect(reverse.previewId).not.toBe(forward.previewId);
        expect([...f.records.entries()]).toEqual(before);
        expect(f.state.probeCalls).toBe(1);
        expect(JSON.stringify(reverse)).not.toContain("other.invalid");
        expect(JSON.stringify(reverse)).not.toContain("git@github.com:/dev/repo.git");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(["cutover", "rollback"] as const)(
  "rejects stale, replaced and cancelled evidence for the %s preview",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        const request = { id: input.id, kind, expectedOperationId: "c".repeat(32) };
        f.state.raw += "credential.helper\nnever-run\0";
        expect((yield* service.preview(request, Effect.void).pipe(Effect.flip)).reason).toBe(
          "source-changed",
        );
        f.state.raw = "remote.origin.url\ngit@github.com:dev/repo.git\0";
        f.state.version++;
        expect((yield* service.preview(request, Effect.void).pipe(Effect.flip)).reason).toBe(
          "item-changed",
        );
        f.state.version = 1;
        f.state.pinned = false;
        expect((yield* service.preview(request, Effect.void).pipe(Effect.flip)).reason).toBe(
          "item-changed",
        );
        f.state.pinned = true;
        yield* service.verify(
          attempt(input.id, request.expectedOperationId, "d"),
          "admin",
          Effect.void,
        );
        expect((yield* service.preview(request, Effect.void).pipe(Effect.flip)).reason).toBe(
          "receipt-changed",
        );
        const latest = { ...request, expectedOperationId: "d".repeat(32) };
        yield* TestClock.adjust("61 seconds");
        expect((yield* service.preview(latest, Effect.void).pipe(Effect.flip)).reason).toBe(
          "verification-required",
        );
        yield* service.cancel(input.id);
        expect((yield* service.preview(latest, Effect.void).pipe(Effect.flip)).reason).toBe(
          "cancelled",
        );
        expect(f.state.probeCalls).toBe(2);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(["cutover", "rollback"] as const)(
  "never treats GitHub API evidence as Git transport eligibility for %s",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.github = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = {
          ...prepareInput(f.state.raw),
          replacement: { adapter: "github" as const, itemId, expectedVersion: 1 },
        };
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        expect(
          (yield* service
            .preview({ id: input.id, kind, expectedOperationId: "c".repeat(32) }, Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("verification-scope");
        expect(f.state.probeCalls).toBe(1);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(["push", "authentication", "omitted"] as const)(
  "rejects %s routing instead of extrapolating read evidence",
  (source) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      f.state.raw =
        source === "push"
          ? "remote.origin.pushurl\ngit@github.com:dev/repo.git\0"
          : source === "authentication"
            ? "remote.origin.url\nssh://git:private@github.com/dev/repo.git\0"
            : "remote.origin.url\ngit@github.com:dev/repo.git\0remote.invalid remote.url\ngit@host.invalid:ignored.git\0";
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        const result = yield* service
          .preview(
            { id: input.id, kind: "cutover", expectedOperationId: "c".repeat(32) },
            Effect.void,
          )
          .pipe(Effect.flip);
        expect(result.reason).toBe(source === "push" ? "unsupported-operation" : "unsafe-source");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "rechecks preview authorization after source access without writing or contacting a provider",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        let checks = 0;
        const authorize = Effect.suspend(() =>
          ++checks > 1 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        expect(
          (yield* service
            .preview(
              { id: input.id, kind: "cutover", expectedOperationId: "c".repeat(32) },
              authorize,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(checks).toBe(2);
        expect(f.state.probeCalls).toBe(1);
      }).pipe(Effect.provide(f.layer));
    }),
);

const originalAttempt = (id: string, expectedOperationId: string | null = null, letter = "d") => ({
  ...attempt(id, expectedOperationId, letter),
  original: { itemId: originalItemId, expectedVersion: 1 },
  developmentOnly: true as const,
  reviewedOriginalRoute: true as const,
});
it.effect(
  "requires independent original development evidence and previews a design without capturing configuration",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        const design = {
          id: input.id,
          expectedReplacementOperationId: "c".repeat(32),
          expectedOriginalOperationId: "d".repeat(32),
        };
        expect((yield* service.recoveryPreview(design, Effect.void).pipe(Effect.flip)).reason).toBe(
          "verification-required",
        );
        const original = yield* service.originalVerify(
          originalAttempt(input.id),
          "admin",
          Effect.void,
        );
        expect(original).toMatchObject({
          role: "original-development-route",
          freshness: "current",
          identityBinding: "explicit-development-selection",
          ambientAuthentication: "not-evaluated",
          canCutover: false,
          canRollback: false,
          configurationWrites: false,
          receipt: {
            itemId: originalItemId,
            scope: "ssh-git-transport",
            gitPath: "dev/repo.git",
            hostFingerprint: "synthetic-original-host",
          },
        });
        expect(f.state.probeIds).toEqual([itemId, originalItemId]);
        expect(
          yield* service.originalVerify(originalAttempt(input.id), "admin", Effect.void),
        ).toEqual(original);
        expect(f.state.probeCalls).toBe(2);
        const before = [...f.records.entries()];
        const preview = yield* service.recoveryPreview(design, Effect.void);
        expect(preview).toMatchObject({
          snapshotState: "design-only",
          configurationSnapshot: "not-captured",
          captureEngine: "unimplemented",
          concurrentWriterStrategy: "unresolved",
          configurationWrites: false,
          canCutover: false,
          canRollback: false,
          original: { operationId: "d".repeat(32) },
          replacement: { operationId: "c".repeat(32) },
        });
        expect(yield* service.recoveryPreview(design, Effect.void)).toEqual(preview);
        expect((yield* service.originalVerification(input.id)).freshness).toBe("current");
        expect([...f.records.entries()]).toEqual(before);
        expect(f.state.probeCalls).toBe(2);
        expect(JSON.stringify(preview)).not.toContain("remote.origin.url");
        expect(
          (yield* service
            .recoveryPreview(
              { ...design, expectedOriginalOperationId: "c".repeat(32) },
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("receipt-changed");
        f.state.originalVersion++;
        expect((yield* service.recoveryPreview(design, Effect.void).pipe(Effect.flip)).reason).toBe(
          "item-changed",
        );
        f.state.originalVersion = 1;
        expect([...f.records.keys()]).toHaveLength(1);
        yield* TestClock.adjust("61 seconds");
        expect((yield* service.recoveryPreview(design, Effect.void).pipe(Effect.flip)).reason).toBe(
          "verification-required",
        );
        const [key, stored] = [...f.records.entries()][0]!;
        const malformed = Redacted.value(stored.value) as {
          originalVerification: { receipt: { gitPath: string } };
        };
        f.records.set(key, {
          ...stored,
          value: Redacted.make({
            ...malformed,
            originalVerification: {
              ...malformed.originalVerification,
              receipt: { ...malformed.originalVerification.receipt, gitPath: "dev/other.git" },
            },
          }),
        });
        expect((yield* service.originalVerification(input.id).pipe(Effect.flip)).reason).toBe(
          "invalid-response",
        );
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect.each(["same-key", "wrong-user", "implicit-user", "local-command", "api-plan"] as const)(
  "refuses %s original-route claims before a provider probe",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      if (kind === "implicit-user") f.state.raw = "remote.origin.url\ngithub.com:dev/repo.git\0";
      if (kind === "local-command") f.state.raw += "core.sshcommand\nnever-run-this\0";
      if (kind === "wrong-user") f.state.originalUsername = "wrong-user";
      if (kind === "api-plan") f.state.github = true;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory;
        const input = {
          ...prepareInput(f.state.raw),
          replacement: {
            adapter: f.state.github ? ("github" as const) : ("ssh" as const),
            itemId,
            expectedVersion: 1,
          },
        };
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        const request = originalAttempt(input.id);
        const result = yield* service
          .originalVerify(
            kind === "same-key"
              ? { ...request, original: { itemId, expectedVersion: 1 } }
              : request,
            "admin",
            Effect.void,
          )
          .pipe(Effect.flip);
        expect(result.reason).toBe(
          kind === "api-plan"
            ? "verification-scope"
            : kind === "local-command"
              ? "unsafe-source"
              : "original-identity-required",
        );
        expect(f.state.probeCalls).toBe(0);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "persists original failures and interrupted outcomes independently, and invalidates snapshot prerequisites",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.pinned = true;
      f.state.originalPinned = false;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigrationInventory.VaultMigrationInventory,
          input = prepareInput(f.state.raw);
        yield* service.prepare(input, "admin");
        yield* service.review({ id: input.id, reviewed: true }, "admin");
        yield* service.verify(attempt(input.id), "admin", Effect.void);
        const failed = yield* service.originalVerify(
          originalAttempt(input.id),
          "admin",
          Effect.void,
        );
        expect(failed).toMatchObject({
          freshness: "failed",
          receipt: { failure: "untrusted-host" },
        });
        expect((yield* service.verification(input.id)).freshness).toBe("current");
        f.state.originalPinned = true;
        f.state.failOriginalReceipt = true;
        expect(
          (yield* service
            .originalVerify(originalAttempt(input.id, "d".repeat(32), "e"), "admin", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        expect((yield* service.originalVerification(input.id)).freshness).toBe("running");
        const calls = f.state.probeCalls;
        expect(
          (yield* service.originalVerify(
            originalAttempt(input.id, "d".repeat(32), "e"),
            "admin",
            Effect.void,
          )).freshness,
        ).toBe("running");
        expect(f.state.probeCalls).toBe(calls);
        yield* TestClock.adjust("31 seconds");
        expect((yield* service.originalVerification(input.id)).freshness).toBe("interrupted");
        f.state.failOriginalReceipt = false;
        yield* service.originalVerify(
          originalAttempt(input.id, "e".repeat(32), "f"),
          "admin",
          Effect.void,
        );
        f.state.originalVersion++;
        expect((yield* service.originalVerification(input.id)).freshness).toBe("invalidated");
        f.state.originalVersion = 1;
        yield* service.cancel(input.id);
        expect((yield* service.originalVerification(input.id)).freshness).toBe("invalidated");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect("cannot restore cancelled original verification from a late completion", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.pinned = true;
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory,
        input = prepareInput(f.state.raw);
      yield* service.prepare(input, "admin");
      yield* service.review({ id: input.id, reviewed: true }, "admin");
      f.state.onProbe = service.cancel(input.id).pipe(
        Effect.asVoid,
        Effect.mapError(() => new VaultError({ reason: "conflict" })),
      );
      const result = yield* service.originalVerify(originalAttempt(input.id), "admin", Effect.void);
      expect(result).toMatchObject({
        freshness: "invalidated",
        planState: "cancelled",
        receipt: { state: "failed", failure: "cancelled" },
      });
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("keeps concurrently accepted original and replacement receipts independent", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.pinned = true;
    yield* Effect.gen(function* () {
      const service = yield* VaultMigrationInventory.VaultMigrationInventory,
        input = prepareInput(f.state.raw);
      yield* service.prepare(input, "admin");
      yield* service.review({ id: input.id, reviewed: true }, "admin");
      const entered = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      let calls = 0;
      f.state.onProbe = Effect.gen(function* () {
        if (++calls === 2) yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      });
      const replacement = yield* Effect.forkChild(
        service.verify(attempt(input.id), "admin", Effect.void),
      );
      const original = yield* Effect.forkChild(
        service.originalVerify(originalAttempt(input.id), "admin", Effect.void),
      );
      yield* Deferred.await(entered);
      expect((yield* service.verification(input.id)).freshness).toBe("running");
      expect((yield* service.originalVerification(input.id)).freshness).toBe("running");
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(replacement)).freshness).toBe("current");
      expect((yield* Fiber.join(original)).freshness).toBe("current");
      expect(
        (yield* service.recoveryPreview(
          {
            id: input.id,
            expectedOriginalOperationId: "d".repeat(32),
            expectedReplacementOperationId: "c".repeat(32),
          },
          Effect.void,
        )).configurationSnapshot,
      ).toBe("not-captured");
    }).pipe(Effect.provide(f.layer));
  }),
);
