// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeStream from "node:stream";
import * as Yauzl from "yauzl";
import * as Effect from "effect/Effect";
import { ModelPreviewError, THREE_MF_UNIT_MM } from "@t3tools/contracts/fork";

const MAX_HEADER_BYTES = 64 * 1024;
const invalid = (message: string) => new ModelPreviewError({ reason: "command-failed", message });
/** OpenSCAD imports raw 3MF coordinates. Read just the root model's unit, never
 * extract the archive or buffer the mesh, and release the stream on cancellation. */
export const threeMfScale = (filename: string) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<number>((resolve, reject) => {
        Yauzl.open(filename, { lazyEntries: true, autoClose: false }, (error, zip) => {
          if (error || !zip) {
            reject(error ?? invalid("Could not open the 3MF archive."));
            return;
          }
          let readable: NodeStream.Readable | undefined;
          let done = false;
          const finish = (error: unknown, scale?: number) => {
            if (done) return;
            done = true;
            signal.removeEventListener("abort", abort);
            readable?.destroy();
            zip.close();
            if (error) reject(error);
            else resolve(scale!);
          };
          const abort = () => finish(invalid("3MF unit read cancelled."));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) {
            abort();
            return;
          }
          zip.on("error", (error: unknown) => finish(error));
          zip.on("end", () => finish(invalid("The 3MF archive has no root model.")));
          zip.on("entry", (entry: Yauzl.Entry) => {
            if (entry.fileName.toLowerCase() !== "3d/3dmodel.model") {
              zip.readEntry();
              return;
            }
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream) {
                finish(error ?? invalid("Could not read the 3MF model."));
                return;
              }
              if (done) {
                stream.destroy();
                return;
              }
              readable = stream;
              let header = "";
              stream.on("error", (error: unknown) => finish(error));
              stream.on("end", () => finish(invalid("The 3MF model has no unit header.")));
              stream.on("data", (chunk: Buffer) => {
                header += chunk.toString("utf8");
                const model = /<(?:[\w.-]+:)?model\b([^>]*)>/.exec(header);
                if (model) {
                  const unit = /\bunit\s*=\s*["']([^"']+)["']/.exec(model[1]!)?.[1] ?? "millimeter";
                  const scale = THREE_MF_UNIT_MM[unit as keyof typeof THREE_MF_UNIT_MM];
                  if (scale === undefined) finish(invalid(`Unsupported 3MF unit: ${unit}`));
                  else finish(null, scale);
                } else if (header.length > MAX_HEADER_BYTES)
                  finish(invalid("The 3MF model header is too large."));
              });
            });
          });
          zip.readEntry();
        });
      }),
    catch: (cause) => invalid(cause instanceof Error ? cause.message : "Could not read 3MF units."),
  });
