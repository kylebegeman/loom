import { AuthEnvironmentBootstrapTokenType } from "@t3tools/contracts";
import { isUnsafeReachPath, reachAllowsRequest } from "@t3tools/shared/fork/reach";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  Cookies,
  HttpEffect,
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  UrlParams,
} from "effect/http";
import { failEnvironmentAuthInvalid } from "../../auth/http.ts";
import { installedReachService, type ReachGuardState } from "./ReachService.ts";

const TOKEN_PATH = "/oauth/token";
/** A token exchange is a few hundred bytes. This bounds what the guard reads ahead of the handler. */
const TOKEN_BODY_MAX_BYTES = 16 * 1024;
/**
 * The pairing code shape `PairingGrantStore` issues. The desktop bootstrap token and the dev
 * credential never leave this computer, so a reach host exchanges pairing codes only.
 */
const PAIRING_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/u;

const notFound = HttpServerResponse.empty({ status: 404 });
const badRequest = HttpServerResponse.empty({ status: 400 });

/** The Host name as DNS compares it: lowercase, without a port or a trailing dot. */
export const requestHostname = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  let host = header.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host : host.slice(0, end + 1);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon !== -1) host = host.slice(0, colon);
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host === "" ? null : host;
};

const pathOf = (target: string) => target.split(/[?#]/u, 1)[0] ?? "";

/**
 * Reads the form body through the request's own cache, so the token handler decodes the same
 * bytes afterwards. An unreadable or oversized body is refused: the handler could not decode it.
 */
const refusesTokenExchange = Effect.fn("ReachGuard.checkTokenExchange")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declared) || declared > TOKEN_BODY_MAX_BYTES) return true;
  const params = yield* request.urlParamsBody.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(TOKEN_BODY_MAX_BYTES)),
    Effect.option,
  );
  if (Option.isNone(params)) return true;
  const type = UrlParams.getFirst(params.value, "subject_token_type");
  if (Option.getOrUndefined(type) !== AuthEnvironmentBootstrapTokenType) return false;
  const token = Option.getOrElse(UrlParams.getFirst(params.value, "subject_token"), () => "");
  return !PAIRING_CODE.test(token.trim());
});

// Session cookies take their issuer and Secure flag from Host and X-Forwarded-Proto, which a
// reach host only half controls. Appended after the app ran, so it runs after every cookie the
// handlers added.
const withoutCookies: HttpEffect.PreResponseHandler = (_request, response) =>
  Effect.succeed(
    response.pipe(
      HttpServerResponse.replaceCookies(Cookies.empty),
      HttpServerResponse.removeHeader("set-cookie"),
    ),
  );

/**
 * Applies the edge allowlist again in process, for requests whose Host is this computer's reach
 * hostname. Every other request passes untouched: one header read and one compare.
 */
export const makeReachGuard =
  (state: () => ReachGuardState) =>
  <E, R>(
    app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  > =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
      const { hostname, serving } = state();
      if (hostname === null || requestHostname(request.headers.host) !== hostname) return app;
      if (!serving) return Effect.succeed(notFound);
      if (isUnsafeReachPath(request.url)) return Effect.succeed(badRequest);
      // cloudflared adds it only with `httpHostHeader`, which reach never sets.
      if (request.headers["x-forwarded-host"] !== undefined) return Effect.succeed(badRequest);
      if (!reachAllowsRequest(request.method, request.url)) return Effect.succeed(notFound);
      const served = app.pipe(Effect.ensuring(HttpEffect.appendPreResponseHandler(withoutCookies)));
      if (request.method !== "POST" || pathOf(request.url) !== TOKEN_PATH) return served;
      return Effect.flatMap(refusesTokenExchange(request), (refused) =>
        refused
          ? failEnvironmentAuthInvalid("invalid_credential").pipe(
              Effect.catch(HttpServerRespondable.toResponse),
            )
          : served,
      );
    });

/** Global, so it also sees requests no route matches. Installed by ForkLayer's routes. */
export const ReachGuardLayer = HttpRouter.middleware(
  Effect.map(installedReachService, (reach) =>
    Option.isNone(reach)
      ? <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) => app
      : makeReachGuard(reach.value.guardState),
  ),
  { global: true },
);
