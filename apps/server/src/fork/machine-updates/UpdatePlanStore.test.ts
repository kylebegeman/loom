import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { UpdatePlan } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ServerConfig from "../../config.ts";
import * as UpdatePlanStore from "./UpdatePlanStore.ts";

const plan: UpdatePlan = {
  version: 1,
  id: "update-1",
  targetVersion: "0.1.0",
  state: "waiting",
  createdAt: 1,
  updatedAt: 2,
  finishedAt: null,
  error: null,
};

it.live("atomically reloads an armed plan and refuses corrupt or oversized state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-update-plan-" });
      const config = ServerConfig.layerTest(root, root);
      const store = yield* UpdatePlanStore.UpdatePlanStore.pipe(
        Effect.provide(UpdatePlanStore.layer),
        Effect.provide(config),
      );
      assert.isNull(yield* store.read);
      yield* store.write(plan);
      const reloaded = yield* UpdatePlanStore.UpdatePlanStore.pipe(
        Effect.provide(UpdatePlanStore.layer),
        Effect.provide(config),
      );
      assert.deepEqual(yield* reloaded.read, plan);
      const settings = yield* ServerConfig.ServerConfig.pipe(Effect.provide(config));
      const directory = path.join(settings.stateDir, "fork", "machine-updates");
      assert.deepEqual(yield* fs.readDirectory(directory), ["plan.json"]);
      yield* fs.writeFileString(path.join(directory, "plan.json"), "{}");
      assert.equal((yield* reloaded.read.pipe(Effect.flip)).reason, "read");
      yield* fs.writeFileString(path.join(directory, "plan.json"), "x".repeat(4097));
      assert.equal((yield* reloaded.read.pipe(Effect.flip)).reason, "read");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
