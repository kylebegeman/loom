import { useEffect, useRef } from "react";
import * as DateTime from "effect/DateTime";
import { CheckIcon, GhostIcon, XIcon } from "lucide-react";
import type { CheckpointId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "~/components/ui/menu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { chipLabel, type HistoryChip } from "./history";
export function HistoryStrip({
  chips,
  viewing,
  comparing,
  hasEarlier,
  loading,
  error,
  unavailable,
  canRestore,
  canPreview,
  onEarlier,
  onView,
  onCompare,
  onRestore,
  onClose,
}: {
  chips: ReadonlyArray<HistoryChip>;
  viewing: CheckpointId | null;
  comparing: CheckpointId | "now" | null;
  hasEarlier: boolean;
  loading: boolean;
  error: string | null;
  unavailable: "not-git" | null;
  canRestore: boolean;
  canPreview: boolean;
  onEarlier: () => void;
  onView: (id: CheckpointId | "now") => void;
  onCompare: (id: CheckpointId | "now" | null) => void;
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
      aria-label="Model history"
      className="flex min-h-10 items-center gap-2 border-t px-2 py-1 text-xs"
    >
      <div
        ref={container}
        role="listbox"
        aria-label="Model versions"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {hasEarlier && (
          <Button size="xs" variant="ghost" disabled={loading || !canPreview} onClick={onEarlier}>
            Earlier
          </Button>
        )}
        {unavailable ? (
          <span>History needs a Git workspace.</span>
        ) : (
          chips.map((chip) => {
            const id = chip.kind === "now" ? "now" : chip.version.checkpointId;
            const active =
              chip.kind === "now" ? viewing === null : viewing === chip.version.checkpointId;
            const label = chip.kind === "now" ? "Now" : chipLabel(chip.version);
            const detail =
              chip.kind === "now"
                ? chip.matches
                  ? "Matches a saved turn"
                  : "Current workspace file"
                : `${DateTime.formatIso(chip.version.capturedAt)}${chip.folded ? `; ${chip.folded} later turns made no change` : ""}${chip.version.changed.length ? `; ${chip.version.changed.join(", ")}` : ""}`;
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={
                    <Button
                      role="option"
                      data-checkpoint={id}
                      aria-selected={active}
                      disabled={chip.kind === "version" && !canPreview}
                      size="xs"
                      variant={active ? "secondary" : "ghost"}
                      onClick={() => onView(id)}
                    />
                  }
                >
                  {chip.kind === "version" && chip.version.resolvedAnnotations.length > 0 && (
                    <CheckIcon />
                  )}
                  {comparing === id && <GhostIcon />}
                  {label}
                </TooltipTrigger>
                <TooltipPopup>{detail}</TooltipPopup>
              </Tooltip>
            );
          })
        )}
        {loading && <span role="status">Loading…</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      {!unavailable && (
        <Menu>
          <MenuTrigger
            render={<Button size="xs" variant="ghost" disabled={loading || !canPreview} />}
          >
            Compare
          </MenuTrigger>
          <MenuPopup>
            {comparing !== null && (
              <MenuItem onClick={() => onCompare(null)}>Stop comparing</MenuItem>
            )}
            {chips
              .filter((chip) =>
                chip.kind === "now"
                  ? viewing !== null
                  : chip.version.present && chip.version.checkpointId !== viewing,
              )
              .map((chip) => (
                <MenuItem
                  key={chip.kind === "now" ? "now" : chip.version.checkpointId}
                  onClick={() => onCompare(chip.kind === "now" ? "now" : chip.version.checkpointId)}
                >
                  {chip.kind === "now" ? "Now" : chipLabel(chip.version)}
                </MenuItem>
              ))}
          </MenuPopup>
        </Menu>
      )}
      {viewing !== null && selected?.kind === "version" && selected.version.present && (
        <Button size="xs" variant="ghost" disabled={!canRestore || loading} onClick={onRestore}>
          Restore this version…
        </Button>
      )}
      <Button size="icon-xs" variant="ghost" aria-label="Close history" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
