import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { LOOM_IDENTITY_LOGIN_PATH, LibraryPreviewAccess } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as AuthSessions from "../../persistence/AuthSessions.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import {
  PREVIEW_TICKET_PATH,
  previewTicketAudience,
  previewTicketPublicKey,
  randomPreviewNonce,
  verifyPreviewTicket,
} from "../preview-links/ticket.ts";
import { PreviewAccessHttpRoutes } from "./http.ts";
import { PreviewAccessMigrations } from "./migrations.ts";
import * as PreviewAccess from "./PreviewAccessService.ts";

const LIBRARY_ORIGIN = "https://library.example.test";
const COMPUTER = "loom-host:environment-dorothy";
const HOST = "3000-abc123-dorothy.bagels.top";
const AUTHORITY_ENV = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY_ORIGIN}/api/loom/identity/callback`,
  LOOM_PAGES_ORIGIN: "https://pages.example.test",
};

const decodeAccess = Schema.decodeUnknownEffect(LibraryPreviewAccess);

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});

/** Far enough out for the live-clock tests too. */
const LONG_LIVED = DateTime.makeUnsafe("2100-01-01T00:00:00Z");

const fixture = (env: Record<string, string>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(PreviewAccessMigrations);
    const sessions = yield* AuthSessions.AuthSessionRepository;
    /** The Library's record of a session, which every authenticated caller already has. */
    const enroll = (session: EnvironmentAuth.AuthenticatedSession) =>
      sessions.createIfAbsent({
        sessionId: session.sessionId,
        subject: session.subject,
        scopes: session.scopes,
        method: session.method,
        client: {
          label: null,
          ipAddress: null,
          userAgent: null,
          deviceType: "unknown",
          os: null,
          browser: null,
        },
        issuedAt: DateTime.makeUnsafe(0),
        expiresAt: LONG_LIVED,
      });
    const secretValues = new Map<string, Uint8Array>();
    const secrets = ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromNullishOr(secretValues.get(name))),
      set: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
      create: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
      getOrCreateRandom: (name, bytes) => Effect.succeed(new Uint8Array(bytes)),
      remove: (name) => Effect.sync(() => void secretValues.delete(name)),
    });
    const service = yield* PreviewAccess.PreviewAccessService.pipe(
      Effect.provide(
        PreviewAccess.layer.pipe(
          Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
          Layer.provide(
            Layer.succeed(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-library")),
            }),
          ),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    );
    const caller = yield* Ref.make(sessionFor(COMPUTER, [AuthLibraryPublishScope]));
    const browser = yield* Ref.make<EnvironmentAuth.AuthenticatedSession | null>(null);
    const runtime = Context.make(
      PreviewAccess.PreviewAccessService,
      service,
    ) as Context.Context<ForkServices>;
    const app = PreviewAccessHttpRoutes.pipe(
      Layer.provide(Layer.succeed(ForkRuntime, runtime)),
      HttpRouter.provideRequest(
        Layer.merge(
          NodeHttpPlatform.layer,
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateHttpRequest: () => Ref.get(caller),
            authenticateBrowserSession: () =>
              Ref.get(browser).pipe(
                Effect.filterOrFail(
                  (session): session is EnvironmentAuth.AuthenticatedSession => session !== null,
                  () => new EnvironmentAuth.ServerAuthMissingCredentialError(),
                ),
              ),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const register = (previews: unknown, environmentId?: string) =>
      Effect.gen(function* () {
        yield* enroll(yield* Ref.get(caller));
        return yield* Effect.promise(() =>
          web.handler(
            new Request("http://computer-route.test/api/loom/library/previews/register", {
              method: "POST",
              body: JSON.stringify(
                environmentId === undefined ? { previews } : { environmentId, previews },
              ),
              headers: { "content-type": "application/json", host: "computer-route.test" },
            }),
          ),
        );
      });
    const ticket = (query: Record<string, string>) =>
      Effect.promise(() =>
        web.handler(
          new Request(`${LIBRARY_ORIGIN}/api/loom/preview/ticket?${new URLSearchParams(query)}`, {
            redirect: "manual",
          }),
        ),
      );
    const hosts = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        subject: string;
        machine: string;
        suffix: string;
      }>`SELECT subject, machine, suffix FROM fork_preview_hosts`;
    });
    return { caller, browser, register, ticket, hosts, sessions };
  });

const run = <A, E>(
  env: Record<string, string>,
  use: (f: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  fixture(env).pipe(
    Effect.flatMap(use),
    Effect.provide(
      AuthSessions.layer.pipe(
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

const operator = sessionFor("owner", [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);

describe("Library preview registration", () => {
  it.effect("upserts a computer's hosts, deletes them on null and returns the ticket key", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        const first = yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        expect(first.status).toBe(200);
        expect(first.headers.get("cache-control")).toBe("no-store");
        const access = yield* decodeAccess(yield* Effect.promise(() => first.json()));
        expect(access).toMatchObject({
          origin: LIBRARY_ORIGIN,
          ticketPath: "/api/loom/preview/ticket",
          pagesOrigin: "https://pages.example.test",
        });
        expect(previewTicketPublicKey(access.publicKey)).not.toBeNull();

        const second = yield* f.register({ machine: "nora", suffix: "bagels.top" });
        const again = yield* decodeAccess(yield* Effect.promise(() => second.json()));
        // The key is created once and reused, so computers never hold a stale public key.
        expect(again.keyId).toBe(access.keyId);
        expect(yield* f.hosts).toEqual([
          { subject: COMPUTER, machine: "nora", suffix: "bagels.top" },
        ]);

        expect((yield* f.register(null)).status).toBe(200);
        expect(yield* f.hosts).toEqual([]);
      }),
    ),
  );

  it.effect("offers no preview sign-in until the Library's public origin is configured", () =>
    run({ LOOM_LIBRARY_AUTHORITY: "true" }, (f) =>
      Effect.gen(function* () {
        // The origin a computer happened to reach the Library on is no issuer browsers share.
        const response = yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        expect(response.status).toBe(404);
        expect(yield* Effect.promise(() => response.json())).toEqual({ reason: "not-authority" });
        expect(yield* f.hosts).toEqual([]);
        yield* Ref.set(f.browser, operator);
        expect((yield* f.ticket({ host: HOST, nonce: randomPreviewNonce() })).status).toBe(404);
      }),
    ),
  );

  // Live clock: the route signs with real time, so the check must read the same clock.
  it.live("keeps the identity callback's port in the issuer computers verify", () =>
    run(
      {
        LOOM_LIBRARY_AUTHORITY: "true",
        LOOM_IDENTITY_REDIRECT_URI: "https://library.example.test:8443/api/loom/identity/callback",
        LOOM_PAGES_ORIGIN: "https://pages.example.test:8443",
      },
      (f) =>
        Effect.gen(function* () {
          const response = yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
          const access = yield* decodeAccess(yield* Effect.promise(() => response.json()));
          expect(access.origin).toBe("https://library.example.test:8443");
          // A pages host with a port could never receive its ticket, so it is ignored.
          expect(access.pagesOrigin).toBeUndefined();
          yield* Ref.set(f.browser, operator);
          const nonce = randomPreviewNonce();
          const redirect = yield* f.ticket({ host: HOST, nonce });
          const token = new URL(redirect.headers.get("location")!).searchParams.get("ticket")!;
          const verified = verifyPreviewTicket(token, {
            publicKey: previewTicketPublicKey(access.publicKey)!,
            keyId: access.keyId,
            issuer: access.origin,
            audience: previewTicketAudience(HOST),
            nonce,
            nowMs: yield* Clock.currentTimeMillis,
          });
          expect(verified?.subject).toBe("owner");
        }),
    ),
  );

  it.effect("is not offered by a server that is not the Library authority", () =>
    run({}, (f) =>
      Effect.gen(function* () {
        const response = yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        expect(response.status).toBe(404);
        expect(yield* Effect.promise(() => response.json())).toEqual({ reason: "not-authority" });
        expect((yield* f.ticket({ host: HOST, nonce: randomPreviewNonce() })).status).toBe(404);
      }),
    ),
  );

  it.effect("refuses sessions that do not speak for the computer they name", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        const previews = { machine: "dorothy", suffix: "bagels.top" };
        // An operator token is shared by computers, so it has to say which one is registering.
        yield* Ref.set(f.caller, operator);
        expect((yield* f.register(previews)).status).toBe(403);
        yield* Ref.set(f.caller, sessionFor("mcp-client", [AuthLibraryPublishScope]));
        expect((yield* f.register(previews, "environment-dorothy")).status).toBe(403);
        yield* Ref.set(f.caller, sessionFor("viewer", [AuthOrchestrationReadScope]));
        expect((yield* f.register(previews, "environment-dorothy")).status).toBe(403);
        yield* Ref.set(f.caller, sessionFor(COMPUTER, [AuthLibraryPublishScope]));
        expect((yield* f.register(previews, "environment-nora")).status).toBe(403);
        expect((yield* f.register({ machine: "Dorothy!", suffix: "bagels.top" })).status).toBe(400);
        expect(yield* f.hosts).toEqual([]);
        // A computer's own session may still name itself.
        expect((yield* f.register(previews, "environment-dorothy")).status).toBe(200);
        expect(yield* f.hosts).toEqual([{ subject: COMPUTER, ...previews }]);
      }),
    ),
  );

  it.effect("registers the computer a shared operator token names", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.caller, operator);
        const response = yield* f.register(
          { machine: "nora", suffix: "bagels.top" },
          "environment-nora",
        );
        expect(response.status).toBe(200);
        expect(yield* f.hosts).toEqual([
          { subject: "loom-host:environment-nora", machine: "nora", suffix: "bagels.top" },
        ]);
      }),
    ),
  );
});

describe("Library preview tickets", () => {
  it.effect("sends a signed-out browser through Library sign-in and back", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        const response = yield* f.ticket({ host: HOST, nonce, path: "/docs?tab=1" });
        expect(response.status).toBe(302);
        const location = new URL(response.headers.get("location")!, LIBRARY_ORIGIN);
        expect(location.pathname).toBe(LOOM_IDENTITY_LOGIN_PATH);
        const returnTo = location.searchParams.get("returnTo")!;
        // PocketId keeps only same-origin paths without whitespace, so this must come back intact.
        expect(returnTo).toMatch(/^\/[^/\\\s]/);
        const back = new URL(returnTo, LIBRARY_ORIGIN);
        expect(back.pathname).toBe("/api/loom/preview/ticket");
        expect(Object.fromEntries(back.searchParams)).toEqual({
          host: HOST,
          nonce,
          path: "/docs?tab=1",
        });

        // Over Pocket ID's 2048 character limit the way back would silently become `/`.
        const long = yield* f.ticket({ host: HOST, nonce, path: `/${"a".repeat(3000)}` });
        const longReturnTo = new URL(
          long.headers.get("location")!,
          LIBRARY_ORIGIN,
        ).searchParams.get("returnTo")!;
        expect(longReturnTo.length).toBeLessThanOrEqual(2048);
        expect(new URL(longReturnTo, LIBRARY_ORIGIN).searchParams.get("path")).toBe("/");
      }),
    ),
  );

  it.effect("never redirects a signed-in browser anywhere but a registered host", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        yield* Ref.set(f.browser, operator);
        const nonce = randomPreviewNonce();
        for (const host of [
          `${HOST}.evil.example`,
          `evil.example/${HOST}`,
          `evil.example#.${HOST}`,
          `user@${HOST}`,
          `${HOST}:8443`,
          `${HOST}\r\nlocation: https://evil.example`,
          "",
        ]) {
          const response = yield* f.ticket({ host, nonce });
          expect(response.status).toBe(400);
          expect(response.headers.get("location")).toBeNull();
        }
      }),
    ),
  );

  it.effect("refuses a bad nonce, an unregistered host and a session that cannot run work", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        yield* Ref.set(f.browser, operator);
        const badNonce = yield* f.ticket({ host: HOST, nonce: "short" });
        expect(badNonce.status).toBe(400);
        expect(badNonce.headers.get("cache-control")).toBe("no-store");
        expect(badNonce.headers.get("content-security-policy")).toContain("default-src 'none'");
        expect(badNonce.headers.get("location")).toBeNull();
        const nonce = randomPreviewNonce();
        for (const host of ["3000-abc123-nora.bagels.top", "evil.example", "bagels.top"])
          expect((yield* f.ticket({ host, nonce })).status).toBe(400);
        yield* Ref.set(f.browser, sessionFor("viewer", [AuthOrchestrationReadScope]));
        expect((yield* f.ticket({ host: HOST, nonce })).status).toBe(403);
      }),
    ),
  );

  it.effect("stops signing for a computer once the session it registered with ends", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        const computer = sessionFor(COMPUTER, [AuthLibraryPublishScope]);
        yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        yield* Ref.set(f.browser, operator);
        const nonce = randomPreviewNonce();
        expect((yield* f.ticket({ host: HOST, nonce })).status).toBe(303);

        // Revoking the computer's Library session is how it leaves the Library.
        yield* f.sessions.revoke({
          sessionId: computer.sessionId,
          revokedAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
        });
        expect((yield* f.ticket({ host: HOST, nonce })).status).toBe(400);
        expect(yield* f.hosts).toEqual([]);

        // Enrolled again, it registers under its new session and signs in again.
        yield* Ref.set(f.caller, { ...computer, sessionId: AuthSessionId.make("session-again") });
        yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        expect((yield* f.ticket({ host: HOST, nonce })).status).toBe(303);
        expect(yield* f.hosts).toEqual([
          { subject: COMPUTER, machine: "dorothy", suffix: "bagels.top" },
        ]);
      }),
    ),
  );

  // Live clock: the route signs with real time, so the check must read the same clock.
  it.live("signs a ticket the preview host verifies for its own host and nonce", () =>
    run(AUTHORITY_ENV, (f) =>
      Effect.gen(function* () {
        const registered = yield* f.register({ machine: "dorothy", suffix: "bagels.top" });
        const access = yield* decodeAccess(yield* Effect.promise(() => registered.json()));
        yield* Ref.set(f.browser, operator);
        for (const host of [HOST.toUpperCase(), "pages.example.test"]) {
          const nonce = randomPreviewNonce();
          const response = yield* f.ticket({ host, nonce, path: "/app" });
          expect(response.status).toBe(303);
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(response.headers.get("referrer-policy")).toBe("no-referrer");
          const location = new URL(response.headers.get("location")!);
          const expectedHost = host.toLowerCase();
          expect(location.origin).toBe(`https://${expectedHost}`);
          expect(location.pathname).toBe(PREVIEW_TICKET_PATH);
          expect(location.searchParams.get("path")).toBe("/app");
          const expected = {
            publicKey: previewTicketPublicKey(access.publicKey)!,
            keyId: access.keyId,
            issuer: access.origin,
            audience: previewTicketAudience(expectedHost),
            nonce,
            nowMs: yield* Clock.currentTimeMillis,
          };
          const token = location.searchParams.get("ticket")!;
          expect(verifyPreviewTicket(token, expected)?.subject).toBe("owner");
          expect(
            verifyPreviewTicket(token, { ...expected, nonce: randomPreviewNonce() }),
          ).toBeNull();
          expect(
            verifyPreviewTicket(token, {
              ...expected,
              audience: previewTicketAudience("3000-zzz999-dorothy.bagels.top"),
            }),
          ).toBeNull();
        }
      }),
    ),
  );
});
