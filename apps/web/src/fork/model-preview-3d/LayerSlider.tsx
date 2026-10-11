import { XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { formatLength, useDisplayUnits } from "./units";
export function LayerSlider({
  layer,
  count,
  zMm,
  onChange,
  onClose,
}: {
  layer: number;
  count: number;
  zMm: number;
  onChange: (layer: number) => void;
  onClose: () => void;
}) {
  const units = useDisplayUnits();
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        aria-label="Layer"
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={layer}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-primary"
      />
      <span className="text-xs tabular-nums">
        Layer {layer + 1} of {count}, Z {formatLength(zMm, units, { digits: 2 })}
      </span>
      <Button variant="ghost-muted" size="icon-xs" aria-label="Hide layers" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
