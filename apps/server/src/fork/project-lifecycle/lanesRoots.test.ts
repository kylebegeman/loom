import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { LanesRoots } from "../../project/ProjectPlacement.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as LanesRootsLayer from "./lanesRoots.ts";
import { ProjectLifecycleMigrations } from "./migrations.ts";
import { makeStore } from "./store.ts";

const home = "/home/lanes-test";
const layerTest = LanesRootsLayer.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(Layer.succeed(HostProcess.HomeDirectory, home)),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "lanes-roots-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("guards no lanes on a database without the lifecycle store", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* (yield* LanesRoots).roots, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("guards the default lanes folder until one is saved, then the saved one", () =>
  Effect.gen(function* () {
    const lanes = yield* LanesRoots;
    yield* runForkMigrationSet(ProjectLifecycleMigrations);
    assert.deepStrictEqual(yield* lanes.roots, [`${home}/Developer/lanes`]);
    const store = yield* makeStore;
    const defaults = LanesRootsLayer.lifecycleDefaults(yield* ServerConfig.ServerConfig, home);
    yield* store.updateSettings({ ...defaults, lanesRoot: "~/work/lanes/" });
    assert.deepStrictEqual(yield* lanes.roots, [`${home}/work/lanes`]);
  }).pipe(Effect.provide(layerTest)),
);
