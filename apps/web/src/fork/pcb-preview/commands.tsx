import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { PcbEditorEvent } from "@t3tools/contracts/fork";
import { pcb } from "./state";
import { asyncValue } from "./usePcbPreview";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { useRouteThread } from "../routeThread";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { requestPanelPresentation } from "../panels/presentation";
import { forkPanelSurface } from "../panels/registry";

export function togglePcbPreview(threadRef: ScopedThreadRef) {
  const panels = useRightPanelStore.getState();
  const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
  if (active?.kind === "fork" && active.panelId === "pcb-preview")
    panels.closeSurface(threadRef, active.id);
  else panels.openSurface(threadRef, forkPanelSurface("pcb-preview"));
}
const idle = Atom.make(AsyncResult.initial<PcbEditorEvent, never>());
export function PcbPreviewCommandHost() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const configs = useServerConfigs();
  const available =
    threadRef &&
    loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    );
  const events = useAtomValue(
    available && threadRef
      ? pcb.panelEvents({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : idle,
  );
  const request = asyncValue(events),
    handled = useRef<string | null>(null);
  useEffect(() => {
    if (!threadRef || !request || handled.current === request.requestId) return;
    handled.current = request.requestId;
    const panels = useRightPanelStore.getState();
    const surface = forkPanelSurface("pcb-preview", request.designId);
    const act = async () => {
      if (request.command.action === "close") {
        for (const item of panels.byThreadKey[`${threadRef.environmentId}:${threadRef.threadId}`]
          ?.surfaces ?? [])
          if (
            item.kind === "fork" &&
            item.panelId === "pcb-preview" &&
            (!item.resourceId || item.resourceId === request.designId)
          )
            panels.closeSurface(threadRef, item.id);
      } else if (request.command.action === "maximize")
        await requestPanelPresentation(threadRef, request.command.enabled ?? true);
      else panels.openSurface(threadRef, surface);
    };
    void act()
      .then(() =>
        runPcbCommand(pcb.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            designId: request.designId,
            requestId: request.requestId,
            message: "PCB panel action completed.",
          },
        }),
      )
      .catch((error) =>
        runPcbCommand(pcb.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            designId: request.designId,
            requestId: request.requestId,
            message: error instanceof Error ? error.message : "Panel action failed.",
            error: true,
          },
        }).catch(() => undefined),
      );
  }, [request, threadRef]);
  useEffect(() => {
    if (!available || !threadRef) return;
    return onForkCommand("loom.pcb-preview.toggle", () => togglePcbPreview(threadRef));
  }, [available, threadRef]);
  return null;
}
