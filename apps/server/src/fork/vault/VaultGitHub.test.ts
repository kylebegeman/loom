import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as RepositoryTransport from "./GitHubRepositoryTransport.ts";
import * as VaultConnections from "./VaultConnections.ts";
import { newerVaultRun, vaultRun } from "./VaultActiveRun.testkit.ts";
import * as GitHubTerminal from "./GitHubTerminal.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  VaultError,
  VaultGitHubError,
  vaultGitHubDestination,
  type VaultGitHubSave,
  type VaultApprovalRetryInput,
} from "@t3tools/contracts/fork";
import {
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
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
import * as AccountVaultClient from "./AccountVaultClient.ts";
import * as VaultHealth from "./VaultHealth.ts";
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
  let expiresAt: string | null = null;
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
        return { account, token: Redacted.make("synthetic-operation-token"), expiresAt };
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
  let repositoryCalls = 0;
  let beforeRepository: Effect.Effect<void> = Effect.void;
  const repositoryTransport = Layer.succeed(RepositoryTransport.GitHubRepositoryTransport, {
    execute: (input) =>
      beforeRepository.pipe(
        Effect.andThen(input.authorize),
        Effect.andThen(
          Effect.sync(() => {
            repositoryCalls++;
            return {
              code: ChildProcessSpawner.ExitCode(0),
              stdout: "",
              stderr: "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            } as const;
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
  let upstreamMain = "a".repeat(40),
    upstreamStatus = 204;
  let upstreamRuns: Array<{
    id: number;
    run_attempt: number;
    status: string;
    conclusion: string | null;
    head_sha: string;
    html_url: string;
    display_title: string;
    created_at: string;
  }> = [];
  const upstreamKnownRuns = new Map<
    number,
    (typeof upstreamRuns)[number] & { workflow_id: number; head_branch?: string }
  >();
  let beforeUpstream = (_url: string) => {};
  const upstreamRequests: Array<{ method: string; url: string; body: unknown }> = [];
  const upstreamHttp = HttpClient.make((request) => {
    beforeUpstream(request.url);
    const body =
      request.body._tag === "Uint8Array"
        ? (JSON.parse(new TextDecoder().decode(request.body.body)) as unknown)
        : null;
    upstreamRequests.push({ method: request.method, url: request.url, body });
    const knownRunId = new URL(request.url).pathname.match(/\/actions\/runs\/([0-9]+)$/)?.[1];
    const response =
      request.url.endsWith("/dispatches") || request.url.endsWith("/rerun-failed-jobs")
        ? new Response(null, { status: upstreamStatus })
        : request.url.endsWith("/actions/workflows/loom-upstream.yml")
          ? Response.json({ id: 12, path: ".github/workflows/loom-upstream.yml" })
          : knownRunId !== undefined
            ? upstreamKnownRuns.has(Number(knownRunId))
              ? Response.json(upstreamKnownRuns.get(Number(knownRunId)))
              : new Response(null, { status: 404 })
            : request.url.endsWith("/git/ref/heads/main")
              ? Response.json({ object: { sha: upstreamMain } })
              : request.url.includes("/git/ref/tags/")
                ? Response.json({
                    ref: "refs/tags/v1.2.3-nightly.20261031.1",
                    object: { sha: "b".repeat(40) },
                  })
                : Response.json({
                    workflow_runs: upstreamRuns.filter((run) => {
                      const status = new URL(request.url).searchParams.get("status");
                      return status === null || run.status === status;
                    }),
                  });
    return Effect.succeed(HttpClientResponse.fromWeb(request, response));
  });
  const health = yield* VaultHealth.VaultHealth.pipe(
    Effect.provide(VaultHealth.layer.pipe(Layer.provide(Layer.succeedContext(f.context)))),
  );
  let accountTerminal:
    | AccountVaultClient.AccountVaultClient["Service"]["terminalCredential"]
    | null = null;
  let accountResolve: AccountVaultClient.AccountVaultClient["Service"]["execute"] | null = null;
  let accountRun: AccountVaultClient.AccountVaultClient["Service"]["github"] | null = null;
  const service = yield* VaultGitHub.VaultGitHub.pipe(
    Effect.provide(
      VaultGitHub.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeedContext(f.context),
            Layer.mock(AccountVaultClient.AccountVaultClient)({
              available: Effect.sync(() => accountRun !== null),
              terminalCredential: (input, threadId) =>
                accountTerminal
                  ? accountTerminal(input, threadId)
                  : Effect.fail(new VaultError({ reason: "unavailable" })),
              execute: (input, threadId) =>
                accountResolve
                  ? accountResolve(input, threadId)
                  : Effect.fail(new VaultError({ reason: "unavailable" })),
              github: (input, threadId) =>
                Effect.suspend(() =>
                  accountRun
                    ? accountRun(input, threadId)
                    : Effect.fail(new VaultError({ reason: "unavailable" })),
                ),
            }),
            Layer.succeed(VaultHealth.VaultHealth, health),
            transport,
            cli,
            terminal,
            repositoryTransport,
            Layer.succeed(HttpClient.HttpClient, upstreamHttp),
          ),
        ),
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
    routeTerminal: (
      terminal: NonNullable<typeof accountTerminal>,
      resolve: NonNullable<typeof accountResolve>,
    ) => {
      accountTerminal = terminal;
      accountResolve = resolve;
    },
    routeAccount: (run: NonNullable<typeof accountRun>) => {
      accountRun = run;
    },
    health,
    upstreamRequests,
    setUpstreamMain: (sha: string) => {
      upstreamMain = sha;
    },
    setUpstreamRuns: (runs: typeof upstreamRuns) => {
      upstreamRuns = runs;
    },
    setUpstreamKnownRun: (
      run: (typeof upstreamRuns)[number] & { workflow_id: number; head_branch?: string },
    ) => {
      upstreamKnownRuns.set(run.id, run);
    },
    setUpstreamStatus: (status: number) => {
      upstreamStatus = status;
    },
    beforeUpstream: (run: typeof beforeUpstream) => {
      beforeUpstream = run;
    },
    setExpiry: (value: string | null) => {
      expiresAt = value;
    },
    input,
    onProbe: (effect: Effect.Effect<void>) => {
      beforeProbe = effect;
    },
    repositoryCalls: () => repositoryCalls,
    beforeRepository: (effect: Effect.Effect<void>) => {
      beforeRepository = effect;
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
const deps = Layer.merge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer), memoryVault);
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
      expect((yield* list(scope))[0]).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
      expect((yield* list(admin))[0]?.result).toMatchObject({ items: [saved] });
      const inspect = (caller = scope) =>
        toolkit
          .handle("loom_vault_github_info", { id: f.input.id })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* inspect())[0]).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
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
      expect((yield* run(admin))[0]).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
      expect(
        (yield* run({
          ...scope,
          thread: { ...scope.thread!, providerInstanceId: ProviderInstanceId.make("wrong") },
        }))[0],
      ).toMatchObject({ isFailure: true, result: { _tag: "OrchestratorMcpFailure" } });
      expect(
        (yield* list({ ...admin, client: { ...admin.client!, access: "read-only" } }))[0],
      ).toMatchObject({ isFailure: true, result: { _tag: "VaultError", reason: "denied" } });
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
      expect((yield* exec(admin))[0]).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
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
      expect((yield* readiness)[0]).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
      expect(f.calls()).toBe(0);
      expect(f.terminalCalls()).toBe(1);
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

it.effect(
  "executes an explicit GitHub API retry only through current timed approval and connector checks",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "human", Effect.void);
      const requestId = yield* f.id;
      const target = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        operation: { action: "repo-view" as const },
      };
      expect((yield* f.service.run(target, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(0);
      yield* f.access.approvalCreate(
        {
          id: requestId,
          threadId: f.threadId,
          itemId: f.input.id,
          action: "use",
          destination: vaultGitHubDestination(target.repository),
        },
        `thread:${f.threadId}`,
        Effect.void,
      );
      yield* f.access.approvalChange(
        {
          id: requestId,
          operationId: yield* f.id,
          expectedRevision: 1,
          expectedPolicyRevision: 0,
          decision: "approve",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      const retry: VaultApprovalRetryInput = {
        id: requestId,
        waitingOperationId: requestId,
        expectedRevision: 2,
        previousOutcome: "not-started",
        operation: { kind: "github-api", input: target },
      };
      expect(yield* f.access.approvalPrepareRetry(retry, f.threadId)).toMatchObject({
        retryState: "policy-valid-recheck-adapter",
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(f.calls()).toBe(0);
      expect((yield* f.service.run(target, f.threadId)).stdout).toBe("Synthetic GH result");
      expect(f.calls()).toBe(1);
      yield* f.access.approvalChange(
        {
          id: requestId,
          operationId: yield* f.id,
          expectedRevision: 2,
          expectedPolicyRevision: 1,
          decision: "revoke",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      expect((yield* f.service.run(target, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "rechecks GitHub runtime withdrawal after preparation and before a synthetic API side effect",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "human", Effect.void);
      const requestId = yield* f.id;
      yield* f.access.approvalCreate(
        {
          id: requestId,
          threadId: f.threadId,
          itemId: f.input.id,
          action: "use",
          destination: vaultGitHubDestination("owner/repo"),
        },
        `thread:${f.threadId}`,
        Effect.void,
      );
      yield* f.access.approvalChange(
        {
          id: requestId,
          operationId: yield* f.id,
          expectedRevision: 1,
          expectedPolicyRevision: 0,
          decision: "approve",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      const target = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        operation: { action: "issue-comment" as const, number: 1, body: "Synthetic only" },
      };
      const retry: VaultApprovalRetryInput = {
        id: requestId,
        waitingOperationId: requestId,
        expectedRevision: 2,
        previousOutcome: "not-started",
        operation: { kind: "github-api", input: target },
      };
      expect((yield* f.access.approvalPrepareRetry(retry, f.threadId)).retryState).toBe(
        "policy-valid-recheck-adapter",
      );
      f.onSession(() => {
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      });
      expect((yield* f.service.run(target, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(0);
      expect(
        (yield* f.access.approvalPrepareRetry({ ...retry, previousOutcome: "unknown" }, f.threadId))
          .canExecute,
      ).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect.each(["cancelled", "completed"] as const)(
  "executes the active GitHub run after a newer %s turn",
  (status) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      yield* allowTerminal(f);
      newerVaultRun(f.state, status);
      expect(f.state.thread.status).toBe(status);
      const input = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
      expect(
        (yield* f.service.readiness({ ...input, threadId: f.threadId }, Effect.void)).grant,
      ).toBe("ready");
      expect(
        (yield* f.service.terminal(
          { ...input, command: { tool: "git", argv: ["fetch", "origin"] } },
          f.threadId,
        )).exitCode,
      ).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect("refuses a non-running or missing actual run despite a running shell summary", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.save(f.input, "admin", Effect.void);
    yield* allowTerminal(f);
    newerVaultRun(f.state, "cancelled");
    f.state.thread = { ...f.state.thread, status: "running" };
    const input = {
      id: f.input.id,
      expectedVersion: 1,
      repository: "owner/repo",
      command: { tool: "git" as const, argv: ["fetch", "origin"] },
    };
    for (const status of [
      "preparing",
      "starting",
      "waiting",
      "completed",
      "cancelled",
      "interrupted",
    ] as const) {
      f.state.runs[0] = { ...f.state.runs[0]!, status };
      expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
    }
    f.state.runs = f.state.runs.slice(1);
    expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
    expect(f.terminalCalls()).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "keeps authorized GitHub delivery bound to the same active run while a follow-up is queued",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const repository = "owner/repo";
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: (yield* f.access.snapshot).revision,
          change: {
            type: "save",
            grant: {
              id: yield* f.id,
              label: "Queued-run GitHub",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.input.id],
              actions: ["use"],
              projectId: null,
              destination: vaultGitHubDestination(repository),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      const input = {
        id: f.input.id,
        expectedVersion: 1,
        repository,
        operation: { action: "pr-list" as const },
      };
      f.state.runs.push(vaultRun(f.state.thread));
      f.state.thread = { ...f.state.thread, status: "queued" };
      expect((yield* f.service.run(input, f.threadId)).stdout).toBe("Synthetic GH result");
      expect(f.calls()).toBe(1);
      f.state.thread = { ...f.state.thread, status: "waiting", activeRunId: null };
      expect((yield* f.service.run(input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.calls()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect.each([
  { argv: ["release", "create", "v1", "--notes", "fixed", "--draft"] },
  { argv: ["release", "upload", "v1", "dist/app.zip"] },
  { argv: ["workflow", "run", "release.yml", "-f", "version=v1"] },
  { argv: ["run", "view", "39835152512", "--json", "conclusion"] },
])("publication commands preserve the exact current-run repository grant: %j", ({ argv }) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.save(f.input, "admin", Effect.void);
    const input = {
      id: f.input.id,
      expectedVersion: 1,
      repository: "owner/repo",
      command: { tool: "gh" as const, argv },
    };
    expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
    expect(f.terminalCalls()).toBe(0);
    yield* allowTerminal(f);
    expect((yield* f.service.terminal(input, f.threadId)).exitCode).toBe(0);
    expect(f.terminalCalls()).toBe(1);
    expect(
      (yield* f.service
        .terminal({ ...input, repository: "other/repo" }, f.threadId)
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    f.state.thread = { ...f.state.thread, providerInstanceId: ProviderInstanceId.make("changed") };
    expect((yield* f.service.terminal(input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
    expect(f.terminalCalls()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "retains credentials for repository edits, checks versions and enforces owner-only capacity",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const { credential: _credential, ...input } = f.input;
      expect((yield* f.service.save(input, "admin", Effect.void).pipe(Effect.flip)).reason).toBe(
        "invalid-input",
      );
      yield* f.service.save(f.input, "admin", Effect.void);
      const edit = {
        ...input,
        expectedVersion: 1,
        operationId: yield* f.id,
        repositories: ["owner/repo", "owner/new"],
      };
      const saved = yield* f.service.save(edit, "admin", Effect.void);
      expect(saved.repositories).toEqual(["owner/new", "owner/repo"]);
      const raw = yield* Context.get(f.context, VaultCore.VaultCore).reveal({
        id: input.id,
        expectedVersion: 2,
      });
      expect(Redacted.value(raw.value)).toContain("synthetic-private-token");
      let staleSessions = 0;
      f.onSession(() => {
        staleSessions++;
      });
      expect(yield* f.service.save(edit, "admin", Effect.void)).toEqual(saved);
      expect(staleSessions).toBe(0);
      expect(
        (yield* f.service
          .save({ ...edit, operationId: yield* f.id }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const large = {
        ...edit,
        operationId: yield* f.id,
        expectedVersion: 2,
        repositories: Array.from({ length: 100 }, (_, i) => `owner/repo${i}`),
      };
      expect((yield* f.service.save(large, "admin", Effect.void).pipe(Effect.flip)).reason).toBe(
        "invalid-input",
      );
      const policy = yield* f.access.snapshot;
      yield* f.access.setOwnerPolicy(
        { operationId: yield* f.id, expectedRevision: policy.revision, mode: "owner-trusted" },
        "admin",
        Effect.void,
      );
      expect((yield* f.service.save(large, "admin", Effect.void)).repositories).toHaveLength(100);
      const resolved = yield* Context.get(f.context, VaultConnections.VaultConnections).resolve(
        { kind: "github", connection: { resource: "Loom GitHub QA" }, repository: "owner/repo99" },
        f.threadId,
      );
      expect(resolved.state).toBe("ready");
      expect(resolved.selected?.repositories).toHaveLength(100);
      const denied = yield* f.service
        .test({ id: input.id, expectedVersion: 3, repository: "owner/missing" }, Effect.void)
        .pipe(Effect.flip);
      expect(denied).toMatchObject({
        reason: "repository-denied",
        repair: { id: input.id, repository: "owner/missing" },
      });
      f.deny();
      expect(
        (yield* f.service
          .save({ ...large, operationId: yield* f.id, expectedVersion: 3 }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("repository-denied");
      expect((yield* f.service.info(input.id)).item.version).toBe(3);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect("learns personal-token expiry on save and use without rewriting unchanged rules", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.setExpiry("2099-01-01T00:00:00.000Z");
    yield* f.service.save(f.input, "admin", Effect.void);
    let snapshot = yield* f.health.snapshot;
    expect(snapshot.rules.find((rule) => rule.itemId === f.input.id)?.expiresAt).toBe(
      Date.parse("2099-01-01T00:00:00.000Z"),
    );
    const revision = snapshot.revision;
    const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
    yield* f.service.test(target, Effect.void);
    expect((yield* f.health.snapshot).revision).toBe(revision);
    f.setExpiry("2099-02-01T00:00:00.000Z");
    yield* f.service.test(target, Effect.void);
    snapshot = yield* f.health.snapshot;
    expect(snapshot.rules[0]?.expiresAt).toBe(Date.parse("2099-02-01T00:00:00.000Z"));
    f.setExpiry(null);
    yield* f.service.test(target, Effect.void);
    expect((yield* f.health.snapshot).revision).toBe(snapshot.revision);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "binds upstream workflow access to fixed API paths, current credentials and explicit authority",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const target = { id: f.input.id, expectedVersion: 1, repository: "Owner/Repo" };
      const run = {
        id: 7,
        run_attempt: 1,
        status: "completed",
        conclusion: "failure",
        head_sha: "a".repeat(40),
        html_url: "https://github.com/owner/repo/actions/runs/7",
        display_title: "Upstream nightly",
        created_at: "2026-10-31T00:00:00Z",
      };
      f.setUpstreamRuns([run]);
      const observed = yield* f.service.upstreamWorkflow(target, { action: "status" }, Effect.void);
      expect(observed.snapshot.runs[0]).toMatchObject({ id: 7, attempt: 1, url: run.html_url });
      expect(observed.httpStatus).toBeNull();
      const request = {
        action: "dispatch" as const,
        targetTag: "v1.2.3-nightly.20261031.1",
        expectedMainSha: "a".repeat(40),
        requestId: "c".repeat(64),
      };
      const leases = f.releases();
      expect((yield* f.service.upstreamWorkflow(target, request, Effect.void)).httpStatus).toBe(
        204,
      );
      expect(f.releases()).toBe(leases + 1);
      expect(f.upstreamRequests.at(-1)).toEqual({
        method: "POST",
        url: "https://api.github.com/repos/owner/repo/actions/workflows/loom-upstream.yml/dispatches",
        body: {
          ref: "main",
          inputs: {
            target: request.targetTag,
            supervisor_request_id: request.requestId,
            expected_main_sha: request.expectedMainSha,
          },
        },
      });
      expect(
        f.upstreamRequests.some(
          (r) =>
            r.url ===
            "https://api.github.com/repos/pingdotgg/t3code/git/ref/tags/v1.2.3-nightly.20261031.1",
        ),
      ).toBe(true);
      f.setUpstreamStatus(422);
      expect((yield* f.service.upstreamWorkflow(target, request, Effect.void)).httpStatus).toBe(
        422,
      );
      f.setUpstreamStatus(503);
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      expect(JSON.stringify(observed)).not.toContain("synthetic-operation-token");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "refuses upstream dispatch on stale, active, invalid or revoked scope before posting",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
      const request = {
        action: "dispatch" as const,
        targetTag: "v1.2.3-nightly.20261031.1",
        expectedMainSha: "a".repeat(40),
        requestId: "c".repeat(64),
      };
      const denied = Effect.fail(new VaultError({ reason: "denied" }));
      expect(
        (yield* f.service.upstreamWorkflow(target, request, denied).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(f.upstreamRequests).toEqual([]);
      for (const [changed, reason] of [
        [{ ...target, expectedVersion: 2 }, "conflict"],
        [{ ...target, repository: "other/repo" }, "repository-denied"],
      ] as const)
        expect(
          (yield* f.service.upstreamWorkflow(changed, request, Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe(reason);
      expect(
        (yield* f.service
          .upstreamWorkflow(target, { ...request, targetTag: "../main" }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      f.setUpstreamMain("d".repeat(40));
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      f.setUpstreamMain(request.expectedMainSha);
      f.setUpstreamRuns([
        {
          id: 7,
          run_attempt: 1,
          status: "in_progress",
          conclusion: null,
          head_sha: request.expectedMainSha,
          html_url: "https://github.com/owner/repo/actions/runs/7",
          display_title: "Active integration",
          created_at: "2026-10-31T00:00:00Z",
        },
      ]);
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      f.setUpstreamRuns([]);
      f.beforeUpstream((url) => {
        if (url.includes("status=waiting"))
          f.setUpstreamRuns([
            {
              id: 1,
              run_attempt: 1,
              status: "waiting",
              conclusion: null,
              head_sha: request.expectedMainSha,
              html_url: "https://github.com/owner/repo/actions/runs/1",
              display_title: "Older integration waiting for approval",
              created_at: "2026-10-01T00:00:00Z",
            },
          ]);
      });
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      f.beforeUpstream(() => {});
      f.setUpstreamRuns([
        {
          id: 7,
          run_attempt: 1,
          status: "completed",
          conclusion: "success",
          head_sha: request.expectedMainSha,
          html_url: "https://example.test/untrusted-link",
          display_title: "Wrong repository link",
          created_at: "2026-10-31T00:00:00Z",
        },
      ]);
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("invalid-response");
      f.setUpstreamRuns([]);
      let allowed = true;
      f.beforeUpstream((url) => {
        if (url.includes("/git/ref/tags/")) allowed = false;
      });
      const guard = Effect.suspend(() => (allowed ? Effect.void : denied));
      expect(
        (yield* f.service.upstreamWorkflow(target, request, guard).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(f.upstreamRequests.filter((r) => r.method === "POST")).toEqual([]);
      f.beforeUpstream(() => {});
      yield* f.service.change(
        { id: target.id, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
        Effect.void,
      );
      expect(
        (yield* f.service
          .upstreamWorkflow({ ...target, expectedVersion: 2 }, request, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("archived");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "refreshes known upstream runs outside the recent window and refuses another workflow",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
      const saved = {
        id: 42,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        head_sha: "a".repeat(40),
        html_url: "https://github.com/owner/repo/actions/runs/42",
        display_title: "Previously active integration",
        created_at: "2026-10-01T00:00:00Z",
        workflow_id: 12,
      };
      f.setUpstreamRuns(
        Array.from({ length: 30 }, (_, index) => ({
          ...saved,
          id: 100 + index,
          html_url: `https://github.com/owner/repo/actions/runs/${100 + index}`,
          created_at: "2026-10-31T00:00:00Z",
        })),
      );
      f.setUpstreamKnownRun(saved);
      const refreshed = yield* f.service.upstreamWorkflow(
        target,
        { action: "status", runIds: [42] },
        Effect.void,
      );
      expect(refreshed.snapshot.runs).toHaveLength(30);
      expect(refreshed.snapshot.runs[0]).toMatchObject({
        id: 42,
        status: "completed",
        conclusion: "success",
      });
      expect(
        f.upstreamRequests.some(
          (request) => request.url === "https://api.github.com/repos/owner/repo/actions/runs/42",
        ),
      ).toBe(true);
      expect(
        (yield* f.service
          .upstreamWorkflow(target, { action: "status", runIds: [43] }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("repository-denied");
      f.setUpstreamKnownRun({ ...saved, workflow_id: 99 });
      expect(
        (yield* f.service
          .upstreamWorkflow(target, { action: "status", runIds: [42] }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-response");
      const requests = f.upstreamRequests.length;
      for (const runIds of [
        [0],
        [1.5],
        [Number.MAX_SAFE_INTEGER + 1],
        Array.from({ length: 31 }, (_, index) => index + 1),
      ])
        expect(
          (yield* f.service
            .upstreamWorkflow(target, { action: "status", runIds }, Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
      expect(f.upstreamRequests).toHaveLength(requests);
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect("retries only failed jobs of the exact main workflow original attempt", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.save(f.input, "admin", Effect.void);
    const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
    const failed = {
      id: 42,
      run_attempt: 1,
      status: "completed",
      conclusion: "failure",
      head_sha: "a".repeat(40),
      html_url: "https://github.com/owner/repo/actions/runs/42",
      display_title: "Upstream nightly",
      created_at: "2026-10-31T00:00:00Z",
      workflow_id: 12,
      head_branch: "main",
    };
    const request = {
      action: "retry-failed" as const,
      runId: 42,
      expectedAttempt: 1,
      expectedMainSha: failed.head_sha,
    };
    f.setUpstreamKnownRun(failed);
    f.setUpstreamRuns([failed]);
    f.setUpstreamStatus(201);
    expect((yield* f.service.upstreamWorkflow(target, request, Effect.void)).httpStatus).toBe(201);
    expect(f.upstreamRequests.filter((r) => r.method === "POST")).toEqual([
      {
        method: "POST",
        url: "https://api.github.com/repos/owner/repo/actions/runs/42/rerun-failed-jobs",
        body: {},
      },
    ]);
    const postCount = () => f.upstreamRequests.filter((r) => r.method === "POST").length;
    for (const changed of [
      { ...failed, run_attempt: 2 },
      { ...failed, workflow_id: 99 },
      { ...failed, head_branch: "feature" },
      { ...failed, head_sha: "b".repeat(40) },
      { ...failed, conclusion: "success" },
      { ...failed, status: "in_progress", conclusion: null },
    ]) {
      f.setUpstreamKnownRun(changed);
      expect(
        (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(postCount()).toBe(1);
    }
    f.setUpstreamKnownRun(failed);
    f.setUpstreamRuns([
      {
        ...failed,
        id: 43,
        status: "queued",
        conclusion: null,
        html_url: "https://github.com/owner/repo/actions/runs/43",
      },
    ]);
    expect(
      (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(postCount()).toBe(1);
    f.setUpstreamRuns([failed]);
    let mainReads = 0;
    f.beforeUpstream((url) => {
      if (url.endsWith("/git/ref/heads/main") && ++mainReads === 2)
        f.setUpstreamMain("b".repeat(40));
    });
    expect(
      (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(postCount()).toBe(1);
    f.setUpstreamMain(request.expectedMainSha);
    let reads = 0;
    f.beforeUpstream((url) => {
      if (url.endsWith("/actions/runs/42") && ++reads === 2)
        f.setUpstreamKnownRun({ ...failed, run_attempt: 2 });
    });
    expect(
      (yield* f.service.upstreamWorkflow(target, request, Effect.void).pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(postCount()).toBe(1);
    f.beforeUpstream(() => {});
    f.setUpstreamKnownRun(failed);
    let permitted = true;
    f.beforeUpstream((url) => {
      if (url.includes("status=pending")) permitted = false;
    });
    expect(
      (yield* f.service
        .upstreamWorkflow(
          target,
          request,
          Effect.suspend(() =>
            permitted ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
          ),
        )
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(postCount()).toBe(1);
    expect(f.upstreamRequests.some((r) => r.url.includes("/git/ref/tags/"))).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "Library repository operations reauthorize before credential release and release sessions on interruption",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      const target = { id: f.input.id, expectedVersion: 1, repository: "owner/repo" };
      let allowed = true;
      const authorize = Effect.suspend(() =>
        allowed ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
      );
      f.onSession(() => {
        allowed = false;
      });
      const released = f.releases();
      expect(
        (yield* f.service
          .repositoryOperation(target, { kind: "preflight" }, authorize)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(f.repositoryCalls()).toBe(0);
      expect(f.releases()).toBe(released + 1);
      allowed = true;
      f.onSession(() => {});
      const started = yield* Deferred.make<void>();
      f.beforeRepository(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)));
      const running = yield* f.service
        .repositoryOperation(target, { kind: "preflight" }, authorize)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(running);
      expect(f.releases()).toBe(released + 2);
      expect(
        (yield* f.service
          .repositoryOperation({ ...target, expectedVersion: 2 }, { kind: "preflight" }, authorize)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);

it.effect(
  "brokers account GitHub actions and runs terminal commands on the source with scoped credentials",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.save(f.input, "admin", Effect.void);
      yield* f.access.setOwnerPolicy(
        {
          operationId: yield* f.id,
          expectedRevision: (yield* f.access.snapshot).revision,
          mode: "owner-trusted",
        },
        "admin",
        Effect.void,
      );
      let revoked = false;
      const account = {
        lease: {
          sourceEnvironmentId: EnvironmentId.make("source"),
          publisherSessionId: AuthSessionId.make("publisher"),
          authorityId: "authority",
          authorityEpoch: 1,
          keyFingerprint: "a".repeat(64),
          membershipRevision: 1,
          membershipEpoch: 0,
          ownerSubject: "admin",
          expiresAt: Number.MAX_SAFE_INTEGER,
          workload: {
            threadId: ThreadId.make("foreign-thread"),
            runId: RunId.make("foreign-run"),
            projectId: ProjectId.make("foreign-project"),
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
          },
        },
        authorize: Effect.suspend(() =>
          revoked ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        ),
      };
      const input = {
        id: f.input.id,
        expectedVersion: 1,
        repository: "owner/repo",
        operation: { action: "pr-list" as const },
      };
      f.state.thread = { ...f.state.thread, activeRunId: null };
      f.routeAccount((raw) =>
        "id" in raw
          ? f.service.runForAccount(raw, account)
          : Effect.fail(new VaultError({ reason: "invalid-input" })),
      );
      expect(yield* f.service.run(input, f.threadId)).toEqual({
        account: "loom-bot",
        repository: "owner/repo",
        exitCode: 0,
        stdout: "Synthetic GH result",
      });
      expect(
        (yield* f.service
          .runForAccount(input, { ...account, lease: { ...account.lease, ownerSubject: "other" } })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.service
          .runForAccount({ ...input, expectedVersion: 2 }, account)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* f.service
          .runForAccount({ ...input, repository: "other/repo" }, account)
          .pipe(Effect.flip)).reason,
      ).toBe("repository-denied");
      const pin = {
        item: (yield* f.core.inspect(input.id))!,
        kind: "github" as const,
        hostname: "github.com",
        account: "loom-bot",
        repositories: [input.repository],
        repository: input.repository,
        destination: vaultGitHubDestination(input.repository),
      };
      f.state.thread = { ...f.state.thread, activeRunId: RunId.make("source-run") };
      f.routeTerminal(
        (raw) =>
          f.service
            .terminalForAccount(
              { ...raw, id: input.id, expectedVersion: input.expectedVersion },
              account,
            )
            .pipe(
              Effect.map((credential) => ({ kind: "github-terminal" as const, pin, credential })),
            ),
        () =>
          Effect.succeed({
            kind: "resolve",
            report: { state: "ready", selected: pin, choices: [pin], repair: null },
          }),
      );
      const completed = yield* f.service.terminal(
        {
          id: input.id,
          expectedVersion: 1,
          repository: input.repository,
          command: { tool: "gh", argv: ["pr", "list"] },
        },
        f.threadId,
      );
      expect(completed.exitCode).toBe(0);
      expect(f.terminalCalls()).toBe(1);
      f.routeTerminal(
        () =>
          Effect.sync(() => {
            f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement-run") };
            return {
              kind: "github-terminal" as const,
              pin,
              credential: { account: "loom-bot", token: Redacted.make("synthetic-private-token") },
            };
          }),
        () =>
          Effect.succeed({
            kind: "resolve",
            report: { state: "ready", selected: pin, choices: [pin], repair: null },
          }),
      );
      expect(
        yield* f.service
          .terminal(
            {
              id: input.id,
              expectedVersion: 1,
              repository: input.repository,
              command: { tool: "gh", argv: ["pr", "list"] },
            },
            f.threadId,
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "denied" });
      expect(f.terminalCalls()).toBe(1);
      f.state.thread = { ...f.state.thread, activeRunId: null };
      f.onSession(() => {
        revoked = true;
      });
      expect((yield* f.service.runForAccount(input, account).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(f.calls()).toBe(1);
    }).pipe(Effect.provide(deps)),
);
