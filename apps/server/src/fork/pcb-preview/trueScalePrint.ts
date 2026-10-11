import {
  PcbPreviewError,
  PcbPrintResult,
  defaultPrintLayers,
  findLayerPreset,
  resolveLayerPreset,
  type PcbBounds,
  type PcbPrintInput,
  type PcbPrintPaper,
  type PcbPrintSide,
  type PcbToolStatus,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Semaphore from "effect/Semaphore";
import * as Option from "effect/Option";
import type * as Duration from "effect/Duration";
import type { PlatformError } from "effect/PlatformError";
import type { ProcessRunOutput } from "../../processRunner.ts";
import { hashKey, SIGNED_FILE_TYPES } from "./cache.ts";
import { parseKicadVersion, processLog } from "./tools.ts";
import { parseSexp, inspectBoard, child, atom } from "./semantics.ts";

const failure = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
const ioFailure = () =>
  failure("io-failed", "The printable PDF could not be created. Check the design and try again.");
const MAX_BOARD_BYTES = 32 * 1024 * 1024;
const PrintMetadata = Schema.Struct(
  Struct.omit(PcbPrintResult.fields, ["file", "workspacePath", "path"]),
);
const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      kind: Schema.Literal("print"),
      result: PrintMetadata,
      createdAt: Schema.String,
    }),
  ),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Ignore unsupported names, without letting layer arguments escape their canonical board table. */
export function validatePrintLayers(requested: readonly string[], boardLayers: readonly string[]) {
  const valid = new Set([...boardLayers, "Edge.Cuts"]);
  const layers = [...new Set(requested)].filter((name) => valid.has(name));
  const missing = [...new Set(requested)].filter((name) => !valid.has(name));
  return {
    layers,
    warnings: missing.length
      ? [`Skipped unavailable layers: ${missing.join(", ").slice(0, 350)}.`]
      : [],
  };
}

/** Offsets let the paper change leave every other byte, including nested paper-like text, intact. */
function boardForms(source: string) {
  const board = parseSexp(source)[0];
  if (!Array.isArray(board) || board[0] !== "kicad_pcb") throw new Error("Invalid KiCad board.");
  let depth = 0,
    start = 0;
  const forms: { name: string; start: number; end: number }[] = [];
  for (const token of source.matchAll(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g)) {
    if (token[0] === "(") {
      depth++;
      if (depth === 2) start = token.index;
    } else if (token[0] === ")") {
      if (depth === 2) {
        const end = token.index + 1;
        const name = /^\(\s*([^\s()]+)/.exec(source.slice(start, end))?.[1] ?? "";
        forms.push({ name, start, end });
      }
      depth--;
    }
  }
  return { board, forms };
}
export function rewritePaper(source: string, paper: PcbPrintPaper) {
  if (paper === "board") return source;
  const { forms } = boardForms(source),
    previous = forms.find((form) => form.name === "paper");
  const replacement = `(paper "${paper}")`;
  if (previous) return source.slice(0, previous.start) + replacement + source.slice(previous.end);
  const after =
    forms.find((form) => form.name === "general")?.end ??
    source.indexOf("kicad_pcb") + "kicad_pcb".length;
  return source.slice(0, after) + `\n  ${replacement}` + source.slice(after);
}
const PAPER_MM = {
  A4: { width: 297, height: 210 },
  USLetter: { width: 279.4, height: 215.9 },
  A3: { width: 420, height: 297 },
  USLedger: { width: 431.8, height: 279.4 },
} as const;
export function boardPageSize(source: string): { width: number; height: number } | null {
  const { board } = boardForms(source),
    form = child(board, "paper"),
    name = atom(form);
  const size =
    name === "User"
      ? { width: Number(atom(form, 2)), height: Number(atom(form, 3)) }
      : Object.hasOwn(PAPER_MM, name)
        ? PAPER_MM[name as keyof typeof PAPER_MM]
        : null;
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  return form.includes("portrait") ? { width: size.height, height: size.width } : size;
}
export function pageWarnings(
  bounds: PcbBounds | null,
  page: { width: number; height: number } | null,
) {
  return bounds &&
    page &&
    (bounds.x < 10 ||
      bounds.y < 10 ||
      bounds.x + bounds.width > page.width - 10 ||
      bounds.y + bounds.height > page.height - 10)
    ? [
        "Part of the board is outside the page. Choose a larger paper, or move the board inside the page frame in KiCad.",
      ]
    : [];
}
const quoted = (text: string) =>
  `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
const mm = (value: number) => Number(value.toFixed(2)).toString();
/** Grammar matches KiCad 9's drawing-sheet serializer. lbcorner offsets are millimetres. */
export function scaleSheet({
  boardMm,
  sideLabel,
}: {
  boardMm: PcbPrintResult["boardMm"];
  sideLabel: string;
}) {
  const text = (value: string, x: number, y: number) =>
    `(tbtext ${quoted(value)} (name "") (pos ${x} ${y} lbcorner) (justify left))`;
  return (
    `(kicad_wks (version 20231118) (generator "pl_editor")\n` +
    `(setup (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15) (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10))\n` +
    `(rect (name "Scale bar") (start 10 10 lbcorner) (end 60 20 lbcorner))\n` +
    Array.from(
      { length: 6 },
      (_, i) =>
        `(line (name "Tick") (start ${10 + i * 10} 10 lbcorner) (end ${10 + i * 10} 13 lbcorner))\n${text(i === 5 ? "50 mm" : String(i * 10), 10 + i * 10, 7)}`,
    ).join("\n") +
    `\n${text("Print at 100%, not Fit to page. This bar must measure 50 mm.", 10, 24)}\n` +
    (boardMm
      ? text(`Board outline ${mm(boardMm.width)} x ${mm(boardMm.height)} mm, ${sideLabel}`, 10, 28)
      : "") +
    "\n)\n"
  );
}
export function printFileName(
  design: string,
  side: PcbPrintSide,
  sourceHash: string,
  revision?: string,
) {
  const stem =
    (design.split(/[\\/]/).at(-1) ?? "board")
      .replace(/\.(?:kicad_(?:pcb|pro|sch)|[cm]?[jt]sx?)$/i, "")
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 130) || "board";
  const rev =
    revision
      ?.trim()
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 40) || sourceHash.slice(0, 8);
  return `${stem}-${side}-${rev}.pdf`;
}
export function printArgs(
  major: number,
  options: {
    output: string;
    board: string;
    sheet: string;
    layers: readonly string[];
    mirrored: boolean;
    blackAndWhite: boolean;
  },
) {
  return [
    "pcb",
    "export",
    "pdf",
    "--output",
    options.output,
    "--layers",
    options.layers.join(","),
    "--mode-single",
    "--drawing-sheet",
    options.sheet,
    "--include-border-title",
    "--drill-shape-opt",
    "2",
    ...(options.mirrored ? ["--mirror"] : []),
    ...(options.blackAndWhite ? ["--black-and-white"] : []),
    ...(major >= 10 ? ["--scale", "1", "--check-zones"] : []),
    options.board,
  ];
}

type ResolvedDesign = {
  projectId: ProjectId;
  root: string;
  workspaceKey: string;
  absolute: string;
  cwd: string;
  design: {
    id: string;
    kind: "kicad" | "tscircuit";
    name: string;
    schematicPath?: string;
    boardPath?: string;
  };
};
type PrintEffect<A> = Effect.Effect<A, PcbPreviewError | PlatformError>;
type PrintDependencies = {
  cacheDir: string;
  resolveDesign: (input: PcbPrintInput) => PrintEffect<ResolvedDesign>;
  sourceSnapshot: (resolved: ResolvedDesign) => PrintEffect<{ sourceHash: string }>;
  safePath: (root: string, relative: string) => PrintEffect<string>;
  requiredTool: (resolved: ResolvedDesign) => PrintEffect<PcbToolStatus>;
  requiredKicadTool: (resolved: ResolvedDesign) => PrintEffect<PcbToolStatus>;
  run: (
    tool: PcbToolStatus,
    args: readonly string[],
    cwd: string,
    timeout: Duration.Input,
    tsci?: boolean,
    temporary?: string,
  ) => PrintEffect<ProcessRunOutput>;
  temporaryCircuitCwd: (resolved: ResolvedDesign, directory: string) => PrintEffect<string>;
  signCacheFile: (file: string) => PrintEffect<PcbPrintResult["file"]>;
  ensureWorkspaceDirectory: (root: string, relative: string) => PrintEffect<string>;
  refreshEntries: (root: string) => Effect.Effect<unknown, PlatformError | PcbPreviewError>;
  prune: () => PrintEffect<unknown>;
};

/** Construction captures host services; the operation is shared by RPC, MCP and the CLI. */
export const makeTrueScalePrint = Effect.fn("PcbPreview.makeTrueScalePrint")(function* (
  deps: PrintDependencies,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    lock = yield* Semaphore.make(1);
  const validPdf = Effect.fn("PcbPreview.validPrintPdf")(function* (file: string) {
    const info = yield* fs.stat(file);
    if (
      info.type !== "File" ||
      Number(info.size) < 5 ||
      Number(info.size) > SIGNED_FILE_TYPES["print.pdf"].maxBytes ||
      (yield* fs.realPath(file)) !== file
    )
      return false;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fs.open(file, { flag: "r" }),
          head = yield* handle.readAlloc(5);
        return Option.isSome(head) && new TextDecoder().decode(head.value) === "%PDF-";
      }),
    );
  });
  const print = Effect.fn("PcbPreview.print")(function* (input: PcbPrintInput) {
    const resolved = yield* deps.resolveDesign(input);
    if (resolved.design.kind === "kicad" && !resolved.design.boardPath)
      return yield* failure("unsupported-view", "This design has no board.");
    const tool = yield* deps.requiredKicadTool(resolved),
      major = parseKicadVersion(tool.version ?? "")?.major;
    if (tool.problem === "tool-too-old" || (major !== undefined && major < 9))
      return yield* failure(
        "tool-too-old",
        "KiCad 9 or newer is needed to create a printable PDF.",
      );
    if (!tool.found || tool.problem || !major)
      return yield* failure(
        "tool-missing",
        "Install KiCad 9 or newer on this environment to create a printable PDF.",
      );
    const snapshot = yield* deps.sourceSnapshot(resolved),
      mirrored = input.mirror ?? input.side === "bottom";
    const requestKey = hashKey(
      resolved.workspaceKey,
      input.designId,
      snapshot.sourceHash,
      "print-v1",
      input.side,
      encodeJson(input.layers ?? []),
      String(mirrored),
      input.paper,
      String(input.blackAndWhite),
      tool.version ?? "",
    );
    const directory = path.join(deps.cacheDir, requestKey),
      pdf = path.join(directory, "print.pdf"),
      manifest = path.join(directory, "manifest.json");
    let result: typeof PrintMetadata.Type | null = null;
    if ((yield* fs.exists(manifest)) && Number((yield* fs.stat(manifest)).size) <= 128 * 1024) {
      const saved = yield* fs.readFileString(manifest).pipe(
        Effect.flatMap(decodeManifest),
        Effect.orElseSucceed(() => null),
      );
      if (
        saved &&
        saved.result.sourceHash === snapshot.sourceHash &&
        (yield* validPdf(pdf).pipe(Effect.orElseSucceed(() => false)))
      )
        result = saved.result;
    }
    if (!result) {
      result = yield* Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempDirectoryScoped({
              directory: deps.cacheDir,
              prefix: "pending-print-",
            }),
            board = path.join(temporary, "board.kicad_pcb"),
            sheet = path.join(temporary, "scale.kicad_wks"),
            output = path.join(temporary, "print.pdf");
          let log = "";
          if (resolved.design.kind === "kicad") {
            const original = yield* deps.safePath(resolved.root, resolved.design.boardPath!);
            if (Number((yield* fs.stat(original)).size) > MAX_BOARD_BYTES)
              return yield* failure(
                "source-limit",
                "This board is too large to prepare a printable PDF.",
              );
            yield* fs.copyFile(original, board);
            const project = original.replace(/\.kicad_pcb$/i, ".kicad_pro");
            if (yield* fs.exists(project)) {
              const relative = path.relative(resolved.root, project).split(path.sep).join("/");
              yield* fs.copyFile(
                yield* deps.safePath(resolved.root, relative),
                path.join(temporary, "board.kicad_pro"),
              );
            }
          } else {
            const circuit = yield* deps.requiredTool(resolved),
              cwd = yield* deps.temporaryCircuitCwd(resolved, temporary);
            const exported = yield* deps.run(
              circuit,
              [
                "export",
                path.join(cwd, path.relative(resolved.cwd, resolved.absolute)),
                "-f",
                "kicad_pcb",
                "-o",
                board,
              ],
              cwd,
              "180 seconds",
              true,
              temporary,
            );
            log = processLog(exported);
            if (exported.timedOut || exported.code !== 0)
              return yield* new PcbPreviewError({
                reason: "io-failed",
                message: `The circuit could not be exported for printing. ${log.slice(-2000)}`,
                ...(exported.code !== null ? { exitCode: exported.code } : {}),
                timedOut: exported.timedOut,
              });
          }
          if (
            Number((yield* fs.stat(board)).size) > MAX_BOARD_BYTES ||
            (yield* fs.realPath(board)) !== board
          )
            return yield* failure(
              "source-limit",
              "This board is too large to prepare a printable PDF.",
            );
          const source = yield* fs.readFileString(board),
            prepared = yield* Effect.try({
              try: () => ({
                text: rewritePaper(source, input.paper),
                inspection: inspectBoard(source, snapshot.sourceHash),
                board: boardForms(source).board,
              }),
              catch: () => ioFailure(),
            });
          const preset = typeof input.layers === "string" ? findLayerPreset(input.layers) : null;
          const presetLayers = preset
            ? resolveLayerPreset(preset, prepared.inspection.layers)
            : null;
          if (typeof input.layers === "string" && !presetLayers)
            return yield* failure(
              "unsupported-view",
              "That layer preset has no printable layers on this board.",
            );
          const requested =
            typeof input.layers === "string"
              ? presetLayers!.filter((layer) => layer.visible).map((layer) => layer.name)
              : input.layers?.length
                ? input.layers
                : defaultPrintLayers(input.side);
          const validated = validatePrintLayers(requested, prepared.inspection.layers);
          if (!validated.layers.length)
            return yield* failure(
              "unsupported-view",
              "None of the chosen layers exist on this board.",
            );
          const bounds = prepared.inspection.bounds,
            boardMm = bounds ? { width: bounds.width, height: bounds.height } : null;
          const warnings = [
            ...validated.warnings,
            ...pageWarnings(bounds, boardPageSize(prepared.text)),
            ...(major === 9 ? ["Zones are printed as last filled in KiCad."] : []),
          ];
          yield* fs.writeFileString(board, prepared.text);
          yield* fs.writeFileString(
            sheet,
            scaleSheet({
              boardMm,
              sideLabel:
                input.side === "top"
                  ? mirrored
                    ? "top, mirrored"
                    : "top, viewed from the top"
                  : mirrored
                    ? "bottom, mirrored"
                    : "bottom, viewed from the top",
            }),
          );
          const plotted = yield* deps.run(
            tool,
            printArgs(major, {
              board,
              sheet,
              output,
              layers: validated.layers,
              mirrored,
              blackAndWhite: input.blackAndWhite,
            }),
            temporary,
            "120 seconds",
          );
          log = [log, processLog(plotted)].filter(Boolean).join("\n").slice(-8192);
          if (plotted.timedOut || plotted.code !== 0)
            return yield* new PcbPreviewError({
              reason: "io-failed",
              message: `KiCad could not create the printable PDF. ${log.slice(-2000)}`,
              ...(plotted.code !== null ? { exitCode: plotted.code } : {}),
              timedOut: plotted.timedOut,
            });
          if (!(yield* validPdf(output)))
            return yield* failure("io-failed", "KiCad did not create a valid printable PDF.");
          if ((yield* deps.sourceSnapshot(resolved)).sourceHash !== snapshot.sourceHash)
            return yield* failure(
              "conflict",
              "The board changed while creating its PDF. Try again for the current revision.",
            );
          const ready = path.join(temporary, "ready");
          yield* fs.makeDirectory(ready);
          yield* fs.rename(output, path.join(ready, "print.pdf"));
          const metadata: typeof PrintMetadata.Type = {
            fileName: printFileName(
              resolved.design.name,
              input.side,
              snapshot.sourceHash,
              atom(child(child(prepared.board, "title_block"), "rev")),
            ),
            sourceHash: snapshot.sourceHash,
            side: input.side,
            layers: validated.layers,
            mirrored,
            paper: input.paper,
            boardMm,
            warnings,
            ...(tool.version ? { toolVersion: tool.version } : {}),
            log,
          };
          yield* fs.writeFileString(
            path.join(ready, "manifest.json"),
            encodeJson({
              kind: "print",
              result: metadata,
              createdAt: DateTime.formatIso(yield* DateTime.now),
            }),
          );
          if (yield* fs.exists(directory)) yield* fs.remove(directory, { recursive: true });
          yield* fs.rename(ready, directory);
          return metadata;
        }),
      );
    }
    let saved: Pick<PcbPrintResult, "workspacePath" | "path"> = {};
    if (input.save) {
      const destination = yield* deps.ensureWorkspaceDirectory(
          resolved.root,
          path.join("fab", "print"),
        ),
        target = path.join(destination, result.fileName);
      if (
        (yield* fs.exists(target)) &&
        ((yield* fs.realPath(target)) !== target || (yield* fs.stat(target)).type !== "File")
      )
        return yield* failure(
          "path-outside-workspace",
          "The PDF destination is not a regular workspace file.",
        );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempDirectoryScoped({
              directory: destination,
              prefix: "pending-print-",
            }),
            staged = path.join(temporary, result.fileName);
          yield* fs.copyFile(pdf, staged);
          yield* fs.rename(staged, target);
        }),
      );
      yield* deps.refreshEntries(resolved.root);
      saved = {
        workspacePath: path.relative(resolved.root, target).split(path.sep).join("/"),
        path: target,
      };
    }
    const file = yield* deps.signCacheFile(pdf);
    yield* deps.prune();
    return { ...result, ...saved, file };
  });
  return (input: PcbPrintInput) =>
    lock
      .withPermit(print(input))
      .pipe(Effect.catchTags({ PlatformError: () => Effect.fail(ioFailure()) }));
});
