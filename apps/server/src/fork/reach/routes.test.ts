import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { EnvironmentAuth } from "../../auth/EnvironmentAuth.ts";
import { ForkRoutesLayer } from "../ForkLayer.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ReachService } from "./ReachService.ts";

const REACH_HOST = "studio-loom.reach.example.test";
const TAILNET_HOST = "studio.tail1234.ts.net";
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "routes-test", version: "0.0.0" },
  },
});

// Upstream registers /mcp and /ws in their own layers, so only a global guard can reach them.
it.effect("the fork routes keep /mcp off the reach host and leave /ws and other hosts alone", () =>
  Effect.gen(function* () {
    const reach = ReachService.of({
      status: Effect.die("unused"),
      changes: Effect.die("unused") as never,
      setEnabled: () => Effect.die("unused"),
      remove: () => Effect.die("unused"),
      guardState: () => ({ hostname: REACH_HOST, serving: true }),
      ownPorts: () => [],
    });
    const runtime = Context.make(ReachService, reach) as unknown as Context.Context<ForkServices>;
    const app = Layer.mergeAll(
      ForkRoutesLayer,
      McpServer.layerHttp({
        name: "Loom",
        version: "0.0.0-test",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18],
      }),
      HttpRouter.add("GET", "/ws", HttpServerResponse.text("socket")),
    ).pipe(
      Layer.provide(Layer.succeed(ForkRuntime, runtime)),
      // Only the fork routes' own handlers read these, and no request here reaches one.
      HttpRouter.provideRequest(
        Layer.merge(NodeHttpPlatform.layer, Layer.mock(EnvironmentAuth)({})),
      ),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const send = (host: string, path: string, init: RequestInit = {}) =>
      Effect.promise(() =>
        web.handler(
          new Request(`http://${host}${path}`, {
            ...init,
            headers: { host, ...(init.headers as Record<string, string> | undefined) },
          }),
        ),
      );
    const mcp = {
      method: "POST",
      body: INITIALIZE,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    };

    expect((yield* send(REACH_HOST, "/mcp", mcp)).status).toBe(404);
    const socket = yield* send(REACH_HOST, "/ws");
    expect([socket.status, yield* Effect.promise(() => socket.text())]).toEqual([200, "socket"]);
    expect((yield* send(TAILNET_HOST, "/mcp", mcp)).status).toBe(200);
  }).pipe(Effect.scoped),
);
