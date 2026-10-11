import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { PcbTurnDesigns } from "@t3tools/contracts/fork";
import { create } from "zustand";
import { useRightPanelStore } from "~/rightPanelStore";
import { toastManager } from "~/components/ui/toast";
import { addBackgroundSurfaces, openAutomaticSurfaces } from "../panels/backgroundSurfaces";
import { forkPanelSurface } from "../panels/registry";
import { pcbDesignName } from "./usePcbPreview.logic";
import { pcb } from "./state";
import { runModelCommand } from "../model-preview-3d/state";
export const MAX_AGENT_DESIGN_TABS = 8;
export const pcbSurface = (designId: string) => ({
  ...forkPanelSurface("pcb-preview", designId),
  title: pcbDesignName(designId),
});
/** Include data and meshes too: the server intersects candidates with the exact hashed source set. */
export const mayAffectDesigns = (paths: readonly string[]) =>
  paths.some(
    (name) =>
      /\.(?:kicad_(?:pro|sch|pcb|sym|mod|dru)|lib|dcm|wks|[cm]?[jt]sx?|json|svg|dxf|png|jpe?g|csv|txt|obj|stl|3mf|glb|gltf|bin)$/i.test(
        name,
      ) || /(?:^|\/)(?:sym-lib-table|fp-lib-table)$/.test(name),
  );
export function hasPcbTab(threadRef: ScopedThreadRef) {
  const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
  return (
    !!panel?.isOpen && panel.surfaces.some((s) => s.kind === "fork" && s.panelId === "pcb-preview")
  );
}
export function openDesigns(
  threadRef: ScopedThreadRef,
  ids: readonly string[],
  mode: "focus" | "background",
) {
  const surfaces = [...new Set(ids)].slice(0, MAX_AGENT_DESIGN_TABS).map(pcbSurface);
  if (!surfaces.length) return;
  if (mode === "focus") useRightPanelStore.getState().openSurface(threadRef, surfaces[0]!);
  const remaining = mode === "focus" ? surfaces.slice(1) : surfaces;
  addBackgroundSurfaces(threadRef, remaining);
}
export function applyAgentDesigns(
  threadRef: ScopedThreadRef,
  result: PcbTurnDesigns,
  mode: "offer" | "open" | "off",
) {
  if (mode === "off" || !result.designs.length) return;
  if (hasPcbTab(threadRef))
    openDesigns(
      threadRef,
      result.designs.map((d) => d.designId),
      "background",
    );
  else if (mode === "open")
    openAutomaticSurfaces(
      threadRef,
      result.designs.slice(0, MAX_AGENT_DESIGN_TABS).map((d) => pcbSurface(d.designId)),
    );
}
export async function openLastAgentDesigns(threadRef: ScopedThreadRef) {
  try {
    const result = await runModelCommand(pcb.loadTurnDesigns, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId: null },
    });
    if (!result.designs.length)
      toastManager.add({
        type: "info",
        title: "The agent has not changed a design in this thread.",
      });
    else
      openDesigns(
        threadRef,
        result.designs.map((d) => d.designId),
        "focus",
      );
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: "Designs from the last turn could not be opened",
      description: cause instanceof Error ? cause.message : "Try again.",
    });
  }
}
const DISMISSALS_KEY = "loom:pcb-follow-agent:dismissed:v1";
export const designTurnDismissalKey = (environmentId: EnvironmentId, runId: RunId) =>
  `${environmentId}:${runId}`;
export function appendDismissedDesignTurn(keys: readonly string[], key: string) {
  return [...keys.filter((old) => old !== key), key].slice(-200);
}
export function parseDismissedDesignTurns(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((v): v is string => typeof v === "string"))].slice(-200)
      : [];
  } catch {
    return [];
  }
}
function loadDismissals() {
  try {
    return parseDismissedDesignTurns(globalThis.localStorage?.getItem(DISMISSALS_KEY) ?? null);
  } catch {
    return [];
  }
}
export const useDismissedDesignTurns = create<{ keys: string[]; dismiss: (key: string) => void }>(
  (set) => ({
    keys: loadDismissals(),
    dismiss: (key) =>
      set((state) => {
        const keys = appendDismissedDesignTurn(state.keys, key);
        try {
          globalThis.localStorage?.setItem(DISMISSALS_KEY, JSON.stringify(keys));
        } catch {
          /* Session memory still works without browser storage. */
        }
        return { keys };
      }),
  }),
);
