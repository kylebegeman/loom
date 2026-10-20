import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import {
  VaultError,
  type VaultItemSummary,
  type VaultReplacementPrepare,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
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
    root: "/synthetic/0",
    github: false,
    allowed: true,
    host: "github.com",
    count: 1,
    reads: [] as string[],
  };
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const item = (): VaultItemSummary => ({
    id: itemId,
    label: "Dedicated development",
    kind: state.github ? "service-connection" : "ssh-key",
    state: state.active ? "active" : "archived",
    version: state.version,
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
    Layer.mock(VaultCore.VaultCore)({ inspect: () => Effect.succeed(item()) }),
    Layer.mock(VaultSsh.VaultSsh)({
      info: () =>
        Effect.succeed({
          item: item(),
          target: { hostname: state.host, username: "git", port: 22, hostKey: null },
          publicKey: "",
          fingerprint: "synthetic",
          hostFingerprint: null,
          destination: `ssh://git@${state.host}:22`,
        }),
    }),
    Layer.mock(VaultGitHub.VaultGitHub)({
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
