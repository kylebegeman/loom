import * as DesktopCloudflareAccess from "../cloudflare-access/DesktopCloudflareAccess.ts"; // fork: cloudflare-access
// @effect-diagnostics globalFetch:off - The shared renewal helpers take a fetch so Electron main and React Native run the same code.
import type {
  LoomDesktopForgetRequest,
  LoomDesktopRenewRequest,
  LoomDesktopRenewResult,
} from "@t3tools/contracts/fork";
import {
  endIdentityGrant,
  type IdentityGrant,
  type IdentityGrantFetch,
  IdentityGrantTransientError,
  identityGrantKey,
  makeKeyedSingleFlight,
  renewIdentityGrant,
} from "@t3tools/shared/fork/identity-grant";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopIdentityGrantStore from "./DesktopIdentityGrantStore.ts";

/** A transient failure: the renderer keeps the current session and retries later. */
export class DesktopIdentityRenewalError extends Schema.TaggedError<DesktopIdentityRenewalError>()(
  "DesktopIdentityRenewalError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Renews computer sessions from the refresh grants kept in the main process. The refresh token and
 * ID token never reach the renderer; it only ever sees the computer session the grant buys.
 */
export class DesktopIdentityRenewal extends Context.Service<
  DesktopIdentityRenewal,
  {
    /** Keeps the grant from an interactive sign-in. Failing to keep it only costs renewal. */
    readonly save: (grant: IdentityGrant) => Effect.Effect<void>;
    readonly renew: (
      request: LoomDesktopRenewRequest,
    ) => Effect.Effect<LoomDesktopRenewResult, DesktopIdentityRenewalError>;
    /** Forgets the grant and ends it at the provider, best effort. */
    readonly forget: (request: LoomDesktopForgetRequest) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/fork/identity-renewal/DesktopIdentityRenewal") {}

const isRenewalError = Schema.is(DesktopIdentityRenewalError);

const NO_GRANT_REASON = "Sign in to Loom again to keep this computer connected.";
const INVALID_ADDRESS_REASON = "This connection's address is not valid. Review its settings.";

const signInRequired = (reason: string): LoomDesktopRenewResult => ({
  _tag: "SignInRequired",
  reason,
});

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const grantKeyOf = (request: LoomDesktopForgetRequest) =>
  identityGrantKey({
    issuer: request.identity.issuer,
    subject: request.identity.subject,
    environmentId: request.environmentId,
  });

/** @public */
export const make = Effect.fn("DesktopIdentityRenewal.make")(function* (options: {
  readonly fetch: IdentityGrantFetch;
}) {
  const store = yield* DesktopIdentityGrantStore.DesktopIdentityGrantStore;
  const clock = yield* Clock.Clock;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const now = () => clock.currentTimeMillisUnsafe();
  // Pocket ID revokes a grant whose previous refresh token is replayed after a minute, so
  // concurrent renewals of one grant share a single refresh.
  const renewOnce = makeKeyedSingleFlight<LoomDesktopRenewResult>();
  // A forget or a new sign-in waits for an in-flight renewal, which would otherwise save its
  // rotated grant over theirs.
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockFor = (key: string) => {
    const existing = locks.get(key);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    locks.set(key, created);
    return created;
  };
  const storageFailure = () =>
    new DesktopIdentityRenewalError({
      detail: "Could not read this device's saved Loom sign-in. Try again.",
    });

  const saveRotated = (grant: IdentityGrant) =>
    store
      .put(grant)
      .pipe(
        Effect.flatMap((saved) =>
          saved
            ? Effect.void
            : Effect.fail(
                new DesktopIdentityRenewalError({ detail: "OS encryption is unavailable." }),
              ),
        ),
      );

  const renewStored = Effect.fn("DesktopIdentityRenewal.renewStored")(function* (
    key: string,
    origin: string,
    currentToken: string | undefined,
  ) {
    const stored = yield* store.get(key).pipe(Effect.mapError(storageFailure));
    if (Option.isNone(stored)) return signInRequired(NO_GRANT_REASON);
    const renewed = yield* Effect.tryPromise({
      try: () =>
        renewIdentityGrant(stored.value, {
          currentToken,
          httpBaseUrl: origin,
          fetch: options.fetch,
          now,
          onRotated: (rotated) => runPromise(saveRotated(rotated)),
        }),
      catch: (cause) =>
        new DesktopIdentityRenewalError({
          detail:
            cause instanceof IdentityGrantTransientError
              ? cause.message
              : "Could not renew Loom access. Try again.",
        }),
    });
    if (renewed._tag === "SignInRequired") {
      // The provider or computer refused this grant for good, so a retry would only fail again.
      yield* store
        .remove(key)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not forget a refused Loom sign-in.", { error }),
          ),
        );
      return signInRequired(renewed.reason);
    }
    return { _tag: "Renewed", session: renewed.session } satisfies LoomDesktopRenewResult;
  });

  return DesktopIdentityRenewal.of({
    save: Effect.fn("DesktopIdentityRenewal.save")(
      function* (grant) {
        // Without OS encryption the store keeps nothing and has already said so.
        yield* lockFor(identityGrantKey(grant)).withPermit(store.put(grant));
      },
      Effect.catch((error) =>
        Effect.logWarning("Could not save the Loom sign-in for renewal.", { error }),
      ),
    ),
    renew: Effect.fn("DesktopIdentityRenewal.renew")(function* (request) {
      const key = grantKeyOf(request);
      const origin = originOf(request.httpBaseUrl);
      if (origin === null) return signInRequired(INVALID_ADDRESS_REASON);
      const stored = yield* store.get(key).pipe(Effect.mapError(storageFailure));
      if (Option.isNone(stored)) return signInRequired(NO_GRANT_REASON);
      // A device often reaches its computer over an address learned after sign-in, so renewal uses
      // whichever one the connection reached; the reply must still name this computer and account.
      // Read again inside the flight: a caller that waited must not replay a rotated token.
      return yield* Effect.tryPromise({
        try: () =>
          renewOnce(key, () =>
            runPromise(lockFor(key).withPermit(renewStored(key, origin, request.currentToken))),
          ),
        catch: (cause) =>
          isRenewalError(cause)
            ? cause
            : new DesktopIdentityRenewalError({
                detail: "Could not renew Loom access. Try again.",
              }),
      });
    }),
    forget: Effect.fn("DesktopIdentityRenewal.forget")(
      function* (request) {
        const key = grantKeyOf(request);
        // One connection per computer holds this grant, and the registry keeps it while any of
        // that connection's routes still signs in with the account, so the address is irrelevant.
        const forgotten = yield* lockFor(key).withPermit(
          Effect.gen(function* () {
            const stored = yield* store.get(key);
            if (Option.isNone(stored)) return Option.none<IdentityGrant>();
            yield* store.remove(key);
            return stored;
          }),
        );
        if (Option.isSome(forgotten))
          yield* Effect.promise(() => endIdentityGrant(forgotten.value, options));
      },
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not forget a Loom sign-in.", { cause }),
      ),
    ),
  });
});

export const layer = Layer.effect(
  DesktopIdentityRenewal,
  Effect.gen(function* () {
    const access = yield* DesktopCloudflareAccess.DesktopCloudflareAccess;
    return yield* make({ fetch: access.fetch });
  }),
).pipe(Layer.provide(DesktopIdentityGrantStore.layer));
