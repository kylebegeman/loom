import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useSettingsSearchTargetId } from "~/components/settings/settingsLayout";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

const EMPTY_SEARCH_TARGETS: readonly string[] = [];

/** Mount subscriptions only while the computer's connection details are open. */
export function ComputerConnectionDetails({
  label,
  children,
  open: controlledOpen,
  onOpenChange,
  searchTargetIds = EMPTY_SEARCH_TARGETS,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly searchTargetIds?: readonly string[];
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const searchTargetId = useSettingsSearchTargetId();
  const [openedForTarget, setOpenedForTarget] = useState<string | null>(null);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  if (
    searchTargetId !== null &&
    searchTargetIds.includes(searchTargetId) &&
    openedForTarget !== searchTargetId
  ) {
    setOpenedForTarget(searchTargetId);
    if (!open) setOpen(true);
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex min-h-9 items-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Connection details for ${label}`}
      >
        Connection details
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {open ? <div className="space-y-4 border-t border-border/50 py-3">{children}</div> : null}
      </CollapsiblePanel>
    </Collapsible>
  );
}
