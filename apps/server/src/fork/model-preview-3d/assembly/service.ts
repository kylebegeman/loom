import type { BoardFeatures } from "../../pcb-preview/enclosure/features.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ASSEMBLY_FILE_VERSION,
  ASSEMBLY_MAX_BYTES,
  ASSEMBLY_MAX_OPERATIONS,
  ModelAssembly,
  ModelPreviewError,
  isAssemblyPath,
  modelFormatOf,
  resolvePartPath,
  validateAssembly,
  type AssemblyReadResult,
  type AssemblyOperation,
  type AssemblyBounds,
  type ModelFileRef,
} from "@t3tools/contracts/fork";
import { isContained } from "../signedFiles.ts";
import { applyOperations } from "./operations.ts";
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelAssembly));
const encode = Schema.encodeSync(Schema.fromJsonString(ModelAssembly, { space: 2 }));
const error = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
export const makeAssemblies = Effect.fn("Assembly.makeAssemblies")(function* (deps: {
  resolveWorkspace: (
    file: ModelFileRef,
  ) => Effect.Effect<{ root: string; absolute: string }, ModelPreviewError>;
  resolveFile: (
    file: ModelFileRef,
  ) => Effect.Effect<
    { root: string; absolute: string; info: FileSystem.File.Info },
    ModelPreviewError
  >;
  features?: (
    file: ModelFileRef,
    part: ModelAssembly["parts"][number],
  ) => Effect.Effect<BoardFeatures, ModelPreviewError>;
  metadata: (info: FileSystem.File.Info) => { revision: string };
  boundsOf: (
    file: ModelFileRef,
    part: ModelAssembly["parts"][number],
  ) => Effect.Effect<AssemblyBounds, ModelPreviewError>;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    locks = new Map<string, Semaphore.Semaphore>();
  const read = Effect.fn("Assembly.read")(function* (
    file: ModelFileRef,
  ): Effect.fn.Return<AssemblyReadResult, ModelPreviewError> {
    if (!isAssemblyPath(file.path))
      return yield* error("unsupported-format", "Choose a .loom-assembly.json file.");
    const resolved = yield* deps.resolveFile(file);
    if (Number(resolved.info.size) > ASSEMBLY_MAX_BYTES)
      return yield* error("too-large", "This assembly file is larger than 256 KB.");
    const bytes = yield* fs
      .readFile(resolved.absolute)
      .pipe(Effect.mapError(() => error("command-failed", "Could not read this assembly.")));
    if (bytes.byteLength > ASSEMBLY_MAX_BYTES)
      return yield* error("too-large", "This assembly file is larger than 256 KB.");
    const doc = yield* decode(new TextDecoder().decode(bytes)).pipe(
      Effect.mapError((cause) =>
        error("invalid-parameter", `Invalid assembly: ${cause.message.slice(0, 1000)}`),
      ),
    );
    const problem = validateAssembly(doc, file.path);
    if (problem) return yield* error("invalid-parameter", `${problem.path}: ${problem.message}`);
    const parts = yield* Effect.forEach(
      doc.parts,
      (part) =>
        Effect.gen(function* () {
          const relative = resolvePartPath(file.path, part.path),
            format = relative ? modelFormatOf(relative) : null;
          if (!relative)
            return {
              id: part.id,
              path: null,
              format: null,
              sizeBytes: null,
              revision: null,
              error: "Part paths must remain inside the workspace.",
            };
          if (!format)
            return {
              id: part.id,
              path: relative,
              format: null,
              sizeBytes: null,
              revision: null,
              error: "Choose a supported model file.",
            };
          return yield* deps.resolveFile({ ...file, path: relative }).pipe(
            Effect.map((resolved) => ({
              id: part.id,
              path: relative,
              format,
              sizeBytes: Number(resolved.info.size),
              revision: deps.metadata(resolved.info).revision,
              error: null,
            })),
            Effect.catch(() =>
              Effect.succeed({
                id: part.id,
                path: relative,
                format,
                sizeBytes: null,
                revision: null,
                error: "The file was deleted, moved or points outside the workspace.",
              }),
            ),
          );
        }),
      { concurrency: 8 },
    );
    return {
      path: file.path,
      revision: NodeCrypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24),
      assembly: doc,
      readOnly: doc.version > ASSEMBLY_FILE_VERSION,
      parts,
    };
  });
  const updateAssembly = Effect.fn("Assembly.update")(function* (input: {
    file: ModelFileRef;
    operations: readonly AssemblyOperation[];
    expectedRevision?: string;
    createOnly?: boolean;
  }) {
    if (!isAssemblyPath(input.file.path))
      return yield* error("unsupported-format", "Choose a .loom-assembly.json file.");
    if (!input.operations.length || input.operations.length > ASSEMBLY_MAX_OPERATIONS)
      return yield* error("invalid-parameter", "Apply between 1 and 64 assembly operations.");
    const location = yield* deps.resolveWorkspace(input.file);
    const parent = yield* fs
      .realPath(path.dirname(location.absolute))
      .pipe(Effect.mapError(() => error("not-found", "Create the assembly folder first.")));
    if (!isContained(location.root, parent))
      return yield* error("invalid-path", "Choose an assembly folder inside the workspace.");
    const absolute = path.join(parent, path.basename(location.absolute));
    const lock = yield* Effect.sync(() => {
      const existing = locks.get(absolute);
      if (existing) return existing;
      const created = Semaphore.makeUnsafe(1);
      locks.set(absolute, created);
      return created;
    });
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const exists = yield* fs.exists(absolute);
        if (exists && input.createOnly)
          return yield* error(
            "conflict",
            "An assembly already exists at this path. Choose another name.",
          );
        if (!exists && input.expectedRevision !== undefined)
          return yield* error("not-found", "The assembly was deleted or moved.");
        const current = exists ? yield* read(input.file) : null;
        if (current?.readOnly)
          return yield* error(
            "conflict",
            "This assembly was saved by a newer Loom. It opens read-only.",
          );
        if (input.expectedRevision !== undefined && input.expectedRevision !== current?.revision)
          return yield* error(
            "conflict",
            "The assembly changed since you read it. Read it again and retry.",
          );
        const doc = current?.assembly ?? {
          enclosure: null,
          format: "loom-assembly" as const,
          version: ASSEMBLY_FILE_VERSION,
          units: "mm" as const,
          name: path.basename(input.file.path).replace(/\.loom-assembly\.json$/i, ""),
          parts: [],
          clearances: [],
        };
        const next = yield* applyOperations(doc, input.operations, {
          assemblyPath: input.file.path,
          ...(deps.features
            ? {
                features: (part: ModelAssembly["parts"][number]) =>
                  deps.features!(input.file, part),
              }
            : {}),
          addPath: (partPath) =>
            deps.resolveFile({ ...input.file, path: partPath }).pipe(
              Effect.flatMap(() =>
                modelFormatOf(partPath)
                  ? Effect.void
                  : Effect.fail(error("unsupported-format", "Choose a supported part model.")),
              ),
              Effect.asVoid,
            ),
          bounds: (id, state) => {
            const part = state.parts.find((p) => p.id === id);
            return part
              ? deps.boundsOf(input.file, part)
              : Effect.fail(error("invalid-parameter", `No part with id "${id}".`));
          },
        });
        const text = encode(next) + "\n";
        if (new TextEncoder().encode(text).byteLength > ASSEMBLY_MAX_BYTES)
          return yield* error("too-large", "This assembly file is larger than 256 KB.");
        const temporary = path.join(
          parent,
          `.${path.basename(absolute)}.${NodeCrypto.randomUUID()}.tmp`,
        );
        yield* Effect.acquireUseRelease(
          fs.writeFileString(temporary, text, { flag: "wx" }),
          () => fs.rename(temporary, absolute),
          () => fs.remove(temporary, { force: true }).pipe(Effect.catch(() => Effect.void)),
        ).pipe(Effect.mapError(() => error("command-failed", "Could not save this assembly.")));
        return yield* read(input.file);
      }),
    );
  });
  return { assembly: read, updateAssembly };
});
