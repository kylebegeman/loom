// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  ModelPreviewError,
  modelFormatOf,
  resolvePartPath,
  type AssemblyPart,
  type ModelFileRef,
  type ModelPreviewSettings,
  type ScadRenderInput,
  type ScadRenderResult,
} from "@t3tools/contracts/fork";
import { isContained } from "../signedFiles.ts";
import { read3mfParts } from "../check/readFiles.ts";
import type { CheckFile, CheckRequest } from "../check/protocol.ts";
const manifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      buffers: Schema.optionalKey(
        Schema.Array(Schema.Struct({ uri: Schema.optionalKey(Schema.String) })),
      ),
    }),
  ),
);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isModelPreviewError = Schema.is(ModelPreviewError);
const failure = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
export type AssemblyGeometry = {
  format: CheckRequest["format"];
  files: CheckFile[];
  geometryRevision: string;
};
export const assemblyVariant = (file: ModelFileRef, part: AssemblyPart, check = true) =>
  `${check ? "asmchk" : "asm"}-${NodeCrypto.createHash("sha256").update(file.path).digest("hex").slice(0, 8)}-${part.id}`;
export const makeAssemblyGeometry = (deps: {
  resolveFile: (
    file: ModelFileRef,
  ) => Effect.Effect<
    { root: string; absolute: string; info: FileSystem.File.Info },
    ModelPreviewError
  >;
  metadata: (info: FileSystem.File.Info) => { revision: string };
  getSettings: () => ModelPreviewSettings;
  renderModel: (input: ScadRenderInput) => Effect.Effect<ScadRenderResult, ModelPreviewError>;
  protectStem: (stem: string) => Effect.Effect<unknown, never, Scope.Scope>;
  cacheDir: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path,
      manifests = new Map<string, { revision: string; buffers: string[] }>();
    const readFiles = Effect.fn("Assembly.geometryFiles")(function* (
      absolute: string,
      root: string,
      format: CheckRequest["format"],
      maxBytes: number,
    ) {
      if (format === "3mf")
        return {
          files: yield* read3mfParts(absolute, maxBytes),
          revisions: [] as [string, string][],
        };
      const bytes = Uint8Array.from(yield* fs.readFile(absolute));
      if (bytes.length > maxBytes)
        return yield* failure("too-large", "This part exceeds the model file size limit.");
      const files: CheckFile[] = [{ name: path.basename(absolute), bytes }],
        revisions: [string, string][] = [];
      if (format !== "gltf" && format !== "glb") return { files, revisions };
      let text: string;
      if (format === "gltf") text = new TextDecoder().decode(bytes);
      else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (
          bytes.length < 20 ||
          view.getUint32(0, true) !== 0x46546c67 ||
          view.getUint32(4, true) !== 2 ||
          view.getUint32(16, true) !== 0x4e4f534a
        )
          return yield* failure("command-failed", "This glTF part is damaged.");
        const size = view.getUint32(12, true);
        if (size > 64 * 1024 * 1024 || 20 + size > bytes.length)
          return yield* failure("command-failed", "This glTF part is damaged.");
        text = new TextDecoder().decode(bytes.subarray(20, 20 + size)).trimEnd();
      }
      const doc = yield* manifest(text).pipe(
        Effect.mapError(() => failure("command-failed", "This glTF part is damaged.")),
      );
      const uris = [
        ...new Set(
          (doc.buffers ?? []).flatMap((buffer) =>
            buffer.uri && !buffer.uri.startsWith("data:") ? [buffer.uri] : [],
          ),
        ),
      ];
      if (uris.length > 512)
        return yield* failure("too-large", "This glTF part references too many buffers.");
      let total = bytes.length;
      for (const encoded of uris) {
        const uri = yield* Effect.try({
          try: () => decodeURIComponent(encoded),
          catch: () => failure("invalid-path", "This part has an invalid buffer path."),
        });
        if (
          path.isAbsolute(uri) ||
          /[\\\0?#]/.test(uri) ||
          uri.split("/").includes("..") ||
          /^[a-z][a-z0-9+.-]*:/i.test(uri)
        )
          return yield* failure(
            "invalid-path",
            "Part buffers must remain inside the model directory.",
          );
        const directory = path.dirname(absolute),
          target = yield* fs.realPath(path.resolve(directory, uri));
        if (!isContained(root, target) || !isContained(directory, target))
          return yield* failure(
            "invalid-path",
            "Part buffers must remain inside the model directory.",
          );
        const info = yield* fs.stat(target);
        total += Number(info.size);
        if (info.type !== "File" || Number(info.size) > maxBytes || total > maxBytes * 2)
          return yield* failure(
            "too-large",
            "This part and its buffers exceed the model file size limit.",
          );
        const buffer = Uint8Array.from(yield* fs.readFile(target));
        files.push({ name: encoded, bytes: buffer });
        revisions.push([encoded, deps.metadata(info).revision]);
      }
      return { files, revisions };
    });
    const geometry = Effect.fn("Assembly.geometry")(
      function* (assemblyFile: ModelFileRef, part: AssemblyPart, allowLarge = false) {
        const partPath = resolvePartPath(assemblyFile.path, part.path);
        if (!partPath)
          return yield* failure("invalid-path", "Part paths must remain inside the workspace.");
        const file = { ...assemblyFile, path: partPath },
          resolved = yield* deps.resolveFile(file),
          kind = modelFormatOf(partPath);
        if (!kind) return yield* failure("unsupported-format", "Choose a supported model part.");
        const maxBytes = allowLarge
          ? 512 * 1024 * 1024
          : deps.getSettings().maxFileMegabytes * 1024 * 1024;
        if (Number(resolved.info.size) > maxBytes)
          return yield* failure("too-large", "This part exceeds the model file size limit.");
        if (kind === "scad" || kind === "step" || kind === "build123d") {
          const rendered = yield* deps.renderModel({
            file,
            overrides: part.parameters,
            parameterSet: part.parameterSet,
            variantId: assemblyVariant(assemblyFile, part),
          });
          if (rendered.status !== "ok" || !rendered.mesh || !rendered.meshFormat)
            return yield* failure("command-failed", "Could not render this assembly part.");
          const stem = path.join(deps.cacheDir, rendered.mesh.revision);
          yield* deps.protectStem(stem);
          const loaded = yield* readFiles(
            `${stem}.${rendered.meshFormat}`,
            deps.cacheDir,
            rendered.meshFormat,
            maxBytes,
          );
          return {
            format: rendered.meshFormat,
            files: loaded.files,
            geometryRevision: rendered.mesh.revision,
          };
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          const before = yield* deps.resolveFile(file),
            loaded = yield* readFiles(before.absolute, before.root, kind, maxBytes),
            after = yield* fs.stat(before.absolute);
          if (deps.metadata(before.info).revision === deps.metadata(after).revision) {
            let changed = false;
            for (const [name, revision] of loaded.revisions) {
              const target = path.join(path.dirname(before.absolute), decodeURIComponent(name));
              if (deps.metadata(yield* fs.stat(target)).revision !== revision) changed = true;
            }
            if (!changed) {
              manifests.delete(before.absolute);
              manifests.set(before.absolute, {
                revision: deps.metadata(after).revision,
                buffers: loaded.revisions.map(([name]) => name),
              });
              while (manifests.size > 128) manifests.delete(manifests.keys().next().value!);
              return {
                format: kind,
                files: loaded.files,
                geometryRevision: NodeCrypto.createHash("sha256")
                  .update(json([deps.metadata(after).revision, loaded.revisions]))
                  .digest("hex")
                  .slice(0, 24),
              };
            }
          }
        }
        return yield* failure("command-failed", "This part changed while reading it. Check again.");
      },
      (effect) =>
        effect.pipe(
          Effect.mapError((cause) =>
            isModelPreviewError(cause)
              ? cause
              : failure("command-failed", "Could not read this assembly part."),
          ),
        ),
    );
    /** Probe known dependencies without downloading geometry for an unchanged cached check. */
    const revisionOf = Effect.fn("Assembly.geometryRevision")(
      function* (assemblyFile: ModelFileRef, part: AssemblyPart, allowLarge = false) {
        const partPath = resolvePartPath(assemblyFile.path, part.path);
        if (!partPath) return null;
        const file = { ...assemblyFile, path: partPath },
          resolved = yield* deps.resolveFile(file),
          kind = modelFormatOf(partPath);
        if (!kind) return null;
        const maxBytes = allowLarge
          ? 512 * 1024 * 1024
          : deps.getSettings().maxFileMegabytes * 1024 * 1024;
        if (Number(resolved.info.size) > maxBytes) return null;
        if (kind === "scad" || kind === "build123d" || kind === "step") {
          const rendered = yield* deps.renderModel({
            file,
            overrides: part.parameters,
            parameterSet: part.parameterSet,
            variantId: assemblyVariant(assemblyFile, part),
          });
          if (rendered.status !== "ok" || !rendered.mesh || !rendered.meshFormat) return null;
          const info = yield* fs.stat(
            path.join(deps.cacheDir, `${rendered.mesh.revision}.${rendered.meshFormat}`),
          );
          return info.type === "File" && Number(info.size) <= maxBytes
            ? rendered.mesh.revision
            : null;
        }
        const revision = deps.metadata(resolved.info).revision;
        const previous = manifests.get(resolved.absolute);
        if ((kind === "gltf" || kind === "glb") && previous?.revision !== revision) return null;
        const revisions: [string, string][] = [];
        let total = Number(resolved.info.size);
        for (const name of previous?.buffers ?? []) {
          const directory = path.dirname(resolved.absolute),
            target = yield* fs.realPath(path.resolve(directory, decodeURIComponent(name)));
          if (!isContained(resolved.root, target) || !isContained(directory, target)) return null;
          const info = yield* fs.stat(target);
          total += Number(info.size);
          if (info.type !== "File" || Number(info.size) > maxBytes || total > maxBytes * 2)
            return null;
          revisions.push([name, deps.metadata(info).revision]);
        }
        return NodeCrypto.createHash("sha256")
          .update(json([revision, revisions]))
          .digest("hex")
          .slice(0, 24);
      },
      (effect) => effect.pipe(Effect.catch(() => Effect.succeed(null))),
    );
    return { geometry, revisionOf };
  });
