import {
  VaultBrokerError,
  VaultBrokerPublicKey,
  VaultBrokerFingerprint,
  VaultBrokerPlatform,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as BrokerCrypto from "./BrokerCrypto.ts";

const Identity = Schema.Struct({
  protocol: Schema.Literal(1),
  privateKey: Schema.RedactedFromValue(Schema.String),
  publicKey: VaultBrokerPublicKey,
  fingerprint: VaultBrokerFingerprint,
});
const BrokerConnection = Schema.Struct({
  protocol: Schema.Literal(1),
  origin: Schema.String,
  environmentId: Schema.String,
  machineId: Schema.String,
});
type BrokerConnection = typeof BrokerConnection.Type;
export class BrokerIdentity extends Context.Service<
  BrokerIdentity,
  {
    readonly read: (
      directory: string,
    ) => Effect.Effect<
      typeof Identity.Type & { platform: "darwin" | "linux"; directory: string },
      VaultBrokerError
    >;
    readonly connection: (directory: string) => Effect.Effect<BrokerConnection, VaultBrokerError>;
    readonly connect: (
      directory: string,
      connection: BrokerConnection,
    ) => Effect.Effect<void, VaultBrokerError>;
    readonly invitation: (file: string) => Effect.Effect<unknown, VaultBrokerError>;
  }
>()("t3/fork/vault/BrokerIdentity") {}
const isisBrokerPlatform = Schema.is(VaultBrokerPlatform);
const encodeEffectIdentityJson = Schema.encodeEffect(Schema.fromJsonString(Identity));
const decodeEffectIdentityJson = Schema.decodeEffect(Schema.fromJsonString(Identity));
const decodeEffectConnectionJson = Schema.decodeEffect(Schema.fromJsonString(BrokerConnection));
const encodeEffectConnectionJson = Schema.encodeEffect(Schema.fromJsonString(BrokerConnection));
const decodeEffectUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    crypto = yield* BrokerCrypto.BrokerCrypto;
  const platform = yield* HostProcess.Platform,
    userId = yield* HostProcess.UserId;
  const home = yield* HostProcess.HomeDirectory,
    cwd = yield* HostProcess.WorkingDirectory;
  const fail = () => new VaultBrokerError({ reason: "local-state" });
  const privateDirectory = Effect.fnUntraced(function* (requested: string) {
    if (!isisBrokerPlatform(platform))
      return yield* new VaultBrokerError({ reason: "unsupported" });
    const directory = requested || path.join(home, ".config", "loom", "vault-broker");
    if (!path.isAbsolute(directory)) return yield* fail();
    const normalized = path.normalize(directory);
    const relative = path.relative(cwd, normalized);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    )
      return yield* fail();
    yield* fs
      .makeDirectory(normalized, { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(fail));
    const real = yield* fs.realPath(normalized).pipe(Effect.mapError(fail));
    const info = yield* fs.stat(normalized).pipe(Effect.mapError(fail));
    if (
      real !== normalized ||
      info.type !== "Directory" ||
      (info.mode & 0o077) !== 0 ||
      (userId !== undefined && Option.getOrNull(info.uid) !== userId)
    )
      return yield* fail();
    return normalized;
  });
  const readPrivate = Effect.fnUntraced(function* (file: string) {
    if (Option.isSome(yield* fs.readLink(file).pipe(Effect.option))) return yield* fail();
    const info = yield* fs.stat(file).pipe(Effect.mapError(fail));
    if (
      info.type !== "File" ||
      ByteSize.toBigInt(info.size) > 16_384n ||
      (info.mode & 0o077) !== 0 ||
      (userId !== undefined && Option.getOrNull(info.uid) !== userId)
    )
      return yield* fail();
    return yield* fs.readFileString(file).pipe(Effect.mapError(fail));
  });
  return BrokerIdentity.of({
    read: Effect.fn("BrokerIdentity.read")(function* (requested) {
      const directory = yield* privateDirectory(requested),
        file = path.join(directory, "identity.json");
      if (!(yield* fs.exists(file).pipe(Effect.mapError(fail)))) {
        const created = yield* crypto.create;
        const encoded = yield* encodeEffectIdentityJson({
          protocol: 1,
          ...created,
        }).pipe(Effect.mapError(fail));
        yield* fs
          .writeFileString(file, encoded, { flag: "wx", mode: 0o600 })
          .pipe(Effect.mapError(fail));
      }
      const identity = yield* decodeEffectIdentityJson(yield* readPrivate(file)).pipe(
        Effect.mapError(fail),
      );
      if (
        yield* crypto
          .publicKey(identity.privateKey)
          .pipe(Effect.map((key) => key !== identity.publicKey))
      )
        return yield* fail();
      if ((yield* crypto.fingerprint(identity.publicKey)) !== identity.fingerprint)
        return yield* fail();
      return { ...identity, platform: platform as "darwin" | "linux", directory };
    }),
    connection: Effect.fn("BrokerIdentity.connection")(function* (requested) {
      const directory = yield* privateDirectory(requested);
      return yield* decodeEffectConnectionJson(
        yield* readPrivate(path.join(directory, "connection.json")),
      ).pipe(Effect.mapError(fail));
    }),
    connect: Effect.fn("BrokerIdentity.connect")(function* (requested, connection) {
      const directory = yield* privateDirectory(requested),
        file = path.join(directory, "connection.json");
      if (yield* fs.exists(file).pipe(Effect.mapError(fail))) {
        const current = yield* decodeEffectConnectionJson(yield* readPrivate(file)).pipe(
          Effect.mapError(fail),
        );
        if (
          current.origin !== connection.origin ||
          current.environmentId !== connection.environmentId ||
          current.machineId !== connection.machineId
        )
          return yield* new VaultBrokerError({ reason: "configuration" });
        return;
      }
      const encoded = yield* encodeEffectConnectionJson(connection).pipe(Effect.mapError(fail));
      yield* fs
        .writeFileString(file, encoded, { flag: "wx", mode: 0o600 })
        .pipe(Effect.mapError(fail));
    }),
    invitation: Effect.fn("BrokerIdentity.invitation")(function* (file) {
      const info = yield* fs.stat(file).pipe(Effect.mapError(fail));
      if (info.type !== "File" || ByteSize.toBigInt(info.size) > 16_384n) return yield* fail();
      return yield* decodeEffectUnknownJson(
        yield* fs.readFileString(file).pipe(Effect.mapError(fail)),
      ).pipe(Effect.mapError(fail));
    }),
  });
});
export const layer = Layer.effect(BrokerIdentity, make);
