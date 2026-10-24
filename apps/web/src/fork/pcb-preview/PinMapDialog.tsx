import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  buildPinMap,
  renderPinMap,
  pinMapFileName,
  validateIdentifier,
  type PcbInspection,
  type PcbPinFamily,
  type PcbPinMapFormat,
} from "@t3tools/contracts/fork";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appendSummary } from "./summary";
import { pcb } from "./state";
import { runModelCommand } from "../model-preview-3d/state";
import { errorMessage } from "./usePcbPreview";
import k from "./inspector.module.css";

export function PinMapDialog({
  threadRef,
  designId,
  inspection,
  reference,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  inspection: PcbInspection | null;
  reference: string;
  onClose: () => void;
}) {
  const canSave = useAtomValue(pcb.pinMap.permissionAtom(threadRef.environmentId));
  const copy = useCopyToClipboard({
    target: "PCB pin map",
    onError: (cause) => setError(cause.message),
  });
  const [family, setFamily] = useState<PcbPinFamily | undefined>(),
    [format, setFormat] = useState<PcbPinMapFormat>("c"),
    [power, setPower] = useState(false),
    [unconnected, setUnconnected] = useState(false),
    [names, setNames] = useState<Record<string, string>>({});
  const defaultPath = (next: PcbPinMapFormat) =>
    `${designId.includes("/") ? designId.slice(0, designId.lastIndexOf("/") + 1) : ""}${pinMapFileName(next) ?? "pins.h"}`;
  const [path, setPath] = useState(() => defaultPath("c")),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState<string | null>(null),
    [replaceKey, setReplaceKey] = useState<string | null>(null);
  const netIndex = useMemo(
    () => new Map(inspection?.nets.map((n) => [n.name, n.members])),
    [inspection],
  );
  const currentNames = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(names).filter(([pin]) =>
          inspection?.components
            .find((c) => c.reference === reference)
            ?.pins.some((p) => p.number === pin),
        ),
      ),
    [names, inspection, reference],
  );
  const map = useMemo(
    () =>
      inspection
        ? buildPinMap(inspection, reference, {
            family,
            names: currentNames,
            includePower: power,
            includeNoConnect: unconnected,
            netIndex,
          })
        : null,
    [inspection, reference, family, currentNames, power, unconnected, netIndex],
  );
  const text =
    map && inspection
      ? renderPinMap(map, format, { designId, sourceHash: inspection.sourceHash })
      : "";
  const markdown =
    map && inspection
      ? renderPinMap(map, "markdown", { designId, sourceHash: inspection.sourceHash })
      : "";
  const included = map?.rows.filter((r) => r.included) ?? [];
  const counts = new Map<string, number>();
  for (const row of map?.rows ?? [])
    counts.set(row.identifier, (counts.get(row.identifier) ?? 0) + 1);
  const invalid =
    map?.rows.some(
      (r) => validateIdentifier(r.identifier, format) || counts.get(r.identifier)! > 1,
    ) ?? true;
  const available = map?.formats.find((f) => f.format === format)?.available ?? false;
  const requestKey = JSON.stringify([
    inspection?.sourceHash,
    format,
    family,
    power,
    unconnected,
    currentNames,
    path,
  ]);
  const save = async () => {
    if (!inspection || saving) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    await runModelCommand(pcb.pinMap, {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        designId,
        reference,
        format,
        ...(family ? { family } : {}),
        names: currentNames,
        includePower: power,
        includeNoConnect: unconnected,
        expectedSourceHash: inspection.sourceHash,
        save: { path, overwrite: replaceKey === requestKey },
      },
    })
      .then((result) => {
        setSaved(result.saved?.path ?? null);
        setReplaceKey(null);
      })
      .catch((cause: unknown) => {
        const message = errorMessage(cause);
        setError(message);
        if (message.includes("Confirm Replace")) setReplaceKey(requestKey);
      })
      .finally(() => setSaving(false));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{reference} pin map</DialogTitle>
          <DialogDescription>
            {map
              ? `${map.value} · ${map.family}, from ${map.detectedFrom}${map.symbol ? ` (${map.symbol})` : ""}`
              : inspection
                ? "This part is no longer in the design."
                : "Loading inspection."}
          </DialogDescription>
        </DialogHeader>
        {map && (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <label>
                Family{" "}
                <select
                  value={family ?? "auto"}
                  disabled={saving}
                  onChange={(e) =>
                    setFamily(
                      e.target.value === "auto" ? undefined : (e.target.value as PcbPinFamily),
                    )
                  }
                >
                  <option value="auto">Auto</option>
                  {(["rp2", "esp32", "esp32s3", "stm32", "avr", "pins"] as const).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={power} disabled={saving} onCheckedChange={setPower} />
                Include power and ground
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={unconnected} disabled={saving} onCheckedChange={setUnconnected} />
                Include not connected
              </label>
            </div>
            {included.length ? (
              <div className="max-h-72 overflow-auto">
                <table className={k.pinMapTable}>
                  <thead>
                    <tr>
                      {["Pin", "Pad", "Name", "GPIO", "Net", "Also on net", "Constant"].map(
                        (name) => (
                          <th key={name}>{name}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {included.map((row) => {
                      const validation =
                        validateIdentifier(row.identifier, format) ??
                        (counts.get(row.identifier)! > 1 ? "Constant names must be unique." : null);
                      return (
                        <tr key={row.pin}>
                          <td>{row.pin}</td>
                          <td>{row.pad ?? "Not placed"}</td>
                          <td>
                            {row.name}
                            {row.baseName && <small> ({row.baseName})</small>}
                          </td>
                          <td>{row.gpio?.label ?? ""}</td>
                          <td>{row.net}</td>
                          <td>
                            {row.others
                              .slice(0, 8)
                              .map((m) => `${m.reference}.${m.pin}`)
                              .join(", ")}
                            {row.othersTotal > 8 ? ` +${row.othersTotal - 8} more` : ""}
                          </td>
                          <td>
                            <Input
                              aria-label={`Constant for pin ${row.pin}`}
                              aria-invalid={!!validation}
                              aria-describedby={validation ? `pin-name-${row.pin}` : undefined}
                              value={row.identifier}
                              disabled={saving}
                              onChange={(e) =>
                                setNames((current) => ({ ...current, [row.pin]: e.target.value }))
                              }
                            />
                            {validation && <small id={`pin-name-${row.pin}`}>{validation}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {map.rows.length
                  ? "Every pin is power, ground or not connected. Enable the filters to include them."
                  : "This part has no pins in the design."}
              </p>
            )}
            <label>
              Format{" "}
              <select
                value={format}
                disabled={saving}
                onChange={(e) => {
                  const next = e.target.value as PcbPinMapFormat;
                  setFormat(next);
                  setPath(defaultPath(next));
                }}
              >
                {map.formats.map((f) => (
                  <option key={f.format} value={f.format} disabled={!f.available}>
                    {f.format}
                    {f.reason ? `: ${f.reason}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {!available && (
              <p role="status">{map.formats.find((f) => f.format === format)?.reason}</p>
            )}
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
              {text.split("\n").slice(0, 400).join("\n")}
            </pre>
            {text.split("\n").length > 400 && (
              <small>Showing 400 of {text.split("\n").length} lines.</small>
            )}
            <p className={k.hint}>
              GPIO numbers come from pin names, not datasheets. Arduino output assumes Arduino-Pico,
              Arduino-ESP32, STM32duino or the Uno core. Check CircuitPython CPU names against your
              port.
            </p>
            {map.warnings.map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
            <label>
              Save path
              <Input value={path} disabled={saving} onChange={(e) => setPath(e.target.value)} />
            </label>
            {!canSave && <p>This connection cannot write files.</p>}
          </div>
        )}
        {error && (
          <p role="alert" className={k.error}>
            {error}
          </p>
        )}
        {saved && <p role="status">Saved to {saved}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={!map || saving}
            onClick={() => {
              copy.copyToClipboard(markdown, undefined);
            }}
          >
            Copy Markdown
          </Button>
          <Button
            variant="outline"
            disabled={!map || saving}
            onClick={() => {
              const drafts = useComposerDraftStore.getState();
              drafts.setPrompt(
                threadRef,
                appendSummary(drafts.getComposerDraft(threadRef)?.prompt ?? "", markdown),
              );
              setSaved("your draft");
            }}
          >
            Add to draft
          </Button>
          <Button
            disabled={!canSave || !map || invalid || !available || format === "markdown" || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving" : replaceKey === requestKey ? "Replace" : "Save file"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
