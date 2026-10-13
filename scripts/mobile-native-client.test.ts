import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { installedBinary } from "./mobile-native-client.ts";

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
        return Effect.die("Requested a different app container.");
      });
      assert.match(installed ?? "", /^[a-f0-9]{64}$/);
    }),
  );
});
