import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { EyeIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useInspectorCardStore } from "./cardStore";
import { openThreadInspectorPanel } from "./commands";
import { InspectorCard } from "./InspectorCard";
import type { InspectorAction } from "./model";

/**
 * The chat header's eye button (the ChatHeader seam). The dot reads the shell's pending flags,
 * so a closed card costs no activity derivations. Renders nothing for drafts.
 */
export function ThreadInspectorHeaderButton({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  if (threadRef === null) return null;
  return <HeaderButton key={scopedThreadKey(threadRef)} threadRef={threadRef} />;
}

function HeaderButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const needsApproval = shell?.hasPendingApprovals === true;
  const needsAttention = needsApproval || shell?.hasPendingUserInput === true;
  const open = useInspectorCardStore((state) => state.open);
  const setOpen = useInspectorCardStore((state) => state.setOpen);
  const close = useInspectorCardStore((state) => state.close);
  // Respond hands focus to the composer; closing must not pull it back to this button.
  const keepFocusRef = useRef(false);

  // A card left open by another thread's button, or by a shortcut with no button mounted,
  // must not appear on its own. Keyed by thread, so this runs on every thread switch.
  useEffect(() => {
    close();
    return close;
  }, [close]);

  const onActionDone = (action: InspectorAction) => {
    if (action.kind === "focus-composer") keepFocusRef.current = true;
    close();
  };
  const openPanel = () => {
    openThreadInspectorPanel(threadRef);
    close();
  };
  const finalFocus = () => {
    const keep = keepFocusRef.current;
    keepFocusRef.current = false;
    return !keep;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={
                    needsAttention ? "Thread inspector, needs attention" : "Thread inspector"
                  }
                />
              }
            />
          }
        >
          <EyeIcon />
          {needsAttention ? (
            <span
              aria-hidden
              className={cn(
                "absolute top-0.5 right-0.5 size-1.5 rounded-full",
                needsApproval ? "bg-warning" : "bg-primary",
              )}
            />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Thread inspector</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        side="bottom"
        align="end"
        sideOffset={6}
        padding="none"
        width="md"
        aria-label="Thread inspector"
        finalFocus={finalFocus}
      >
        <InspectorCard threadRef={threadRef} onActionDone={onActionDone} onOpenPanel={openPanel} />
      </PopoverPopup>
    </Popover>
  );
}
