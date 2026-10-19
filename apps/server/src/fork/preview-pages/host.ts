// @effect-diagnostics nodeBuiltinImport:off - The pages host is its own listener so that no /api, /ws or app route can ever answer on the pages origin.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeStream from "node:stream";

import type { PreviewPage, PreviewPagesError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import { guardHttpResponseWriteErrors } from "../../httpResponseErrorGuard.ts";
import {
  PREVIEW_TICKET_ROUTE,
  PreviewAccessService,
} from "../preview-access/PreviewAccessService.ts";
import { isDocumentNavigation } from "../preview-links/gateway.ts";
import { signInPage, ticketFailedPage } from "../preview-links/pages.ts";
import {
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  previewSignInUrl,
  randomCookieKey,
  sanitizeEntryPath,
  signPreviewCookie,
  verifyPreviewCookie,
} from "../preview-links/policy.ts";
import {
  formatNonceClearCookie,
  formatNonceSetCookie,
  PREVIEW_NONCE_COOKIE_NAME,
  PREVIEW_NONCE_MAX_AGE_SECONDS,
  PREVIEW_TICKET_PATH,
  randomPreviewNonce,
  readRequestCookie,
  type VerifiedPreviewTicket,
} from "../preview-links/ticket.ts";
import {
  formatPreviewSetCookie,
  normalizeRequestHost,
  PREVIEW_COOKIE_NAME,
} from "../preview-links/types.ts";
import { PageLibraryService } from "./PageLibraryService.ts";
import {
  pageEndedPage,
  pageUnavailablePage,
  RAW_PAGE_SANDBOX,
  renderPageShell,
  shellContentSecurityPolicy,
  STATUS_PAGE_CONTENT_SECURITY_POLICY,
} from "./shell.ts";

export const PAGES_HOST_DEFAULT_PORT = 3774;
const COOKIE_KEY_SECRET = "loom-preview-pages-cookie-key";
/** The access key class the preview gateway also gives browsers that signed in via the Library. */
const LIBRARY_KEY_PREFIX = "library:";
const MAX_REPLY_BODY_BYTES = 64 * 1024;
/** Tickets and nonces kept as spent. Full means a flood of fresh tickets, so new ones fail. */
const MAX_SPENT_TICKETS = 1024;
// A ticket still verifies this long past its expiry, so it has to stay spent until then. The
// check compares whole seconds, which adds up to one more.
const TICKET_STILL_VALID_MS = 31 * 1000;
// No browser still holds the nonce cookie after its max age, so it cannot come back after that.
const NONCE_SPENT_MS = PREVIEW_NONCE_MAX_AGE_SECONDS * 1000;

const PAGE_PATH = /^\/p\/([A-Za-z0-9_-]{22})$/;
const RAW_PATH = /^\/raw\/([A-Za-z0-9_-]{22})$/;
const REPLIES_PATH = /^\/p\/([A-Za-z0-9_-]{22})\/replies$/;
const JSON_CONTENT_TYPE = /^[ \t]*application\/json[ \t]*(?:;|$)/i;

// Every answer is one signed-in person's page or a step of their sign-in, so nothing between
// the browser and the Library may store or index it, and no address on it may leak onward.
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

const ReplyBody = Schema.fromJsonString(
  Schema.Struct({ replyId: Schema.String, text: Schema.String }),
);
const decodeReplyBody = Schema.decodeUnknownOption(ReplyBody);

export class PagesHostListenError extends Schema.TaggedError<PagesHostListenError>()(
  "PagesHostListenError",
  { port: Schema.Number, message: Schema.String },
) {}

export interface PagesHostOptions {
  /** The interface to bind. */
  readonly host: string;
  /** 0 picks a free port. */
  readonly port: number;
  /** `https://pages.<domain>`, as PageLibraryService serves it. */
  readonly pagesOrigin: string;
  /** The Library origin that signs tickets, as PreviewAccessService writes it in `iss`. */
  readonly issuerOrigin: string;
}

interface Answer {
  readonly status: number;
  readonly headers: NodeHttp.OutgoingHttpHeaders;
  readonly body: string;
}

const textAnswer = (
  status: number,
  text: string,
  extra: NodeHttp.OutgoingHttpHeaders = {},
): Answer => ({
  status,
  headers: { ...PRIVATE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra },
  body: text,
});

const htmlAnswer = (
  status: number,
  html: string,
  extra: NodeHttp.OutgoingHttpHeaders = {},
): Answer => ({
  status,
  headers: {
    ...PRIVATE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": STATUS_PAGE_CONTENT_SECURITY_POLICY,
    "x-frame-options": "DENY",
    ...extra,
  },
  body: html,
});

const jsonAnswer = (
  status: number,
  value: unknown,
  extra: NodeHttp.OutgoingHttpHeaders = {},
): Answer => ({
  status,
  headers: { ...PRIVATE_HEADERS, "content-type": "application/json; charset=utf-8", ...extra },
  body: JSON.stringify(value),
});

const methodNotAllowed = (allow: string) => textAnswer(405, "Method not allowed", { allow });

const write = (response: NodeHttp.ServerResponse, answer: Answer) => {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(answer.status, {
    ...answer.headers,
    "content-length": Buffer.byteLength(answer.body),
  });
  response.end(answer.body);
};

const listenErrorMessage = (port: number, error: NodeJS.ErrnoException) => {
  switch (error.code) {
    case "EADDRINUSE":
      return `Port ${port} is already in use on this computer.`;
    case "EACCES":
    case "EPERM":
      return `Loom is not allowed to listen on port ${port}.`;
    default:
      return `Could not listen on port ${port}.`;
  }
};

/** The pages host name, or null unless `origin` is https without a port, as tickets need. */
const pagesHostOf = (origin: string): string | null => {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.port === "" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Reads a request body up to `limit` bytes. Settles once: with the bytes, with "too-large" as
 * soon as the limit is passed, or with null when the browser goes away first.
 */
const readBody = (
  request: NodeHttp.IncomingMessage,
  limit: number,
  done: (body: Buffer | "too-large" | null) => void,
) => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  let settled = false;
  const settle = (body: Buffer | "too-large" | null) => {
    if (settled) return;
    settled = true;
    done(body);
  };
  // Listeners stay attached after settling so a late error still has a handler.
  request.on("data", (chunk: Buffer) => {
    if (settled) return;
    size += chunk.length;
    if (size > limit) return settle("too-large");
    chunks.push(chunk);
  });
  request.on("end", () => settle(Buffer.concat(chunks)));
  request.on("error", () => settle(null));
  request.on("close", () => settle(null));
};

interface PagesServerContext {
  readonly pagesOrigin: string;
  readonly pagesHost: string;
  readonly issuerOrigin: string;
  readonly cookieKey: Uint8Array;
  readonly now: () => number;
  readonly pages: PageLibraryService["Service"];
  readonly access: PreviewAccessService["Service"];
  readonly run: (effect: Effect.Effect<Answer>) => Fiber.Fiber<Answer>;
}

const makePagesServer = (context: PagesServerContext) => {
  const { pagesOrigin, pagesHost, issuerOrigin, cookieKey, now, pages, access, run } = context;
  const spent = new Map<string, number>();
  const rawContentSecurityPolicy = `sandbox ${RAW_PAGE_SANDBOX}; frame-ancestors ${pagesOrigin}`;

  const sessionOf = (request: NodeHttp.IncomingMessage) => {
    const value = readRequestCookie(request.headersDistinct.cookie, PREVIEW_COOKIE_NAME);
    return value === null ? null : verifyPreviewCookie(value, cookieKey, pagesHost, now());
  };

  /** Each answer gets a fresh nonce, so a sign-in link only works in the browser it was shown to. */
  const signInAnswer = (status: number, path: string, page: (href: string) => string) => {
    const nonce = randomPreviewNonce();
    const href = previewSignInUrl(
      { origin: issuerOrigin, ticketPath: PREVIEW_TICKET_ROUTE },
      pagesHost,
      nonce,
      path,
    );
    return htmlAnswer(status, page(href), { "set-cookie": formatNonceSetCookie(nonce) });
  };

  const ticketFailedAnswer = (status: number, path: string) =>
    PAGE_PATH.test(path)
      ? signInAnswer(status, path, ticketFailedPage)
      : htmlAnswer(status, ticketFailedPage(null));

  /** False when the ticket or its nonce was already used, or too many are being held. */
  const spend = (ticket: VerifiedPreviewTicket, nonce: string) => {
    const nowMs = now();
    for (const [key, untilMs] of spent) {
      if (untilMs <= nowMs) spent.delete(key);
    }
    const ticketKey = `jti:${ticket.ticketId}`;
    const nonceKey = `nonce:${nonce}`;
    if (spent.has(ticketKey) || spent.has(nonceKey) || spent.size >= MAX_SPENT_TICKETS) {
      return false;
    }
    spent.set(ticketKey, ticket.expiresAtMs + TICKET_STILL_VALID_MS);
    spent.set(nonceKey, nowMs + NONCE_SPENT_MS);
    return true;
  };

  const signedInAnswer = (subject: string, path: string): Answer => {
    const nowMs = now();
    const exp = Math.floor(nowMs / 1000) + PREVIEW_COOKIE_MAX_AGE_SECONDS;
    const cookie = signPreviewCookie(
      { sub: subject, key: `${LIBRARY_KEY_PREFIX}${subject}`, host: pagesHost, iat: nowMs, exp },
      cookieKey,
    );
    return {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        location: path,
        "set-cookie": [
          formatPreviewSetCookie(cookie, PREVIEW_COOKIE_MAX_AGE_SECONDS),
          formatNonceClearCookie(),
        ],
      },
      body: "",
    };
  };

  const shellAnswer = (page: PreviewPage): Answer => {
    const nonce = NodeCrypto.randomBytes(16).toString("base64");
    return htmlAnswer(200, renderPageShell(page, nonce), {
      "content-security-policy": shellContentSecurityPolicy(nonce),
    });
  };

  const rawAnswer = (html: string): Answer => ({
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": rawContentSecurityPolicy,
    },
    body: html,
  });

  /**
   * Answers once `effect` settles. Whatever it could not answer itself is logged and becomes
   * `fallback`, so no failure, defect or shutdown leaves a request hanging or escapes.
   */
  const answerLater = <E>(
    response: NodeHttp.ServerResponse,
    effect: Effect.Effect<Answer, E>,
    fallback: Answer,
  ) => {
    const fiber = run(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.succeed(fallback)
            : Effect.logWarning("The pages host could not answer a request.", {
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(fallback)),
        ),
      ),
    );
    fiber.addObserver((exit) => {
      try {
        write(response, Exit.isSuccess(exit) ? exit.value : fallback);
      } catch {
        response.destroy();
      }
    });
  };

  const openPage = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    pageId: string,
  ) => {
    if (sessionOf(request) === null) {
      return write(
        response,
        isDocumentNavigation(request)
          ? signInAnswer(401, `/p/${pageId}`, signInPage)
          : textAnswer(401, "Sign in required"),
      );
    }
    answerLater(
      response,
      pages
        .view(pageId)
        .pipe(
          Effect.map((view) =>
            view === null ? htmlAnswer(404, pageEndedPage) : shellAnswer(view.page),
          ),
        ),
      htmlAnswer(503, pageUnavailablePage),
    );
  };

  const openRaw = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    pageId: string,
  ) => {
    if (sessionOf(request) === null) return write(response, textAnswer(401, "Sign in required"));
    answerLater(
      response,
      pages
        .view(pageId)
        .pipe(
          Effect.map((view) =>
            view === null ? textAnswer(404, "Not found") : rawAnswer(view.html),
          ),
        ),
      textAnswer(503, "Service unavailable"),
    );
  };

  const redeemTicket = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    query: URLSearchParams,
  ) => {
    const ticket = query.get("ticket");
    const path = sanitizeEntryPath(query.get("path") ?? undefined);
    const nonce = readRequestCookie(request.headersDistinct.cookie, PREVIEW_NONCE_COOKIE_NAME);
    if (ticket === null || nonce === null) {
      return write(response, ticketFailedAnswer(ticket === null ? 400 : 401, path));
    }
    answerLater(
      response,
      access
        .verifyTicket({ token: ticket, host: pagesHost, nonce })
        .pipe(
          Effect.map((verified) =>
            verified !== null && spend(verified, nonce)
              ? signedInAnswer(verified.subject, path)
              : ticketFailedAnswer(401, path),
          ),
        ),
      htmlAnswer(503, pageUnavailablePage),
    );
  };

  const replyFailure = (error: PreviewPagesError): Effect.Effect<Answer> => {
    switch (error.reason) {
      case "invalid":
        return Effect.succeed(jsonAnswer(400, { reason: error.reason }));
      case "not-found":
        return Effect.succeed(jsonAnswer(404, { reason: error.reason }));
      case "blocked":
        return Effect.succeed(jsonAnswer(429, { reason: error.reason }));
      default:
        return Effect.logWarning("The Library could not take a page reply.", {
          reason: error.reason,
          message: error.message,
        }).pipe(Effect.as(jsonAnswer(503, { reason: error.reason })));
    }
  };

  const addReply = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    pageId: string,
  ) => {
    const session = sessionOf(request);
    if (session === null) return write(response, jsonAnswer(401, { reason: "unauthorized" }));
    // SameSite=Lax already keeps the cookie off other sites' posts; this also refuses sibling
    // hosts and the sandboxed page itself, whose opaque origin arrives as `null`.
    if (request.headers.origin !== pagesOrigin) {
      return write(response, jsonAnswer(403, { reason: "forbidden" }));
    }
    if (!JSON_CONTENT_TYPE.test(request.headers["content-type"] ?? "")) {
      return write(response, jsonAnswer(415, { reason: "invalid" }));
    }
    // Closing the connection means the rest of an oversized body is never read.
    const tooLarge = jsonAnswer(413, { reason: "too-large" }, { connection: "close" });
    const declared = Number(request.headers["content-length"] ?? 0);
    if (!(declared <= MAX_REPLY_BODY_BYTES)) return write(response, tooLarge);
    readBody(request, MAX_REPLY_BODY_BYTES, (body) => {
      try {
        if (body === null) return response.destroy();
        if (body === "too-large") return write(response, tooLarge);
        const reply = decodeReplyBody(body.toString("utf8"));
        if (Option.isNone(reply)) return write(response, jsonAnswer(400, { reason: "invalid" }));
        answerLater(
          response,
          pages
            .addReply({
              pageId,
              replyId: reply.value.replyId,
              text: reply.value.text,
              viewer: session.sub,
            })
            .pipe(Effect.as(jsonAnswer(201, { ok: true })), Effect.catch(replyFailure)),
          jsonAnswer(503, { reason: "io" }),
        );
      } catch {
        if (response.headersSent) response.destroy();
        else write(response, jsonAnswer(500, { reason: "io" }));
      }
    });
  };

  const handle = (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    if (normalizeRequestHost(request.headers.host) !== pagesHost) {
      return write(response, textAnswer(421, "Misdirected request"));
    }
    const url = request.url ?? "";
    if (!url.startsWith("/")) return write(response, textAnswer(400, "Bad request"));
    const queryAt = url.indexOf("?");
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
    const method = request.method ?? "";

    // HEAD is refused too: a ticket must never be spent by a request that shows no page.
    if (pathname === PREVIEW_TICKET_PATH) {
      return method === "GET"
        ? redeemTicket(
            request,
            response,
            new URLSearchParams(queryAt === -1 ? "" : url.slice(queryAt + 1)),
          )
        : write(response, methodNotAllowed("GET"));
    }
    const page = PAGE_PATH.exec(pathname)?.[1];
    if (page !== undefined) {
      return method === "GET"
        ? openPage(request, response, page)
        : write(response, methodNotAllowed("GET"));
    }
    const raw = RAW_PATH.exec(pathname)?.[1];
    if (raw !== undefined) {
      return method === "GET"
        ? openRaw(request, response, raw)
        : write(response, methodNotAllowed("GET"));
    }
    const replies = REPLIES_PATH.exec(pathname)?.[1];
    if (replies !== undefined) {
      return method === "POST"
        ? addReply(request, response, replies)
        : write(response, methodNotAllowed("POST"));
    }
    write(response, textAnswer(404, "Not found"));
  };

  const server = guardHttpResponseWriteErrors(NodeHttp.createServer());
  server.on("request", (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    try {
      handle(request, response);
    } catch {
      // A throwing route must cost one request, never the Library.
      if (response.headersSent) response.destroy();
      else write(response, textAnswer(500, "Internal server error"));
    }
  });
  // The write guard listens for "upgrade", so Node hands those sockets to listeners
  // only. Left alone they stay open forever and closeAllConnections misses them,
  // which would hang shutdown. Pages never upgrade.
  server.on("upgrade", (_request: NodeHttp.IncomingMessage, socket: NodeStream.Duplex) => {
    socket.destroy();
  });
  return server;
};

/** Serves published pages until the scope closes. */
export const startPagesHost = (
  options: PagesHostOptions,
): Effect.Effect<
  { readonly port: number },
  PagesHostListenError,
  Scope.Scope | PageLibraryService | PreviewAccessService | ServerSecretStore.ServerSecretStore
> =>
  Effect.gen(function* () {
    const pagesHost = pagesHostOf(options.pagesOrigin);
    if (pagesHost === null) {
      return yield* new PagesHostListenError({
        port: options.port,
        message: "The pages origin is not an https origin without a port.",
      });
    }
    const pages = yield* PageLibraryService;
    const access = yield* PreviewAccessService;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const clock = yield* Clock.Clock;
    const cookieKey = yield* secrets
      .getOrCreateRandom(COOKIE_KEY_SECRET, 32)
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Using a temporary pages cookie key", { cause }).pipe(
            Effect.as(randomCookieKey()),
          ),
        ),
      );
    // Created before the listener, so on shutdown the listener closes first and then any
    // request still waiting on the Library is interrupted.
    const run = yield* FiberSet.makeRuntime<never, Answer, never>();
    const server = makePagesServer({
      pagesOrigin: new URL(options.pagesOrigin).origin,
      pagesHost,
      issuerOrigin: options.issuerOrigin,
      cookieKey,
      now: () => clock.currentTimeMillisUnsafe(),
      pages,
      access,
      run,
    });
    const port = yield* Effect.acquireRelease(
      Effect.callback<number, PagesHostListenError>((resume) => {
        const onListenError = (error: NodeJS.ErrnoException) =>
          resume(
            Effect.fail(
              new PagesHostListenError({
                port: options.port,
                message: listenErrorMessage(options.port, error),
              }),
            ),
          );
        server.once("error", onListenError);
        server.listen({ host: options.host, port: options.port }, () => {
          server.off("error", onListenError);
          // After binding, errors belong to single connections and must not reach the process.
          server.on("error", () => {});
          const address = server.address();
          resume(
            Effect.succeed(
              typeof address === "object" && address !== null ? address.port : options.port,
            ),
          );
        });
      }),
      () =>
        Effect.callback<void>((resume) => {
          server.closeAllConnections();
          server.close(() => resume(Effect.void));
        }),
    );
    return { port };
  });

/**
 * The Library's pages host. It only starts when the Library serves pages and has a fixed ticket
 * issuer, and a bad port or a taken one costs only the pages, never the rest of the server.
 */
export const PagesHostLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const pages = yield* PageLibraryService;
    const access = yield* PreviewAccessService;
    const pagesOrigin = pages.pagesOrigin;
    if (pagesOrigin === null) return;
    const issuerOrigin = access.issuerOrigin;
    if (issuerOrigin === null) {
      return yield* Effect.logWarning(
        "Published pages are offline: LOOM_IDENTITY_REDIRECT_URI must name the Library's public https origin, which signs page sign-ins.",
      );
    }
    const port = yield* Config.Port("LOOM_PAGES_PORT").pipe(
      Config.withDefault(PAGES_HOST_DEFAULT_PORT),
      Effect.asSome,
      Effect.catch((error) =>
        Effect.logWarning("Published pages are offline: LOOM_PAGES_PORT is not a valid port.", {
          error,
        }).pipe(Effect.as(Option.none<number>())),
      ),
    );
    if (Option.isNone(port)) return;
    const config = yield* ServerConfig;
    const host = config.host ?? "127.0.0.1";
    yield* startPagesHost({ host, port: port.value, pagesOrigin, issuerOrigin }).pipe(
      Effect.tap((started) =>
        Effect.logInfo(`Serving published pages for ${pagesOrigin} on ${host}:${started.port}.`),
      ),
      Effect.catch((error) => Effect.logWarning(`Published pages are offline: ${error.message}`)),
    );
  }),
);
