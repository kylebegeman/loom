import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  NativeClientError,
  ensureClient,
  hashBundle,
  installedBinary,
} from "./mobile-native-client.ts";

it.layer(NodeServices.layer)("Loom native client identity", (it) => {
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
          build: Effect.sync(() => {
            signed = true;
          }),
          saveRecord: () =>
            Effect.sync(() => {
              recorded = true;
            }),
        });
        assert.isTrue(result.rebuilt);
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
