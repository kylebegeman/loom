import { Rotate3DIcon, Undo2Icon, WandSparklesIcon } from "lucide-react";
import type { ModelOrientation } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Chip, SectionHead, Tip } from "./controls";

export type OrientationControls = {
  value: ModelOrientation | null;
  sourceRevision: string;
  disabled: boolean;
  picking: boolean;
  onFace: () => void;
  onAuto: () => void;
  onReset: () => void;
  onBake: () => void;
};

/** Preview orientation controls share the workspace's edit permission. */
export function OrientationSection({
  value,
  sourceRevision,
  disabled,
  picking,
  onFace,
  onAuto,
  onReset,
  onBake,
}: OrientationControls) {
  return (
    <div className="space-y-2 py-2">
      <SectionHead title="Orientation">
        <Chip>{value ? "Laid flat" : "As modelled"}</Chip>
      </SectionHead>
      <div className="flex flex-wrap gap-1">
        <Tip label="Click the face to rest on the bed" kbd="L">
          <Button
            variant="outline"
            size="xs"
            disabled={disabled}
            data-pressed={picking ? "" : undefined}
            onClick={onFace}
          >
            <Rotate3DIcon /> Lay flat on a face
          </Button>
        </Tip>
        <Button variant="outline" size="xs" disabled={disabled} onClick={onAuto}>
          Auto lay flat
        </Button>
        {value && (
          <>
            <Button variant="ghost-muted" size="xs" disabled={disabled} onClick={onReset}>
              <Undo2Icon /> Reset orientation
            </Button>
            <Button variant="ghost-muted" size="xs" disabled={disabled} onClick={onBake}>
              <WandSparklesIcon /> Ask agent to bake this rotation
            </Button>
          </>
        )}
      </div>
      {value && value.sourceRevision !== sourceRevision && (
        <p className="px-3 text-xs text-muted-foreground">
          Set on an earlier version of this file.
        </p>
      )}
    </div>
  );
}
