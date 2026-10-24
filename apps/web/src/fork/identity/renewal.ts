import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import type { IdentityRenewal } from "@t3tools/client-runtime/fork";
import type { DesktopBridge } from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Desktop main holds each computer's refresh grant; a plain browser never sees Identity tokens. */
export function identityRenewalAvailable(bridge: DesktopBridge | undefined = window.desktopBridge) {
  return typeof bridge?.renewLoomIdentity === "function";
}

/** Null keeps sign-ins manual, which is the plain browser's only option. */
export function desktopIdentityRenewal(
  bridge: DesktopBridge | undefined = window.desktopBridge,
): Context.Service.Shape<typeof IdentityRenewal> {
  if (bridge?.renewLoomIdentity === undefined) return null;
  return {
    renew: Effect.fn("web.identityRenewal.renew")(function* (request) {
      const result = yield* Effect.tryPromise({
        try: () =>
          bridge.renewLoomIdentity!({
            httpBaseUrl: request.httpBaseUrl,
            environmentId: request.environmentId,
            identity: request.identity,
            ...(request.currentToken === null ? {} : { currentToken: request.currentToken }),
          }),
        // The bridge rejects only when trying again later can help.
        catch: () =>
          new ConnectionTransientError({
            reason: "network",
            detail: "Could not renew Identity access. Loom will try again.",
          }),
      });
      if (result._tag === "SignInRequired") return result;
      const { session } = result;
      if (
        session.expiresAt === undefined ||
        session.environmentId !== request.environmentId ||
        session.identity?.issuer !== request.identity.issuer ||
        session.identity.subject !== request.identity.subject
      ) {
        return {
          _tag: "SignInRequired" as const,
          reason: "This computer renewed a different sign-in. Sign in again.",
        };
      }
      return {
        _tag: "Renewed" as const,
        token: session.accessToken,
        expiresAt: session.expiresAt,
      };
    }),
    forget: (request) =>
      bridge.forgetLoomIdentity === undefined
        ? Effect.void
        : Effect.tryPromise(() => bridge.forgetLoomIdentity!(request)).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not forget the Identity grant on this device.", { error }),
            ),
          ),
  };
}
