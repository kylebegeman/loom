import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultGitHubError,
  VaultGitHubRun,
  VaultGitHubTerminalRun,
  VaultGitHubTerminalResult,
  VaultGitHubReadinessInput,
  VaultGitHubReadiness,
  VaultGitHubResult,
  VaultGitHubInfo,
  VaultGitHubTarget,
  VaultGitHubTestResult,
  VaultItemId,
  VaultItemChange,
  VaultItemSummary,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as VaultAccess from "./VaultAccess.ts";
const failure = Schema.Union([VaultError, VaultGitHubError, OrchestratorMcpFailure]),
  dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultGitHubToolkit = Toolkit.make(
  Tool.make("loom_vault_github_exec", {
    description:
      "Run an explicit noninteractive gh or Git HTTPS argv on the Loom server using a selected Vault connection/version/repository. Active full-access/default thread only with exact use grant. gh supports repo view and PR/issue operations; git supports ls-remote, fetch, push, clone. Use origin or the selected HTTPS URL. No shell, account commands, extensions, SSH agents or persistent terminal login. Credentials are scoped to the child; writes are never retried. Inspect after an unknown outcome.",
    parameters: VaultGitHubTerminalRun,
    success: VaultGitHubTerminalResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_github_readiness", {
    description:
      "Read-only GitHub API, GH CLI and Git HTTPS probes in the Loom server context. Agent callers check their own current run and use grant; administrators may name a thread or use null for host-only checks. No prompt credentials or persistent terminal login. Results expire after 60 seconds.",
    parameters: VaultGitHubReadinessInput,
    success: VaultGitHubReadiness,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_github", {
    description:
      "Run a documented GH operation on the Loom server with a dedicated Vault GitHub connection and operation-scoped token. Requires this authenticated full-access/default active run, current item version, repository allowlist and exact use grant for https://github.com/owner/repo. Supported actions: repo-view, pr-list, issue-list, pr-view/issue-view/pr-checks with number; pr-comment/issue-comment with number/body; issue-create with title/body. No raw gh argv, tokens, ambient GitHub login or SSH agents. Writes may have completed after a timeout; inspect before retrying. Does not configure the provider terminal or Git HTTPS.",
    parameters: VaultGitHubRun,
    success: VaultGitHubResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_github_info", {
    description:
      "Inspect safe metadata of a GitHub connection. Agents need inspect permission; administrator clients may inspect. No credentials.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultGitHubInfo,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_github_connections", {
    description:
      "List this environment's GitHub connections without credentials. Administrator clients only. Continue through sparse pages with nextCursor.",
    parameters: Schema.Struct({ cursor: Schema.NullOr(VaultItemId) }),
    success: Schema.Struct({
      items: Schema.Array(VaultGitHubInfo),
      nextCursor: Schema.NullOr(VaultItemId),
    }),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_github_test", {
    description:
      "Test current GitHub credentials against an allowlisted repository through the API. Human full-access administrators only. App tokens are freshly issued. Does not prove Git HTTPS or gh installation.",
    parameters: VaultGitHubTarget,
    success: VaultGitHubTestResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_github_change", {
    description:
      "Disconnect (archive), restore or delete a dedicated GitHub connection as a human administrator. Local disconnection blocks new use; provider-side App/token revocation is separate. Existing issued tokens may remain valid. Use current item version and a stable operation ID.",
    parameters: VaultItemChange,
    success: VaultItemSummary,
    failure,
    dependencies,
  }),
);
export const vaultGitHubHandlers = McpToolAccess.toLayer(
  VaultGitHubToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const caller = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (!scope.thread && scope.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
      return scope;
    });
    const admin = caller.pipe(
      Effect.flatMap((scope) =>
        scope.thread ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.succeed(scope),
      ),
    );
    return {
      loom_vault_github_exec: McpToolAccess.writesEnvironment((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            scope.thread
              ? onHost(
                  Effect.flatMap(VaultGitHub.VaultGitHub, (service) =>
                    service.terminal(input, scope.thread!.threadId),
                  ),
                )
              : Effect.fail(new VaultError({ reason: "denied" })),
          ),
        ),
      ),
      loom_vault_github_readiness: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const scope = yield* caller,
            context = yield* Effect.context<Effect.Services<typeof check>>();
          if (scope.thread && input.threadId !== scope.thread.threadId)
            return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(VaultGitHub.VaultGitHub, (service) =>
              service.readiness(
                input,
                check.pipe(
                  Effect.provide(context),
                  Effect.asVoid,
                  Effect.mapError(() => new VaultError({ reason: "denied" })),
                ),
              ),
            ),
          );
        }),
      ),
      loom_vault_github: McpToolAccess.writesEnvironment((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            scope.thread
              ? onHost(
                  Effect.flatMap(VaultGitHub.VaultGitHub, (service) =>
                    service.run(input, scope.thread!.threadId),
                  ),
                )
              : Effect.fail(new VaultError({ reason: "denied" })),
          ),
        ),
      ),
      loom_vault_github_info: McpToolAccess.reads((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            onHost(
              Effect.gen(function* () {
                if (scope.thread)
                  yield* Effect.flatMap(VaultAccess.VaultAccess, (a) =>
                    a.require(scope.thread!.threadId, input.id, "inspect", null),
                  );
                return yield* Effect.flatMap(VaultGitHub.VaultGitHub, (g) => g.info(input.id));
              }),
            ),
          ),
        ),
      ),
      loom_vault_github_connections: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(Effect.flatMap(VaultGitHub.VaultGitHub, (g) => g.list(input.cursor))),
          ),
        ),
      ),
      loom_vault_github_test: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          yield* admin;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          return yield* onHost(
            Effect.flatMap(VaultGitHub.VaultGitHub, (g) =>
              g.test(
                input,
                check.pipe(
                  Effect.provide(context),
                  Effect.asVoid,
                  Effect.mapError(() => new VaultError({ reason: "denied" })),
                ),
              ),
            ),
          );
        }),
      ),
      loom_vault_github_change: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const scope = yield* admin;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          return yield* onHost(
            Effect.flatMap(VaultGitHub.VaultGitHub, (g) =>
              g.change(
                input,
                `client:${scope.client!.sessionId}`,
                check.pipe(
                  Effect.provide(context),
                  Effect.asVoid,
                  Effect.mapError(() => new VaultError({ reason: "denied" })),
                ),
              ),
            ),
          );
        }),
      ),
    };
  }),
);
