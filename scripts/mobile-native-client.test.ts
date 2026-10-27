import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

// fork: native-dev-client
import {
  NativeClientError,
  ensureClient,
  hashBundle,
  installedBinary,
  prebuildAndroid,
} from "./mobile-native-client.ts";

// fork: native-dev-client
it.layer(NodeServices.layer)("Loom native client identity", (it) => {
  // fork: mobile-identity
  it.effect("does not accept the upstream T3 development client as Loom", () =>
    Effect.gen(function* () {
      const installed = yield* installedBinary("ios", "test-simulator", () =>
        Effect.succeed('{"com.t3tools.t3code.dev": {}}'),
      );
      assert.equal(installed, null);
    }),
  );

  it.effect("accepts a sealed ad-hoc simulator bundle with empty signature entitlements", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const app = yield* fs.makeTempDirectoryScoped({ prefix: "loom-native-identity-" });
      yield* fs.writeFileString(path.join(app, "Info.plist"), "Loom Dev");
      const installed = yield* installedBinary("ios", "test-simulator", (_command, args) => {
        if (args[1] === "listapps") return Effect.succeed('{"com.kylebegeman.loom.dev": {}}');
        if (args[1] === "get_app_container" && args[3] === "com.kylebegeman.loom.dev")
          return Effect.succeed(app);
        if (_command === "codesign") return Effect.succeed("");
        return Effect.die("Requested a different app container.");
      });
      assert.match(installed ?? "", /^[a-f0-9]{64}$/);
    }),
  );

  it.effect(
    "rejects a matching cached linker-only simulator binary and records its signed replacement",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const app = yield* fs.makeTempDirectoryScoped({ prefix: "loom-native-signing-" });
        yield* fs.writeFileString(path.join(app, "Info.plist"), "Loom Dev");
        const originalBinary = yield* hashBundle(app);
        let signed = false;
        let recorded = false;
        const installed = installedBinary("ios", "test-simulator", (command, args) => {
          if (args[1] === "listapps") return Effect.succeed('{"com.kylebegeman.loom.dev": {}}');
          if (args[1] === "get_app_container") return Effect.succeed(app);
          if (command === "codesign")
            return signed
              ? Effect.succeed("")
              : Effect.fail(
                  new NativeClientError({ message: "The fixture has no sealed resources." }),
                );
          return Effect.die("Unexpected native command.");
        });
        assert.equal(yield* installed, null);
        const result = yield* ensureClient({
          fingerprint: Effect.succeed("unchanged-native-inputs"),
          installedBinary: installed,
          readRecord: Effect.succeed({
            fingerprint: "unchanged-native-inputs",
            binary: originalBinary,
          }),
          install: () =>
            Effect.sync(() => {
              signed = true;
              return "build" as const;
            }),
          saveRecord: () =>
            Effect.sync(() => {
              recorded = true;
            }),
        });
        assert.isTrue(result.installed);
        assert.isTrue(recorded);
        assert.equal(result.status, "compatible");
      }),
  );

  it.effect("rejects an installed simulator bundle when strict signature verification fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const app = yield* fs.makeTempDirectoryScoped({ prefix: "loom-native-unverified-" });
      const installed = yield* installedBinary("ios", "test-simulator", (command, args) => {
        if (args[1] === "listapps") return Effect.succeed('{"com.kylebegeman.loom.dev": {}}');
        if (args[1] === "get_app_container") return Effect.succeed(app);
        if (command === "codesign")
          return Effect.fail(
            new NativeClientError({ message: "The fixture signature is invalid." }),
          );
        return Effect.die("Unexpected native command.");
      });
      assert.equal(installed, null);
    }),
  );
});

const caches = [".gradle/history", "app/.cxx/object"];

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mobile = yield* fs.makeTempDirectoryScoped({ prefix: "mobile-native-client-" });
  const android = path.join(mobile, "android");
  for (const cache of caches) {
    yield* fs.makeDirectory(path.dirname(path.join(android, cache)), { recursive: true });
    yield* fs.writeFileString(path.join(android, cache), cache);
  }
  const cleanPrebuild = Effect.gen(function* () {
    yield* fs.remove(android, { recursive: true });
    yield* fs.makeDirectory(path.join(android, "app"), { recursive: true });
    yield* fs.writeFileString(path.join(android, "app/build.gradle"), "regenerated");
  });
  const assertCachesRestored = Effect.gen(function* () {
    for (const cache of caches) {
      assert.strictEqual(yield* fs.readFileString(path.join(android, cache)), cache);
    }
    assert.deepStrictEqual(yield* fs.readDirectory(mobile), ["android"]);
  });
  return { fs, path, mobile, android, cleanPrebuild, assertCachesRestored };
});

it.layer(NodeServices.layer)("prebuildAndroid", (it) => {
  it.effect("keeps Gradle and native caches through a clean prebuild", () =>
    Effect.gen(function* () {
      const { fs, path, mobile, android, cleanPrebuild, assertCachesRestored } = yield* fixture;

      yield* prebuildAndroid(mobile, cleanPrebuild);

      assert.strictEqual(
        yield* fs.readFileString(path.join(android, "app/build.gradle")),
        "regenerated",
      );
      yield* assertCachesRestored;
    }),
  );

  it.effect("restores the caches and returns the error when prebuild fails", () =>
    Effect.gen(function* () {
      const { mobile, cleanPrebuild, assertCachesRestored } = yield* fixture;
      const failure = new NativeClientError({ message: "prebuild failed" });

      const error = yield* prebuildAndroid(
        mobile,
        cleanPrebuild.pipe(Effect.andThen(Effect.fail(failure))),
      ).pipe(Effect.flip);

      assert.strictEqual(error, failure);
      yield* assertCachesRestored;
    }),
  );
});
