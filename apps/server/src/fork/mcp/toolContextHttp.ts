import { AuthLibraryPublishScope } from "@t3tools/contracts";
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
import { EnvironmentAuth } from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { SESSION_TOOL_CONTEXT_ROUTE, SessionToolPolicy } from "./SessionToolPolicy.ts";

const Input = Schema.Struct({
  projectId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
});
const handler = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* EnvironmentAuth).authenticateHttpRequest(request);
    if (
      !session.scopes.includes(AuthLibraryPublishScope) ||
      !session.subject.startsWith("loom-host:")
    )
      return HttpServerResponse.empty({ status: 403 });
    const policy = yield* SessionToolPolicy;
    if (!policy.isAuthority) return HttpServerResponse.empty({ status: 404 });
    const input = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(4)),
      Effect.flatMap(Schema.decodeUnknownEffect(Input)),
    );
    return HttpServerResponse.jsonUnsafe(yield* policy.localContext(input.projectId), {
      headers: { "cache-control": "no-store" },
    });
  }),
).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })));

export const SessionToolContextRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return HttpRouter.add(
      "POST",
      SESSION_TOOL_CONTEXT_ROUTE,
      handler.pipe(Effect.provideService(ForkRuntime, runtime)),
    );
  }),
);
