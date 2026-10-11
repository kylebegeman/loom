import { useEffect, useRef } from "react";
import * as DateTime from "effect/DateTime";
import { XIcon } from "lucide-react";
import type { CheckpointId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { chipLabel, type HistoryChip } from "./history";
export function HistoryStrip({
  chips,
  viewing,
  hasEarlier,
  loading,
  error,
  unavailable,
  canRestore,
  onEarlier,
  onView,
  onCompare,
  onRestore,
  onClose,
}: {
  chips: readonly HistoryChip[];
  viewing: CheckpointId | null;
  hasEarlier: boolean;
  loading: boolean;
  error: string | null;
  unavailable: "not-git" | null;
  canRestore: boolean;
  onEarlier: () => void;
  onView: (id: CheckpointId | "now") => void;
  onCompare: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    container.current
      ?.querySelector(`[data-checkpoint="${CSS.escape(viewing ?? "now")}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [viewing]);
  const selected = chips.find(
    (chip) => chip.kind === "version" && chip.version.checkpointId === viewing,
  );
  return (
    <div
      aria-label="Design history"
      className="flex min-h-10 items-center gap-2 border-t px-2 py-1 text-xs"
    >
      <div
        ref={container}
        role="listbox"
        aria-label="Design versions"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {hasEarlier && (
          <Button size="xs" variant="ghost" disabled={loading} onClick={onEarlier}>
            Earlier
          </Button>
        )}
        {unavailable ? (
          <span>History needs a Git workspace.</span>
        ) : (
          chips.map((chip) => {
            const id = chip.kind === "now" ? "now" : chip.version.checkpointId;
            const active = viewing === (id === "now" ? null : id);
            return (
              <Button
                key={id}
                size="xs"
                variant={active ? "secondary" : "ghost"}
                role="option"
                aria-selected={active}
                data-checkpoint={id}
                title={
                  chip.kind === "version"
                    ? `${DateTime.formatIso(chip.version.capturedAt)}; Changed ${chip.version.changed.join(", ") || "no files"}${chip.folded ? `; ${chip.folded} later turns made no change` : ""}`
                    : chip.matches
                      ? `Same as ${chips.find((c) => c.kind === "version" && c.version.checkpointId === chip.matches)?.kind === "version" ? "a saved turn" : "a saved version"}`
                      : "Current workspace files"
                }
                onClick={() => onView(id)}
              >
                {chip.kind === "now" ? "Now" : chipLabel(chip.version)}
              </Button>
            );
          })
        )}
        {loading && <span role="status">Loading history...</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      {viewing && (
        <Button size="xs" variant="ghost" onClick={onCompare}>
          Compare
        </Button>
      )}
      {selected?.kind === "version" && selected.version.present && canRestore && (
        <Button size="xs" variant="ghost" onClick={onRestore}>
          Restore this version...
        </Button>
      )}
      <Button size="icon-xs" variant="ghost" aria-label="Close history" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
