import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import {
  AuthEnvironmentMaintainScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import {
  UPDATE_ACTIVITY_ROUTE,
  UPDATE_FENCE_ROUTE,
  UPDATE_PROGRESS_ROUTE,
  UpdateFenceLease,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter } from "effect/http";
import {
  EnvironmentAuth,
  ServerAuthMissingCredentialError,
  ServerAuthInvalidCredentialError,
} from "../../auth/EnvironmentAuth.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { UpdateHttpRoutes } from "./http.ts";
import { UpdateToolkit, updateHandlers } from "./mcp.ts";
import { UpdateHandoff } from "./UpdateHandoff.ts";
import { UpdatePlans } from "./UpdatePlans.ts";
import { updateBoundaryFixture } from "./updateBoundaries.testkit.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeLease = Schema.decodeUnknownEffect(UpdateFenceLease);

it.effect(
  "HTTP separates activity reads from maintenance and refuses malformed mutation bodies",
  () =>
    Effect.gen(function* () {
      const f = yield* updateBoundaryFixture();
      yield* Ref.set(f.threads, [liveThreadShell(ThreadId.make("busy"))]);
      yield* Effect.gen(function* () {
        const plans = yield* UpdatePlans;
        const handoff = yield* UpdateHandoff;
        const runtime = Context.make(UpdatePlans, plans).pipe(
          Context.add(UpdateHandoff, handoff),
        ) as Context.Context<ForkServices>;
        let scopes: ReadonlyArray<AuthEnvironmentScope> = [];
        let authFailure: "missing" | "invalid" | null = "missing";
        const app = UpdateHttpRoutes.pipe(
          Layer.provide(Layer.succeed(ForkRuntime, runtime)),
          HttpRouter.provideRequest(
            Layer.merge(
              NodeHttpPlatform.layer,
              Layer.mock(EnvironmentAuth)({
                authenticateHttpRequest: () =>
                  Effect.gen(function* () {
                    if (authFailure === "missing")
                      return yield* new ServerAuthMissingCredentialError({});
                    if (authFailure === "invalid")
                      return yield* new ServerAuthInvalidCredentialError({});
                    return { subject: "synthetic-client", scopes } as never;
                  }),
              }),
            ),
          ),
          Layer.provide(NodeServices.layer),
        );
        const web = HttpRouter.toWebHandler(app, { disableLogger: true });
        yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
        const send = (route: string, body = "{}", headers: Record<string, string> = {}) =>
          Effect.promise(() =>
            web.handler(
              new Request(`http://localhost${route}`, {
                method: "POST",
                headers: { "content-type": "application/json", ...headers },
                body,
              }),
            ),
          );
        assert.equal((yield* send(UPDATE_ACTIVITY_ROUTE)).status, 401);
        authFailure = "invalid";
        assert.equal((yield* send(UPDATE_FENCE_ROUTE)).status, 401);
        authFailure = null;
        assert.equal((yield* send(UPDATE_ACTIVITY_ROUTE)).status, 403);
        scopes = [AuthOrchestrationReadScope];
        const activity = yield* send(UPDATE_ACTIVITY_ROUTE);
        assert.equal(activity.status, 200);
        assert.equal(activity.headers.get("cache-control"), "no-store");
        assert.deepEqual(yield* Effect.promise(() => activity.json()), {
          waitingAgents: 1,
          plan: null,
        });
        assert.equal(
          (yield* send(UPDATE_FENCE_ROUTE, encodeJson({ action: "acquire", owner: "owner" })))
            .status,
          403,
        );
        assert.equal(
          (yield* send(UPDATE_PROGRESS_ROUTE, encodeJson({ planId: "none", waitingAgents: 0 })))
            .status,
          403,
        );
        scopes = [AuthEnvironmentMaintainScope];
        assert.equal((yield* send(UPDATE_ACTIVITY_ROUTE)).status, 403);
        for (const body of [
          "not-json",
          "{}",
          encodeJson({ action: "other" }),
          encodeJson({ action: "release", leaseId: "" }),
        ])
          assert.equal((yield* send(UPDATE_FENCE_ROUTE, body)).status, 400);
        const valid = encodeJson({ action: "acquire", owner: "valid" });
        assert.equal((yield* send(UPDATE_FENCE_ROUTE, valid + " ".repeat(4097))).status, 413);
        assert.equal(
          (yield* send(
            UPDATE_FENCE_ROUTE,
            encodeJson({ action: "acquire", owner: "valid", note: "é".repeat(2200) }),
          )).status,
          413,
        );
        assert.equal(
          (yield* send(UPDATE_FENCE_ROUTE, valid, { "content-length": "4097" })).status,
          413,
        );
        yield* Ref.set(f.threads, []);
        const acquired = yield* send(
          UPDATE_FENCE_ROUTE,
          encodeJson({ action: "acquire", owner: "owner" }),
        );
        assert.equal(acquired.status, 200);
        const lease = yield* Effect.promise(() => acquired.json()).pipe(
          Effect.flatMap(decodeLease),
        );
        assert.isNotNull(lease.leaseId);
        assert.isNull((yield* handoff.acquire("competitor")).leaseId);
        assert.equal(
          (yield* send(
            UPDATE_FENCE_ROUTE,
            encodeJson({ action: "release", leaseId: lease.leaseId }),
          )).status,
          200,
        );
        const armed = yield* plans.arm("0.1.1");
        assert.isNotNull(armed.plan);
        for (const body of [
          "not-json",
          encodeJson({ planId: armed.plan!.id, waitingAgents: -1 }),
          encodeJson({ planId: armed.plan!.id, waitingAgents: "unknown" }),
        ])
          assert.equal((yield* send(UPDATE_PROGRESS_ROUTE, body)).status, 400);
        assert.equal(
          (yield* send(
            UPDATE_PROGRESS_ROUTE,
            encodeJson({ planId: armed.plan!.id, waitingAgents: null }),
          )).status,
          200,
        );
        assert.isNull(yield* handoff.waiting(armed.plan!.id));
        assert.isNull((yield* plans.status).waitingAgents);
        assert.equal(
          (yield* send(
            UPDATE_PROGRESS_ROUTE,
            encodeJson({ planId: armed.plan!.id, waitingAgents: 3 }),
          )).status,
          200,
        );
        assert.equal(yield* handoff.waiting(armed.plan!.id), 3);
        assert.equal((yield* plans.status).waitingAgents, 3);
        assert.equal(
          (yield* send(
            UPDATE_PROGRESS_ROUTE,
            encodeJson({ planId: armed.plan!.id, waitingAgents: 0, cancelled: true }),
          )).status,
          200,
        );
        assert.equal((yield* plans.status).plan?.state, "cancelled");
      }).pipe(Effect.provide(f.plans));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([
  { runtimeMode: "full-access" as const, interactionMode: "default" as const, allowed: true },
  {
    runtimeMode: "approval-required" as const,
    interactionMode: "default" as const,
    allowed: false,
  },
  { runtimeMode: "full-access" as const, interactionMode: "plan" as const, allowed: false },
  {
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    clientReadOnly: true,
    allowed: false,
  },
])(
  "MCP update mutations require full/default access ($runtimeMode, $interactionMode, $clientReadOnly)",
  (input) =>
    Effect.gen(function* () {
      const f = yield* updateBoundaryFixture();
      const threadId = ThreadId.make("caller");
      yield* Ref.set(f.threads, [liveThreadShell(threadId)]);
      yield* Effect.gen(function* () {
        const plans = yield* UpdatePlans;
        const toolkit = yield* UpdateToolkit.pipe(
          Effect.provide(
            McpToolAccess.HandlersLayer.layer(updateHandlers).pipe(
              Layer.provide(
                Layer.succeed(
                  ForkRuntime,
                  Context.make(UpdatePlans, plans) as Context.Context<ForkServices>,
                ),
              ),
            ),
          ),
        );
        const readOnly = "clientReadOnly" in input && input.clientReadOnly;
        const scope: McpInvocationScope = {
          environmentId: EnvironmentId.make("synthetic-host"),
          capabilities: new Set(["orchestration"]),
          issuedAt: 0,
          requestNamespace: "update-test",
          thread: readOnly
            ? undefined
            : {
                threadId,
                providerSessionId: "synthetic-session",
                providerInstanceId: ProviderInstanceId.make("codex"),
              },
          client: readOnly
            ? { sessionId: "reader", label: "Reader", access: "read-only" }
            : undefined,
        };
        const invoke = (
          name: "loom_updates_status" | "loom_updates_arm" | "loom_updates_cancel",
          values: Record<string, unknown>,
        ) =>
          toolkit.handle(name, values).pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provide(
              Layer.mock(ThreadManagementService)({
                getThreadShell: () => Effect.succeed(liveThreadShell(threadId, input)),
              }),
            ),
          );
        yield* invoke("loom_updates_status", {});
        if (input.allowed) {
          yield* invoke("loom_updates_arm", { targetVersion: "0.1.1" });
          const armed = yield* plans.status;
          assert.isNotNull(armed.plan);
          yield* invoke("loom_updates_cancel", { id: armed.plan!.id });
          assert.equal((yield* plans.status).plan?.state, "cancelled");
        } else {
          for (const [name, values] of [
            ["loom_updates_arm", { targetVersion: "0.1.1" }],
            ["loom_updates_cancel", { id: "not-armed" }],
          ] as const)
            assert.propertyVal(
              yield* invoke(name, values).pipe(Effect.flip),
              "code",
              "capability_denied",
            );
          assert.equal(yield* Ref.get(f.writes), 0);
        }
      }).pipe(Effect.provide(f.plans));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
