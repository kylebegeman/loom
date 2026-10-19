// @effect-diagnostics nodeBuiltinImport:off - The gateway routes by Host before parsing and pipes raw upgrade sockets, which Effect's HTTP server cannot.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeStream from "node:stream";

import * as Effect from "effect/Effect";

import { guardHttpResponseWriteErrors } from "../../httpResponseErrorGuard.ts";
import {
  crossSitePage,
  endedPage,
  entryUsedPage,
  nothingListeningPage,
  openFromLoomPage,
  portDeniedPage,
} from "./pages.ts";
import {
  formatPreviewSetCookie,
  normalizeRequestHost,
  PREVIEW_COOKIE_NAME,
  PREVIEW_ENTRY_PATH,
  PREVIEW_RESERVED_PATH,
  PreviewGatewayListenError,
  type PreviewGatewayHandle,
  type PreviewGatewaySession,
  type PreviewGatewayView,
  type StartPreviewGateway,
} from "./types.ts";

// Node's client insists on a single string Host; every other header may repeat.
type Headers = Record<string, string | Array<string>>;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Preview responses carry a signed-in user's dev data, so nothing between the browser and the
// gateway may store or index them.
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;

// Cloudflare and other CDNs obey these over Cache-Control, so an app could still have the edge
// store a private response.
const CDN_CACHE_HEADERS = new Set([
  "cdn-cache-control",
  "cloudflare-cdn-cache-control",
  "surrogate-control",
]);

const PAGE_HEADERS = {
  ...PRIVATE_HEADERS,
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  "x-content-type-options": "nosniff",
} as const;

const PLAIN_TEXT: Partial<Record<number, string>> = {
  400: "Bad request",
  404: "Not found",
  500: "Internal server error",
};

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(?=[/?#]|$)/i;

// Cookie names compare byte for byte, so only HTTP whitespace is trimmed, never Unicode spaces.
const trimHttpWhitespace = (value: string) => value.replace(/^[ \t]+|[ \t]+$/g, "");

/** Strips more than the gateway sets, so an app can never read or overwrite a Loom cookie. */
const isLoomCookieName = (name: string) => name.toLowerCase().startsWith("__host-loom");

const cookieName = (pair: string) => {
  const equals = pair.indexOf("=");
  return trimHttpWhitespace(equals === -1 ? pair : pair.slice(0, equals));
};

/** The gateway cookie's value; null when it is missing or appears more than once. */
const readGatewayCookie = (cookies: ReadonlyArray<string> | undefined): string | null => {
  let found: string | null = null;
  for (const pair of (cookies ?? []).join(";").split(";")) {
    const trimmed = trimHttpWhitespace(pair);
    const equals = trimmed.indexOf("=");
    if (equals === -1 || trimmed.slice(0, equals) !== PREVIEW_COOKIE_NAME) continue;
    if (found !== null) return null;
    found = trimmed.slice(equals + 1);
  }
  return found;
};

const connectionTokens = (values: ReadonlyArray<string> | undefined) =>
  new Set(
    (values ?? [])
      .join(",")
      .split(",")
      .map((token) => trimHttpWhitespace(token).toLowerCase())
      .filter((token) => token.length > 0),
  );

const forwardRequestHeaders = (
  incoming: NodeJS.Dict<Array<string>>,
  host: string,
  port: number,
): Headers => {
  const named = connectionTokens(incoming.connection);
  const publicOrigin = `https://${host}`;
  const localOrigin = `http://localhost:${port}`;
  const headers: Headers = {};
  for (const [name, values] of Object.entries(incoming)) {
    if (values === undefined || HOP_BY_HOP_HEADERS.has(name) || named.has(name)) continue;
    // The gateway already answered any 100-continue itself.
    if (name === "host" || name === "expect") continue;
    if (name === "cookie") {
      const kept = values
        .join(";")
        .split(";")
        .filter(
          (pair) => trimHttpWhitespace(pair).length > 0 && !isLoomCookieName(cookieName(pair)),
        )
        .map(trimHttpWhitespace);
      if (kept.length > 0) headers.cookie = [kept.join("; ")];
      continue;
    }
    if (name === "origin") {
      headers.origin = values.map((value) => (value === publicOrigin ? localOrigin : value));
      continue;
    }
    if (name === "referer") {
      headers.referer = values.map((value) =>
        value.startsWith(`${publicOrigin}/`)
          ? localOrigin + value.slice(publicOrigin.length)
          : value,
      );
      continue;
    }
    headers[name] = values;
  }
  headers.host = `localhost:${port}`;
  return headers;
};

const rewriteLocation = (location: string, host: string, port: number) => {
  const match = LOCAL_ORIGIN.exec(location);
  if (match === null || Number(match[1]) !== port) return location;
  const rest = location.slice(match[0].length);
  return `https://${host}${rest.startsWith("/") ? rest : `/${rest}`}`;
};

const rewriteSetCookie = (cookies: ReadonlyArray<string>) =>
  cookies.flatMap((cookie) => {
    const [pair = "", ...attributes] = cookie.split(";");
    if (isLoomCookieName(cookieName(pair))) return [];
    // A Domain attribute names localhost, which the browser would reject on the preview host.
    const kept = attributes.filter((attribute) => !/^[ \t]*domain[ \t]*(?:=|$)/i.test(attribute));
    return [[pair, ...kept].join(";")];
  });

const forwardResponseHeaders = (
  incoming: NodeJS.Dict<Array<string>>,
  host: string,
  port: number,
): Headers => {
  const named = connectionTokens(incoming.connection);
  const headers: Headers = {};
  for (const [name, values] of Object.entries(incoming)) {
    if (values === undefined || HOP_BY_HOP_HEADERS.has(name) || named.has(name)) continue;
    if (CDN_CACHE_HEADERS.has(name)) continue;
    if (name === "location") {
      headers.location = values.map((value) => rewriteLocation(value, host, port));
    } else if (name === "set-cookie") {
      const kept = rewriteSetCookie(values);
      if (kept.length > 0) headers["set-cookie"] = kept;
    } else {
      headers[name] = values;
    }
  }
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) headers[name] = [value];
  return headers;
};

const sendPage = (
  response: NodeHttp.ServerResponse,
  status: number,
  html: string,
  extra: Record<string, string> = {},
) => {
  response.writeHead(status, {
    ...PAGE_HEADERS,
    ...extra,
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
};

const sendText = (response: NodeHttp.ServerResponse, status: number, text: string) => {
  response.writeHead(status, {
    ...PRIVATE_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
};

const rejectUpgrade = (socket: NodeStream.Duplex, status: number) => {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${NodeHttp.STATUS_CODES[status] ?? "Error"}\r\n` +
      "Connection: close\r\nContent-Length: 0\r\n" +
      `Cache-Control: ${PRIVATE_HEADERS["cache-control"]}\r\n` +
      `X-Robots-Tag: ${PRIVATE_HEADERS["x-robots-tag"]}\r\n\r\n`,
    () => socket.destroy(),
  );
};

const statusLine = (status: number, message: string | undefined) =>
  `HTTP/1.1 ${status} ${message || NodeHttp.STATUS_CODES[status] || ""}\r\n`;

const responseHead = (status: number, message: string | undefined, headers: Headers) => {
  let head = statusLine(status, message);
  for (const [name, values] of Object.entries(headers)) {
    for (const value of typeof values === "string" ? [values] : values) {
      head += `${name}: ${value}\r\n`;
    }
  }
  return `${head}\r\n`;
};

/** The upstream's 101 as it sent it, keeping header case for fussy clients, minus Loom cookies. */
const switchingProtocolsHead = (response: NodeHttp.IncomingMessage) => {
  let head = statusLine(101, response.statusMessage);
  const raw = response.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] ?? "";
    const value = raw[index + 1] ?? "";
    const values = name.toLowerCase() === "set-cookie" ? rewriteSetCookie([value]) : [value];
    for (const kept of values) head += `${name}: ${kept}\r\n`;
  }
  return `${head}\r\n`;
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

type Decision =
  | { readonly _tag: "Reject"; readonly status: number; readonly page: string | null }
  | { readonly _tag: "Enter"; readonly host: string }
  | {
      readonly _tag: "Proxy";
      readonly host: string;
      readonly port: number;
      readonly session: PreviewGatewaySession;
    };

const reject = (status: number, page: string | null = null): Decision => ({
  _tag: "Reject",
  status,
  page,
});

/**
 * Links may be followed from anywhere. A form POST navigates too, and one from a sibling preview
 * host is same-site, so SameSite=Lax still sends the cookie and only Origin can refuse it.
 */
const isSafeNavigation = (request: NodeHttp.IncomingMessage) =>
  (request.method === "GET" || request.method === "HEAD") &&
  request.headers["sec-fetch-mode"] === "navigate";

/**
 * A page served with `Referrer-Policy: no-referrer` sends `Origin: null` on its own form posts.
 * The browser sets Sec-Fetch-Site, and only to same-origin when every redirect stayed on this
 * host, so a sibling host (same-site) or a sandboxed frame (cross-site) cannot pass.
 */
const isSameOrigin = (request: NodeHttp.IncomingMessage, publicOrigin: string) => {
  const origin = request.headers.origin;
  return (
    origin === publicOrigin ||
    (origin === "null" && request.headers["sec-fetch-site"] === "same-origin")
  );
};

/** Shared by plain requests and upgrades, so both pass exactly the same checks. */
const decide = (
  view: PreviewGatewayView,
  request: NodeHttp.IncomingMessage,
  upgrade: boolean,
): Decision => {
  const host = normalizeRequestHost(request.headers.host);
  const route = host === null ? ({ _tag: "Foreign" } as const) : view.route(host);
  if (host === null || route._tag === "Foreign") return reject(404);
  if (route._tag === "Ended") return reject(410, endedPage);

  const url = request.url ?? "";
  if (!url.startsWith("/")) return reject(400);
  const pathname = url.split(/[?#]/, 1)[0] ?? "";
  if (pathname === PREVIEW_ENTRY_PATH) return upgrade ? reject(404) : { _tag: "Enter", host };
  if (pathname.startsWith(PREVIEW_RESERVED_PATH)) return reject(404);

  const cookie = readGatewayCookie(request.headersDistinct.cookie);
  const session = cookie === null ? null : view.authorize(host, cookie);
  if (session === null) return reject(401, openFromLoomPage);

  const publicOrigin = `https://${host}`;
  const origin = request.headers.origin;
  if (upgrade) {
    // A WebSocket always carries its page's real origin, whatever the referrer policy, so here
    // `null` only ever means an opaque origin such as a sandboxed frame.
    if (origin !== publicOrigin) return reject(403, crossSitePage);
  } else if (
    origin !== undefined &&
    !isSameOrigin(request, publicOrigin) &&
    !isSafeNavigation(request)
  ) {
    return reject(403, crossSitePage);
  }

  if (!view.portAllowed(route.port)) return reject(403, portDeniedPage);
  return { _tag: "Proxy", host, port: route.port, session };
};

/** A proxied request or upgrade that is still running, so losing access can end it at once. */
interface LiveConnection {
  readonly host: string;
  readonly key: string;
  /** Ends both the browser's side and the upstream's. */
  readonly destroy: () => void;
}

const makeGatewayServer = (view: PreviewGatewayView) => {
  const connections = new Set<LiveConnection>();
  // Dev servers such as Vite may bind only ::1 or only 127.0.0.1, so "localhost" tries both.
  const agent = new NodeHttp.Agent({ autoSelectFamily: true, keepAlive: true });

  const enter = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    host: string,
  ) => {
    const code = new URL(request.url ?? "/", "http://gateway.invalid").searchParams.get("code");
    const entry = code === null ? null : view.redeem(host, code);
    if (entry === null) return sendPage(response, 401, entryUsedPage);
    response.writeHead(303, {
      ...PRIVATE_HEADERS,
      location: entry.path,
      "set-cookie": formatPreviewSetCookie(entry.cookieValue, entry.maxAgeSeconds),
      "referrer-policy": "no-referrer",
      "content-length": 0,
    });
    response.end();
  };

  const proxyRequest = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    host: string,
    port: number,
    session: PreviewGatewaySession,
  ) => {
    const headers = forwardRequestHeaders(request.headersDistinct, host, port);
    // Node writes a GET, HEAD, DELETE or OPTIONS body raw when it has no length, so the shared
    // keep-alive upstream would read a chunked body as more requests. Re-chunking frames it.
    if (request.headers["transfer-encoding"] !== undefined) {
      delete headers["content-length"];
      headers["transfer-encoding"] = "chunked";
    }
    const upstream = NodeHttp.request({
      agent,
      headers,
      host: "localhost",
      method: request.method ?? "GET",
      path: request.url ?? "/",
      port,
    });
    const connection: LiveConnection = {
      host,
      key: session.key,
      destroy: () => {
        upstream.destroy();
        response.destroy();
      },
    };
    connections.add(connection);
    upstream.on("response", (upstreamResponse) => {
      try {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          forwardResponseHeaders(upstreamResponse.headersDistinct, host, port),
        );
      } catch {
        upstreamResponse.destroy();
        response.destroy();
        return;
      }
      NodeStream.pipeline(upstreamResponse, response, () => {});
    });
    upstream.on("error", () => {
      if (response.headersSent || response.destroyed) response.destroy();
      else sendPage(response, 502, nothingListeningPage(port));
    });
    request.on("error", () => upstream.destroy());
    response.on("close", () => {
      connections.delete(connection);
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  };

  /**
   * Relays nothing from the browser until the upstream answers 101. An upstream without a
   * WebSocket handler answers like any request and keeps the connection open, and piping early
   * would let every later request on the browser's connection, which cloudflared pools for
   * other visitors, skip `decide`.
   */
  const proxyUpgrade = (
    request: NodeHttp.IncomingMessage,
    client: NodeStream.Duplex,
    head: Buffer,
    host: string,
    port: number,
    session: PreviewGatewaySession,
  ) => {
    const headers = forwardRequestHeaders(request.headersDistinct, host, port);
    headers.connection = "Upgrade";
    headers.upgrade = request.headersDistinct.upgrade ?? ["websocket"];
    // No body is sent before the switch, so the upstream must not wait for one.
    delete headers["content-length"];
    // A socket of its own, never pooled, so one that answered without switching serves nothing
    // else. Without an agent nothing closes it after a plain answer, so it is ended here.
    const upstreamSocket = NodeNet.connect({ autoSelectFamily: true, host: "localhost", port });
    upstreamSocket.on("error", () => upstreamSocket.destroy());
    const upstream = NodeHttp.request({
      createConnection: () => upstreamSocket,
      headers,
      method: request.method ?? "GET",
      path: request.url ?? "/",
    });
    let switched: NodeStream.Duplex | null = null;
    let answered = false;
    const destroy = () => {
      client.destroy();
      upstream.destroy();
      upstreamSocket.destroy();
      switched?.destroy();
    };
    const connection: LiveConnection = { host, key: session.key, destroy };
    connections.add(connection);

    upstream.on("upgrade", (response, socket, upstreamHead) => {
      answered = true;
      switched = socket;
      socket.on("error", () => socket.destroy());
      socket.on("close", () => client.destroy());
      if (client.destroyed) return socket.destroy();
      client.write(switchingProtocolsHead(response));
      if (upstreamHead.length > 0) client.write(upstreamHead);
      if (head.length > 0) socket.write(head);
      socket.pipe(client);
      client.pipe(socket);
    });
    upstream.on("response", (response) => {
      answered = true;
      if (client.destroyed) return destroy();
      const replyHeaders = forwardResponseHeaders(response.headersDistinct, host, port);
      replyHeaders.connection = "close";
      client.write(responseHead(response.statusCode ?? 502, response.statusMessage, replyHeaders));
      // Whatever the browser sent after its upgrade request, `head` included, is never read.
      NodeStream.pipeline(response, client, destroy);
    });
    upstream.on("error", () => {
      if (answered) destroy();
      else rejectUpgrade(client, 502);
    });
    client.on("error", () => client.destroy());
    // The browser's socket is half-open and unread, so giving up before the answer shows only here.
    client.on("end", () => {
      if (!answered) destroy();
    });
    client.on("close", () => {
      connections.delete(connection);
      upstream.destroy();
      upstreamSocket.destroy();
      switched?.destroy();
    });
    upstream.end();
  };

  const server = guardHttpResponseWriteErrors(NodeHttp.createServer());

  server.on("request", (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    try {
      const decision = decide(view, request, false);
      switch (decision._tag) {
        case "Reject":
          return decision.page === null
            ? sendText(response, decision.status, PLAIN_TEXT[decision.status] ?? "Error")
            : sendPage(response, decision.status, decision.page);
        case "Enter":
          return enter(request, response, decision.host);
        case "Proxy":
          return proxyRequest(request, response, decision.host, decision.port, decision.session);
      }
    } catch {
      // A throwing view must cost one request, never the process.
      if (response.headersSent) response.destroy();
      else sendText(response, 500, PLAIN_TEXT[500] ?? "");
    }
  });

  server.on(
    "upgrade",
    (request: NodeHttp.IncomingMessage, client: NodeStream.Duplex, head: Buffer) => {
      try {
        const decision = decide(view, request, true);
        switch (decision._tag) {
          case "Reject":
            return rejectUpgrade(client, decision.status);
          case "Enter":
            return rejectUpgrade(client, 404);
          case "Proxy":
            return proxyUpgrade(
              request,
              client,
              head,
              decision.host,
              decision.port,
              decision.session,
            );
        }
      } catch {
        client.destroy();
      }
    },
  );

  const destroyConnections: PreviewGatewayHandle["destroyConnections"] = (match) => {
    for (const connection of connections) {
      if (!match({ host: connection.host, key: connection.key })) continue;
      connections.delete(connection);
      connection.destroy();
    }
  };

  const close = Effect.callback<void>((resume) => {
    destroyConnections(() => true);
    server.closeAllConnections();
    agent.destroy();
    server.close(() => resume(Effect.void));
  });

  return { server, agent, destroyConnections, close };
};

/**
 * Binds loopback only: the tunnel is the one way in, and the port must never be reachable from
 * the network directly.
 */
export const startPreviewGateway: StartPreviewGateway = ({ port, view }) =>
  Effect.acquireRelease(
    Effect.callback<ReturnType<typeof makeGatewayServer>, PreviewGatewayListenError>((resume) => {
      const gateway = makeGatewayServer(view);
      const onListenError = (error: NodeJS.ErrnoException) => {
        gateway.agent.destroy();
        resume(Effect.fail(new PreviewGatewayListenError(port, listenErrorMessage(port, error))));
      };
      gateway.server.once("error", onListenError);
      gateway.server.listen({ host: "127.0.0.1", port }, () => {
        gateway.server.off("error", onListenError);
        // A listening server reports nothing useful here, and an unhandled "error" would crash.
        gateway.server.on("error", () => {});
        resume(Effect.succeed(gateway));
      });
    }),
    (gateway) => gateway.close,
  ).pipe(
    Effect.map((gateway): PreviewGatewayHandle => {
      const address = gateway.server.address();
      return {
        port: typeof address === "object" && address !== null ? address.port : port,
        destroyConnections: gateway.destroyConnections,
      };
    }),
  );
