import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import {
  PcbReferenceMetadata,
  ASSUMED_PART_HEIGHT_MM,
  EnclosureRequirements,
  ModelPreviewError,
  resolvePartPath,
  type AssemblyPart,
  type ModelFileRef,
} from "@t3tools/contracts/fork";
import { boardFeatures } from "../../pcb-preview/enclosure/features.ts";
import { readGlbDocument } from "../../pcb-preview/enclosure/readJson.ts";
const defaults = Schema.decodeUnknownSync(EnclosureRequirements)({});
const decodeMetadata = Schema.decodeUnknownEffect(Schema.fromJsonString(PcbReferenceMetadata));

export const makeBoardFeatures = (
  resolve: (file: ModelFileRef) => Effect.Effect<{ absolute: string }, ModelPreviewError>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return Effect.fn("Assembly.boardFeatures")(function* (
      file: ModelFileRef,
      part: AssemblyPart,
      requirements: EnclosureRequirements = defaults,
    ) {
      const relative = resolvePartPath(file.path, part.path);
      if (!relative || !relative.toLowerCase().endsWith(".glb"))
        return yield* new ModelPreviewError({
          reason: "invalid-parameter",
          message: "Choose a GLB board reference.",
        });
      const source = yield* resolve({ ...file, path: relative }),
        metadataFile = yield* resolve({ ...file, path: relative.replace(/\.glb$/i, ".json") });
      const metadata = yield* Effect.gen(function* () {
        const info = yield* fs.stat(metadataFile.absolute);
        if (Number(info.size) > 256 * 1024)
          return yield* new ModelPreviewError({
            reason: "too-large",
            message: "The board reference metadata is too large.",
          });
        return yield* decodeMetadata(yield* fs.readFileString(metadataFile.absolute));
      }).pipe(
        Effect.mapError(
          () =>
            new ModelPreviewError({
              reason: "invalid-parameter",
              message: "This board has no reference data. Export it from the PCB panel.",
            }),
        ),
      );
      if (metadata.version > 2)
        return yield* new ModelPreviewError({
          reason: "invalid-parameter",
          message: "This board reference needs a newer Loom.",
        });
      const json = yield* readGlbDocument(source.absolute).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.mapError(
          () =>
            new ModelPreviewError({
              reason: "invalid-parameter",
              message: "The board reference has invalid GLB data.",
            }),
        ),
      );
      return yield* Effect.try({
        try: () =>
          boardFeatures(json, metadata, {
            ...requirements,
            assumedHeightMm: ASSUMED_PART_HEIGHT_MM,
          }),
        catch: () =>
          new ModelPreviewError({
            reason: "invalid-parameter",
            message: "The board reference has invalid feature data.",
          }),
      });
    });
  });
