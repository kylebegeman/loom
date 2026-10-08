import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { PcbPreviewService } from "./PcbPreviewService.ts";
const PREFIX = "/api/loom/pcb-preview/f/";
export const PcbPreviewHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return HttpRouter.add(
      "GET",
      `${PREFIX}*`,
      withForkRuntime(
        Effect.gen(function* () {
          const url = HttpServerRequest.toURL(yield* HttpServerRequest.HttpServerRequest);
          if (Option.isNone(url)) return HttpServerResponse.text("Not found", { status: 404 });
          const suffix = url.value.pathname.slice(PREFIX.length),
            slash = suffix.indexOf("/");
          if (slash < 1) return HttpServerResponse.text("Not found", { status: 404 });
          const file = yield* (yield* PcbPreviewService).resolveSignedRequest(
            suffix.slice(0, slash),
            suffix.slice(slash + 1),
          );
          return yield* HttpServerResponse.file(file, {
            headers: {
              "Content-Type": "model/gltf-binary",
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
