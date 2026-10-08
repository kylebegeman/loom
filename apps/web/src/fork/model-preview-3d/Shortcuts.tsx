import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { ModelEditorEvent } from "@t3tools/contracts/fork";
import { models, runModelCommand } from "./state";
import { requestPanelPresentation } from "../panels/presentation";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useRouteThread } from "../routeThread";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { forkPanelSurface } from "../panels/registry";
import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { dispatchModelAction } from "./actions";
const idle = Atom.make(AsyncResult.initial<typeof ModelEditorEvent.Type, never>());
export function ModelPreview3dShortcuts() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const configs = useServerConfigs();
  const available =
    threadRef &&
    loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities).includes(
      "model-preview-3d",
    );
  const events = useAtomValue(
    available && threadRef
      ? models.panelEvents({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : idle,
  );
  const request = events._tag === "Success" ? events.value : null,
    handled = useRef<string | null>(null);
  useEffect(() => {
    if (!threadRef || !request || handled.current === request.requestId) return;
    handled.current = request.requestId;
    const act = async () => {
      const panels = useRightPanelStore.getState(),
        surface = forkPanelSurface("model-preview-3d", request.path);
      if (request.command.action === "close") panels.closeSurface(threadRef, surface.id);
      else if (request.command.action === "maximize")
        await requestPanelPresentation(threadRef, request.command.enabled ?? true);
      else panels.openSurface(threadRef, surface);
    };
    void act()
      .then(() =>
        runModelCommand(models.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            path: request.path,
            requestId: request.requestId,
            message: "3D panel action completed.",
          },
        }),
      )
      .catch((error) =>
        runModelCommand(models.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            path: request.path,
            requestId: request.requestId,
            message: error instanceof Error ? error.message : "Panel action failed.",
            error: true,
          },
        }).catch(() => undefined),
      );
  }, [request, threadRef]);
  useEffect(() => {
    if (!available || !threadRef) return;
    const open = onForkCommand("loom.model-preview-3d.open", () =>
      useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("model-preview-3d")),
    );
    const capture = onForkCommand("loom.model-preview-3d.capture", () =>
      dispatchModelAction(threadRef, "capture"),
    );
    return () => {
      open();
      capture();
    };
  }, [available, threadRef]);
  return null;
}
