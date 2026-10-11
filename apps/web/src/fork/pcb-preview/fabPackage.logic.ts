import type {
  PcbFabChecklistItem,
  PcbFabOutput,
  PcbFabPackageSummary,
} from "@t3tools/contracts/fork";
export const checklistTone = (items: readonly PcbFabChecklistItem[]) =>
  items.some((i) => i.status === "fail")
    ? "error"
    : items.some((i) => i.status === "warning")
      ? "warning"
      : "success";
export function groupOutputs(outputs: readonly PcbFabOutput[]) {
  const groups = new Map<string, PcbFabOutput[]>();
  for (const output of outputs) {
    const group = output.path.includes("/")
      ? output.path.slice(0, output.path.lastIndexOf("/"))
      : "Package";
    groups.set(group, [...(groups.get(group) ?? []), output]);
  }
  return [...groups].map(([name, files]) => ({ name, files }));
}
export const isPackageStale = (summary: PcbFabPackageSummary, hash: string | null) =>
  hash !== null && summary.sourceHash !== hash;
export const checklistText = (result: {
  id: string;
  verdict: string;
  checklist: readonly PcbFabChecklistItem[];
}) =>
  `${result.id}: ${result.verdict}\n\n` +
  result.checklist.map((i) => `[${i.status}] ${i.title}: ${i.detail}`).join("\n");
