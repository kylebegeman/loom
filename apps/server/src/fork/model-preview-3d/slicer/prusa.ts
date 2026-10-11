import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ModelPreviewError } from "@t3tools/contracts/fork";
import { createGcodeParser } from "./gcode.ts";
export const prusaArgs = (input: {
  dataDir: string;
  config: string;
  output: string;
  mesh: string;
}): readonly string[] => [
  "--datadir",
  input.dataDir,
  "--load",
  input.config,
  "--export-gcode",
  "--binary-gcode",
  "0",
  "--output",
  input.output,
  input.mesh,
];
export const readPrusaOutput = Effect.fn("Slicer.readPrusaOutput")(function* (
  filename: string,
  currency: string,
) {
  const fs = yield* FileSystem.FileSystem,
    parser = createGcodeParser(currency),
    decoder = new TextDecoder();
  let carry = "";
  yield* fs.stream(filename).pipe(
    Stream.runForEach((chunk) =>
      Effect.try({
        try: () => {
          carry += decoder.decode(chunk, { stream: true });
          const lines = carry.split(/\r?\n/);
          carry = lines.pop()!;
          if (carry.length > 65536) throw new Error("oversized");
          for (const line of lines) {
            if (line.length > 65536) throw new Error("oversized");
            parser.feed(line);
          }
        },
        catch: () =>
          new ModelPreviewError({
            reason: "command-failed",
            message: "The slicer emitted invalid G-code.",
          }),
      }),
    ),
    Effect.mapError(
      () =>
        new ModelPreviewError({
          reason: "command-failed",
          message: "The slicer exited without a result.",
        }),
    ),
  );
  parser.feed(carry + decoder.decode());
  const result = parser.finish();
  if (result.estimate.printSeconds === null)
    return yield* new ModelPreviewError({
      reason: "command-failed",
      message: "The slicer exited without a result.",
    });
  return { ...result, warnings: [] as string[] };
});
