import * as NodeZlib from "node:zlib";
import * as NodeUtil from "node:util";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ByteSize from "effect/ByteSize";
import { HttpClientRequest, HttpIncomingMessage, HttpServerRequest } from "effect/http";

export const LIBRARY_HISTORY_MAX_BYTES = 512 * 1024 * 1024;
const COMPRESS_AFTER_BYTES = 1024 * 1024;
const compress = NodeUtil.promisify(NodeZlib.gzip);
const decompress = NodeUtil.promisify(NodeZlib.gunzip);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

/** Large archives travel compressed; checksums and receipts still cover the original full JSON. */
export const libraryJsonBody = Effect.fnUntraced(function* (
  request: HttpClientRequest.HttpClientRequest,
  json: string,
) {
  if (Buffer.byteLength(json) < COMPRESS_AFTER_BYTES)
    return request.pipe(HttpClientRequest.bodyText(json, "application/json"));
  const bytes = yield* Effect.tryPromise({
    try: () => compress(json),
    catch: () => new LibraryError({ reason: "io" }),
  });
  return request.pipe(
    HttpClientRequest.setHeader("content-encoding", "gzip"),
    HttpClientRequest.bodyUint8Array(new Uint8Array(bytes), "application/json"),
  );
});

/** Bound both incoming bytes and decompressed bytes, including chunked requests. */
export const readLibraryJson = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const encoding = request.headers["content-encoding"];
  if (encoding === undefined || encoding === "identity")
    return yield* request.json.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        ByteSize.bytes(LIBRARY_HISTORY_MAX_BYTES),
      ),
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
  if (encoding !== "gzip") return yield* new LibraryError({ reason: "invalid" });
  const incoming = yield* request.arrayBuffer.pipe(
    Effect.provideService(
      HttpIncomingMessage.MaxBodySize,
      ByteSize.bytes(LIBRARY_HISTORY_MAX_BYTES),
    ),
    Effect.mapError(() => new LibraryError({ reason: "invalid" })),
  );
  const bytes = yield* Effect.tryPromise({
    try: () => decompress(new Uint8Array(incoming), { maxOutputLength: LIBRARY_HISTORY_MAX_BYTES }),
    catch: () => new LibraryError({ reason: "invalid" }),
  });
  return yield* decodeJson(bytes.toString("utf8")).pipe(
    Effect.mapError(() => new LibraryError({ reason: "invalid" })),
  );
});
