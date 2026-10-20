import * as GitHubTerminal from "./GitHubTerminal.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  VaultError,
  VaultGitHubError,
  vaultGitHubDestination,
  type VaultGitHubSave,
} from "@t3tools/contracts/fork";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultGitHubToolkit, vaultGitHubHandlers } from "./github-mcp.ts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as VaultCore from "./VaultCore.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const fixture = Effect.gen(function* () {
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: () => Effect.succeed({ exitCode: 0, stdout: "" }),
    }),
  );
  let account = "loom-bot",
    deny = false,
    atSession = () => {},
    calls = 0,
    releases = 0;
  let beforeProbe: Effect.Effect<void> = Effect.void;
  const transport = Layer.succeed(GitHubTransport.GitHubTransport, {
    release: () =>
      Effect.sync(() => {
        releases++;
      }),
    session: () =>
      Effect.sync(() => {
        atSession();
        return { account, token: Redacted.make("synthetic-operation-token"), expiresAt: null };
      }),
    probe: () =>
      beforeProbe.pipe(
        Effect.andThen(
          Effect.suspend(() =>
            deny ? Effect.fail(new VaultGitHubError({ reason: "repository-denied" })) : Effect.void,
          ),
        ),
      ),
  });
  const cli = Layer.succeed(GitHubCli.GitHubCli, {
    run: (input) =>
      input.authorize.pipe(
        Effect.andThen(
          Effect.sync(() => {
            calls++;
            return { exitCode: 0, stdout: "Synthetic GH result" };
          }),
        ),
      ),
  });
  let terminalCalls = 0,
    terminalFailure = false;
  const terminal = Layer.succeed(GitHubTerminal.GitHubTerminal, {
    execute: (input) =>
      input.authorize.pipe(
        Effect.andThen(
          Effect.suspend(() => {
            terminalCalls++;
            return terminalFailure
              ? Effect.fail(new VaultGitHubError({ reason: "cli-unavailable" }))
              : Effect.succeed({ exitCode: 0, stdout: "Scoped terminal result", stderr: "" });
          }),
        ),
      ),
  });
  const service = yield* VaultGitHub.VaultGitHub.pipe(
    Effect.provide(
      VaultGitHub.layer.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeedContext(f.context), transport, cli, terminal)),
      ),
    ),
  );
  const id = yield* f.id;
  const input: VaultGitHubSave = {
    id,
    operationId: yield* f.id,
    expectedVersion: 0,
    label: "Loom GitHub QA",
    repositories: ["Owner/Repo"],
    credential: { type: "token", token: Redacted.make("synthetic-private-token") },
  };
  return {
    ...f,
    service,
    input,
    onProbe: (effect: Effect.Effect<void>) => {
      beforeProbe = effect;
    },
    terminalCalls: () => terminalCalls,
    terminalFailure: () => {
      terminalFailure = true;
    },
    setAccount: (value: string) => {
      account = value;
    },
    deny: () => {
      deny = true;
    },
    onSession: (run: () => void) => {
      atSession = run;
    },
    calls: () => calls,
    releases: () => releases,
  };
});
const deps = Layer.merge(NodeServices.layer, memoryVault);
it.effect(
  "stores only encrypted connection material, returns safe metadata, protects replacements and disconnect/restore",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const saved = yield* f.service.save(f.input, "admin", Effect.void);
      expect(saved.account).toBe("loom-bot");
      expect(saved.repositories).toEqual(["owner/repo"]);
      expect(JSON.stringify(saved)).not.toContain("synthetic-private-token");
      expect(yield* f.service.save(f.input, "admin", Effect.void)).toEqual(saved);
      expect((yield* f.service.list(null)).items).toEqual([saved]);
      expect(
        (yield* f.service
          .save({ ...f.input, operationId: yield* f.id }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
      expect((yield* f.service.test(target, Effect.void)).api).toBe("ready");
      expect(
        (yield* f.service
          .test({ ...target, repository: "other/repo" }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("repository-denied");
      yield* f.service.change(
        { id: f.input.id, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
        Effect.void,
      );
      expect(
        (yield* f.service.test({ ...target, expectedVersion: 2 }, Effect.void).pipe(Effect.flip))
          .reason,
      ).toBe("archived");
      yield* f.service.change(
        { id: f.input.id, operationId: yield* f.id, expectedVersion: 2, action: "restore" },
        "admin",
        Effect.void,
      );
      expect((yield* f.service.test({ ...target, expectedVersion: 3 }, Effect.void)).account).toBe(
        "loom-bot",
      );
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "requires exact repository grants and stable active run identity before scoped CLI delivery",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const run = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        operation: { action: "pr-list" as const },
      };
      expect((yield* f.service.run(run, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(0);
      // Grant fixture helper is item-specific; add the same policy with this connection id.
      const snapshot = yield* f.access.snapshot;
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: snapshot.revision,
          change: {
            type: "save",
            grant: {
              id: yield* f.id,
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.input.id],
              label: "GitHub proof",
              projectId: null,
              notBefore: 0,
              parentId: null,
              actions: ["use"],
              destination: vaultGitHubDestination(run.repository),
              expiresAt: null,
            },
          },
        },
        "admin",
      );
      expect((yield* f.service.run(run, f.threadId)).stdout).toBe("Synthetic GH result");
      expect(f.calls()).toBe(1);
      f.onSession(() => {
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      });
      expect((yield* f.service.run(run, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "fails closed on provider denial, changed accounts and revoked administrator authority",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        (yield* f.service
          .save(f.input, "admin", Effect.fail(new VaultError({ reason: "denied" })))
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect((yield* f.service.list(null)).items).toEqual([]);
      yield* f.service.save(f.input, "admin", Effect.void);
      f.setAccount("unexpected-account");
      expect(
        (yield* f.service
          .test({ id: f.input.id, expectedVersion: 1, repository: "owner/repo" }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      f.deny();
      expect(
        (yield* f.service
          .save({ ...f.input, id: yield* f.id, operationId: yield* f.id }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("repository-denied");
      expect((yield* f.service.list(null)).items).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "keeps GitHub management human-only and binds agent MCP execution to its authenticated provider",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const saved = yield* f.service.save(f.input, "admin", Effect.void);
      const context = f.context.pipe(Context.add(VaultGitHub.VaultGitHub, f.service));
      const toolkit = yield* VaultGitHubToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultGitHubHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "github",
        client: undefined,
        thread: {
          threadId: f.threadId,
          providerInstanceId: f.state.thread.providerInstanceId!,
          providerSessionId: "test",
        },
      };
      const admin: McpInvocationScope = {
        ...scope,
        thread: undefined,
        client: { sessionId: "admin", access: "full-access", label: "admin" },
      };
      const list = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_github_connections", { cursor: null })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* list(scope).pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* list(admin))[0]?.result).toMatchObject({ items: [saved] });
      const inspect = (caller = scope) =>
        toolkit
          .handle("loom_vault_github_info", { id: f.input.id })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* inspect().pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* inspect(admin))[0]?.result).toEqual(saved);
      const run = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_github", {
            id: f.input.id,
            expectedVersion: 1,
            repository: "owner/repo",
            operation: { action: "repo-view" },
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* run(admin).pipe(Effect.flip))._tag).toBe("VaultError");
      expect(
        (yield* run({
          ...scope,
          thread: { ...scope.thread!, providerInstanceId: ProviderInstanceId.make("wrong") },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      expect(
        (yield* list({ ...admin, client: { ...admin.client!, access: "read-only" } }).pipe(
          Effect.flip,
        ))._tag,
      ).toBe("VaultError");
      const terminalInput = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        command: { tool: "gh" as const, argv: ["pr", "list"] },
      };
      const exec = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_github_exec", terminalInput)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* exec(admin).pipe(Effect.flip))._tag).toBe("VaultError");
      yield* allowTerminal(f);
      expect((yield* exec(scope))[0]?.result).toMatchObject({ stdout: "Scoped terminal result" });
      const readiness = toolkit
        .handle("loom_vault_github_readiness", {
          id: f.input.id,
          expectedVersion: 1,
          repository: "owner/repo",
          threadId: null,
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(context),
          Effect.provideService(McpInvocationContext, scope),
        );
      expect((yield* readiness.pipe(Effect.flip))._tag).toBe("VaultError");
      expect(f.calls()).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "releases provider sessions on denial and protects other service-connection formats",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      expect(f.releases()).toBe(1);
      f.setAccount("changed-account");
      yield* f.service
        .test({ id: f.input.id, expectedVersion: 1, repository: "owner/repo" }, Effect.void)
        .pipe(Effect.flip);
      expect(f.releases()).toBe(2);
      const core = Context.get(f.context, VaultCore.VaultCore),
        id = yield* f.id;
      yield* core.save(
        {
          id,
          operationId: yield* f.id,
          expectedVersion: 0,
          label: "Other connector",
          kind: "service-connection",
          value: Redacted.make("unrelated-connector-format"),
        },
        "admin",
      );
      expect(
        (yield* f.service
          .save(
            { ...f.input, id, operationId: yield* f.id, expectedVersion: 1 },
            "admin",
            Effect.void,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("not-found");
      expect(Redacted.value((yield* core.reveal({ id, expectedVersion: 1 })).value)).toBe(
        "unrelated-connector-format",
      );
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

const allowTerminal = (f: Effect.Success<typeof fixture>) =>
  Effect.gen(function* () {
    const snapshot = yield* f.access.snapshot;
    return yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: snapshot.revision,
        change: {
          type: "save",
          grant: {
            id: yield* f.id,
            label: "Terminal GitHub",
            principal: { kind: "thread", id: f.threadId },
            itemIds: [f.input.id],
            actions: ["use"],
            projectId: null,
            destination: vaultGitHubDestination("owner/repo"),
            notBefore: 0,
            expiresAt: null,
            parentId: null,
          },
        },
      },
      "admin",
    );
  });
it.effect(
  "terminal execution requires current repository authority and releases sessions after run changes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const input = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        command: { tool: "git" as const, argv: ["fetch", "origin"] },
      };
      expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(f.terminalCalls()).toBe(0);
      const grant = yield* allowTerminal(f);
      expect((yield* f.service.terminal(input, f.threadId)).stdout).toBe("Scoped terminal result");
      expect(f.terminalCalls()).toBe(1);
      const snapshot = yield* f.access.snapshot;
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: snapshot.revision,
          change: { type: "state", id: grant.definition.id, state: "revoked" },
        },
        "admin",
      );
      expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      yield* allowTerminal(f);
      const released = f.releases();
      f.onSession(() => {
        f.state.thread = {
          ...f.state.thread,
          providerInstanceId: ProviderInstanceId.make("changed"),
        };
      });
      expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(f.terminalCalls()).toBe(1);
      expect(f.releases()).toBe(released + 1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "readiness distinguishes host tools, denied thread grants and independently failed executables",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const input = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        threadId: null,
      };
      const host = yield* f.service.readiness(input, Effect.void);
      expect(host.grant).toBe("unchecked");
      expect(host.context).toBe("loom-server");
      expect(host.checks.map((c) => c.state)).toEqual(["ready", "ready", "ready"]);
      expect(Date.parse(host.expiresAt) - Date.parse(host.checkedAt)).toBe(60000);
      const calls = f.terminalCalls();
      const denied = yield* f.service.readiness({ ...input, threadId: f.threadId }, Effect.void);
      expect(denied.grant).toBe("denied");
      expect(denied.checks.every((c) => c.state === "skipped")).toBe(true);
      expect(f.terminalCalls()).toBe(calls);
      yield* allowTerminal(f);
      f.terminalFailure();
      const failed = yield* f.service.readiness({ ...input, threadId: f.threadId }, Effect.void);
      expect(failed.grant).toBe("ready");
      expect(failed.providerInstanceId).toBe(f.state.thread.providerInstanceId);
      expect(failed.checks).toMatchObject([
        { kind: "api", state: "ready" },
        { kind: "gh", state: "failed", reason: "cli-unavailable" },
        { kind: "git-https", state: "failed", reason: "cli-unavailable" },
      ]);
      expect(
        (yield* f.service
          .readiness(input, Effect.fail(new VaultError({ reason: "denied" })))
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect("cancelling an in-flight readiness probe releases its acquired provider session", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.save(f.input, "admin", Effect.void);
    const entered = yield* Deferred.make<void>();
    f.onProbe(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)));
    const released = f.releases();
    const fiber = yield* f.service
      .readiness(
        { id: f.input.id, expectedVersion: 1, repository: "owner/repo", threadId: null },
        Effect.void,
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(fiber);
    expect(f.releases()).toBe(released + 1);
    expect(f.terminalCalls()).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);
