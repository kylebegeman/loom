import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";
import { SignedFile } from "./model-files.ts";

const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const layers = Schema.Array(text(64)).check(Schema.isMaxLength(64));
export const PcbPrintSide = Schema.Literals(["top", "bottom"]);
export type PcbPrintSide = typeof PcbPrintSide.Type;
export const PcbPrintPaper = Schema.Literals(["board", "A4", "USLetter", "A3", "USLedger"]);
export type PcbPrintPaper = typeof PcbPrintPaper.Type;
export const PcbPrintInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  side: PcbPrintSide.pipe(Schema.withDecodingDefault(Effect.succeed("top" as const))),
  /** Empty uses side defaults. A string selects an L56 preset by id or name. */
  layers: Schema.optional(Schema.Union([layers, text(100)])),
  mirror: Schema.optional(Schema.Boolean),
  paper: PcbPrintPaper.pipe(Schema.withDecodingDefault(Effect.succeed("board" as const))),
  blackAndWhite: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  save: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type PcbPrintInput = typeof PcbPrintInput.Type;
export const PcbPrintResult = Schema.Struct({
  file: SignedFile,
  fileName: text(200).check(Schema.isPattern(/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.pdf$/)),
  workspacePath: Schema.optional(text(4096)),
  path: Schema.optional(text(4096)),
  sourceHash: text(200),
  side: PcbPrintSide,
  layers,
  mirrored: Schema.Boolean,
  paper: PcbPrintPaper,
  boardMm: Schema.NullOr(
    Schema.Struct({
      width: Schema.Number.check(Schema.isFinite()),
      height: Schema.Number.check(Schema.isFinite()),
    }),
  ),
  warnings: Schema.Array(text(400)).check(Schema.isMaxLength(8)),
  toolVersion: Schema.optional(text(100)),
  log: Schema.String.check(Schema.isMaxLength(64000)),
});
export type PcbPrintResult = typeof PcbPrintResult.Type;
export const defaultPrintLayers = (side: PcbPrintSide) => {
  const prefix = side === "bottom" ? "B" : "F";
  return [`${prefix}.Cu`, `${prefix}.Silkscreen`, `${prefix}.Courtyard`, "Edge.Cuts"];
};
