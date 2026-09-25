import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { EyeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useInspectorCardStore } from "./cardStore";
import { INSPECTOR_TRIGGER_ATTRIBUTE, InspectorCard } from "./InspectorCard";

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
  const toggle = useInspectorCardStore((state) => state.toggle);
  const close = useInspectorCardStore((state) => state.close);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [header, setHeader] = useState<HTMLElement | null>(null);

  // A card left open by another thread's button, or by a shortcut with no button mounted,
  // must not appear on its own. Keyed by thread, so this runs on every thread switch.
  useEffect(() => {
    close();
    setHeader(buttonRef.current?.closest<HTMLElement>("[data-chat-header]") ?? null);
    return close;
  }, [close]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={buttonRef}
              size="icon-xs"
              variant="outline"
              aria-label={needsAttention ? "Thread inspector, needs attention" : "Thread inspector"}
              aria-expanded={open}
              onClick={toggle}
              {...{ [INSPECTOR_TRIGGER_ATTRIBUTE]: "" }}
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
      {open && header ? (
        <InspectorCard threadRef={threadRef} header={header} onClose={close} />
      ) : null}
    </>
  );
}
