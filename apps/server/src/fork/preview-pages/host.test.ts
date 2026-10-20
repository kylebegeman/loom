// @effect-diagnostics nodeBuiltinImport:off - The pages host is tested against real loopback sockets.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { PreviewPagesError, type PreviewPage } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SecretStoreReadError, ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import { PreviewAccessService } from "../preview-access/PreviewAccessService.ts";
import { signPreviewCookie, verifyPreviewCookie } from "../preview-links/policy.ts";
import {
  generatePreviewTicketKeyPair,
  PREVIEW_NONCE_COOKIE_NAME,
  previewTicketAudience,
  previewTicketKeyId,
  previewTicketPrivateKey,
  previewTicketPublicKey,
  signPreviewTicket,
  verifyPreviewTicket,
} from "../preview-links/ticket.ts";
import { PREVIEW_COOKIE_NAME } from "../preview-links/types.ts";
import { PagesHostLive, startPagesHost } from "./host.ts";
import { PageLibraryService } from "./PageLibraryService.ts";

const PAGES_HOST = "pages.example.test";
const PAGES_ORIGIN = `https://${PAGES_HOST}`;
const LIBRARY_ORIGIN = "https://library.example.test";
const PAGE_ID = "AbCdEfGhIjKlMnOpQrStUv";
const ENDED_ID = "ended_page_id_00000000";
const BROKEN_ID = "broken_page_id_0000000";
const BLOCKED_ID = "blocked_page_id_000000";
const PAGE_HTML = "<!doctype html><p>The plan</p>";
const COOKIE_KEY = new Uint8Array(32).fill(7);
const RAW_POLICY = `sandbox allow-scripts allow-forms allow-popups allow-downloads; frame-ancestors ${PAGES_ORIGIN}`;
const NONCE_COOKIE_PATTERN = new RegExp(
  `^${PREVIEW_NONCE_COOKIE_NAME}=([A-Za-z0-9_-]{43}); Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax$`,
);

const ticketKeys = () => {
  const pair = generatePreviewTicketKeyPair();
  const signing = previewTicketPrivateKey(pair.privateKey);
  const verifying = previewTicketPublicKey(pair.publicKey);
  if (signing === null || verifying === null) throw new Error("Test ticket keys are invalid.");
  return { keyId: previewTicketKeyId(pair.publicKey), signing, verifying };
};
const { keyId: KEY_ID, signing: SIGNING_KEY, verifying: VERIFYING_KEY } = ticketKeys();

const PAGE: PreviewPage = {
  id: PAGE_ID,
  url: `${PAGES_ORIGIN}/p/${PAGE_ID}`,
  title: "Plan <draft>",
  kind: "html",
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
  state: "open",
  kept: false,
  sizeBytes: PAGE_HTML.length,
  createdAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-10-26T00:00:00.000Z",
  endedAt: null,
  restorableUntil: null,
};

interface ReplyCall {
  readonly pageId: string;
  readonly replyId: string;
  readonly text: string;
  readonly viewer: string;
}

interface LibraryState {
  readonly replies: Array<ReplyCall>;
  /** The latest pages sign-out the Library recorded. */
  signedOutAt: number;
}

/** The Library side the host depends on: one open page, one ended, and failures on demand. */
const libraryLayer = (state: LibraryState, options: { readonly keyMissing?: boolean } = {}) =>
  Layer.mergeAll(
    Layer.mock(PageLibraryService)({
      pagesOrigin: PAGES_ORIGIN,
      view: (pageId) =>
        pageId === BROKEN_ID
          ? Effect.fail(new PreviewPagesError({ reason: "io", message: "Storage is down." }))
          : Effect.succeed(pageId === PAGE_ID ? { page: PAGE, html: PAGE_HTML } : null),
      addReply: (input) =>
        input.pageId === BLOCKED_ID
          ? Effect.fail(new PreviewPagesError({ reason: "blocked", message: "Too many replies." }))
          : Effect.sync(() => void state.replies.push(input)),
      readersSignedOutAt: Effect.sync(() => state.signedOutAt),
    }),
    Layer.mock(PreviewAccessService)({
      issuerOrigin: LIBRARY_ORIGIN,
      verifyTicket: (input) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((nowMs) =>
            verifyPreviewTicket(input.token, {
              publicKey: VERIFYING_KEY,
              keyId: KEY_ID,
              issuer: LIBRARY_ORIGIN,
              audience: previewTicketAudience(input.host),
              nonce: input.nonce,
              nowMs,
            }),
          ),
        ),
    }),
    Layer.mock(ServerSecretStore)({
      getOrCreateRandom: () =>
        options.keyMissing === true
          ? Effect.fail(
              new SecretStoreReadError({ resource: "pages cookie key", cause: "unreadable" }),
            )
          : Effect.succeed(Uint8Array.from(COOKIE_KEY)),
    }),
  );

const setupWith = (options: { readonly keyMissing?: boolean }) =>
  Effect.gen(function* () {
    const state: LibraryState = { replies: [], signedOutAt: 0 };
    const host = yield* startPagesHost({
      host: "127.0.0.1",
      port: 0,
      pagesOrigin: PAGES_ORIGIN,
      issuerOrigin: LIBRARY_ORIGIN,
    }).pipe(Effect.provide(libraryLayer(state, options)));
    return { port: host.port, replies: state.replies, state };
  });
const setup = setupWith({});

const boundPort = (server: NodeNet.Server) => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

const freePort = Effect.callback<number>((resume) => {
  const server = NodeNet.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = boundPort(server);
    server.close(() => resume(Effect.succeed(port)));
  });
});

interface Reply {
  readonly status: number;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
}

const send = (
  port: number,
  options: {
    readonly host?: string;
    readonly path: string;
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    /** False leaves the request open after the body, as a client still uploading does. */
    readonly end?: boolean;
  },
) =>
  Effect.promise(
    () =>
      new Promise<Reply>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            agent: false,
            host: "127.0.0.1",
            port,
            method: options.method ?? "GET",
            path: options.path,
            headers: { host: options.host ?? PAGES_HOST, ...options.headers },
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
        if (options.body !== undefined) request.write(options.body);
        if (options.end !== false) request.end();
      }),
  );

/** Writes `data` on a bare socket and never ends it, then reads until the host closes it. */
const sendRaw = (port: number, data: string) =>
  Effect.promise(
    () =>
      new Promise<string>((resolve) => {
        const socket = NodeNet.connect(port, "127.0.0.1", () => socket.write(data));
        let received = "";
        socket.on("data", (chunk: Buffer) => (received += chunk.toString("utf8")));
        socket.on("error", () => {});
        socket.on("close", () => resolve(received));
      }),
  );

const navigation = { "sec-fetch-mode": "navigate", accept: "text/html" };

/** The sign-in link on a page, or null when it has none. */
const signInLink = (body: string) => {
  const href = /<a href="([^"]+)">Sign in with Loom<\/a>/.exec(body)?.[1];
  return href === undefined ? null : new URL(href.replaceAll("&#38;", "&"));
};

const issuedNonce = (reply: Reply) => {
  const cookies = reply.headers["set-cookie"] ?? [];
  expect(cookies).toHaveLength(1);
  return NONCE_COOKIE_PATTERN.exec(cookies[0] ?? "")?.[1] ?? null;
};

const ticketFor = (nonce: string, audienceHost = PAGES_HOST) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((nowMs) =>
      signPreviewTicket({
        privateKey: SIGNING_KEY,
        keyId: KEY_ID,
        issuer: LIBRARY_ORIGIN,
        audience: previewTicketAudience(audienceHost),
        subject: "owner",
        nonce,
        nowMs,
      }),
    ),
  );

const redeem = (port: number, ticket: string, nonce: string, path = `/p/${PAGE_ID}`) =>
  send(port, {
    path: `/__loom/ticket?${new URLSearchParams({ ticket, path })}`,
    headers: { ...navigation, cookie: `${PREVIEW_NONCE_COOKIE_NAME}=${nonce}` },
  });

/** A fresh browser nonce, as the sign-in page issues it. */
const browserNonce = (port: number) =>
  send(port, { path: `/p/${PAGE_ID}`, headers: navigation }).pipe(
    Effect.map((reply) => {
      const nonce = issuedNonce(reply);
      if (nonce === null) throw new Error("The sign-in page issued no nonce.");
      return nonce;
    }),
  );

const signedIn = Clock.currentTimeMillis.pipe(
  Effect.map((nowMs) => {
    const value = signPreviewCookie(
      {
        sub: "owner",
        key: "library:owner",
        host: PAGES_HOST,
        iat: nowMs,
        exp: Math.floor(nowMs / 1000) + 3600,
      },
      COOKIE_KEY,
    );
    return { cookie: `${PREVIEW_COOKIE_NAME}=${value}` };
  }),
);

const replyRequest = (
  port: number,
  headers: Record<string, string>,
  body: string,
  pageId = PAGE_ID,
) =>
  send(port, {
    method: "POST",
    path: `/p/${pageId}/replies`,
    headers: { origin: PAGES_ORIGIN, "content-type": "application/json", ...headers },
    body,
  });

describe("pages host", () => {
  it.live("answers any other host with 421", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const reply = yield* send(port, {
        host: "library.example.test",
        path: `/p/${PAGE_ID}`,
        headers: { ...navigation, ...(yield* signedIn) },
      });
      expect(reply.status).toBe(421);
      expect(reply.headers["set-cookie"]).toBeUndefined();
    }),
  );

  it.live("links a signed-out page navigation to Library sign-in with a fresh nonce", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const reply = yield* send(port, { path: `/p/${PAGE_ID}`, headers: navigation });
      expect(reply.status).toBe(401);
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      const nonce = issuedNonce(reply);
      expect(nonce).not.toBeNull();
      const link = signInLink(reply.body);
      expect(link?.origin).toBe(LIBRARY_ORIGIN);
      expect(link?.pathname).toBe("/api/loom/preview/ticket");
      expect(Object.fromEntries(link?.searchParams ?? [])).toEqual({
        host: PAGES_HOST,
        nonce,
        path: `/p/${PAGE_ID}`,
      });

      const again = yield* send(port, { path: `/p/${PAGE_ID}`, headers: navigation });
      expect(issuedNonce(again)).not.toBe(nonce);
    }),
  );

  it.live("answers signed-out requests that are not navigations without a sign-in page", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const page = yield* send(port, { path: `/p/${PAGE_ID}`, headers: { accept: "*/*" } });
      expect(page.status).toBe(401);
      expect(page.body).toBe("Sign in required");
      expect(page.headers["set-cookie"]).toBeUndefined();
      const raw = yield* send(port, { path: `/raw/${PAGE_ID}`, headers: navigation });
      expect(raw.status).toBe(401);
      expect(raw.headers["set-cookie"]).toBeUndefined();
    }),
  );

  it.live("trades a Library ticket for the pages cookie and clears the nonce", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const nonce = yield* browserNonce(port);
      const reply = yield* redeem(port, yield* ticketFor(nonce), nonce);
      expect(reply.status).toBe(303);
      expect(reply.headers.location).toBe(`/p/${PAGE_ID}`);
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      expect(reply.headers["referrer-policy"]).toBe("no-referrer");
      const [session, clear] = reply.headers["set-cookie"] ?? [];
      expect(clear).toBe(
        `${PREVIEW_NONCE_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      );
      const value = new RegExp(
        `^${PREVIEW_COOKIE_NAME}=([^;]+); Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Lax$`,
      ).exec(session ?? "")?.[1];
      const nowMs = yield* Clock.currentTimeMillis;
      expect(verifyPreviewCookie(value ?? "", COOKIE_KEY, PAGES_HOST, nowMs)).toMatchObject({
        sub: "owner",
        key: "library:owner",
      });
    }),
  );

  it.live("spends a ticket and its nonce once each", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const nonce = yield* browserNonce(port);
      const ticket = yield* ticketFor(nonce);
      expect((yield* redeem(port, ticket, nonce)).status).toBe(303);

      const replayed = yield* redeem(port, ticket, nonce);
      expect(replayed.status).toBe(401);
      expect(
        replayed.headers["set-cookie"]?.some((c) => c.startsWith(`${PREVIEW_COOKIE_NAME}=`)),
      ).toBe(false);
      // The refusal offers a fresh start for the page the browser was opening.
      const fresh = issuedNonce(replayed);
      expect(fresh).not.toBe(nonce);
      expect(signInLink(replayed.body)?.searchParams.get("nonce")).toBe(fresh);

      const sameNonce = yield* redeem(port, yield* ticketFor(nonce), nonce);
      expect(sameNonce.status).toBe(401);
    }),
  );

  it.live("refuses a ticket for another nonce or another host", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const nonce = yield* browserNonce(port);
      const other = yield* browserNonce(port);

      const wrongNonce = yield* redeem(port, yield* ticketFor(other), nonce);
      expect(wrongNonce.status).toBe(401);
      const wrongHost = yield* redeem(
        port,
        yield* ticketFor(nonce, "3000-abc-dorothy.bagels.top"),
        nonce,
      );
      expect(wrongHost.status).toBe(401);
      // Neither refusal spent the nonce, so the right ticket still works.
      expect((yield* redeem(port, yield* ticketFor(nonce), nonce)).status).toBe(303);

      const noNonce = yield* send(port, {
        path: `/__loom/ticket?${new URLSearchParams({ ticket: yield* ticketFor(other) })}`,
        headers: navigation,
      });
      expect(noNonce.status).toBe(401);
      expect((yield* send(port, { path: "/__loom/ticket", headers: navigation })).status).toBe(400);
    }),
  );

  it.live("serves the shell with its own nonce'd policy around the raw page", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const cookie = yield* signedIn;
      const reply = yield* send(port, {
        path: `/p/${PAGE_ID}`,
        headers: { ...navigation, ...cookie },
      });
      expect(reply.status).toBe(200);
      expect(reply.headers["x-frame-options"]).toBe("DENY");
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      const policy = String(reply.headers["content-security-policy"]);
      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(policy).toContain(`style-src 'nonce-${nonce}'`);
      expect(policy).toContain("frame-ancestors 'none'");
      expect(reply.body).toContain(`<script nonce="${nonce}">`);
      expect(reply.body).toContain(`<style nonce="${nonce}">`);
      expect(reply.body).toContain("Plan &#60;draft&#62;");
      expect(reply.body).not.toContain("Plan <draft>");
      expect(reply.body).toContain(`"/raw/${PAGE_ID}"`);

      const again = yield* send(port, { path: `/p/${PAGE_ID}`, headers: cookie });
      expect(again.headers["content-security-policy"]).not.toBe(policy);
    }),
  );

  it.live("serves the raw page sandboxed without its own origin", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const reply = yield* send(port, { path: `/raw/${PAGE_ID}`, headers: yield* signedIn });
      expect(reply.status).toBe(200);
      expect(reply.body).toBe(PAGE_HTML);
      expect(reply.headers["content-security-policy"]).toBe(RAW_POLICY);
      expect(reply.headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(reply.headers["x-content-type-options"]).toBe("nosniff");
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      expect(reply.headers["referrer-policy"]).toBe("no-referrer");
    }),
  );

  it.live("explains ended pages and survives a Library that cannot answer", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const cookie = yield* signedIn;
      const ended = yield* send(port, {
        path: `/p/${ENDED_ID}`,
        headers: { ...navigation, ...cookie },
      });
      expect(ended.status).toBe(404);
      expect(ended.body).toContain("This page has ended or expired");
      expect((yield* send(port, { path: `/raw/${ENDED_ID}`, headers: cookie })).status).toBe(404);

      const broken = yield* send(port, {
        path: `/p/${BROKEN_ID}`,
        headers: { ...navigation, ...cookie },
      });
      expect(broken.status).toBe(503);
      expect(broken.body).toContain("This page could not load");
      expect((yield* send(port, { path: `/raw/${BROKEN_ID}`, headers: cookie })).status).toBe(503);
    }),
  );

  it.live("routes nothing else", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const cookie = yield* signedIn;
      expect((yield* send(port, { path: "/", headers: cookie })).status).toBe(404);
      expect((yield* send(port, { path: "/api/loom/library", headers: cookie })).status).toBe(404);
      expect((yield* send(port, { path: `/p/${PAGE_ID}x`, headers: cookie })).status).toBe(404);
      const post = yield* send(port, { method: "POST", path: `/p/${PAGE_ID}`, headers: cookie });
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe("GET");
      const head = yield* send(port, { method: "HEAD", path: "/__loom/ticket?ticket=x" });
      expect(head.status).toBe(405);
      const getReplies = yield* send(port, { path: `/p/${PAGE_ID}/replies`, headers: cookie });
      expect(getReplies.status).toBe(405);
      expect(getReplies.headers.allow).toBe("POST");
    }),
  );

  it.live("closes upgrade requests instead of holding them open", () =>
    Effect.gen(function* () {
      const { port } = yield* setup;
      const received = yield* sendRaw(
        port,
        `GET /p/${PAGE_ID} HTTP/1.1\r\nHost: ${PAGES_HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
      expect(received).toBe("");
    }),
  );

  it.live("takes a reply from the signed-in reader on the pages origin", () =>
    Effect.gen(function* () {
      const { port, replies } = yield* setup;
      const cookie = yield* signedIn;
      const body = JSON.stringify({ replyId: "reply-0001", text: "Ship option B." });
      const reply = yield* replyRequest(port, cookie, body);
      expect(reply.status).toBe(201);
      expect(JSON.parse(reply.body)).toEqual({ ok: true });
      expect(replies).toEqual([
        { pageId: PAGE_ID, replyId: "reply-0001", text: "Ship option B.", viewer: "owner" },
      ]);
    }),
  );

  it.live("refuses replies without a session, from another origin or in another shape", () =>
    Effect.gen(function* () {
      const { port, replies } = yield* setup;
      const cookie = yield* signedIn;
      const body = JSON.stringify({ replyId: "reply-0001", text: "Hi" });

      const signedOut = yield* replyRequest(port, {}, body);
      expect(signedOut.status).toBe(401);
      expect(JSON.parse(signedOut.body)).toEqual({ reason: "unauthorized" });
      for (const origin of ["https://evil.example.test", "null", `${PAGES_ORIGIN}:8443`]) {
        const foreign = yield* replyRequest(port, { ...cookie, origin }, body);
        expect(foreign.status).toBe(403);
        expect(JSON.parse(foreign.body)).toEqual({ reason: "forbidden" });
      }
      const form = yield* replyRequest(
        port,
        { ...cookie, "content-type": "application/x-www-form-urlencoded" },
        body,
      );
      expect(form.status).toBe(415);
      const malformed = yield* replyRequest(port, cookie, '{"replyId":"reply-0001"}');
      expect(malformed.status).toBe(400);
      expect(JSON.parse(malformed.body)).toEqual({ reason: "invalid" });
      const blocked = yield* replyRequest(port, cookie, body, BLOCKED_ID);
      expect(blocked.status).toBe(429);
      expect(JSON.parse(blocked.body)).toEqual({ reason: "blocked" });
      expect(replies).toEqual([]);
    }),
  );

  it.live("refuses a reply body over 64 KiB, declared or streamed", () =>
    Effect.gen(function* () {
      const { port, replies } = yield* setup;
      const cookie = yield* signedIn;
      const headers = {
        ...cookie,
        origin: PAGES_ORIGIN,
        "content-type": "application/json",
      };
      const declared = yield* send(port, {
        method: "POST",
        path: `/p/${PAGE_ID}/replies`,
        headers: { ...headers, "content-length": String(64 * 1024 + 1) },
      });
      expect(declared.status).toBe(413);
      expect(declared.headers.connection).toBe("close");
      expect(JSON.parse(declared.body)).toEqual({ reason: "too-large" });

      // Chunked, so the host only learns the size by reading; the request stays open, as an
      // upload would, and the host answers without waiting for it to finish.
      const streamed = yield* send(port, {
        method: "POST",
        path: `/p/${PAGE_ID}/replies`,
        headers,
        body: "x".repeat(64 * 1024 + 1),
        end: false,
      });
      expect(streamed.status).toBe(413);
      expect(streamed.headers.connection).toBe("close");

      // The host hangs up rather than reading the rest: this upload never ends, yet the
      // connection closes after the answer.
      const chunk = "x".repeat(64 * 1024 + 1);
      const received = yield* sendRaw(
        port,
        [
          `POST /p/${PAGE_ID}/replies HTTP/1.1`,
          `Host: ${PAGES_HOST}`,
          `Origin: ${PAGES_ORIGIN}`,
          "Content-Type: application/json",
          `Cookie: ${cookie.cookie}`,
          "Transfer-Encoding: chunked",
          "",
          `${chunk.length.toString(16)}\r\n${chunk}\r\n`,
        ].join("\r\n"),
      );
      expect(received).toMatch(/^HTTP\/1\.1 413 /);
      expect(received).toMatch(/\r\nconnection: close\r\n/i);
      expect(received).toContain('{"reason":"too-large"}');
      expect(replies).toEqual([]);
    }),
  );

  it.live("refuses sessions from before a pages sign-out and signs in again after it", () =>
    Effect.gen(function* () {
      const { port, replies, state } = yield* setup;
      const cookie = yield* signedIn;
      state.signedOutAt = yield* Clock.currentTimeMillis;

      const page = yield* send(port, {
        path: `/p/${PAGE_ID}`,
        headers: { ...navigation, ...cookie },
      });
      expect(page.status).toBe(401);
      expect(signInLink(page.body)?.origin).toBe(LIBRARY_ORIGIN);
      const raw = yield* send(port, { path: `/raw/${PAGE_ID}`, headers: cookie });
      expect(raw.status).toBe(401);
      const reply = yield* replyRequest(
        port,
        cookie,
        JSON.stringify({ replyId: "reply-0001", text: "Hi" }),
      );
      expect(reply.status).toBe(401);
      expect(JSON.parse(reply.body)).toEqual({ reason: "unauthorized" });
      expect(replies).toEqual([]);

      // A sign-out stamped ahead of this host's clock still lets the next sign-in through.
      state.signedOutAt = (yield* Clock.currentTimeMillis) + 60 * 1000;
      const nonce = yield* browserNonce(port);
      const redeemed = yield* redeem(port, yield* ticketFor(nonce), nonce);
      expect(redeemed.status).toBe(303);
      const session = redeemed.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
      const again = yield* send(port, {
        path: `/p/${PAGE_ID}`,
        headers: { ...navigation, cookie: session },
      });
      expect(again.status).toBe(200);
    }),
  );

  it.live("signs no one in without its stored cookie key", () =>
    Effect.gen(function* () {
      const { port, replies } = yield* setupWith({ keyMissing: true });
      const cookie = yield* signedIn;

      const page = yield* send(port, {
        path: `/p/${PAGE_ID}`,
        headers: { ...navigation, ...cookie },
      });
      expect(page.status).toBe(503);
      expect(page.body).toContain("Sign-in is unavailable");
      expect(page.headers["set-cookie"]).toBeUndefined();
      expect(page.headers["cache-control"]).toBe("private, no-store");

      const nonce = "n".repeat(43);
      const redeemed = yield* redeem(port, yield* ticketFor(nonce), nonce);
      expect(redeemed.status).toBe(503);
      expect(redeemed.headers["set-cookie"]).toBeUndefined();

      const raw = yield* send(port, { path: `/raw/${PAGE_ID}`, headers: cookie });
      expect(raw.status).toBe(503);
      expect(raw.body).toBe("Sign-in is unavailable");
      const reply = yield* replyRequest(
        port,
        cookie,
        JSON.stringify({ replyId: "reply-0001", text: "Hi" }),
      );
      expect(reply.status).toBe(503);
      expect(replies).toEqual([]);

      const misdirected = yield* send(port, {
        host: "library.example.test",
        path: `/p/${PAGE_ID}`,
        headers: navigation,
      });
      expect(misdirected.status).toBe(421);
    }),
  );
});

describe("PagesHostLive", () => {
  const hostLayer = (env: Record<string, string>) =>
    PagesHostLive.pipe(
      Layer.provide(libraryLayer({ replies: [], signedOutAt: 0 })),
      Layer.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "loom-pages-host-test-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
      ),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    );

  it.live("serves pages on LOOM_PAGES_PORT", () =>
    Effect.gen(function* () {
      const port = yield* freePort;
      yield* Layer.build(hostLayer({ LOOM_PAGES_PORT: String(port) }));
      const reply = yield* send(port, { path: `/p/${PAGE_ID}`, headers: navigation });
      expect(reply.status).toBe(401);
      expect(signInLink(reply.body)?.origin).toBe(LIBRARY_ORIGIN);
    }),
  );

  it.live("keeps the server up when the pages port is taken or invalid", () =>
    Effect.gen(function* () {
      const taken = yield* Effect.acquireRelease(
        Effect.callback<NodeNet.Server>((resume) => {
          const server = NodeNet.createServer();
          server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
        }),
        (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
      );
      yield* Layer.build(hostLayer({ LOOM_PAGES_PORT: String(boundPort(taken)) }));
      yield* Layer.build(hostLayer({ LOOM_PAGES_PORT: "not-a-port" }));
    }),
  );
});
