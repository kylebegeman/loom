import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

/** `open` behaves like `<details open>`: a change applies, and the user can toggle in between. */
export function VaultFold({
  title,
  open: requested = false,
  onOpenChange,
  children,
}: {
  title: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(requested);
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    setOpen(requested);
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <CollapsibleTrigger className="group flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4">
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">{title}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel hiddenUntilFound>
        <div className="flex min-w-0 flex-col gap-4 pt-2.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
