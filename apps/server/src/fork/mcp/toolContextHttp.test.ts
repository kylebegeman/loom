import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { AuthLibraryPublishScope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import { EnvironmentAuth } from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { SessionToolContextRoutes } from "./toolContextHttp.ts";
import { SESSION_TOOL_CONTEXT_ROUTE, SessionToolPolicy } from "./SessionToolPolicy.ts";

it.effect("only a signed-in publisher reads the Library's public tool evidence", () =>
  Effect.gen(function* () {
    let subject = "mcp-client";
    let queried: string | undefined;
    const policy = SessionToolPolicy.of({
      isAuthority: true,
      forThread: () => Effect.die("unused"),
      localContext: (projectId) =>
        Effect.sync(() => {
          queried = projectId;
          return { reach: true, sites: projectId === "library-project" };
        }),
    });
    const app = SessionToolContextRoutes.pipe(
      Layer.provide(
        Layer.succeed(
          ForkRuntime,
          Context.make(SessionToolPolicy, policy) as Context.Context<ForkServices>,
        ),
      ),
      HttpRouter.provideRequest(
        Layer.merge(
          NodeHttpPlatform.layer,
          Layer.mock(EnvironmentAuth)({
            authenticateHttpRequest: () =>
              Effect.sync(() => ({ subject, scopes: [AuthLibraryPublishScope] }) as never),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const send = () =>
      Effect.promise(() =>
        web.handler(
          new Request(`http://localhost${SESSION_TOOL_CONTEXT_ROUTE}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"projectId":"library-project"}',
          }),
        ),
      );
    expect((yield* send()).status).toBe(403);
    expect(queried).toBeUndefined();
    subject = "loom-host:synthetic-computer";
    const response = yield* send();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(yield* Effect.promise(() => response.json())).toEqual({ reach: true, sites: true });
    expect(queried).toBe("library-project");
  }).pipe(Effect.scoped),
);
