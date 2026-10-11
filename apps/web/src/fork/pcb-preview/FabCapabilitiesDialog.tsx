import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { PcbFabCapability, PcbFabCatalog } from "@t3tools/contracts/fork";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { runModelCommand } from "../model-preview-3d/state";
import { useWrite } from "./InspectorKit";
import {
  duplicateCapability,
  capabilityErrors,
  parseLengthList,
  removeCapability,
} from "./fabCapabilities.logic";
import { useLengthUnit } from "./preferences";
import { formatLength, parseLength } from "./length";
const LENGTH_FIELDS = [
  ["minTrackMm", "Track"],
  ["minSpaceMm", "Space"],
  ["minDrillMm", "Drill"],
  ["minAnnularRingMm", "Annular ring"],
  ["minViaMm", "Via pad"],
  ["minEdgeClearanceMm", "Edge clearance"],
  ["minHoleToHoleMm", "Hole to hole"],
] as const;
export function FabCapabilitiesDialog({
  environmentId,
  open,
  onOpenChange,
}: {
  environmentId: EnvironmentId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const target = { environmentId, input: {} };
  const loaded = useAtomValue(pcb.fabCapabilities(target));
  const catalog = asyncValue(loaded),
    allowed = useAtomValue(pcb.updateFabCapabilities.permissionAtom(environmentId));
  const [draft, setDraft] = useState<PcbFabCatalog | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const unit = useLengthUnit(),
    write = useWrite(
      "Fab capabilities changed elsewhere or could not be saved. Reload the list before retrying.",
    );
  const [previousOpen, setPreviousOpen] = useState(false);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setDraft(catalog);
      setDirty(false);
      setDiscard(false);
      setEditing(null);
    }
  }
  if (open && draft === null && catalog) setDraft(catalog);
  const entry = draft?.entries.find((e) => e.id === editing);
  const errors = entry ? capabilityErrors(entry) : [];
  const change = (patch: Partial<PcbFabCapability>) => {
    if (!entry || !draft) return;
    setDraft({
      ...draft,
      entries: draft.entries.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)),
    });
    setDirty(true);
  };
  const close = () => {
    if (write.busy) return;
    if (dirty) setDiscard(true);
    else onOpenChange(false);
  };
  const duplicate = (source: PcbFabCapability) => {
    if (!draft) return;
    const next = duplicateCapability(
      source,
      [...draft.builtIns, ...draft.entries].map((e) => e.id),
    );
    setDraft({ ...draft, entries: [...draft.entries, next] });
    setEditing(next.id);
    setDirty(true);
  };
  const all = draft ? [...draft.builtIns, ...draft.entries] : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPopup>
        <DialogTitle>Fab capabilities</DialogTitle>
        <DialogDescription>
          Built-in limits are references. Duplicate a profile to change it; edits are shared by this
          environment.
        </DialogDescription>
        {loaded.waiting && !draft && <p role="status">Loading fab capabilities</p>}
        {(asyncError(loaded) || write.error) && (
          <p role="alert">{asyncError(loaded) ?? write.error}</p>
        )}
        {(draft?.skipped ?? []).map((id) => (
          <p key={id} role="status">
            Skipped unreadable profile: {id}
          </p>
        ))}
        {!allowed && <p>Read only on this connection.</p>}
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
          {all.map((fab) => (
            <div key={fab.id} className="flex flex-wrap items-center gap-2">
              <strong>{fab.name}</strong>
              <small>
                {draft?.builtIns.some((e) => e.id === fab.id) ? "Built-in" : "Custom"}
                {draft?.defaultId === fab.id ? " · Default" : ""}
              </small>
              <Button
                variant="outline"
                size="xs"
                disabled={!allowed || write.busy || (draft?.entries.length ?? 0) >= 24}
                onClick={() => duplicate(fab)}
              >
                Duplicate
              </Button>
              {draft?.entries.some((e) => e.id === fab.id) && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!allowed || write.busy}
                    onClick={() => setEditing(fab.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!allowed || write.busy}
                    onClick={() => {
                      if (draft) {
                        setDraft({ ...draft, ...removeCapability(draft, fab.id) });
                        setDirty(true);
                        if (editing === fab.id) setEditing(null);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="xs"
                disabled={!allowed || write.busy || draft?.defaultId === fab.id}
                onClick={() => {
                  if (draft) {
                    setDraft({ ...draft, defaultId: fab.id });
                    setDirty(true);
                  }
                }}
              >
                Set as default
              </Button>
            </div>
          ))}
          {entry && (
            <div className="flex flex-col gap-3">
              <h3>Edit {entry.name}</h3>
              <label>
                Name
                <Input
                  size="sm"
                  value={entry.name}
                  maxLength={80}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label>
                Tier
                <select
                  value={entry.tier}
                  disabled={!allowed || write.busy}
                  onChange={(e) =>
                    change({ tier: e.target.value === "advanced" ? "advanced" : "standard" })
                  }
                >
                  <option value="standard">Standard</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              {LENGTH_FIELDS.map(([field, label]) => (
                <label key={field}>
                  {label} ({unit})
                  {(field === "minEdgeClearanceMm" || field === "minHoleToHoleMm") &&
                    "; blank means unpublished"}
                  <Input
                    size="sm"
                    key={`${entry.id}:${field}:${unit}`}
                    defaultValue={
                      entry[field] === null
                        ? ""
                        : formatLength(entry[field]!, unit, { unit: false, digits: 5, trim: true })
                    }
                    disabled={!allowed || write.busy}
                    onChange={(e) => {
                      const text = e.target.value;
                      const value =
                        text.trim() === "" &&
                        (field === "minEdgeClearanceMm" || field === "minHoleToHoleMm")
                          ? null
                          : parseLength(text, unit);
                      change({ [field]: value === null && text.trim() ? NaN : value });
                    }}
                  />
                </label>
              ))}
              <label>
                Layer counts
                <Input
                  key={`${entry.id}:layers`}
                  size="sm"
                  defaultValue={entry.layerCounts.join(", ")}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ layerCounts: parseLengthList(e.target.value) ?? [] })}
                />
              </label>
              <label>
                Thicknesses (mm)
                <Input
                  key={`${entry.id}:thicknesses`}
                  size="sm"
                  defaultValue={entry.thicknessesMm.join(", ")}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ thicknessesMm: parseLengthList(e.target.value) ?? [] })}
                />
              </label>
              <label>
                Finishes
                <Input
                  size="sm"
                  value={entry.finishes.join(", ")}
                  disabled={!allowed || write.busy}
                  onChange={(e) =>
                    change({
                      finishes: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Notes
                <Input
                  size="sm"
                  value={entry.notes}
                  maxLength={2000}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ notes: e.target.value })}
                />
              </label>
              <label>
                Source URL
                <Input
                  size="sm"
                  value={entry.sourceUrl}
                  maxLength={500}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ sourceUrl: e.target.value })}
                />
              </label>
              <label>
                Checked date
                <Input
                  size="sm"
                  type="date"
                  value={entry.checkedOn}
                  disabled={!allowed || write.busy}
                  onChange={(e) => change({ checkedOn: e.target.value })}
                />
              </label>
              {errors.map((message) => (
                <p key={message} role="alert">
                  {message}
                </p>
              ))}
            </div>
          )}
        </div>
        {discard ? (
          <div>
            <p>Discard unsaved fab edits?</p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setDirty(false);
                onOpenChange(false);
              }}
            >
              Discard edits
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDiscard(false)}>
              Keep editing
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={
                !allowed ||
                write.busy ||
                !dirty ||
                !draft ||
                draft.entries.some((e) => capabilityErrors(e).length > 0)
              }
              onClick={() =>
                void write.run(async () => {
                  if (!draft) return;
                  await runModelCommand(pcb.updateFabCapabilities, {
                    environmentId,
                    input: {
                      expectedVersion: draft.version,
                      entries: draft.entries,
                      defaultId: draft.defaultId,
                    },
                  });
                  setDirty(false);
                  onOpenChange(false);
                })
              }
            >
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={close}>
              Close
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={write.busy}
              onClick={() =>
                void write.run(async () => {
                  const next = await runModelCommand(pcb.loadFabCapabilities, {
                    environmentId,
                    input: {},
                  });
                  setDraft(next);
                  setDirty(false);
                  setEditing(null);
                })
              }
            >
              Reload
            </Button>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
