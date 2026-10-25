// @effect-diagnostics-next-line nodeBuiltinImport:off -- ES256 provider tokens and log-safe device hashes need no new dependency.
import * as NodeCrypto from "node:crypto";
// APNs requires HTTP/2, and Effect's HttpClient records the token-bearing URL on its spans.
import * as NodeHttp2 from "node:http2";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type { ApnsAlertRequest } from "./apnsPayloads.ts";

const APNS_ORIGINS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

// Apple refuses a provider token older than 60 minutes and answers 429
// TooManyProviderTokenUpdates when one is replaced more often than about every 20. 45 minutes
// matches the relay (infra/relay/src/agentActivity/ApnsProviderTokens.ts).
const PROVIDER_TOKEN_REUSE_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT = "10 seconds";
// A personal Library pushes rarely, so it drops the connection rather than hold an idle socket.
const SESSION_IDLE_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 4096;
// An APNs error body is a short JSON object. Anything longer is not one and is not read further.
const MAX_RESPONSE_BYTES = 4096;
// The token becomes the request path. Apple treats its length as variable, so only the alphabet
// and an even length are fixed.
const DEVICE_TOKEN = /^(?:[0-9a-fA-F]{2}){8,200}$/;
const APNS_ID = /^[0-9A-Fa-f-]{36}$/;

// Apple's documented reasons. A reply's reason is kept only when it is one of these, so no reply
// can carry other text into results or logs.
const ApnsReason = Schema.Literals([
  "BadCollapseId",
  "BadDeviceToken",
  "BadExpirationDate",
  "BadMessageId",
  "BadPriority",
  "BadTopic",
  "DeviceTokenNotForTopic",
  "DuplicateHeaders",
  "IdleTimeout",
  "InvalidPushType",
  "MissingDeviceToken",
  "MissingTopic",
  "PayloadEmpty",
  "TopicDisallowed",
  "BadCertificate",
  "BadCertificateEnvironment",
  "ExpiredProviderToken",
  "Forbidden",
  "InvalidProviderToken",
  "MissingProviderToken",
  "UnrelatedKeyIdInToken",
  "BadEnvironmentKeyInToken",
  "BadPath",
  "MethodNotAllowed",
  "ExpiredToken",
  "Unregistered",
  "PayloadTooLarge",
  "TooManyProviderTokenUpdates",
  "TooManyRequests",
  "InternalServerError",
  "ServiceUnavailable",
  "Shutdown",
]);
type ApnsReason = typeof ApnsReason.Type;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeApnsReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ reason: ApnsReason })),
);

/** Failures decided on this side of the wire. */
type ApnsLocalReason =
  | "invalid-token"
  | "payload-too-large"
  | "sign-failed"
  | "timeout"
  | "connection-failed";

export type ApnsOutcome =
  | "sent"
  | "bad-token"
  | "key-rejected"
  | "topic-disallowed"
  | "rate-limited"
  | "unavailable"
  | "other";

/** Carries no token, provider token, path or transport error text. */
export interface ApnsDelivery {
  readonly outcome: ApnsOutcome;
  /** The HTTP status, or null when no reply arrived. */
  readonly status: number | null;
  readonly reason: ApnsReason | ApnsLocalReason | null;
  readonly apnsId: string | null;
}

export interface ApnsClientConfig {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: NodeCrypto.KeyObject;
  /** Defaults to Apple's hosts. Tests point these at a local server. */
  readonly origins?: { readonly production: string; readonly sandbox: string };
}

export interface ApnsSendInput {
  /** Only its hash reaches logs. */
  readonly deviceId: string;
  readonly token: Redacted.Redacted<string>;
  /** The `apns-topic`: the bundle ID the device registered with. */
  readonly bundleId: string;
  readonly apsEnvironment: "production" | "sandbox";
  readonly request: ApnsAlertRequest;
}

export interface ApnsSender {
  readonly send: (input: ApnsSendInput) => Effect.Effect<ApnsDelivery>;
}

export class ApnsClient extends Context.Service<
  ApnsClient,
  {
    /**
     * Binds a sender to one provider key. Connections open on the first send, so opening a
     * sender touches no network. They close with the scope.
     */
    readonly open: (config: ApnsClientConfig) => Effect.Effect<ApnsSender, never, Scope.Scope>;
  }
>()("t3/fork/library-push/ApnsClient") {}

type Exchange =
  | {
      readonly _tag: "Reply";
      readonly status: number;
      readonly reason: ApnsReason | null;
      readonly apnsId: string | null;
    }
  | { readonly _tag: "Failed"; readonly reason: "timeout" | "connection-failed" };

const CONNECTION_FAILED: Exchange = { _tag: "Failed", reason: "connection-failed" };
const TIMED_OUT: Exchange = { _tag: "Failed", reason: "timeout" };

const refused = (outcome: ApnsOutcome, reason: ApnsLocalReason): ApnsDelivery => ({
  outcome,
  status: null,
  reason,
  apnsId: null,
});

const outcomeOf = (status: number, reason: ApnsReason | null): ApnsOutcome => {
  if (status === 200) return "sent";
  // Apple documents 410 with Unregistered and ExpiredToken. Either way the token is dead.
  if (status === 410) return "bad-token";
  // An environment-restricted key refuses the other APNs environment with
  // BadEnvironmentKeyInToken. The key still serves its own environment, so like a refused topic
  // this stays on the row instead of marking the whole Library failing.
  if (
    reason === "TopicDisallowed" ||
    reason === "BadTopic" ||
    reason === "BadEnvironmentKeyInToken"
  )
    return "topic-disallowed";
  if (status === 403) return "key-rejected";
  if (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")) {
    return "bad-token";
  }
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "other";
};

const deviceHashOf = (deviceId: string) =>
  NodeCrypto.createHash("sha256").update(deviceId).digest("hex").slice(0, 8);

const base64url = (value: string) => Buffer.from(value).toString("base64url");

const signProviderToken = (config: ApnsClientConfig, issuedAtSeconds: number): string => {
  const header = base64url(encodeJson({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(encodeJson({ iss: config.teamId, iat: issuedAtSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
};

/**
 * One request and its reply. Node's transport errors can quote the request, so they are reduced
 * to a fixed reason here and never kept. Interruption cancels the stream.
 */
const exchange = (
  session: NodeHttp2.ClientHttp2Session,
  headers: NodeHttp2.OutgoingHttpHeaders,
  body: string,
): Effect.Effect<Exchange> =>
  Effect.callback<Exchange>((resume) => {
    let stream: NodeHttp2.ClientHttp2Stream;
    try {
      stream = session.request(headers);
    } catch {
      resume(Effect.succeed(CONNECTION_FAILED));
      return;
    }
    let status: number | undefined;
    let apnsId: string | null = null;
    const chunks: Array<Buffer> = [];
    let size = 0;
    // A stream can end without a reply, for example after a GOAWAY, so every terminal event
    // settles on whatever arrived. Later calls to resume are ignored.
    const settle = () => {
      if (status === undefined) {
        resume(Effect.succeed(CONNECTION_FAILED));
        return;
      }
      const reason =
        size > MAX_RESPONSE_BYTES
          ? null
          : Option.getOrNull(
              Option.map(decodeApnsReply(Buffer.concat(chunks).toString("utf8")), (r) => r.reason),
            );
      resume(Effect.succeed({ _tag: "Reply", status, reason, apnsId }));
    };
    stream.on("response", (responseHeaders) => {
      status = responseHeaders[":status"];
      const id = responseHeaders["apns-id"];
      apnsId = typeof id === "string" && APNS_ID.test(id) ? id : null;
    });
    stream.on("data", (chunk: Buffer) => {
      if (size > MAX_RESPONSE_BYTES) return;
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        stream.close(NodeHttp2.constants.NGHTTP2_CANCEL);
        settle();
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", settle);
    stream.on("error", settle);
    stream.on("close", settle);
    stream.end(body);
    return Effect.sync(() => {
      if (!stream.closed) stream.close(NodeHttp2.constants.NGHTTP2_CANCEL);
    });
  });

const open = Effect.fn("ApnsClient.open")(function* (config: ApnsClientConfig) {
  const origins = config.origins ?? APNS_ORIGINS;
  const sessions = new Map<string, NodeHttp2.ClientHttp2Session>();
  let providerToken: { readonly jwt: string; readonly issuedAtMs: number } | undefined;

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const session of sessions.values()) session.destroy();
      sessions.clear();
    }),
  );

  // Concurrent sends share one token. Reading and replacing it is synchronous, so two sends
  // cannot both re-sign.
  const currentProviderToken = (nowMs: number): string | undefined => {
    if (
      providerToken !== undefined &&
      nowMs >= providerToken.issuedAtMs &&
      nowMs - providerToken.issuedAtMs < PROVIDER_TOKEN_REUSE_MS
    ) {
      return providerToken.jwt;
    }
    let jwt: string;
    try {
      jwt = signProviderToken(config, Math.floor(nowMs / 1000));
    } catch {
      return undefined;
    }
    providerToken = { jwt, issuedAtMs: nowMs };
    return jwt;
  };

  // Only the send that saw the rejected token drops it; a newer one stays.
  const dropProviderToken = (jwt: string) => {
    if (providerToken?.jwt === jwt) providerToken = undefined;
  };

  const sessionFor = (origin: string): NodeHttp2.ClientHttp2Session | undefined => {
    const current = sessions.get(origin);
    if (current !== undefined && !current.closed && !current.destroyed) return current;
    let session: NodeHttp2.ClientHttp2Session;
    try {
      session = NodeHttp2.connect(origin);
    } catch {
      return undefined;
    }
    const forget = () => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };
    // Each failure reaches the request that hit it. Without an error listener, a dropped
    // connection would be an uncaught exception that takes down the server.
    session.on("error", forget);
    session.on("goaway", forget);
    session.on("close", forget);
    session.setTimeout(SESSION_IDLE_MS, () => session.close());
    sessions.set(origin, session);
    return session;
  };

  // close() lets other requests on the connection finish; the next send opens a fresh one.
  const retire = (origin: string, session: NodeHttp2.ClientHttp2Session | undefined) => {
    if (session === undefined) return;
    if (sessions.get(origin) === session) sessions.delete(origin);
    if (!session.closed) session.close();
  };

  // Covered by the ApnsClient.send span.
  const deliver = Effect.fnUntraced(function* (input: ApnsSendInput) {
    const token = Redacted.value(input.token);
    if (!DEVICE_TOKEN.test(token)) return refused("bad-token", "invalid-token");
    const body = encodeJson(input.request.payload);
    if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) {
      return refused("other", "payload-too-large");
    }
    const origin = input.apsEnvironment === "production" ? origins.production : origins.sandbox;
    let resigned = false;
    let reconnected = false;
    for (;;) {
      const nowMs = yield* Clock.currentTimeMillis;
      const jwt = currentProviderToken(nowMs);
      if (jwt === undefined) return refused("key-rejected", "sign-failed");
      const session = sessionFor(origin);
      const result =
        session === undefined
          ? CONNECTION_FAILED
          : yield* exchange(
              session,
              {
                ":method": "POST",
                ":path": `/3/device/${token}`,
                authorization: `bearer ${jwt}`,
                "apns-push-type": "alert",
                "apns-topic": input.bundleId,
                "apns-priority": String(input.request.priority),
                "apns-expiration": String(
                  Math.floor(nowMs / 1000) + input.request.expiresInSeconds,
                ),
                ...(input.request.collapseId === undefined
                  ? {}
                  : { "apns-collapse-id": input.request.collapseId }),
                "content-type": "application/json",
              },
              body,
            ).pipe(
              Effect.timeoutOrElse({
                duration: REQUEST_TIMEOUT,
                orElse: () => Effect.succeed(TIMED_OUT),
              }),
            );
      if (result._tag === "Failed") {
        retire(origin, session);
        // A timed-out request may still be delivered, so only a refused connection is retried.
        if (result.reason === "connection-failed" && !reconnected) {
          reconnected = true;
          continue;
        }
        return refused("unavailable", result.reason);
      }
      if (result.status === 403 && result.reason === "ExpiredProviderToken" && !resigned) {
        resigned = true;
        dropProviderToken(jwt);
        continue;
      }
      if (result.status >= 500 && !reconnected) {
        reconnected = true;
        retire(origin, session);
        continue;
      }
      return {
        outcome: outcomeOf(result.status, result.reason),
        status: result.status,
        reason: result.reason,
        apnsId: result.apnsId,
      } satisfies ApnsDelivery;
    }
  });

  const send = Effect.fn("ApnsClient.send")(function* (input: ApnsSendInput) {
    const delivery = yield* deliver(input);
    const deviceHash = deviceHashOf(input.deviceId);
    yield* Effect.annotateCurrentSpan({
      "apns.device_hash": deviceHash,
      "apns.outcome": delivery.outcome,
    });
    yield* (delivery.outcome === "sent" ? Effect.logDebug : Effect.logWarning)(
      "APNs delivery",
    ).pipe(
      Effect.annotateLogs({
        deviceHash,
        apsEnvironment: input.apsEnvironment,
        outcome: delivery.outcome,
        status: delivery.status,
        reason: delivery.reason,
        apnsId: delivery.apnsId,
      }),
    );
    return delivery;
  });

  return { send } satisfies ApnsSender;
});

export const layer = Layer.succeed(ApnsClient, ApnsClient.of({ open }));
