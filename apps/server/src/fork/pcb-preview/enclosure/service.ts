import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import {
  EnclosureRequirements,
  EnclosureStarterParams,
  ModelAssembly,
  PcbPreviewError,
  relativePartPath,
  type PcbEnclosureInput,
  type PcbEnclosureResult,
  type PcbReferenceResult,
  type PcbReferenceMetadata,
} from "@t3tools/contracts/fork";
import { boardFeatures } from "./features.ts";
import { planEnclosure } from "./plan.ts";
import { writeScad, isUnedited } from "./scad.ts";
import { writeBuild123d } from "./build123d.ts";
import { LOOM_SERVER_FEATURES } from "../../features.ts";
const encodeAssembly = Schema.encodeSync(Schema.fromJsonString(ModelAssembly, { space: 2 }));
const fail = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
const decodeParams = Schema.decodeUnknownEffect(EnclosureStarterParams);
const decodeRequirements = Schema.decodeUnknownEffect(EnclosureRequirements);
const decodeAssembly = Schema.decodeUnknownEffect(ModelAssembly);

export const makeEnclosure = (deps: {
  referenceData: (
    i: PcbEnclosureInput,
  ) => Effect.Effect<{ metadata: PcbReferenceMetadata; json: unknown }, PcbPreviewError>;
  exportReference: (i: PcbEnclosureInput) => Effect.Effect<PcbReferenceResult, PcbPreviewError>;
  workspace: (i: PcbEnclosureInput) => Effect.Effect<{ root: string }, PcbPreviewError>;
  directory: (root: string, relative: string) => Effect.Effect<string, PcbPreviewError>;
  refresh: (root: string) => Effect.Effect<unknown, PcbPreviewError>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    return Effect.fn("PcbPreview.enclosure")(function* (input: PcbEnclosureInput) {
      if (input.build123d && !LOOM_SERVER_FEATURES.includes("model-python-cad"))
        return yield* fail(
          "invalid-parameters",
          "Python CAD files need a Loom server with build123d support.",
        );
      const data = yield* deps.referenceData(input);
      const params = yield* decodeParams(input.params ?? {}).pipe(
        Effect.mapError(() => fail("invalid-parameters", "Invalid enclosure starter parameters.")),
      );
      const planned = yield* Effect.try({
        try: () => {
          const features = boardFeatures(data.json, data.metadata, { ...params, edgeMarginMm: 1 });
          return { features, plan: planEnclosure(features, params) };
        },
        catch: () =>
          fail(
            "invalid-parameters",
            "Could not plan this enclosure. Check the board model and standoff sizes.",
          ),
      });
      const { features, plan } = planned,
        ws = yield* deps.workspace(input);
      const stem = path
        .basename(input.designId)
        .split(".")[0]!
        .replace(/[^a-zA-Z0-9_-]/g, "-");
      const output =
        input.outputDir ?? path.join(path.dirname(input.designId), `${stem}-enclosure`);
      if (
        path.isAbsolute(output) ||
        output.includes("\\") ||
        !output ||
        path.relative(ws.root, path.resolve(ws.root, output)) === ".." ||
        path.relative(ws.root, path.resolve(ws.root, output)).startsWith(".." + path.sep)
      )
        return yield* fail("invalid-parameters", "Choose an output folder inside this workspace.");
      const assemblyPath = path
        .join(path.dirname(input.designId), `${stem}.loom-assembly.json`)
        .split(path.sep)
        .join("/");
      const sources = [
        {
          name: "case.scad",
          language: "openscad" as const,
          source: writeScad(plan, input.designId),
        },
        ...(input.build123d
          ? [{ name: "case.b3d.py", language: "build123d" as const, source: writeBuild123d(plan) }]
          : []),
      ];
      let canonical: string | null = null;
      if (!input.preview) {
        canonical = yield* deps.directory(ws.root, output);
        // Validate every destination before the first write, so a conflict never partially regenerates a case.
        for (const source of sources) {
          const destination = path.join(canonical, source.name);
          if (yield* fs.exists(destination)) {
            if (
              (yield* fs.realPath(destination)) !== destination ||
              (yield* fs.stat(destination)).type !== "File"
            )
              return yield* fail(
                "path-outside-workspace",
                "The case destination is not a regular workspace file.",
              );
            if (!input.overwrite && !isUnedited(yield* fs.readFileString(destination)))
              return yield* fail(
                "conflict",
                `${source.name} was edited after Loom wrote it. Pass overwrite to replace it.`,
              );
          }
        }
      }
      const reference = input.preview ? null : yield* deps.exportReference(input);
      if (reference && reference.sourceHash !== data.metadata.sourceHash)
        return yield* fail(
          "conflict",
          "The board changed while preparing the case. Retry for a consistent revision.",
        );
      const warnings = [
        ...features.warnings,
        "Component boxes are conservative bounds; verify the finished case before fabrication.",
      ];
      let assembly: PcbEnclosureResult["assembly"] = null;
      if (canonical && reference) {
        // Export can take time; check all guards again before replacing any source.
        if (!input.overwrite)
          for (const source of sources) {
            const destination = path.join(canonical, source.name);
            if (yield* fs.exists(destination)) {
              if (
                (yield* fs.realPath(destination)) !== destination ||
                (yield* fs.stat(destination)).type !== "File"
              )
                return yield* fail(
                  "path-outside-workspace",
                  "The case destination is not a regular workspace file.",
                );
              if (!isUnedited(yield* fs.readFileString(destination)))
                return yield* fail(
                  "conflict",
                  `${source.name} was edited after Loom wrote it. Pass overwrite to replace it.`,
                );
            }
          }
        for (const source of sources)
          yield* writeFileStringAtomically({
            filePath: path.join(canonical, source.name),
            contents: source.source,
          });
        const folder = yield* deps.directory(ws.root, path.dirname(assemblyPath)),
          destination = path.join(folder, path.basename(assemblyPath));
        const casePath = path.join(output, "case.scad").split(path.sep).join("/");
        let created = !(yield* fs.exists(destination));
        if (created) {
          const requirements = yield* decodeRequirements({
            wallGapMm: params.sideGapMm,
            lidGapMm: params.topGapMm,
            connectors: params.connectors,
          }).pipe(Effect.mapError(() => fail("invalid-parameters", "Invalid fit requirements.")));
          const doc = yield* decodeAssembly({
            format: "loom-assembly",
            version: 2,
            name: `${stem} enclosure`,
            parts: [
              {
                id: "board",
                name: "Board",
                path: relativePartPath(assemblyPath, reference.relativePath!),
              },
              {
                id: "case",
                name: "Case",
                path: relativePartPath(assemblyPath, casePath),
                parameters: { part: '"base"' },
              },
              {
                id: "lid",
                name: "Lid",
                path: relativePartPath(assemblyPath, casePath),
                parameters: { part: '"lid"' },
                explode: [0, 0, 30],
              },
            ],
            enclosure: { board: "board", parts: ["case", "lid"], requirements },
          }).pipe(Effect.mapError(() => fail("invalid-parameters", "Invalid generated assembly.")));
          created = yield* fs
            .writeFileString(destination, encodeAssembly(doc) + "\n", { flag: "wx" })
            .pipe(
              Effect.as(true),
              Effect.catch((e) =>
                e.reason._tag === "AlreadyExists" ? Effect.succeed(false) : Effect.fail(e),
              ),
            );
        }
        if (!created)
          warnings.push(
            "The board's assembly already exists and was preserved. Add the case or update the board from the 3D panel.",
          );
        assembly = { path: assemblyPath, created };
        yield* deps.refresh(ws.root);
      }
      return {
        reference,
        assembly,
        files: sources.map((s) => ({
          path: path.join(output, s.name).split(path.sep).join("/"),
          language: s.language,
          written: !input.preview,
          source: input.preview ? s.source : null,
        })),
        plan: {
          outerMm: plan.outerMm,
          innerMm: plan.innerMm,
          standoffs: plan.standoffs.length,
          cutouts: plan.cutouts.map((c) => c.reference),
          partsAboveMm: plan.partsAbove,
          partsBelowMm: plan.partsBelow,
        },
        warnings,
      } satisfies PcbEnclosureResult;
    });
  });
