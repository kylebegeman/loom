import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Deferred from "effect/Deferred";
import type * as Scope from "effect/Scope";
import * as Fiber from "effect/Fiber";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { PcbPreviewError, type PcbPrintInput } from "@t3tools/contracts/fork";
import type { ProcessRunOutput } from "../../processRunner.ts";
import { parseSexp } from "./semantics.ts";
import {
  makeTrueScalePrint,
  rewritePaper,
  scaleSheet,
  validatePrintLayers,
  pageWarnings,
  printFileName,
  printArgs,
  boardPageSize,
} from "./trueScalePrint.ts";

const source = `(kicad_pcb (version 20241229) (generator "pcbnew")\n  (general (thickness 1.6))\n  (paper "A3" portrait)\n  (title_block (rev "R1"))\n  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user) (36 "B.SilkS" user) (44 "Edge.Cuts" user))\n  (gr_rect (start 30 30) (end 80 50) (layer "Edge.Cuts") (width 0.05))\n  (property "Literal" "(paper \\"User\\")"))`;
const output = (code = 0, timedOut = false): ProcessRunOutput => ({
  code: code as ProcessRunOutput["code"],
  stdout: "plot output",
  stderr: "",
  timedOut,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const input: PcbPrintInput = {
  threadId: ThreadId.make("print-thread"),
  designId: "board.kicad_pcb",
  side: "top",
  paper: "A4",
  blackAndWhite: true,
  save: false,
};
it("rewrites only the top-level paper bytes and inserts a missing paper after general", () => {
  expect(rewritePaper(source, "USLetter")).toBe(
    source.replace('(paper "A3" portrait)', '(paper "USLetter")'),
  );
  expect(rewritePaper(source, "board")).toBe(source);
  const noPaper = source.replace('(paper "A3" portrait)', "");
  expect(rewritePaper(noPaper, "A4")).toBe(
    noPaper.replace("(general (thickness 1.6))", '(general (thickness 1.6))\n  (paper "A4")'),
  );
});
it("builds a metric scale sheet and truthful outline/side text", () => {
  const sheet = scaleSheet({
    boardMm: { width: 48.26, height: 33.02 },
    sideLabel: "bottom, mirrored",
  });
  expect(sheet).toContain("(start 10 10 lbcorner) (end 60 20 lbcorner)");
  expect(sheet).toContain("Board outline 48.26 x 33.02 mm, bottom, mirrored");
  expect(sheet).toContain("This bar must measure 50 mm.");
  expect(parseSexp(sheet)[0]).toBeInstanceOf(Array);
  expect(scaleSheet({ boardMm: null, sideLabel: "top" })).not.toContain("Board outline");
});
it("filters layers, preserves order, and detects off-page coordinates and portrait pages", () => {
  expect(validatePrintLayers(["F.Cu", "F.Cu", "bad", "Edge.Cuts"], ["F.Cu"]).layers).toEqual([
    "F.Cu",
    "Edge.Cuts",
  ]);
  expect(validatePrintLayers(["bad"], ["F.Cu"]).warnings).toEqual([
    "Skipped unavailable layers: bad.",
  ]);
  expect(boardPageSize(source)).toEqual({ width: 297, height: 420 });
  expect(boardPageSize('(kicad_pcb (paper "User" 123 234))')).toEqual({ width: 123, height: 234 });
  expect(
    pageWarnings({ x: 260, y: 20, width: 50, height: 20 }, { width: 297, height: 210 }),
  ).toHaveLength(1);
  expect(
    pageWarnings({ x: 10, y: 10, width: 50, height: 20 }, { width: 297, height: 210 }),
  ).toEqual([]);
  expect(pageWarnings(null, null)).toEqual([]);
});
it("sanitizes filenames and keeps KiCad 9 free of KiCad 10 flags", () => {
  expect(printFileName("../../control.kicad_pcb", "bottom", "a".repeat(64), "../R 2")).toBe(
    "control-bottom--R-2.pdf",
  );
  const options = {
    output: "/tmp/print.pdf",
    board: "/tmp/board.kicad_pcb",
    sheet: "/tmp/scale.kicad_wks",
    layers: ["B.Cu", "Edge.Cuts"],
    mirrored: true,
    blackAndWhite: true,
  };
  const nine = printArgs(9, options),
    ten = printArgs(10, options);
  expect(nine).toContain("--mode-single");
  expect(nine).toContain("--mirror");
  expect(nine).toContain("--black-and-white");
  expect(nine).not.toContain("--scale");
  expect(nine).not.toContain("--check-zones");
  expect(ten).toContain("--check-zones");
  expect(ten[ten.indexOf("--scale") + 1]).toBe("1");
});

type TestDesign = { id: string; kind: "kicad" | "tscircuit"; name: string; boardPath?: string };
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-print-test-" }),
    cacheDir = path.join(root, "cache"),
    board = path.join(root, "board.kicad_pcb"),
    project = path.join(root, "board.kicad_pro");
  yield* fs.makeDirectory(cacheDir);
  yield* fs.writeFileString(board, source);
  yield* fs.writeFileString(project, '{"text_variables":{"Author":"Kyle"}}');
  let version = "10.0.6",
    code = 0,
    timedOut = false,
    sourceHash = "a".repeat(64),
    validPdf = true,
    block: Deferred.Deferred<void> | null = null;
  let design: TestDesign = {
    id: input.designId,
    kind: "kicad",
    name: "board",
    boardPath: "board.kicad_pcb",
  };
  const calls: {
    args: readonly string[];
    cwd: string;
    board?: string;
    sheet?: string;
    project?: string;
    temporary?: string;
  }[] = [];
  const started = yield* Deferred.make<void>();
  const getResolved = () => ({
    root,
    workspaceKey: "workspace",
    projectId: ProjectId.make("project"),
    absolute: board,
    cwd: root,
    design,
  });
  const print = yield* makeTrueScalePrint({
    cacheDir,
    resolveDesign: () => Effect.succeed(getResolved()),
    sourceSnapshot: () => Effect.sync(() => ({ sourceHash })),
    safePath: (ws, relative) => fs.realPath(path.join(ws, relative)),
    requiredKicadTool: () => Effect.succeed({ found: true, path: "/mock/kicad-cli", version }),
    requiredTool: () => Effect.succeed({ found: true, path: "/mock/tsci", version: "1.0.0" }),
    temporaryCircuitCwd: (_resolved, directory) =>
      fs
        .makeDirectory(path.join(directory, "workspace"))
        .pipe(Effect.as(path.join(directory, "workspace"))),
    run: (_tool, args, cwd, _timeout, _tsci, temporary) =>
      Effect.gen(function* () {
        const call = {
          args,
          cwd,
          ...(temporary !== undefined ? { temporary } : {}),
          ...(args[0] === "pcb"
            ? {
                board: yield* fs.readFileString(args.at(-1)!),
                sheet: yield* fs.readFileString(args[args.indexOf("--drawing-sheet") + 1]!),
                project: yield* fs
                  .readFileString(path.join(cwd, "board.kicad_pro"))
                  .pipe(Effect.orElseSucceed(() => "")),
              }
            : {}),
        };
        calls.push(call);
        yield* Deferred.succeed(started, undefined);
        if (block) yield* Deferred.await(block);
        if (code === 0 && !timedOut)
          yield* fs.writeFileString(
            args[args.indexOf(args[0] === "pcb" ? "--output" : "-o") + 1]!,
            args[0] === "pcb" ? (validPdf ? "%PDF-1.7\nmock PDF" : "invalid") : source,
          );
        return output(code, timedOut);
      }),
    signCacheFile: (file) =>
      fs.stat(file).pipe(
        Effect.map((stat) => ({
          relativeUrl: `/api/loom/pcb-preview/f/token/${path.basename(file)}`,
          expiresAt: 123456789,
          sizeBytes: Number(stat.size),
          modifiedAt: "2026-10-10T00:00:00.000Z",
          revision: path.basename(path.dirname(file)),
        })),
      ),
    ensureWorkspaceDirectory: (ws, relative) =>
      fs
        .makeDirectory(path.join(ws, relative), { recursive: true })
        .pipe(Effect.as(path.join(ws, relative))),
    refreshEntries: () => Effect.void,
    prune: () => Effect.void,
  });
  return {
    fs,
    path,
    root,
    cacheDir,
    board,
    project,
    calls,
    print,
    started,
    setVersion: (v: string) => {
      version = v;
    },
    setFailure: (v: number, timeout = false) => {
      code = v;
      timedOut = timeout;
    },
    setValidPdf: (v: boolean) => {
      validPdf = v;
    },
    setBlock: (v: Deferred.Deferred<void>) => {
      block = v;
    },
    setDesign: (v: TestDesign) => {
      design = v;
    },
    design,
    setHash: (v: string) => {
      sourceHash = v;
    },
  };
});
const provide = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) => effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));
it.effect(
  "creates and reuses a PDF, saves atomically, and leaves both source files unchanged",
  () =>
    provide(
      Effect.gen(function* () {
        const env = yield* setup,
          first = yield* env.print(input),
          saved = yield* env.print({ ...input, save: true });
        expect(env.calls).toHaveLength(1);
        expect(first.layers).toEqual(["F.Cu", "F.Silkscreen", "Edge.Cuts"]);
        expect(first.warnings[0]).toContain("F.Courtyard");
        expect(first.boardMm).toEqual({ width: 50, height: 20 });
        expect(first.file.relativeUrl).toContain("print.pdf");
        expect(saved.workspacePath).toBe("fab/print/board-top-R1.pdf");
        expect(yield* env.fs.readFileString(saved.path!)).toContain("%PDF-");
        expect(yield* env.fs.readFileString(env.board)).toBe(source);
        expect(yield* env.fs.readFileString(env.project)).toContain('"Author":"Kyle"');
        expect(env.calls[0]?.board).toContain('(paper "A4")');
        expect(env.calls[0]?.project).toContain('"Author":"Kyle"');
        expect(yield* env.fs.readDirectory(env.cacheDir)).toEqual([saved.file.revision]);
      }),
    ),
);
it.effect("mirrors the bottom, supports presets, and warns about unrefilled KiCad 9 zones", () =>
  provide(
    Effect.gen(function* () {
      const env = yield* setup;
      env.setVersion("9.0.9");
      const result = yield* env.print({ ...input, side: "bottom", layers: "assembly-back" });
      expect(result.mirrored).toBe(true);
      expect(result.layers).toEqual(["B.Silkscreen", "Edge.Cuts"]);
      expect(result.warnings).toContain("Zones are printed as last filled in KiCad.");
      expect(env.calls[0]?.args).not.toContain("--check-zones");
      expect(env.calls[0]?.sheet).toContain("bottom, mirrored");
    }),
  ),
);
it.effect("runs circuit export in staging before KiCad and preserves its source", () =>
  provide(
    Effect.gen(function* () {
      const env = yield* setup;
      env.setDesign({ id: env.design.id, kind: "tscircuit", name: "circuit" });
      yield* env.print(input);
      expect(env.calls).toHaveLength(2);
      expect(env.calls[0]?.args).toContain("kicad_pcb");
      expect(env.calls[0]?.cwd).toContain("pending-print-");
      expect(env.calls[0]?.temporary).toBeTruthy();
      expect(env.calls[1]?.args[0]).toBe("pcb");
      expect(yield* env.fs.readFileString(env.board)).toBe(source);
    }),
  ),
);
it.effect("cleans temporary files after tool failure and rejects invalid PDFs", () =>
  provide(
    Effect.gen(function* () {
      const env = yield* setup;
      env.setFailure(2, true);
      const failure = yield* Effect.flip(env.print(input));
      expect(failure).toBeInstanceOf(PcbPreviewError);
      expect(failure.reason).toBe("io-failed");
      expect(failure.timedOut).toBe(true);
      expect(yield* env.fs.readDirectory(env.cacheDir)).toEqual([]);
      env.setFailure(0);
      env.setValidPdf(false);
      expect((yield* Effect.flip(env.print(input))).reason).toBe("io-failed");
      expect(yield* env.fs.readDirectory(env.cacheDir)).toEqual([]);
    }),
  ),
);
it.effect("cancellation removes staging and publishes no PDF", () =>
  provide(
    Effect.gen(function* () {
      const env = yield* setup,
        blocked = yield* Deferred.make<void>();
      env.setBlock(blocked);
      const fiber = yield* env.print(input).pipe(Effect.forkChild);
      yield* Deferred.await(env.started);
      yield* Fiber.interrupt(fiber);
      expect(yield* env.fs.readDirectory(env.cacheDir)).toEqual([]);
      expect(yield* env.fs.exists(env.path.join(env.root, "fab"))).toBe(false);
    }),
  ),
);
it.effect("rejects missing boards, unknown layers, and saved-file symlinks", () =>
  provide(
    Effect.gen(function* () {
      const env = yield* setup;
      env.setDesign({ id: env.design.id, kind: "kicad", name: env.design.name });
      expect((yield* Effect.flip(env.print(input))).reason).toBe("unsupported-view");
      env.setDesign(env.design);
      expect((yield* Effect.flip(env.print({ ...input, layers: ["Missing.Layer"] }))).reason).toBe(
        "unsupported-view",
      );
      const result = yield* env.print(input),
        folder = env.path.join(env.root, "fab", "print");
      yield* env.fs.makeDirectory(folder, { recursive: true });
      yield* env.fs.symlink(env.board, env.path.join(folder, result.fileName));
      expect((yield* Effect.flip(env.print({ ...input, save: true }))).reason).toBe(
        "path-outside-workspace",
      );
      expect(yield* env.fs.readFileString(env.board)).toBe(source);
    }),
  ),
);
