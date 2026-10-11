import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  ModelPreviewError,
  type AssemblyPart,
} from "@t3tools/contracts/fork";
import { makeAssemblyGeometry } from "./geometry.ts";

it.effect(
  "revision probes reuse known glTF buffers and invalidate without rereading geometry",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      let reads = 0;
      const part: AssemblyPart = {
        id: "body",
        name: "Body",
        path: "body.gltf",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        color: null,
        visible: true,
        parameters: {},
        parameterSet: null,
        explode: null,
      };
      const file = { threadId: ThreadId.make("geometry"), path: "case.loom-assembly.json" };
      yield* fs.writeFileString(`${root}/body.gltf`, '{"buffers":[{"uri":"body.bin"}]}');
      yield* fs.writeFileString(`${root}/body.bin`, "mesh");
      const service = yield* makeAssemblyGeometry({
        resolveFile: (source) =>
          Effect.gen(function* () {
            const absolute = `${root}/${source.path}`;
            const info = yield* fs
              .stat(absolute)
              .pipe(
                Effect.mapError(
                  () => new ModelPreviewError({ reason: "not-found", message: "Missing" }),
                ),
              );
            return { root, absolute, info };
          }),
        metadata: (info) => ({ revision: String(info.size) }),
        getSettings: () => DEFAULT_MODEL_PREVIEW_SETTINGS,
        renderModel: () =>
          Effect.fail(
            new ModelPreviewError({ reason: "unsupported-format", message: "No source render" }),
          ),
        protectStem: () => Effect.void,
        cacheDir: root,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFile: (path) =>
            fs.readFile(path).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  reads++;
                }),
              ),
            ),
        }),
      );
      expect(yield* service.revisionOf(file, part)).toBeNull();
      const geometry = yield* service
        .geometry(file, part)
        .pipe(Effect.provideService(FileSystem.FileSystem, fs));
      expect(reads).toBe(2);
      expect(yield* service.revisionOf(file, part)).toBe(geometry.geometryRevision);
      expect(reads).toBe(2);
      yield* fs.writeFileString(`${root}/body.bin`, "longer mesh");
      expect(yield* service.revisionOf(file, part)).not.toBe(geometry.geometryRevision);
      expect(reads).toBe(2);
      yield* fs.writeFileString(`${root}/body.gltf`, '{"buffers":[]}');
      expect(yield* service.revisionOf(file, part)).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
