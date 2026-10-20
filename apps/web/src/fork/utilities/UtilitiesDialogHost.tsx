import { lazy, Suspense, useEffect, useRef, type RefObject } from "react";

import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { toggleUtilities } from "./open";
import { useUtilitiesStore } from "./store";

const UtilitiesView = lazy(() => import("./UtilitiesView"));

const toolHeading = (popup: HTMLElement | null) =>
  popup?.querySelector<HTMLElement>("[data-utility-heading]") ?? null;

/**
 * Owns `loom.utilities.open` and the fallback dialog for when no thread is open. Renders
 * nothing until the dialog opens, so the closed feature costs one store subscription.
 */
export function UtilitiesDialogHost() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const open = useUtilitiesStore((state) => state.dialogOpen);
  const popupRef = useRef<HTMLDivElement>(null);

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
      <DialogPopup
        ref={popupRef}
        className="h-160 sm:max-w-3xl"
        // The popup picks this once, as it mounts. While the view is still loading it waits on
        // the popup itself, not the close button, and FocusToolOnLoad takes it from there.
        initialFocus={() => toolHeading(popupRef.current) ?? popupRef.current}
      >
        <DialogHeader>
          <DialogTitle>Utilities</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col border-t">
          <Suspense
            fallback={<p className="p-3 text-muted-foreground text-sm">Loading utilities...</p>}
          >
            <UtilitiesView />
            <FocusToolOnLoad popupRef={popupRef} />
          </Suspense>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** Moves focus to the tool once the view arrives, unless the user has moved it meanwhile. */
function FocusToolOnLoad({ popupRef }: { readonly popupRef: RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const popup = popupRef.current;
    if (popup !== null && document.activeElement === popup) toolHeading(popup)?.focus();
  }, [popupRef]);
  return null;
}
