import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { HttpRouter } from "effect/http";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { PcbPreviewService } from "./PcbPreviewService.ts";
import { PcbPreviewHttpRoutes } from "./http.ts";
import { PcbPreviewError } from "@t3tools/contracts/fork";
it.effect("serves mesh bytes and returns plain 404 for invalid credentials and traversal", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path,
      dir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-http-test-" }),
      target = path.join(dir, "board.glb");
    yield* fs.writeFileString(target, "mesh bytes");
    const service = {
      resolveSignedRequest: (token: string, relative: string) =>
        token === "valid" && relative === "board.glb"
          ? Effect.succeed(target)
          : Effect.fail(
              new PcbPreviewError({ reason: "render-not-found", message: "private detail" }),
            ),
    } as unknown as PcbPreviewService["Service"];
    const app = PcbPreviewHttpRoutes.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            ForkRuntime,
            Context.make(PcbPreviewService, service) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
      HttpRouter.provideRequest(NodeHttpPlatform.layer),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const response = yield* Effect.promise(() =>
      web.handler(new Request("http://localhost/api/loom/pcb-preview/f/valid/board.glb")),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("model/gltf-binary");
    expect(yield* Effect.promise(() => response.text())).toBe("mesh bytes");
    for (const url of ["invalid/board.glb", "valid/%2e%2e%2fsecret", "valid/other.glb"]) {
      const rejected = yield* Effect.promise(() =>
        web.handler(new Request(`http://localhost/api/loom/pcb-preview/f/${url}`)),
      );
      expect(rejected.status).toBe(404);
      expect(yield* Effect.promise(() => rejected.text())).toBe("Not found");
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
