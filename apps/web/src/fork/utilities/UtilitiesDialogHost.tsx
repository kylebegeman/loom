import { lazy, Suspense, useEffect } from "react";

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

  useEffect(
    () => onForkCommand("loom.utilities.open", () => toggleUtilities(threadRef)),
    [threadRef],
  );

  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) useUtilitiesStore.getState().closeDialog();
      }}
    >
      <DialogPopup className="h-160 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Utilities</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col border-t">
          <Suspense
            fallback={<p className="p-3 text-muted-foreground text-sm">Loading utilities...</p>}
          >
            <UtilitiesView />
          </Suspense>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
