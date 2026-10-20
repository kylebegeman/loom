import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentId,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as AuthSessions from "../../persistence/AuthSessions.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { randomPreviewNonce } from "../preview-links/ticket.ts";
import { PreviewAccessMigrations } from "./migrations.ts";
import * as PreviewAccess from "./PreviewAccessService.ts";
import { makeStore } from "./store.ts";

const LIBRARY_ORIGIN = "https://library.example.test";
const PAGES_HOST = "pages.example.test";
const AUTHORITY_ENV = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY_ORIGIN}/api/loom/identity/callback`,
  LOOM_PAGES_ORIGIN: `https://${PAGES_HOST}`,
};
const OPERATOR = {
  subject: "owner",
  scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
};
/** The Library's own computer, which registers its hosts in-process without a session. */
const LIBRARY_ENVIRONMENT = EnvironmentId.make("environment-library");

type Service = PreviewAccess.PreviewAccessService["Service"];

const memorySecrets = () => {
  const values = new Map<string, Uint8Array>();
  return ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
};

/** One run of the Library; runs that share `secrets` share the ticket key, as restarts do. */
const startService = (env: Record<string, string>, secrets = memorySecrets()) =>
  PreviewAccess.PreviewAccessService.pipe(
    Effect.provide(
      PreviewAccess.layer.pipe(
        Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
        Layer.provide(
          Layer.succeed(ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(LIBRARY_ENVIRONMENT),
          }),
        ),
        Layer.provide(AuthSessions.layer),
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      ),
    ),
  );

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(PreviewAccessMigrations);
    return yield* effect;
  }).pipe(
    Effect.provide(SqlitePersistenceMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

const withService = <A, E>(
  env: Record<string, string>,
  use: (service: Service) => Effect.Effect<A, E>,
) => withDatabase(Effect.flatMap(startService(env), use));

const ticketFor = (service: Service, host: string, nonce: string) =>
  service.ticket({ host, nonce, path: "/p/AbCdEfGhIjKlMnOpQrStUv", session: OPERATOR }).pipe(
    Effect.map((outcome) => {
      expect(outcome._tag).toBe("Ticket");
      const token = new URL(outcome.location).searchParams.get("ticket");
      if (token === null) throw new Error("The ticket redirect carries no ticket.");
      return token;
    }),
  );

/** A ticket the Library signs for its own pages host, as the browser carries it there. */
const pagesTicket = (service: Service, nonce: string) => ticketFor(service, PAGES_HOST, nonce);

describe("PreviewAccessService pages tickets", () => {
  it.effect("names the configured public origin as the pages issuer", () =>
    Effect.gen(function* () {
      expect(yield* withService(AUTHORITY_ENV, (s) => Effect.succeed(s.issuerOrigin))).toBe(
        LIBRARY_ORIGIN,
      );
      const { LOOM_IDENTITY_REDIRECT_URI: _, ...withoutRedirect } = AUTHORITY_ENV;
      expect(yield* withService(withoutRedirect, (s) => Effect.succeed(s.issuerOrigin))).toBeNull();
      const { LOOM_LIBRARY_AUTHORITY: __, ...notAuthority } = AUTHORITY_ENV;
      expect(yield* withService(notAuthority, (s) => Effect.succeed(s.issuerOrigin))).toBeNull();
      expect(
        yield* withService(
          { ...AUTHORITY_ENV, LOOM_IDENTITY_REDIRECT_URI: "http://library.example.test/callback" },
          (s) => Effect.succeed(s.issuerOrigin),
        ),
      ).toBeNull();
    }),
  );

  it.effect("verifies a ticket it signed for its pages host", () =>
    withService(AUTHORITY_ENV, (service) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        const token = yield* pagesTicket(service, nonce);
        const verified = yield* service.verifyTicket({ token, host: PAGES_HOST, nonce });
        expect(verified).toMatchObject({ subject: "owner" });
        expect(verified?.ticketId).toMatch(/^[0-9a-f-]{36}$/);
      }),
    ),
  );

  it.effect("refuses a ticket for another nonce or host, and anything malformed", () =>
    withService(AUTHORITY_ENV, (service) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        const token = yield* pagesTicket(service, nonce);
        const verify = (input: Partial<PreviewAccess.PreviewVerifyTicketInput>) =>
          service.verifyTicket({
            token: input.token ?? token,
            host: input.host ?? PAGES_HOST,
            nonce: input.nonce ?? nonce,
          });
        expect(yield* verify({ nonce: randomPreviewNonce() })).toBeNull();
        expect(yield* verify({ host: "other.example.test" })).toBeNull();
        expect(yield* verify({ nonce: "short" })).toBeNull();
        expect(yield* verify({ token: "not.a.ticket" })).toBeNull();
      }),
    ),
  );

  it.effect("signs nothing without a configured public origin", () => {
    const { LOOM_IDENTITY_REDIRECT_URI: _, ...withoutRedirect } = AUTHORITY_ENV;
    return withService(withoutRedirect, (service) =>
      Effect.gen(function* () {
        const error = yield* service
          .ticket({
            host: PAGES_HOST,
            nonce: randomPreviewNonce(),
            path: "/",
            session: OPERATOR,
          })
          .pipe(Effect.flip);
        expect(error.reason).toBe("not-authority");
      }),
    );
  });

  it.effect(
    "never accepts a ticket signed before a restart, which only memory knew was spent",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const secrets = memorySecrets();
          const before = yield* startService(AUTHORITY_ENV, secrets);
          const nonce = randomPreviewNonce();
          const token = yield* pagesTicket(before, nonce);
          yield* TestClock.adjust("1 second");
          const after = yield* startService(AUTHORITY_ENV, secrets);
          expect(yield* after.verifyTicket({ token, host: PAGES_HOST, nonce })).toBeNull();
          expect(yield* before.verifyTicket({ token, host: PAGES_HOST, nonce })).not.toBeNull();
          const fresh = yield* pagesTicket(after, nonce);
          expect(
            yield* after.verifyTicket({ token: fresh, host: PAGES_HOST, nonce }),
          ).not.toBeNull();
        }),
      ),
  );

  it.effect("stops signing for a computer once the session it registered with expires", () =>
    withDatabase(
      Effect.gen(function* () {
        const sessions = yield* AuthSessions.AuthSessionRepository;
        // A shared enrollment token: one operator session that registers several computers.
        const sessionId = AuthSessionId.make("shared-enrollment");
        yield* sessions.create({
          sessionId,
          subject: "shared-enrollment",
          scopes: OPERATOR.scopes,
          method: "bearer-access-token",
          client: {
            label: null,
            ipAddress: null,
            userAgent: null,
            deviceType: "unknown",
            os: null,
            browser: null,
          },
          issuedAt: DateTime.makeUnsafe(0),
          expiresAt: DateTime.makeUnsafe(60 * 60 * 1000),
        });
        const service = yield* startService(AUTHORITY_ENV);
        yield* service.register({
          environmentId: EnvironmentId.make("environment-nora"),
          sessionId,
          previews: { machine: "nora", suffix: "bagels.top" },
        });
        const host = "3000-abc123-nora.bagels.top";
        const nonce = randomPreviewNonce();
        yield* ticketFor(service, host, nonce);
        yield* TestClock.adjust("2 hours");
        expect((yield* ticketFor(service, host, nonce).pipe(Effect.flip)).reason).toBe("not-found");
      }).pipe(Effect.provide(AuthSessions.layer)),
    ),
  );

  it.effect("signs for the hosts of the computer it is itself, which has no session to end", () =>
    withService(AUTHORITY_ENV, (service) =>
      Effect.gen(function* () {
        const host = "3000-abc123-dorothy.bagels.top";
        const nonce = randomPreviewNonce();
        const unknown = yield* ticketFor(service, host, nonce).pipe(Effect.flip);
        expect(unknown.reason).toBe("not-found");
        const access = yield* service.register({
          environmentId: LIBRARY_ENVIRONMENT,
          sessionId: null,
          previews: { machine: "dorothy", suffix: "bagels.top" },
        });
        expect(access.origin).toBe(LIBRARY_ORIGIN);
        yield* TestClock.adjust("400 days");
        expect(yield* ticketFor(service, host, nonce)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      }),
    ),
  );

  it.effect("retires another computer's hosts that an older build stored without a session", () =>
    withDatabase(
      Effect.gen(function* () {
        const service = yield* startService(AUTHORITY_ENV);
        const sql = yield* SqlClient.SqlClient;
        // Older builds wrote rows with no session, so a downgrade can leave one nothing revokes.
        yield* sql`INSERT INTO fork_preview_hosts (subject, environment_id, machine, suffix, updated_at)
          VALUES ('loom-host:environment-nora', 'environment-nora', 'nora', 'bagels.top', '1970-01-01T00:00:00.000Z')`;
        const nonce = randomPreviewNonce();
        const error = yield* ticketFor(service, "3000-abc123-nora.bagels.top", nonce).pipe(
          Effect.flip,
        );
        expect(error.reason).toBe("not-found");
        expect(yield* sql`SELECT subject FROM fork_preview_hosts`).toEqual([]);
      }),
    ),
  );
});

describe("PreviewAccessStore", () => {
  it.effect("keeps a computer's hosts when a newer session registered them after the read", () =>
    withDatabase(
      Effect.gen(function* () {
        const store = yield* makeStore;
        const stale = {
          subject: "loom-host:environment-nora",
          environmentId: "environment-nora",
          sessionId: AuthSessionId.make("session-old"),
          machine: "nora",
          suffix: "bagels.top",
        };
        yield* store.put(stale, "2026-01-01T00:00:00.000Z");
        const current = { ...stale, sessionId: AuthSessionId.make("session-new") };
        yield* store.put(current, "2026-01-02T00:00:00.000Z");
        yield* store.forget(stale);
        expect(yield* store.list()).toEqual([current]);
        yield* store.forget(current);
        expect(yield* store.list()).toEqual([]);
      }),
    ),
  );
});
