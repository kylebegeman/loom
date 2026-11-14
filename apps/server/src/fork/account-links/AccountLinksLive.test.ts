import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  type AuthClientSession,
  type AuthMcpClientAccess,
  AuthSessionId,
  EnvironmentId,
  type PeerLink,
} from "@t3tools/contracts";
import {
  ACCOUNT_LINKS_ADMIT,
  ACCOUNT_LINKS_GRANT,
  ACCOUNT_LINKS_ROSTER,
  ACCOUNT_LINKS_VERIFY,
  type AccountLinkMember,
  type AccountLinkPolicy,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as PeerLinks from "../../peer/PeerLinks.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { AccountLinks } from "./AccountLinks.ts";
import * as AccountLinksLive from "./AccountLinksLive.ts";
import { AccountLinksMigrations } from "./migrations.ts";

const PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=\n-----END PUBLIC KEY-----\n";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const keyBytes = new TextEncoder().encode(
  encodeJson({ privateKey: "unused-test-key", publicKey: PUBLIC_KEY }),
);

const A = EnvironmentId.make("computer-a");
const B = EnvironmentId.make("computer-b");
const OLD = EnvironmentId.make("computer-old");
const ACCOUNT = { authorityId: "library-authority", authorityEpoch: 1 };
const PUBLIC = "https://computer-b-loom.example.test";
const TAILNET = "http://computer-b.tail1234.ts.net:3773";
const DAY_MS = 24 * 60 * 60_000;

const memberB: AccountLinkMember = {
  environmentId: B,
  label: "Computer B",
  routes: [
    { kind: "tailnet", url: TAILNET },
    { kind: "tailnet", url: "http://127.0.0.1:3773" },
    { kind: "tailnet", url: "http://192.168.1.20:3773" },
    { kind: "public", url: `${PUBLIC}/` },
  ],
  linkable: true,
};
const memberOld: AccountLinkMember = {
  environmentId: OLD,
  label: "Old computer",
  routes: [{ kind: "public", url: "https://old-loom.example.test" }],
  linkable: false,
};

const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
  (request.body._tag === "Uint8Array"
    ? decodeJson(new TextDecoder().decode(request.body.body))
    : undefined) as Record<string, string> | undefined;
const respond = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
  HttpClientResponse.fromWeb(request, Response.json(body, { status }));

const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(AccountLinksMigrations);
  const world = {
    connection: "member" as "member" | "unavailable" | "none",
    policy: { enabled: true, access: "full-access" } as AccountLinkPolicy,
    members: [memberB, memberOld] as ReadonlyArray<AccountLinkMember>,
    rosterStatus: 200,
    verifyStatus: 200,
    verifiedSource: undefined as EnvironmentId | undefined,
    down: new Set<string>(),
    admitStatus: 200,
  };
  const rosterCalls = yield* Queue.unbounded<void>();
  const grants: Array<Record<string, string> | undefined> = [];
  const verifies: Array<Record<string, string> | undefined> = [];
  const presented: Array<{ origin: string; path: string; body?: Record<string, string> }> = [];
  const held = new Map<EnvironmentId, { link: PeerLink; token: string }>();
  const issued: Array<{
    sessionId: AuthSessionId;
    token: string;
    label: string;
    access: AuthMcpClientAccess;
    peerLink: boolean;
  }> = [];
  const live = new Set<AuthSessionId>();
  const revoked: Array<AuthSessionId> = [];

  const library = Layer.mock(LibraryConnection.LibraryConnectionService)({
    current: Effect.sync(() =>
      world.connection === "member"
        ? {
            kind: "remote" as const,
            origin: "https://library.example.test",
            endpoint: (path: string) => `https://library.example.test${path}`,
            credential: {
              version: 1 as const,
              sourceEnvironmentId: A,
              libraryEnvironmentId: EnvironmentId.make("library"),
              libraryUrl: "https://library.example.test",
              sessionId: "publisher",
              accessToken: Redacted.make("publisher-token"),
              expiresAt: "2030-01-01T00:00:00Z",
              account: ACCOUNT,
            },
            send: (request: HttpClientRequest.HttpClientRequest) =>
              Effect.gen(function* () {
                const path = new URL(request.url).pathname;
                const body = bodyOf(request);
                if (path === ACCOUNT_LINKS_ROSTER) {
                  yield* Queue.offer(rosterCalls, undefined);
                  return respond(request, world.rosterStatus, {
                    account: ACCOUNT,
                    policy: world.policy,
                    members: world.members,
                  });
                }
                if (path === ACCOUNT_LINKS_GRANT) {
                  grants.push(body);
                  return respond(request, 200, {
                    grant: grants.length.toString(16).padStart(64, "0"),
                    access: world.policy.access,
                    expiresAt: 0,
                  });
                }
                if (path === ACCOUNT_LINKS_VERIFY) {
                  verifies.push(body);
                  return respond(request, world.verifyStatus, {
                    source: world.verifiedSource ?? body?.source,
                    label: "Computer B",
                    access: world.policy.access,
                    account: ACCOUNT,
                  });
                }
                return respond(request, 404, {});
              }),
          }
        : world.connection === "unavailable"
          ? { kind: "unavailable" as const, reason: "test" }
          : { kind: "none" as const },
    ) as unknown as LibraryConnection.LibraryConnectionService["Service"]["current"],
  });

  const peers = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const url = new URL(request.url);
        if (world.down.has(url.origin))
          return yield* new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause: "asleep" }),
          });
        const body = bodyOf(request);
        presented.push({ origin: url.origin, path: url.pathname, ...(body ? { body } : {}) });
        const now = yield* Clock.currentTimeMillis;
        return respond(request, world.admitStatus, {
          environmentId: B,
          access: world.policy.access,
          accessToken: `token-${presented.length}`,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 30 * DAY_MS)),
        });
      }),
    ),
  );

  const dependencies = Layer.mergeAll(
    library,
    peers,
    Layer.mock(PeerLinks.PeerLinks)({
      store: (link, token) =>
        Effect.sync(() => {
          held.set(link.environmentId, { link, token });
          return link;
        }),
      get: (environmentId) =>
        Effect.sync(() => Option.fromNullishOr(held.get(environmentId)?.link)),
      unlink: (environmentId) => Effect.sync(() => held.delete(environmentId)),
    }),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      issueMcpClientSession: (input) =>
        Effect.gen(function* () {
          const n = issued.length + 1;
          const session = {
            sessionId: AuthSessionId.make(`inbound-${n}`),
            token: `inbound-token-${n}`,
            expiresAt: DateTime.add(yield* DateTime.now, { days: 30 }),
          };
          issued.push({
            ...session,
            label: input.label,
            access: input.access,
            peerLink: input.peerLink,
          });
          live.add(session.sessionId);
          return session;
        }),
    }),
    Layer.mock(SessionStore.SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      listActive: () =>
        Effect.sync(() =>
          [...live].map((sessionId) => ({ sessionId }) as unknown as AuthClientSession),
        ),
      revoke: (sessionId) =>
        Effect.sync(() => {
          revoked.push(sessionId);
          return live.delete(sessionId);
        }),
      verify: (token) => {
        const session = issued.find((entry) => entry.token === token);
        return session === undefined || !live.has(session.sessionId)
          ? Effect.fail(new SessionStore.InvalidSessionTokenSignatureError())
          : Effect.succeed({
              sessionId: session.sessionId,
              token,
              method: "bearer-access-token" as const,
              client: { deviceType: "bot" as const },
              subject: "mcp-client",
              scopes: [],
              ...(session.peerLink ? { peerLink: true as const } : {}),
            });
      },
    }),
    Layer.mock(ServerSecretStore.ServerSecretStore)({ get: () => Effect.succeedSome(keyBytes) }),
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(A) }),
    NodeCrypto.layer,
  );
  const build = (layer: typeof AccountLinksLive.layer) =>
    Layer.build(layer.pipe(Layer.provide(dependencies))).pipe(
      Effect.map((context) => Context.get(context, AccountLinks)),
    );
  return {
    world,
    rosterCalls,
    grants,
    verifies,
    presented,
    held,
    issued,
    live,
    revoked,
    build,
  };
});

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory));

it("presents a grant at public and tailnet addresses only, never loopback or the LAN", () => {
  expect(AccountLinksLive.linkOrigins(memberB)).toEqual([PUBLIC, TAILNET]);
});

it.effect("links each linkable computer of the account and renews only what needs it", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const links = yield* f.build(AccountLinksLive.layer);
      f.world.down.add(PUBLIC);
      const status = yield* links.reconcile;

      expect(status.state).toBe("linked");
      expect(f.grants).toEqual([{ environmentId: B }]);
      // The public address was asleep, so the same grant went on to the tailnet one.
      expect(f.presented).toEqual([
        {
          origin: TAILNET,
          path: ACCOUNT_LINKS_ADMIT,
          body: { grant: "1".padStart(64, "0"), environmentId: A },
        },
      ]);
      expect(f.held.get(B)).toMatchObject({
        token: "token-1",
        link: { urls: [PUBLIC, TAILNET], access: "full-access", label: "Computer B" },
      });
      expect(
        status.outbound.map((entry) => [
          entry.environmentId,
          entry.expiresAt !== null,
          entry.lastError,
        ]),
      ).toEqual([
        [B, true, null],
        [OLD, false, "Old computer runs a Loom version without account links. Update it."],
      ]);
      expect([yield* links.holds(B), yield* links.holds(OLD), yield* links.holdsAny]).toEqual([
        true,
        false,
        true,
      ]);

      yield* links.reconcile;
      expect(f.grants).toHaveLength(1);

      f.world.policy = { enabled: true, access: "approval-required" };
      yield* links.reconcile;
      expect(f.grants).toHaveLength(2);
      expect(f.held.get(B)?.link.access).toBe("approval-required");

      yield* TestClock.adjust(`${23 * DAY_MS + 1} millis`);
      yield* links.reconcile;
      expect(f.grants).toHaveLength(3);

      f.world.admitStatus = 404;
      f.held.set(B, { ...f.held.get(B)!, link: { ...f.held.get(B)!.link, lastError: "gone" } });
      const failing = yield* links.reconcile;
      expect(failing.outbound[0]?.lastError).toBe(
        "Computer B runs a Loom version without account links. Update it.",
      );
    }),
  ),
);

it.effect(
  "keeps links while the Library is unreachable and drops them once it stops covering them",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const links = yield* f.build(AccountLinksLive.layer);
        const relink = Effect.gen(function* () {
          f.world.rosterStatus = 200;
          f.world.policy = { enabled: true, access: "full-access" };
          f.world.members = [memberB];
          f.world.connection = "member";
          expect((yield* links.reconcile).state).toBe("linked");
          expect(yield* links.holds(B)).toBe(true);
        });
        yield* relink;

        f.world.rosterStatus = 503;
        expect((yield* links.reconcile).state).toBe("retrying");
        f.world.connection = "unavailable";
        expect((yield* links.reconcile).state).toBe("retrying");
        expect([f.held.has(B), yield* links.holds(B)]).toEqual([true, true]);

        for (const leave of [
          () => {
            f.world.policy = { enabled: false, access: "full-access" };
          },
          () => {
            f.world.rosterStatus = 403;
          },
          () => {
            f.world.members = [];
          },
          () => {
            f.world.connection = "none";
          },
        ]) {
          yield* relink;
          leave();
          yield* links.reconcile;
          expect([f.held.has(B), yield* links.holds(B), yield* links.holdsAny]).toEqual([
            false,
            false,
            false,
          ]);
        }

        // A link the owner made by hand to the same computer is not the account's to remove.
        yield* relink;
        f.held.set(B, {
          ...f.held.get(B)!,
          link: { ...f.held.get(B)!.link, linkedAt: DateTime.makeUnsafe(1) },
        });
        f.world.members = [];
        yield* links.reconcile;
        expect([f.held.has(B), yield* links.holds(B)]).toEqual([true, false]);
      }),
    ),
);

it.effect("admits a computer the Library vouches for, one session per computer", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const links = yield* f.build(AccountLinksLive.layer);
      const grant = "9".repeat(64);

      const admission = yield* links.admit({ grant, environmentId: B });
      expect(f.verifies).toEqual([
        { grant, source: B, keyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      ]);
      expect(admission).toMatchObject({ environmentId: A, access: "full-access" });
      expect(Redacted.value(admission.accessToken)).toBe("inbound-token-1");
      expect(f.issued[0]).toMatchObject({ label: "Computer B · account link", peerLink: true });
      expect(yield* links.admits(AuthSessionId.make("inbound-1"))).toBe(true);
      expect(yield* links.admitsToken("inbound-token-1")).toBe(true);
      expect((yield* links.status).inbound.map((entry) => entry.environmentId)).toEqual([B]);

      yield* links.admit({ grant, environmentId: B });
      expect(f.revoked).toEqual([AuthSessionId.make("inbound-1")]);
      expect(yield* links.admits(AuthSessionId.make("inbound-1"))).toBe(false);
      expect(yield* links.admitsToken("inbound-token-1")).toBe(false);
      expect(yield* links.admitsToken("inbound-token-2")).toBe(true);

      const reason = (environmentId = B) =>
        links.admit({ grant, environmentId }).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        );
      expect(yield* reason(A)).toBe("denied");
      f.world.verifyStatus = 403;
      expect(yield* reason()).toBe("denied");
      f.world.verifyStatus = 503;
      expect(yield* reason()).toBe("unavailable");
      f.world.verifyStatus = 200;
      f.world.verifiedSource = OLD;
      expect(yield* reason()).toBe("denied");
      f.world.connection = "none";
      expect(yield* reason()).toBe("disabled");
      expect(f.issued).toHaveLength(2);

      // A roster that no longer lists the computer, or a lower access, ends its session here.
      f.world.connection = "member";
      f.world.members = [];
      yield* links.reconcile;
      expect(f.live.has(AuthSessionId.make("inbound-2"))).toBe(false);
      expect(yield* links.admitsToken("inbound-token-2")).toBe(false);
      expect((yield* links.status).inbound).toEqual([]);
    }),
  ),
);

it.effect("checks at start, right after a new computer links here, and then on its interval", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const links = yield* f.build(AccountLinksLive.layerWithReconciler);
      yield* Queue.take(f.rosterCalls);

      yield* links.admit({ grant: "9".repeat(64), environmentId: B });
      yield* Queue.take(f.rosterCalls);

      // A second admission from the same computer is a renewal, not a join.
      yield* links.admit({ grant: "8".repeat(64), environmentId: B });
      yield* TestClock.adjust(AccountLinksLive.RECONCILE_INTERVAL);
      yield* Queue.take(f.rosterCalls);
      expect(yield* Queue.size(f.rosterCalls)).toBe(0);
    }),
  ),
);
