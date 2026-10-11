import { DiffIcon, ListIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "~/components/ui/popover";
import { changeDetail } from "@t3tools/contracts/fork";
import { ToolButton } from "./ToolButton";
import type { useChangeHighlights } from "./useChangeHighlights";
export function ChangesChip({
  changes,
  onComponent,
  onNet,
}: {
  changes: ReturnType<typeof useChangeHighlights>;
  onComponent: (ref: string) => void;
  onNet: (name: string) => void;
}) {
  return (
    <div role="status" className="flex items-center gap-1">
      <ToolButton
        label={changes.shown ? "Hide changes (D)" : "Changed. Show changes (D)"}
        hint={Object.entries(changes.counts)
          .filter(([, n]) => n)
          .map(([k, n]) => `${n} ${k}`)
          .join(", ")}
        aria-pressed={changes.shown}
        onClick={() => changes.show(!changes.shown)}
      >
        <DiffIcon />
        Changed
      </ToolButton>
      <Popover
        onOpenChange={(open) => {
          if (open) void changes.drawingSettled();
        }}
      >
        <PopoverTrigger
          render={<Button size="icon-xs" variant="ghost-muted" aria-label="List changes" />}
        >
          <ListIcon />
        </PopoverTrigger>
        <PopoverPopup>
          <div className="max-h-80 max-w-80 overflow-auto p-2">
            {changes.set.components.map((c) => (
              <Button
                key={c.reference}
                size="xs"
                variant="ghost-muted"
                onClick={() => onComponent(c.reference)}
              >
                {c.reference}: {c.kind}, {changeDetail(c)}
              </Button>
            ))}
            {changes.set.nets.map((n) => (
              <Button key={n.name} size="xs" variant="ghost-muted" onClick={() => onNet(n.name)}>
                Net {n.name}: {n.kind}
              </Button>
            ))}
            <p>
              {changes.drawing === "pending"
                ? "Checking the drawing…"
                : changes.drawing === "unavailable"
                  ? "Drawing changes are unavailable for this reload."
                  : `Drawing changed (${changes.regions.length} areas)`}
            </p>
          </div>
        </PopoverPopup>
      </Popover>
      <ToolButton label="Dismiss until the next change" onClick={changes.dismiss}>
        <XIcon />
      </ToolButton>
    </div>
  );
}
