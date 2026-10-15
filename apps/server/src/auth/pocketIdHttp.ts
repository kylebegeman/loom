import {
  LOOM_IDENTITY_CALLBACK_PATH,
  LOOM_IDENTITY_LOGIN_PATH,
  LOOM_IDENTITY_METADATA_PATH,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cookies from "effect/http/Cookies";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as PocketId from "./PocketId.ts";
import * as SessionStore from "./SessionStore.ts";
import { deriveAuthClientMetadata } from "./utils.ts";

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
      const pending = yield* identity.beginLogin;
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
      return yield* setCookie(
        HttpServerResponse.redirect("/library", { headers: HEADERS }),
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
    return Layer.mergeAll(
      HttpRouter.add("GET", LOOM_IDENTITY_METADATA_PATH, metadata),
      HttpRouter.add("GET", LOOM_IDENTITY_LOGIN_PATH, login),
      HttpRouter.add("GET", LOOM_IDENTITY_CALLBACK_PATH, callback),
    );
  }),
);
