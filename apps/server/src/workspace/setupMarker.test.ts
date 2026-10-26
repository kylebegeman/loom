import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as SetupMarker from "./setupMarker.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-setup-marker-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const cwd = `${parent}/checkout`;
  yield* fs.makeDirectory(cwd);
  const stateDir = yield* fs.realPath((yield* ServerConfig.ServerConfig).stateDir);
  return { fs, parent, cwd, stateDir };
});

describe("setup markers", () => {
  it.effect("round-trips under T3 home without writing beside the checkout", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(yield* SetupMarker.exists(f.cwd)).toBe(false);
      yield* SetupMarker.write(f.cwd);
      const marker = yield* SetupMarker.markerPath(f.cwd);
      expect(marker.startsWith(`${f.stateDir}/workspace-markers/`)).toBe(true);
      expect(yield* SetupMarker.exists(f.cwd)).toBe(true);
      expect(yield* SetupMarker.read(f.cwd)).toEqual(Option.some(SetupMarker.PENDING_CONTENTS));
      expect(yield* f.fs.readDirectory(f.parent)).toEqual(["checkout"]);
      yield* SetupMarker.clear(f.cwd);
      expect(yield* SetupMarker.exists(f.cwd)).toBe(false);
      expect(yield* f.fs.exists(marker)).toBe(false);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.effect("keys a checkout the same before and after its folder exists", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const later = `${f.parent}/missing/checkout`;
      yield* SetupMarker.write(later, "recovery\n");
      yield* f.fs.makeDirectory(later, { recursive: true });
      expect(yield* SetupMarker.read(later)).toEqual(Option.some("recovery\n"));
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.effect("reports and clears a marker an older version left beside the checkout", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const legacy = `${f.cwd}.t3-setup-pending`;
      yield* f.fs.writeFileString(legacy, "legacy\n");
      expect(yield* SetupMarker.exists(f.cwd)).toBe(true);
      expect(yield* SetupMarker.read(f.cwd)).toEqual(Option.some("legacy\n"));
      yield* SetupMarker.clear(f.cwd);
      expect(yield* f.fs.exists(legacy)).toBe(false);
      expect(yield* SetupMarker.exists(f.cwd)).toBe(false);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
});
