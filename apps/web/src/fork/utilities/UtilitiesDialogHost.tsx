import { lazy, Suspense, useEffect, useRef } from "react";

import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { toggleUtilities } from "./open";
import { useUtilitiesStore } from "./store";

const UtilitiesView = lazy(() => import("./UtilitiesView"));

/**
 * Owns `loom.utilities.open` and the fallback dialog for when no thread is open. Renders
 * nothing until the dialog opens, so the closed feature costs one store subscription.
 */
export function UtilitiesDialogHost() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const open = useUtilitiesStore((state) => state.dialogOpen);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => onForkCommand("loom.utilities.open", () => toggleUtilities(threadRef)),
    [threadRef],
  );

  if (!open) return null;
  return (
    // Suspends the whole dialog, not just its body: the popup picks its initial focus once, as
    // it mounts, and must find the tool there rather than a loading line and the close button.
    <Suspense fallback={null}>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) useUtilitiesStore.getState().closeDialog();
        }}
      >
        <DialogPopup
          className="h-160 sm:max-w-3xl"
          initialFocus={() =>
            contentRef.current?.querySelector<HTMLElement>("[data-utility-heading]") ?? null
          }
        >
          <DialogHeader>
            <DialogTitle>Utilities</DialogTitle>
          </DialogHeader>
          <div ref={contentRef} className="flex min-h-0 flex-1 flex-col border-t">
            <UtilitiesView />
          </div>
        </DialogPopup>
      </Dialog>
    </Suspense>
  );
}
