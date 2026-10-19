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

const requestHead = (method: string, url: string, headers: Headers) => {
  let head = `${method} ${url} HTTP/1.1\r\n`;
  for (const [name, values] of Object.entries(headers)) {
    for (const value of typeof values === "string" ? [values] : values) {
      head += `${name}: ${value}\r\n`;
    }
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
    if (origin !== publicOrigin) return reject(403, crossSitePage);
  } else if (
    origin !== undefined &&
    origin !== publicOrigin &&
    request.headers["sec-fetch-mode"] !== "navigate"
  ) {
    return reject(403, crossSitePage);
  }

  if (!view.portAllowed(route.port)) return reject(403, portDeniedPage);
  return { _tag: "Proxy", host, port: route.port, session };
};

interface UpgradedConnection {
  readonly host: string;
  readonly sid: string;
  readonly client: NodeStream.Duplex;
  readonly upstream: NodeNet.Socket;
}

const makeGatewayServer = (view: PreviewGatewayView) => {
  const upgrades = new Set<UpgradedConnection>();
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
  ) => {
    const upstream = NodeHttp.request({
      agent,
      headers: forwardRequestHeaders(request.headersDistinct, host, port),
      host: "localhost",
      method: request.method ?? "GET",
      path: request.url ?? "/",
      port,
    });
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
      if (response.headersSent) response.destroy();
      else sendPage(response, 502, nothingListeningPage(port));
    });
    request.on("error", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  };

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
    const upstream = NodeNet.connect({ autoSelectFamily: true, host: "localhost", port });
    const connection: UpgradedConnection = { client, host, sid: session.sid, upstream };
    upgrades.add(connection);
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      upstream.write(requestHead(request.method ?? "GET", request.url ?? "/", headers));
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => {
      if (!connected) rejectUpgrade(client, 502);
    });
    upstream.on("close", () => {
      upgrades.delete(connection);
      if (connected) client.destroy();
    });
    client.on("error", () => client.destroy());
    client.on("close", () => {
      upgrades.delete(connection);
      upstream.destroy();
    });
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
          return proxyRequest(request, response, decision.host, decision.port);
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

  const destroyUpgrades: PreviewGatewayHandle["destroyUpgrades"] = (match) => {
    for (const connection of upgrades) {
      if (!match({ host: connection.host, sid: connection.sid })) continue;
      upgrades.delete(connection);
      connection.client.destroy();
      connection.upstream.destroy();
    }
  };

  const close = Effect.callback<void>((resume) => {
    destroyUpgrades(() => true);
    server.closeAllConnections();
    agent.destroy();
    server.close(() => resume(Effect.void));
  });

  return { server, agent, destroyUpgrades, close };
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
        destroyUpgrades: gateway.destroyUpgrades,
      };
    }),
  );
