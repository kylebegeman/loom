import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import type {
  IdentityRenewal,
  IdentityRenewalOutcome,
  IdentityRenewalRequest,
} from "@t3tools/client-runtime/fork";
import {
  endIdentityGrant,
  type IdentityGrantFetch,
  IdentityGrantTransientError,
  identityGrantKey,
  makeKeyedSingleFlight,
  renewIdentityGrant,
} from "@t3tools/shared/fork/identity-grant";
import * as Effect from "effect/Effect";

import type { MobileIdentityGrantStore } from "./grantStore";

type IdentityRenewalService = NonNullable<typeof IdentityRenewal.Service>;

function webOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const grantKey = (request: Omit<IdentityRenewalRequest, "currentToken">) =>
  identityGrantKey({
    issuer: request.identity.issuer,
    subject: request.identity.subject,
    environmentId: request.environmentId,
  });

const signInRequired = (reason: string): IdentityRenewalOutcome => ({
  _tag: "SignInRequired",
  reason,
});

function transientRenewalError(cause: unknown) {
  return cause instanceof IdentityGrantTransientError
    ? new ConnectionTransientError({ reason: "network", detail: cause.message })
    : new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "Could not read this device's saved Loom sign-in. Loom will try again.",
      });
}

export function makeIdentityRenewal(deps: {
  readonly store: MobileIdentityGrantStore;
  readonly fetch: IdentityGrantFetch;
  readonly now: () => number;
}): IdentityRenewalService {
  // Pocket ID revokes the whole grant when a rotated refresh token is replayed after a minute.
  const singleFlight = makeKeyedSingleFlight<IdentityRenewalOutcome>();

  const renewOnce = (request: IdentityRenewalRequest): Promise<IdentityRenewalOutcome> => {
    const key = grantKey(request);
    const origin = webOrigin(request.httpBaseUrl);
    if (origin === null)
      return Promise.resolve(
        signInRequired("This connection's address is not valid. Review its settings."),
      );
    return singleFlight(key, async () => {
      // Read inside the flight, so a caller that waited never replays a token already rotated.
      const grant = await deps.store.get(key);
      if (grant === null)
        return signInRequired(
          "This device has no saved Loom sign-in for this computer. Sign in again.",
        );
      // A phone often reaches its computer over an address learned after sign-in, so renewal uses
      // whichever one the connection reached; the reply must still name this computer and account.
      const renewed = await renewIdentityGrant(grant, {
        currentToken: request.currentToken,
        httpBaseUrl: origin,
        fetch: deps.fetch,
        now: deps.now,
        onRotated: deps.store.replaceIfSameSignIn,
      });
      if (renewed._tag === "SignInRequired") {
        await deps.store.removeIfSameSignIn(grant).catch(() => {
          // A grant left behind fails the same way next time and is removed then.
        });
        return signInRequired(renewed.reason);
      }
      return {
        _tag: "Renewed",
        token: renewed.session.accessToken,
        expiresAt: renewed.session.expiresAt,
      };
    });
  };

  const forgetOnce = async (request: Omit<IdentityRenewalRequest, "currentToken">) => {
    // One connection per computer holds this grant, and the registry keeps it while any of that
    // connection's routes still signs in with the account, so the address is irrelevant.
    const grant = await deps.store.get(grantKey(request));
    if (grant === null) return;
    try {
      await deps.store.removeIfSameSignIn(grant);
    } finally {
      await endIdentityGrant(grant, { fetch: deps.fetch });
    }
  };

  return {
    renew: Effect.fn("MobileIdentityRenewal.renew")(function* (request) {
      // An interrupted caller leaves the flight running: once Pocket ID rotates the token, it must be saved.
      return yield* Effect.tryPromise({
        try: () => renewOnce(request),
        catch: transientRenewalError,
      });
    }),
    forget: Effect.fn("MobileIdentityRenewal.forget")(function* (request) {
      yield* Effect.tryPromise({ try: () => forgetOnce(request), catch: (cause) => cause }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not forget this device's Loom sign-in.", {
            environmentId: request.environmentId,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      );
    }),
  };
}
