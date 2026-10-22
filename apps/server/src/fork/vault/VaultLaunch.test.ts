import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { VaultSshError, vaultGitDestination } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as SshTransport from "./SshTransport.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import * as VaultHealth from "./VaultHealth.ts";
import { VaultSshToolkit, vaultSshHandlers } from "./ssh-mcp.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const command = { expectedVersion: 1, argv: ["/usr/bin/true"], timeoutMs: 8000 };
const transport = Layer.succeed(SshTransport.SshTransport, {
  execute: (input) => input.authorize.pipe(Effect.as({ exitCode: 0, stdout: "ok" })),
});

it.effect.each(["pi", "codex"])(
  "automatically opens, signs and closes %s run operations through authenticated MCP",
  (provider) =>
    Effect.gen(function* () {
      const f = yield* launchFixture(transport);
      f.state.thread = {
        ...f.state.thread,
        providerInstanceId: ProviderInstanceId.make(provider),
        modelSelection: {
          ...f.state.thread.modelSelection,
          instanceId: ProviderInstanceId.make(provider),
        },
      };
      yield* f.grant(f.key.destination);
      const context = Context.add(f.context, VaultLaunch.VaultLaunch, f.launch);
      const toolkit = yield* VaultSshToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultSshHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "launch",
        client: undefined,
        thread: {
          threadId: f.threadId,
          providerInstanceId: ProviderInstanceId.make(provider),
          providerSessionId: "test-session",
        },
      };
      const invoke = (caller = scope) =>
        toolkit
          .handle("loom_vault_ssh_exec", { id: f.itemId, command })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      for (let i = 0; i < 2; i++)
        expect((yield* invoke())[0]?.result).toMatchObject({ exitCode: 0, stdout: "ok" });
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: {
            type: "save",
            grant: {
              id: yield* f.id,
              label: "Git use",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.itemId],
              actions: ["use"],
              projectId: null,
              destination: vaultGitDestination(f.key.target, "team/repo.git"),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      const git = (caller = scope) =>
        toolkit
          .handle("loom_vault_git", {
            id: f.itemId,
            expectedVersion: 1,
            repository: "team/repo.git",
            action: "fetch",
            timeoutMs: 30000,
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* git())[0]?.result).toMatchObject({ exitCode: 0, stdout: "ok" });
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      expect(
        (yield* git({
          ...scope,
          thread: undefined,
          client: { sessionId: "reader", access: "read-only", label: "reader" },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      expect(
        (yield* invoke({
          ...scope,
          thread: undefined,
          client: { sessionId: "admin", access: "full-access", label: "admin" },
        }).pipe(Effect.flip))._tag,
      ).toBe("VaultError");
      expect(
        (yield* invoke({
          ...scope,
          thread: {
            ...scope.thread!,
            providerInstanceId: ProviderInstanceId.make("other-provider"),
          },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      expect((yield* invoke().pipe(Effect.flip))._tag).toBe("OrchestratorMcpFailure");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "uses the current checkout and exact Git destination, rejecting payload tampering and SSH proof reuse",
  () =>
    Effect.gen(function* () {
      let cwd = "";
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  cwd = "kind" in input.command ? input.command.cwd : "";
                }),
              ),
              Effect.as({ exitCode: 0, stdout: "refs" }),
            ),
        }),
      );
      const repository = "team/repo.git",
        destination = vaultGitDestination(f.key.target, repository);
      yield* f.grant(destination);
      f.state.thread = { ...f.state.thread, worktreePath: "/private/project-checkout" };
      const input = {
        id: f.itemId,
        expectedVersion: 1,
        action: "fetch" as const,
        repository,
        timeoutMs: 30000,
      };
      expect((yield* f.launch.git(input, f.threadId)).exitCode).toBe(0);
      expect(cwd).toBe("/private/project-checkout");
      for (const repository of [
        "../repo.git",
        "/srv/../repo.git",
        "-oProxyCommand=x",
        "team//repo.git",
        "team/repo.git;echo bad",
        "ssh://other/repo",
        "team/repo.git\nother",
      ]) {
        expect(
          (yield* f.launch.git({ ...input, repository }, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("invalid-operation");
      }

      expect(
        (yield* f.launch
          .git({ ...input, repository: "other/repo.git" }, f.threadId)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      const session = yield* f.session(destination);
      const git = {
        kind: "git" as const,
        expectedVersion: 1,
        repository,
        cwd,
        action: "fetch" as const,
        timeoutMs: 30000,
      };
      const proof = yield* f.proof(session, git);
      expect(
        (yield* f.ssh.git({ proof, command: { ...git, cwd: "/private/other" } }).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-proof");
      expect((yield* f.ssh.git({ proof, command: git })).exitCode).toBe(0);
      expect((yield* f.ssh.git({ proof, command: git }).pipe(Effect.flip)).reason).toBe(
        "invalid-proof",
      );
      const wrong = yield* f.proof(session, command);
      expect((yield* f.ssh.git({ proof: wrong, command: git }).pipe(Effect.flip)).reason).toBe(
        "invalid-proof",
      );
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect("releases managed sessions after transport failure and cancellation", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let failing = true;
    const f = yield* launchFixture(
      Layer.succeed(SshTransport.SshTransport, {
        execute: (input) =>
          input.authorize.pipe(
            Effect.andThen(
              Effect.suspend(() =>
                failing
                  ? Effect.fail(new VaultSshError({ reason: "failed" }))
                  : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
              ),
            ),
          ),
      }),
    );
    yield* f.grant(f.key.destination);
    yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip);
    expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    failing = false;
    const running = yield* f.launch
      .ssh({ id: f.itemId, command }, f.threadId)
      .pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    expect(yield* f.workloads.list(f.threadId)).toHaveLength(1);
    yield* Fiber.interrupt(running);
    expect(yield* f.workloads.list(f.threadId)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "refuses missing configuration, inactive runs, archived keys and revocation at signing",
  () =>
    Effect.gen(function* () {
      let revoke = () => {};
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            Effect.sync(revoke).pipe(
              Effect.andThen(input.authorize),
              Effect.as({ exitCode: 0, stdout: "ok" }),
            ),
        }),
      );
      yield* f.grant(f.key.destination);
      const unconfigured = yield* VaultLaunch.VaultLaunch.pipe(
        Effect.provide(
          VaultLaunch.layer.pipe(
            Layer.provide(Layer.merge(f.project, Layer.succeedContext(f.context))),
          ),
        ),
        Effect.provideService(BrokerIdentity.BrokerIdentity, f.identity),
        Effect.provideService(HostProcess.Environment, {}),
      );
      expect(
        (yield* unconfigured.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("not-configured");
      f.state.thread = { ...f.state.thread, activeRunId: null };
      expect(
        (yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      f.state.thread = { ...f.state.thread, activeRunId: RunId.make("new-run") };
      revoke = () => {
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      };
      expect(
        (yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      f.state.thread = { ...f.state.thread, runtimeMode: "full-access" };
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      yield* f.core.change(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
        Effect.void,
      );
      expect(
        (yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect("project grants cover fresh scheduled-run threads and stop after revocation", () =>
  Effect.gen(function* () {
    const f = yield* launchFixture(transport);
    yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: 0,
        change: {
          type: "save",
          grant: {
            id: f.grantId,
            label: "Project task access",
            principal: { kind: "project", id: f.state.thread.projectId },
            itemIds: [f.itemId],
            actions: ["use"],
            projectId: f.state.thread.projectId,
            destination: f.key.destination,
            notBefore: 0,
            expiresAt: null,
            parentId: null,
          },
        },
      },
      "admin",
    );
    const taskThread = ThreadId.make("fresh-scheduled-run");
    f.state.thread = {
      ...f.state.thread,
      id: taskThread,
      creationSource: "server",
      createdBy: "system",
      activeRunId: RunId.make("scheduled-run"),
    };
    expect((yield* f.launch.ssh({ id: f.itemId, command }, taskThread)).exitCode).toBe(0);
    yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: 1,
        change: { type: "state", id: f.grantId, state: "revoked" },
      },
      "admin",
    );
    expect(
      (yield* f.launch.ssh({ id: f.itemId, command }, taskThread).pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(yield* f.workloads.list(taskThread)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "attributes SSH and Git timeouts to their recorded host without exposing usernames or remote paths",
  () =>
    Effect.gen(function* () {
      const reports: Array<Parameters<VaultHealth.VaultHealth["Service"]["report"]>[0]> = [];
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.andThen(Effect.fail(new VaultSshError({ reason: "timeout" }))),
            ),
        }),
      );
      const health = Layer.mock(VaultHealth.VaultHealth)({
        report: (report) =>
          Effect.sync(() => {
            reports.push(report);
          }),
      });
      yield* f.grant(f.key.destination);
      expect(
        (yield* f.launch
          .ssh({ id: f.itemId, command }, f.threadId)
          .pipe(Effect.provide(health), Effect.flip)).reason,
      ).toBe("timeout");
      const repository = "team/repo.git";
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: {
            type: "save",
            grant: {
              id: yield* f.id,
              label: "Git outage QA",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.itemId],
              actions: ["use"],
              projectId: null,
              destination: vaultGitDestination(f.key.target, repository),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "fixture-admin",
      );
      expect(
        (yield* f.launch
          .git(
            { id: f.itemId, expectedVersion: 1, action: "fetch", repository, timeoutMs: 30000 },
            f.threadId,
          )
          .pipe(Effect.provide(health), Effect.flip)).reason,
      ).toBe("timeout");
      expect(reports.map((report) => report.outageTarget)).toEqual([
        { kind: "ssh", hostname: f.key.target.hostname, port: f.key.target.port },
        { kind: "ssh", hostname: f.key.target.hostname, port: f.key.target.port },
      ]);
      expect(reports.every((report) => report.category === "outage" && !report.healthy)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
