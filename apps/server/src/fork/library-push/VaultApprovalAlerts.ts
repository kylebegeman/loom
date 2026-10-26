import { type LibraryPushActivityRequest, VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import * as ApprovalNotificationTransport from "../vault/ApprovalNotificationTransport.ts";
import { postLibraryActivity } from "./AgentAlerts.ts";
import { LibraryPushService } from "./LibraryPushService.ts";

/**
 * Vault approval alerts (L86). A new pending request reaches the owner's iPhones the way agent
 * alerts do: this computer posts it to its Library, or the Library sends its own. Only the
 * requesting thread travels; the Library adds fixed text and the link a tap opens.
 */

const make = Effect.gen(function* () {
  const library = yield* LibraryConnection.LibraryConnectionService;
  const push = yield* LibraryPushService;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  // Owns each send, so the caller giving up on its short wait never cancels a post in flight.
  const scope = yield* Effect.scope;

  // Untraced: the send runs under the span of `pending`, which forks it. The connection is read
  // per request, unlike agent alerts, so a computer signed in after start alerts too.
  const send = Effect.fnUntraced(function* (request: LibraryPushActivityRequest) {
    const connection = yield* library.current;
    const answer =
      connection.kind === "remote"
        ? yield* postLibraryActivity(connection, request)
        : connection.kind === "authority" && push.alerts
          ? yield* push
              .alert(environmentId, request)
              .pipe(Effect.catchTags({ LibraryPushError: (error) => Effect.succeed(error.reason) }))
          : null;
    // No Library, or one without agent alerts, has no channel to offer.
    if (answer === null || answer === "unsupported") return "stubbed" as const;
    if (typeof answer !== "string" && answer.sent > 0) return "delivered" as const;
    // Accepted for no device means nobody heard it, which is no delivery either.
    yield* Effect.logDebug("Vault approval alert not confirmed", {
      outcome: typeof answer === "string" ? answer : "no-device",
    });
    return yield* new VaultError({ reason: "unavailable" });
  });

  return ApprovalNotificationTransport.ApprovalNotificationTransport.of({
    pending: Effect.fn("VaultApprovalAlerts.pending")(function* (notice) {
      const sending = yield* send({ threadId: notice.threadId, kind: "vault-approval" }).pipe(
        Effect.forkIn(scope),
      );
      return yield* Fiber.join(sending);
    }),
  });
});

export const layer = Layer.effect(
  ApprovalNotificationTransport.ApprovalNotificationTransport,
  make,
);
