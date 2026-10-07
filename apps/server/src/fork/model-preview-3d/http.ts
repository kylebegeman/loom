import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
const PREFIX = "/api/loom/model-preview-3d/f/";
const MIME: Readonly<Record<string, string>> = {
  stl: "model/stl",
  "3mf": "model/3mf",
  obj: "model/obj",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export const ModelPreviewHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return HttpRouter.add(
      "GET",
      `${PREFIX}*`,
      withForkRuntime(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) return HttpServerResponse.text("Not found", { status: 404 });
          const suffix = url.value.pathname.slice(PREFIX.length),
            slash = suffix.indexOf("/");
          if (slash < 1) return HttpServerResponse.text("Not found", { status: 404 });
          const file = yield* (yield* ModelPreviewService).resolveSignedRequest(
            suffix.slice(0, slash),
            suffix.slice(slash + 1),
          );
          return yield* HttpServerResponse.file(file.path, {
            headers: {
              "Content-Type":
                MIME[file.path.split(".").at(-1)?.toLowerCase() ?? ""] ??
                "application/octet-stream",
              "Cache-Control": "private, max-age=3600",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }),
      ).pipe(
        Effect.provideService(ForkRuntime, runtime),
        Effect.orElseSucceed(() => HttpServerResponse.text("Not found", { status: 404 })),
      ),
    );
  }),
);
