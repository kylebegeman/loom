import { IdentityGrant, identityGrantKey } from "@t3tools/shared/fork/identity-grant";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";

const GRANTS_FILE_NAME = "loom-identity-grants.json";
// Refresh tokens are long-lived account credentials, so the encrypted file stays owner-only too.
const GRANTS_FILE_MODE = 0o600;

const GrantsDocument = Schema.Struct({
  version: Schema.Literal(1),
  encrypted: Schema.String,
});
const GrantEntries = Schema.Record(Schema.String, IdentityGrant);
type GrantEntries = typeof GrantEntries.Type;

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(GrantsDocument));
const encodeDocument = Schema.encodeEffect(Schema.fromJsonString(GrantsDocument));
const decodeEntries = Schema.decodeUnknownOption(Schema.fromJsonString(GrantEntries));
const encodeEntries = Schema.encodeEffect(Schema.fromJsonString(GrantEntries));

export class DesktopIdentityGrantStoreError extends Schema.TaggedError<DesktopIdentityGrantStoreError>()(
  "DesktopIdentityGrantStoreError",
  {
    operation: Schema.Literals(["read", "encode", "encrypt", "write"]),
    path: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Saved Loom sign-in storage failed during ${this.operation} at ${this.path}.`;
  }
}

/**
 * Refresh grants for Loom Identity, kept in the main process and encrypted with the OS keychain.
 * Without OS encryption nothing is stored, so renewal falls back to an interactive sign-in.
 */
export class DesktopIdentityGrantStore extends Context.Service<
  DesktopIdentityGrantStore,
  {
    readonly get: (
      key: string,
    ) => Effect.Effect<Option.Option<IdentityGrant>, DesktopIdentityGrantStoreError>;
    /** Resolves false when OS encryption is unavailable and nothing was stored. */
    readonly put: (grant: IdentityGrant) => Effect.Effect<boolean, DesktopIdentityGrantStoreError>;
    readonly remove: (key: string) => Effect.Effect<void, DesktopIdentityGrantStoreError>;
  }
>()("@t3tools/desktop/fork/identity-renewal/DesktopIdentityGrantStore") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const crypto = yield* Crypto.Crypto;
  const grantsPath = path.join(environment.stateDir, GRANTS_FILE_NAME);
  // Every operation reads, changes and rewrites the whole file, so they run one at a time.
  const lock = yield* Semaphore.make(1);
  const reportedUnavailable = yield* Ref.make(false);
  const failure = (operation: DesktopIdentityGrantStoreError["operation"], cause?: unknown) =>
    new DesktopIdentityGrantStoreError({ operation, path: grantsPath, cause });

  const encryptionAvailable = safeStorage.isEncryptionAvailable.pipe(
    Effect.orElseSucceed(() => false),
    Effect.tap((available) =>
      available
        ? Effect.void
        : Ref.getAndSet(reportedUnavailable, true).pipe(
            Effect.flatMap((reported) =>
              reported
                ? Effect.void
                : Effect.logWarning(
                    "OS encryption is unavailable, so Loom sign-ins will not renew on their own.",
                  ),
            ),
          ),
    ),
  );

  // The cause stays out of the log: a decode issue can quote the stored tokens.
  const unreadable = Effect.logWarning(
    "Ignoring an unreadable saved Loom sign-in file. It is replaced on the next save.",
    { grantsPath },
  ).pipe(Effect.as<GrantEntries>({}));
  // The file holds every computer's grant, so it is given up only when the keychain works and
  // still cannot decrypt it. A locked keychain or a denied prompt must not let a save replace it.
  const keychainWorks = safeStorage.encryptString(GRANTS_FILE_NAME).pipe(
    Effect.flatMap(safeStorage.decryptString),
    Effect.map((value) => value === GRANTS_FILE_NAME),
    Effect.orElseSucceed(() => false),
  );

  const readEntries = Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(grantsPath).pipe(
      Effect.asSome,
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(failure("read", error)),
      ),
    );
    if (Option.isNone(raw)) return {};
    const document = decodeDocument(raw.value);
    if (Option.isNone(document)) return yield* unreadable;
    const encrypted = Base64.decode(document.value.encrypted);
    if (Result.isFailure(encrypted)) return yield* unreadable;
    const plaintext = yield* safeStorage.decryptString(encrypted.success).pipe(Effect.option);
    if (Option.isNone(plaintext))
      return yield* (yield* keychainWorks) ? unreadable : Effect.fail(failure("read"));
    const entries = decodeEntries(plaintext.value);
    return Option.isSome(entries) ? entries.value : yield* unreadable;
  });

  const writeEntries = Effect.fn("DesktopIdentityGrantStore.writeEntries")(function* (
    entries: GrantEntries,
  ) {
    if (Object.keys(entries).length === 0) {
      return yield* fileSystem
        .remove(grantsPath, { force: true })
        .pipe(Effect.mapError((cause) => failure("write", cause)));
    }
    // Schema issues quote values, so the encode failure keeps no cause.
    const plaintext = yield* encodeEntries(entries).pipe(Effect.mapError(() => failure("encode")));
    const encrypted = yield* safeStorage
      .encryptString(plaintext)
      .pipe(Effect.mapError((cause) => failure("encrypt", cause)));
    const document = yield* encodeDocument({
      version: 1,
      encrypted: Base64.encode(encrypted),
    }).pipe(Effect.mapError(() => failure("encode")));
    const suffix = (yield* crypto
      .randomUUIDv4()
      .pipe(Effect.mapError((cause) => failure("write", cause)))).replace(/-/g, "");
    const tempPath = `${grantsPath}.${process.pid}.${suffix}.tmp`;
    yield* fileSystem
      .makeDirectory(path.dirname(grantsPath), { recursive: true })
      .pipe(Effect.mapError((cause) => failure("write", cause)));
    yield* fileSystem.writeFileString(tempPath, `${document}\n`, { mode: GRANTS_FILE_MODE }).pipe(
      Effect.flatMap(() => fileSystem.rename(tempPath, grantsPath)),
      Effect.mapError((cause) => failure("write", cause)),
      Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)),
    );
  });

  return DesktopIdentityGrantStore.of({
    get: Effect.fn("DesktopIdentityGrantStore.get")(function* (key) {
      if (!(yield* encryptionAvailable)) return Option.none();
      const entries = yield* readEntries;
      return Object.hasOwn(entries, key) ? Option.fromNullishOr(entries[key]) : Option.none();
    }, lock.withPermit),
    put: Effect.fn("DesktopIdentityGrantStore.put")(function* (grant) {
      if (!(yield* encryptionAvailable)) return false;
      const entries = yield* readEntries;
      yield* writeEntries({ ...entries, [identityGrantKey(grant)]: grant });
      return true;
    }, lock.withPermit),
    remove: Effect.fn("DesktopIdentityGrantStore.remove")(function* (key) {
      if (!(yield* encryptionAvailable)) return;
      const entries = yield* readEntries;
      if (!Object.hasOwn(entries, key)) return;
      yield* writeEntries(Object.fromEntries(Object.entries(entries).filter(([k]) => k !== key)));
    }, lock.withPermit),
  });
});

export const layer = Layer.effect(DesktopIdentityGrantStore, make);
