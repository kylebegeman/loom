import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { HttpRouter } from "effect/http";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerHttpClient from "./BrokerHttpClient.ts";
import * as WorkloadRunner from "./WorkloadRunner.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import { VaultWorkloadHttpRoutes } from "./workload-http.ts";
import { VaultWorkloadToolkit, vaultWorkloadHandlers } from "./workload-mcp.ts";
import { workloadFixture } from "./VaultWorkloads.testkit.ts";

it.effect(
  "opens sessions only for authenticated threads, ignores supplied caller IDs and isolates thread cleanup",
  () =>
    Effect.gen(function* () {
      const f = yield* workloadFixture,
        context = yield* Layer.build(f.layer);
      const toolkit = yield* VaultWorkloadToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultWorkloadHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "workloads",
        thread: {
          threadId: f.threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "session",
        },
        client: undefined,
      };
      const supplied = { ...f.input, threadId: ThreadId.make("forged") };
      const open = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_workload_open", supplied)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, caller),
            Effect.provide(f.layer),
          );
      expect(
        (yield* open({
          ...scope,
          thread: undefined,
          client: { sessionId: "admin", label: "Admin", access: "full-access" },
        }).pipe(Effect.flip))._tag,
      ).toBe("VaultError");
      expect(
        (yield* open({
          ...scope,
          client: { sessionId: "reader", label: "Reader", access: "read-only" },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      const response = yield* open(scope);
      expect(response[0]?.result).toMatchObject({ threadId: f.threadId, itemId: f.input.itemId });
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(BrokerCrypto.layer, NodeServices.layer))),
);

it.live(
  "checks and releases through signed HTTP without admin credentials and detects response binding changes",
  () =>
    Effect.gen(function* () {
      const f = yield* workloadFixture,
        context = yield* Layer.build(f.layer),
        service = Context.get(context, VaultWorkloads.VaultWorkloads);
      const session = yield* service.open(f.input, f.threadId);
      const web = HttpRouter.toWebHandler(
        VaultWorkloadHttpRoutes.pipe(
          Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          HttpRouter.provideRequest(NodeHttpPlatform.layer),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      let tamper = false;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.has("authorization")).toBe(false);
        const response = await web.handler(request);
        if (tamper && request.url.endsWith("/check") && response.status === 200) {
          await response.arrayBuffer();
          return Response.json({
            session: { ...session, destination: "ssh://other" },
            checkedAt: 0,
            credentialDelivery: "unsupported",
          });
        }
        return response;
      };
      const identities = Layer.mock(BrokerIdentity.BrokerIdentity)({
        read: (directory) =>
          Effect.succeed({
            ...(directory === "machine" ? f.machine : f.workload),
            protocol: 1 as const,
            directory,
            platform: "linux" as const,
          }),
        connection: () =>
          Effect.succeed({
            protocol: 1 as const,
            origin: "http://127.0.0.1:12345",
            environmentId: f.environmentId,
            machineId: f.input.machineId,
          }),
        invitation: () => Effect.succeed(session),
      });
      const runner = yield* WorkloadRunner.WorkloadRunner.pipe(
        Effect.provide(
          WorkloadRunner.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                identities,
                BrokerCrypto.layer,
                BrokerHttpClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
              ),
            ),
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
          ),
        ),
      );
      expect((yield* runner.check("machine", "workload", "binding.json")).credentialDelivery).toBe(
        "unsupported",
      );
      tamper = true;
      expect(
        (yield* runner.check("machine", "workload", "binding.json").pipe(Effect.flip)).reason,
      ).toBe("invalid-proof");
      tamper = false;
      f.state.allow = false;
      expect(
        (yield* runner.check("machine", "workload", "binding.json").pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(yield* runner.release("machine", "workload", "binding.json")).toEqual({
        released: true,
      });
      expect(yield* service.list(f.threadId)).toEqual([]);
      const malformed = yield* Effect.promise(() =>
        web.handler(
          new Request("http://127.0.0.1/api/loom/vault-brokers/workloads/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        ),
      );
      expect(malformed.status).toBe(400);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(BrokerCrypto.layer, NodeServices.layer))),
);
