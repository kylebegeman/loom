import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";
import { PcbPrintInput, defaultPrintLayers } from "./pcb-print.ts";
const decode = Schema.decodeUnknownSync(PcbPrintInput);
const base = { threadId: ThreadId.make("print-thread"), designId: "board.kicad_pcb" };
it("defaults to a top black-and-white PDF without saving", () => {
  expect(decode(base)).toEqual({
    ...base,
    side: "top",
    paper: "board",
    blackAndWhite: true,
    save: false,
  });
  expect(defaultPrintLayers("bottom")).toEqual([
    "B.Cu",
    "B.Silkscreen",
    "B.Courtyard",
    "Edge.Cuts",
  ]);
});
it("accepts a preset or every board layer, while bounding external inputs", () => {
  expect(decode({ ...base, layers: "assembly-back" }).layers).toBe("assembly-back");
  expect(
    decode({ ...base, layers: Array.from({ length: 64 }, (_, i) => `User.${i}`) }).layers,
  ).toHaveLength(64);
  expect(() => decode({ ...base, layers: Array(65).fill("F.Cu") })).toThrow();
  expect(() => decode({ ...base, side: "both" })).toThrow();
  expect(() => decode({ ...base, paper: "A5" })).toThrow();
});
