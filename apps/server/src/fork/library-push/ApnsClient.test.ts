// @effect-diagnostics nodeBuiltinImport:off -- the test runs a cleartext HTTP/2 fake of APNs and verifies ES256 signatures.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp2 from "node:http2";
import type * as NodeNet from "node:net";

import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import * as ApnsClient from "./ApnsClient.ts";
import { alertPayload, LIBRARY_PUSH_TEST_ALERT } from "./apnsPayloads.ts";

const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY1234567";
const BUNDLE_ID = "com.kylebegeman.loom";
const DEVICE_ID = "device-sentinel-0001";
// Hex, so the client accepts it, and long enough that a match in any output is no accident.
const TOKEN = "5e471e1a".repeat(8);
const APNS_ID = "1e4d0c1a-0b9c-4d0e-8f3e-7a1b2c3d4e5f";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

// Throwaway key pair for this test run only.
const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PEM_BODY = PRIVATE_KEY_PEM.split("\n")[1] ?? "";

interface Received {
  readonly headers: NodeHttp2.IncomingHttpHeaders;
  readonly body: string;
  readonly stream: NodeHttp2.ServerHttp2Stream;
  /** Node detaches a closed stream from its session, so the session is kept here. */
  readonly session: NodeHttp2.Http2Session;
  /** Resolves with the stream's RST code once the stream closes. */
  readonly closed: Promise<number>;
}

type Responder = (request: Received) => void;

const reply =
  (status: number, reason?: string): Responder =>
  ({ stream }) => {
    stream.respond({ ":status": status, "apns-id": APNS_ID });
    stream.end(reason === undefined ? undefined : JSON.stringify({ reason }));
  };

const hang: Responder = () => {};

/** A cleartext HTTP/2 stand-in for APNs that answers each request with the next queued responder. */
const startFakeApns = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = NodeHttp2.createServer();
    const sessions = new Set<NodeHttp2.ServerHttp2Session>();
    const received: Array<Received> = [];
    const responders: Array<Responder> = [];
    const waiting: Array<(request: Received) => void> = [];
    server.on("session", (session) => {
      sessions.add(session);
      session.on("error", () => {});
    });
    server.on("stream", (stream, headers) => {
      const session = stream.session!;
      const chunks: Array<Buffer> = [];
      const closed = new Promise<number>((resolve) =>
        stream.on("close", () => resolve(stream.rstCode)),
      );
      stream.on("error", () => {});
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const request = { headers, body, stream, session, closed };
        received.push(request);
        (responders.shift() ?? reply(200))(request);
        waiting.shift()?.(request);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
    return {
      server,
      origin,
      sessions,
      received,
      respondWith: (...next: Array<Responder>) => void responders.push(...next),
      nextRequest: () =>
        Effect.promise(() => new Promise<Received>((resolve) => waiting.push(resolve))),
    };
  }),
  ({ server, sessions }) =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          for (const session of sessions) session.destroy();
          server.close(() => resolve());
        }),
    ),
);

type FakeApns = Effect.Success<typeof startFakeApns>;

const openSender = (production: FakeApns, sandbox: FakeApns = production) =>
  Effect.gen(function* () {
    const client = yield* ApnsClient.ApnsClient;
    return yield* client.open({
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey,
      origins: { production: production.origin, sandbox: sandbox.origin },
    });
  }).pipe(Effect.provide(ApnsClient.layer));

const testPush = (overrides: Partial<ApnsClient.ApnsSendInput> = {}): ApnsClient.ApnsSendInput => ({
  deviceId: DEVICE_ID,
  token: Redacted.make(TOKEN),
  bundleId: BUNDLE_ID,
  apsEnvironment: "production",
  request: LIBRARY_PUSH_TEST_ALERT,
  ...overrides,
});

const bearer = (request: Received) => {
  const authorization = request.headers.authorization ?? "";
  expect(authorization.startsWith("bearer ")).toBe(true);
  return authorization.slice("bearer ".length);
};

const decodeSegment = (segment: string | undefined): unknown =>
  JSON.parse(Buffer.from(segment ?? "", "base64url").toString("utf8"));

const verifyProviderToken = (jwt: string) => {
  const [header, claims, signature] = jwt.split(".");
  const signedWithKey = NodeCrypto.verify(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature ?? "", "base64url"),
  );
  return { header: decodeSegment(header), claims: decodeSegment(claims), signedWithKey };
};

describe("ApnsClient", () => {
  it.effect("sends an alert with APNs headers and an ES256 provider token", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);

      const delivery = yield* sender.send(testPush());

      expect(delivery).toEqual({ outcome: "sent", status: 200, reason: null, apnsId: APNS_ID });
      const [request] = apns.received;
      expect(request?.headers).toMatchObject({
        ":method": "POST",
        ":path": `/3/device/${TOKEN}`,
        "apns-push-type": "alert",
        "apns-topic": BUNDLE_ID,
        "apns-priority": "10",
        "apns-expiration": String(NOW / 1000 + 300),
        "apns-collapse-id": "loom-push-test",
        "content-type": "application/json",
      });
      expect(JSON.parse(request?.body ?? "")).toEqual(LIBRARY_PUSH_TEST_ALERT.payload);
      expect(verifyProviderToken(bearer(request!))).toEqual({
        header: { alg: "ES256", kid: KEY_ID },
        claims: { iss: TEAM_ID, iat: NOW / 1000 },
        signedWithKey: true,
      });
    }),
  );

  it.effect("sends sandbox devices to the sandbox origin", () =>
    Effect.gen(function* () {
      const production = yield* startFakeApns;
      const sandbox = yield* startFakeApns;
      const sender = yield* openSender(production, sandbox);

      yield* sender.send(testPush({ apsEnvironment: "sandbox" }));

      expect(production.received).toHaveLength(0);
      expect(sandbox.received).toHaveLength(1);
    }),
  );

  it.effect("reuses the provider token for 45 minutes, then signs a new one", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);

      yield* sender.send(testPush());
      yield* TestClock.adjust("44 minutes");
      yield* sender.send(testPush());
      yield* TestClock.adjust("1 minute");
      yield* sender.send(testPush());

      const [first, second, third] = apns.received.map(bearer);
      expect(second).toBe(first);
      expect(third).not.toBe(first);
      expect(verifyProviderToken(third!)).toMatchObject({
        claims: { iss: TEAM_ID, iat: NOW / 1000 + 45 * 60 },
        signedWithKey: true,
      });
    }),
  );

  it.effect.each<{
    readonly status: number;
    readonly reason: string;
    readonly outcome: ApnsClient.ApnsOutcome;
  }>([
    { status: 400, reason: "BadDeviceToken", outcome: "bad-token" },
    { status: 400, reason: "DeviceTokenNotForTopic", outcome: "bad-token" },
    { status: 410, reason: "Unregistered", outcome: "bad-token" },
    { status: 410, reason: "ExpiredToken", outcome: "bad-token" },
    { status: 403, reason: "InvalidProviderToken", outcome: "key-rejected" },
    { status: 403, reason: "MissingProviderToken", outcome: "key-rejected" },
    { status: 403, reason: "Forbidden", outcome: "key-rejected" },
    { status: 400, reason: "TopicDisallowed", outcome: "topic-disallowed" },
    { status: 400, reason: "BadTopic", outcome: "topic-disallowed" },
    { status: 403, reason: "BadEnvironmentKeyInToken", outcome: "topic-disallowed" },
    { status: 429, reason: "TooManyRequests", outcome: "rate-limited" },
    { status: 400, reason: "BadPriority", outcome: "other" },
    { status: 413, reason: "PayloadTooLarge", outcome: "other" },
  ])("maps $status $reason to $outcome", ({ status, reason, outcome }) =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(reply(status, reason));

      const delivery = yield* sender.send(testPush());

      expect(delivery).toEqual({ outcome, status, reason, apnsId: APNS_ID });
      expect(apns.received).toHaveLength(1);
    }),
  );

  it.effect("stops reading a reply body past 4 KiB and keeps only its status", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(({ stream }) => {
        stream.respond({ ":status": 400, "apns-id": APNS_ID });
        stream.end(JSON.stringify({ reason: "BadDeviceToken", padding: "x".repeat(8192) }));
      });

      expect(yield* sender.send(testPush())).toEqual({
        outcome: "other",
        status: 400,
        reason: null,
        apnsId: APNS_ID,
      });
    }),
  );

  it.effect("signs a new provider token and retries once on ExpiredProviderToken", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(reply(403, "ExpiredProviderToken"), reply(200));

      expect((yield* sender.send(testPush())).outcome).toBe("sent");

      const [rejected, retried] = apns.received.map(bearer);
      expect(retried).not.toBe(rejected);
      expect(verifyProviderToken(retried!).signedWithKey).toBe(true);

      apns.respondWith(reply(403, "ExpiredProviderToken"), reply(403, "ExpiredProviderToken"));
      expect(yield* sender.send(testPush())).toMatchObject({
        outcome: "key-rejected",
        reason: "ExpiredProviderToken",
      });
      expect(apns.received).toHaveLength(4);
    }),
  );

  it.effect("keeps the provider token after TooManyProviderTokenUpdates", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(reply(429, "TooManyProviderTokenUpdates"));

      expect((yield* sender.send(testPush())).outcome).toBe("rate-limited");
      expect((yield* sender.send(testPush())).outcome).toBe("sent");

      const [limited, next] = apns.received.map(bearer);
      expect(next).toBe(limited);
    }),
  );

  describe("retries once on a fresh connection", () => {
    it.effect.each<{ readonly name: string; readonly failure: Responder }>([
      { name: "503", failure: reply(503, "ServiceUnavailable") },
      {
        name: "GOAWAY",
        // A server going away refuses the streams it will not answer.
        failure: ({ session, stream }) => {
          session.goaway(NodeHttp2.constants.NGHTTP2_NO_ERROR);
          stream.close(NodeHttp2.constants.NGHTTP2_REFUSED_STREAM);
        },
      },
      { name: "a reset connection", failure: ({ session }) => session.socket.resetAndDestroy() },
    ])("after $name", ({ failure }) =>
      Effect.gen(function* () {
        const apns = yield* startFakeApns;
        const sender = yield* openSender(apns);
        apns.respondWith(failure, reply(200));

        expect((yield* sender.send(testPush())).outcome).toBe("sent");

        expect(apns.received).toHaveLength(2);
        const [failed, retried] = apns.received;
        expect(retried?.session === failed?.session).toBe(false);
      }),
    );

    it.effect("and reports unavailable when that fails too", () =>
      Effect.gen(function* () {
        const apns = yield* startFakeApns;
        const sender = yield* openSender(apns);
        apns.respondWith(reply(503, "ServiceUnavailable"), reply(503, "ServiceUnavailable"));

        expect(yield* sender.send(testPush())).toEqual({
          outcome: "unavailable",
          status: 503,
          reason: "ServiceUnavailable",
          apnsId: APNS_ID,
        });
        expect(apns.received).toHaveLength(2);
      }),
    );
  });

  it.effect("times out a request that gets no reply and cancels its stream", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(hang);

      const sending = yield* Effect.forkChild(sender.send(testPush()));
      const request = yield* apns.nextRequest();
      yield* TestClock.adjust("10 seconds");

      expect(yield* Fiber.join(sending)).toEqual({
        outcome: "unavailable",
        status: null,
        reason: "timeout",
        apnsId: null,
      });
      expect(yield* Effect.promise(() => request.closed)).toBe(NodeHttp2.constants.NGHTTP2_CANCEL);
      expect(apns.received).toHaveLength(1);
    }),
  );

  it.effect("cancels the stream when the send is interrupted", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      apns.respondWith(hang);

      const sending = yield* Effect.forkChild(sender.send(testPush()));
      const request = yield* apns.nextRequest();
      yield* Fiber.interrupt(sending);

      expect(yield* Effect.promise(() => request.closed)).toBe(NodeHttp2.constants.NGHTTP2_CANCEL);
    }),
  );

  it.effect("closes its connection when the scope that opened it closes", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const scope = yield* Scope.make();
      const sender = yield* openSender(apns).pipe(Scope.provide(scope));
      yield* sender.send(testPush());
      const serverSession = apns.received[0]!.session;
      const closed = new Promise<void>((resolve) => serverSession.once("close", () => resolve()));

      // A Library shutting down closes the layer scope; no socket may outlive it.
      yield* Scope.close(scope, Exit.void);

      yield* Effect.promise(() => closed);
      expect(serverSession.destroyed).toBe(true);
    }),
  );

  it.effect("refuses a malformed token or an oversized payload before connecting", () =>
    Effect.gen(function* () {
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);

      for (const token of [
        "zz".repeat(32),
        "abc",
        "ab".repeat(7),
        "ab".repeat(201),
        `${TOKEN}/x`,
      ]) {
        expect(yield* sender.send(testPush({ token: Redacted.make(token) }))).toEqual({
          outcome: "bad-token",
          status: null,
          reason: "invalid-token",
          apnsId: null,
        });
      }
      const oversized = {
        ...LIBRARY_PUSH_TEST_ALERT,
        payload: alertPayload({ title: "Loom", body: "x".repeat(4096) }),
      };
      expect(yield* sender.send(testPush({ request: oversized }))).toEqual({
        outcome: "other",
        status: null,
        reason: "payload-too-large",
        apnsId: null,
      });

      expect(apns.sessions.size).toBe(0);
      expect(apns.received).toHaveLength(0);
    }),
  );

  it.effect("keeps the token, provider token and key out of results, logs and spans", () =>
    Effect.gen(function* () {
      const logs: Array<string> = [];
      const logger = Logger.make(({ message, cause, fiber }) => {
        logs.push(
          JSON.stringify({
            message,
            annotations: fiber.getRef(References.CurrentLogAnnotations),
            cause: Cause.pretty(cause),
          }),
        );
      });
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const apns = yield* startFakeApns;
      const sender = yield* openSender(apns);
      // A reply that echoes the token must not carry it into the result.
      apns.respondWith(
        reply(200),
        ({ stream }) => {
          stream.respond({ ":status": 400, "apns-id": TOKEN });
          stream.end(JSON.stringify({ reason: TOKEN }));
        },
        ({ session }) => session.socket.resetAndDestroy(),
        ({ session }) => session.socket.resetAndDestroy(),
      );

      const deliveries = yield* Effect.all([
        sender.send(testPush()),
        sender.send(testPush()),
        sender.send(testPush()),
      ]).pipe(
        Effect.withTracer(tracer),
        Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
        Effect.provideService(References.MinimumLogLevel, "All"),
      );

      expect(deliveries.map((delivery) => delivery.outcome)).toEqual([
        "sent",
        "other",
        "unavailable",
      ]);
      expect(deliveries[1]).toEqual({ outcome: "other", status: 400, reason: null, apnsId: null });
      const jwt = bearer(apns.received[0]!);
      const deviceHash = NodeCrypto.createHash("sha256")
        .update(DEVICE_ID)
        .digest("hex")
        .slice(0, 8);
      const recorded = [
        JSON.stringify(deliveries),
        ...logs,
        ...spans.flatMap((span) => [span.name, ...Array.from(span.attributes.values(), String)]),
      ].join("\n");
      expect(logs).toHaveLength(3);
      expect(recorded).toContain(deviceHash);
      expect(spans.map((span) => span.name)).toContain("ApnsClient.send");
      for (const secret of [TOKEN, jwt, PEM_BODY, DEVICE_ID, "/3/device/"]) {
        expect(recorded).not.toContain(secret);
      }
    }),
  );
});
