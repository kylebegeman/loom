// @effect-diagnostics nodeBuiltinImport:off
import * as Yauzl from "yauzl";
import type * as NodeStream from "node:stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ModelPreviewError } from "@t3tools/contracts/fork";
import type { CheckFile } from "./protocol.ts";
const isModelPreviewError = Schema.is(ModelPreviewError);
/** Expanded archive contents have an aggregate cap as well as an individual part cap. */
export const read3mfParts = (filename: string, maxBytes: number) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<CheckFile[]>((resolve, reject) => {
        Yauzl.open(filename, { lazyEntries: true, autoClose: false }, (cause, zip) => {
          if (cause || !zip) {
            reject(cause);
            return;
          }
          const files: CheckFile[] = [];
          let readable: NodeStream.Readable | undefined,
            total = 0,
            done = false;
          const finish = (cause: unknown) => {
            if (done) return;
            done = true;
            signal.removeEventListener("abort", abort);
            readable?.destroy();
            zip.close();
            if (cause) reject(cause);
            else resolve(files);
          };
          const abort = () => finish(new Error("cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) {
            abort();
            return;
          }
          zip.on("error", finish);
          zip.on("end", () => finish(null));
          zip.on("entry", (entry: Yauzl.Entry) => {
            const name = entry.fileName;
            if (!name.toLowerCase().endsWith(".model") && name !== "_rels/.rels") {
              zip.readEntry();
              return;
            }
            if (
              name.includes("\\") ||
              name.startsWith("/") ||
              name.split("/").includes("..") ||
              files.length >= 256 ||
              entry.uncompressedSize > maxBytes ||
              total + entry.uncompressedSize > maxBytes * 2
            ) {
              finish(
                new ModelPreviewError({
                  reason: "too-large",
                  message: "This 3MF archive is too large to check.",
                }),
              );
              return;
            }
            zip.openReadStream(entry, (cause, stream) => {
              if (cause || !stream) {
                finish(cause ?? new Error("missing stream"));
                return;
              }
              if (done) {
                stream.destroy();
                return;
              }
              readable = stream;
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on("error", finish);
              stream.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxBytes || total + size > maxBytes * 2) {
                  finish(
                    new ModelPreviewError({
                      reason: "too-large",
                      message: "This 3MF archive is too large to check.",
                    }),
                  );
                  return;
                }
                chunks.push(chunk);
              });
              stream.on("end", () => {
                if (done) return;
                total += size;
                const bytes = Uint8Array.from(Buffer.concat(chunks));
                files.push({ name, bytes });
                zip.readEntry();
              });
            });
          });
          zip.readEntry();
        });
      }),
    catch: (cause) =>
      isModelPreviewError(cause)
        ? cause
        : new ModelPreviewError({
            reason: "command-failed",
            message: "Could not read the 3MF archive.",
          }),
  });
