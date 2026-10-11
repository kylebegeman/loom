import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import {
  PcbPreviewError,
  buildPinMap,
  renderPinMap,
  pinMapFileName,
  validateIdentifier,
  type PcbInspection,
  type PcbPinMapInput,
} from "@t3tools/contracts/fork";

const error = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
export const makePinMap = Effect.fn("PcbPreview.makePinMap")(function* (deps: {
  inspect: (input: PcbPinMapInput) => Effect.Effect<PcbInspection, PcbPreviewError>;
  root: (input: PcbPinMapInput) => Effect.Effect<string, PcbPreviewError>;
  hash: (input: PcbPinMapInput) => Effect.Effect<string, PcbPreviewError>;
  refresh: (root: string) => Effect.Effect<void>;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    lock = yield* Semaphore.make(1);
  return Effect.fn("PcbPreview.pinMap")(function* (input: PcbPinMapInput) {
    const inspection = yield* deps.inspect(input);
    if (input.expectedSourceHash && input.expectedSourceHash !== inspection.sourceHash)
      return yield* error("conflict", "The design changed. Review the pin map again.");
    const map = buildPinMap(inspection, input.reference, input);
    if (!map) return yield* error("invalid-parameters", "That part is no longer in this design.");
    const pins = new Set(map.rows.map((row) => row.pin));
    if (Object.keys(input.names ?? {}).some((pin) => !pins.has(pin)))
      return yield* error(
        "invalid-parameters",
        "A constant name refers to a pin that is no longer in this design.",
      );
    const used = new Set<string>();
    for (const row of map.rows) {
      const reason = validateIdentifier(row.identifier, input.format);
      if (reason || used.has(row.identifier))
        return yield* error("invalid-parameters", reason ?? "Constant names must be unique.");
      used.add(row.identifier);
    }
    const format = map.formats.find((f) => f.format === input.format);
    if (!format?.available)
      return yield* error("invalid-parameters", format?.reason ?? "Choose an available format.");
    const text = renderPinMap(map, input.format, {
      designId: input.designId,
      sourceHash: inspection.sourceHash,
    });
    if (text.length > 512 * 1024)
      return yield* error("invalid-parameters", "The generated pin map exceeds the output limit.");
    let saved: { path: string; bytes: number } | null = null;
    if (input.save) {
      const save = input.save;
      const filename = pinMapFileName(input.format);
      if (!filename)
        return yield* error("invalid-parameters", "Copy the Markdown instead of saving it.");
      if (path.extname(save.path) !== path.extname(filename))
        return yield* error(
          "invalid-parameters",
          "Choose a filename with the generated format's extension.",
        );
      if (
        path.isAbsolute(save.path) ||
        save.path.includes("\\") ||
        save.path.includes("\0") ||
        save.path.split("/").some((part) => part === ".." || part.startsWith("."))
      )
        return yield* error("path-outside-workspace", "Choose a file inside the workspace.");
      const root = yield* deps.root(input);
      const parent = yield* fs
        .realPath(path.join(root, path.dirname(save.path)))
        .pipe(
          Effect.mapError(() =>
            error("invalid-parameters", "Create the destination folder first."),
          ),
        );
      const relative = path.relative(root, parent);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return yield* error(
          "path-outside-workspace",
          "The destination points outside the workspace.",
        );
      const file = path.join(parent, path.basename(save.path));
      yield* lock
        .withPermit(
          Effect.gen(function* () {
            if ((yield* deps.hash(input)) !== inspection.sourceHash)
              return yield* error("conflict", "The design changed. Review the pin map again.");
            const link = yield* fs.readLink(file).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            );
            if (link)
              return yield* error(
                "invalid-parameters",
                "Choose a regular file, not a symbolic link.",
              );
            const exists = yield* fs.exists(file);
            if (exists && (yield* fs.stat(file)).type !== "File")
              return yield* error("invalid-parameters", "Choose a regular file.");
            if (exists && !save.overwrite)
              return yield* error(
                "conflict",
                "A file already exists at this path. Confirm Replace to overwrite it.",
              );
            if (exists)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  // Rename the entry itself. The shared atomic helper follows symlinks, which is wrong
                  // for a workspace export that must never rewrite a link's destination.
                  const temporary = yield* fs.makeTempDirectoryScoped({
                    directory: parent,
                    prefix: "pin-map-",
                  });
                  const contents = path.join(temporary, "contents");
                  yield* fs.writeFileString(contents, text);
                  yield* fs.rename(contents, file);
                }),
              );
            else yield* fs.writeFileString(file, text, { flag: "wx" });
          }),
        )
        .pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.catch((cause) =>
            Effect.fail(
              cause._tag === "PcbPreviewError"
                ? cause
                : error(
                    "io-failed",
                    "The pin map could not be saved. Check the destination and try again.",
                  ),
            ),
          ),
        );
      yield* deps.refresh(root);
      saved = { path: save.path, bytes: Buffer.byteLength(text) };
    }
    return { sourceHash: inspection.sourceHash, map, format: input.format, text, saved };
  });
});
