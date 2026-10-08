import type { PcbDesign, PcbView, PcbLayerState, PcbLayerPreset } from "@t3tools/contracts/fork";

/** Keep the job subscribed after completion; its request key provides deduplication. */
export function previewAction(input: {
  visible: boolean;
  design: PcbDesign | null;
  trusted: boolean;
  canRender: boolean;
  sourceHash: string | null;
  view: PcbView;
  manual?: boolean;
  watchFailed?: boolean;
}) {
  if (!input.visible || !input.design) return "idle";
  if (input.design.kind === "tscircuit" && !input.trusted) return "needs-trust";
  if (!input.design.toolAvailable) return "needs-tool";
  if (!input.canRender) return "needs-permission";
  if (!(input.view === "pcb" ? input.design.boardPath : input.design.schematicPath)) return "idle";
  if (!input.sourceHash && !input.manual && !input.watchFailed) return "waiting";
  return "render";
}
export function initialView(design: PcbDesign, preferred?: PcbView): PcbView {
  if (preferred === "schematic" && design.schematicPath) return preferred;
  if (preferred === "pcb" && design.boardPath) return preferred;
  return design.schematicPath ? "schematic" : "pcb";
}

/** Preserve controls for existing layers and discard stale identities after reload or view restore. */
export function reconcileLayers(
  current: readonly PcbLayerState[] | null,
  names: readonly string[],
  preset: PcbLayerPreset,
): readonly PcbLayerState[] {
  const side = preset === "back" ? "B" : "F";
  const desired =
    preset === "all"
      ? ["F.Cu", "B.Cu", "Edge.Cuts"]
      : [`${side}.Cu`, `${side}.Paste`, `${side}.Silkscreen`, `${side}.Mask`, "Edge.Cuts"];
  if (
    current?.length === names.length &&
    names.every((name, index) => current[index]?.name === name)
  )
    return current;
  return names.map(
    (name) =>
      current?.find((layer) => layer.name === name) ?? {
        name,
        visible: desired.includes(name) || (preset === "all" && /^In\d+\.Cu$/.test(name)),
        opacity: 1,
      },
  );
}
