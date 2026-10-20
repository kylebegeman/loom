// @effect-diagnostics nodeBuiltinImport:off -- Recovery archives require bounded-memory incremental SHA-256 verification.
import * as NodeCrypto from "node:crypto";
import {
  LibraryError,
  LibraryRecoveryReceipt,
  LibraryRecoveryManifest,
  LibraryInfo,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { LibraryPublishingCredentialFile } from "../../auth/LibraryPublishingCredential.ts";
import * as LibraryRecoveryStore from "./assets/LibraryRecoveryStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { isLibraryAuthorityEnv } from "./authority.ts";
import { libraryComputerDirectory } from "./enrollment.ts";

const decodeCredential = Schema.decodeEffect(
  Schema.fromJsonString(LibraryPublishingCredentialFile),
);
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(LibraryRecoveryManifest));
const readReceipt = HttpClientResponse.schemaBodyJson(LibraryRecoveryReceipt);
const readInfo = HttpClientResponse.schemaBodyJson(LibraryInfo);
const isLibraryError = Schema.is(LibraryError);
export class LibraryRecoveryPublisher extends Context.Service<
  LibraryRecoveryPublisher,
  {
    readonly configured: boolean;
    readonly publish: (input: {
      readonly archivePath: string;
      readonly sha256: string;
      readonly manifest: LibraryRecoveryManifest;
    }) => Effect.Effect<LibraryRecoveryReceipt, LibraryError>;
  }
>()("t3/fork/project-library/LibraryRecoveryPublisher") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const http = yield* HttpClient.HttpClient;
  const localStore = yield* Effect.serviceOption(LibraryRecoveryStore.LibraryRecoveryStore);
  const localAuthority = isLibraryAuthorityEnv(env);
  let credentialPath = env.LOOM_LIBRARY_CREDENTIAL_FILE?.trim();
  if (!localAuthority && !credentialPath) {
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const identity = yield* Effect.serviceOption(ServerEnvironmentIdentity);
    if (Option.isSome(config) && Option.isSome(identity)) {
      const computerDirectory = libraryComputerDirectory(
        yield* HostProcess.HomeDirectory,
        yield* identity.value.getEnvironmentId,
      );
      const enrolled = path.join(computerDirectory, "publisher.json");
      const legacy = path.join(config.value.secretsDir, "library-publisher.json");
      if (yield* fs.exists(enrolled)) credentialPath = enrolled;
      else if (yield* fs.exists(legacy)) credentialPath = legacy;
    }
  }
  const configured = localAuthority
    ? Option.isSome(localStore)
    : credentialPath !== undefined && credentialPath !== "";
  const verify = (body: Stream.Stream<Uint8Array, unknown>, sha256: string, byteLength: number) =>
    Effect.suspend(() => {
      const hash = NodeCrypto.createHash("sha256");
      let size = 0;
      return body.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            size += chunk.length;
            if (size > byteLength) return yield* new LibraryError({ reason: "archive-unverified" });
            hash.update(chunk);
          }),
        ),
        Effect.andThen(
          Effect.suspend(() =>
            size === byteLength && hash.digest("hex") === sha256
              ? Effect.void
              : Effect.fail(new LibraryError({ reason: "archive-unverified" })),
          ),
        ),
        Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
      );
    });
  const readback = Effect.fnUntraced(function* (url: string) {
    const response = yield* http.get(url).pipe(
      Effect.timeout("15 minutes"),
      Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
    );
    if (response.status !== 200) return yield* new LibraryError({ reason: "archive-unverified" });
    return response.stream;
  });
  return LibraryRecoveryPublisher.of({
    configured,
    publish: Effect.fn("LibraryRecoveryPublisher.publish")(
      function* (input) {
        if (!configured) return yield* new LibraryError({ reason: "publisher-unavailable" });
        const stat = yield* fs
          .stat(input.archivePath)
          .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
        const byteLength = Number(stat.size);
        if (byteLength > LibraryRecoveryStore.LIBRARY_RECOVERY_MAX_BYTES)
          return yield* new LibraryError({ reason: "archive-too-large" });
        if (stat.type !== "File" || byteLength <= 0)
          return yield* new LibraryError({ reason: "invalid" });
        yield* verify(fs.stream(input.archivePath), input.sha256, byteLength);
        let receipt: LibraryRecoveryReceipt;
        if (localAuthority && Option.isSome(localStore)) {
          receipt = yield* localStore.value.put({
            sourceEnvironmentId: input.manifest.environmentId,
            copyId: input.manifest.copyId,
            sha256: input.sha256,
            byteLength,
            manifest: input.manifest,
            body: fs.stream(input.archivePath),
          });
          const archived = yield* localStore.value.get(
            receipt.sourceEnvironmentId,
            receipt.copyId,
            receipt.sha256,
          );
          yield* verify(
            archived.url === null ? archived.body : yield* readback(archived.url),
            input.sha256,
            byteLength,
          ).pipe(
            Effect.timeout("15 minutes"),
            Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
          );
        } else {
          if (credentialPath === undefined)
            return yield* new LibraryError({ reason: "publisher-unavailable" });
          const credentialFile = path.resolve(credentialPath);
          const info = yield* fs.stat(credentialFile).pipe(
            Effect.timeout("30 seconds"),
            Effect.mapError(() => new LibraryError({ reason: "publisher-unavailable" })),
          );
          if ((info.mode & 0o077) !== 0 || info.type !== "File" || info.size > 16n * 1024n)
            return yield* new LibraryError({ reason: "publisher-unavailable" });
          const credential = yield* fs.readFileString(credentialFile).pipe(
            Effect.flatMap(decodeCredential),
            Effect.mapError(() => new LibraryError({ reason: "publisher-unavailable" })),
          );
          if (credential.sourceEnvironmentId !== input.manifest.environmentId)
            return yield* new LibraryError({ reason: "invalid" });
          const expiresAt = Date.parse(credential.expiresAt);
          if (!Number.isFinite(expiresAt) || expiresAt <= (yield* Clock.currentTimeMillis))
            return yield* new LibraryError({ reason: "publisher-unavailable" });
          const base = yield* Effect.try({
            try: () => {
              const parsed = new URL(credential.libraryUrl);
              if (
                parsed.protocol !== "https:" ||
                parsed.username ||
                parsed.password ||
                parsed.search ||
                parsed.hash
              )
                throw new Error("Invalid Library URL");
              return parsed;
            },
            catch: () => new LibraryError({ reason: "invalid" }),
          });
          const library = yield* http
            .execute(
              HttpClientRequest.get(new URL("/api/loom/library/info", base)).pipe(
                HttpClientRequest.bearerToken(credential.accessToken),
              ),
            )
            .pipe(Effect.mapError(() => new LibraryError({ reason: "publisher-unavailable" })));
          if (library.status !== 200)
            return yield* new LibraryError({ reason: "publisher-unavailable" });
          const libraryInfo = yield* readInfo(library).pipe(
            Effect.mapError(() => new LibraryError({ reason: "publisher-unavailable" })),
          );
          if (libraryInfo.environmentId !== credential.libraryEnvironmentId)
            return yield* new LibraryError({ reason: "publisher-unavailable" });
          const endpoint = new URL(
            `/api/loom/library/recovery/${encodeURIComponent(input.manifest.environmentId)}/${encodeURIComponent(input.manifest.copyId)}/${input.sha256}`,
            base,
          ).toString();
          const response = yield* http
            .execute(
              HttpClientRequest.put(endpoint).pipe(
                HttpClientRequest.bearerToken(credential.accessToken),
                HttpClientRequest.setHeader(
                  "x-loom-recovery-manifest",
                  Base64Url.encode(yield* encodeManifest(input.manifest)),
                ),
                HttpClientRequest.bodyStream(fs.stream(input.archivePath), {
                  contentType: "application/x-tar",
                  contentLength: byteLength,
                }),
              ),
            )
            .pipe(
              Effect.timeout("15 minutes"),
              Effect.mapError(() => new LibraryError({ reason: "publisher-unavailable" })),
            );
          if (response.status !== 200)
            return yield* new LibraryError({
              reason: response.status === 413 ? "archive-too-large" : "publisher-unavailable",
            });
          receipt = yield* readReceipt(response).pipe(
            Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
          );
          const downloaded = yield* http
            .execute(
              HttpClientRequest.get(endpoint).pipe(
                HttpClientRequest.bearerToken(credential.accessToken),
              ),
            )
            .pipe(
              Effect.timeout("15 minutes"),
              Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
            );
          if (downloaded.status === 302) {
            const location = downloaded.headers.location;
            if (location === undefined || !location.startsWith("https://"))
              return yield* new LibraryError({ reason: "archive-unverified" });
            yield* verify(yield* readback(location), input.sha256, byteLength).pipe(
              Effect.timeout("15 minutes"),
              Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
            );
          } else {
            if (downloaded.status !== 200)
              return yield* new LibraryError({ reason: "archive-unverified" });
            yield* verify(downloaded.stream, input.sha256, byteLength).pipe(
              Effect.timeout("15 minutes"),
              Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
            );
          }
        }
        if (
          receipt.sourceEnvironmentId !== input.manifest.environmentId ||
          receipt.copyId !== input.manifest.copyId ||
          receipt.sha256 !== input.sha256 ||
          receipt.byteLength !== byteLength
        )
          return yield* new LibraryError({ reason: "archive-unverified" });
        return receipt;
      },
      Effect.mapError((cause) =>
        isLibraryError(cause) ? cause : new LibraryError({ reason: "io" }),
      ),
    ),
  });
});
export const layer = Layer.effect(LibraryRecoveryPublisher, make);
