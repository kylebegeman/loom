import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Stream from "effect/Stream";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultProfileToolkit, vaultProfileHandlers } from "./profile-mcp.ts";
import { RunId } from "@t3tools/contracts";
import {
  vaultGitHubDestination,
  vaultPromptLink,
  type VaultProfileDefinition,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultReferences from "./VaultReferences.ts";
import * as VaultPromptContext from "./VaultPromptContext.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const deps = Layer.merge(NodeServices.layer, memoryVault);
const fixture = Effect.gen(function* () {
  let beforeSession: Effect.Effect<void> = Effect.void,
    calls = 0,
    sessions = 0,
    releases = 0;
  const adapters = Layer.mergeAll(
    Layer.succeed(GitHubTransport.GitHubTransport, {
      session: (_credential, repositories) =>
        Effect.gen(function* () {
          sessions++;
          expect(repositories).toEqual(["loom/repo"]);
          yield* beforeSession;
          return {
            account: "loom",
            token: Redacted.make("synthetic-profile-token"),
            expiresAt: null,
          };
        }),
      probe: () => Effect.void,
      release: () =>
        Effect.sync(() => {
          releases++;
        }),
    }),
    Layer.succeed(GitHubCli.GitHubCli, {
      run: (input) =>
        input.authorize.pipe(
          Effect.andThen(
            Effect.sync(() => {
              calls++;
              expect(input.repository).toBe("loom/repo");
              expect(input.operation).toEqual({ action: "pr-list" });
              return { exitCode: 0, stdout: "Scoped profile GH result" };
            }),
          ),
        ),
    }),
  );
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: () => Effect.succeed({ exitCode: 0, stdout: "" }),
    }),
    adapters,
  );
  const github = Context.get(f.context, VaultGitHub.VaultGitHub),
    connectionId = yield* f.id;
  yield* github.save(
    {
      id: connectionId,
      operationId: yield* f.id,
      expectedVersion: 0,
      label: "Profile GitHub",
      repositories: ["loom/repo"],
      credential: { type: "token", token: Redacted.make("synthetic-profile-private") },
    },
    "admin",
    Effect.void,
  );
  const projectId = f.state.thread.projectId;
  const profile: VaultProfileDefinition = {
    id: yield* f.id,
    label: "GitHub development",
    bindings: [{ name: "source", kind: "github", itemId: connectionId, repository: "Loom/Repo" }],
  };
  const apply = (change: Parameters<typeof f.profiles.apply>[0]["change"]) =>
    Effect.gen(function* () {
      const current = yield* f.profiles.list(projectId);
      return yield* f.profiles.apply(
        { projectId, expectedRevision: current.revision, operationId: yield* f.id, change },
        "admin",
      );
    });
  const grant = Effect.gen(function* () {
    const snapshot = yield* f.access.snapshot;
    yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: snapshot.revision,
        change: {
          type: "save",
          grant: {
            id: yield* f.id,
            label: "GitHub use",
            principal: { kind: "thread", id: f.threadId },
            itemIds: [connectionId],
            actions: ["use"],
            projectId: null,
            destination: vaultGitHubDestination("loom/repo"),
            notBefore: 0,
            expiresAt: null,
            parentId: null,
          },
        },
      },
      "admin",
    );
  });
  const launch = yield* VaultLaunch.VaultLaunch.pipe(
    Effect.provide(VaultLaunch.layer),
    Effect.provide(f.context),
    Effect.provide(f.project),
    Effect.provideService(BrokerIdentity.BrokerIdentity, f.identity),
    Effect.provideService(HostProcess.Environment, {}),
  );
  const run = () =>
    launch.profile(
      {
        profileId: profile.id,
        binding: "source",
        operation: { kind: "github", operation: { action: "pr-list" } },
      },
      f.threadId,
    );
  return {
    ...f,
    github,
    profile,
    projectId,
    connectionId,
    apply,
    grant,
    run,
    beforeSession: <E>(effect: Effect.Effect<void, E>) => {
      beforeSession = effect.pipe(Effect.orDie);
    },
    calls: () => calls,
    sessions: () => sessions,
    releases: () => releases,
  };
});
it.effect(
  "previews local GitHub bindings without provider calls and requires exact repository grants",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const preview = (profile = f.profile, threadId: typeof f.threadId | null = f.threadId) =>
        f.profiles.preview({ projectId: f.projectId, profile, threadId });
      expect((yield* preview()).bindings[0]?.state).toBe("denied");
      expect((yield* preview(f.profile, null)).bindings[0]).toMatchObject({
        state: "unchecked",
        version: 1,
        destination: "https://github.com/loom/repo",
      });
      expect(
        (yield* preview({
          ...f.profile,
          bindings: [{ ...f.profile.bindings[0]!, repository: null }],
        })).bindings[0]?.state,
      ).toBe("missing");
      expect(
        (yield* preview({
          ...f.profile,
          bindings: [{ ...f.profile.bindings[0]!, itemId: f.itemId }],
        })).bindings[0]?.state,
      ).toBe("unavailable");
      expect(
        (yield* preview({
          ...f.profile,
          bindings: [{ ...f.profile.bindings[0]!, repository: "loom/other" }],
        })).bindings[0]?.state,
      ).toBe("denied");
      expect(
        (yield* preview({
          ...f.profile,
          bindings: [{ ...f.profile.bindings[0]!, repository: "https://github.com/loom/repo" }],
        }).pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      yield* f.grant;
      expect((yield* preview()).ready).toBe(true);
      expect(f.sessions()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "pins GitHub versions across profile edits and executes named operations without an SSH broker",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.apply({ type: "save", profile: f.profile });
      yield* f.grant;
      const first = yield* f.profiles.prepare(
        f.threadId,
        f.profile.id,
        1,
        f.state.thread.activeRunId!,
      );
      expect(first.bindings[0]).toMatchObject({
        kind: "github",
        itemId: f.connectionId,
        version: 1,
        destination: "https://github.com/loom/repo",
      });
      yield* f.apply({
        type: "save",
        profile: {
          ...f.profile,
          label: "Edited",
          bindings: [{ ...f.profile.bindings[0]!, itemId: null }],
        },
      });
      const restored = yield* VaultProfiles.VaultProfiles.pipe(
        Effect.provide(VaultProfiles.layer),
        Effect.provide(f.context),
      );
      expect(yield* restored.resolve(f.threadId, null)).toEqual(first);
      expect((yield* f.run()).stdout).toBe("Scoped profile GH result");
      expect(f.calls()).toBe(1);
      expect(f.releases()).toBe(2);
      expect(
        (yield* f.launch
          .profile(
            {
              profileId: f.profile.id,
              binding: "source",
              operation: { kind: "git", action: "ls-remote", timeoutMs: 8000 },
            },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-operation");
      yield* f.core.change(
        { id: f.connectionId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
      );
      expect((yield* f.run().pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect.each(["archive-profile", "change-run", "rotate-connection", "revoke-grant"] as const)(
  "denies %s during token acquisition before profile GH delivery",
  (scenario) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.apply({ type: "save", profile: f.profile });
      yield* f.grant;
      const change =
        scenario === "archive-profile"
          ? f.apply({ type: "state", id: f.profile.id, state: "archived" }).pipe(Effect.asVoid)
          : scenario === "change-run"
            ? Effect.sync(() => {
                f.state.thread = {
                  ...f.state.thread,
                  activeRunId: RunId.make("changed-during-token"),
                };
              })
            : scenario === "revoke-grant"
              ? Effect.gen(function* () {
                  const snapshot = yield* f.access.snapshot;
                  yield* f.access.apply(
                    {
                      operationId: yield* f.id,
                      expectedRevision: snapshot.revision,
                      change: {
                        type: "state",
                        id: snapshot.grants[0]!.definition.id,
                        state: "revoked",
                      },
                    },
                    "admin",
                  );
                })
              : Effect.gen(function* () {
                  const stored = yield* f.core.reveal({ id: f.connectionId, expectedVersion: 1 });
                  yield* f.core.save(
                    {
                      id: f.connectionId,
                      expectedVersion: 1,
                      operationId: yield* f.id,
                      label: "Replaced connection",
                      kind: "service-connection",
                      value: stored.value,
                    },
                    "admin",
                  );
                });
      f.beforeSession(change);
      expect((yield* f.run().pipe(Effect.flip))._tag).toBe("VaultError");
      expect(f.calls()).toBe(0);
      expect(f.releases()).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "blocks interactive and scheduled launch attachments until GitHub access is repaired and rechecks revocation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.apply({ type: "save", profile: f.profile });
      const references = yield* VaultReferences.VaultReferences.pipe(
        Effect.provide(VaultReferences.layer),
        Effect.provide(f.context),
      );
      const context = Context.add(f.context, VaultReferences.VaultReferences, references);
      yield* Layer.build(VaultPromptContext.layer).pipe(Effect.provide(context));
      const prepare = () =>
        VaultPromptContext.applyVaultPromptContext({
          threadId: f.threadId,
          runId: f.state.thread.activeRunId!,
          text: vaultPromptLink(
            { kind: "profile", environmentId: f.environmentId, id: f.profile.id, version: 1 },
            "GitHub profile",
          ),
        }).pipe(Effect.provide(context));
      expect((yield* prepare().pipe(Effect.flip)).reason).toBe("profile-blocked");
      yield* f.grant;
      yield* prepare();
      expect((yield* f.profiles.resolve(f.threadId, null)).bindings[0]?.itemId).toBe(
        f.connectionId,
      );
      yield* f.core.change(
        { id: f.connectionId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
      );
      expect((yield* prepare().pipe(Effect.flip)).reason).toBe("profile-blocked");
      expect(f.calls()).toBe(0);
      expect(f.sessions()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect("executes a GitHub binding through the authenticated profile MCP path", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.apply({ type: "save", profile: f.profile });
    yield* f.grant;
    const references = yield* VaultReferences.VaultReferences.pipe(
      Effect.provide(VaultReferences.layer),
      Effect.provide(f.context),
    );
    const context = f.context.pipe(
      Context.add(VaultReferences.VaultReferences, references),
      Context.add(VaultLaunch.VaultLaunch, f.launch),
    );
    const toolkit = yield* VaultProfileToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(vaultProfileHandlers).pipe(
          Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
        ),
      ),
    );
    const result = yield* toolkit
      .handle("loom_vault_profile_run", {
        profileId: f.profile.id,
        binding: "source",
        operation: { kind: "github", operation: { action: "pr-list" } },
      })
      .pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provide(f.context),
        Effect.provideService(McpInvocationContext, {
          environmentId: f.environmentId,
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
          requestNamespace: "github-profile",
          client: undefined,
          thread: {
            threadId: f.threadId,
            providerInstanceId: f.state.thread.providerInstanceId!,
            providerSessionId: "test",
          },
        }),
      );
    expect(result[0]?.result).toMatchObject({
      account: "loom",
      repository: "loom/repo",
      exitCode: 0,
      stdout: "Scoped profile GH result",
    });
    expect(f.calls()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "imports GitHub requirements as unbound local profiles and repairs them without copying identity or defaults",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const id = yield* f.id;
      const imported = yield* f.apply({
        type: "import",
        id,
        declaration: {
          format: "loom-vault-requirements",
          version: 2,
          label: "Portable GitHub",
          requirements: [{ name: "source", kind: "github" }],
        },
      });
      const profile = imported.profiles.find((p) => p.id === id)!;
      expect(profile.bindings).toEqual([
        { name: "source", kind: "github", itemId: null, repository: null },
      ]);
      expect(imported.activeProfileId).toBeNull();
      expect(
        (yield* f.profiles.preview({ projectId: f.projectId, profile, threadId: null })).bindings[0]
          ?.state,
      ).toBe("missing");
      yield* f.apply({
        type: "save",
        profile: {
          ...profile,
          bindings: [{ ...profile.bindings[0]!, itemId: f.connectionId, repository: "loom/repo" }],
        },
      });
      yield* f.grant;
      expect((yield* f.profiles.resolve(f.threadId, id)).bindings[0]?.itemId).toBe(f.connectionId);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
