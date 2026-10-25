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
import {
  LIBRARY_PUBLISHER_RENEW_ROUTE,
  DIRECTORY_REPORT_TOKEN_MAX_LENGTH,
  DirectoryEnvironment,
  DirectoryError,
  DirectoryListing,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as ConfigProvider from "effect/ConfigProvider";
import * as PublisherCredential from "../../auth/LibraryPublishingCredential.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import {
  DIRECTORY_LIST_ROUTE,
  DIRECTORY_REPORT_ROUTE,
  DirectoryService,
} from "./DirectoryService.ts";
import { DirectoryHttpRoutes } from "./http.ts";

const ORIGIN = "http://library.example.test";
const STUDIO = EnvironmentId.make("environment-studio");
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJzZWNyZXQiOiJyZXBvcnQifQ.c2lnbmF0dXJl";
const REPORT = {
  token: TOKEN,
  publicKey: "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=",
};

const STORED = Schema.decodeSync(DirectoryEnvironment)({
  environmentId: STUDIO,
  label: "Studio",
  serverVersion: "0.0.0-test",
  platform: { os: "darwin", arch: "arm64" },
  supportsExecution: true,
  loomFeatures: ["core"],
  routes: [{ kind: "tailnet", url: "https://computer.example.ts.net/" }],
  providers: [],
  sequence: 1,
  reportedAt: "2026-10-20T12:00:00.000Z",
  keyFingerprint: "0".repeat(64),
  firstSeenAt: "2026-10-20T12:00:00.000Z",
  receivedAt: "2026-10-20T12:00:00.000Z",
});
const LISTING = Schema.decodeSync(DirectoryListing)({
  environments: [STORED],
  machines: [],
  generatedAt: "2026-10-20T12:00:00.000Z",
});
const STORED_JSON = Schema.encodeSync(DirectoryEnvironment)(STORED);
const LISTING_JSON = Schema.encodeSync(DirectoryListing)(LISTING);

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});
const PUBLISHER = sessionFor(`loom-host:${STUDIO}`, [AuthLibraryPublishScope]);
const OPERATOR = sessionFor("owner", [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);

const fixture = (authority = true) =>
  Effect.gen(function* () {
    const caller = yield* Ref.make<EnvironmentAuth.AuthenticatedSession | null>(PUBLISHER);
    const refusal = yield* Ref.make<DirectoryError["reason"] | null>(null);
    const reportedFor = yield* Ref.make<ReadonlyArray<EnvironmentId>>([]);
    const refuse = Ref.get(refusal).pipe(
      Effect.flatMap((reason) =>
        reason === null ? Effect.void : Effect.fail(new DirectoryError({ reason })),
      ),
    );
    const renewals = yield* Ref.make(0);
    const context = yield* Layer.build(
      Layer.mergeAll(
        Layer.mock(PublisherCredential.LibraryPublishingCredential)({
          renew: (token) =>
            token === "publisher-test"
              ? Ref.update(renewals, (count) => count + 1).pipe(
                  Effect.as({
                    sessionId: "successor",
                    accessToken: "successor-test",
                    issuedAt: "2026-10-25T00:00:00.000Z",
                    expiresAt: "2026-11-24T00:00:00.000Z",
                  }),
                )
              : Effect.fail(
                  new PublisherCredential.LibraryPublishingCredentialError({ reason: "invalid" }),
                ),
        }),
        Layer.mock(DirectoryService)({
          report: ({ environmentId }) =>
            refuse.pipe(
              Effect.andThen(Ref.update(reportedFor, (ids) => [...ids, environmentId])),
              Effect.as(STORED),
            ),
          list: refuse.pipe(Effect.as(LISTING)),
        }),
      ),
    );
    const app = DirectoryHttpRoutes.pipe(
      Layer.provide(
        Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>),
      ),
      HttpRouter.provideRequest(
        Layer.mergeAll(
          NodeHttpPlatform.layer,
          Layer.succeed(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv({
              env: { LOOM_LIBRARY_AUTHORITY: String(authority) },
            }),
          ),
          Layer.succeedContext(context),
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateHttpRequest: () =>
              Ref.get(caller).pipe(
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
    const post = (route: string, body: string, headers: Record<string, string> = {}) =>
      Effect.promise(() =>
        web.handler(
          new Request(`${ORIGIN}${route}`, {
            method: "POST",
            body,
            headers: { "content-type": "application/json", ...headers },
          }),
        ),
      );
    return { caller, refusal, reportedFor, post, renewals };
  });

const run = <A, E>(
  use: (f: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E>,
  authority = true,
) => fixture(authority).pipe(Effect.flatMap(use), Effect.scoped);

const bodyOf = (response: Response) => Effect.promise(() => response.json());
const textOf = (response: Response) => Effect.promise(() => response.text());

describe("directory routes", () => {
  it.effect("store a report only for the computer its publisher session names", () =>
    run((f) =>
      Effect.gen(function* () {
        const stored = yield* f.post(DIRECTORY_REPORT_ROUTE, JSON.stringify(REPORT));
        expect(stored.status).toBe(200);
        expect(stored.headers.get("cache-control")).toBe("no-store");
        expect(yield* bodyOf(stored)).toEqual(STORED_JSON);
        expect(yield* Ref.get(f.reportedFor)).toEqual([STUDIO]);

        yield* Ref.set(f.caller, null);
        const anonymous = yield* f.post(DIRECTORY_REPORT_ROUTE, JSON.stringify(REPORT));
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get("cache-control")).toBe("no-store");

        for (const session of [
          OPERATOR,
          sessionFor("mcp-client", [AuthLibraryPublishScope, AuthOrchestrationOperateScope]),
          sessionFor(`loom-host:${STUDIO}`, [AuthOrchestrationReadScope]),
          sessionFor("loom-host:", [AuthLibraryPublishScope]),
          sessionFor(`computer:${STUDIO}`, [AuthLibraryPublishScope]),
        ]) {
          yield* Ref.set(f.caller, session);
          const denied = yield* f.post(DIRECTORY_REPORT_ROUTE, JSON.stringify(REPORT));
          expect(denied.status).toBe(403);
          expect(denied.headers.get("cache-control")).toBe("no-store");
        }
        expect(yield* Ref.get(f.reportedFor)).toEqual([STUDIO]);
      }),
    ),
  );

  it.effect("refuse unreadable and oversized bodies without echoing them", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const body of [
          "not json",
          JSON.stringify({ token: TOKEN }),
          JSON.stringify({ token: TOKEN, publicKey: "k".repeat(200) }),
        ]) {
          const refused = yield* f.post(DIRECTORY_REPORT_ROUTE, body);
          expect(refused.status).toBe(400);
          const text = yield* textOf(refused);
          expect(JSON.parse(text)).toEqual({ reason: "invalid" });
          expect(text.includes(TOKEN)).toBe(false);
        }
        const oversized = yield* f.post(DIRECTORY_REPORT_ROUTE, JSON.stringify(REPORT), {
          "content-length": String(2 * DIRECTORY_REPORT_TOKEN_MAX_LENGTH),
        });
        expect(oversized.status).toBe(413);
        expect(yield* bodyOf(oversized)).toEqual({ reason: "invalid" });
        expect(yield* Ref.get(f.reportedFor)).toEqual([]);
      }),
    ),
  );

  it.effect("answer each refusal with a status a computer can act on", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const [reason, status] of [
          ["not-authority", 404],
          ["unverified", 400],
          ["wrong-environment", 403],
          ["key-changed", 409],
          ["stale-sequence", 409],
          ["io", 503],
        ] as const) {
          yield* Ref.set(f.refusal, reason);
          const refused = yield* f.post(DIRECTORY_REPORT_ROUTE, JSON.stringify(REPORT));
          expect(refused.status).toBe(status);
          expect(yield* bodyOf(refused)).toEqual({ reason });
        }
      }),
    ),
  );

  it.effect("list for publisher and operator sessions only", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const session of [PUBLISHER, OPERATOR]) {
          yield* Ref.set(f.caller, session);
          const listed = yield* f.post(DIRECTORY_LIST_ROUTE, "{}");
          expect(listed.status).toBe(200);
          expect(yield* bodyOf(listed)).toEqual(LISTING_JSON);
        }
        for (const session of [
          sessionFor("owner", [AuthOrchestrationReadScope]),
          sessionFor("mcp-client", [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
        ]) {
          yield* Ref.set(f.caller, session);
          expect((yield* f.post(DIRECTORY_LIST_ROUTE, "{}")).status).toBe(403);
        }
        yield* Ref.set(f.caller, OPERATOR);
        yield* Ref.set(f.refusal, "not-authority");
        const elsewhere = yield* f.post(DIRECTORY_LIST_ROUTE, "{}");
        expect(elsewhere.status).toBe(404);
        expect(yield* bodyOf(elsewhere)).toEqual({ reason: "not-authority" });
      }),
    ),
  );
});

it.effect("renews only an HTTPS publisher bearer and never caches the response", () =>
  run((f) =>
    Effect.gen(function* () {
      const headers = { authorization: "Bearer publisher-test", "x-forwarded-proto": "https" };
      const renewed = yield* f.post(LIBRARY_PUBLISHER_RENEW_ROUTE, "", headers);
      expect(renewed.status).toBe(200);
      expect(renewed.headers.get("cache-control")).toBe("no-store");
      expect(yield* bodyOf(renewed)).toMatchObject({ sessionId: "successor" });
      for (const [requestHeaders, status] of [
        [{ ...headers, "x-forwarded-proto": "http" }, 403],
        [{ ...headers, authorization: "" }, 403],
        [{ ...headers, authorization: "Bearer invalid-test" }, 401],
      ] as const) {
        const denied = yield* f.post(LIBRARY_PUBLISHER_RENEW_ROUTE, "", requestHeaders);
        expect(denied.status).toBe(status);
        expect(denied.headers.get("cache-control")).toBe("no-store");
        expect(yield* textOf(denied)).not.toContain("test");
      }
      expect(yield* Ref.get(f.renewals)).toBe(1);
    }),
  ),
);
it.effect("does not issue a publisher successor on another computer", () =>
  run(
    (f) =>
      Effect.gen(function* () {
        const denied = yield* f.post(LIBRARY_PUBLISHER_RENEW_ROUTE, "", {
          authorization: "Bearer publisher-test",
          "x-forwarded-proto": "https",
        });
        expect(denied.status).toBe(404);
        expect(yield* Ref.get(f.renewals)).toBe(0);
      }),
    false,
  ),
);
