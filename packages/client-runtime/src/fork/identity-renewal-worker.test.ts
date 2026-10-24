import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
} from "../connection/catalog.ts";
import {
  BearerConnectionTarget,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "../connection/model.ts";
import type { IdentityRenewalOutcome, IdentityRenewalRequest } from "./identity-renewal.ts";
import {
  identityRenewalDueAt,
  nextIdentityRetryDelayMs,
  runIdentityRenewalWorker,
} from "./identity-renewal-worker.ts";

const environmentId = EnvironmentId.make("environment-identity");
const identity = { issuer: "https://id.example", subject: "user-1" };
const SOURCE_ID = "bearer-studio";
const LEARNED_ID = `learned:${environmentId}:https://studio.lan@${SOURCE_ID}`;
const HOUR_MS = 60 * 60_000;

const profile = (connectionId: string, httpBaseUrl: string, learned?: true) =>
  new BearerConnectionProfile({
    connectionId,
    environmentId,
    label: "Studio",
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace("https", "wss"),
    identity,
    ...(learned ? { learned } : {}),
  });

const entry: ConnectionCatalogEntry = {
  target: new BearerConnectionTarget({ environmentId, label: "Studio", connectionId: SOURCE_ID }),
  profile: Option.some(profile(SOURCE_ID, "https://studio.example")),
  alternateRoutes: [
    {
      target: new BearerConnectionTarget({
        environmentId,
        label: "Studio",
        connectionId: LEARNED_ID,
      }),
      profile: Option.some(profile(LEARNED_ID, "https://studio.lan", true)),
    },
  ],
  enabled: true,
};

type ScriptedOutcome = Effect.Effect<IdentityRenewalOutcome, ConnectionAttemptError>;

const startWorker = Effect.fn("test.startWorker")(function* (
  script: ReadonlyArray<ScriptedOutcome> = [],
) {
  const start = yield* Clock.currentTimeMillis;
  const stored = new Map<string, ConnectionCredential>([
    [
      SOURCE_ID,
      new BearerConnectionCredential({
        token: "token-0",
        identity: { ...identity, environmentId, expiresAt: start + HOUR_MS },
      }),
    ],
  ]);
  const requests: Array<IdentityRenewalRequest> = [];
  const replaced: Array<{ connectionId: string; credential: ConnectionCredential }> = [];
  const entries = yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
    new Map([[environmentId, entry]]),
  );
  yield* runIdentityRenewalWorker({
    renewal: {
      renew: (request) =>
        Effect.suspend(() => {
          requests.push(request);
          return (
            script[requests.length - 1] ??
            Clock.currentTimeMillis.pipe(
              Effect.map((now): IdentityRenewalOutcome => ({
                _tag: "Renewed",
                token: `token-${requests.length}`,
                expiresAt: now + HOUR_MS,
              })),
            )
          );
        }),
      forget: () => Effect.void,
    },
    registry: {
      entries,
      replaceCredential: (connectionId, credential) =>
        Effect.sync(() => {
          replaced.push({ connectionId, credential });
          stored.set(connectionId, credential);
        }),
    },
    credentials: {
      get: (connectionId) => Effect.sync(() => Option.fromNullishOr(stored.get(connectionId))),
    },
  }).pipe(Effect.forkScoped({ startImmediately: true }));
  return { start, requests, replaced };
});

const transient = new ConnectionTransientError({ reason: "network", detail: "offline" });

describe("identity renewal worker", () => {
  it.effect(
    "renews shortly before expiry, once per source credential, and swaps the credential",
    () =>
      Effect.gen(function* () {
        const { start, requests, replaced } = yield* startWorker();

        yield* TestClock.adjust("49 minutes");
        expect(requests).toHaveLength(0);

        yield* TestClock.adjust("1 minute");
        expect(requests).toEqual([
          {
            httpBaseUrl: "https://studio.example",
            environmentId,
            identity,
            currentToken: "token-0",
          },
        ]);
        expect(replaced).toEqual([
          {
            connectionId: SOURCE_ID,
            credential: new BearerConnectionCredential({
              token: "token-1",
              identity: { ...identity, environmentId, expiresAt: start + 50 * 60_000 + HOUR_MS },
            }),
          },
        ]);

        // The renewed credential gets its own schedule, again ten minutes before it expires.
        yield* TestClock.adjust("49 minutes");
        expect(requests).toHaveLength(1);
        yield* TestClock.adjust("1 minute");
        expect(requests.map((request) => request.currentToken)).toEqual(["token-0", "token-1"]);
      }),
  );

  it.effect("backs off after transient failures and stops when a new sign-in is required", () =>
    Effect.gen(function* () {
      const { requests, replaced } = yield* startWorker([
        Effect.fail(transient),
        Effect.fail(transient),
        Effect.succeed({ _tag: "SignInRequired", reason: "Session limit reached." }),
      ]);

      yield* TestClock.adjust("50 minutes");
      expect(requests).toHaveLength(1);

      yield* TestClock.adjust("29 seconds");
      expect(requests).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      expect(requests).toHaveLength(2);

      yield* TestClock.adjust("59 seconds");
      expect(requests).toHaveLength(2);
      yield* TestClock.adjust("1 second");
      expect(requests).toHaveLength(3);

      yield* TestClock.adjust("2 hours");
      expect(requests).toHaveLength(3);
      expect(replaced).toEqual([]);
    }),
  );

  it.effect("tries the learned address when the sign-in address is unreachable", () =>
    Effect.gen(function* () {
      const { requests, replaced } = yield* startWorker([Effect.fail(transient)]);

      yield* TestClock.adjust("50 minutes");
      yield* TestClock.adjust("30 seconds");
      expect(requests.map((request) => request.httpBaseUrl)).toEqual([
        "https://studio.example",
        "https://studio.lan",
      ]);
      expect(replaced.map((entry) => entry.connectionId)).toEqual([SOURCE_ID]);
    }),
  );

  it.effect("stops once a renewal no longer extends access at the sign-in age limit", () =>
    Effect.gen(function* () {
      const capped = (yield* Clock.currentTimeMillis) + HOUR_MS;
      const { requests, replaced } = yield* startWorker([
        Effect.succeed({ _tag: "Renewed", token: "token-capped", expiresAt: capped }),
      ]);

      yield* TestClock.adjust("50 minutes");
      expect(requests).toHaveLength(1);
      expect(replaced.map((entry) => entry.credential.token)).toEqual(["token-capped"]);

      yield* TestClock.adjust("2 hours");
      expect(requests).toHaveLength(1);
    }),
  );

  it("keeps the renewal lead between thirty seconds and ten minutes", () => {
    expect(identityRenewalDueAt(HOUR_MS, 0)).toBe(50 * 60_000);
    expect(identityRenewalDueAt(8 * 60_000, 0)).toBe(6 * 60_000);
    expect(identityRenewalDueAt(60_000, 0)).toBe(30_000);
    expect(
      [null, 30_000, 4 * 60_000, 5 * 60_000].map((previous) => nextIdentityRetryDelayMs(previous)),
    ).toEqual([30_000, 60_000, 5 * 60_000, 5 * 60_000]);
  });
});
