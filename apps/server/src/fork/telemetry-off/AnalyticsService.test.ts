import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../../config.ts";
import * as AnalyticsService from "../../telemetry/AnalyticsService.ts";

const batchRequests = (env: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const paths: Array<string> = [];
    const layerServerConfig = ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-telemetry-off-",
    });
    const layerRuntime = AnalyticsService.layer.pipe(
      Layer.provideMerge(layerServerConfig),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ...env,
            T3CODE_POSTHOG_KEY: "phc_test_key",
            T3CODE_POSTHOG_HOST: "http://localhost",
          }),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HostProcess.Platform, "linux"),
          Layer.succeed(HostProcess.Architecture, "arm64"),
        ),
      ),
      Layer.provideMerge(NodeHttpServer.layerTest),
    );
    const layerBatchServer = HttpServer.serve(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        paths.push(request.url);
        return HttpServerResponse.jsonUnsafe({});
      }),
    );

    yield* Effect.gen(function* () {
      yield* Layer.launch(layerBatchServer).pipe(Effect.forkScoped);
      const analytics = yield* AnalyticsService.AnalyticsService;
      yield* analytics.record("test.telemetry-off", { index: 1 });
      yield* analytics.flush;
    }).pipe(Effect.provide(layerRuntime));
    return paths;
  });

it.layer(NodeServices.layer)("Loom product analytics", (it) => {
  it.effect("send nothing to T3 unless T3CODE_TELEMETRY_ENABLED is true", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* batchRequests({}), []);
      assert.isNotEmpty(yield* batchRequests({ T3CODE_TELEMETRY_ENABLED: true }));
    }),
  );
});
