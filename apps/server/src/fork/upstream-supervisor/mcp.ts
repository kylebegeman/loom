import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  UpstreamSupervisorConfig,
  UpstreamSupervisorConfigInput,
  UpstreamSupervisorDispatchInput,
  UpstreamSupervisorError,
  UpstreamSupervisorReceipt,
  UpstreamSupervisorStatus,
  UpstreamSupervisorStatusInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import {
  assertFullAccess,
  assertLiveCaller,
  readCaller,
  refuseBotRunSpawn,
} from "../../mcp/threadAccess.ts";
import { assertNotLinked } from "../../mcp/linkOrigin.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { withFailureMessages } from "../vault/mcp-failure.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as Upstream from "./UpstreamSupervisor.ts";

const failure = withFailureMessages(
  Schema.Union([UpstreamSupervisorError, OrchestratorMcpFailure]),
);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const UpstreamToolkit = Toolkit.make(
  Tool.make("loom_upstream_status", {
    description:
      "Read the owner-configured upstream supervisor, exact main commit, recent integration runs and durable dispatch receipts for projectId. Only the approved chief login or a full-access administrator client can use its selected GitHub connection. Agent threads cannot use this standing authorization. After a lost dispatch response, inspect this status; unknown is not permission to submit another key. Pass runIds for older known workflow runs. unavailable:true means remote state could not be read. No merge or publication is started.",
    parameters: UpstreamSupervisorStatusInput,
    success: UpstreamSupervisorStatus,
    failure,
    failureMode: "return",
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_upstream_configure", {
    description:
      "Human administrator-only standing authorization for the fixed loom-upstream.yml workflow on main, one selected Vault GitHub item/version/repository, exact project and chief sessionId. Requires a full-access administrator client; agent threads cannot grant standing authority. Use the owner Connections settings. Save disabled until activation is approved. A changed login needs an owner rebind; keep receipts. enabled:false blocks new dispatches. This does not grant general Vault, shell, merge or publisher authority.",
    parameters: UpstreamSupervisorConfigInput,
    success: UpstreamSupervisorConfig,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_upstream_dispatch", {
    description:
      "Request one existing upstream integration workflow for an exact official v* targetTag and expectedMainSha from current status. Requires owner-configured project/chief authorization and an enabled controller. Use a stable clientRequestId; changed inputs or a new key for the same tag/main are refused. Active integrations and stale main block submission. accepted means GitHub accepted dispatch, not merged or released. After unknown or a lost response inspect loom_upstream_status and follow its run; never resend or invent a key. CI retains checks/review/merge and the signed publisher remains separate. A leaf bot cannot dispatch.",
    parameters: UpstreamSupervisorDispatchInput,
    success: UpstreamSupervisorReceipt,
    failure,
    failureMode: "return",
    dependencies,
  }),
);
export const upstreamHandlers = McpToolAccess.toLayer(
  UpstreamToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const actor = Effect.fn("Upstream.mcpActor")(function* () {
      const scope = yield* McpInvocationContext;
      if (scope.thread) return yield* new UpstreamSupervisorError({ reason: "denied" });
      const owner = scope.client?.access === "full-access";
      const check = readCaller().pipe(
        Effect.tap(assertLiveCaller),
        Effect.tap((caller) => assertNotLinked(caller, "control upstream integrations")),
        Effect.tap((caller) =>
          owner
            ? assertFullAccess(caller, "Upstream owner operations require full access.")
            : Effect.void,
        ),
        Effect.asVoid,
        Effect.mapError(() => new UpstreamSupervisorError({ reason: "denied" })),
      );
      const context = yield* Effect.context<Effect.Services<typeof check>>();
      return {
        owner,
        sessionId: scope.client?.sessionId ?? null,
        authorize: check.pipe(Effect.provide(context)),
      } satisfies Upstream.UpstreamSupervisorActor;
    });
    return {
      loom_upstream_status: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const caller = yield* actor();
          return yield* onHost(
            Effect.flatMap(Upstream.UpstreamSupervisor, (service) =>
              service.status(input.projectId, caller, input.runIds),
            ),
          );
        }),
      ),
      loom_upstream_configure: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext;
          if (scope.thread) return yield* new UpstreamSupervisorError({ reason: "denied" });
          const caller = yield* actor();
          return yield* onHost(
            Effect.flatMap(Upstream.UpstreamSupervisor, (service) =>
              service.configure(input, caller),
            ),
          );
        }),
      ),
      loom_upstream_dispatch: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          yield* refuseBotRunSpawn(yield* McpInvocationContext);
          const caller = yield* actor();
          return yield* onHost(
            Effect.flatMap(Upstream.UpstreamSupervisor, (service) =>
              service.dispatch(input, caller),
            ),
          );
        }),
      ),
    };
  }),
);
