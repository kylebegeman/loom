// @effect-diagnostics nodeBuiltinImport:off -- Crypto identities belong to the environment adapter.
import {
  PcbPreviewError,
  PcbRenderResult,
  PcbCheckResult,
  type PcbPreviewStatus,
  type PcbListDesignsInput,
  type PcbListDesignsResult,
  type PcbRenderInput,
  type PcbReadSheetInput,
  type PcbReadSheetResult,
  type PcbCheckInput,
  type PcbLatestChecksInput,
  type PcbLatestChecksResult,
  type PcbWatchInput,
  type PcbWatchEvent,
  type PcbToolStatus,
  type PcbDesign,
} from "@t3tools/contracts/fork";
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as Fiber from "effect/Fiber";
import { mintToken, verifyToken, resolveTokenPath } from "../model-preview-3d/signedFiles.ts";
import { makeSharedJobs } from "../sharedJobs.ts";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import type * as Duration from "effect/Duration";
import type { PlatformError } from "effect/PlatformError";
import * as DateTime from "effect/DateTime";
import * as NodeCrypto from "node:crypto";
import * as W from "@t3tools/contracts/fork";
import {
  emptyInspection,
  inspectBoard,
  inspectSchematic,
  mergeNetlist,
  inspectCircuitJson,
  compareInspections,
  parseSexp,
  children,
  child,
  atom,
} from "./semantics.ts";
import { ParameterFile, readCircuitParameterValues, applyCircuitParameters } from "./authoring.ts";
import { simulationNetlist, parseSpiceRaw } from "./simulation.ts";
import { cropPhysicalSvg, normalizeCircuitSvg } from "./svg.ts";
import { starterHardware } from "./hardware.ts";
import { normalizeCircuitGlb } from "./glb.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import { ServerConfig } from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { makeEditorBridge } from "../editorBridge.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { groupDesigns, innerCopperLayers, DESIGN_SUFFIXES } from "./discovery.ts";
import {
  hashKey,
  renderKey,
  isRenderKey,
  isSheetFileName,
  pickPruneVictims,
  MAX_SVG_BYTES,
  CACHE_LIMITS,
  CHECK_LIMITS,
} from "./cache.ts";
import { parseKicadReport } from "./kicadReports.ts";
import { parseKicadVersion, parseTsciVersion, circuitEnvironment, processLog } from "./tools.ts";

const CIRCUIT_VERSION_TIMEOUT = "15 seconds";

export class PcbPreviewService extends Context.Service<
  PcbPreviewService,
  {
    readonly reuseHardware: (
      input: typeof W.PcbReuseHardwareInput.Type,
    ) => Effect.Effect<typeof W.PcbReuseHardwareResult.Type, PcbPreviewError>;
    readonly inspect: (input: W.PcbInspectInput) => Effect.Effect<W.PcbInspection, PcbPreviewError>;
    readonly getWorkspace: (
      input: W.PcbInspectInput,
    ) => Effect.Effect<W.PcbWorkspace, PcbPreviewError>;
    readonly updateWorkspace: (
      input: W.PcbWorkspaceUpdate,
    ) => Effect.Effect<W.PcbWorkspace, PcbPreviewError>;
    readonly resolveSignedRequest: (
      token: string,
      relative: string,
    ) => Effect.Effect<string, PcbPreviewError>;
    readonly asset: (input: W.PcbAssetInput) => Effect.Effect<W.PcbAsset, PcbPreviewError>;
    readonly compare: (input: W.PcbCompareInput) => Effect.Effect<W.PcbComparison, PcbPreviewError>;
    readonly revisions: (
      input: W.PcbInspectInput,
    ) => Effect.Effect<typeof W.PcbRevisions.Type, PcbPreviewError>;
    readonly parameters: (
      input: W.PcbInspectInput,
    ) => Effect.Effect<W.PcbParameters, PcbPreviewError>;
    readonly applyParameters: (
      input: W.PcbApplyParametersInput,
    ) => Effect.Effect<W.PcbApplyParametersResult, PcbPreviewError>;
    readonly simulate: (
      input: W.PcbSimulateInput,
    ) => Effect.Effect<W.PcbSimulationResult, PcbPreviewError>;
    readonly library: () => Effect.Effect<W.PcbHardwareLibrary, PcbPreviewError>;
    readonly updateLibrary: (
      input: W.PcbLibraryUpdate,
    ) => Effect.Effect<W.PcbHardwareLibrary, PcbPreviewError>;
    readonly workspaceUpdates: (
      input: W.PcbInspectInput,
    ) => Stream.Stream<W.PcbWorkspace, PcbPreviewError>;
    readonly exportReference: (
      input: W.PcbReferenceInput,
    ) => Effect.Effect<W.PcbReferenceResult, PcbPreviewError>;
    readonly panelEvents: (threadId: ThreadId) => Stream.Stream<W.PcbEditorEvent, PcbPreviewError>;
    readonly editorEvents: (
      input: W.PcbInspectInput,
    ) => Stream.Stream<W.PcbEditorEvent, PcbPreviewError>;
    readonly editorAction: (
      input: W.PcbEditorInput,
    ) => Effect.Effect<W.PcbEditorResult, PcbPreviewError>;
    readonly completeEditorAction: (
      input: W.PcbCompleteEditorInput,
    ) => Effect.Effect<W.PcbEditorResult, PcbPreviewError>;
    readonly status: () => Effect.Effect<PcbPreviewStatus, PcbPreviewError>;
    readonly listDesigns: (
      input: PcbListDesignsInput,
    ) => Effect.Effect<PcbListDesignsResult, PcbPreviewError>;
    readonly render: (input: PcbRenderInput) => Effect.Effect<PcbRenderResult, PcbPreviewError>;
    readonly readSheet: (
      input: PcbReadSheetInput,
    ) => Effect.Effect<PcbReadSheetResult, PcbPreviewError>;
    readonly check: (input: PcbCheckInput) => Effect.Effect<PcbCheckResult, PcbPreviewError>;
    readonly latestChecks: (
      input: PcbLatestChecksInput,
    ) => Effect.Effect<PcbLatestChecksResult, PcbPreviewError>;
    readonly watch: (input: PcbWatchInput) => Stream.Stream<PcbWatchEvent, PcbPreviewError>;
  }
>()("t3/fork/pcb-preview/PcbPreviewService") {}

const failure = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
const ioFailure = () =>
  failure(
    "io-failed",
    "The PCB preview operation could not access its files. Refresh and try again.",
  );
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isPreviewError = Schema.is(PcbPreviewError);
const decodeWorkspace = Schema.decodeUnknownEffect(W.PcbWorkspace);
const decodeLibrary = Schema.decodeUnknownEffect(W.PcbHardwareLibrary);
const decodeInspection = Schema.decodeUnknownEffect(W.PcbInspection);
const decodeParameterFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ParameterFile));
const decodeWorkspaceJson = Schema.decodeUnknownEffect(Schema.fromJsonString(W.PcbWorkspace));
const decodeLibraryJson = Schema.decodeUnknownEffect(Schema.fromJsonString(W.PcbHardwareLibrary));
const decodeRender = Schema.decodeUnknownEffect(Schema.fromJsonString(PcbRenderResult));
const decodeCheck = Schema.decodeUnknownEffect(Schema.fromJsonString(PcbCheckResult));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const ignoredDirectories = new Set([
  "node_modules",
  ".repos",
  ".git",
  ".t3",
  "dist",
  "build",
  "target",
  ".tscircuit",
  ".next",
  ".cache",
  "coverage",
  ".venv",
  "__pycache__",
]);
const SAVED_STATE_LIMIT = 4 * 1024 * 1024;
const SOURCE_LIMIT = 2000,
  DIRECTORY_LIMIT = 512;
const contains = (root: string, absolute: string, path: Path.Path) => {
  const relative = path.relative(root, absolute);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

/** Exported for service tests with real filesystem and injected process/store boundaries. */
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const config = yield* ServerConfig,
    threads = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2,
    workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const entries = yield* WorkspaceEntries,
    runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment,
    platform = yield* HostProcess.Platform;
  const bound = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Environment, environment),
      Effect.provideService(HostProcess.Platform, platform),
    );
  const checked = <A, R>(effect: Effect.Effect<A, PcbPreviewError | PlatformError, R>) =>
    bound(effect).pipe(Effect.catchTags({ PlatformError: () => Effect.fail(ioFailure()) }));
  const cachePath = path.join(config.stateDir, "fork", "pcb-preview", "cache");
  const checksPath = path.join(config.stateDir, "fork", "pcb-preview", "checks");
  yield* fs.makeDirectory(cachePath, { recursive: true }).pipe(Effect.mapError(ioFailure));
  yield* fs.makeDirectory(checksPath, { recursive: true }).pipe(Effect.mapError(ioFailure));
  const cacheDir = yield* fs.realPath(cachePath).pipe(Effect.mapError(ioFailure));
  const checksDir = yield* fs.realPath(checksPath).pipe(Effect.mapError(ioFailure));
  const cacheLock = yield* Semaphore.make(1),
    detectionLock = yield* Semaphore.make(1);
  const kicadLock = yield* Semaphore.make(1),
    tsciLock = yield* Semaphore.make(1);
  const renderJobs = yield* makeSharedJobs<PcbRenderResult, PcbPreviewError>();
  const assetJobs = yield* makeSharedJobs<W.PcbAsset, PcbPreviewError>();
  const circuitVersions = new Map<string, { at: number; version: string }>();
  let detection: { at: number; value: PcbPreviewStatus } | null = null;
  const timestamp = Effect.map(DateTime.now, DateTime.formatIso);
  const now = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const safePath = Effect.fn("PcbPreview.safePath")(function* (root: string, relativePath: string) {
    if (
      relativePath.includes("\0") ||
      relativePath.includes("\\") ||
      relativePath.split("/").includes("..")
    )
      return yield* failure("path-outside-workspace", "Choose a design inside the workspace.");
    const entry = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot: root, relativePath })
      .pipe(
        Effect.mapError(() =>
          failure("path-outside-workspace", "Choose a design inside the workspace."),
        ),
      );
    const real = yield* fs
      .realPath(entry.absolutePath)
      .pipe(
        Effect.mapError(() =>
          failure("design-not-found", "The design was deleted or moved. Refresh the design list."),
        ),
      );
    if (!contains(root, real, path))
      return yield* failure("path-outside-workspace", "The design points outside the workspace.");
    const info = yield* fs.stat(real).pipe(Effect.mapError(ioFailure));
    if (info.type !== "File") return yield* failure("design-not-found", "Choose a design file.");
    return real;
  });
  const ensureWorkspaceDirectory = Effect.fn("PcbPreview.ensureWorkspaceDirectory")(function* (
    root: string,
    relative: string,
  ) {
    let current = root;
    for (const segment of relative.split(path.sep)) {
      const candidate = path.join(current, segment);
      if (!(yield* fs.exists(candidate))) yield* fs.makeDirectory(candidate);
      const real = yield* fs.realPath(candidate);
      if (!contains(root, real, path) || (yield* fs.stat(real)).type !== "Directory")
        return yield* failure(
          "path-outside-workspace",
          "The destination folder points outside the workspace or is not a directory.",
        );
      current = real;
    }
    return current;
  });
  const workspace = Effect.fn("PcbPreview.workspace")(function* (threadId: ThreadId) {
    const thread = yield* threads
      .getThread(threadId)
      .pipe(
        Effect.mapError(() =>
          failure("thread-not-found", "Save this thread before opening PCB preview."),
        ),
      );
    const project = yield* projects
      .get(thread.projectId)
      .pipe(
        Effect.mapError(() =>
          failure("workspace-missing", "The project's workspace could not be read."),
        ),
      );
    if (Option.isNone(project))
      return yield* failure("workspace-missing", "This thread has no workspace.");
    const root = yield* fs
      .realPath(thread.worktreePath ?? project.value.workspaceRoot)
      .pipe(
        Effect.mapError(() =>
          failure("workspace-missing", "The workspace directory is unavailable."),
        ),
      );
    return { root, projectId: thread.projectId, workspaceKey: hashKey(thread.projectId, root) };
  });
  const run = (
    tool: PcbToolStatus,
    args: ReadonlyArray<string>,
    cwd: string,
    timeout: Duration.Input,
    tsci = false,
    temporary?: string,
  ) => {
    if (!tool.path)
      return Effect.fail(
        failure("tool-missing", "Install the design's CLI on this environment to preview it."),
      );
    return (tsci ? tsciLock : kicadLock)
      .withPermit(
        runner.run({
          command: tool.path,
          args,
          cwd,
          timeout,
          maxOutputBytes: 1024 * 1024,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
          ...(tsci
            ? {
                env: {
                  ...circuitEnvironment(environment),
                  ...(temporary
                    ? {
                        TMPDIR: temporary,
                        TMP: temporary,
                        TEMP: temporary,
                        XDG_CACHE_HOME: temporary,
                        BUN_RUNTIME_TRANSPILER_CACHE_PATH: temporary,
                      }
                    : {}),
                },
                extendEnv: false,
              }
            : {}),
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProcessSpawnError"
            ? failure(
                "tool-missing",
                "The CLI could not start. Check its installation and runtime on the environment host.",
              )
            : failure("io-failed", "The design tool could not finish. Try again."),
        ),
      );
  };
  const circuitVersionCheck = (tool: PcbToolStatus) =>
    Effect.scoped(
      Effect.gen(function* () {
        // tsci initializes a cwd-local cache even for --version. Keep detection disposable.
        const temporary = yield* fs.makeTempDirectoryScoped({
          directory: cacheDir,
          prefix: "pending-tool-",
        });
        return yield* run(tool, ["--version"], temporary, CIRCUIT_VERSION_TIMEOUT, true, temporary);
      }),
    );
  const findTool = Effect.fn("PcbPreview.findTool")(function* (
    name: "kicad-cli" | "tsci" | "ngspice",
  ) {
    let executable = yield* bound(resolveCommandPath(name)).pipe(Effect.orElseSucceed(() => null));
    if (!executable && name === "kicad-cli" && platform === "darwin") {
      const standard = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli";
      if (yield* fs.exists(standard)) executable = standard;
    }
    if (!executable) return { found: false, problem: "not-found" } satisfies PcbToolStatus;
    const tool = { found: true, path: executable };
    const result = yield* (
      name === "tsci"
        ? circuitVersionCheck(tool)
        : run(tool, [name === "kicad-cli" ? "version" : "--version"], config.cwd, "5 seconds")
    ).pipe(Effect.orElseSucceed(() => null));
    const text =
      result && !result.timedOut && result.code === 0 ? result.stdout + "\n" + result.stderr : "";
    const version =
      name === "kicad-cli"
        ? parseKicadVersion(text)?.version
        : name === "ngspice"
          ? /ngspice[-\s]+(\d+(?:\.\d+)?)/i.exec(text)?.[1]
          : parseTsciVersion(text);
    const major = name === "kicad-cli" ? parseKicadVersion(text)?.major : undefined;
    return {
      found: true,
      path: executable,
      ...(version ? { version } : {}),
      ...(!version
        ? { problem: "version-failed" as const }
        : major !== undefined && major < 9
          ? { problem: "tool-too-old" as const }
          : {}),
    } satisfies PcbToolStatus;
  });
  const status = () =>
    detectionLock.withPermit(
      Effect.gen(function* () {
        const at = yield* now;
        if (detection && at - detection.at < 60000) return detection.value;
        const [kicad, tscircuit, ngspice] = yield* Effect.all(
          [findTool("kicad-cli"), findTool("tsci"), findTool("ngspice")],
          {
            concurrency: 3,
          },
        );
        const value = { kicad, tscircuit, ngspice, checkedAt: yield* timestamp };
        detection = { at, value };
        return value;
      }),
    );
  const packageRoot = Effect.fn("PcbPreview.packageRoot")(function* (
    root: string,
    absolute: string,
  ) {
    let current = path.dirname(absolute);
    while (contains(root, current, path)) {
      if (yield* fs.exists(path.join(current, "package.json"))) return current;
      if (current === root) break;
      current = path.dirname(current);
    }
    return root;
  });
  const circuitTool = Effect.fn("PcbPreview.circuitTool")(function* (root: string) {
    const local = path.join(
      root,
      "node_modules",
      ".bin",
      platform === "win32" ? "tsci.cmd" : "tsci",
    );
    // Looking for designs must never execute a project's own binary before the trust prompt.
    if (yield* fs.exists(local)) return { found: true, path: local } satisfies PcbToolStatus;
    return (yield* status()).tscircuit;
  });
  const discover = Effect.fn("PcbPreview.discover")(function* (root: string) {
    const searches = yield* Effect.forEach(
      DESIGN_SUFFIXES,
      (query) =>
        entries
          .search({ cwd: root, query, kind: "file", limit: 200 })
          .pipe(Effect.mapError(ioFailure)),
      { concurrency: 5 },
    );
    const names = [
      ...new Set(searches.flatMap((s) => s.entries.filter((e) => !e.ignored).map((e) => e.path))),
    ];
    const configs = new Map<string, unknown>(),
      sources = new Map<string, string>();
    yield* Effect.forEach(
      names.filter((n) => n.endsWith(".kicad_sch") || n.endsWith("tscircuit.config.json")),
      (name) =>
        Effect.gen(function* () {
          const absolute = yield* safePath(root, name);
          const info = yield* fs.stat(absolute);
          if (Number(info.size) > SAVED_STATE_LIMIT) return;
          const source = yield* fs.readFileString(absolute);
          if (name.endsWith(".kicad_sch")) sources.set(name, source);
          else configs.set(name, yield* decodeJson(source));
        }).pipe(Effect.ignore),
      { concurrency: 8, discard: true },
    );
    return {
      designs: groupDesigns(names, configs, sources),
      truncated: searches.some((s) => s.truncated),
    };
  });
  const listDesigns = Effect.fn("PcbPreview.listDesigns")(function* (input: PcbListDesignsInput) {
    const ws = yield* workspace(input.threadId),
      found = yield* entries.refresh(ws.root).pipe(Effect.andThen(discover(ws.root))),
      tools = yield* status();
    const designs = yield* Effect.forEach(
      found.designs,
      (design) =>
        Effect.gen(function* () {
          const absolutePath = yield* safePath(ws.root, design.id);
          const toolStatus =
            design.kind === "kicad"
              ? tools.kicad
              : yield* circuitTool(yield* packageRoot(ws.root, absolutePath));
          return {
            ...design,
            absolutePath,
            toolAvailable: toolStatus.found && !toolStatus.problem,
            toolStatus,
          } satisfies PcbDesign;
        }).pipe(Effect.orElseSucceed(() => null)),
      { concurrency: 8 },
    );
    return {
      designs: designs.filter((d) => d !== null),
      projectId: ws.projectId,
      workspaceKey: ws.workspaceKey,
      truncated: found.truncated,
    } satisfies PcbListDesignsResult;
  });
  const resolveDesign = Effect.fn("PcbPreview.resolveDesign")(function* (input: {
    threadId: ThreadId;
    designId: string;
  }) {
    const ws = yield* workspace(input.threadId);
    const absolute = yield* safePath(ws.root, input.designId);
    const found = yield* discover(ws.root);
    const design = found.designs.find((d) => d.id === input.designId);
    if (!design)
      return yield* failure(
        "design-not-found",
        "The design is no longer in this workspace. Refresh the design list.",
      );
    const cwd =
      design.kind === "tscircuit" ? yield* packageRoot(ws.root, absolute) : path.dirname(absolute);
    return { ...ws, design, absolute, cwd };
  });
  type ResolvedDesign = Effect.Success<ReturnType<typeof resolveDesign>>;
  const sourceSnapshot = Effect.fn("PcbPreview.sourceSnapshot")(function* (
    resolved: ResolvedDesign,
  ) {
    const dirs: string[] = [],
      records: string[] = [];
    const queue = [resolved.cwd];
    let visited = 0;
    while (queue.length) {
      const directory = queue.shift()!;
      const real = yield* fs.realPath(directory).pipe(Effect.mapError(ioFailure));
      if (!contains(resolved.root, real, path) || dirs.includes(real)) continue;
      // Exported references are outputs, not inputs. Otherwise every export changes its
      // own source hash and creates another revision/cached mesh on the next export.
      if (real === path.join(resolved.root, ".loom", "pcb-references")) continue;
      dirs.push(real);
      if (dirs.length > DIRECTORY_LIMIT)
        return yield* failure(
          "source-limit",
          "This design spans too many folders to watch. Preview a smaller workspace.",
        );
      const children = yield* fs.readDirectory(real).pipe(Effect.mapError(ioFailure));
      for (const child of children.sort()) {
        if (ignoredDirectories.has(child) || child.endsWith("-backups") || child.startsWith("~"))
          continue;
        const absolute = path.join(real, child);
        const info = yield* fs.stat(absolute).pipe(Effect.orElseSucceed(() => null));
        if (!info) continue;
        const canonical = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
        if (!contains(resolved.root, canonical, path)) continue;
        if (info.type === "Directory") {
          queue.push(canonical);
          continue;
        }
        if (info.type !== "File") continue;
        if (++visited > 20000)
          return yield* failure(
            "source-limit",
            "This workspace is too large to scan for PCB dependencies. Preview a smaller workspace.",
          );
        const relevant =
          resolved.design.kind === "tscircuit"
            ? /\.(?:[cm]?[jt]sx?|json|svg|dxf|png|jpe?g|csv|txt|obj|stl|3mf|glb|gltf|bin)$/i.test(
                child,
              )
            : /\.(?:kicad_(?:sch|pcb|pro|dru|sym|mod)|lib|dcm|wks)$/.test(child) ||
              child === "sym-lib-table" ||
              child === "fp-lib-table";
        if (!relevant) continue;
        if (records.length >= SOURCE_LIMIT)
          return yield* failure(
            "source-limit",
            "This design has more than 2,000 source files. Preview a smaller workspace.",
          );
        // Follow explicit local references beyond the package/design folder. Never
        // traverse installed packages or host-global KiCad libraries.
        const textSource =
          resolved.design.kind === "tscircuit"
            ? /\.(?:[cm]?[jt]sx?|json)$/.test(child)
            : child.endsWith(".kicad_sch") || child === "sym-lib-table" || child === "fp-lib-table";
        if (textSource && Number(info.size) <= MAX_SVG_BYTES) {
          const text = yield* fs.readFileString(canonical).pipe(Effect.mapError(ioFailure));
          const references =
            resolved.design.kind === "tscircuit"
              ? Array.from(text.matchAll(/["'`]((?:\.\.?\/)[^"'`\r\n]+)["'`]/g), (m) => m[1]!)
              : Array.from(
                  text.matchAll(/(?:\(property\s+"Sheetfile"\s+"|\(uri\s+")([^"\n]+)"/gi),
                  (m) => m[1]!,
                );
          for (const reference of references) {
            const expanded = reference.replaceAll("${KIPRJMOD}", resolved.cwd);
            if (expanded.includes("${")) continue;
            const candidate = path.resolve(path.dirname(canonical), expanded);
            if (!contains(resolved.root, candidate, path)) continue;
            const parts = path.relative(resolved.root, candidate).split(path.sep);
            if (parts.some((p) => ignoredDirectories.has(p))) continue;
            const target = yield* fs.stat(candidate).pipe(Effect.orElseSucceed(() => null));
            queue.push(target?.type === "Directory" ? candidate : path.dirname(candidate));
          }
        }
        records.push(
          encodeJson([
            path.relative(resolved.root, canonical),
            Number(info.size),
            Option.getOrNull(info.mtime)?.getTime() ?? 0,
            Option.getOrNull(info.ino),
          ]),
        );
      }
    }
    return { dirs, sourceHash: hashKey(...records.sort()) };
  });
  const byteSize = Effect.fn("PcbPreview.byteSize")(function* (directory: string) {
    let bytes = 0;
    for (const child of yield* fs.readDirectory(directory)) {
      const absolute = path.join(directory, child),
        info = yield* fs.stat(absolute);
      if (info.type === "File") bytes += Number(info.size);
      else if (info.type === "Directory")
        for (const sheet of yield* fs.readDirectory(absolute))
          bytes += Number((yield* fs.stat(path.join(absolute, sheet))).size);
    }
    return bytes;
  });
  const prune = (startup = false) =>
    cacheLock
      .withPermit(
        Effect.gen(function* () {
          const records: { key: string; bytes: number; modified: number }[] = [];
          for (const key of yield* fs.readDirectory(cacheDir)) {
            const absolute = path.join(cacheDir, key);
            if (startup && key.startsWith("pending-")) {
              yield* fs.remove(absolute, { recursive: true, force: true });
              continue;
            }
            if (!isRenderKey(key)) continue;
            if (!(yield* fs.exists(path.join(absolute, "manifest.json")))) {
              yield* fs.remove(absolute, { recursive: true, force: true });
              continue;
            }
            const info = yield* fs.stat(path.join(absolute, "manifest.json"));
            records.push({
              key,
              bytes: yield* byteSize(absolute),
              modified: Option.getOrNull(info.mtime)?.getTime() ?? 0,
            });
          }
          for (const key of pickPruneVictims(records))
            yield* fs.remove(path.join(cacheDir, key), { recursive: true, force: true });
          if (startup)
            for (const name of yield* fs.readDirectory(checksDir))
              if (name.startsWith("pending-"))
                yield* fs.remove(path.join(checksDir, name), { recursive: true, force: true });
          const checks = yield* Effect.forEach(
            (yield* fs.readDirectory(checksDir)).filter((name) =>
              /^[a-f0-9]{64}\.json$/.test(name),
            ),
            (name) =>
              fs.stat(path.join(checksDir, name)).pipe(
                Effect.map((info) => ({
                  key: name,
                  bytes: Number(info.size),
                  modified: Option.getOrNull(info.mtime)?.getTime() ?? 0,
                })),
              ),
          );
          for (const name of pickPruneVictims(checks, CHECK_LIMITS))
            yield* fs.remove(path.join(checksDir, name), { force: true });
        }),
      )
      .pipe(Effect.mapError(ioFailure));
  yield* prune(true);
  const requiredTool = Effect.fn("PcbPreview.requiredTool")(function* (resolved: ResolvedDesign) {
    const tool =
      resolved.design.kind === "kicad" ? (yield* status()).kicad : yield* circuitTool(resolved.cwd);
    if (tool.problem === "tool-too-old")
      return yield* failure(
        "tool-too-old",
        `KiCad 9 or newer is needed; found ${tool.version ?? "an older version"}.`,
      );
    if (!tool.found || tool.problem)
      return yield* failure(
        "tool-missing",
        resolved.design.kind === "kicad"
          ? "Install KiCad 9 or newer on this environment to preview this design."
          : "The tscircuit CLI could not start. Install tscircuit and its Bun runtime on this environment.",
      );
    if (resolved.design.kind === "tscircuit" && tool.path && !tool.version) {
      const saved = circuitVersions.get(tool.path),
        at = yield* now;
      if (saved && at - saved.at < 60000) return { ...tool, version: saved.version };
      const result = yield* circuitVersionCheck(tool);
      const version =
        result.code === 0 && !result.timedOut
          ? parseTsciVersion(result.stdout + "\n" + result.stderr)
          : undefined;
      if (!version)
        return yield* failure(
          "tool-missing",
          "The tscircuit CLI could not start. Check that Bun is available on the environment's PATH.",
        );
      circuitVersions.set(tool.path, { at, version });
      if (circuitVersions.size > 100) circuitVersions.delete(circuitVersions.keys().next().value!);
      return { ...tool, version };
    }
    return tool;
  });
  const runRender = Effect.fn("PcbPreview.runRender")(function* (
    input: PcbRenderInput,
    resolved: ResolvedDesign,
    snapshot: { dirs: string[]; sourceHash: string },
  ) {
    const tool = yield* requiredTool(resolved);
    const preset = input.view === "schematic" ? "front" : (input.layers ?? "front");
    if (resolved.design.kind === "tscircuit" && preset !== "front")
      return yield* failure("unsupported-view", "tscircuit previews show the top PCB view.");
    const sourcePath =
      input.view === "schematic" ? resolved.design.schematicPath : resolved.design.boardPath;
    if (!sourcePath)
      return yield* failure("unsupported-view", "This design does not include that view.");
    const source = yield* safePath(resolved.root, sourcePath);
    const version = tool.version ?? tool.path ?? "unknown";
    const key = renderKey(
      resolved.workspaceKey,
      resolved.design.id,
      snapshot.sourceHash,
      resolved.design.kind,
      input.view,
      input.layerNames ? input.layerNames.join(",") : preset,
      version + ":physical-v3",
    );
    const target = path.join(cacheDir, key),
      manifest = path.join(target, "manifest.json");
    const cached = yield* cacheLock
      .withPermit(
        Effect.gen(function* () {
          if (input.force || !(yield* fs.exists(manifest))) return null;
          const result = yield* decodeRender(yield* fs.readFileString(manifest)).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (
            !result ||
            result.outcome !== "ok" ||
            result.renderKey !== key ||
            result.sourceHash !== snapshot.sourceHash
          ) {
            yield* fs.remove(target, { recursive: true, force: true });
            return null;
          }
          const at = (yield* now) / 1000;
          yield* fs.utimes(manifest, at, at);
          return { ...result, cached: true };
        }),
      )
      .pipe(Effect.mapError(ioFailure));
    if (cached) return cached;
    const temporary = yield* Effect.acquireRelease(
      fs
        .makeTempDirectory({ directory: cacheDir, prefix: "pending-" })
        .pipe(Effect.mapError(ioFailure)),
      (directory) =>
        fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore({ log: true })),
    );
    const sheetDir = path.join(temporary, "sheets");
    yield* fs.makeDirectory(sheetDir).pipe(Effect.mapError(ioFailure));
    let frame: W.PcbBounds | undefined;
    let selectedLayers: readonly string[] | undefined;
    let layerLabels: Readonly<Record<string, string>> = {};
    let args: string[];
    if (resolved.design.kind === "tscircuit")
      args = [
        "export",
        source,
        "-f",
        input.view === "schematic" ? "schematic-svg" : "pcb-svg",
        "-o",
        path.join(sheetDir, "1.svg"),
      ];
    else if (input.view === "schematic")
      args = ["sch", "export", "svg", "--output", sheetDir, "--exclude-drawing-sheet", source];
    else {
      const header = yield* fs.readFileString(source).pipe(Effect.mapError(ioFailure));
      {
        const data = yield* Effect.try({
          try: () => inspectBoard(header, snapshot.sourceHash),
          catch: () => failure("invalid-report", "The board layer table is invalid."),
        });
        layerLabels = data.layerLabels ?? {};
        if (input.layerNames) {
          if (!input.layerNames.length || input.layerNames.some((l) => !data.layers.includes(l)))
            return yield* failure("unsupported-view", "Choose layers declared in this board.");
          selectedLayers = [...new Set(input.layerNames)];
        }
        if (data.bounds)
          frame = {
            x: data.bounds.x - 2,
            y: data.bounds.y - 2,
            width: data.bounds.width + 4,
            height: data.bounds.height + 4,
          };
      }
      const layers =
        selectedLayers ??
        (preset === "all"
          ? ["F.Cu", ...innerCopperLayers(header.slice(0, 65536)), "B.Cu", "Edge.Cuts"]
          : [
              `${preset === "back" ? "B" : "F"}.Cu`,
              `${preset === "back" ? "B" : "F"}.Paste`,
              `${preset === "back" ? "B" : "F"}.Silkscreen`,
              `${preset === "back" ? "B" : "F"}.Mask`,
              "Edge.Cuts",
            ]);
      args = [
        "pcb",
        "export",
        "svg",
        "--output",
        selectedLayers ? sheetDir : path.join(sheetDir, `pcb-${preset}.svg`),
        selectedLayers ? "--mode-multi" : "--mode-single",
        "--exclude-drawing-sheet",
        "--drill-shape-opt",
        "2",
        "--layers",
        layers.join(","),
        source,
      ];
    }
    const runtimeTemp = yield* fs
      .makeTempDirectoryScoped({ directory: cacheDir, prefix: "pending-runtime-" })
      .pipe(Effect.mapError(ioFailure));
    let runCwd = resolved.cwd;
    if (resolved.design.kind === "tscircuit") {
      runCwd = yield* temporaryCircuitCwd(resolved, runtimeTemp);
      args[1] = path.join(runCwd, path.relative(resolved.cwd, source));
    }
    let circuitInspection: W.PcbInspection | undefined;
    if (resolved.design.kind === "tscircuit") {
      const jsonPath = path.join(temporary, "circuit.json");
      const build = yield* asset({
        threadId: input.threadId,
        designId: input.designId,
        format: "circuit-json",
        force: input.force,
      }).pipe(
        Effect.catch((cause) =>
          isPreviewError(cause) && cause.reason === "unsupported-view"
            ? Effect.succeed({ error: cause })
            : Effect.fail(cause),
        ),
      );
      if ("error" in build)
        return {
          renderKey: key,
          sourceHash: snapshot.sourceHash,
          sheets: [],
          cached: false,
          renderedAt: yield* timestamp,
          outcome: build.error.timedOut ? "timed-out" : "failed",
          log: build.error.message,
          ...(build.error.exitCode !== undefined ? { exitCode: build.error.exitCode } : {}),
          ...(tool.version ? { toolVersion: tool.version } : {}),
        } satisfies PcbRenderResult;
      yield* fs.writeFileString(jsonPath, build.data);
      const json = yield* decodeJson(yield* smallSource(jsonPath)).pipe(
        Effect.mapError(() => failure("invalid-report", "Invalid Circuit JSON.")),
      );
      circuitInspection = yield* Effect.try({
        try: () => inspectCircuitJson(json, snapshot.sourceHash),
        catch: () => failure("invalid-report", "Invalid circuit coordinates."),
      });
      args[1] = jsonPath;
    }
    const result = yield* run(
      tool,
      args,
      runCwd,
      resolved.design.kind === "kicad" ? "60 seconds" : "120 seconds",
      resolved.design.kind === "tscircuit",
      runtimeTemp,
    );
    const base = {
      renderKey: key,
      sourceHash: snapshot.sourceHash,
      sheets: [],
      log: processLog(result),
      ...(result.code !== null ? { exitCode: Number(result.code) } : {}),
      ...(tool.version ? { toolVersion: tool.version } : {}),
      renderedAt: yield* timestamp,
      cached: false,
    };
    if (result.timedOut || result.code !== 0)
      return {
        ...base,
        outcome: result.timedOut ? "timed-out" : "failed",
      } satisfies PcbRenderResult;
    if ((yield* sourceSnapshot(resolved)).sourceHash !== snapshot.sourceHash)
      return {
        ...base,
        outcome: "failed",
        log: "Design files changed during rendering. Refresh to preview the latest revision.",
      } satisfies PcbRenderResult;
    const names = (yield* fs.readDirectory(sheetDir).pipe(Effect.mapError(ioFailure)))
      .filter(isSheetFileName)
      .sort(
        (a, b) =>
          Number(a !== path.basename(source, path.extname(source)) + ".svg") -
            Number(b !== path.basename(source, path.extname(source)) + ".svg") ||
          a.localeCompare(b),
      );
    if (!names.length)
      return {
        ...base,
        outcome: "failed",
        log: base.log + "\nThe tool produced no SVG sheets.",
      } satisfies PcbRenderResult;
    if (circuitInspection) {
      for (const name of names) {
        const file = path.join(sheetDir, name),
          rawSvg = yield* smallSource(file, MAX_SVG_BYTES);
        const svg = yield* Effect.try({
          try: () => normalizeCircuitSvg(rawSvg, circuitInspection!, input.view),
          catch: () =>
            failure(
              "invalid-report",
              "The circuit SVG cannot be aligned to physical coordinates. Update the tscircuit CLI and retry.",
            ),
        });
        yield* fs.writeFileString(file, svg);
      }
    }
    const sheets = yield* Effect.forEach(names.slice(0, 200), (id) =>
      Effect.gen(function* () {
        const file = path.join(sheetDir, id);
        const real = yield* fs.realPath(file).pipe(Effect.mapError(ioFailure));
        const info = yield* fs.stat(file).pipe(Effect.mapError(ioFailure));
        if (info.type !== "File" || real !== file)
          return yield* failure("io-failed", "The tool produced an invalid drawing file.");
        return {
          id,
          label: id.replace(/\.svg$/i, ""),
          bytes: Number(info.size),
          tooLarge: Number(info.size) > MAX_SVG_BYTES,
          ...(frame ? { frame } : {}),
          ...(selectedLayers
            ? {
                layer:
                  selectedLayers.find((l) =>
                    id.replace(/\.svg$/i, "").endsWith((layerLabels[l] ?? l).replaceAll(".", "_")),
                  ) ?? "unknown",
              }
            : {}),
        };
      }),
    );
    if (
      names.length > 200 ||
      (yield* byteSize(temporary).pipe(Effect.mapError(ioFailure))) > CACHE_LIMITS.maxBytes
    )
      return {
        ...base,
        outcome: "failed",
        log: "The render exceeds the preview cache limit. Open the design in its editor.",
      } satisfies PcbRenderResult;
    const value = { ...base, sheets, outcome: "ok" } satisfies PcbRenderResult;
    yield* cacheLock
      .withPermit(
        Effect.gen(function* () {
          yield* fs.writeFileString(path.join(temporary, "workspace"), resolved.workspaceKey);
          yield* writeFileStringAtomically({
            filePath: path.join(temporary, "manifest.json"),
            contents: encodeJson(value),
          });
          if (yield* fs.exists(target)) yield* fs.remove(target, { recursive: true, force: true });
          yield* fs.rename(temporary, target);
        }),
      )
      .pipe(Effect.mapError(ioFailure));
    yield* prune();
    return value;
  });
  const render = Effect.fn("PcbPreview.render")(function* (input: PcbRenderInput) {
    const resolved = yield* resolveDesign(input),
      snapshot = yield* sourceSnapshot(resolved);
    const jobKey = hashKey(
      resolved.workspaceKey,
      input.designId,
      snapshot.sourceHash,
      input.view,
      input.layerNames
        ? input.layerNames.join(",")
        : input.view === "schematic"
          ? "front"
          : (input.layers ?? "front"),
      String(input.force ?? false),
    );
    return yield* renderJobs.run(
      jobKey,
      checked(Effect.scoped(runRender(input, resolved, snapshot))),
    );
  });
  const readSheet = Effect.fn("PcbPreview.readSheet")(function* (input: PcbReadSheetInput) {
    if (!isRenderKey(input.renderKey) || !isSheetFileName(input.sheetId))
      return yield* failure(
        "render-not-found",
        "That preview sheet is unavailable. Refresh the preview.",
      );
    const ws = yield* workspace(input.threadId);
    return yield* cacheLock.withPermit(
      Effect.gen(function* () {
        const directory = path.join(cacheDir, input.renderKey),
          manifest = path.join(directory, "manifest.json");
        const saved = yield* decodeRender(
          yield* fs
            .readFileString(manifest)
            .pipe(
              Effect.mapError(() =>
                failure(
                  "render-not-found",
                  "The preview was evicted from the cache. Refresh the preview.",
                ),
              ),
            ),
        ).pipe(
          Effect.mapError(() =>
            failure(
              "render-not-found",
              "The preview manifest is unavailable. Refresh the preview.",
            ),
          ),
        );
        const ownerPath = path.join(directory, "workspace");
        const owner = yield* fs.readFileString(ownerPath).pipe(Effect.orElseSucceed(() => ""));
        if (owner !== ws.workspaceKey || !saved.sheets.some((s) => s.id === input.sheetId))
          return yield* failure(
            "render-not-found",
            "That sheet is not available in this workspace.",
          );
        const sheet = path.join(directory, "sheets", input.sheetId),
          real = yield* fs.realPath(sheet).pipe(Effect.mapError(ioFailure));
        if (!contains(directory, real, path))
          return yield* failure("render-not-found", "That preview sheet is unavailable.");
        const info = yield* fs.stat(real).pipe(Effect.mapError(ioFailure));
        if (info.type !== "File")
          return yield* failure("render-not-found", "That drawing is unavailable.");
        if (Number(info.size) > MAX_SVG_BYTES)
          return yield* failure(
            "sheet-too-large",
            `This sheet is too large to preview here (${(Number(info.size) / 1024 / 1024).toFixed(1)} MiB). Open it in its editor.`,
          );
        const svg = yield* fs.readFileString(real).pipe(Effect.mapError(ioFailure));
        if (Buffer.byteLength(svg) > MAX_SVG_BYTES)
          return yield* failure("sheet-too-large", "The sheet exceeds the 4 MiB preview limit.");
        const at = (yield* now) / 1000;
        yield* fs.utimes(manifest, at, at).pipe(Effect.mapError(ioFailure));
        const frame = saved.sheets.find((sheet) => sheet.id === input.sheetId)?.frame;
        return { svg: frame ? cropPhysicalSvg(svg, frame) : svg };
      }),
    );
  });
  const checkPath = (resolved: ResolvedDesign, kind: string) =>
    path.join(checksDir, hashKey(resolved.workspaceKey, resolved.design.id, kind) + ".json");
  const check = Effect.fn("PcbPreview.check")(function* (input: PcbCheckInput) {
    const resolved = yield* resolveDesign(input);
    if (resolved.design.kind !== "kicad")
      return yield* failure("unsupported-view", "ERC and DRC are available for KiCad designs.");
    const relative =
      input.kind === "erc" ? resolved.design.schematicPath : resolved.design.boardPath;
    if (!relative)
      return yield* failure(
        "unsupported-view",
        "This design does not include the file needed for that check.",
      );
    const source = yield* safePath(resolved.root, relative),
      tool = yield* requiredTool(resolved),
      snapshot = yield* sourceSnapshot(resolved);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const temporary = yield* fs
          .makeTempDirectoryScoped({ directory: checksDir, prefix: "pending-" })
          .pipe(Effect.mapError(ioFailure));
        const report = path.join(temporary, "report.json");
        const args = [
          input.kind === "erc" ? "sch" : "pcb",
          input.kind,
          "--format",
          "json",
          "--severity-all",
          "--units",
          "mm",
          "--exit-code-violations",
          "--output",
          report,
          ...(input.kind === "drc" && resolved.design.schematicPath ? ["--schematic-parity"] : []),
          source,
        ];
        const result = yield* run(tool, args, resolved.cwd, "180 seconds");
        const base = {
          counts: { errors: 0, warnings: 0, excluded: 0 },
          kind: input.kind,
          sourceHash: snapshot.sourceHash,
          violations: [],
          truncated: false,
          log: processLog(result),
          ...(result.code !== null ? { exitCode: Number(result.code) } : {}),
          ranAt: yield* timestamp,
        };
        let value: PcbCheckResult;
        if (result.timedOut || (result.code !== 0 && result.code !== 5))
          value = { ...base, outcome: result.timedOut ? "timed-out" : "failed" };
        else {
          const info = yield* fs
            .stat(report)
            .pipe(
              Effect.mapError(() =>
                failure("invalid-report", "KiCad did not produce a check report."),
              ),
            );
          if (Number(info.size) > 16 * 1024 * 1024)
            return yield* failure(
              "invalid-report",
              "The KiCad report exceeds the 16 MiB processing limit.",
            );
          const raw = yield* decodeJson(
            yield* fs.readFileString(report).pipe(Effect.mapError(ioFailure)),
          ).pipe(
            Effect.mapError(() =>
              failure("invalid-report", "KiCad returned an invalid check report."),
            ),
          );
          const parsed = yield* Effect.try({
            try: () => parseKicadReport(raw, input.kind),
            catch: () => failure("invalid-report", "KiCad returned an unsupported check report."),
          });
          value = {
            ...base,
            ...parsed,
            outcome:
              result.code === 5 || parsed.violations.some((v) => !v.excluded)
                ? "violations"
                : "clean",
          };
        }
        yield* cacheLock
          .withPermit(
            Effect.gen(function* () {
              const file = checkPath(resolved, input.kind);
              const previous = yield* decodeCheck(
                yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "")),
              ).pipe(Effect.orElseSucceed(() => null));
              if (!previous || previous.ranAt <= value.ranAt)
                yield* writeFileStringAtomically({ filePath: file, contents: encodeJson(value) });
            }),
          )
          .pipe(Effect.mapError(ioFailure));
        yield* prune();
        return value;
      }),
    );
  });
  const latestChecks = Effect.fn("PcbPreview.latestChecks")(function* (
    input: PcbLatestChecksInput,
  ) {
    const resolved = yield* resolveDesign(input);
    const results = yield* Effect.forEach(["erc", "drc"], (kind) =>
      Effect.gen(function* () {
        const file = checkPath(resolved, kind);
        if (!(yield* fs.exists(file))) return null;
        if (Number((yield* fs.stat(file)).size) > 4 * 1024 * 1024) return null;
        return yield* decodeCheck(yield* fs.readFileString(file));
      }).pipe(Effect.orElseSucceed(() => null)),
    );
    return results.filter((r) => r !== null);
  });
  const watch = (input: PcbWatchInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const resolved = yield* resolveDesign(input);
        // Keep existing subscriptions alive while scanning and adding folders, so
        // edits during reconciliation remain queued. One dirty signal bounds bursts.
        const watchScope = yield* Effect.scope;
        const dirty = yield* Queue.sliding<void, PcbPreviewError>(1);
        const watchers = new Map<string, Fiber.Fiber<void>>();
        const watchFailure = () =>
          failure(
            "watch-failed",
            "Live reload could not watch all design folders. Use Refresh to update the preview.",
          );
        const reconcile = (dirs: readonly string[]) =>
          Effect.gen(function* () {
            for (const dir of dirs) {
              if (watchers.has(dir)) continue;
              const fiber = yield* fs.watch(dir).pipe(
                Stream.filter((event) => {
                  const parts = path
                    .relative(resolved.root, path.resolve(dir, event.path))
                    .split(path.sep);
                  return !parts.some((p) => ignoredDirectories.has(p) || p.endsWith("-backups"));
                }),
                Stream.runForEach(() => Queue.offer(dirty, undefined)),
                Effect.andThen(() => Queue.fail(dirty, watchFailure())),
                Effect.catch(() => Queue.fail(dirty, watchFailure())),
                Effect.asVoid,
                Effect.forkIn(watchScope, { startImmediately: true }),
              );
              watchers.set(dir, fiber);
            }
            for (const [dir, fiber] of watchers) {
              if (dirs.includes(dir)) continue;
              yield* Fiber.interrupt(fiber);
              watchers.delete(dir);
            }
          });
        const initial = yield* sourceSnapshot(resolved);
        yield* reconcile(initial.dirs);
        const current = yield* sourceSnapshot(resolved);
        yield* reconcile(current.dirs);
        const changes = Stream.fromQueue(dirty).pipe(
          Stream.debounce("350 millis"),
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              const next = yield* sourceSnapshot(resolved);
              yield* reconcile(next.dirs);
              return { sourceHash: next.sourceHash };
            }),
          ),
        );
        return Stream.concat(Stream.succeed({ sourceHash: current.sourceHash }), changes).pipe(
          Stream.changesWith((a, b) => a.sourceHash === b.sourceHash),
        );
      }),
    );
  const storageLock = yield* Semaphore.make(1);
  const workspaceBus = yield* PubSub.sliding<{ key: string; data: W.PcbWorkspace }>(64);
  const workbenchDir = path.join(config.stateDir, "fork", "pcb-preview", "workspaces");
  yield* fs.makeDirectory(workbenchDir, { recursive: true }).pipe(Effect.mapError(ioFailure));
  const freshWorkspace = (): W.PcbWorkspace => ({
    version: 0,
    views: [],
    layerSets: [],
    measurements: [],
    annotations: [],
    simulations: [],
    variants: [],
  });
  const readState = <A>(
    file: string,
    decode: (source: string) => Effect.Effect<A, Schema.SchemaError>,
    fallback: () => A,
  ) =>
    Effect.gen(function* () {
      if (!(yield* fs.exists(file))) return fallback();
      const info = yield* fs.stat(file);
      if (Number(info.size) > SAVED_STATE_LIMIT)
        return yield* failure("source-limit", "Saved PCB data exceeds its size limit.");
      return yield* decode(yield* fs.readFileString(file)).pipe(
        Effect.mapError(() =>
          failure(
            "io-failed",
            "Saved PCB data could not be read. Restore its valid JSON before editing it.",
          ),
        ),
      );
    });
  const writeState = (filePath: string, value: unknown) =>
    Effect.gen(function* () {
      const contents = encodeJson(value);
      if (Buffer.byteLength(contents, "utf8") > SAVED_STATE_LIMIT)
        return yield* failure(
          "source-limit",
          "Saved PCB data exceeds 4 MiB. Reduce large notes or saved collections before saving.",
        );
      yield* writeFileStringAtomically({ filePath, contents });
    });
  const workspaceFile = (resolved: ResolvedDesign) =>
    path.join(workbenchDir, hashKey(resolved.workspaceKey, resolved.design.id) + ".json");
  const getWorkspace = Effect.fn("PcbPreview.getWorkspace")(function* (input: W.PcbInspectInput) {
    const resolved = yield* resolveDesign(input);
    return yield* readState(workspaceFile(resolved), decodeWorkspaceJson, freshWorkspace);
  });
  const updateWorkspace = Effect.fn("PcbPreview.updateWorkspace")(function* (
    input: W.PcbWorkspaceUpdate,
  ) {
    const resolved = yield* resolveDesign(input);
    return yield* storageLock.withPermit(
      Effect.gen(function* () {
        const current = yield* readState(
          workspaceFile(resolved),
          decodeWorkspaceJson,
          freshWorkspace,
        );
        if (current.version !== input.expectedVersion)
          return yield* failure(
            "conflict",
            "This design's saved tools changed on another client. Reload them before saving.",
          );
        const next = yield* decodeWorkspace({
          ...input.workspace,
          version: current.version + 1,
        }).pipe(
          Effect.mapError(() =>
            failure(
              "invalid-parameters",
              "Saved PCB tools exceed their limits or contain invalid values.",
            ),
          ),
        );
        for (const collection of [
          next.views,
          next.layerSets,
          next.measurements,
          next.annotations,
          next.simulations,
          next.variants,
        ])
          if (new Set(collection.map((item) => item.id)).size !== collection.length)
            return yield* failure("invalid-parameters", "Saved PCB collection IDs must be unique.");
        yield* writeState(workspaceFile(resolved), next);
        yield* PubSub.publish(workspaceBus, { key: workspaceFile(resolved), data: next });
        return next;
      }),
    );
  });
  const libraryFile = path.join(workbenchDir, "hardware-library.json");
  const library = () =>
    readState(libraryFile, decodeLibraryJson, () => ({ version: 0, items: starterHardware }));
  const updateLibrary = Effect.fn("PcbPreview.updateLibrary")(function* (
    input: W.PcbLibraryUpdate,
  ) {
    return yield* storageLock.withPermit(
      Effect.gen(function* () {
        const current = yield* library();
        if (current.version !== input.expectedVersion)
          return yield* failure(
            "conflict",
            "The hardware library changed on another client. Reload it before saving.",
          );
        const next = yield* decodeLibrary({
          ...input.library,
          version: current.version + 1,
        }).pipe(
          Effect.mapError(() =>
            failure(
              "invalid-parameters",
              "The library contains invalid data or exceeds 300 entries.",
            ),
          ),
        );
        if (new Set(next.items.map((i) => i.id)).size !== next.items.length)
          return yield* failure("invalid-parameters", "Hardware library IDs must be unique.");
        for (const item of next.items) {
          for (const link of [item.documentationUrl, item.purchaseUrl, item.sourceUrl])
            if (link) {
              let valid = false;
              try {
                const url = new URL(link);
                valid =
                  ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
              } catch {}
              if (!valid)
                return yield* failure(
                  "invalid-parameters",
                  "Library links must use HTTP or HTTPS without credentials.",
                );
            }
          const previousAssets =
            current.items.find((previous) => previous.id === item.id)?.assets ?? [];
          for (const asset of item.assets) {
            // Missing linked files must not block inventory edits or removal of stale links.
            // Validate a newly linked location now, and validate all reads again during import.
            if (
              previousAssets.some(
                (previous) =>
                  previous.kind === asset.kind &&
                  previous.path === asset.path &&
                  previous.workspaceRoot === asset.workspaceRoot,
              )
            )
              continue;
            const root = yield* fs.realPath(asset.workspaceRoot);
            yield* safePath(root, asset.path);
          }
        }
        yield* writeState(libraryFile, next);
        return next;
      }),
    );
  });
  const smallSource = Effect.fn("PcbPreview.smallSource")(function* (
    file: string,
    max = 16 * 1024 * 1024,
  ) {
    const info = yield* fs.stat(file);
    if (info.type !== "File" || Number(info.size) > max)
      return yield* failure(
        "source-limit",
        "The design asset exceeds the PCB workbench size limit.",
      );
    return yield* fs.readFileString(file);
  });
  const sourceInspection = Effect.fn("PcbPreview.sourceInspection")(function* (
    resolved: ResolvedDesign,
    hash: string,
    read: (relative: string) => Effect.Effect<string, PcbPreviewError | PlatformError>,
  ) {
    let result = resolved.design.boardPath
      ? yield* Effect.gen(function* () {
          const source = yield* read(resolved.design.boardPath!);
          return yield* Effect.try({
            try: () => inspectBoard(source, hash),
            catch: () =>
              failure(
                "invalid-report",
                "The saved board could not be inspected. Save a valid KiCad board and retry.",
              ),
          });
        })
      : emptyInspection(hash);
    if (resolved.design.schematicPath) {
      const rootName = path.basename(resolved.design.schematicPath, ".kicad_sch");
      const queue = [
          { relative: resolved.design.schematicPath, sheetName: rootName, instancePath: "" },
        ],
        seen = new Set<string>();
      const components = [...result.components];
      while (queue.length) {
        const entry = queue.shift()!,
          { relative, sheetName } = entry;
        const identity = relative + ":" + entry.instancePath;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (seen.size > 100)
          return yield* failure("source-limit", "This schematic has more than 100 source sheets.");
        const source = yield* read(relative);
        const parsed = yield* Effect.try({
          try: () => {
            const root = parseSexp(source)[0];
            const instancePath =
              entry.instancePath || (Array.isArray(root) ? "/" + atom(child(root, "uuid")) : "");
            return {
              root,
              instancePath,
              components: inspectSchematic(source, sheetName + ".svg", instancePath),
            };
          },
          catch: () => failure("invalid-report", "The saved schematic could not be inspected."),
        });
        for (const component of parsed.components) {
          const index = components.findIndex((c) => c.reference === component.reference);
          if (index >= 0)
            components[index] = {
              ...components[index]!,
              schematic: component.schematic,
              pins: [
                ...components[index]!.pins.map((pin) => ({
                  ...pin,
                  schematic:
                    component.pins.find((p) => p.number === pin.number)?.schematic ?? pin.schematic,
                })),
                ...component.pins.filter(
                  (pin) => !components[index]!.pins.some((p) => p.number === pin.number),
                ),
              ],
            };
          else components.push(component);
        }
        if (Array.isArray(parsed.root))
          for (const sheet of children(parsed.root, "sheet")) {
            const prop = children(sheet, "property").find((p) => atom(p) === "Sheetfile");
            if (prop) {
              const candidate = path
                .normalize(path.join(path.dirname(relative), atom(prop, 2)))
                .split(path.sep)
                .join("/");
              const name =
                atom(children(sheet, "property").find((p) => atom(p) === "Sheetname") ?? [], 2) ||
                path.basename(candidate, ".kicad_sch");
              if (!candidate.startsWith("../"))
                queue.push({
                  relative: candidate,
                  sheetName: sheetName + "-" + name.replace(/[/\\:*?"<>|]/g, "_"),
                  instancePath: parsed.instancePath + "/" + atom(child(sheet, "uuid")),
                });
            }
          }
      }
      result = { ...result, components };
    }
    return result;
  });
  const temporaryCircuitCwd = Effect.fn("PcbPreview.temporaryCircuitCwd")(function* (
    resolved: ResolvedDesign,
    directory: string,
  ) {
    const stagedRoot = path.join(directory, "workspace"),
      snapshot = yield* sourceSnapshot(resolved);
    yield* fs.makeDirectory(stagedRoot);
    const generatedJson = resolved.absolute.replace(/\.[^.]+$/, ".circuit.json");
    // Real directories keep exporter caches inside the staging tree. Only installed
    // packages and source files are linked, avoiding copies of large project assets.
    for (const folder of snapshot.dirs) {
      const destination = path.join(stagedRoot, path.relative(resolved.root, folder));
      yield* fs.makeDirectory(destination, { recursive: true });
      for (const name of yield* fs.readDirectory(folder)) {
        if (
          (ignoredDirectories.has(name) && name !== "node_modules") ||
          name.startsWith(".env") ||
          name.endsWith("-backups") ||
          name.startsWith("~")
        )
          continue;
        const original = path.join(folder, name);
        if (original === generatedJson) continue;
        const info = yield* fs.stat(original);
        const staged = path.join(destination, name);
        if (info.type === "File" || name === "node_modules") yield* fs.symlink(original, staged);
      }
    }
    return path.join(stagedRoot, path.relative(resolved.root, resolved.cwd));
  });
  const modelSigningKey = NodeCrypto.randomBytes(32);
  const MAX_MODEL_BYTES = 128 * 1024 * 1024;
  const signBoard = Effect.fn("PcbPreview.signBoard")(function* (file: string) {
    const info = yield* fs.stat(file),
      expiresAt = (yield* now) + 3600000;
    const token = mintToken(
      { root: cacheDir, base: path.dirname(file), exp: expiresAt, large: true },
      modelSigningKey,
    );
    return {
      relativeUrl: `/api/loom/pcb-preview/f/${token}/board.glb`,
      expiresAt,
      sizeBytes: Number(info.size),
      modifiedAt: Option.getOrNull(info.mtime)?.toISOString() ?? "1970-01-01T00:00:00.000Z",
      revision: path.basename(path.dirname(file)),
    };
  });
  const resolveSignedRequest = Effect.fn("PcbPreview.resolveSignedRequest")(function* (
    token: string,
    relative: string,
  ) {
    const at = yield* now;
    const candidate = yield* Effect.try({
      try: () => resolveTokenPath(verifyToken(token, modelSigningKey, at), relative),
      catch: () => failure("render-not-found", "That board model URL is unavailable."),
    });
    const real = yield* fs.realPath(candidate).pipe(Effect.mapError(ioFailure));
    const info = yield* fs.stat(real).pipe(Effect.mapError(ioFailure));
    if (
      !contains(cacheDir, real, path) ||
      real !== candidate ||
      path.basename(real) !== "board.glb" ||
      info.type !== "File" ||
      Number(info.size) > MAX_MODEL_BYTES
    )
      return yield* failure(
        "render-not-found",
        "That board model is unavailable. Retry its export.",
      );
    return real;
  });
  const decodeModelManifest = Schema.decodeUnknownEffect(
    Schema.Struct({ sourceHash: Schema.String, log: Schema.String }),
  );
  const runAsset = Effect.fn("PcbPreview.runAsset")(function* (
    input: W.PcbAssetInput,
    resolved: ResolvedDesign,
    snapshot: { sourceHash: string },
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const tool = yield* requiredTool(resolved);
        const streamed = input.format === "glb" && input.transport !== "inline";
        const modelKey = hashKey(
          resolved.workspaceKey,
          input.designId,
          snapshot.sourceHash,
          tool.version ?? "",
          input.format === "circuit-json" ? "circuit-json-v1" : "board-model-v2-metres",
        );
        const reusable = input.format === "glb" || input.format === "circuit-json";
        const modelDir = path.join(cacheDir, modelKey),
          modelFile = path.join(modelDir, input.format === "glb" ? "board.glb" : "circuit.json");
        if (reusable && !input.force) {
          const cached = yield* cacheLock
            .withPermit(
              Effect.gen(function* () {
                if (!(yield* fs.exists(modelFile))) return null;
                const manifestPath = path.join(modelDir, "manifest.json");
                const manifest = yield* decodeModelManifest(
                  yield* decodeJson(yield* fs.readFileString(manifestPath)),
                );
                const info = yield* fs.stat(modelFile);
                if (
                  manifest.sourceHash !== snapshot.sourceHash ||
                  info.type !== "File" ||
                  (yield* fs.realPath(modelFile)) !== modelFile ||
                  Number(info.size) > MAX_MODEL_BYTES
                )
                  return null;
                if (!streamed && Number(info.size) > 16 * 1024 * 1024)
                  return yield* failure(
                    "source-limit",
                    "The inline asset exceeds 16 MiB. Use URL transport for this board.",
                  );
                const file = streamed ? yield* signBoard(modelFile) : undefined;
                yield* fs.utimes(manifestPath, (yield* now) / 1000, (yield* now) / 1000);
                return {
                  format: input.format,
                  sourceHash: manifest.sourceHash,
                  log: manifest.log,
                  data: streamed
                    ? ""
                    : input.format === "glb"
                      ? Buffer.from(yield* fs.readFile(modelFile)).toString("base64")
                      : yield* fs.readFileString(modelFile),
                  ...(file ? { file } : {}),
                };
              }),
            )
            .pipe(
              Effect.catch((cause) =>
                isPreviewError(cause) && cause.reason === "source-limit"
                  ? Effect.fail(cause)
                  : Effect.succeed(null),
              ),
            );
          if (cached) return cached;
        }
        const directory = yield* fs.makeTempDirectoryScoped({
            directory: cacheDir,
            prefix: "pending-asset-",
          }),
          output = path.join(
            directory,
            input.format === "glb"
              ? "board.glb"
              : input.format === "spice"
                ? "circuit.spice.cir"
                : "circuit.json",
          );
        let args: string[],
          cwd = resolved.cwd;
        if (resolved.design.kind === "kicad") {
          if (input.format === "circuit-json")
            return yield* failure("unsupported-view", "Circuit JSON belongs to tscircuit designs.");
          if (input.format === "glb") {
            if (Number(tool.version?.split(".")[0]) < 10)
              return yield* failure(
                "tool-too-old",
                "KiCad 10 or newer is required for the GLB board export.",
              );
            if (!resolved.design.boardPath)
              return yield* failure("unsupported-view", "Add a board file to view it in 3D.");
            args = [
              "pcb",
              "export",
              "glb",
              "--output",
              output,
              "--force",
              "--include-tracks",
              "--include-pads",
              "--include-silkscreen",
              "--include-soldermask",
              yield* safePath(resolved.root, resolved.design.boardPath),
            ];
          } else {
            if (!resolved.design.schematicPath)
              return yield* failure(
                "unsupported-view",
                "Simulation needs a schematic or self-contained SPICE netlist.",
              );
            args = [
              "sch",
              "export",
              "netlist",
              "--format",
              "spice",
              "--output",
              output,
              yield* safePath(resolved.root, resolved.design.schematicPath),
            ];
          }
        } else {
          cwd = yield* temporaryCircuitCwd(resolved, directory);
          args = [
            "export",
            path.join(cwd, path.relative(resolved.cwd, resolved.absolute)),
            "-f",
            input.format === "circuit-json"
              ? "circuit-json"
              : input.format === "glb"
                ? "glb"
                : "spice",
            "-o",
            output,
          ];
        }
        const result = yield* run(
          tool,
          args,
          cwd,
          "180 seconds",
          resolved.design.kind === "tscircuit",
          directory,
        );
        if (result.timedOut || result.code !== 0)
          return yield* new PcbPreviewError({
            reason: "unsupported-view",
            message: `The tool could not export ${input.format}. Check its build log and installed format support. ${processLog(result)}`,
            ...(result.code !== null ? { exitCode: Number(result.code) } : {}),
            timedOut: result.timedOut,
          });
        const info = yield* fs.stat(output);
        const canonical = yield* fs.realPath(output);
        if (
          info.type !== "File" ||
          canonical !== output ||
          Number(info.size) > (streamed ? MAX_MODEL_BYTES : 16 * 1024 * 1024)
        )
          return yield* failure(
            "source-limit",
            `The exported asset exceeds ${streamed ? "128" : "16"} MiB or is not a regular file.`,
          );
        if (input.format === "glb" && resolved.design.kind === "tscircuit") {
          const bytes = yield* fs.readFile(output);
          const normalized = yield* Effect.try({
            try: () => normalizeCircuitGlb(bytes),
            catch: () =>
              failure("invalid-report", "The circuit exporter produced an invalid GLB board."),
          });
          if (normalized.length > (streamed ? MAX_MODEL_BYTES : 16 * 1024 * 1024))
            return yield* failure(
              "source-limit",
              "The normalized board exceeds the model size limit.",
            );
          yield* fs.writeFile(output, normalized);
        }
        if ((yield* sourceSnapshot(resolved)).sourceHash !== snapshot.sourceHash)
          return yield* failure(
            "conflict",
            "The design changed while exporting. Retry for the current revision.",
          );
        const data = streamed
          ? ""
          : input.format === "glb"
            ? Buffer.from(yield* fs.readFile(output)).toString("base64")
            : yield* fs.readFileString(output);
        if (reusable) {
          const file = yield* cacheLock.withPermit(
            Effect.gen(function* () {
              yield* fs.makeDirectory(modelDir, { recursive: true });
              yield* fs.rename(output, modelFile);
              yield* writeFileStringAtomically({
                filePath: path.join(modelDir, "manifest.json"),
                contents: encodeJson({ sourceHash: snapshot.sourceHash, log: processLog(result) }),
              });
              return streamed ? yield* signBoard(modelFile) : undefined;
            }),
          );
          yield* prune();
          return {
            format: input.format,
            data,
            sourceHash: snapshot.sourceHash,
            log: processLog(result),
            ...(file ? { file } : {}),
          };
        }
        return {
          format: input.format,
          data,
          sourceHash: snapshot.sourceHash,
          log: processLog(result),
        } satisfies W.PcbAsset;
      }),
    );
  });
  const asset = Effect.fn("PcbPreview.asset")(function* (input: W.PcbAssetInput) {
    const resolved = yield* resolveDesign(input),
      snapshot = yield* sourceSnapshot(resolved);
    const jobKey = hashKey(
      resolved.workspaceKey,
      input.designId,
      snapshot.sourceHash,
      input.format,
      input.transport ?? "url",
      String(input.force ?? false),
    );
    return yield* assetJobs.run(jobKey, checked(runAsset(input, resolved, snapshot)));
  });
  const schematicConnectivity = Effect.fn("PcbPreview.schematicConnectivity")(function* (
    inspection: W.PcbInspection,
    tool: PcbToolStatus,
    schematic: string,
    output: string,
    cwd: string,
  ) {
    const exported = yield* run(
      tool,
      ["sch", "export", "netlist", "--format", "kicadsexpr", "--output", output, schematic],
      cwd,
      "60 seconds",
    );
    let result = inspection;
    if (exported.code === 0 && !exported.timedOut) {
      const netlist = yield* smallSource(output);
      result = yield* Effect.try({
        try: () => mergeNetlist(inspection, netlist),
        catch: () => failure("invalid-report", "KiCad produced invalid netlist data."),
      });
    } else
      result = {
        ...inspection,
        warnings: [
          ...inspection.warnings,
          "Schematic connectivity is unavailable; connectivity changes may be incomplete.",
        ],
      };
    return { inspection: result, log: processLog(exported) };
  });
  const inspect = Effect.fn("PcbPreview.inspect")(function* (input: W.PcbInspectInput) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* resolveDesign(input),
          snapshot = yield* sourceSnapshot(resolved);
        if (resolved.design.kind === "tscircuit") {
          const json = yield* asset({ ...input, format: "circuit-json" });
          const parsed = yield* decodeJson(json.data).pipe(
            Effect.mapError(() => failure("invalid-report", "Invalid Circuit JSON.")),
          );
          return yield* Effect.try({
            try: () => inspectCircuitJson(parsed, json.sourceHash),
            catch: () =>
              failure("invalid-report", "The circuit build produced invalid inspection data."),
          });
        }
        let result = yield* sourceInspection(resolved, snapshot.sourceHash, (relative) =>
          safePath(resolved.root, relative).pipe(Effect.flatMap(smallSource)),
        );
        if (resolved.design.schematicPath) {
          const tool = yield* requiredTool(resolved),
            directory = yield* fs.makeTempDirectoryScoped({
              directory: cacheDir,
              prefix: "pending-netlist-",
            }),
            output = path.join(directory, "nets.net");
          result = (yield* schematicConnectivity(
            result,
            tool,
            yield* safePath(resolved.root, resolved.design.schematicPath),
            output,
            resolved.cwd,
          )).inspection;
        }
        return yield* decodeInspection(result).pipe(
          Effect.mapError(() =>
            failure("source-limit", "This design exceeds semantic inspection limits."),
          ),
        );
      }),
    );
  });
  const git = Effect.fn("PcbPreview.git")(function* (root: string, args: readonly string[]) {
    const output = yield* runner
      .run({
        command: "git",
        args,
        cwd: root,
        timeout: "30 seconds",
        maxOutputBytes: 16 * 1024 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(() =>
          failure("io-failed", "Git could not read the requested design revision."),
        ),
      );
    if (output.code !== 0 || output.stdoutTruncated)
      return yield* failure(
        "design-not-found",
        "The Git revision or design file is unavailable, or exceeds the size limit.",
      );
    return output.stdout;
  });
  const gitBytes = Effect.fn("PcbPreview.gitBytes")(function* (
    root: string,
    args: readonly string[],
  ) {
    const chunks: Uint8Array[] = [],
      limit = 16 * 1024 * 1024;
    let size = 0;
    const result = yield* runner
      .run({
        command: "git",
        args,
        cwd: root,
        timeout: "30 seconds",
        maxOutputBytes: limit,
        outputMode: "truncate",
        onStdoutChunk: (chunk) => {
          size += chunk.byteLength;
          if (size <= limit) chunks.push(chunk);
        },
      })
      .pipe(Effect.mapError(() => failure("io-failed", "Git could not read this revision asset.")));
    if (result.code !== 0 || size > limit)
      return yield* failure("source-limit", "A revision asset is unavailable or exceeds 16 MiB.");
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  });
  const revisions = Effect.fn("PcbPreview.revisions")(function* (input: W.PcbInspectInput) {
    const resolved = yield* resolveDesign(input);
    const commits = yield* git(resolved.root, [
      "log",
      "-40",
      "--format=%H%x09%s",
      "--",
      input.designId,
      ...(resolved.design.boardPath ? [resolved.design.boardPath] : []),
      ...(resolved.design.schematicPath ? [resolved.design.schematicPath] : []),
    ]).pipe(Effect.orElseSucceed(() => ""));
    const refs = yield* git(resolved.root, [
      "for-each-ref",
      "--count=40",
      "--sort=-creatordate",
      "--format=%(refname)%09%(subject)",
      "refs/t3/",
    ]).pipe(Effect.orElseSucceed(() => ""));
    return [...commits.trim().split("\n"), ...refs.trim().split("\n")]
      .filter(Boolean)
      .map((l) => {
        const [ref, ...label] = l.split("\t");
        return { ref: ref!, label: label.join("\t") };
      })
      .slice(0, 80);
  });
  const compare = Effect.fn("PcbPreview.compare")(function* (input: W.PcbCompareInput) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* resolveDesign(input);

        const revision = Effect.fn(function* (ref: string) {
          if (ref.startsWith("-") || /[\s\0]/.test(ref))
            return yield* failure(
              "invalid-parameters",
              "Choose a Git commit or checkpoint reference.",
            );
          return (yield* git(resolved.root, ["rev-parse", "--verify", ref + "^{commit}"])).trim();
        });
        const from = yield* revision(input.from),
          to = input.to ? yield* revision(input.to) : "working-tree";
        const readAt = (ref: string, relative: string) =>
          ref === "working-tree"
            ? safePath(resolved.root, relative).pipe(Effect.flatMap(smallSource))
            : git(resolved.root, ["show", `${ref}:./${relative}`]);
        if (resolved.design.kind === "tscircuit") {
          const tool = yield* requiredTool(resolved),
            directory = yield* fs.makeTempDirectoryScoped({
              directory: cacheDir,
              prefix: "pending-circuit-compare-",
            });
          const evaluate = Effect.fn("PcbPreview.compareCircuitRevision")(function* (
            ref: string,
            index: number,
          ) {
            const cwd = path.join(directory, String(index));
            yield* fs.makeDirectory(cwd);
            const packageRelative = path
              .relative(resolved.root, resolved.cwd)
              .split(path.sep)
              .join("/");
            const files =
              ref === "working-tree"
                ? (yield* fs.readDirectory(resolved.cwd, { recursive: true })).filter(
                    (n) =>
                      !n
                        .split(path.sep)
                        .some((p) => ignoredDirectories.has(p) || p.startsWith(".env")),
                  )
                : (yield* git(resolved.root, [
                    "ls-tree",
                    "-r",
                    "--name-only",
                    ref,
                    "--",
                    packageRelative || ".",
                  ]))
                    .trim()
                    .split("\n")
                    .filter(Boolean)
                    .map((n) => path.relative(resolved.cwd, path.join(resolved.root, n)));
            const relevant = files.filter((n) =>
              /\.(?:[cm]?[jt]sx?|json|svg|csv|txt|png|jpe?g|glb|gltf|bin|obj|stl)$/.test(n),
            );
            if (relevant.length > 2000)
              return yield* failure(
                "source-limit",
                "This circuit revision has more than 2,000 input files.",
              );
            let bytes = 0;
            for (const relative of relevant) {
              if (relative.split(path.sep).includes("..")) continue;
              const workspaceRelative = path
                .relative(resolved.root, path.join(resolved.cwd, relative))
                .split(path.sep)
                .join("/");
              const content =
                ref === "working-tree"
                  ? yield* fs.readFile(yield* safePath(resolved.root, workspaceRelative))
                  : yield* gitBytes(resolved.root, ["show", `${ref}:./${workspaceRelative}`]);
              bytes += content.byteLength;
              if (bytes > 64 * 1024 * 1024)
                return yield* failure("source-limit", "Circuit revision sources exceed 64 MiB.");
              const file = path.join(cwd, relative);
              yield* fs.makeDirectory(path.dirname(file), { recursive: true });
              yield* fs.writeFile(file, content);
            }
            if (yield* fs.exists(path.join(resolved.cwd, "node_modules")))
              yield* fs.symlink(
                path.join(resolved.cwd, "node_modules"),
                path.join(cwd, "node_modules"),
              );
            const source = path.join(cwd, path.relative(resolved.cwd, resolved.absolute)),
              json = path.join(cwd, "preview.json"),
              svg = path.join(cwd, "preview.svg");
            let log = "";
            for (const [format, output] of [
              ["circuit-json", json],
              ["pcb-svg", svg],
            ] as const) {
              const result = yield* run(
                tool,
                ["export", source, "-f", format, "-o", output],
                cwd,
                "120 seconds",
                true,
                directory,
              );
              log += processLog(result);
              if (result.timedOut || result.code !== 0)
                return yield* failure(
                  "invalid-report",
                  "The selected circuit revision could not build. Check its dependencies and CAD models.",
                );
            }
            const raw = yield* decodeJson(yield* smallSource(json)).pipe(
              Effect.mapError(() =>
                failure("invalid-report", "The revision produced invalid Circuit JSON."),
              ),
            );
            const inspection = yield* Effect.try({
              try: () => inspectCircuitJson(raw, ref),
              catch: () => failure("invalid-report", "The revision produced invalid Circuit JSON."),
            });
            return { inspection, svg: yield* smallSource(svg, MAX_SVG_BYTES), log };
          });
          const before = yield* evaluate(from, 0),
            after = yield* evaluate(to, 1);
          return {
            from,
            to,
            before: before.inspection,
            after: after.inspection,
            changes: compareInspections(before.inspection, after.inspection),
            beforeSvg: before.svg,
            afterSvg: after.svg,
            log: (before.log + after.log).slice(-8192),
          } satisfies W.PcbComparison;
        }
        const directory = yield* fs.makeTempDirectoryScoped({
            directory: cacheDir,
            prefix: "pending-compare-",
          }),
          tool = yield* requiredTool(resolved);
        let log = "";
        const inspectRevision = Effect.fn("PcbPreview.inspectRevision")(function* (
          ref: string,
          index: number,
        ) {
          const stagedRoot = path.join(directory, String(index));
          yield* fs.makeDirectory(stagedRoot);
          let inspection = yield* sourceInspection(resolved, ref, (relative) =>
            Effect.gen(function* () {
              if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
                return yield* failure(
                  "path-outside-workspace",
                  "Revision sources must stay inside the workspace.",
                );
              const source = yield* readAt(ref, relative),
                destination = path.join(stagedRoot, relative);
              yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
              yield* fs.writeFileString(destination, source);
              return source;
            }),
          );
          if (resolved.design.schematicPath) {
            const connectivity = yield* schematicConnectivity(
              inspection,
              tool,
              path.join(stagedRoot, resolved.design.schematicPath),
              path.join(stagedRoot, "nets.net"),
              stagedRoot,
            );
            inspection = connectivity.inspection;
            log += connectivity.log;
          }
          return inspection;
        });
        const before = yield* inspectRevision(from, 0),
          after = yield* inspectRevision(to, 1);
        let beforeSvg: string | null = null,
          afterSvg: string | null = null;
        if (resolved.design.boardPath) {
          for (const [index, ref] of [from, to].entries()) {
            const board = path.join(directory, `revision-${index}.kicad_pcb`),
              svg = path.join(directory, `revision-${index}.svg`);
            yield* fs.writeFileString(board, yield* readAt(ref, resolved.design.boardPath));
            const exported = yield* run(
              tool,
              [
                "pcb",
                "export",
                "svg",
                "--output",
                svg,
                "--mode-single",
                "--exclude-drawing-sheet",
                "--layers",
                "F.Cu,B.Cu,F.Silkscreen,Edge.Cuts",
                board,
              ],
              resolved.cwd,
              "60 seconds",
            );
            log += processLog(exported);
            if (exported.code === 0) {
              const source = yield* smallSource(svg, MAX_SVG_BYTES);
              if (index === 0) beforeSvg = source;
              else afterSvg = source;
            }
          }
        } else if (resolved.design.schematicPath) {
          for (const index of [0, 1]) {
            const stagedRoot = path.join(directory, String(index)),
              output = path.join(stagedRoot, "drawing");
            const exported = yield* run(
              tool,
              [
                "sch",
                "export",
                "svg",
                "--output",
                output,
                "--exclude-drawing-sheet",
                path.join(stagedRoot, resolved.design.schematicPath),
              ],
              stagedRoot,
              "60 seconds",
            );
            log += processLog(exported);
            if (exported.code === 0 && !exported.timedOut) {
              const sheets = yield* fs.readDirectory(output);
              const rootSheet = path.basename(resolved.design.schematicPath, ".kicad_sch") + ".svg";
              const sheet = sheets.includes(rootSheet)
                ? rootSheet
                : sheets.find((name) => name.endsWith(".svg"));
              if (sheet) {
                const source = yield* smallSource(path.join(output, sheet), MAX_SVG_BYTES);
                if (index === 0) beforeSvg = source;
                else afterSvg = source;
              }
            }
          }
        }
        return {
          from,
          to,
          before,
          after,
          changes: compareInspections(before, after),
          beforeSvg,
          afterSvg,
          log: log.slice(-8192),
        } satisfies W.PcbComparison;
      }),
    );
  });
  const parameters = Effect.fn("PcbPreview.parameters")(function* (input: W.PcbInspectInput) {
    const resolved = yield* resolveDesign(input);
    if (resolved.design.kind !== "tscircuit")
      return {
        sourceHash: (yield* sourceSnapshot(resolved)).sourceHash,
        schemaPath: "",
        source: "",
        parameters: [],
      };
    const schemaPath = input.designId + ".parameters.json",
      file = path.join(resolved.root, schemaPath);
    let declared: W.PcbParameters["parameters"] = [];
    if (yield* fs.exists(file)) {
      const content = yield* smallSource(yield* safePath(resolved.root, schemaPath), 256 * 1024);
      declared = (yield* decodeParameterFile(content).pipe(
        Effect.mapError(() =>
          failure("invalid-parameters", "The circuit parameter schema is invalid."),
        ),
      )).parameters;
    }
    if (new Set(declared.map((p) => p.key)).size !== declared.length)
      return yield* failure("invalid-parameters", "Circuit parameter keys must be unique.");
    const source = yield* smallSource(resolved.absolute);
    const values = yield* Effect.try({
      try: () => readCircuitParameterValues(source, declared),
      catch: () =>
        failure(
          "invalid-parameters",
          "The circuit parameter markers must contain one literal of the declared type for each key.",
        ),
    });
    return { sourceHash: hashKey(source), schemaPath, source, parameters: declared, values };
  });
  const applyParameters = Effect.fn("PcbPreview.applyParameters")(function* (
    input: W.PcbApplyParametersInput,
  ) {
    const resolved = yield* resolveDesign(input);
    return yield* storageLock.withPermit(
      Effect.gen(function* () {
        const current = yield* parameters(input);
        if (current.sourceHash !== input.expectedSourceHash)
          return yield* failure(
            "conflict",
            "The circuit source changed. Reload parameters before applying.",
          );
        const source = yield* Effect.try({
          try: () => applyCircuitParameters(current.source, current.parameters, input.values),
          catch: () =>
            failure(
              "invalid-parameters",
              "A value is invalid or its unique loom:param marker is missing. Check the parameter schema and source.",
            ),
        });
        if (!input.preview)
          yield* writeFileStringAtomically({ filePath: resolved.absolute, contents: source });
        return {
          source,
          previous: current.source,
          sourceHash: hashKey(source),
          applied: !input.preview,
        };
      }),
    );
  });
  const simulate = Effect.fn("PcbPreview.simulate")(function* (input: W.PcbSimulateInput) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* resolveDesign(input),
          snapshot = yield* sourceSnapshot(resolved);
        const executable = yield* bound(resolveCommandPath("ngspice")).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (!executable)
          return yield* failure(
            "simulation-unavailable",
            "Install ngspice on the connected environment to run electrical simulations.",
          );
        const source = input.setup.netlistPath
          ? yield* smallSource(yield* safePath(resolved.root, input.setup.netlistPath), 1024 * 1024)
          : (yield* asset({ ...input, format: "spice" })).data;
        const runs: W.PcbSimulationResult["runs"][number][] = [];
        let log = "",
          outcome: W.PcbSimulationResult["outcome"] = "ok";
        const directory = yield* fs.makeTempDirectoryScoped({
          directory: cacheDir,
          prefix: "pending-simulate-",
        });
        for (const value of input.setup.sweep?.values ?? [undefined]) {
          const netlist = yield* Effect.try({
            try: () => simulationNetlist(source, input.setup, value),
            catch: () =>
              failure(
                "invalid-parameters",
                "Invalid simulation setup. Use a self-contained SPICE netlist with inline models and bounded analysis settings.",
              ),
          });
          const file = path.join(directory, "circuit.cir"),
            raw = path.join(directory, "results.raw");
          yield* fs.remove(raw, { force: true });
          yield* fs.writeFileString(file, netlist);
          const result = yield* runner
            .run({
              command: executable,
              args: ["-n", "-b", file],
              cwd: directory,
              env: { ...circuitEnvironment(environment), SPICE_ASCIIRAWFILE: "1" },
              extendEnv: false,
              timeout: "120 seconds",
              maxOutputBytes: 1024 * 1024,
              outputMode: "truncate",
              timeoutBehavior: "timedOutResult",
            })
            .pipe(
              Effect.mapError(() => failure("simulation-unavailable", "ngspice could not start.")),
            );
          log += (value === undefined ? "" : `\nSweep ${value}\n`) + processLog(result);
          if (result.timedOut || result.code !== 0 || !(yield* fs.exists(raw))) {
            outcome = result.timedOut ? "timed-out" : "failed";
            break;
          }
          const content = yield* smallSource(raw, 16 * 1024 * 1024);
          const parsed = yield* Effect.try({
            try: () => parseSpiceRaw(content, input.setup.probes),
            catch: () =>
              failure("invalid-report", "The simulation produced invalid or oversized results."),
          });
          runs.push({
            ...parsed,
            label:
              value === undefined ? input.setup.name : `${input.setup.sweep!.parameter} = ${value}`,
          });
        }
        return {
          sourceHash: snapshot.sourceHash,
          netlistHash: hashKey(source),
          outcome,
          log: log.slice(-8192),
          runs,
          ranAt: yield* timestamp,
        } satisfies W.PcbSimulationResult;
      }),
    );
  });

  const editorBridge = yield* makeEditorBridge<
    W.PcbEditorAction,
    W.PcbEditorResult,
    PcbPreviewError
  >({
    resolve: (threadId, designId) => checked(resolveDesign({ threadId, designId })),
    failure: (message) => failure("io-failed", message),
    panelAction: (command) => ["open", "close", "maximize"].includes(command.action),
  });
  const mapEditorEvents = (stream: ReturnType<typeof editorBridge.events>) =>
    stream.pipe(Stream.map(({ path: designId, ...event }) => ({ ...event, designId })));
  const editorEvents = (input: W.PcbInspectInput) =>
    mapEditorEvents(editorBridge.events(input.threadId, input.designId));
  const panelEvents = (threadId: ThreadId) => mapEditorEvents(editorBridge.events(threadId));
  const editorAction = (input: W.PcbEditorInput) =>
    editorBridge.request({ ...input, path: input.designId });
  const completeEditorAction = (input: W.PcbCompleteEditorInput) =>
    editorBridge.completeWith(
      { ...input, path: input.designId, error: input.error ? input.message : undefined },
      checked(
        Effect.gen(function* () {
          let imagePath: string | undefined;
          if (input.png && !input.error) {
            const bytes = Buffer.from(input.png, "base64");
            if (
              bytes.length > 8 * 1024 * 1024 ||
              bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
            )
              return yield* failure(
                "invalid-report",
                "The editor capture must be a PNG under 8 MiB.",
              );
            const directory = path.join(config.stateDir, "fork", "pcb-preview", "captures");
            yield* fs.makeDirectory(directory, { recursive: true });
            imagePath = path.join(directory, NodeCrypto.randomUUID() + ".png");
            yield* fs.writeFile(imagePath, bytes);
            const files = yield* fs.readDirectory(directory);
            const records = yield* Effect.forEach(
              files.filter((n) => /^[a-f0-9-]{36}\.png$/.test(n)),
              (n) =>
                fs.stat(path.join(directory, n)).pipe(
                  Effect.map((info) => ({
                    key: n,
                    bytes: Number(info.size),
                    modified: Option.getOrNull(info.mtime)?.getTime() ?? 0,
                    protected: path.join(directory, n) === imagePath,
                  })),
                ),
            );
            for (const victim of pickPruneVictims(records, {
              maxCount: 50,
              maxBytes: 50 * 1024 * 1024,
            }))
              yield* fs.remove(path.join(directory, victim));
          }
          const result = {
            message: input.message,
            ...(input.state ? { state: input.state } : {}),
            ...(imagePath ? { path: imagePath } : {}),
          };
          return result;
        }),
      ),
    );
  const exportReference = Effect.fn("PcbPreview.exportReference")(function* (
    input: W.PcbReferenceInput,
  ) {
    const exported = yield* asset({ ...input, format: "glb", transport: "url" }),
      targetThreadId = input.targetThreadId ?? input.threadId,
      target = yield* workspace(targetThreadId),
      inspection = yield* inspect(input);
    if (inspection.sourceHash !== exported.sourceHash)
      return yield* failure(
        "conflict",
        "The board changed while preparing its reference. Retry for a consistent revision.",
      );
    const canonical = yield* ensureWorkspaceDirectory(
      target.root,
      path.join(".loom", "pcb-references"),
    );
    const name =
        path.basename(input.designId).replace(/[^a-zA-Z0-9_-]/g, "-") +
        "-" +
        exported.sourceHash.slice(0, 16),
      file = path.join(canonical, name + ".glb"),
      metadataPath = path.join(canonical, name + ".json");
    for (const destination of [file, metadataPath])
      if (yield* fs.exists(destination)) {
        if (
          (yield* fs.realPath(destination)) !== destination ||
          (yield* fs.stat(destination)).type !== "File"
        )
          return yield* failure(
            "path-outside-workspace",
            "A reference destination is not a regular workspace file.",
          );
      }
    // Immutable revision filenames make concurrent identical exports safe. Atomic writes
    // avoid leaving a partially written model if the connection drops.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const temporary = yield* fs.makeTempDirectoryScoped({
          directory: canonical,
          prefix: "pending-reference-",
        });
        const staged = path.join(temporary, "board.glb");
        if (!("file" in exported) || !exported.file)
          return yield* failure("render-not-found", "The board reference export is unavailable.");
        const parts = exported.file.relativeUrl.split("/");
        const source = yield* resolveSignedRequest(parts.at(-2)!, parts.at(-1)!);
        yield* fs.copyFile(source, staged);
        yield* fs.rename(staged, file);
      }),
    );
    yield* writeFileStringAtomically({
      filePath: metadataPath,
      contents: encodeJson({
        designId: input.designId,
        sourceHash: exported.sourceHash,
        units: "mm",
        glbUnits: "metres",
        bounds: inspection.bounds,
        thickness: inspection.thickness,
        mountingHoles: inspection.mountingHoles,
        components: inspection.components.map((c) => ({
          reference: c.reference,
          value: c.value,
          footprint: c.footprint,
          position: c.pcb ?? null,
        })),
        note: "Verify connector clearances, component heights and mounting holes against the exact board revision before fabrication.",
      }),
    });
    yield* entries.refresh(target.root);
    return { path: file, metadataPath, sourceHash: exported.sourceHash, targetThreadId };
  });

  const reuseHardware = Effect.fn("PcbPreview.reuseHardware")(function* (
    input: typeof W.PcbReuseHardwareInput.Type,
  ) {
    const target = yield* workspace(input.threadId),
      item = (yield* library()).items.find((i) => i.id === input.itemId);
    if (!item || !item.assets.length)
      return yield* failure(
        "invalid-parameters",
        "Link local design assets to this library entry before reusing it.",
      );
    const sources = yield* Effect.forEach(item.assets, (asset) =>
      Effect.gen(function* () {
        const root = yield* fs.realPath(asset.workspaceRoot),
          file = yield* safePath(root, asset.path),
          info = yield* fs.stat(file);
        if (info.type !== "File" || Number(info.size) > 16 * 1024 * 1024)
          return yield* failure(
            "source-limit",
            "A hardware asset exceeds 16 MiB or is not a file.",
          );
        return { asset, bytes: yield* fs.readFile(file) };
      }),
    );
    if (sources.reduce((n, s) => n + s.bytes.length, 0) > 64 * 1024 * 1024)
      return yield* failure("source-limit", "Linked hardware assets exceed 64 MiB.");
    const identity = hashKey(
      item.id,
      ...sources.flatMap((s) => [
        s.asset.path,
        s.asset.kind,
        NodeCrypto.createHash("sha256").update(s.bytes).digest("hex"),
      ]),
    ).slice(0, 16);
    const relative = path.join("hardware", item.id.replace(/[^a-zA-Z0-9_-]/g, "-"), identity);
    const files = sources.map(({ asset }) => ({
      kind: asset.kind,
      path: path.join(relative, asset.path).split(path.sep).join("/"),
    }));
    return yield* storageLock.withPermit(
      Effect.scoped(
        Effect.gen(function* () {
          const parent = yield* ensureWorkspaceDirectory(target.root, path.dirname(relative)),
            directory = path.join(parent, identity);
          if (yield* fs.exists(directory)) {
            if ((yield* fs.realPath(directory)) !== directory)
              return yield* failure(
                "path-outside-workspace",
                "The hardware destination is a symbolic link.",
              );
            for (const { asset, bytes } of sources) {
              const destination = path.join(directory, asset.path);
              if (
                !(yield* fs.exists(destination)) ||
                (yield* fs.realPath(destination)) !== destination ||
                !Buffer.from(yield* fs.readFile(destination)).equals(Buffer.from(bytes))
              )
                return yield* failure(
                  "conflict",
                  "A hardware destination already contains different or incomplete content.",
                );
            }
          } else {
            const staging = yield* Effect.acquireRelease(
              fs.makeTempDirectory({ directory: parent, prefix: ".pending-hardware-" }),
              (directory) =>
                fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
            );
            for (const { asset, bytes } of sources) {
              const destination = path.join(staging, asset.path);
              yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
              if (yield* fs.exists(destination)) {
                if (!Buffer.from(yield* fs.readFile(destination)).equals(Buffer.from(bytes)))
                  return yield* failure(
                    "conflict",
                    "Linked hardware assets have conflicting relative paths.",
                  );
              } else yield* fs.writeFile(destination, bytes, { flag: "wx" });
            }
            yield* fs.rename(staging, directory);
          }
          yield* entries.refresh(target.root);
          return { files, directory: relative.split(path.sep).join("/") };
        }),
      ),
    );
  });

  const workspaceUpdates = (input: W.PcbInspectInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const resolved = yield* resolveDesign(input),
          key = workspaceFile(resolved),
          subscription = yield* PubSub.subscribe(workspaceBus),
          current = yield* getWorkspace(input);
        return Stream.concat(
          Stream.succeed(current),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((v) => v.key === key),
            Stream.map((v) => v.data),
          ),
        );
      }),
    );
  return PcbPreviewService.of({
    resolveSignedRequest: (token, relative) => checked(resolveSignedRequest(token, relative)),
    workspaceUpdates: (i) =>
      workspaceUpdates(i).pipe(
        Stream.mapError((c) => (c._tag === "PcbPreviewError" ? c : ioFailure())),
      ),
    reuseHardware: (i) => checked(reuseHardware(i)),
    exportReference: (i) => checked(exportReference(i)),
    panelEvents: (id) =>
      panelEvents(id).pipe(Stream.mapError((e) => (isPreviewError(e) ? e : ioFailure()))),
    editorEvents: (i) =>
      editorEvents(i).pipe(
        Stream.mapError((cause) => (cause._tag === "PcbPreviewError" ? cause : ioFailure())),
      ),
    editorAction: (i) => checked(editorAction(i)),
    completeEditorAction: (i) => checked(completeEditorAction(i)),
    inspect: (i) => checked(inspect(i)),
    getWorkspace: (i) => checked(getWorkspace(i)),
    updateWorkspace: (i) => checked(updateWorkspace(i)),
    asset: (i) => checked(asset(i)),
    compare: (i) => checked(compare(i)),
    revisions: (i) => checked(revisions(i)),
    parameters: (i) => checked(parameters(i)),
    applyParameters: (i) => checked(applyParameters(i)),
    simulate: (i) => checked(simulate(i)),
    library: () => checked(library()),
    updateLibrary: (i) => checked(updateLibrary(i)),

    status: () => checked(status()),
    listDesigns: (i) => checked(listDesigns(i)),
    render: (i) => checked(render(i)),
    readSheet: (i) => checked(readSheet(i)),
    check: (i) => checked(check(i)),
    latestChecks: (i) => checked(latestChecks(i)),
    watch: (i) =>
      watch(i).pipe(
        Stream.mapError((cause) => (cause._tag === "PcbPreviewError" ? cause : ioFailure())),
      ),
  });
});

export const layer = Layer.effect(PcbPreviewService, make).pipe(Layer.provide(ProcessRunner.layer));
