import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { type IdentityGrant, identityGrantKey } from "@t3tools/shared/fork/identity-grant";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";
import * as DesktopIdentityGrantStore from "./DesktopIdentityGrantStore.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const grant: IdentityGrant = {
  version: 1,
  issuer: "https://id.example.test",
  subject: "subject-1",
  environmentId: EnvironmentId.make("env-1"),
  httpBaseUrl: "https://computer.example.test",
  clientId: "native-client",
  tokenEndpoint: "https://id.example.test/api/oidc/token",
  endSessionEndpoint: "https://id.example.test/api/oidc/end-session",
  refreshToken: "refresh-secret",
  idToken: "id-secret",
  grantedAt: 1,
  updatedAt: 1,
};
const otherGrant: IdentityGrant = {
  ...grant,
  environmentId: EnvironmentId.make("env-2"),
  refreshToken: "refresh-other",
};

type Encryption = "available" | "unavailable" | "locked";

// Reversible, so the test can read what was stored; a prefix marks real ciphertext. A locked
// keychain still encrypts but decrypts nothing.
const layerSafeStorage = (encryption: { current: Encryption }) =>
  Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.sync(() => encryption.current !== "unavailable"),
    encryptString: (value) =>
      Effect.succeed(textEncoder.encode(`sealed:${Buffer.from(value).toString("hex")}`)),
    decryptString: (value) => {
      const sealed = textDecoder.decode(value);
      return encryption.current !== "locked" && sealed.startsWith("sealed:")
        ? Effect.succeed(Buffer.from(sealed.slice("sealed:".length), "hex").toString())
        : Effect.fail(
            new ElectronSafeStorage.ElectronSafeStorageDecryptError({ cause: new Error("bad") }),
          );
    },
    selectedStorageBackend: Effect.succeedNone,
  } satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);

const layerFor = (baseDir: string, encryption: { current: Encryption }) =>
  DesktopIdentityGrantStore.layer.pipe(
    Layer.provideMerge(
      DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/src",
        homeDirectory: baseDir,
        platform: "darwin",
        processArch: "arm64",
        appVersion: "1.2.3",
        appPath: "/repo",
        isPackaged: true,
        resourcesPath: "/missing/resources",
        runningUnderArm64Translation: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
        ),
      ),
    ),
    Layer.provideMerge(layerSafeStorage(encryption)),
    Layer.provideMerge(NodeServices.layer),
  );

const withStore = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | DesktopIdentityGrantStore.DesktopIdentityGrantStore
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
    | Path.Path
  >,
  encryption: { current: Encryption } = { current: "available" },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-identity-grants-test-",
    });
    return yield* effect.pipe(Effect.provide(layerFor(baseDir, encryption)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const grantsPath = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = yield* Path.Path;
  return path.join(environment.stateDir, "loom-identity-grants.json");
});

describe("DesktopIdentityGrantStore", () => {
  it.effect("keeps grants encrypted in an owner-only file and forgets them by key", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopIdentityGrantStore.DesktopIdentityGrantStore;
        const fileSystem = yield* FileSystem.FileSystem;
        const file = yield* grantsPath;

        assert.isTrue(yield* store.put(grant));
        assert.isTrue(yield* store.put(otherGrant));
        assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.some(grant));
        assert.deepStrictEqual(
          yield* store.get(identityGrantKey(otherGrant)),
          Option.some(otherGrant),
        );

        const raw = yield* fileSystem.readFileString(file);
        assert.notInclude(raw, "refresh-secret");
        assert.notInclude(raw, "id-secret");
        assert.strictEqual((yield* fileSystem.stat(file)).mode & 0o777, 0o600);

        yield* store.remove(identityGrantKey(grant));
        assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.none());
        assert.deepStrictEqual(
          yield* store.get(identityGrantKey(otherGrant)),
          Option.some(otherGrant),
        );

        yield* store.remove(identityGrantKey(otherGrant));
        assert.isFalse(yield* fileSystem.exists(file));
      }),
    ),
  );

  it.effect("treats a corrupt file as empty and replaces it on the next save", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopIdentityGrantStore.DesktopIdentityGrantStore;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = yield* grantsPath;
        yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });

        for (const corrupt of [
          "not json",
          JSON.stringify({ version: 1, encrypted: "%%%" }),
          JSON.stringify({ version: 1, encrypted: Buffer.from("unsealed").toString("base64") }),
        ]) {
          yield* fileSystem.writeFileString(file, corrupt);
          assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.none());
        }

        assert.isTrue(yield* store.put(grant));
        assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.some(grant));
      }),
    ),
  );

  it.effect("stores nothing when OS encryption is unavailable", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopIdentityGrantStore.DesktopIdentityGrantStore;
        const fileSystem = yield* FileSystem.FileSystem;

        assert.isFalse(yield* store.put(grant));
        assert.isFalse(yield* store.put(otherGrant));
        assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.none());
        assert.isFalse(yield* fileSystem.exists(yield* grantsPath));
      }),
      { current: "unavailable" },
    ),
  );

  it.effect("keeps every grant when the keychain cannot decrypt them for now", () => {
    const encryption: { current: Encryption } = { current: "available" };
    return withStore(
      Effect.gen(function* () {
        const store = yield* DesktopIdentityGrantStore.DesktopIdentityGrantStore;
        assert.isTrue(yield* store.put(grant));

        encryption.current = "locked";
        const failures = yield* Effect.forEach(
          [
            store.get(identityGrantKey(grant)),
            store.put(otherGrant),
            store.remove(identityGrantKey(grant)),
          ],
          (operation) => Effect.flip(operation),
        );
        assert.deepStrictEqual(
          failures.map((error) => error.operation),
          ["read", "read", "read"],
        );

        encryption.current = "available";
        assert.deepStrictEqual(yield* store.get(identityGrantKey(grant)), Option.some(grant));
        assert.deepStrictEqual(yield* store.get(identityGrantKey(otherGrant)), Option.none());
      }),
      encryption,
    );
  });
});
