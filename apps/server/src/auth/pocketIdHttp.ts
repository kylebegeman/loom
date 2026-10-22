import {
  LOOM_IDENTITY_CALLBACK_PATH,
  LOOM_IDENTITY_LOGIN_PATH,
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_SESSION_PATH,
  LOOM_IDENTITY_LOGOUT_PATH,
  LoomIdentityBrowserRequest,
  LoomIdentitySessionRequest,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Hash the callback script for a restrictive CSP.
import * as NodeCrypto from "node:crypto";
import * as Cookies from "effect/http/Cookies";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as PocketId from "./PocketId.ts";
import * as SessionStore from "./SessionStore.ts";
import { deriveAuthClientMetadata } from "./utils.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeBrowserRequest = Schema.decodeUnknownEffect(LoomIdentityBrowserRequest);
const decodeSessionRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LoomIdentitySessionRequest),
);

const HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
} as const;
const COOKIE_OPTIONS = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;
const failed = (status: number) =>
  HttpServerResponse.jsonUnsafe(
    { error: "sign_in_failed", message: "Loom could not complete sign-in. Try again." },
    { status, headers: HEADERS },
  );
const setCookie = (
  response: HttpServerResponse.HttpServerResponse,
  name: string,
  value: string,
  expiresAt: DateTime.Utc,
) =>
  Effect.fromResult(
    Cookies.set(Cookies.empty, name, value, {
      ...COOKIE_OPTIONS,
      expires: DateTime.toDate(expiresAt),
    }),
  ).pipe(Effect.map((cookies) => HttpServerResponse.mergeCookies(response, cookies)));

/** Identity endpoints are public; every issued session still carries this host's own grants. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const identity = yield* PocketId.PocketId;
    const sessions = yield* SessionStore.SessionStore;
    const metadata = identity.metadata.pipe(
      Effect.map((value) => HttpServerResponse.jsonUnsafe(value, { headers: HEADERS })),
      Effect.catch(() => Effect.succeed(failed(503))),
    );
    const login = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const query = new URL(request.url, "https://localhost").searchParams;
      let browser: LoomIdentityBrowserRequest | undefined;
      if (query.has("origin")) {
        if (
          ["origin", "state", "challenge", "environmentId"].some(
            (name) => query.getAll(name).length !== 1,
          )
        )
          return failed(400);
        browser = yield* decodeBrowserRequest({
          origin: query.get("origin"),
          state: query.get("state"),
          challenge: query.get("challenge"),
          environmentId: query.get("environmentId"),
          ...(query.has("issuer") || query.has("subject")
            ? { expectedIdentity: { issuer: query.get("issuer"), subject: query.get("subject") } }
            : {}),
        });
      }
      const pending = yield* identity.beginLogin(query.get("returnTo") ?? "/", browser);
      return yield* setCookie(
        HttpServerResponse.redirect(pending.authorizationUrl, { headers: HEADERS }),
        identity.cookieName,
        pending.cookieValue,
        pending.expiresAt,
      );
    }).pipe(Effect.catch(() => Effect.succeed(failed(503))));
    const callback = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const query = new URL(request.url, "https://localhost").searchParams;
      const session = yield* identity.completeLogin({
        state: query.get("state") ?? "",
        code: query.get("code") ?? "",
        cookieValue: request.cookies[identity.cookieName] ?? "",
        ...(query.has("iss") ? { issuer: query.get("iss")! } : {}),
        client: deriveAuthClientMetadata({ request }),
      });
      const response = session.handoff
        ? browserHandoffResponse(session.handoff)
        : HttpServerResponse.redirect(session.returnTo, { headers: HEADERS });
      return yield* setCookie(
        response,
        sessions.cookieName,
        session.token,
        DateTime.toUtc(session.expiresAt),
      );
    }).pipe(
      Effect.catch(() => Effect.succeed(failed(400))),
      Effect.flatMap((response) =>
        Effect.fromResult(
          Cookies.expireCookie(Cookies.empty, identity.cookieName, COOKIE_OPTIONS),
        ).pipe(
          Effect.map((cookies) => HttpServerResponse.mergeCookies(response, cookies)),
          Effect.orElseSucceed(() => failed(500)),
        ),
      ),
    );
    const exchange = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!request.headers["content-type"]?.startsWith("application/json")) return failed(415);
      const body = yield* request.text;
      if (body.length > 40_000) return failed(400);
      const input = yield* decodeSessionRequest(body);
      const session = yield* identity.createSession(
        input,
        deriveAuthClientMetadata({ request }),
        request.headers.origin,
      );
      return HttpServerResponse.jsonUnsafe(session, { headers: HEADERS });
    }).pipe(Effect.catch(() => Effect.succeed(failed(401))));
    const logout = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bearer = request.headers.authorization;
      if (!bearer?.startsWith("Bearer ")) return failed(401);
      const session = yield* sessions.verify(bearer.slice(7));
      if (!session.subject.startsWith("identity:") && !session.subject.startsWith("pocket-id:"))
        return failed(403);
      yield* sessions.revoke(session.sessionId);
      return HttpServerResponse.jsonUnsafe({ revoked: true }, { headers: HEADERS });
    }).pipe(Effect.catch(() => Effect.succeed(failed(401))));
    return Layer.mergeAll(
      HttpRouter.add("POST", LOOM_IDENTITY_SESSION_PATH, exchange),
      HttpRouter.add("POST", LOOM_IDENTITY_LOGOUT_PATH, logout),
      HttpRouter.add("GET", LOOM_IDENTITY_METADATA_PATH, metadata),
      HttpRouter.add("GET", LOOM_IDENTITY_LOGIN_PATH, login),
      HttpRouter.add("GET", LOOM_IDENTITY_CALLBACK_PATH, callback),
    );
  }),
);

function browserHandoffResponse(handoff: {
  readonly code: string;
  readonly state: string;
  readonly origin: string;
  readonly environmentId: string;
}) {
  const payload = encodeJson({
    type: "loom:identity:complete",
    code: handoff.code,
    state: handoff.state,
    environmentId: handoff.environmentId,
  }).replaceAll("<", "\\u003c");
  const origin = encodeJson(handoff.origin).replaceAll("<", "\\u003c");
  const script = `if(window.opener){window.opener.postMessage(${payload},${origin});window.close();}`;
  const hash = NodeCrypto.createHash("sha256").update(script).digest("base64");
  return HttpServerResponse.text(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Loom sign-in</title><p>Return to Loom to finish connecting. You can close this window.</p><script>${script}</script></html>`,
    {
      headers: {
        ...HEADERS,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; script-src 'sha256-${hash}'; frame-ancestors 'none'; base-uri 'none'`,
        "cross-origin-opener-policy": "unsafe-none",
      },
    },
  );
}
