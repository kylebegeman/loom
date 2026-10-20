import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as ByteSize from "effect/ByteSize";
import { HttpIncomingMessage, HttpClient, HttpClientRequest } from "effect/http";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { LibraryError } from "@t3tools/contracts/fork";
import * as ServerConfig from "../../../config.ts";
import { signB2ObjectUrl, type B2SigningConfig } from "./b2Signing.ts";

export const LIBRARY_ASSET_MAX_BYTES = 128 * 1024 * 1024;
export const assetDigest = (crypto: Crypto.Crypto, bytes: Uint8Array) =>
  crypto
    .digest("SHA-256", bytes)
    .pipe(
      Effect.map((digest) =>
        Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
    );
export class LibraryObjectStore extends Context.Service<
  LibraryObjectStore,
  {
    readonly mode: "local" | "b2";
    readonly put: (
      digest: string,
      bytes: Uint8Array,
      contentType: string,
    ) => Effect.Effect<void, LibraryError>;
    readonly get: (digest: string) => Effect.Effect<Uint8Array, LibraryError>;
    readonly url: (digest: string) => Effect.Effect<string | null, LibraryError>;
  }
>()("t3/fork/project-library/assets/LibraryObjectStore") {}
const validDigest = (digest: string) => /^[a-f0-9]{64}$/.test(digest);
const isLibraryError = Schema.is(LibraryError);
const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const environment = yield* HostProcess.Environment;
  const http = yield* HttpClient.HttpClient;
  const mode = environment.LOOM_ASSETS_BACKEND ?? "local";
  if (mode !== "local" && mode !== "b2") return yield* new LibraryError({ reason: "invalid" });
  const b2: B2SigningConfig | null =
    mode === "b2"
      ? {
          endpoint: environment.LOOM_B2_ENDPOINT ?? "",
          region: environment.LOOM_B2_REGION ?? "",
          bucket: environment.LOOM_B2_ASSET_BUCKET ?? "",
          keyId: environment.LOOM_B2_KEY_ID ?? "",
          applicationKey: environment.LOOM_B2_APPLICATION_KEY ?? "",
        }
      : null;
  if (b2)
    yield* Effect.try({
      try: () =>
        signB2ObjectUrl(b2, {
          method: "GET",
          objectKey: "validation",
          now: "2026-10-15T00:00:00Z",
          expiresInSeconds: 1,
        }),
      catch: () => new LibraryError({ reason: "invalid" }),
    });
  const directory = path.join(config.stateDir, "project-library", "objects");
  // Sign at the operation's clock, rather than keeping startup URLs alive.
  const sign = (method: "GET" | "PUT", digest: string) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => {
        if (!b2 || !validDigest(digest))
          return Effect.fail(new LibraryError({ reason: "invalid" }));
        return Effect.try({
          try: () =>
            signB2ObjectUrl(b2, {
              method,
              objectKey: `objects/${digest.slice(0, 2)}/${digest}`,
              now: DateTime.formatIso(now),
              expiresInSeconds: 300,
            }),
          catch: (cause) => new LibraryError({ reason: "invalid", cause }),
        });
      }),
    );
  const get = Effect.fn("LibraryObjectStore.get")(function* (
    digest: string,
  ): Effect.fn.Return<Uint8Array, LibraryError> {
    if (!validDigest(digest)) return yield* new LibraryError({ reason: "invalid" });
    let bytes: Uint8Array;
    if (mode === "local") {
      bytes = yield* fs
        .readFile(path.join(directory, digest))
        .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    } else {
      const response = yield* http.execute(HttpClientRequest.get(yield* sign("GET", digest))).pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError(() => new LibraryError({ reason: "io" })),
      );
      if (response.status !== 200) return yield* new LibraryError({ reason: "io" });
      const length = response.headers["content-length"];
      if (
        length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > LIBRARY_ASSET_MAX_BYTES)
      )
        return yield* new LibraryError({ reason: "invalid" });
      bytes = new Uint8Array(
        yield* response.arrayBuffer.pipe(
          Effect.provideService(
            HttpIncomingMessage.MaxBodySize,
            ByteSize.bytes(LIBRARY_ASSET_MAX_BYTES),
          ),
          Effect.timeout("30 seconds"),
          Effect.mapError(() => new LibraryError({ reason: "io" })),
        ),
      );
    }
    if (
      bytes.length > LIBRARY_ASSET_MAX_BYTES ||
      (yield* assetDigest(crypto, bytes).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
      )) !== digest
    )
      return yield* new LibraryError({ reason: "invalid" });
    return bytes;
  });
  const put = Effect.fn("LibraryObjectStore.put")(
    function* (digest: string, bytes: Uint8Array, contentType: string) {
      if (
        !validDigest(digest) ||
        bytes.length > LIBRARY_ASSET_MAX_BYTES ||
        (yield* assetDigest(crypto, bytes).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
        )) !== digest
      )
        return yield* new LibraryError({ reason: "invalid" });
      if (mode === "local") {
        yield* fs.makeDirectory(directory, { recursive: true });
        const target = path.join(directory, digest);
        if (!(yield* fs.exists(target))) {
          const temporary = path.join(directory, `${digest}.pending`);
          yield* fs.writeFile(temporary, bytes, { mode: 0o600 });
          yield* Effect.scoped(fs.open(temporary).pipe(Effect.flatMap((file) => file.sync)));
          yield* fs.rename(temporary, target);
          yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((file) => file.sync)));
        }
      } else {
        const response = yield* http
          .execute(
            HttpClientRequest.put(yield* sign("PUT", digest)).pipe(
              HttpClientRequest.bodyUint8Array(bytes, contentType),
            ),
          )
          .pipe(
            Effect.timeout("30 seconds"),
            Effect.mapError(() => new LibraryError({ reason: "io" })),
          );
        if (response.status < 200 || response.status >= 300)
          return yield* new LibraryError({ reason: "io" });
      }
      // Availability is acknowledged only after verifying the stored bytes.
      yield* get(digest);
    },
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
  return LibraryObjectStore.of({
    mode,
    get,
    put,
    url: (digest) => (mode === "local" ? Effect.succeed(null) : sign("GET", digest)),
  });
});
export const layer = Layer.effect(LibraryObjectStore, make);
