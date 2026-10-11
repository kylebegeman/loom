// @effect-diagnostics nodeBuiltinImport:off -- Capture filenames use host-generated UUIDs.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { PcbPreviewError } from "@t3tools/contracts/fork";
import type { PlatformError } from "effect/PlatformError";
import { pickPruneVictims } from "./cache.ts";

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const CAPTURE_LIMITS = { maxCount: 50, maxBytes: 50 * 1024 * 1024 };
const CAPTURE_FILE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:png|svg)$/;
const SVG_ROOT = /^\s*(?:<\?xml\b[^?]*\?>\s*)?<svg(?:\s[^<>]*|)(?:\/>|>[\s\S]*<\/svg\s*>)\s*$/;

/** PNG and SVG editor captures share one bounded store and serialized retention policy. */
export const makeCaptureStore = Effect.fn("PcbPreview.makeCaptureStore")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    lock = yield* Semaphore.make(1);
  const saveCapture = Effect.fn("PcbPreview.saveCapture")(function* (input: {
    png?: string;
    svg?: string;
  }): Effect.fn.Return<string | undefined, PcbPreviewError | PlatformError> {
    if (input.png !== undefined && input.svg !== undefined)
      return yield* new PcbPreviewError({
        reason: "invalid-report",
        message: "Provide a PNG or SVG capture, not both.",
      });
    if (input.png === undefined && input.svg === undefined) return undefined;
    const extension = input.png !== undefined ? "png" : "svg";
    const bytes =
      input.png !== undefined ? Buffer.from(input.png, "base64") : Buffer.from(input.svg!, "utf8");
    if (
      extension === "png" &&
      (bytes.length > MAX_CAPTURE_BYTES ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    )
      return yield* new PcbPreviewError({
        reason: "invalid-report",
        message: "The editor capture must be a PNG under 8 MiB.",
      });
    if (extension === "svg" && (bytes.length > MAX_CAPTURE_BYTES || !SVG_ROOT.test(input.svg!)))
      return yield* new PcbPreviewError({
        reason: "invalid-report",
        message: "The editor capture must be an SVG under 8 MiB.",
      });
    yield* fs.makeDirectory(directory, { recursive: true });
    const fileName = `${NodeCrypto.randomUUID()}.${extension}`;
    const output = path.join(directory, fileName);
    yield* fs.writeFile(output, bytes);
    const names = yield* fs.readDirectory(directory);
    const records = yield* Effect.forEach(
      names.filter((name) => CAPTURE_FILE.test(name)),
      Effect.fnUntraced(function* (name) {
        const info = yield* fs.stat(path.join(directory, name));
        return info.type === "File"
          ? {
              key: name,
              bytes: Number(info.size),
              modified: Option.getOrNull(info.mtime)?.getTime() ?? 0,
              protected: name === fileName,
            }
          : null;
      }),
    );
    for (const victim of pickPruneVictims(
      records.filter((record) => record !== null),
      CAPTURE_LIMITS,
    ))
      yield* fs.remove(path.join(directory, victim));
    return output;
  }, lock.withPermit);
  return { saveCapture };
});
