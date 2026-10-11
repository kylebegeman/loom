import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ModelPreviewMigrations } from "./migrations.ts";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, ModelPreviewError } from "@t3tools/contracts/fork";
import { makeStore } from "./store.ts";
import { makePrinterLibrary } from "./printers.ts";
import { layer as NodeServices } from "@effect/platform-node/NodeServices";
const known = Schema.is(ModelPreviewError);
it.effect("migrates once, guards competing edits and resets deleted active printers", () =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ModelPreviewMigrations);
    const store = yield* makeStore;
    expect(Option.isNone(yield* store.getPrinters())).toBe(true);
    let settings = {
      ...DEFAULT_MODEL_PREVIEW_SETTINGS,
      buildPlate: {
        ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
        preset: "custom" as const,
        customBedId: "custom-12345678",
        customBeds: [{ id: "custom-12345678", name: "Laser", volumeMm: [400, 300, null] as const }],
        hiddenPresets: ["prusa-mini" as const],
      },
    };
    const service = yield* makePrinterLibrary({
      getSettings: () => Effect.succeed(settings),
      saveSettings: (value) =>
        Effect.sync(() => {
          settings = value as typeof settings;
          return value;
        }),
    });
    const first = yield* service.printers();
    expect(first.version).toBe(1);
    expect(first.printers[0]?.id).toBe("custom-12345678");
    expect(first.hiddenBuiltIns).toEqual(["prusa-mini"]);
    expect(yield* service.printers()).toEqual(first);
    const next = yield* service.updatePrinters({
      expectedVersion: 1,
      printers: [],
      materials: first.materials,
      hiddenBuiltIns: [],
    });
    expect(next.version).toBe(2);
    expect(settings.buildPlate.preset).toBe("bambu-h2d");
    const conflict = yield* service
      .updatePrinters({
        expectedVersion: 1,
        printers: first.printers,
        materials: first.materials,
        hiddenBuiltIns: [],
      })
      .pipe(Effect.flip);
    expect(known(conflict) && conflict.reason).toBe("conflict");
    expect(yield* store.getPrinters()).toEqual(Option.some(next));
  }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.provide(NodeServices)),
);
it.effect("reports corrupt library data instead of silently recreating it", () =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ModelPreviewMigrations);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO fork_model_preview_3d_settings (key,value_json) VALUES ('printers', '{broken')`;
    const service = yield* makePrinterLibrary({
      getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
      saveSettings: (value) => Effect.succeed(value),
    });
    const failure = yield* service.printers().pipe(Effect.flip);
    expect(failure.reason).toBe("command-failed");
  }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.provide(NodeServices)),
);
