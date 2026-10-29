import { AuthEnvironmentMaintainScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  UPDATE_ACTIVITY_ROUTE,
  UPDATE_FENCE_ROUTE,
  UPDATE_PROGRESS_ROUTE,
  UpdateFenceRequest,
  UpdateProgress,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as UpdateHandoff from "./UpdateHandoff.ts";
import * as UpdatePlans from "./UpdatePlans.ts";

const headers = { "cache-control": "no-store" } as const;
const decodeProgress = Schema.decodeUnknownEffect(UpdateProgress);
const decodeFence = Schema.decodeUnknownEffect(UpdateFenceRequest);
const handle = (mode: "activity" | "fence" | "progress") =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request);
      const scope = mode === "activity" ? AuthOrchestrationReadScope : AuthEnvironmentMaintainScope;
      if (!session.scopes.includes(scope))
        return HttpServerResponse.text("Access denied", { status: 403, headers });
      const service = yield* UpdateHandoff.UpdateHandoff;
      if (mode === "activity")
        return HttpServerResponse.jsonUnsafe(yield* service.activity, { headers });
      const parsed = yield* request.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(4096)),
        Effect.option,
      );
      if (parsed._tag === "None")
        return HttpServerResponse.text("Invalid update request", { status: 400, headers });
      const body = parsed.value;
      if (mode === "progress") {
        const input = yield* decodeProgress(body).pipe(Effect.option);
        if (input._tag === "None")
          return HttpServerResponse.text("Invalid update request", { status: 400, headers });
        if (input.value.cancelled)
          yield* (yield* UpdatePlans.UpdatePlans).cancel(input.value.planId);
        else yield* service.progress(input.value);
        return HttpServerResponse.jsonUnsafe({ accepted: true }, { headers });
      }
      const input = yield* decodeFence(body).pipe(Effect.option);
      if (input._tag === "None")
        return HttpServerResponse.text("Invalid update request", { status: 400, headers });
      if (input.value.action === "acquire")
        return HttpServerResponse.jsonUnsafe(yield* service.acquire(input.value.owner), {
          headers,
        });
      yield* service.release(input.value.leaseId);
      return HttpServerResponse.jsonUnsafe({ released: true }, { headers });
    }),
  ).pipe(
    Effect.catchTags({
      ServerAuthMissingCredentialError: () =>
        Effect.succeed(
          HttpServerResponse.text("Authentication required", { status: 401, headers }),
        ),
      ServerAuthInvalidCredentialError: () =>
        Effect.succeed(
          HttpServerResponse.text("Authentication required", { status: 401, headers }),
        ),
      UpdatePlanError: () =>
        Effect.succeed(
          HttpServerResponse.text("Update activity unavailable", { status: 503, headers }),
        ),
    }),
  );

export const UpdateHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return Layer.mergeAll(
      HttpRouter.add(
        "POST",
        UPDATE_ACTIVITY_ROUTE,
        handle("activity").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        UPDATE_FENCE_ROUTE,
        handle("fence").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        UPDATE_PROGRESS_ROUTE,
        handle("progress").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    );
  }),
);
