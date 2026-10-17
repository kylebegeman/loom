import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { SitesError, SitesSnapshot } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as SitesService from "./SitesService.ts";
import { SitesToolkit, sitesHandlers } from "./mcp.ts";

const snapshot: SitesSnapshot = {
  schemaVersion: 1,
  primarySiteId: "site",
  observedAt: "2026-10-17T00:00:00Z",
  staleAfterSeconds: 900,
  sites: [],
  services: [],
  checks: [],
};
const base = { id: "api", name: "API", url: "https://api.example.test", active: true };
const cases = [
  ["loom_site_save", { ...base, origins: [base.url], serviceIds: [], projectIds: ["project"] }],
  ["loom_site_service_save", { ...base, kind: "api" }],
  ["loom_site_check_save", { ...base, service_id: "api", expected_status: 200, content: "" }],
  ["loom_site_checks_run", {}],
] as const;

it.effect.each(cases)(
  "%s rejects read-only callers and rechecks a caller that ends while waiting to write",
  ([name, input]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("sites-caller");
        let caller = liveThreadShell(threadId);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let writes = 0;
        let calls = 0;
        const write = (authorize?: Effect.Effect<void, SitesError>) =>
          Effect.gen(function* () {
            calls += 1;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            yield* authorize ?? Effect.void;
            writes += 1;
            return snapshot;
          });
        const service = SitesService.SitesService.of({
          snapshot: Effect.succeed({ configured: true, managementConfigured: true, snapshot }),
          analytics: () => Effect.die("unused"),
          saveSite: (_, authorize) => write(authorize),
          saveService: (_, authorize) => write(authorize),
          saveCheck: (_, authorize) => write(authorize),
          runChecks: write,
        });
        const toolkit = yield* SitesToolkit.pipe(
          Effect.provide(
            McpToolAccess.HandlersLayer.layer(sitesHandlers).pipe(
              Layer.provide(
                Layer.succeed(
                  ForkRuntime,
                  Context.make(SitesService.SitesService, service) as Context.Context<ForkServices>,
                ),
              ),
            ),
          ),
        );
        const scope: McpInvocationScope = {
          environmentId: EnvironmentId.make("sites-host"),
          capabilities: new Set(["orchestration"]),
          issuedAt: 0,
          requestNamespace: "sites-test",
          thread: {
            threadId,
            providerSessionId: "session",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
        };
        const invoke = (context: McpInvocationScope) =>
          toolkit.handle(name, input).pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, context),
            Effect.provide(
              Layer.mock(ThreadManagementService)({
                getThreadShell: () => Effect.sync(() => caller),
              }),
            ),
          );
        const denied = yield* invoke({
          ...scope,
          thread: undefined,
          client: { sessionId: "reader", label: "Read only", access: "read-only" },
        }).pipe(Effect.flip);
        expect(denied).toMatchObject({ code: "capability_denied" });
        expect(calls).toBe(0);

        const pending = yield* invoke(scope).pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        caller = liveThreadShell(threadId, { activeRunId: null });
        yield* Deferred.succeed(release, undefined);
        const revoked = yield* Fiber.join(pending).pipe(Effect.flip);
        expect(revoked).toMatchObject({
          _tag: "SitesError",
          stage: "write",
          cause: { code: "parent_not_active" },
        });
        expect(writes).toBe(0);

        caller = liveThreadShell(threadId);
        const allowed = yield* invoke(scope);
        expect(allowed[0]?.result).toEqual(snapshot);
        expect(writes).toBe(1);
      }),
    ),
);
