import {
  defaultPrintLayers,
  type PcbPrintResult,
  type PcbPrintSide,
} from "@t3tools/contracts/fork";

export function initialPrintOptions(side: PcbPrintSide, boardLayers: readonly string[]) {
  const present = new Set([...boardLayers, "Edge.Cuts"]);
  return {
    side,
    layers: defaultPrintLayers(side).filter((name) => present.has(name)),
    mirror: side === "bottom",
    paper: "board" as const,
    blackAndWhite: true,
  };
}
export const isPrintStale = (
  result: Pick<PcbPrintResult, "sourceHash">,
  sourceHash: string | null,
) => sourceHash !== null && result.sourceHash !== sourceHash;
