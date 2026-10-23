import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { VaultConnectionError, VaultError, vaultGitDestination } from "@t3tools/contracts/fork";
import * as VaultConnections from "./VaultConnections.ts";
import * as SshTransport from "./SshTransport.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitHubTerminal from "./GitHubTerminal.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";

const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const fixture = Effect.gen(function* () {
  const executed: string[] = [];
  let beforeExecute: Effect.Effect<void> = Effect.void;
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: (input) =>
        beforeExecute.pipe(
          Effect.andThen(input.authorize),
          Effect.andThen(
            Effect.sync(() => {
              executed.push(input.publicKey);
              return { exitCode: 0, stdout: "synthetic" };
            }),
          ),
        ),
    }),
  );
  const resolver = Context.get(f.context, VaultConnections.VaultConnections);
  const owner = (mode: "restricted" | "owner-trusted") =>
    Effect.gen(function* () {
      const policy = yield* f.access.snapshot;
      yield* f.access.setOwnerPolicy(
        { operationId: yield* f.id, expectedRevision: policy.revision, mode },
        "admin",
        Effect.void,
      );
    });
  const second = (label = "Second key", trusted = true) =>
    Effect.gen(function* () {
      return yield* f.ssh.generate(
        {
          id: yield* f.id,
          operationId: yield* f.id,
          label,
          target: { ...f.key.target, hostKey: trusted ? f.key.target.hostKey : null },
        },
        "admin",
        Effect.void,
      );
    });
  return {
    ...f,
    resolver,
    owner,
    second,
    executed,
    onExecute: (effect: Effect.Effect<void>) => {
      beforeExecute = effect;
    },
  };
});

it.effect(
  "resolves labels and hosts with real owner policy, returns safe choices and honors preferences",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).state,
      ).toBe("policy-denied");
      yield* f.owner("owner-trusted");
      const one = yield* f.resolver.require(
        { kind: "ssh", connection: { resource: "EXAMPLE.TEST" } },
        f.threadId,
      );
      expect(one.item.id).toBe(f.itemId);
      expect(one.item.version).toBe(1);
      expect(one.destination).toBe(f.key.destination);
      expect(JSON.stringify(one)).not.toMatch(/privateKey|BEGIN|synthetic-private/);
      yield* f.core.save(
        {
          id: yield* f.id,
          operationId: yield* f.id,
          expectedVersion: 0,
          label: "Unsupported connection",
          kind: "ssh-key",
          value: Redacted.make("{}"),
        },
        "admin",
      );
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "Unsupported connection" } },
          f.threadId,
        )).state,
      ).toBe("incompatible");

      const two = yield* f.second();
      const ambiguous = yield* f.resolver.resolve(
        { kind: "ssh", connection: { resource: "example.test" } },
        f.threadId,
      );
      expect(ambiguous.state).toBe("ambiguous");
      expect(ambiguous.choices.map((choice) => choice.item.id).sort()).toEqual(
        [f.itemId, two.item.id].sort(),
      );
      expect(
        (yield* f.resolver.require(
          {
            kind: "ssh",
            connection: { resource: "example.test", preferredItemIds: [two.item.id] },
          },
          f.threadId,
        )).item.id,
      ).toBe(two.item.id);
      const untrusted = yield* f.second("Untrusted key", false);
      expect(
        (yield* f.resolver.resolve(
          {
            kind: "ssh",
            connection: { resource: "example.test", preferredItemIds: [untrusted.item.id] },
          },
          f.threadId,
        )).state,
      ).toBe("untrusted-host");
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "never-enrolled.test" } },
          f.threadId,
        )).state,
      ).toBe("missing");
    }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "uses active project bindings as optional preferences and aliases without requiring a profile",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.owner("owner-trusted");
      const two = yield* f.second();
      const profileId = yield* f.id;
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 0,
          change: {
            type: "save",
            profile: {
              id: profileId,
              label: "Preferred project",
              bindings: [{ name: "deploy", kind: "ssh", itemId: two.item.id, repository: null }],
            },
          },
        },
        "admin",
      );
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "activate", id: profileId },
        },
        "admin",
      );
      expect(
        (yield* f.resolver.require(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).item.id,
      ).toBe(two.item.id);
      expect(
        (yield* f.resolver.require({ kind: "ssh", connection: { resource: "deploy" } }, f.threadId))
          .item.id,
      ).toBe(two.item.id);
      yield* f.profiles.resolve(f.threadId, null);
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 2,
          change: {
            type: "save",
            profile: {
              id: profileId,
              label: "Changed project default",
              bindings: [{ name: "deploy", kind: "ssh", itemId: f.itemId, repository: null }],
            },
          },
        },
        "admin",
      );
      expect(
        (yield* f.resolver.require(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).item.id,
      ).toBe(two.item.id);
      const result = yield* f.launch.ssh(
        { connection: { resource: "deploy" }, command: { argv: ["true"], timeoutMs: 8000 } },
        f.threadId,
      );
      expect(result.exitCode).toBe(0);
      expect(f.executed).toEqual([two.publicKey]);
      yield* f.ssh.trust(
        {
          id: two.item.id,
          operationId: yield* f.id,
          expectedVersion: 1,
          hostKey: two.target.hostKey,
        },
        "admin",
        Effect.void,
      );
      const changed = yield* f.resolver.resolve(
        { kind: "ssh", connection: { resource: "deploy" } },
        f.threadId,
      );
      expect(changed.state).toBe("version-conflict");
      expect(changed.selected).toBeNull();
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).state,
      ).toBe("version-conflict");
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 3,
          change: { type: "state", id: profileId, state: "archived" },
        },
        "admin",
      );
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).state,
      ).toBe("inactive");
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { id: f.itemId, expectedVersion: 1 } },
          f.threadId,
        )).state,
      ).toBe("ready");
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "Launch SSH" } },
          f.threadId,
        )).state,
      ).toBe("ready");
    }).pipe(Effect.provide(dependencies)),
);

it.effect("matches SSH account names exactly while matching host names without case", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.owner("owner-trusted");
    const result = yield* f.resolver.resolve(
      {
        kind: "ssh",
        connection: { resource: "EXAMPLE.TEST" },
        account: "GIT",
      },
      f.threadId,
    );
    expect(result.state).toBe("incompatible");
    expect(result.selected).toBeNull();
  }).pipe(Effect.provide(dependencies)),
);

it.effect("refuses unreadable retained run selections instead of rediscovering credentials", () => {
  let corruptPin = false;
  const backend = Layer.effect(
    OpenBaoStore.OpenBaoStore,
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      return OpenBaoStore.OpenBaoStore.of({
        ...store,
        read: (path) =>
          store
            .read(path)
            .pipe(
              Effect.map((record) =>
                corruptPin && record && path.includes("/runs/")
                  ? { ...record, value: Redacted.make({}) }
                  : record,
              ),
            ),
      });
    }),
  ).pipe(Layer.provide(memoryVault));
  return Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.owner("owner-trusted");
    const profileId = yield* f.id;
    yield* f.profiles.apply(
      {
        projectId: f.state.thread.projectId,
        operationId: yield* f.id,
        expectedRevision: 0,
        change: {
          type: "save",
          profile: {
            id: profileId,
            label: "Retained selection",
            bindings: [{ name: "deploy", kind: "ssh", itemId: f.itemId, repository: null }],
          },
        },
      },
      "admin",
    );
    yield* f.profiles.resolve(f.threadId, profileId);
    corruptPin = true;
    const result = yield* f.resolver.resolve(
      { kind: "ssh", connection: { resource: "example.test" } },
      f.threadId,
    );
    expect(result.state).toBe("policy-denied");
    expect(result.selected).toBeNull();
    expect(result.choices).toEqual([]);
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, backend)));
});

it.effect(
  "pins the current version and revalidates archive, version, trust and policy before use",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.owner("owner-trusted");
      const pin = yield* f.resolver.require(
        { kind: "git-ssh", connection: { resource: "Launch SSH" }, repository: "team/repo.git" },
        f.threadId,
      );
      expect(pin.destination).toBe(vaultGitDestination(f.key.target, "team/repo.git"));
      yield* f.owner("restricted");
      const blocked = yield* f.resolver.revalidate(pin, f.threadId).pipe(Effect.flip);
      expect(blocked).toBeInstanceOf(VaultConnectionError);
      expect(blocked.state).toBe("policy-denied");
      yield* f.owner("owner-trusted");
      yield* f.ssh.trust(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, hostKey: null },
        "admin",
        Effect.void,
      );
      expect((yield* f.resolver.revalidate(pin, f.threadId).pipe(Effect.flip)).state).toBe(
        "version-conflict",
      );
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "Launch SSH" } },
          f.threadId,
        )).state,
      ).toBe("untrusted-host");
      yield* f.core.change(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 2, action: "archive" },
        "admin",
      );
      expect(
        (yield* f.resolver.resolve(
          { kind: "ssh", connection: { resource: "Launch SSH" } },
          f.threadId,
        )).state,
      ).toBe("inactive");
      const two = yield* f.second();
      expect(
        (yield* f.resolver.require(
          { kind: "ssh", connection: { resource: "example.test" } },
          f.threadId,
        )).item.id,
      ).toBe(two.item.id);
    }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "runs hosted SSH, Git and terminal agent selection through the same owner-authorized pin",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.owner("owner-trusted");
      yield* f.launch.ssh(
        { connection: { resource: "Launch SSH" }, command: { argv: ["true"], timeoutMs: 8000 } },
        f.threadId,
      );
      yield* f.launch.git(
        {
          connection: { resource: "example.test" },
          action: "ls-remote",
          repository: "team/repo.git",
          timeoutMs: 30000,
        },
        f.threadId,
      );
      const agent = yield* f.launch.agent({ connection: { resource: "Launch SSH" } }, f.threadId);
      expect(agent.id).toBe(f.itemId);
      expect(agent.version).toBe(f.key.item.version);
      expect(agent.publicKey).toBe(f.key.publicKey);
      yield* f.ssh.agentClose(agent.sessionId, f.threadId);
      expect(f.executed).toEqual([f.key.publicKey, f.key.publicKey]);
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "routes hosted GitHub and terminal GH/Git through one chosen account without falling back",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.owner("owner-trusted");
      const calls: string[] = [];
      const github = yield* VaultGitHub.VaultGitHub.pipe(
        Effect.provide(
          VaultGitHub.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeedContext(f.context),
                Layer.succeed(GitHubTransport.GitHubTransport, {
                  session: () =>
                    Effect.succeed({
                      account: "loom-bot",
                      token: Redacted.make("disposable-operation-token"),
                      expiresAt: null,
                    }),
                  probe: () => Effect.void,
                  release: () => Effect.void,
                }),
                Layer.succeed(GitHubCli.GitHubCli, {
                  run: (input) =>
                    input.authorize.pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          calls.push(input.repository);
                          return { exitCode: 0, stdout: "synthetic" };
                        }),
                      ),
                    ),
                }),
                Layer.succeed(GitHubTerminal.GitHubTerminal, {
                  execute: (input) =>
                    input.authorize.pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          calls.push(input.repository);
                          return { exitCode: 0, stdout: "synthetic", stderr: "" };
                        }),
                      ),
                    ),
                }),
              ),
            ),
          ),
        ),
      );
      const id = yield* f.id;
      yield* github.save(
        {
          id,
          operationId: yield* f.id,
          expectedVersion: 0,
          label: "GitHub work",
          repositories: ["owner/repo", "owner/other"],
          credential: { type: "token", token: Redacted.make("disposable-credential") },
        },
        "admin",
        Effect.void,
      );
      const selected = yield* f.resolver.require(
        { kind: "github", connection: { resource: "owner/repo" } },
        f.threadId,
      );
      expect(selected.item.id).toBe(id);
      expect(selected.account).toBe("loom-bot");
      const profileId = yield* f.id;
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 0,
          change: {
            type: "save",
            profile: {
              id: profileId,
              label: "Repository shortcut",
              bindings: [{ name: "other", kind: "github", itemId: id, repository: "owner/other" }],
            },
          },
        },
        "admin",
      );
      yield* f.profiles.resolve(f.threadId, profileId);
      const fromUrl = yield* f.resolver.require(
        { kind: "github", connection: { resource: "https://github.com/OWNER/REPO.git" } },
        f.threadId,
      );
      expect(fromUrl.item.id).toBe(id);
      expect(fromUrl.repository).toBe("owner/repo");
      expect(fromUrl.destination).toBe("https://github.com/owner/repo");
      yield* github.run(
        {
          connection: { resource: "loom-bot" },
          repository: "owner/repo",
          operation: { action: "pr-list" },
        },
        f.threadId,
      );
      yield* github.terminal(
        {
          connection: { resource: "GitHub work" },
          repository: "owner/repo",
          command: { tool: "gh", argv: ["pr", "list"] },
        },
        f.threadId,
      );
      expect(calls).toEqual(["owner/repo", "owner/repo"]);
      const otherId = yield* f.id;
      yield* github.save(
        {
          id: otherId,
          operationId: yield* f.id,
          expectedVersion: 0,
          label: "Other GitHub",
          repositories: ["owner/repo"],
          credential: { type: "token", token: Redacted.make("other-disposable-credential") },
        },
        "admin",
        Effect.void,
      );
      expect(
        (yield* github
          .run(
            {
              connection: { resource: "owner/repo" },
              repository: "owner/repo",
              operation: { action: "pr-list" },
            },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("ambiguous");
      expect(
        (yield* github
          .terminal(
            {
              connection: { id, expectedVersion: 2 },
              repository: "owner/repo",
              command: { tool: "gh", argv: ["pr", "list"] },
            },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("version-conflict");
      expect(calls).toEqual(["owner/repo", "owner/repo"]);
    }).pipe(Effect.provide(dependencies)),
);

it.effect.each(["revoked", "expired"] as const)(
  "distinguishes %s access from absent enrollment without leaking invisible choices",
  (state) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: f.grantId,
              label: "Disposable authorization",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.itemId],
              actions: ["inspect", "use"],
              projectId: null,
              destination: f.key.destination,
              notBefore: 0,
              expiresAt: state === "expired" ? 1 : null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      if (state === "revoked")
        yield* f.access.apply(
          {
            operationId: yield* f.id,
            expectedRevision: 1,
            change: { type: "state", id: f.grantId, state: "revoked" },
          },
          "admin",
        );
      if (state === "expired") yield* TestClock.adjust(2);
      const result = yield* f.resolver.resolve(
        { kind: "ssh", connection: { id: f.itemId, expectedVersion: 1 } },
        f.threadId,
      );
      expect(result.state).toBe(state);
      expect(result.selected).toBeNull();
      expect(result.choices).toEqual([]);
      expect(result.repair).toBe("renew-access");
    }).pipe(Effect.provide(dependencies)),
);

it.effect.each([
  ["configuration", "backend-unconfigured"],
  ["locked", "backend-locked"],
  ["denied", "backend-denied"],
  ["unavailable", "backend-unavailable"],
] as const)("reports backend %s distinctly", ([reason, state]) => {
  let failure: VaultError["reason"] | null = null;
  const backend = Layer.effect(
    OpenBaoStore.OpenBaoStore,
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      return OpenBaoStore.OpenBaoStore.of({
        ...store,
        read: (path) =>
          failure ? Effect.fail(new VaultError({ reason: failure })) : store.read(path),
      });
    }),
  ).pipe(Layer.provide(memoryVault));
  return Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.owner("owner-trusted");
    failure = reason;
    const result = yield* f.resolver.resolve(
      { kind: "ssh", connection: { resource: "Launch SSH" } },
      f.threadId,
    );
    expect(result.state).toBe(state);
    expect(result.selected).toBeNull();
    expect(result.choices).toEqual([]);
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, backend)));
});

it.effect("refuses a changed key in the final execution guard and releases its workload", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.owner("owner-trusted");
    f.onExecute(
      f.ssh
        .trust(
          { id: f.itemId, expectedVersion: 1, operationId: yield* f.id, hostKey: null },
          "admin",
          Effect.void,
        )
        .pipe(Effect.orDie, Effect.asVoid),
    );
    const error = yield* f.launch
      .ssh(
        { connection: { resource: "Launch SSH" }, command: { argv: ["true"], timeoutMs: 8000 } },
        f.threadId,
      )
      .pipe(Effect.flip);
    expect(error).toBeInstanceOf(VaultConnectionError);
    expect(error.reason).toBe("version-conflict");
    expect(f.executed).toEqual([]);
    expect(yield* f.workloads.list(f.threadId)).toEqual([]);
  }).pipe(Effect.provide(dependencies)),
);
