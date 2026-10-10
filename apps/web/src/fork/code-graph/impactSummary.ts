import { describeImpactFile, type CodeGraphImpactResult } from "@t3tools/contracts/fork";

/** The summary stays short enough to paste into a prompt. */
export const SUMMARY_MAX_LINES = 40;
const SYMBOLS_SHOWN = 10;

const hops = (depth: number) => `${depth} hop${depth === 1 ? "" : "s"}`;

/**
 * Markdown for the composer: the files the changes can reach, nearest first, then the most
 * direct symbols. At most SUMMARY_MAX_LINES lines.
 */
export function impactSummary(
  result: CodeGraphImpactResult,
  scopeLabel: string,
  depth: number,
): string {
  const header = [
    `Code graph impact of ${scopeLabel} (${result.seedFiles.length} changed file${result.seedFiles.length === 1 ? "" : "s"}, up to ${hops(depth)}${result.stale ? ", graph built at an older commit" : ""}):`,
  ];
  if (result.files.length === 0) return [...header, "- Nothing else depends on them."].join("\n");

  const symbols = result.hits
    .slice(0, SYMBOLS_SHOWN)
    .map(
      (hit) =>
        `- ${hit.node.label} in ${hit.node.file}${hit.viaLine === null ? "" : `:${hit.viaLine}`} (${hit.viaRelation}, ${hops(hit.depth)})`,
    );
  const symbolBlock = symbols.length > 0 ? ["", "Most direct symbols:", ...symbols] : [];
  const fileRoom = SUMMARY_MAX_LINES - header.length - 1 - symbolBlock.length;
  const shown = result.files.slice(0, Math.max(fileRoom - 1, 1));
  const hidden = result.files.length - shown.length;
  return [
    ...header,
    "Files that can be affected:",
    ...shown.map((file) => `- ${file.file} (${describeImpactFile(file)})`),
    ...(hidden > 0 ? [`- and ${hidden} more file${hidden === 1 ? "" : "s"}`] : []),
    ...symbolBlock,
  ].join("\n");
}
