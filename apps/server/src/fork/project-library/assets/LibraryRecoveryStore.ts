// @effect-diagnostics nodeBuiltinImport:off - Recovery archives need incremental hashing; Effect Crypto exposes complete-buffer digests only.
import * as NodeCrypto from "node:crypto";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryRecoveryReceipt,
  LibraryRecoveryManifest,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ServerConfig from "../../../config.ts";
import { signB2ObjectUrl, type B2SigningConfig } from "./b2Signing.ts";
export const LIBRARY_RECOVERY_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export class LibraryRecoveryStore extends Context.Service<
  LibraryRecoveryStore,
  {
    readonly put: (input: {
      readonly sourceEnvironmentId: EnvironmentId;
      readonly copyId: string;
      readonly sha256: string;
      readonly byteLength: number;
      readonly manifest: LibraryRecoveryManifest;
      readonly body: Stream.Stream<Uint8Array, unknown>;
    }) => Effect.Effect<LibraryRecoveryReceipt, LibraryError>;
    readonly verify: (
      sourceEnvironmentId: EnvironmentId,
      copyId: string,
      sha256: string,
    ) => Effect.Effect<LibraryRecoveryReceipt, LibraryError>;
    readonly get: (
      sourceEnvironmentId: EnvironmentId,
      copyId: string,
      sha256: string,
    ) => Effect.Effect<
      {
        readonly receipt: LibraryRecoveryReceipt;
        readonly manifest: LibraryRecoveryManifest;
        readonly url: string | null;
        readonly body: Stream.Stream<Uint8Array, LibraryError>;
      },
      LibraryError
    >;
  }
>()("t3/fork/project-library/assets/LibraryRecoveryStore") {}
const isLibraryError = Schema.is(LibraryError);
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(LibraryRecoveryManifest));
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(LibraryRecoveryManifest));
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const env = yield* HostProcess.Environment;
  const config = yield* ServerConfig.ServerConfig;
  const http = yield* HttpClient.HttpClient;
  const uploads = yield* Semaphore.make(1);
  const mode = env.LOOM_ASSETS_BACKEND ?? "local";
  if (mode !== "local" && mode !== "b2") return yield* new LibraryError({ reason: "invalid" });
  const b2: B2SigningConfig | null =
    mode === "b2"
      ? {
          endpoint: env.LOOM_B2_ENDPOINT ?? "",
          region: env.LOOM_B2_REGION ?? "",
          bucket: env.LOOM_B2_ASSET_BUCKET ?? "",
          keyId: env.LOOM_B2_KEY_ID ?? "",
          applicationKey: env.LOOM_B2_APPLICATION_KEY ?? "",
        }
      : null;
  const directory = path.join(config.stateDir, "project-library", "recovery");
  const sign = (method: "GET" | "PUT", archiveKey: string) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        Effect.try({
          try: () => {
            if (!b2) throw new Error("Storage unavailable");
            return signB2ObjectUrl(b2, {
              method,
              objectKey: archiveKey,
              now: DateTime.formatIso(now),
              expiresInSeconds: 900,
            });
          },
          catch: () => new LibraryError({ reason: "invalid" }),
        }),
      ),
    );
  const verify = (body: Stream.Stream<Uint8Array, unknown>, sha256: string, byteLength: number) =>
    Effect.suspend(() => {
      const hash = NodeCrypto.createHash("sha256");
      let size = 0;
      return body.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            size += chunk.length;
            if (size > byteLength || size > LIBRARY_RECOVERY_MAX_BYTES)
              return yield* new LibraryError({ reason: "invalid" });
            hash.update(chunk);
          }),
        ),
        Effect.andThen(
          Effect.suspend(() =>
            size === byteLength && hash.digest("hex") === sha256
              ? Effect.void
              : Effect.fail(new LibraryError({ reason: "invalid" })),
          ),
        ),
        Effect.mapError((cause) =>
          isLibraryError(cause) ? cause : new LibraryError({ reason: "io" }),
        ),
      );
    });
  const get: LibraryRecoveryStore["Service"]["get"] = (source, copyId, sha256) =>
    mapIo(
      Effect.gen(function* () {
        const row = (yield* sql<{
          byte_length: number;
          archive_key: string;
          manifest_json: string;
          verified_at: string;
        }>`SELECT byte_length,archive_key,manifest_json,verified_at FROM fork_library_recovery WHERE source_environment_id=${source} AND copy_id=${copyId} AND digest=${sha256}`)[0];
        if (!row) return yield* new LibraryError({ reason: "not-found" });
        const receipt: LibraryRecoveryReceipt = {
          sourceEnvironmentId: source,
          copyId,
          sha256,
          byteLength: row.byte_length,
          archiveKey: row.archive_key,
          verifiedAt: row.verified_at,
        };
        const manifest = yield* decodeManifest(row.manifest_json);
        const local = path.join(directory, sha256);
        if (!b2) yield* verify(fs.stream(local), sha256, row.byte_length);
        return {
          receipt,
          manifest,
          url: b2 ? yield* sign("GET", row.archive_key) : null,
          body: fs
            .stream(local)
            .pipe(Stream.mapError((cause) => new LibraryError({ reason: "io", cause }))),
        };
      }),
    );
  const put: LibraryRecoveryStore["Service"]["put"] = (input) =>
    uploads.withPermit(
      mapIo(
        Effect.scoped(
          Effect.gen(function* () {
            if (
              !/^[a-f0-9]{64}$/.test(input.sha256) ||
              !/^[A-Za-z0-9._:-]{1,200}$/.test(input.copyId) ||
              !Number.isSafeInteger(input.byteLength) ||
              input.byteLength <= 0 ||
              input.byteLength > LIBRARY_RECOVERY_MAX_BYTES ||
              input.manifest.copyId !== input.copyId ||
              input.manifest.environmentId !== input.sourceEnvironmentId
            )
              return yield* new LibraryError({ reason: "invalid" });
            const manifestJson = yield* encodeManifest(input.manifest);
            const existing = (yield* sql<{
              byte_length: number;
              manifest_json: string;
            }>`SELECT byte_length,manifest_json FROM fork_library_recovery WHERE source_environment_id=${input.sourceEnvironmentId} AND copy_id=${input.copyId} AND digest=${input.sha256}`)[0];
            if (
              existing &&
              (existing.byte_length !== input.byteLength || existing.manifest_json !== manifestJson)
            )
              return yield* new LibraryError({ reason: "request-conflict" });
            const archiveKey = `recovery/${input.sourceEnvironmentId}/${input.copyId}/${input.sha256}.tar`;
            if (b2) {
              const hash = NodeCrypto.createHash("sha256");
              let sent = 0;
              const checked = input.body.pipe(
                Stream.tap((chunk) =>
                  Effect.gen(function* () {
                    sent += chunk.length;
                    if (sent > input.byteLength)
                      return yield* new LibraryError({ reason: "invalid" });
                    hash.update(chunk);
                  }),
                ),
              );
              const response = yield* http
                .execute(
                  HttpClientRequest.put(yield* sign("PUT", archiveKey)).pipe(
                    HttpClientRequest.bodyStream(checked, {
                      contentType: "application/x-tar",
                      contentLength: input.byteLength,
                    }),
                  ),
                )
                .pipe(
                  Effect.timeout("15 minutes"),
                  Effect.mapError(() => new LibraryError({ reason: "io" })),
                );
              if (response.status < 200 || response.status >= 300)
                return yield* new LibraryError({ reason: "io" });
              if (sent !== input.byteLength || hash.digest("hex") !== input.sha256)
                return yield* new LibraryError({ reason: "invalid" });
              const readback = yield* http
                .execute(HttpClientRequest.get(yield* sign("GET", archiveKey)))
                .pipe(Effect.mapError(() => new LibraryError({ reason: "io" })));
              if (readback.status !== 200) return yield* new LibraryError({ reason: "io" });
              yield* verify(readback.stream, input.sha256, input.byteLength).pipe(
                Effect.timeout("15 minutes"),
              );
            } else {
              yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
              const target = path.join(directory, input.sha256);
              const temporary = yield* fs.makeTempFileScoped({ directory, prefix: "recovery-" });
              const file = yield* fs.open(temporary, { flag: "w", mode: 0o600 });
              let size = 0;
              yield* input.body.pipe(
                Stream.mapError(() => new LibraryError({ reason: "io" })),
                Stream.runForEach((chunk) =>
                  Effect.gen(function* () {
                    size += chunk.length;
                    if (size > input.byteLength)
                      return yield* new LibraryError({ reason: "invalid" });
                    yield* file.writeAll(chunk);
                  }),
                ),
              );
              yield* file.sync;
              yield* verify(fs.stream(temporary), input.sha256, input.byteLength);
              yield* fs.rename(temporary, target);
              yield* Effect.scoped(
                fs.open(directory).pipe(Effect.flatMap((directoryFile) => directoryFile.sync)),
              );
            }
            const verifiedAt = DateTime.formatIso(yield* DateTime.now);
            yield* sql`INSERT INTO fork_library_recovery (source_environment_id,copy_id,digest,byte_length,archive_key,manifest_json,verified_at) VALUES (${input.sourceEnvironmentId},${input.copyId},${input.sha256},${input.byteLength},${archiveKey},${manifestJson},${verifiedAt}) ON CONFLICT(source_environment_id,copy_id,digest) DO UPDATE SET verified_at=excluded.verified_at`;
            return {
              sourceEnvironmentId: input.sourceEnvironmentId,
              copyId: input.copyId,
              sha256: input.sha256,
              byteLength: input.byteLength,
              archiveKey,
              verifiedAt,
            };
          }),
        ),
      ),
    );
  const verifyStored = (source: EnvironmentId, copyId: string, sha256: string) =>
    mapIo(
      Effect.gen(function* () {
        const archive = yield* get(source, copyId, sha256);
        if (archive.url) {
          const response = yield* http
            .execute(HttpClientRequest.get(archive.url))
            .pipe(Effect.mapError(() => new LibraryError({ reason: "io" })));
          if (response.status !== 200) return yield* new LibraryError({ reason: "io" });
          yield* verify(response.stream, sha256, archive.receipt.byteLength).pipe(
            Effect.timeout("15 minutes"),
          );
        }
        return archive.receipt;
      }),
    );
  return LibraryRecoveryStore.of({ put, get, verify: verifyStored });
});
export const layer = Layer.effect(LibraryRecoveryStore, make);
