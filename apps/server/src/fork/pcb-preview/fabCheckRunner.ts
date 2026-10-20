import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type * as Duration from "effect/Duration";
import type * as Semaphore from "effect/Semaphore";
import {
  PcbPreviewError,
  PcbFabCheckResult,
  type PcbFabCheckInput,
  type PcbFabCatalog,
  type PcbToolStatus,
} from "@t3tools/contracts/fork";
import type { ProcessRunOutput } from "../../processRunner.ts";
import { hashKey } from "./cache.ts";
import { boardStats } from "./boardStats.ts";
import { inspectBoard } from "./semantics.ts";
import { parseKicadReport } from "./kicadReports.ts";
import { parseKicadVersion, processLog } from "./tools.ts";
import {
  fabRules,
  rulesFile,
  clearBoardMinimums,
  classifyViolations,
  boardFacts,
  boardFindings,
  costDrivers,
} from "./fabCheck.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
type FabDesign = {
  root: string;
  workspaceKey: string;
  cwd: string;
  design: { id: string; kind: "kicad" | "tscircuit"; boardPath?: string | undefined };
};
const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(PcbFabCheckResult));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
/** The temporary board, project and rules are scoped; interruption never leaves user outputs. */
export const makeFabChecks = Effect.fn("PcbPreview.makeFabChecks")(function* <D extends FabDesign>(
  config: { checksDir: string; cacheLock: Semaphore.Semaphore },
  deps: {
    resolve: (input: PcbFabCheckInput) => Effect.Effect<D, PcbPreviewError>;
    snapshot: (d: D) => Effect.Effect<{ sourceHash: string }, PcbPreviewError>;
    tool: (d: D) => Effect.Effect<PcbToolStatus, PcbPreviewError>;
    catalog: Effect.Effect<PcbFabCatalog, PcbPreviewError>;
    safePath: (root: string, relative: string) => Effect.Effect<string, PcbPreviewError>;
    run: (
      tool: PcbToolStatus,
      args: readonly string[],
      cwd: string,
      timeout: Duration.Input,
    ) => Effect.Effect<ProcessRunOutput, PcbPreviewError>;
    prune: Effect.Effect<void, PcbPreviewError>;
  },
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const file = (d: D, id: string) =>
    path.join(config.checksDir, hashKey(d.workspaceKey, d.design.id, "fab", id) + ".json");
  const read = Effect.fn("PcbPreview.readFabCheck")(function* (d: D, id: string) {
    return yield* Effect.gen(function* () {
      const destination = file(d, id);
      if (
        !(yield* fs.exists(destination)) ||
        Number((yield* fs.stat(destination)).size) > 4 * 1024 * 1024
      )
        return null;
      return yield* decodeResult(yield* fs.readFileString(destination));
    }).pipe(Effect.orElseSucceed(() => null));
  });
  const latest = Effect.fn("PcbPreview.latestFabCheck")(function* (input: PcbFabCheckInput) {
    const d = yield* deps.resolve(input),
      catalog = yield* deps.catalog;
    return yield* read(d, input.fabId ?? catalog.defaultId);
  });
  const run = Effect.fn("PcbPreview.fabCheck")(function* (input: PcbFabCheckInput) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const d = yield* deps.resolve(input);
        if (d.design.kind !== "kicad" || !d.design.boardPath)
          return yield* new PcbPreviewError({
            reason: "unsupported-view",
            message: "Fab checks need a KiCad board.",
          });
        const catalog = yield* deps.catalog,
          id = input.fabId ?? catalog.defaultId,
          capability = [...catalog.builtIns, ...catalog.entries].find((f) => f.id === id);
        if (!capability)
          return yield* new PcbPreviewError({
            reason: "invalid-parameters",
            message: "Unknown fab. Reload the fab list.",
          });
        const tool = yield* deps.tool(d),
          snapshot = yield* deps.snapshot(d),
          original = yield* deps.safePath(d.root, d.design.boardPath);
        const board = yield* fs.readFileString(original);
        if (board.length > 32 * 1024 * 1024)
          return yield* new PcbPreviewError({
            reason: "source-limit",
            message: "The board exceeds the fabrication check size limit.",
          });
        const temporary = yield* fs.makeTempDirectoryScoped({
          directory: config.checksDir,
          prefix: "pending-fab-",
        });
        const stem = path.basename(original, ".kicad_pcb"),
          copy = path.join(temporary, stem + ".kicad_pcb");
        yield* fs.writeFileString(copy, board);
        const companion = Effect.fn("PcbPreview.fabCompanion")(function* (suffix: string) {
          const relative = d.design.boardPath!.replace(/\.kicad_pcb$/, suffix);
          if (!(yield* fs.exists(path.join(d.root, relative)))) return null;
          const source = yield* deps.safePath(d.root, relative);
          if (Number((yield* fs.stat(source)).size) > 16 * 1024 * 1024)
            return yield* new PcbPreviewError({
              reason: "source-limit",
              message: "The board companion exceeds the fabrication check size limit.",
            });
          return yield* fs.readFileString(source);
        });
        const project = yield* companion(".kicad_pro"),
          userRules = yield* companion(".kicad_dru");
        const cleared = project === null ? null : clearBoardMinimums(project);
        if (cleared !== null)
          yield* fs.writeFileString(path.join(temporary, stem + ".kicad_pro"), cleared);
        yield* fs.writeFileString(
          path.join(temporary, stem + ".kicad_dru"),
          rulesFile(userRules, capability),
        );
        const zonesRefilled = (parseKicadVersion(tool.version ?? "")?.major ?? 9) >= 10,
          report = path.join(temporary, "report.json");
        const output = yield* deps.run(
          tool,
          [
            "pcb",
            "drc",
            "--format",
            "json",
            "--severity-all",
            "--units",
            "mm",
            "--exit-code-violations",
            "--output",
            report,
            ...(zonesRefilled ? ["--refill-zones"] : []),
            copy,
          ],
          temporary,
          "180 seconds",
        );
        let result: PcbFabCheckResult = {
          fabId: id,
          capability,
          sourceHash: snapshot.sourceHash,
          outcome: output.timedOut ? "timed-out" : "failed",
          counts: { errors: 0, warnings: 0, excluded: 0 },
          violations: [],
          truncated: false,
          boardFindings: [],
          notChecked: fabRules(capability).notChecked,
          alsoInDrc: 0,
          facts: null,
          costDrivers: [],
          zonesRefilled,
          ...(tool.version ? { kicadVersion: tool.version } : {}),
          ...(output.code !== null ? { exitCode: output.code } : {}),
          log: processLog(output),
          ranAt: DateTime.formatIso(yield* DateTime.now),
        };
        if (!output.timedOut && (output.code === 0 || output.code === 5)) {
          if (
            !(yield* fs.exists(report)) ||
            Number((yield* fs.stat(report)).size) > 16 * 1024 * 1024
          )
            return yield* new PcbPreviewError({
              reason: "invalid-report",
              message: "KiCad's fabrication report is missing or too large.",
            });
          const source = yield* fs.readFileString(report);
          const parsed = yield* Effect.try({
            try: () => parseKicadReport(decodeJson(source), "drc"),
            catch: () =>
              new PcbPreviewError({
                reason: "invalid-report",
                message: "KiCad produced an invalid fabrication report.",
              }),
          });
          const facts = yield* Effect.try({
            try: () =>
              boardFacts(
                board,
                boardStats({
                  kind: "kicad",
                  board,
                  project,
                  inspection: inspectBoard(board, snapshot.sourceHash),
                  glb: null,
                }),
              ),
            catch: () =>
              new PcbPreviewError({
                reason: "invalid-report",
                message: "The board facts could not be read.",
              }),
          });
          const classified = classifyViolations(parsed, capability),
            boardIssues = boardFindings(facts, capability);
          result = {
            ...result,
            ...classified,
            boardFindings: boardIssues,
            facts,
            costDrivers: costDrivers(facts, capability),
            outcome:
              classified.counts.errors + classified.counts.warnings > 0 ||
              boardIssues.some((f) => f.severity === "error")
                ? "violations"
                : "clean",
          };
        }
        yield* config.cacheLock.withPermit(
          Effect.gen(function* () {
            const previous = yield* read(d, id);
            if (!previous || previous.ranAt <= result.ranAt)
              yield* writeFileStringAtomically({
                filePath: file(d, id),
                contents: encodeJson(result),
              });
          }),
        );
        yield* deps.prune;
        return result;
      }),
    );
  });
  return { run, latest };
});
