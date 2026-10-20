// @effect-diagnostics nodeBuiltinImport:off -- Hashing generated downloads is a server file boundary.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as NodeStream from "@effect/platform-node/NodeStream";
import type * as Duration from "effect/Duration";
import type { PlatformError } from "effect/PlatformError";
import {
  PcbPreviewError,
  PcbFabPackageManifest,
  type PcbFabPackageInput,
  type PcbFabPackagesInput,
  type PcbFabPackageRef,
  type PcbFabPackageResult,
  type PcbFabPackageSummary,
  type PcbFabOutput,
  type PcbFabPackageZip,
  type PcbCheckInput,
  type PcbCheckResult,
  type PcbFabCheckInput,
  type PcbFabCheckResult,
  type PcbFabCatalog,
  type PcbAssetInput,
  type PcbAsset,
  type PcbToolStatus,
  type SignedFile,
  type PcbDesign,
} from "@t3tools/contracts/fork";
import type { ProcessRunOutput } from "../../processRunner.ts";
import { openZipArchive } from "../../zipArchive.ts";
import { hashKey } from "./cache.ts";
import { parseKicadVersion, processLog } from "./tools.ts";
import { inspectBoard } from "./semantics.ts";
import { archiveName, writeZip } from "./zipWriter.ts";
import {
  boardHoleFacts,
  footprintParts,
  bomFromFootprints,
  lcscField,
  parseKicadBom,
  parseKicadPositions,
  genericBom,
  genericPositions,
  jlcpcbBom,
  jlcpcbCpl,
  parseRotationsCsv,
  circuitAssembly,
  inspectGerbers,
  evaluateChecklist,
  checklistText,
  type BomRow,
  type Position,
  type FabPart,
} from "./fabOutputs.ts";
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(PcbFabPackageManifest));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const fail = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
type Design = {
  root: string;
  workspaceKey: string;
  cwd: string;
  absolute: string;
  design: Pick<PcbDesign, "id" | "kind" | "boardPath" | "schematicPath">;
};
export function packageFolderName(stem: string, revision: string, hash: string, date: Date) {
  const clean = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 70);
  return `${clean(stem) || "board"}-${clean(revision) || "h" + hash.slice(0, 8)}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function gerberArgs(
  board: string,
  directory: string,
  layers: readonly string[],
  major: number,
) {
  const wanted = new Set([
    "F.Mask",
    "B.Mask",
    "F.Silkscreen",
    "B.Silkscreen",
    "F.Paste",
    "B.Paste",
    "Edge.Cuts",
  ]);
  const copper = layers
    .filter((l) => l.endsWith(".Cu"))
    .sort(
      (a, b) =>
        (a === "F.Cu" ? 0 : a === "B.Cu" ? 100 : Number(/\d+/.exec(a)?.[0] ?? 0)) -
        (b === "F.Cu" ? 0 : b === "B.Cu" ? 100 : Number(/\d+/.exec(b)?.[0] ?? 0)),
    );
  return [
    "pcb",
    "export",
    "gerbers",
    "--output",
    directory + "/",
    "--layers",
    [...copper, ...layers.filter((l) => wanted.has(l))].join(","),
    ...(major >= 10 ? ["--check-zones"] : []),
    board,
  ];
}
export function bomArgs(schematic: string, output: string, lcsc?: string) {
  return [
    "sch",
    "export",
    "bom",
    "--output",
    output,
    "--fields",
    "Reference,Value,Footprint,${QUANTITY},${DNP}" + (lcsc ? "," + lcsc : ""),
    "--labels",
    "Reference,Value,Footprint,Qty,DNP" + (lcsc ? ",LCSC" : ""),
    "--group-by",
    "Value,Footprint" + (lcsc ? "," + lcsc : ""),
    "--ref-range-delimiter",
    "",
    "--field-delimiter",
    ",",
    "--string-delimiter",
    '"',
    "--exclude-dnp",
    schematic,
  ];
}
/** Publish only complete packages. Each CLI step uses the service's existing tool lock. */
export const makeFabPackages = Effect.fn("PcbPreview.makeFabPackages")(function* <
  D extends Design,
>(deps: {
  cacheDir: string;
  cacheLock: Semaphore.Semaphore;
  resolve: (i: PcbFabPackagesInput) => Effect.Effect<D, PcbPreviewError | PlatformError>;
  snapshot: (d: D) => Effect.Effect<{ sourceHash: string }, PcbPreviewError | PlatformError>;
  tool: (d: D) => Effect.Effect<PcbToolStatus, PcbPreviewError | PlatformError>;
  safePath: (
    root: string,
    relative: string,
  ) => Effect.Effect<string, PcbPreviewError | PlatformError>;
  ensureDirectory: (
    root: string,
    relative: string,
  ) => Effect.Effect<string, PcbPreviewError | PlatformError>;
  run: (
    tool: PcbToolStatus,
    args: readonly string[],
    cwd: string,
    timeout: Duration.Input,
    tsci?: boolean,
    temporary?: string,
  ) => Effect.Effect<ProcessRunOutput, PcbPreviewError | PlatformError>;
  check: (i: PcbCheckInput) => Effect.Effect<PcbCheckResult, PcbPreviewError | PlatformError>;
  fabCheck: (
    i: PcbFabCheckInput,
  ) => Effect.Effect<PcbFabCheckResult, PcbPreviewError | PlatformError>;
  catalog: () => Effect.Effect<PcbFabCatalog, PcbPreviewError | PlatformError>;
  asset: (i: PcbAssetInput) => Effect.Effect<PcbAsset, PcbPreviewError | PlatformError>;
  circuitCwd: (d: D, directory: string) => Effect.Effect<string, PcbPreviewError | PlatformError>;
  sign: (file: string) => Effect.Effect<SignedFile, PcbPreviewError | PlatformError>;
  refresh: (root: string) => Effect.Effect<void, PcbPreviewError | PlatformError>;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    lock = yield* Semaphore.make(1);
  const packageDirectory = Effect.fn(function* (d: D, id: string) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(id))
      return yield* fail(
        "path-outside-workspace",
        "Choose a fabrication package in this workspace.",
      );
    const directory = path.join(d.root, "fab", id);
    if (
      (yield* fs.realPath(directory)) !== directory ||
      (yield* fs.stat(directory)).type !== "Directory"
    )
      return yield* fail("path-outside-workspace", "Package folders cannot be linked elsewhere.");
    return directory;
  });
  const read = Effect.fn(function* (d: D, id: string) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(id))
      return yield* fail(
        "path-outside-workspace",
        "Choose a fabrication package in this workspace.",
      );
    yield* packageDirectory(d, id);
    const file = yield* deps.safePath(d.root, `fab/${id}/loom-fab-package.json`);
    if (Number((yield* fs.stat(file)).size) > 256 * 1024)
      return yield* fail("source-limit", "Package manifest exceeds the limit.");
    const manifest = yield* decodeManifest(yield* fs.readFileString(file)).pipe(
      Effect.mapError(() => fail("invalid-report", "The package manifest is unreadable.")),
    );
    if (
      manifest.id !== id ||
      manifest.designId !== d.design.id ||
      manifest.workspacePath !== `fab/${id}`
    )
      return yield* fail("invalid-report", "This package belongs to another design.");
    return manifest;
  });
  const listManifests = Effect.fn(function* (input: PcbFabPackagesInput, reuseHash?: string) {
    const d = yield* deps.resolve(input);
    if (!(yield* fs.exists(path.join(d.root, "fab")))) return [];
    const root = path.join(d.root, "fab");
    if ((yield* fs.realPath(root)) !== root)
      return yield* fail(
        "path-outside-workspace",
        "The fabrication folder cannot be linked elsewhere.",
      );
    const values: PcbFabPackageManifest[] = [];
    const names = yield* fs.readDirectory(root);
    if (names.length > 2000)
      return yield* fail("source-limit", "Too many fabrication folders to list.");
    for (const id of names) {
      if (
        id.startsWith(".") ||
        (yield* fs.stat(path.join(root, id))).type !== "Directory" ||
        !(yield* fs.exists(path.join(root, id, "loom-fab-package.json")))
      )
        continue;
      const value = yield* read(d, id).pipe(Effect.orElseSucceed(() => null));
      if (value) {
        if (reuseHash) {
          if (value.inputHash === reuseHash) return [value];
        } else {
          values.push(value);
          values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          if (values.length > 50) values.length = 50;
        }
      }
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  });
  const unreadable = Effect.fn(function* (d: D, id: string) {
    const directory = yield* packageDirectory(d, id);
    const file = yield* deps.safePath(d.root, `fab/${id}/loom-fab-package.json`);
    if (Number((yield* fs.stat(file)).size) > 256 * 1024) return null;
    let raw: unknown = null;
    try {
      raw = decodeJson(yield* fs.readFileString(file));
    } catch {}
    if (raw && typeof raw === "object" && "designId" in raw && raw.designId !== d.design.id)
      return null;
    const stem =
      path
        .basename(d.design.boardPath ?? d.absolute)
        .replace(/\.kicad_pcb$|\.circuit\.[^.]+$|\.[^.]+$/i, "")
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 70) || "board";
    if (!id.startsWith(stem + "-") || !/-\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(id)) return null;
    const summary: PcbFabPackageSummary = {
      id,
      workspacePath: `fab/${id}`,
      designId: d.design.id,
      sourceHash: "unknown",
      profile: "generic",
      fabId: null,
      verdict: "not-ready",
      createdAt: "1970-01-01T00:00:00.000Z",
      unreadable: true,
    };
    return { summary, directory };
  });
  const list = Effect.fn(function* (input: PcbFabPackagesInput) {
    const d = yield* deps.resolve(input);
    const good = yield* listManifests(input);
    const values: PcbFabPackageSummary[] = good.map(
      ({ id, workspacePath, designId, sourceHash, profile, fabId, verdict, createdAt }) => ({
        id,
        workspacePath,
        designId,
        sourceHash,
        profile,
        fabId,
        verdict,
        createdAt,
      }),
    );
    const root = path.join(d.root, "fab");
    if (!(yield* fs.exists(root))) return values;
    for (const id of yield* fs.readDirectory(root)) {
      if (id.startsWith(".") || values.some((v) => v.id === id)) continue;
      const broken = yield* unreadable(d, id).pipe(Effect.orElseSucceed(() => null));
      if (broken) values.push(broken.summary);
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  });
  const sign = Effect.fn(function* (d: D, m: PcbFabPackageManifest) {
    const output = m.outputs.find((o) => o.kind === "zip");
    if (!output || !archiveName(output.path))
      return yield* fail("invalid-report", "The package has no valid Gerber zip.");
    const source = yield* deps.safePath(d.root, `fab/${m.id}/${output.path}`);
    const info = yield* fs.stat(source);
    if (info.type !== "File" || Number(info.size) > 128 * 1024 * 1024)
      return yield* fail("source-limit", "The package zip exceeds the download limit.");
    const bytes = yield* fs.readFile(source);
    const folder = path.join(
      deps.cacheDir,
      hashKey(
        d.workspaceKey,
        d.design.id,
        m.id,
        NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
      ),
    );
    return yield* deps.cacheLock.withPermit(
      Effect.gen(function* () {
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFile(path.join(folder, "package.zip"), bytes);
        yield* fs.writeFileString(
          path.join(folder, "manifest.json"),
          encodeJson({ kind: "fab-package", sourceHash: m.sourceHash, log: "" }),
        );
        return yield* deps.sign(path.join(folder, "package.zip"));
      }),
    );
  });
  const zip = Effect.fn(function* (
    input: PcbFabPackageRef,
  ): Effect.fn.Return<PcbFabPackageZip, PcbPreviewError | PlatformError> {
    const d = yield* deps.resolve(input),
      m = yield* read(d, input.packageId);
    return { zip: yield* sign(d, m), previewLayers: m.previewLayers, manifest: m };
  });
  const remove = Effect.fn(function* (input: PcbFabPackageRef) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const d = yield* deps.resolve(input);
        const valid = yield* read(d, input.packageId).pipe(Effect.orElseSucceed(() => null));
        if (!valid && !(yield* unreadable(d, input.packageId)))
          return yield* fail(
            "invalid-report",
            "Only recognized fabrication package folders can be deleted.",
          );
        const directory = yield* packageDirectory(d, input.packageId);
        if ((yield* fs.realPath(path.join(d.root, "fab"))) !== path.dirname(directory))
          return yield* fail(
            "path-outside-workspace",
            "Package folders cannot be linked elsewhere.",
          );
        yield* fs.remove(directory, { recursive: true });
        yield* deps.refresh(d.root).pipe(Effect.orElseSucceed(() => undefined));
      }),
    );
  });
  const collect = Effect.fn(function* (directory: string) {
    const files: { path: string; bytes: Uint8Array }[] = [];
    let size = 0;
    const visit = Effect.fn(function* (
      relative: string,
    ): Effect.fn.Return<void, PcbPreviewError | PlatformError> {
      const folder = path.join(directory, relative);
      for (const name of yield* fs.readDirectory(folder)) {
        const rel = relative ? `${relative}/${name}` : name;
        if (!archiveName(rel))
          return yield* fail("invalid-report", "An output has an invalid file name.");
        const absolute = path.join(directory, rel);
        if ((yield* fs.realPath(absolute)) !== absolute)
          return yield* fail(
            "path-outside-workspace",
            "Exported outputs must be regular files and folders.",
          );
        const stat = yield* fs.stat(absolute);
        if (stat.type === "Directory") {
          if (rel.split("/").length > 4)
            return yield* fail("source-limit", "Outputs are nested too deeply.");
          yield* visit(rel);
        } else if (stat.type === "File") {
          size += Number(stat.size);
          if (
            size > 256 * 1024 * 1024 ||
            Number(stat.size) > 128 * 1024 * 1024 ||
            files.length >= 198
          )
            return yield* fail("source-limit", "Fabrication outputs exceed the package limits.");
          files.push({ path: rel, bytes: yield* fs.readFile(absolute) });
        } else return yield* fail("invalid-report", "The exporter produced an unsupported file.");
      }
    });
    yield* visit("");
    return files;
  });
  const extract = Effect.fn(function* (archiveFile: string, target: string) {
    const archive = yield* openZipArchive(archiveFile, () =>
      fail("invalid-report", "The Gerber archive is invalid."),
    );
    if (archive.entryCount > 1000)
      return yield* fail("source-limit", "The Gerber archive has too many entries.");
    let total = 0;
    const names = new Set<string>();
    while (true) {
      const entry = yield* archive.next;
      if (!entry) break;
      const member = entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName;
      if (!archiveName(member))
        return yield* fail("path-outside-workspace", "Invalid Gerber archive member.");
      if (entry.fileName.endsWith("/")) continue;
      total += entry.uncompressedSize;
      if (total > 128 * 1024 * 1024 || entry.uncompressedSize > 32 * 1024 * 1024)
        return yield* fail("source-limit", "The Gerber archive exceeds the extraction limit.");
      const name = path.basename(member);
      if (names.has(name)) return yield* fail("invalid-report", "Duplicate Gerber archive names.");
      names.add(name);
      const readable = yield* archive.streamEntry(entry);
      const chunks = yield* NodeStream.fromReadable<Uint8Array, PcbPreviewError>({
        evaluate: () => readable,
        onError: () => fail("invalid-report", "A Gerber member could not be read."),
      }).pipe(Stream.runCollect);
      yield* fs.writeFile(path.join(target, name), Buffer.concat(chunks));
    }
  });
  const build = Effect.fn(function* (
    input: PcbFabPackageInput,
  ): Effect.fn.Return<PcbFabPackageResult, PcbPreviewError | PlatformError> {
    return yield* lock.withPermit(
      Effect.scoped(
        Effect.gen(function* () {
          const d = yield* deps.resolve(input);
          if (d.design.kind === "kicad" && !d.design.boardPath)
            return yield* fail("unsupported-view", "A fab package needs a board.");
          const snapshot = yield* deps.snapshot(d),
            tool = yield* deps.tool(d),
            root = yield* deps.ensureDirectory(d.root, "fab");
          const rotationsPath = path.join(root, "rotations.csv");
          let rotations = "";
          if (yield* fs.exists(rotationsPath)) {
            const safe = yield* deps.safePath(d.root, "fab/rotations.csv");
            if (Number((yield* fs.stat(safe)).size) > 256 * 1024)
              return yield* fail("source-limit", "Rotation rules exceed the size limit.");
            rotations = yield* fs.readFileString(safe);
          }
          const catalog = input.fabId ? yield* deps.catalog() : null;
          const capability = catalog
            ? [...catalog.builtIns, ...catalog.entries].find((c) => c.id === input.fabId)
            : null;
          if (input.fabId && !capability)
            return yield* fail("invalid-parameters", "Choose an existing fab profile.");
          const inputHash = hashKey(
            snapshot.sourceHash,
            input.profile,
            input.fabId ?? "",
            String(input.assembly),
            rotations,
            encodeJson(capability),
            tool.version ?? "",
          );
          if (!input.force) {
            const existing = (yield* listManifests(input, inputHash))[0];
            if (existing)
              return {
                ...existing,
                path: path.join(root, existing.id),
                zip: yield* sign(d, existing),
                reused: true,
              };
          }
          const created = yield* DateTime.now,
            createdAt = DateTime.formatIso(created),
            date = DateTime.toDateUtc(created),
            pending = yield* Effect.acquireRelease(
              fs.makeTempDirectory({ directory: root, prefix: ".pending-" }),
              (directory) =>
                fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
            ),
            gerbers = path.join(pending, "gerbers"),
            assembly = path.join(pending, "assembly"),
            reports = path.join(pending, "reports");
          yield* fs.makeDirectory(gerbers);
          yield* fs.makeDirectory(reports);
          if (input.assembly) yield* fs.makeDirectory(assembly);
          let bom: BomRow[] = [],
            positions: Position[] = [],
            parts: FabPart[] = [],
            drc: PcbCheckResult | null = null,
            erc: PcbCheckResult | null = null,
            fab: PcbFabCheckResult | null = null;
          let facts = { plated: false, npth: false, zones: false, revision: "", copperLayers: 2 };
          const logs: string[] = [],
            warnings: string[] = [];
          const major = parseKicadVersion(tool.version ?? "")?.major ?? 9;
          const stem =
            path
              .basename(d.design.boardPath ?? d.absolute)
              .replace(/\.kicad_pcb$|\.circuit\.[^.]+$|\.[^.]+$/i, "")
              .replace(/[^A-Za-z0-9._-]/g, "_")
              .slice(0, 70) || "board";
          const step = Effect.fn(function* (
            title: string,
            args: readonly string[],
            cwd = d.cwd,
            tsci = false,
            temporary?: string,
          ) {
            const result = yield* deps.run(tool, args, cwd, "180 seconds", tsci, temporary);
            logs.push(`${title}\n${processLog(result)}`);
            if (result.code !== 0 || result.timedOut)
              return yield* new PcbPreviewError({
                reason: "io-failed",
                message: `${title} could not finish. ${processLog(result).slice(-2000)}`,
                ...(result.code !== null ? { exitCode: result.code } : {}),
                timedOut: result.timedOut,
              });
          });
          if (d.design.kind === "kicad") {
            const board = yield* deps.safePath(d.root, d.design.boardPath!);
            if (Number((yield* fs.stat(board)).size) > 32 * 1024 * 1024)
              return yield* fail("source-limit", "The board exceeds the export size limit.");
            const source = yield* fs.readFileString(board);
            parts = yield* Effect.try({
              try: () => footprintParts(source),
              catch: () => fail("invalid-report", "The board could not be read."),
            });
            facts = boardHoleFacts(source);
            const inspection = inspectBoard(source, snapshot.sourceHash);
            yield* step("Gerber export", gerberArgs(board, gerbers, inspection.layers, major));
            yield* step("Drill export", [
              "pcb",
              "export",
              "drill",
              "--output",
              gerbers + "/",
              "--format",
              "excellon",
              "--drill-origin",
              "absolute",
              "--excellon-zeros-format",
              "decimal",
              "--excellon-oval-format",
              "alternate",
              "-u",
              "mm",
              "--excellon-separate-th",
              board,
            ]);
            if (input.assembly) {
              yield* step("Placement export", [
                "pcb",
                "export",
                "pos",
                "--output",
                path.join(assembly, "positions.csv"),
                "--side",
                "both",
                "--format",
                "csv",
                "--units",
                "mm",
                "--exclude-dnp",
                board,
              ]);
              const positionFiles = (yield* collect(assembly)).filter((f) =>
                /\.(csv|pos)$/i.test(f.path),
              );
              if (!positionFiles.length)
                return yield* fail("invalid-report", "KiCad produced no placement file.");
              positions = yield* Effect.try({
                try: () =>
                  positionFiles.flatMap((f) =>
                    parseKicadPositions(Buffer.from(f.bytes).toString("utf8")),
                  ),
                catch: () => fail("invalid-report", "KiCad placements could not be read."),
              });
              if (positionFiles.length !== 1 || positionFiles[0]?.path !== "positions.csv")
                yield* fs.writeFileString(
                  path.join(assembly, "positions.csv"),
                  genericPositions(positions),
                );
              if (d.design.schematicPath) {
                const schematic = yield* deps.safePath(d.root, d.design.schematicPath);
                const source = yield* fs.readFileString(schematic);
                yield* step(
                  "BOM export",
                  bomArgs(schematic, path.join(assembly, "bom.csv"), lcscField(source)),
                );
                const bomFile = (yield* collect(assembly)).find((f) => f.path === "bom.csv");
                if (!bomFile || bomFile.bytes.length > 16 * 1024 * 1024)
                  return yield* fail("invalid-report", "KiCad did not produce a bounded BOM file.");
                const bomText = Buffer.from(bomFile.bytes).toString("utf8");
                bom = yield* Effect.try({
                  try: () => parseKicadBom(bomText),
                  catch: () => fail("invalid-report", "KiCad BOM could not be read."),
                });
              } else {
                bom = bomFromFootprints(parts);
                yield* fs.writeFileString(path.join(assembly, "bom.csv"), genericBom(bom));
              }
              for (const side of parts.some((p) => p.side === "bottom" && !p.dnp)
                ? ["top", "bottom"]
                : ["top"]) {
                yield* step("Assembly drawing", [
                  "pcb",
                  "export",
                  "pdf",
                  "--output",
                  path.join(assembly, `assembly-${side}.pdf`),
                  "--mode-single",
                  "--layers",
                  `${side === "top" ? "F" : "B"}.Fab,Edge.Cuts`,
                  "--include-border-title",
                  "--black-and-white",
                  ...(side === "bottom" ? ["--mirror"] : []),
                  board,
                ]);
              }
            }
            drc = yield* deps.check({ ...input, kind: "drc" });
            yield* fs.writeFileString(path.join(reports, "drc.json"), encodeJson(drc));
            if (d.design.schematicPath) {
              erc = yield* deps.check({ ...input, kind: "erc" });
              yield* fs.writeFileString(path.join(reports, "erc.json"), encodeJson(erc));
            }
            if (input.fabId) {
              fab = yield* deps.fabCheck({ ...input, fabId: input.fabId });
              yield* fs.writeFileString(path.join(reports, "fab-check.json"), encodeJson(fab));
            }
          } else {
            if (input.fabId) warnings.push("Fab capability checks require a KiCad board.");
            const runtimeTemp = yield* fs.makeTempDirectoryScoped({
              prefix: "loom-fab-circuit-",
            });
            const cwd = yield* deps.circuitCwd(d, runtimeTemp),
              entry = path.join(cwd, path.relative(d.cwd, d.absolute));
            yield* step(
              "Circuit Gerber export",
              ["export", entry, "-f", "gerbers", "-o", path.join(pending, `${stem}-gerbers.zip`)],
              cwd,
              true,
              runtimeTemp,
            );
            yield* extract(path.join(pending, `${stem}-gerbers.zip`), gerbers);
            const asset = yield* deps.asset({ ...input, format: "circuit-json" });
            const circuit = yield* Effect.try({
              try: () => circuitAssembly(decodeJson(asset.data)),
              catch: () => fail("invalid-report", "Circuit JSON could not be read."),
            });
            facts = {
              ...facts,
              copperLayers: circuit.copperLayers,
              plated: circuit.plated,
              npth: circuit.npth,
            };
            parts = circuit.parts;
            positions = circuit.positions;
            bom = circuit.bom;
            if (input.assembly) {
              yield* fs.writeFileString(path.join(assembly, "bom.csv"), genericBom(bom));
              yield* fs.writeFileString(
                path.join(assembly, "positions.csv"),
                genericPositions(positions),
              );
              yield* step(
                "Circuit assembly export",
                ["export", entry, "-f", "assembly-svg", "-o", path.join(assembly, "assembly.svg")],
                cwd,
                true,
                runtimeTemp,
              );
            }
          }
          const rules = parseRotationsCsv(rotations);
          warnings.push(...rules.warnings);
          let corrected = 0;
          if (input.profile === "jlcpcb" && input.assembly) {
            const folder = path.join(pending, "jlcpcb");
            yield* fs.makeDirectory(folder);
            yield* fs.writeFileString(path.join(folder, "bom.csv"), jlcpcbBom(bom));
            const cpl = jlcpcbCpl(positions, parts, rules.rules);
            corrected = cpl.corrected;
            warnings.push(...cpl.warnings);
            yield* fs.writeFileString(path.join(folder, "cpl.csv"), cpl.text);
          }
          const gerberFiles = yield* collect(gerbers);
          const observed = inspectGerbers(
            gerberFiles.map((f) => ({
              path: `gerbers/${f.path}`,
              text: Buffer.from(f.bytes).toString("utf8"),
            })),
          );
          // Flatten the fabrication archive for manufacturer upload, including circuit exports.
          const bytes = yield* Effect.try({
            try: () =>
              writeZip(
                gerberFiles.map((f) => ({ name: f.path, bytes: f.bytes })),
                date,
              ),
            catch: () => fail("source-limit", "The fabrication archive exceeds its limits."),
          });
          yield* fs.writeFile(path.join(pending, `${stem}-gerbers.zip`), bytes);
          const result = evaluateChecklist({
            gerbers: observed,
            ...facts,
            kind: d.design.kind,
            drc,
            erc,
            fab,
            fabChosen: !!input.fabId,
            zones: facts.zones,
            refilled: d.design.kind === "kicad" && major >= 10,
            assembly: input.assembly,
            profile: input.profile,
            bom,
            positions,
            corrected,
          });
          yield* fs.writeFileString(
            path.join(pending, "CHECKLIST.md"),
            `# Fabrication checklist\n\n${result.verdict}\n\n${checklistText(result.checklist)}`,
          );
          if ((yield* deps.snapshot(d)).sourceHash !== snapshot.sourceHash)
            return yield* fail(
              "conflict",
              "The design changed while packaging. Create a package for the current revision.",
            );
          if (input.fabId) {
            const current = yield* deps.catalog();
            const entry = [...current.builtIns, ...current.entries].find(
              (c) => c.id === input.fabId,
            );
            if (encodeJson(entry ?? null) !== encodeJson(capability ?? null))
              return yield* fail("conflict", "Fab limits changed while packaging. Try again.");
          }
          if (
            rotations !==
            ((yield* fs.exists(rotationsPath))
              ? yield* fs.readFileString(yield* deps.safePath(d.root, "fab/rotations.csv"))
              : "")
          )
            return yield* fail("conflict", "Rotation rules changed while packaging. Try again.");
          const base = packageFolderName(stem, facts.revision, snapshot.sourceHash, date);
          let id = base;
          for (let n = 2; yield* fs.exists(path.join(root, id)); n++) {
            if (n > 1000) return yield* fail("source-limit", "Too many packages with this name.");
            id = `${base}-${n}`;
          }
          const outputFiles = yield* collect(pending);
          const outputs = outputFiles.map<PcbFabOutput>((f) => {
            const layer = observed.layers.find((l) => l.path === f.path);
            const kind = f.path.endsWith(".zip")
              ? ("zip" as const)
              : f.path.startsWith("gerbers/")
                ? layer?.type === "drill"
                  ? ("drill" as const)
                  : ("gerber" as const)
                : f.path.startsWith("reports/")
                  ? ("report" as const)
                  : f.path.endsWith("bom.csv")
                    ? ("bom" as const)
                    : f.path.endsWith("cpl.csv")
                      ? ("cpl" as const)
                      : f.path.endsWith("positions.csv")
                        ? ("positions" as const)
                        : f.path === "CHECKLIST.md"
                          ? ("checklist" as const)
                          : ("assembly" as const);
            return {
              path: f.path,
              kind,
              bytes: f.bytes.length,
              ...(layer ? { layer: layer.layer } : {}),
            };
          });
          const manifest: PcbFabPackageManifest = {
            id,
            workspacePath: `fab/${id}`,
            designId: d.design.id,
            sourceHash: snapshot.sourceHash,
            inputHash,
            profile: input.profile,
            fabId: input.fabId ?? null,
            assembly: input.assembly,
            ...result,
            createdAt,
            outputs,
            previewLayers: observed.layers,
            warnings: warnings.slice(0, 16).map((w) => w.slice(0, 400)),
            ...(tool.version ? { toolVersion: tool.version } : {}),
            log: logs.join("\n\n").slice(-64000),
          };
          outputs.push({ path: "loom-fab-package.json", kind: "manifest", bytes: 0 });
          for (let i = 0; i < 3; i++)
            outputs[outputs.length - 1] = {
              ...outputs.at(-1)!,
              bytes: Buffer.byteLength(encodeJson(manifest)),
            };
          yield* fs.writeFileString(
            path.join(pending, "loom-fab-package.json"),
            encodeJson(manifest),
          );
          const final = path.join(root, id);
          yield* fs.rename(pending, final);
          yield* deps.refresh(d.root).pipe(Effect.orElseSucceed(() => undefined));
          return { ...manifest, path: final, zip: yield* sign(d, manifest), reused: false };
        }),
      ),
    );
  });
  return { build, list, zip, remove };
});
