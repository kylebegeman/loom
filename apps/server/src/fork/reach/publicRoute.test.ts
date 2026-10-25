import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ServerConfig from "../../config.ts";
import * as DirectEndpoints from "../../environment/DirectEndpoints.ts";
import * as ReachPublicRoute from "./publicRoute.ts";

const REACH_URL = "https://studio-loom.example.com/";
const TAILNET = { kind: "tailnet", httpBaseUrl: "https://studio.tail1234.ts.net/" } as const;

// A loopback-bound server with Tailscale Serve answering: upstream lists exactly one route.
const layerUpstream = Layer.mergeAll(
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.map(ServerConfig.ServerConfig, (config) => ({
      ...config,
      host: "127.0.0.1",
      tailscaleServeEnabled: true,
      tailscaleServePort: 443,
    })),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "reach-public-route-test-" })),
    Layer.provide(NodeServices.layer),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.make(
            new TextEncoder().encode(
              JSON.stringify({
                Self: { DNSName: "studio.tail1234.ts.net.", TailscaleIPs: ["100.64.1.2"] },
              }),
            ),
          ),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ),
    ),
  ),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))),
    ),
  ),
);

const resolve = Effect.flatMap(DirectEndpoints.DirectEndpoints, (service) => service.resolve());

describe("ReachPublicRoute", () => {
  it.effect("adds the reach address as a public endpoint while the holder has one", () =>
    Effect.gen(function* () {
      const route = yield* ReachPublicRoute.ReachPublicRoute;
      expect(yield* resolve).toEqual([TAILNET]);
      yield* Ref.set(route.url, Option.some(REACH_URL));
      expect(yield* resolve).toEqual([TAILNET, { kind: "public", httpBaseUrl: REACH_URL }]);
      yield* Ref.set(route.url, Option.none());
      expect(yield* resolve).toEqual([TAILNET]);
    }).pipe(
      Effect.provide(
        DirectEndpoints.layer.pipe(
          Layer.provideMerge(ReachPublicRoute.layer),
          Layer.provide(layerUpstream),
        ),
      ),
    ),
  );

  it.effect("leaves upstream's endpoints unchanged where no holder is provided", () =>
    resolve.pipe(
      Effect.map((endpoints) => expect(endpoints).toEqual([TAILNET])),
      Effect.provide(DirectEndpoints.layer.pipe(Layer.provide(layerUpstream))),
    ),
  );
});
