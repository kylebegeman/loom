// @effect-diagnostics nodeBuiltinImport:off -- Archive entry streams are a Node-only adapter boundary.
import * as Yauzl from "yauzl";
import type * as NodeStream from "node:stream";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { ModelPreviewError, type PrintEstimate } from "@t3tools/contracts/fork";
import { createGcodeParser } from "./gcode.ts";
const decodeProjectJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const isModelError = Schema.is(ModelPreviewError);
export const bambuArgs = (input: {
  dataDir: string;
  outputDir: string;
  mesh: string;
  machine: string;
  process: string;
  filaments: readonly string[];
}): readonly string[] => {
  if (
    [
      input.dataDir,
      input.outputDir,
      input.mesh,
      input.machine,
      input.process,
      ...input.filaments,
    ].some((value) => value.includes(";"))
  )
    throw new ModelPreviewError({
      reason: "invalid-path",
      message: "Slicer input paths cannot contain semicolons.",
    });
  return [
    "--datadir",
    input.dataDir,
    "--debug",
    "2",
    "--load-settings",
    `${input.machine};${input.process}`,
    "--load-filaments",
    input.filaments.join(";"),
    "--arrange",
    "1",
    "--orient",
    "0",
    "--slice",
    "0",
    "--outputdir",
    input.outputDir,
    "--export-3mf",
    "result.3mf",
    input.mesh,
  ];
};
const attributes = (text: string): Record<string, string> =>
  Object.fromEntries(
    [...text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [
      match[1]!,
      match[2]!
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    ]),
  );
const number = (value: string | undefined): number | null =>
  value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;
export const parseSliceInfo = (source: string) => {
  const plate = /<plate\b[^>]*>([\s\S]*?)<\/plate>/.exec(source)?.[1];
  if (!plate)
    throw new ModelPreviewError({
      reason: "command-failed",
      message: "The slicer exited without a result.",
    });
  const metadata = Object.fromEntries(
    [...plate.matchAll(/<metadata\b([^>]*)\/?\s*>/g)].map((match) => {
      const attrs = attributes(match[1]!);
      return [attrs.key, attrs.value];
    }),
  );
  const warnings = [...plate.matchAll(/<warning\b([^>]*)\/?\s*>/g)]
    .map((match) => attributes(match[1]!).msg)
    .filter((value): value is string => !!value)
    .slice(0, 49);
  if (metadata.outside === "true" || metadata.outside === "1")
    warnings.unshift("Part of the model is outside the plate.");
  return {
    printSeconds: number(metadata.prediction),
    totalGrams: number(metadata.weight),
    printerModelId: metadata.printer_model_id ?? null,
    supportUsed:
      metadata.support_used === undefined ? null : ["true", "1"].includes(metadata.support_used),
    warnings,
    filaments: [...plate.matchAll(/<filament\b([^>]*)\/?\s*>/g)]
      .slice(0, 16)
      .map((match, index) => {
        const attrs = attributes(match[1]!);
        return {
          slot: Math.max(0, (number(attrs.id) ?? index + 1) - 1),
          type: attrs.type ?? null,
          colorHex: attrs.color ?? null,
          lengthMm: number(attrs.used_m) === null ? null : number(attrs.used_m)! * 1000,
          grams: number(attrs.used_g),
        };
      }),
  };
};
export const verifyBambuResult = (
  info: ReturnType<typeof parseSliceInfo>,
  modelId: string | null,
  fallback?: { expected: string; actual: string | null },
): void => {
  if (info.printSeconds === null)
    throw new ModelPreviewError({
      reason: "command-failed",
      message: "The slicer exited without a result.",
    });
  if (
    info.printerModelId
      ? !modelId || info.printerModelId !== modelId
      : !fallback || fallback.actual !== fallback.expected
  )
    throw new ModelPreviewError({
      reason: "command-failed",
      message:
        "The slicer used a different printer than the mapping. Check the profiles in Loom settings.",
    });
};
/** Reads only plate 1, streaming its G-code; never extracts archive paths to the host. */
export const readBambuOutput = (
  filename: string,
  currency: string,
  modelId: string | null,
  printerModel: string | null = null,
) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<
        ReturnType<ReturnType<typeof createGcodeParser>["finish"]> & { warnings: string[] }
      >((resolve, reject) => {
        Yauzl.open(filename, { lazyEntries: true, autoClose: false }, (cause, zip) => {
          if (cause || !zip) {
            reject(
              new ModelPreviewError({
                reason: "command-failed",
                message: "The slicer exited without a result.",
              }),
            );
            return;
          }
          const parser = createGcodeParser(currency);
          let infoText = "",
            projectText = "",
            current: NodeStream.Readable | undefined,
            done = false,
            hasGcode = false;
          const finish = (error?: unknown) => {
            if (done) return;
            done = true;
            signal.removeEventListener("abort", abort);
            current?.destroy();
            zip.close();
            if (error) reject(error);
            else {
              try {
                const info = parseSliceInfo(infoText);
                let actualModel: string | null = null;
                if (!info.printerModelId && projectText) {
                  const json: unknown = decodeProjectJson(projectText);
                  if (
                    json !== null &&
                    typeof json === "object" &&
                    "printer_model" in json &&
                    typeof json.printer_model === "string"
                  )
                    actualModel = json.printer_model;
                }
                verifyBambuResult(
                  info,
                  modelId,
                  printerModel ? { expected: printerModel, actual: actualModel } : undefined,
                );
                if (!hasGcode)
                  throw new ModelPreviewError({
                    reason: "command-failed",
                    message: "The sliced project has no toolpaths.",
                  });
                const result = parser.finish();
                const estimate: PrintEstimate = {
                  ...result.estimate,
                  printSeconds: info.printSeconds,
                  totalGrams: info.totalGrams ?? result.estimate.totalGrams,
                  supportUsed: info.supportUsed ?? result.estimate.supportUsed,
                  filaments: info.filaments.length ? info.filaments : result.estimate.filaments,
                };
                resolve({ ...result, estimate, warnings: info.warnings });
              } catch (cause) {
                reject(cause);
              }
            }
          };
          const abort = () =>
            finish(
              new ModelPreviewError({
                reason: "command-failed",
                message: "Slicing was cancelled.",
              }),
            );
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) {
            abort();
            return;
          }
          zip.on("error", finish);
          zip.on("end", () => finish());
          zip.on("entry", (entry: Yauzl.Entry) => {
            const metadata = entry.fileName === "Metadata/slice_info.config",
              project = entry.fileName === "Metadata/project_settings.config",
              gcode = entry.fileName === "Metadata/plate_1.gcode";
            if (!metadata && !project && !gcode) {
              zip.readEntry();
              return;
            }
            if (
              entry.uncompressedSize >
              (metadata ? 512 * 1024 : project ? 2 * 1024 * 1024 : 2 * 1024 * 1024 * 1024)
            ) {
              finish(
                new ModelPreviewError({
                  reason: "too-large",
                  message: "The sliced project is too large to read.",
                }),
              );
              return;
            }
            zip.openReadStream(entry, (cause, stream) => {
              if (cause || !stream) {
                finish(cause ?? new Error("Missing archive stream"));
                return;
              }
              if (done) {
                stream.destroy();
                return;
              }
              current = stream;
              const decoder = new TextDecoder();
              let carry = "",
                bytes = 0;
              stream.on("error", finish);
              stream.on("data", (chunk: Buffer) => {
                try {
                  bytes += chunk.length;
                  if (bytes > entry.uncompressedSize)
                    throw new ModelPreviewError({
                      reason: "too-large",
                      message: "The sliced project has invalid entry sizes.",
                    });
                  const text = decoder.decode(chunk, { stream: true });
                  if (project) {
                    projectText += text;
                    return;
                  }
                  if (metadata) {
                    infoText += text;
                    return;
                  }
                  carry += text;
                  const lines = carry.split(/\r?\n/);
                  carry = lines.pop()!;
                  if (carry.length > 65536)
                    throw new ModelPreviewError({
                      reason: "command-failed",
                      message: "The slicer emitted an oversized G-code line.",
                    });
                  for (const line of lines) {
                    if (line.length > 65536)
                      throw new ModelPreviewError({
                        reason: "command-failed",
                        message: "The slicer emitted an oversized G-code line.",
                      });
                    parser.feed(line);
                  }
                } catch (cause) {
                  finish(cause);
                }
              });
              stream.on("end", () => {
                if (done) return;
                try {
                  if (project) projectText += decoder.decode();
                  else if (metadata) infoText += decoder.decode();
                  else {
                    parser.feed(carry + decoder.decode());
                    hasGcode = true;
                  }
                  zip.readEntry();
                } catch (cause) {
                  finish(cause);
                }
              });
            });
          });
          zip.readEntry();
        });
      }),
    catch: (cause) =>
      isModelError(cause)
        ? cause
        : new ModelPreviewError({
            reason: "command-failed",
            message: "Could not read the sliced project.",
          }),
  });
