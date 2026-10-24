import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityAccount } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import type * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  BearerConnectionCredential,
  type BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
} from "../connection/catalog.ts";
import { ConnectionCredentialStore } from "../connection/credentialStore.ts";
import { type ConnectionAttemptError, ConnectionTransientError } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionRoutes, credentialConnectionId } from "../connection/routes.ts";
import { IdentityRenewal } from "./identity-renewal.ts";

type IdentityRenewalService = NonNullable<Context.Service.Shape<typeof IdentityRenewal>>;

export type IdentityCredential = BearerConnectionCredential & {
  readonly identity: NonNullable<BearerConnectionCredential["identity"]>;
};

const RENEWAL_MAX_LEAD_MS = 10 * 60_000;
const RENEWAL_MIN_LEAD_MS = 30_000;
const RETRY_INITIAL_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;
/**
 * The resolver renews an expired credential when the computer reconnects, and the credential store
 * has no change feed, so an expired credential is checked again for that result.
 */
const EXPIRED_RECHECK_MS = 60_000;

export function isIdentityCredential(
  credential: ConnectionCredential,
): credential is IdentityCredential {
  return credential.identity !== undefined;
}

/**
 * Renews a quarter of the lifetime left when the credential was first seen, at most 10 minutes and
 * at least 30 seconds before expiry. Anchoring at first sight keeps the time stable across wakes.
 */
export function identityRenewalDueAt(expiresAt: number, observedAt: number): number {
  const lead = Math.min(RENEWAL_MAX_LEAD_MS, Math.max(0, expiresAt - observedAt) / 4);
  return expiresAt - Math.max(RENEWAL_MIN_LEAD_MS, lead);
}

export function nextIdentityRetryDelayMs(previousMs: number | null): number {
  return previousMs === null ? RETRY_INITIAL_MS : Math.min(previousMs * 2, RETRY_MAX_MS);
}

/** Returns the credential to save in place of the current one, with the identity binding kept. */
export const renewIdentityCredential = Effect.fn("IdentityRenewal.renewCredential")(function* (
  renewal: IdentityRenewalService,
  input: {
    readonly httpBaseUrl: string;
    readonly credential: IdentityCredential;
    readonly currentToken: string | null;
  },
) {
  const { issuer, subject, environmentId } = input.credential.identity;
  const outcome = yield* renewal.renew({
    httpBaseUrl: input.httpBaseUrl,
    environmentId,
    identity: { issuer, subject },
    currentToken: input.currentToken,
  });
  if (outcome._tag === "SignInRequired") return outcome;
  return {
    _tag: "Renewed" as const,
    credential: new BearerConnectionCredential({
      token: outcome.token,
      identity: { ...input.credential.identity, expiresAt: outcome.expiresAt },
    }) as IdentityCredential,
  };
});

interface ConnectRenewalInput {
  readonly renewal: IdentityRenewalService | null;
  readonly credentials: Pick<ConnectionCredentialStore["Service"], "get" | "put">;
  readonly connectionId: string;
  readonly environmentId: EnvironmentId;
  readonly profile: BearerConnectionProfile;
}

/**
 * Renews a saved Identity credential the computer can no longer accept: one that expired, or
 * `rejectedToken` after the computer refused it. Live credentials are the worker's, which swaps
 * them under the registry's lock. The renewal is saved only while the store still holds the token
 * it replaces, so a removal or a worker swap in the meantime wins. Returns the token to connect
 * with, or null to keep the caller's block; a transient failure fails so the supervisor retries.
 */
export const renewIdentityForConnect = Effect.fn("IdentityRenewal.renewForConnect")(function* (
  input: ConnectRenewalInput & { readonly rejectedToken?: string },
) {
  const { renewal, profile, credentials, connectionId } = input;
  if (renewal === null || profile.identity === undefined) return null;
  const stored = Option.getOrNull(yield* credentials.get(connectionId));
  // A mismatched binding is never sent anywhere; the caller rejects it.
  if (
    stored === null ||
    !isIdentityCredential(stored) ||
    !boundTo(stored, { environmentId: input.environmentId, identity: profile.identity })
  ) {
    return null;
  }
  const unusable =
    input.rejectedToken === undefined
      ? stored.identity.expiresAt <= (yield* Clock.currentTimeMillis)
      : stored.token === input.rejectedToken;
  if (!unusable) return null;
  const outcome = yield* renewIdentityCredential(renewal, {
    httpBaseUrl: profile.httpBaseUrl,
    credential: stored,
    // The computer refuses to renew a session it revoked, so it must see the one being replaced.
    currentToken: stored.token,
  });
  if (outcome._tag !== "Renewed") return null;
  const latest = Option.getOrNull(yield* credentials.get(connectionId));
  if (latest?.token !== stored.token) return null;
  yield* credentials.put(connectionId, outcome.credential);
  return outcome.credential.token;
});

/**
 * Authorizes with a saved credential, renewing once when the computer refuses an Identity
 * credential that is still live locally, as after a change to its sign-in policy. A revoked
 * session is refused renewal, so the computer's refusal stands.
 */
export const authorizeRenewingIdentity = <A>(
  input: ConnectRenewalInput & { readonly credential: BearerConnectionCredential },
  authorize: (token: string) => Effect.Effect<A, ConnectionAttemptError>,
): Effect.Effect<A, ConnectionAttemptError> =>
  authorize(input.credential.token).pipe(
    Effect.catchIf(
      (error) =>
        input.renewal !== null &&
        input.credential.identity !== undefined &&
        error._tag === "ConnectionBlockedError" &&
        error.reason === "authentication",
      (error) =>
        renewIdentityForConnect({ ...input, rejectedToken: input.credential.token }).pipe(
          Effect.flatMap((token) => (token === null ? Effect.fail(error) : authorize(token))),
        ),
    ),
  );

interface IdentityRoute {
  readonly environmentId: EnvironmentId;
  /** The source address first, then the learned addresses that borrow its credential. */
  readonly httpBaseUrls: ReadonlyArray<string>;
  readonly identity: LoomIdentityAccount;
}

/**
 * Learned routes borrow their source route's credential, so only sources renew, but over any of
 * those addresses: away from home a learned one may be the only one the device can reach.
 */
function identityRoutes(
  entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
): ReadonlyMap<string, IdentityRoute> {
  const routes = new Map<string, IdentityRoute>();
  for (const entry of entries.values()) {
    if (!entry.enabled) continue;
    const entryRoutes = connectionRoutes(entry);
    for (const route of entryRoutes) {
      const profile = Option.getOrNull(route.profile);
      if (
        route.target._tag !== "BearerConnectionTarget" ||
        profile?._tag !== "BearerConnectionProfile" ||
        profile.identity === undefined ||
        profile.learned === true ||
        credentialConnectionId(route.target.connectionId) !== route.target.connectionId
      ) {
        continue;
      }
      const sourceId = route.target.connectionId;
      const learnedUrls = entryRoutes.flatMap((candidate) => {
        const learned = Option.getOrNull(candidate.profile);
        return candidate.target._tag === "BearerConnectionTarget" &&
          candidate.target.connectionId !== sourceId &&
          credentialConnectionId(candidate.target.connectionId) === sourceId &&
          learned?._tag === "BearerConnectionProfile"
          ? [learned.httpBaseUrl]
          : [];
      });
      routes.set(sourceId, {
        environmentId: entry.target.environmentId,
        httpBaseUrls: [profile.httpBaseUrl, ...learnedUrls],
        identity: profile.identity,
      });
    }
  }
  return routes;
}

function boundTo(
  credential: IdentityCredential,
  route: Pick<IdentityRoute, "environmentId" | "identity">,
): boolean {
  return (
    credential.identity.environmentId === route.environmentId &&
    credential.identity.issuer === route.identity.issuer &&
    credential.identity.subject === route.identity.subject
  );
}

/** Mutable per-credential state; a new token starts a new schedule. */
interface RenewalSchedule {
  readonly token: string;
  readonly observedAt: number;
  stopped: boolean;
  retryDelayMs: number | null;
  retryAt: number | null;
  /** Advances after a transient failure, so an unreachable address does not hold renewal up. */
  addressIndex: number;
}

const newSchedule = (token: string, observedAt: number): RenewalSchedule => ({
  token,
  observedAt,
  stopped: false,
  retryDelayMs: null,
  retryAt: null,
  addressIndex: 0,
});

/**
 * Renews every saved Identity credential before its computer session expires, one renewal in
 * flight per connection, and swaps it into the live connection. A required sign-in stops renewal
 * for that credential, so the existing expiry notice appears when it lapses.
 */
export const runIdentityRenewalWorker = Effect.fn("IdentityRenewalWorker.run")(function* (input: {
  readonly renewal: IdentityRenewalService;
  readonly registry: Required<
    Pick<EnvironmentRegistry["Service"], "entries" | "replaceCredential">
  >;
  readonly credentials: Pick<ConnectionCredentialStore["Service"], "get">;
}) {
  const { renewal, registry, credentials } = input;
  const wake = yield* Queue.sliding<void>(1);
  const signal = Queue.offer(wake, undefined);
  const schedules = new Map<string, RenewalSchedule>();
  const inFlight = new Set<string>();

  // Subscribing before the first step means no catalog change slips between its read and the feed.
  yield* SubscriptionRef.changes(registry.entries).pipe(
    Stream.runForEach(() => signal),
    Effect.forkScoped({ startImmediately: true }),
  );

  const renew = Effect.fn("IdentityRenewalWorker.renew")(function* (
    connectionId: string,
    route: IdentityRoute,
    credential: IdentityCredential,
    schedule: RenewalSchedule,
  ) {
    const result = yield* renewIdentityCredential(renewal, {
      httpBaseUrl: route.httpBaseUrls[schedule.addressIndex % route.httpBaseUrls.length]!,
      credential,
      currentToken: credential.token,
    }).pipe(
      Effect.tap((outcome) =>
        outcome._tag === "Renewed"
          ? registry.replaceCredential(connectionId, outcome.credential)
          : Effect.void,
      ),
      // A defect would otherwise clear the in-flight mark and retry at once, forever.
      Effect.catchDefect((defect) =>
        Effect.logError("Identity renewal failed unexpectedly.", { connectionId, defect }).pipe(
          Effect.andThen(
            Effect.fail(
              new ConnectionTransientError({
                reason: "network",
                detail: "Identity renewal failed unexpectedly.",
              }),
            ),
          ),
        ),
      ),
      Effect.result,
    );
    if (result._tag === "Success") {
      if (result.success._tag === "SignInRequired") {
        schedule.stopped = true;
        yield* Effect.logInfo("Identity access needs a new sign-in.", {
          connectionId,
          reason: result.success.reason,
        });
        return;
      }
      // At the computer's sign-in age limit every renewal returns the same expiry, and renewing
      // again would only repeat; the expiry notice asks for a new sign-in once it lapses.
      const renewed = result.success.credential;
      if (renewed.identity.expiresAt <= credential.identity.expiresAt + RENEWAL_MIN_LEAD_MS) {
        schedules.set(connectionId, {
          ...newSchedule(renewed.token, yield* Clock.currentTimeMillis),
          stopped: true,
        });
        yield* Effect.logInfo("Identity access reached this computer's sign-in limit.", {
          connectionId,
        });
      }
      return;
    }
    if (result.failure._tag === "ConnectionBlockedError") {
      schedule.stopped = true;
      yield* Effect.logWarning("Identity renewal is blocked.", {
        connectionId,
        error: result.failure,
      });
      return;
    }
    const delayMs = nextIdentityRetryDelayMs(schedule.retryDelayMs);
    schedule.retryDelayMs = delayMs;
    schedule.addressIndex += 1;
    schedule.retryAt = (yield* Clock.currentTimeMillis) + delayMs;
    yield* Effect.logWarning("Could not renew Identity access; retrying.", {
      connectionId,
      delayMs,
      error: result.failure,
    });
  });

  const step = Effect.gen(function* () {
    const routes = identityRoutes(yield* SubscriptionRef.get(registry.entries));
    for (const connectionId of schedules.keys()) {
      if (!routes.has(connectionId)) schedules.delete(connectionId);
    }
    const now = yield* Clock.currentTimeMillis;
    let nextAt = Number.POSITIVE_INFINITY;
    for (const [connectionId, route] of routes) {
      if (inFlight.has(connectionId)) continue;
      const stored = Option.getOrNull(
        yield* credentials.get(connectionId).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      if (stored === null || !isIdentityCredential(stored) || !boundTo(stored, route)) {
        schedules.delete(connectionId);
        continue;
      }
      let schedule = schedules.get(connectionId);
      if (schedule?.token !== stored.token) {
        schedule = newSchedule(stored.token, now);
        schedules.set(connectionId, schedule);
      }
      if (schedule.stopped) continue;
      if (stored.identity.expiresAt <= now) {
        nextAt = Math.min(nextAt, now + EXPIRED_RECHECK_MS);
        continue;
      }
      const dueAt =
        schedule.retryAt ?? identityRenewalDueAt(stored.identity.expiresAt, schedule.observedAt);
      if (dueAt > now) {
        nextAt = Math.min(nextAt, dueAt);
        continue;
      }
      inFlight.add(connectionId);
      yield* renew(connectionId, route, stored, schedule).pipe(
        Effect.ensuring(
          Effect.sync(() => inFlight.delete(connectionId)).pipe(Effect.andThen(signal)),
        ),
        Effect.forkScoped,
      );
    }
    yield* Number.isFinite(nextAt)
      ? Queue.take(wake).pipe(Effect.timeoutOption(Duration.millis(nextAt - now)))
      : Queue.take(wake);
  });

  return yield* Effect.forever(step);
});

/** Plain browsers never see Identity tokens and provide no renewal, so nothing runs there. */
export const forkIdentityRenewalWorker = Effect.fn("IdentityRenewalWorker.fork")(function* (
  registry: Pick<EnvironmentRegistry["Service"], "entries" | "replaceCredential">,
) {
  const renewal = yield* IdentityRenewal;
  const { entries, replaceCredential } = registry;
  if (renewal === null || replaceCredential === undefined) return;
  const credentials = yield* ConnectionCredentialStore;
  yield* runIdentityRenewalWorker({
    renewal,
    registry: { entries, replaceCredential },
    credentials,
  }).pipe(Effect.forkScoped);
});
