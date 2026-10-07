import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ModelPreviewMigrations } from "./migrations.ts";
import { EMPTY_MODEL_WORKSPACE } from "@t3tools/contracts/fork";
import { makeStore } from "./store.ts";
it.effect("persists parameters/settings and sweeps deleted projects", () =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ModelPreviewMigrations);
    const store = yield* makeStore;
    const settings = yield* store.getSettings();
    expect(settings.buildPlate.preset).toBe("bambu-h2d");
    yield* store.updateSettings({ ...settings, agentToolEnabled: false });
    expect((yield* store.getSettings()).agentToolEnabled).toBe(false);
    yield* store.saveParams("project", "part.scad", { width: "10" }, "wide");
    yield* store.saveParams("project", "part.scad", { width: "20" }, null);
    expect(yield* store.getParams("project", "part.scad")).toEqual({
      lastUsed: { width: "20" },
      lastUsedSet: null,
    });
    const workspace = {
      ...EMPTY_MODEL_WORKSPACE,
      measurements: [
        {
          id: "distance",
          name: "Width",
          sourceRevision: "mesh1",
          start: [0, 0, 0] as const,
          end: [20, 0, 0] as const,
          visible: true,
        },
      ],
    };
    yield* store.saveWorkspace("project", "root\0part.scad", workspace);
    expect(yield* store.getWorkspace("project", "root\0part.scad")).toEqual(workspace);
    expect(yield* store.getWorkspace("project", "other-root\0part.scad")).toEqual(
      EMPTY_MODEL_WORKSPACE,
    );
    yield* store.sweep([]);
    expect(yield* store.getWorkspace("project", "root\0part.scad")).toEqual(EMPTY_MODEL_WORKSPACE);
    expect(yield* store.getParams("project", "part.scad")).toEqual({
      lastUsed: {},
      lastUsedSet: null,
    });
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("reads legacy main-checkout parameters only as a fallback to scoped values", () =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ModelPreviewMigrations);
    const store = yield* makeStore;
    yield* store.saveParams("project", "part.scad", { width: "10" }, "legacy");
    expect((yield* store.getParams("project", "main\0part.scad", "part.scad")).lastUsed.width).toBe(
      "10",
    );
    expect((yield* store.getParams("project", "worktree\0part.scad")).lastUsed).toEqual({});
    yield* store.saveParams("project", "main\0part.scad", { width: "20" }, null);
    expect(yield* store.getParams("project", "main\0part.scad", "part.scad")).toEqual({
      lastUsed: { width: "20" },
      lastUsedSet: null,
    });
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
