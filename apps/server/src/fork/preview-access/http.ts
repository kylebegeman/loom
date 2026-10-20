import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import { LibraryError, LibraryPreviewRegisterRequest } from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { PREVIEW_TICKET_ROUTE, PreviewAccessService } from "./PreviewAccessService.ts";

const PREVIEW_REGISTER_ROUTE = "/api/loom/library/previews/register";
const HOST_SUBJECT_PREFIX = "loom-host:";
const REGISTER_MAX_BYTES = 4096;

const decodeRegister = Schema.decodeUnknownEffect(LibraryPreviewRegisterRequest);
const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);

const NO_STORE = { "cache-control": "no-store" } as const;
const REDIRECT_HEADERS = { ...NO_STORE, "referrer-policy": "no-referrer" } as const;
const PAGE_HEADERS = {
  ...REDIRECT_HEADERS,
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const requestOrigin = (request: HttpServerRequest.HttpServerRequest) =>
  Option.match(HttpServerRequest.toURL(request), {
    onNone: () => null,
    onSome: (url) => url.origin,
  });

const registerStatus = (reason: LibraryError["reason"]) => {
  switch (reason) {
    // A computer reads 404 as "this Library does not offer preview sign-in".
    case "not-authority":
      return 404;
    case "invalid":
      return 400;
    case "blocked":
      return 403;
    case "io":
      return 503;
    default:
      return 409;
  }
};

const register = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request);
    // Only a computer's own publisher session, which names the computer it speaks for.
    if (
      session.subject === "mcp-client" ||
      !session.scopes.includes(AuthLibraryPublishScope) ||
      !session.subject.startsWith(HOST_SUBJECT_PREFIX)
    )
      return HttpServerResponse.text("Access denied", { status: 403 });
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > REGISTER_MAX_BYTES))
      return HttpServerResponse.text("Request too large", { status: 413 });
    const body = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(REGISTER_MAX_BYTES)),
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const input = yield* decodeRegister(body).pipe(
      Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
    );
    const environmentId = yield* decodeEnvironmentId(
      session.subject.slice(HOST_SUBJECT_PREFIX.length),
    ).pipe(Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })));
    const access = yield* PreviewAccessService;
    const result = yield* access.register({
      subject: session.subject,
      environmentId,
      previews: input.previews,
      requestOrigin: requestOrigin(request),
    });
    return HttpServerResponse.jsonUnsafe(result, { headers: NO_STORE });
  }),
).pipe(
  Effect.catchTags({
    LibraryError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { reason: error.reason },
          { status: registerStatus(error.reason), headers: NO_STORE },
        ),
      ),
  }),
  Effect.orElseSucceed(() =>
    HttpServerResponse.text("Library request unavailable", { status: 401 }),
  ),
);

const page = (status: number, title: string, message: string) =>
  HttpServerResponse.text(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1f2328}@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}}h1{font-size:1.25rem}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
    { status, contentType: "text/html; charset=utf-8", headers: PAGE_HEADERS },
  );

const ticketPage = (reason: LibraryError["reason"]) => {
  switch (reason) {
    case "not-authority":
      return page(404, "Not found", "This server does not sign in to previews.");
    case "blocked":
      return page(
        403,
        "Preview not available",
        "This account cannot open previews. Sign in to your Library with an account that can run work, then open the preview link again.",
      );
    case "not-found":
      return page(
        400,
        "Preview not available",
        "Your Library does not sign in to this preview address. Open the link again from Loom, or ask for a new one.",
      );
    case "io":
      return page(
        503,
        "Sign-in unavailable",
        "Your Library could not sign you in to this preview right now. Try again in a moment.",
      );
    default:
      return page(
        400,
        "Sign-in link expired",
        "This sign-in link is incomplete or has expired. Open the preview link again.",
      );
  }
};

const ticket = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const query = new URL(request.url, "http://localhost").searchParams;
    const session = yield* auth.authenticateBrowserSession(request).pipe(
      Effect.map((value): EnvironmentAuth.AuthenticatedSession | null => value),
      Effect.catchTags({
        ServerAuthMissingCredentialError: () => Effect.succeed(null),
        ServerAuthInvalidCredentialError: () => Effect.succeed(null),
      }),
    );
    const access = yield* PreviewAccessService;
    const outcome = yield* access.ticket({
      host: query.get("host"),
      nonce: query.get("nonce"),
      path: query.get("path"),
      session,
      requestOrigin: requestOrigin(request),
    });
    return HttpServerResponse.redirect(outcome.location, {
      status: outcome._tag === "SignIn" ? 302 : 303,
      headers: REDIRECT_HEADERS,
    });
  }),
).pipe(
  Effect.catchTags({ LibraryError: (error) => Effect.succeed(ticketPage(error.reason)) }),
  Effect.orElseSucceed(() => ticketPage("io")),
);

export const PreviewAccessHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return Layer.mergeAll(
      HttpRouter.add(
        "POST",
        PREVIEW_REGISTER_ROUTE,
        register.pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "GET",
        PREVIEW_TICKET_ROUTE,
        ticket.pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    );
  }),
);
