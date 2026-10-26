import { NonNegativeInt } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_READINESS_ROUTE,
  LibraryError,
  LibraryPushKeySummary,
  LibraryPushReadiness,
  LibraryPushServedTopic,
  LibraryPushState,
  LibraryPushStatusReason,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClientRequest } from "effect/http";

import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { AGENT_CALLER, LibraryPushService } from "./LibraryPushService.ts";

/** Agents learn whether push works, never who registered what. */
export const LibraryPushAgentStatus = Schema.Struct({
  state: LibraryPushState,
  reason: Schema.NullOr(LibraryPushStatusReason),
  key: Schema.NullOr(LibraryPushKeySummary),
  deviceCount: NonNegativeInt,
  topics: Schema.optionalKey(Schema.Array(LibraryPushServedTopic)),
  alerts: Schema.Boolean,
});
export type LibraryPushAgentStatus = typeof LibraryPushAgentStatus.Type;

const OLDER_LIBRARY =
  "Your Library runs a Loom version that cannot report its notification status to other computers. Update the Library, then try again.";
const unreachable = () =>
  new LibraryError({
    reason: "io",
    detail: "Loom could not reach your Library to read its notification status. Try again.",
  });

const decodeReadiness = Schema.decodeUnknownEffect(LibraryPushReadiness);

/**
 * The push status of this computer's Library. The Library reads its own; another computer asks its
 * Library over its publisher session, which answers a device count but no key or builds.
 */
export class LibraryPushReadinessService extends Context.Service<
  LibraryPushReadinessService,
  { readonly current: Effect.Effect<LibraryPushAgentStatus, LibraryError> }
>()("t3/fork/library-push/LibraryPushReadiness/LibraryPushReadinessService") {}

const make = Effect.gen(function* () {
  const library = yield* LibraryConnection.LibraryConnectionService;
  const push = yield* LibraryPushService;

  const local = push.status(AGENT_CALLER).pipe(
    Effect.map((status): LibraryPushAgentStatus => ({
      state: status.state,
      reason: status.reason,
      key: status.key,
      deviceCount: status.devices.length,
      ...(status.topics === undefined ? {} : { topics: status.topics }),
      alerts: push.alerts,
    })),
  );

  const remote = Effect.fn("LibraryPushReadiness.remote")(function* (
    connection: Extract<LibraryConnection.LibraryConnection, { readonly kind: "remote" }>,
  ) {
    const response = yield* connection
      .send(HttpClientRequest.get(connection.endpoint(LIBRARY_PUSH_READINESS_ROUTE)))
      .pipe(Effect.mapError((error) => (error.reason === "io" ? unreachable() : error)));
    // A Library from before this route answers 404 or with its web app.
    if (response.status === 404 || /^text\/html\b/i.test(response.headers["content-type"] ?? ""))
      return yield* new LibraryError({ reason: "blocked", detail: OLDER_LIBRARY });
    if (response.status === 401 || response.status === 403)
      return yield* new LibraryError({
        reason: "blocked",
        detail: LibraryConnection.LIBRARY_SIGN_IN_MISSING,
      });
    if (response.status !== 200) return yield* unreachable();
    const readiness = yield* response.json.pipe(
      Effect.flatMap(decodeReadiness),
      Effect.mapError(unreachable),
    );
    return {
      state: readiness.state,
      reason: readiness.reason,
      key: null,
      deviceCount: readiness.devices,
      alerts: readiness.alerts,
    } satisfies LibraryPushAgentStatus;
  });

  return LibraryPushReadinessService.of({
    current: Effect.gen(function* () {
      const connection = yield* library.current;
      switch (connection.kind) {
        case "remote":
          return yield* remote(connection);
        case "unavailable":
          return yield* new LibraryError({
            reason: "blocked",
            detail: LibraryConnection.LIBRARY_SIGN_IN_MISSING,
          });
        // The Library itself, or a computer with none, whose push service reports `not-library`.
        case "authority":
        case "none":
          return yield* local;
      }
    }).pipe(Effect.withSpan("LibraryPushReadiness.current")),
  });
});

export const layer = Layer.effect(LibraryPushReadinessService, make);
