// @effect-diagnostics nodeBuiltinImport:off - The gateway is tested against real loopback sockets.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { startPreviewGateway } from "./gateway.ts";
import { PREVIEW_COOKIE_NAME, type PreviewGatewayEntry, type PreviewGatewayView } from "./types.ts";

const LINK_HOST = "5173-abc123-dorothy.bagels.top";
const ENDED_HOST = "5174-ended1-dorothy.bagels.top";
const DENIED_HOST = "5175-denied-dorothy.bagels.top";
const GOOD_COOKIE = "signed.value";
const ORIGIN = `https://${LINK_HOST}`;
const NO_SOCKET_PATH = "/no-socket-here";
const NO_SOCKET_BODY = "no socket here";

const boundPort = (server: NodeNet.Server) => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
}

/** A dev server stand-in that records what reached it. */
const upstreamServer = Effect.acquireRelease(
  Effect.callback<{
    server: NodeHttp.Server;
    requests: Array<RecordedRequest>;
    port: number;
    /** Settles when the upstream side of `/events` closes. */
    eventStreamClosed: Promise<void>;
    /** Settles when the connection that carried a `NO_SOCKET_PATH` request closes. */
    noSocketClosed: Promise<void>;
  }>((resume) => {
    const requests: Array<RecordedRequest> = [];
    const eventStreamClosed = Promise.withResolvers<void>();
    const noSocketClosed = Promise.withResolvers<void>();
    const server = NodeHttp.createServer((request, response) => {
      if (request.url === "/events") {
        response.on("close", () => eventStreamClosed.resolve());
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: ready\n\n");
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, {
          location: `http://localhost:${boundPort(server)}/next?step=2`,
          "cache-control": "public, max-age=600",
          "cdn-cache-control": "max-age=600",
          "cloudflare-cdn-cache-control": "max-age=600",
          "surrogate-control": "max-age=600",
          "set-cookie": [
            "app=1; Domain=localhost; Path=/",
            `${PREVIEW_COOKIE_NAME}=forged; Path=/; Secure`,
            "other=2; path=/; domain=.localhost; HttpOnly",
          ],
        });
        response.end();
        return;
      }
      if (request.url === "/elsewhere") {
        response.writeHead(302, { location: "http://127.0.0.1:1/away" });
        response.end();
        return;
      }
      const chunks: Array<Buffer> = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers,
          body,
        });
        // Like any server without a WebSocket handler: a plain keep-alive answer to an upgrade.
        if (request.url === NO_SOCKET_PATH) {
          request.socket.on("close", () => noSocketClosed.resolve());
          response.writeHead(404, { "content-type": "text/plain" });
          response.end(NO_SOCKET_BODY);
          return;
        }
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(`echo:${body}`);
      });
    });
    // Never times out an idle connection, so only the gateway can close one.
    server.keepAliveTimeout = 0;
    server.listen(0, "127.0.0.1", () =>
      resume(
        Effect.succeed({
          server,
          requests,
          port: boundPort(server),
          eventStreamClosed: eventStreamClosed.promise,
          noSocketClosed: noSocketClosed.promise,
        }),
      ),
    );
  }),
  ({ server }) =>
    Effect.callback<void>((resume) => {
      server.closeAllConnections();
      server.close(() => resume(Effect.void));
    }),
);

/** A raw upgrade target: answers 101, then echoes every byte it receives. */
const upgradeServer = Effect.acquireRelease(
  Effect.callback<{
    server: NodeNet.Server;
    sockets: Set<NodeNet.Socket>;
    heads: Array<string>;
    port: number;
  }>((resume) => {
    const heads: Array<string> = [];
    const sockets = new Set<NodeNet.Socket>();
    const server = NodeNet.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      let buffered = Buffer.alloc(0);
      let upgraded = false;
      socket.on("data", (chunk: Buffer) => {
        if (upgraded) {
          socket.write(chunk);
          return;
        }
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf("\r\n\r\n");
        if (end === -1) return;
        upgraded = true;
        heads.push(buffered.subarray(0, end).toString("latin1"));
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Protocol: vite-hmr\r\n\r\n",
        );
        const rest = buffered.subarray(end + 4);
        if (rest.length > 0) socket.write(rest);
      });
    });
    server.listen(0, "127.0.0.1", () =>
      resume(Effect.succeed({ server, sockets, heads, port: boundPort(server) })),
    );
  }),
  ({ server, sockets }) =>
    Effect.callback<void>((resume) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resume(Effect.void));
    }),
);

/** A port nothing listens on: bound once, then released. */
const freePort = Effect.callback<number>((resume) => {
  const server = NodeNet.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = boundPort(server);
    server.close(() => resume(Effect.succeed(port)));
  });
});

const makeView = (ports: { link: number; denied: number }) => {
  const codes = new Map<string, PreviewGatewayEntry>([
    ["good-code", { cookieValue: GOOD_COOKIE, maxAgeSeconds: 43_200, path: "/app?tab=1" }],
  ]);
  const view: PreviewGatewayView = {
    route: (host) =>
      host === LINK_HOST
        ? { _tag: "Link", linkId: "link-1", port: ports.link }
        : host === DENIED_HOST
          ? { _tag: "Link", linkId: "link-2", port: ports.denied }
          : host === ENDED_HOST
            ? { _tag: "Ended" }
            : { _tag: "Foreign" },
    redeem: (host, code) => {
      const entry = codes.get(code);
      if (entry === undefined || host !== LINK_HOST) return null;
      codes.delete(code);
      return entry;
    },
    authorize: (host, value) =>
      value === GOOD_COOKIE && (host === LINK_HOST || host === DENIED_HOST)
        ? { key: "session-1", sub: "user-1" }
        : null,
    portAllowed: (port) => port !== ports.denied,
  };
  return view;
};

interface Reply {
  readonly status: number;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
}

const send = (
  gatewayPort: number,
  options: {
    readonly host: string;
    readonly path?: string;
    readonly method?: string;
    readonly headers?: Record<string, string | Array<string>>;
    readonly body?: ReadonlyArray<string>;
  },
) =>
  Effect.promise(
    () =>
      new Promise<Reply>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            agent: false,
            host: "127.0.0.1",
            port: gatewayPort,
            method: options.method ?? "GET",
            path: options.path ?? "/",
            headers: { host: options.host, ...options.headers },
          },
          (response) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        request.on("error", reject);
        for (const chunk of options.body ?? []) request.write(chunk);
        request.end();
      }),
  );

const signedIn = { cookie: `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}` };

/** Opens a raw socket, writes `request`, and resolves once the reply contains `until`. */
const rawExchange = (gatewayPort: number, request: string, until: string) =>
  Effect.promise(
    () =>
      new Promise<{ socket: NodeNet.Socket; received: string }>((resolve, reject) => {
        const socket = NodeNet.connect({ host: "127.0.0.1", port: gatewayPort });
        let received = "";
        socket.on("error", reject);
        socket.on("data", (chunk: Buffer) => {
          received += chunk.toString("latin1");
          if (received.includes(until)) resolve({ socket, received });
        });
        socket.on("close", () => resolve({ socket, received }));
        socket.write(request);
      }),
  );

const upgradeRequest = (headers: Record<string, string>, early = "", path = "/hmr?token=1") =>
  `GET ${path} HTTP/1.1\r\n${Object.entries({
    Host: LINK_HOST,
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Protocol": "vite-hmr",
    "Sec-WebSocket-Extensions": "permessage-deflate",
    ...headers,
  })
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("")}\r\n${early}`;

const setup = Effect.gen(function* () {
  const upstream = yield* upstreamServer;
  const denied = yield* freePort;
  const view = makeView({ link: upstream.port, denied });
  const gateway = yield* startPreviewGateway({ port: 0, view });
  return { upstream, gateway };
});

describe("preview gateway", () => {
  it.live("answers foreign hosts with 404 and ended links with 410", () =>
    Effect.gen(function* () {
      const { gateway } = yield* setup;
      const foreign = yield* send(gateway.port, { host: "example.com" });
      expect(foreign.status).toBe(404);
      expect(foreign.body).toBe("Not found");

      const ended = yield* send(gateway.port, { host: ENDED_HOST, path: "/__loom/enter?code=x" });
      expect(ended.status).toBe(410);
      expect(ended.body).toContain("This preview has ended");
      expect(ended.headers["content-security-policy"]).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      expect(ended.headers["cache-control"]).toBe("private, no-store");
      expect(ended.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }),
  );

  it.live("redeems an entry code once, sets the cookie and redirects", () =>
    Effect.gen(function* () {
      const { gateway } = yield* setup;
      const entered = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/__loom/enter?code=good-code",
      });
      expect(entered.status).toBe(303);
      expect(entered.headers.location).toBe("/app?tab=1");
      expect(entered.headers["set-cookie"]).toEqual([
        `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}; Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Lax`,
      ]);
      expect(entered.headers["cache-control"]).toBe("private, no-store");

      const reused = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/__loom/enter?code=good-code",
      });
      expect(reused.status).toBe(401);
      expect(reused.headers["set-cookie"]).toBeUndefined();
      expect(reused.body).toContain("Open the preview again from Loom");

      const reserved = yield* send(gateway.port, { host: LINK_HOST, path: "/__loom/other" });
      expect(reserved.status).toBe(404);
    }),
  );

  it.live("asks a browser without a valid cookie to open the link from Loom", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const cold = yield* send(gateway.port, { host: LINK_HOST, path: "/" });
      expect(cold.status).toBe(401);
      expect(cold.body).toContain("Open this link from Loom");

      const duplicate = yield* send(gateway.port, {
        host: LINK_HOST,
        headers: {
          cookie: `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}; ${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}`,
        },
      });
      expect(duplicate.status).toBe(401);

      const caseFolded = yield* send(gateway.port, {
        host: LINK_HOST,
        headers: { cookie: `__host-loom_pv=${GOOD_COOKIE}` },
      });
      expect(caseFolded.status).toBe(401);
      expect(upstream.requests).toHaveLength(0);
    }),
  );

  it.live("refuses denied ports and cross-site requests", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const denied = yield* send(gateway.port, { host: DENIED_HOST, headers: signedIn });
      expect(denied.status).toBe(403);
      expect(denied.body).toContain("can&#39;t be previewed");

      const crossSite = yield* send(gateway.port, {
        host: LINK_HOST,
        method: "POST",
        headers: { ...signedIn, origin: "https://evil.example", "sec-fetch-mode": "cors" },
        body: ["x"],
      });
      expect(crossSite.status).toBe(403);

      // A sibling preview host is same-site, so its form POST arrives with the cookie.
      const siblingForm = yield* send(gateway.port, {
        host: LINK_HOST,
        method: "POST",
        path: "/form",
        headers: {
          ...signedIn,
          origin: "https://5174-zzzzzz-dorothy.bagels.top",
          "sec-fetch-mode": "navigate",
        },
        body: ["x"],
      });
      expect(siblingForm.status).toBe(403);

      const navigation = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/page",
        headers: { ...signedIn, origin: "https://evil.example", "sec-fetch-mode": "navigate" },
      });
      expect(navigation.status).toBe(200);
      expect(upstream.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET /page",
      ]);
    }),
  );

  it.live("accepts a no-referrer page's own form post but not a sibling's", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const nullOriginPost = (fetchSite: string) =>
        send(gateway.port, {
          host: LINK_HOST,
          method: "POST",
          path: "/login",
          headers: {
            ...signedIn,
            origin: "null",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": fetchSite,
          },
          body: ["user=me"],
        });
      expect((yield* nullOriginPost("same-origin")).status).toBe(200);
      // A redirect through a sibling host also nulls Origin, but leaves the request same-site.
      expect((yield* nullOriginPost("same-site")).status).toBe(403);
      expect(upstream.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "POST /login",
      ]);
    }),
  );

  it.live("rewrites request headers and keeps the app's own cookies", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const reply = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/api/items?q=1",
        method: "POST",
        headers: {
          cookie: `theme=dark; ${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}; __Host-loom_other=1; sid=abc`,
          origin: ORIGIN,
          referer: `${ORIGIN}/app?tab=1`,
          authorization: "Bearer app-token",
          "x-custom": "kept",
        },
        body: ["first,", "second"],
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toBe("echo:first,second");
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      expect(reply.headers["x-robots-tag"]).toBe("noindex, nofollow");

      const [request] = upstream.requests;
      expect(request?.method).toBe("POST");
      expect(request?.url).toBe("/api/items?q=1");
      expect(request?.body).toBe("first,second");
      expect(request?.headers.host).toBe(`localhost:${upstream.port}`);
      expect(request?.headers.origin).toBe(`http://localhost:${upstream.port}`);
      expect(request?.headers.referer).toBe(`http://localhost:${upstream.port}/app?tab=1`);
      expect(request?.headers.cookie).toBe("theme=dark; sid=abc");
      expect(request?.headers.authorization).toBe("Bearer app-token");
      expect(request?.headers["x-custom"]).toBe("kept");
    }),
  );

  it.live("rewrites Location and Set-Cookie on responses", () =>
    Effect.gen(function* () {
      const { gateway } = yield* setup;
      const reply = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/redirect",
        headers: signedIn,
      });
      expect(reply.status).toBe(302);
      expect(reply.headers.location).toBe(`${ORIGIN}/next?step=2`);
      expect(reply.headers["set-cookie"]).toEqual(["app=1; Path=/", "other=2; path=/; HttpOnly"]);
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      expect(reply.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(reply.headers["cdn-cache-control"]).toBeUndefined();
      expect(reply.headers["cloudflare-cdn-cache-control"]).toBeUndefined();
      expect(reply.headers["surrogate-control"]).toBeUndefined();

      const elsewhere = yield* send(gateway.port, {
        host: LINK_HOST,
        path: "/elsewhere",
        headers: signedIn,
      });
      expect(elsewhere.headers.location).toBe("http://127.0.0.1:1/away");
    }),
  );

  it.live("re-frames a chunked body so it cannot pose as another request", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const body = "GET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n";
      const { socket } = yield* rawExchange(
        gateway.port,
        `DELETE /items/1 HTTP/1.1\r\nHost: ${LINK_HOST}\r\n` +
          `Cookie: ${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}\r\nTransfer-Encoding: chunked\r\n\r\n` +
          `${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\n`,
        `echo:${body}`,
      );
      socket.destroy();
      expect(upstream.requests).toEqual([
        expect.objectContaining({ method: "DELETE", url: "/items/1", body }),
      ]);
      expect(upstream.requests[0]?.headers["transfer-encoding"]).toBe("chunked");
    }),
  );

  it.live("cuts a streaming response when its connections are dropped", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const response = yield* Effect.promise(
        () =>
          new Promise<NodeHttp.IncomingMessage>((resolve, reject) => {
            const request = NodeHttp.request(
              {
                agent: false,
                host: "127.0.0.1",
                port: gateway.port,
                path: "/events",
                headers: { host: LINK_HOST, ...signedIn },
              },
              (reply) => {
                // A cut stream errors with "aborted"; unhandled, that would fail the run.
                reply.on("error", () => {});
                reply.once("data", () => resolve(reply));
              },
            );
            request.on("error", reject);
            request.end();
          }),
      );
      expect(response.headers["content-type"]).toBe("text/event-stream");

      const closed = new Promise<boolean>((resolve) =>
        response.once("close", () => resolve(response.complete)),
      );
      gateway.destroyConnections(({ host, key }) => host === LINK_HOST && key === "session-1");
      expect(yield* Effect.promise(() => closed)).toBe(false);
      yield* Effect.promise(() => upstream.eventStreamClosed);
    }),
  );

  it.live("explains that nothing is listening when the port is closed", () =>
    Effect.gen(function* () {
      const closed = yield* freePort;
      const view = makeView({ link: closed, denied: 1 });
      const gateway = yield* startPreviewGateway({ port: 0, view });
      const reply = yield* send(gateway.port, { host: LINK_HOST, headers: signedIn });
      expect(reply.status).toBe(502);
      expect(reply.body).toContain(`Nothing is answering on port ${closed} yet`);
      expect(reply.headers["cache-control"]).toBe("private, no-store");

      const upgrade = yield* rawExchange(
        gateway.port,
        upgradeRequest({ Origin: ORIGIN, Cookie: `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}` }),
        "\r\n\r\n",
      );
      expect(upgrade.received.startsWith("HTTP/1.1 502")).toBe(true);
      upgrade.socket.destroy();
    }),
  );

  it.live("pipes an upgrade both ways and ends it on request", () =>
    Effect.gen(function* () {
      const target = yield* upgradeServer;
      const view = makeView({ link: target.port, denied: 1 });
      const gateway = yield* startPreviewGateway({ port: 0, view });

      const { socket, received } = yield* rawExchange(
        gateway.port,
        upgradeRequest(
          { Origin: ORIGIN, Cookie: `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}` },
          "early",
        ),
        "early",
      );
      expect(received.startsWith("HTTP/1.1 101")).toBe(true);
      expect(received).toContain("Sec-WebSocket-Protocol: vite-hmr");

      const head = target.heads[0] ?? "";
      expect(head.startsWith("GET /hmr?token=1 HTTP/1.1\r\n")).toBe(true);
      expect(head).toContain(`host: localhost:${target.port}`);
      expect(head).toContain(`origin: http://localhost:${target.port}`);
      expect(head).toContain("sec-websocket-protocol: vite-hmr");
      expect(head).toContain("sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==");
      expect(head).toContain("sec-websocket-version: 13");
      expect(head).toContain("sec-websocket-extensions: permessage-deflate");
      expect(head).toContain("connection: Upgrade");
      expect(head).toContain("upgrade: websocket");
      expect(head).not.toContain(PREVIEW_COOKIE_NAME);

      const echoed = yield* Effect.promise(
        () =>
          new Promise<string>((resolve) => {
            socket.once("data", (chunk: Buffer) => resolve(chunk.toString("latin1")));
            socket.write("ping");
          }),
      );
      expect(echoed).toBe("ping");

      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      gateway.destroyConnections(({ host, key }) => host === LINK_HOST && key === "session-1");
      yield* Effect.promise(() => closed);
      expect(socket.destroyed).toBe(true);
    }),
  );

  it.live("refuses an upgrade from another origin", () =>
    Effect.gen(function* () {
      const target = yield* upgradeServer;
      const view = makeView({ link: target.port, denied: 1 });
      const gateway = yield* startPreviewGateway({ port: 0, view });
      const signedInCookie = `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}`;

      const foreign = yield* rawExchange(
        gateway.port,
        upgradeRequest({ Origin: "https://evil.example", Cookie: signedInCookie }),
        "\r\n\r\n",
      );
      expect(foreign.received.startsWith("HTTP/1.1 403")).toBe(true);
      foreign.socket.destroy();

      const missing = yield* rawExchange(
        gateway.port,
        upgradeRequest({ Cookie: signedInCookie }),
        "\r\n\r\n",
      );
      expect(missing.received.startsWith("HTTP/1.1 403")).toBe(true);
      missing.socket.destroy();

      // Only an opaque origin sends a WebSocket `Origin: null`, so the form-post rule stays out.
      const opaque = yield* rawExchange(
        gateway.port,
        upgradeRequest({ Origin: "null", "Sec-Fetch-Site": "same-origin", Cookie: signedInCookie }),
        "\r\n\r\n",
      );
      expect(opaque.received.startsWith("HTTP/1.1 403")).toBe(true);
      opaque.socket.destroy();
      expect(target.heads).toHaveLength(0);
    }),
  );

  it.live("closes an upgrade the upstream answers without switching", () =>
    Effect.gen(function* () {
      const { gateway, upstream } = yield* setup;
      const bypass = (path: string) =>
        `GET ${path} HTTP/1.1\r\nHost: ${LINK_HOST}\r\nCookie: ${PREVIEW_COOKIE_NAME}=stolen\r\n\r\n`;
      const received = yield* Effect.promise(
        () =>
          new Promise<string>((resolve) => {
            const socket = NodeNet.connect({ host: "127.0.0.1", port: gateway.port });
            let text = "";
            // A write that races the gateway's close may be reset; what reached the upstream counts.
            socket.on("error", () => {});
            socket.on("data", (chunk: Buffer) => {
              const answered = text.includes(NO_SOCKET_BODY);
              text += chunk.toString("latin1");
              if (!answered && text.includes(NO_SOCKET_BODY)) socket.write(bypass("/after-reply"));
            });
            socket.on("close", () => resolve(text));
            socket.write(
              upgradeRequest(
                { Origin: ORIGIN, Cookie: `${PREVIEW_COOKIE_NAME}=${GOOD_COOKIE}` },
                bypass("/pipelined"),
                NO_SOCKET_PATH,
              ),
            );
          }),
      );
      expect(received.match(/HTTP\/1\.1 /g)).toHaveLength(1);
      expect(received.startsWith("HTTP/1.1 404 Not Found\r\n")).toBe(true);
      expect(received).toContain("connection: close\r\n");
      expect(received).toContain("cache-control: private, no-store\r\n");
      expect(received.endsWith(NO_SOCKET_BODY)).toBe(true);
      expect(upstream.requests.map((request) => request.url)).toEqual([NO_SOCKET_PATH]);
      // Left open, a later reset from the upstream would have no listener and end the process.
      yield* Effect.promise(() => upstream.noSocketClosed);
    }),
  );

  it.live("fails with a plain message when the port is busy", () =>
    Effect.gen(function* () {
      const busy = yield* Effect.acquireRelease(
        Effect.callback<NodeNet.Server>((resume) => {
          const server = NodeNet.createServer();
          server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
        }),
        (server) =>
          Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          }),
      );
      const port = boundPort(busy);
      const error = yield* Effect.flip(
        startPreviewGateway({ port, view: makeView({ link: 1, denied: 1 }) }),
      );
      expect(error).toMatchObject({
        _tag: "PreviewGatewayListenError",
        port,
        message: `Port ${port} is already in use on this computer.`,
      });
    }),
  );
});
