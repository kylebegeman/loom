import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ensureClient, hashBundle, installedBinary } from "./mobile-native-client.ts";

const signedEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>keychain-access-groups</key><array><string>com.kylebegeman.loom.dev</string></array>
<key>com.apple.security.application-groups</key><array><string>group.com.kylebegeman.loom.dev</string></array>
</dict></plist>`;

it.layer(NodeServices.layer)("Loom native client identity", (it) => {
  it.effect("does not accept the upstream T3 development client as Loom", () =>
    Effect.gen(function* () {
      const installed = yield* installedBinary("ios", "test-simulator", () =>
        Effect.succeed('{"com.t3tools.t3code.dev": {}}'),
      );
      assert.equal(installed, null);
    }),
  );

  it.effect("hashes the separately installed Loom development client", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const app = yield* fs.makeTempDirectoryScoped({ prefix: "loom-native-identity-" });
      yield* fs.writeFileString(path.join(app, "Info.plist"), "Loom Dev");
      const installed = yield* installedBinary("ios", "test-simulator", (_command, args) => {
        if (args[1] === "listapps") return Effect.succeed('{"com.kylebegeman.loom.dev": {}}');
        if (args[1] === "get_app_container" && args[3] === "com.kylebegeman.loom.dev")
          return Effect.succeed(app);
        if (_command === "codesign") return Effect.succeed(signedEntitlements);
        return Effect.die("Requested a different app container.");
      });
      assert.match(installed ?? "", /^[a-f0-9]{64}$/);
    }),
  );

  it.effect(
    "rejects a matching cached simulator binary when its keychain entitlements are absent",
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
          if (command === "codesign") return Effect.succeed(signed ? signedEntitlements : "");
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

  it.effect("does not accept another app's keychain group or a missing Loom app group", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const app = yield* fs.makeTempDirectoryScoped({ prefix: "loom-native-wrong-signing-" });
      for (const entitlements of [
        signedEntitlements.replace(
          "<string>com.kylebegeman.loom.dev</string>",
          "<string>com.t3tools.t3code.dev</string>",
        ),
        signedEntitlements.replace("<string>group.com.kylebegeman.loom.dev</string>", ""),
        "malformed signing output",
      ]) {
        const installed = yield* installedBinary("ios", "test-simulator", (command, args) => {
          if (args[1] === "listapps") return Effect.succeed('{"com.kylebegeman.loom.dev": {}}');
          if (args[1] === "get_app_container") return Effect.succeed(app);
          if (command === "codesign") return Effect.succeed(entitlements);
          return Effect.die("Unexpected native command.");
        });
        assert.equal(installed, null);
      }
    }),
  );
});
