// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  ModelPreviewError,
  PrinterProfileDraft,
  PrinterLibraryUpdate,
  STARTER_MATERIALS,
  libraryProblems,
  selectBed,
  type PrinterLibrary,
  type PrinterProfileInput,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import { makeStore } from "./store.ts";
import { parseBambuProfile, parsePrusaIni } from "./printerProfiles.ts";
import { flattenProfile, slicerProfileRoots } from "./slicer/profiles.ts";

export const migratedPrinterLibrary = (settings: ModelPreviewSettings): PrinterLibrary => ({
  version: 1,
  printers: settings.buildPlate.customBeds.map((bed) => ({
    id: bed.id,
    name: bed.name,
    kind: bed.volumeMm[2] === null ? "surface" : "printer",
    volumeMm: bed.volumeMm,
    bedShape: "rectangle",
    nozzlesMm: [],
    materialIds: [],
    defaultMaterialId: null,
    zones: [],
    excludedAreasMm: [],
    notes: "",
    source: { kind: "user", app: null, profileName: null },
    basedOn: null,
  })),
  materials: STARTER_MATERIALS,
  hiddenBuiltIns: settings.buildPlate.hiddenPresets,
});
const decodeUpdate = Schema.decodeUnknownEffect(PrinterLibraryUpdate);
const decodeProfile = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeDraft = Schema.decodeUnknownEffect(PrinterProfileDraft);
const knownError = Schema.is(ModelPreviewError);
const checked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      knownError(cause)
        ? cause
        : new ModelPreviewError({
            reason: "command-failed",
            message: "The printer library could not be read or saved.",
          }),
    ),
  );

/** Own the versioned library and migration while reusing the model service's settings lifecycle. */
export const makePrinterLibrary = (options: {
  readonly getSettings: () => Effect.Effect<ModelPreviewSettings, ModelPreviewError>;
  readonly saveSettings: (
    value: ModelPreviewSettings,
  ) => Effect.Effect<ModelPreviewSettings, ModelPreviewError>;
}) =>
  Effect.gen(function* () {
    const store = yield* makeStore;
    const platform = yield* HostProcess.Platform;
    const home = yield* HostProcess.HomeDirectory;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* Semaphore.make(1);
    const read = Effect.fn("ModelPrinters.read")(function* () {
      const stored = yield* store.getPrinters();
      if (Option.isSome(stored)) return stored.value;
      const migrated = migratedPrinterLibrary(yield* options.getSettings());
      return yield* store.savePrinters(migrated);
    });
    const library = () => checked(lock.withPermit(read()));
    const update = (input: typeof PrinterLibraryUpdate.Type) =>
      checked(
        lock.withPermit(
          Effect.gen(function* () {
            const validated = yield* decodeUpdate(input).pipe(
              Effect.mapError(
                () =>
                  new ModelPreviewError({
                    reason: "invalid-parameter",
                    message: "The printer library has invalid fields.",
                  }),
              ),
            );
            const current = yield* read();
            if (current.version !== validated.expectedVersion)
              return yield* new ModelPreviewError({
                reason: "conflict",
                message: "Printers changed on another client. Reload to see the latest.",
              });
            const problems = libraryProblems(validated);
            if (problems.length)
              return yield* new ModelPreviewError({
                reason: "invalid-parameter",
                message: problems[0]!,
              });
            const next: PrinterLibrary = {
              version: current.version + 1,
              printers: validated.printers,
              materials: validated.materials,
              hiddenBuiltIns: validated.hiddenBuiltIns,
            };
            const settings = yield* options.getSettings();
            const selected = settings.buildPlate.customBedId;
            if (
              settings.buildPlate.preset === "custom" &&
              selected &&
              current.printers.some((p) => p.id === selected) &&
              !next.printers.some((p) => p.id === selected)
            ) {
              yield* options.saveSettings({
                ...settings,
                buildPlate: selectBed(
                  settings.buildPlate,
                  DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate.preset,
                ),
              });
            }
            return yield* store.savePrinters(next);
          }),
        ),
      );
    const parseProfile = Effect.fn("ModelPrinters.parseProfile")(function* (
      input: PrinterProfileInput,
    ) {
      if (new TextEncoder().encode(input.text).length > 2 * 1024 * 1024)
        return yield* new ModelPreviewError({
          reason: "too-large",
          message: "Profile files must be at most 2 MiB.",
        });
      const id = `custom-${NodeCrypto.randomUUID()}`;
      let draft: PrinterProfileDraft;
      if (input.fileName.toLowerCase().endsWith(".ini")) {
        draft = yield* Effect.try({
          try: () => parsePrusaIni(input.text, id),
          catch: (cause) =>
            new ModelPreviewError({
              reason: "invalid-parameter",
              message:
                cause instanceof Error
                  ? cause.message
                  : "This file is not a printer profile Loom can read.",
            }),
        });
      } else if (input.fileName.toLowerCase().endsWith(".json")) {
        let json = yield* decodeProfile(input.text).pipe(
          Effect.mapError(
            () =>
              new ModelPreviewError({
                reason: "invalid-parameter",
                message: "This file is not a printer profile Loom can read.",
              }),
          ),
        );
        const parent = typeof json.inherits === "string" ? json.inherits : null;
        let app: "bambu-studio" | "orca-slicer" = /orca/i.test(
          String(json.from ?? json.vendor ?? ""),
        )
          ? "orca-slicer"
          : "bambu-studio";
        if (parent) {
          const settings = yield* options.getSettings();
          let found = false;
          for (const candidate of [
            app,
            app === "bambu-studio" ? "orca-slicer" : "bambu-studio",
          ] as const) {
            const executable =
              settings.slicer.paths[candidate] ??
              (platform === "darwin"
                ? `/Applications/${candidate === "bambu-studio" ? "BambuStudio" : "OrcaSlicer"}.app/Contents/MacOS/${candidate === "bambu-studio" ? "BambuStudio" : "OrcaSlicer"}`
                : candidate === "bambu-studio"
                  ? "bambu-studio"
                  : "orca-slicer");
            const flattened = yield* flattenProfile(
              yield* slicerProfileRoots(candidate, home, executable),
              "machine",
              parent,
            ).pipe(Effect.option);
            if (Option.isSome(flattened)) {
              json = Object.assign({}, flattened.value.json, json);
              app = candidate;
              found = true;
              break;
            }
          }
          if (!found)
            return yield* new ModelPreviewError({
              reason: "invalid-parameter",
              message: `This profile inherits from "${parent}", which Loom could not find on this host. Export it from the slicer as a full profile.`,
            });
        }
        draft = yield* Effect.try({
          try: () => parseBambuProfile(json, id, app),
          catch: (cause) =>
            new ModelPreviewError({
              reason: "invalid-parameter",
              message:
                cause instanceof Error
                  ? cause.message
                  : "This file is not a printer profile Loom can read.",
            }),
        });
      } else
        return yield* new ModelPreviewError({
          reason: "unsupported-format",
          message: "Import a JSON machine profile or an INI config.",
        });
      const decoded = yield* decodeDraft(draft).pipe(
        Effect.mapError(
          () =>
            new ModelPreviewError({
              reason: "invalid-parameter",
              message: "The profile contains unsupported printer values.",
            }),
        ),
      );
      const problems = libraryProblems({
        printers: [decoded.printer],
        materials: [],
        hiddenBuiltIns: [],
      });
      if (problems.length)
        return yield* new ModelPreviewError({ reason: "invalid-parameter", message: problems[0]! });
      return decoded;
    });
    const readProfile = Effect.fn("ModelPrinters.readProfile")(function* (absolute: string) {
      const info = yield* fs
        .stat(absolute)
        .pipe(
          Effect.mapError(
            () =>
              new ModelPreviewError({
                reason: "not-found",
                message: "The profile was deleted or moved.",
              }),
          ),
        );
      if (info.type !== "File" || Number(info.size) > 2 * 1024 * 1024)
        return yield* new ModelPreviewError({
          reason: "too-large",
          message: "Profile files must be at most 2 MiB.",
        });
      const text = yield* fs
        .readFileString(absolute)
        .pipe(
          Effect.mapError(
            () =>
              new ModelPreviewError({
                reason: "not-found",
                message: "The profile could not be read.",
              }),
          ),
        );
      return yield* parseProfile({ fileName: path.basename(absolute), text });
    });
    return {
      printers: library,
      updatePrinters: update,
      parsePrinterProfile: (input: PrinterProfileInput) =>
        parseProfile(input).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      readPrinterProfile: (absolute: string) =>
        readProfile(absolute).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
    };
  });
