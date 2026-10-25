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
  REACH_LIST_ROUTE,
  REACH_ENSURE_ROUTE,
  REACH_REMOVE_ROUTE,
  REACH_REQUEST_MAX_BYTES,
} from "@t3tools/contracts/fork";
import { REACH_REQUEST_TYP } from "@t3tools/shared/fork/reach";
import { signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../../ForkRuntime.ts";
import { ReachHttpRoutes } from "./http.ts";
import {
  CLOUDFLARE_TOKEN,
  CONNECTOR_TOKEN_PREFIX,
  LIBRARY,
  POCKET_ID_KEY,
  type ReachKey,
  cloudflareError,
  makeReachHarness,
  pinOf,
  reachKey,
  signedRequest,
} from "./testing.ts";

const STUDIO = EnvironmentId.make("environment-studio");
const LAPTOP = EnvironmentId.make("environment-laptop");

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"] = [AuthLibraryPublishScope],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});
const STUDIO_PUBLISHER = sessionFor(`loom-host:${STUDIO}`);
const LAPTOP_PUBLISHER = sessionFor(`loom-host:${LAPTOP}`);

interface Exchange {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

const fixture = Effect.gen(function* () {
  const harness = yield* makeReachHarness();
  const context = yield* harness.build();
  const studio = reachKey();
  const laptop = reachKey();
  harness.pins.set(STUDIO, pinOf(studio, "Studio"));
  harness.pins.set(LAPTOP, pinOf(laptop, "Laptop"));
  let caller: EnvironmentAuth.AuthenticatedSession | null = STUDIO_PUBLISHER;
  const logs: Array<string> = [];
  const exchanges: Array<Exchange> = [];
  const sentTokens: Array<string> = [];
  const logger = Logger.make(({ message }) => {
    logs.push(JSON.stringify(message));
  });
  const app = ReachHttpRoutes.pipe(
    Layer.provide(Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>)),
    HttpRouter.provideRequest(
      Layer.mergeAll(
        NodeHttpPlatform.layer,
        Layer.succeedContext(context),
        Layer.mock(EnvironmentAuth.EnvironmentAuth)({
          authenticateHttpRequest: () =>
            caller === null
              ? Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError())
              : Effect.succeed(caller),
        }),
        Logger.layer([logger], { mergeWithExisting: false }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));

  const post = (route: string, body: string, headers: Record<string, string> = {}) =>
    Effect.promise(async (): Promise<Exchange> => {
      const response = await web.handler(
        new Request(`http://library.example.test${route}`, {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "x-forwarded-proto": "https",
            ...headers,
          },
        }),
      );
      const text = await response.text();
      const exchange = {
        status: response.status,
        headers: response.headers,
        text,
        json: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null,
      };
      exchanges.push(exchange);
      return exchange;
    });

  const sign = (input: {
    readonly key: ReachKey;
    readonly environmentId: string;
    readonly action: "ensure" | "remove";
    readonly seq: number;
    readonly nowEpochSeconds?: number;
  }) =>
    signedRequest(input).pipe(
      Effect.orDie,
      Effect.tap((request) => Effect.sync(() => sentTokens.push(request.token))),
    );

  const call = (
    action: "ensure" | "remove",
    seq: number,
    options: { readonly key?: ReachKey; readonly environmentId?: string } = {},
  ) =>
    sign({
      key: options.key ?? studio,
      environmentId: options.environmentId ?? STUDIO,
      action,
      seq,
    }).pipe(
      Effect.flatMap((request) =>
        post(
          action === "ensure" ? REACH_ENSURE_ROUTE : REACH_REMOVE_ROUTE,
          JSON.stringify(request),
        ),
      ),
    );

  return {
    ...harness,
    studio,
    laptop,
    logs,
    exchanges,
    sentTokens,
    post,
    sign,
    call,
    setCaller: (session: EnvironmentAuth.AuthenticatedSession | null) => {
      caller = session;
    },
  };
});

type Fixture = Effect.Success<typeof fixture>;

const run = <A, E>(use: (f: Fixture) => Effect.Effect<A, E>) =>
  fixture.pipe(
    Effect.flatMap((f) =>
      use(f).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            for (const exchange of f.exchanges) {
              expect(exchange.headers.get("cache-control")).toBe("no-store");
            }
          }),
        ),
      ),
    ),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

// Live: the web handler runs on its own runtime with the real clock, so requests are signed by it.
describe("reach routes", () => {
  it.live("ensure answers the computer's hostname and connector token, and remove tears down", () =>
    run((f) =>
      Effect.gen(function* () {
        const ensured = yield* f.call("ensure", 1);
        expect(ensured.status).toBe(200);
        expect(ensured.json).toMatchObject({
          hostname: "studio-loom.reach.example.test",
          url: "https://studio-loom.reach.example.test/",
          edge: { allowlist: "ready", rateLimit: "ready" },
          identity: { state: "ready" },
        });
        const [tunnel] = f.apis.tunnels.values();
        expect((ensured.json as { connectorToken: string }).connectorToken).toBe(
          f.apis.tokenOf(tunnel!),
        );

        const removed = yield* f.call("remove", 2);
        expect(removed.status).toBe(200);
        expect(removed.json).toEqual({ removed: true });
        expect(tunnel?.deletedAt).not.toBeNull();
      }),
    ),
  );

  it.live("refuses operator and MCP sessions, and plain HTTP", () =>
    run((f) =>
      Effect.gen(function* () {
        f.setCaller(
          sessionFor("owner", [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
        );
        expect((yield* f.call("ensure", 1)).status).toBe(403);
        f.setCaller(sessionFor("mcp-client"));
        expect((yield* f.call("ensure", 1)).status).toBe(403);
        f.setCaller(sessionFor(`loom-host:${STUDIO}`, [AuthOrchestrationReadScope]));
        expect((yield* f.call("ensure", 1)).status).toBe(403);
        f.setCaller(null);
        expect((yield* f.call("ensure", 1)).status).toBe(401);

        f.setCaller(STUDIO_PUBLISHER);
        const request = yield* f.sign({
          key: f.studio,
          environmentId: STUDIO,
          action: "ensure",
          seq: 1,
        });
        const plain = yield* f.post(REACH_ENSURE_ROUTE, JSON.stringify(request), {
          "x-forwarded-proto": "http",
        });
        expect(plain.status).toBe(400);
        expect(plain.json).toEqual({ reason: "invalid" });
        expect(f.apis.calls).toEqual([]);
      }),
    ),
  );

  it.live("answers wrong-environment when the token names another computer", () =>
    run((f) =>
      Effect.gen(function* () {
        // Laptop's own key and session, but the token is issued for Studio.
        f.setCaller(LAPTOP_PUBLISHER);
        const otherIssuer = yield* f.call("ensure", 1, { key: f.laptop, environmentId: STUDIO });
        expect(otherIssuer.status).toBe(403);
        expect(otherIssuer.json).toEqual({ reason: "wrong-environment" });

        // Studio's issuer and key, but a subject naming Laptop.
        f.setCaller(STUDIO_PUBLISHER);
        const iat = Math.floor((yield* Clock.currentTimeMillis) / 1000);
        const token = yield* signRelayJwt({
          privateKey: f.studio.privateKey,
          typ: REACH_REQUEST_TYP,
          payload: {
            action: "ensure",
            seq: 1,
            origin: "http://127.0.0.1:3773",
            iss: `loom-env:${STUDIO}`,
            sub: LAPTOP,
            aud: LIBRARY,
            iat,
            exp: iat + 60,
          },
        }).pipe(Effect.orDie);
        const otherSubject = yield* f.post(
          REACH_ENSURE_ROUTE,
          JSON.stringify({ token, publicKey: f.studio.publicKey }),
        );
        expect(otherSubject.status).toBe(403);
        expect(otherSubject.json).toEqual({ reason: "wrong-environment" });
        expect(f.apis.calls).toEqual([]);
      }),
    ),
  );

  it.live("refuses a computer the directory lacks or whose key changed", () =>
    run((f) =>
      Effect.gen(function* () {
        f.pins.delete(STUDIO);
        const unlisted = yield* f.call("ensure", 1);
        expect(unlisted.status).toBe(409);
        expect(unlisted.json).toEqual({ reason: "not-in-directory" });

        f.pins.set(STUDIO, pinOf(f.studio, "Studio"));
        const changed = yield* f.call("ensure", 1, { key: reachKey() });
        expect(changed.status).toBe(409);
        expect(changed.json).toEqual({ reason: "key-changed" });
        expect(f.apis.calls).toEqual([]);
      }),
    ),
  );

  it.live("answers unverified for a bad signature or an expired token", () =>
    run((f) =>
      Effect.gen(function* () {
        const genuine = yield* f.sign({
          key: f.studio,
          environmentId: STUDIO,
          action: "ensure",
          seq: 1,
        });
        const forged = yield* f.sign({
          key: f.laptop,
          environmentId: STUDIO,
          action: "ensure",
          seq: 1,
        });
        const [header, payload] = genuine.token.split(".");
        const signature = forged.token.split(".")[2];
        const tampered = yield* f.post(
          REACH_ENSURE_ROUTE,
          JSON.stringify({ ...genuine, token: `${header}.${payload}.${signature}` }),
        );
        expect(tampered.status).toBe(400);
        expect(tampered.json).toEqual({ reason: "unverified" });

        const expired = yield* f.sign({
          key: f.studio,
          environmentId: STUDIO,
          action: "ensure",
          seq: 1,
          nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000 - 300,
        });
        const late = yield* f.post(REACH_ENSURE_ROUTE, JSON.stringify(expired));
        expect(late.status).toBe(400);
        expect(late.json).toEqual({ reason: "unverified" });

        // An ensure token cannot be replayed as a remove.
        const swapped = yield* f.post(REACH_REMOVE_ROUTE, JSON.stringify(genuine));
        expect(swapped.status).toBe(400);
        expect(f.apis.calls).toEqual([]);
      }),
    ),
  );

  it.live("refuses a replayed seq", () =>
    run((f) =>
      Effect.gen(function* () {
        expect((yield* f.call("ensure", 4)).status).toBe(200);
        const replayed = yield* f.call("ensure", 4);
        expect(replayed.status).toBe(409);
        expect(replayed.json).toEqual({ reason: "stale-request" });
        const older = yield* f.call("remove", 3);
        expect(older.json).toEqual({ reason: "stale-request" });
      }),
    ),
  );

  it.live("refuses an oversized or unreadable body without echoing it", () =>
    run((f) =>
      Effect.gen(function* () {
        const request = yield* f.sign({
          key: f.studio,
          environmentId: STUDIO,
          action: "ensure",
          seq: 1,
        });
        const oversized = yield* f.post(REACH_ENSURE_ROUTE, JSON.stringify(request), {
          "content-length": String(REACH_REQUEST_MAX_BYTES + 1),
        });
        expect(oversized.status).toBe(413);
        expect(oversized.json).toEqual({ reason: "too-large" });

        for (const body of [
          "not json",
          JSON.stringify({ token: request.token }),
          JSON.stringify({ token: request.token, publicKey: 7 }),
        ]) {
          const refused = yield* f.post(REACH_ENSURE_ROUTE, body);
          expect(refused.status).toBe(400);
          expect(refused.json).toEqual({ reason: "invalid" });
        }
        expect(f.apis.calls).toEqual([]);
      }),
    ),
  );

  it.live("passes Cloudflare's retry-after through to the computer", () =>
    run((f) =>
      Effect.gen(function* () {
        f.apis.script("zone", {
          ...cloudflareError(429, 971, "Please wait and consider throttling your request speed"),
          headers: { "retry-after": "120" },
        });
        const limited = yield* f.call("ensure", 1);
        expect(limited.status).toBe(503);
        expect(limited.json).toEqual({ reason: "cloudflare-limited", retryAfterSeconds: 120 });
        expect(limited.headers.get("retry-after")).toBe("120");
      }),
    ),
  );

  it.live("never writes a credential, connector token or request token to a log or refusal", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.call("ensure", 1);
        yield* f.call("ensure", 1);
        yield* f.call("ensure", 2, { key: reachKey() });
        f.apis.script("tunnel.rotate", cloudflareError(400, 1001, "tunnel_secret is invalid"));
        yield* f.call("ensure", 3);
        f.apis.script("api.create", { status: 500, body: { error: "internal" } });
        yield* f.call("ensure", 4);
        yield* f.call("remove", 5);

        expect(f.logs.some((line) => line.includes("refused a reach request"))).toBe(true);
        expect(f.logs.some((line) => line.includes("Cloudflare refused a reach call"))).toBe(true);
        const secrets = [CLOUDFLARE_TOKEN, POCKET_ID_KEY, CONNECTOR_TOKEN_PREFIX, ...f.sentTokens];
        for (const line of f.logs) {
          for (const secret of secrets) expect(line).not.toContain(secret);
        }
        for (const exchange of f.exchanges) {
          expect(exchange.text).not.toContain(CLOUDFLARE_TOKEN);
          expect(exchange.text).not.toContain(POCKET_ID_KEY);
          for (const token of f.sentTokens) expect(exchange.text).not.toContain(token);
          if (exchange.status !== 200 || !exchange.text.includes("connectorToken")) {
            expect(exchange.text).not.toContain(CONNECTOR_TOKEN_PREFIX);
          }
        }
      }),
    ),
  );
});

it.live("lists reach diagnostics for a publisher without exposing connector credentials", () =>
  run((f) =>
    Effect.gen(function* () {
      expect((yield* f.call("ensure", 1)).status).toBe(200);
      const listed = yield* f.post(REACH_LIST_ROUTE, "{}");
      expect(listed.status).toBe(200);
      expect(listed.json).toMatchObject({ computers: [{ environmentId: STUDIO }] });
      expect(listed.text).not.toContain(CONNECTOR_TOKEN_PREFIX);
      expect(listed.text).not.toContain(CLOUDFLARE_TOKEN);
      expect(listed.text).not.toContain(POCKET_ID_KEY);
      for (const caller of [
        sessionFor("mcp-client"),
        sessionFor("owner", [AuthOrchestrationReadScope]),
      ]) {
        f.setCaller(caller);
        expect((yield* f.post(REACH_LIST_ROUTE, "{}")).status).toBe(403);
      }
      f.setCaller(null);
      expect((yield* f.post(REACH_LIST_ROUTE, "{}")).status).toBe(401);
    }),
  ),
);
