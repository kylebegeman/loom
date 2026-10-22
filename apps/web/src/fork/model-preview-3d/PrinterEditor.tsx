import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import * as Schema from "effect/Schema";
import { Printer, libraryProblems, type PrinterLibrary } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { useDisplayUnits, formatLengths } from "./units";

const decodePrinter = Schema.decodeUnknownSync(Printer);

export function PrinterEditor({
  initial,
  library,
  busy,
  onSave,
  onClose,
}: {
  initial: Printer;
  library: PrinterLibrary;
  busy: boolean;
  onSave: (printer: Printer) => Promise<void>;
  onClose: () => void;
}) {
  const [printer, setPrinter] = useState(initial),
    [nozzles, setNozzles] = useState(initial.nozzlesMm.join(", ")),
    [error, setError] = useState<string | null>(null);
  const units = useDisplayUnits();
  const set = <K extends keyof Printer>(key: K, value: Printer[K]) =>
    setPrinter((current) => ({ ...current, [key]: value }));
  const save = async () => {
    try {
      const decoded = decodePrinter({
        ...printer,
        name: printer.name.trim(),
        nozzlesMm: nozzles.trim() ? nozzles.split(",").map((value) => Number(value.trim())) : [],
      });
      const problems = libraryProblems({
        ...library,
        printers: [...library.printers.filter((p) => p.id !== decoded.id), decoded],
      });
      if (problems.length) {
        setError(new Error(problems[0]).message);
        return;
      }
      await onSave(decoded);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the printer fields.");
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial.name}</DialogTitle>
          <DialogDescription>
            Printer dimensions, nozzle reach and materials. Dimensions are saved in millimetres.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                Name
                <Input
                  aria-label="Printer name"
                  value={printer.name}
                  maxLength={60}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <LoomSettingsField label="Kind">
                <Select
                  disabled={busy}
                  value={printer.kind}
                  items={[
                    { value: "printer", label: "Printer" },
                    { value: "surface", label: "Surface" },
                  ]}
                  onValueChange={(kind) => {
                    if (!kind) return;
                    setPrinter((p) => ({
                      ...p,
                      kind,
                      volumeMm: [
                        p.volumeMm[0],
                        p.volumeMm[1],
                        kind === "surface" ? null : (p.volumeMm[2] ?? 250),
                      ],
                    }));
                  }}
                >
                  <SelectTrigger aria-label="Printer kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="printer">Printer</SelectItem>
                    <SelectItem value="surface">Surface</SelectItem>
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            </div>
            <LoomSettingsPanel title="Build volume">
              <div className="grid min-w-0 gap-4 sm:grid-cols-3">
                {["Width", "Depth", "Height"].map((axis, index) => (
                  <label key={axis} className="flex min-w-0 flex-col gap-2 text-sm">
                    {axis} (mm)
                    <Input
                      type="number"
                      aria-label={`${axis} (mm)`}
                      min={10}
                      max={2000}
                      disabled={index === 2 && printer.volumeMm[2] === null}
                      value={printer.volumeMm[index] ?? ""}
                      onChange={(e) =>
                        set("volumeMm", [
                          index === 0 ? Number(e.target.value) : printer.volumeMm[0],
                          index === 1 ? Number(e.target.value) : printer.volumeMm[1],
                          index === 2 ? Number(e.target.value) : printer.volumeMm[2],
                        ])
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatLengths(printer.volumeMm, units, { trim: true })}
              </p>
              {printer.kind === "surface" && (
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    disabled={busy}
                    checked={printer.volumeMm[2] === null}
                    onCheckedChange={(checked) =>
                      set("volumeMm", [
                        printer.volumeMm[0],
                        printer.volumeMm[1],
                        checked ? null : 250,
                      ])
                    }
                  />{" "}
                  No height limit
                </label>
              )}
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  disabled={busy}
                  checked={printer.bedShape === "round"}
                  onCheckedChange={(checked) => {
                    set("bedShape", checked ? "round" : "rectangle");
                    if (checked)
                      set("volumeMm", [
                        printer.volumeMm[0],
                        printer.volumeMm[0],
                        printer.volumeMm[2],
                      ]);
                  }}
                />{" "}
                Round bed
              </label>
            </LoomSettingsPanel>
            <label className="flex min-w-0 flex-col gap-2 text-sm">
              Nozzles (mm, comma separated)
              <Input
                aria-label="Nozzle sizes"
                value={nozzles}
                onChange={(e) => setNozzles(e.target.value)}
              />
            </label>
            <LoomSettingsPanel title="Materials">
              <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
                <legend className="sr-only">Compatible materials</legend>
                {library.materials.map((m) => (
                  <label key={m.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <Checkbox
                      disabled={busy}
                      checked={printer.materialIds.includes(m.id)}
                      onCheckedChange={(checked) => {
                        const ids = checked
                          ? [...printer.materialIds, m.id]
                          : printer.materialIds.filter((id) => id !== m.id);
                        setPrinter((p) => ({
                          ...p,
                          materialIds: ids,
                          defaultMaterialId:
                            p.defaultMaterialId && ids.includes(p.defaultMaterialId)
                              ? p.defaultMaterialId
                              : null,
                        }));
                      }}
                    />{" "}
                    {m.name}
                  </label>
                ))}
              </fieldset>
              <LoomSettingsField label="Default material">
                <Select
                  disabled={busy}
                  value={printer.defaultMaterialId ?? ""}
                  items={[
                    { value: "", label: "None" },
                    ...library.materials
                      .filter((material) => printer.materialIds.includes(material.id))
                      .map((material) => ({ value: material.id, label: material.name })),
                  ]}
                  onValueChange={(next) => set("defaultMaterialId", next || null)}
                >
                  <SelectTrigger aria-label="Default material">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="">None</SelectItem>
                    {library.materials
                      .filter((m) => printer.materialIds.includes(m.id))
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            </LoomSettingsPanel>
            <LoomSettingsDetails title="Nozzle zones">
              {printer.zones.map((zone, index) => (
                <div
                  key={zone.id}
                  className="flex min-w-0 flex-col gap-4 rounded-md border border-border p-3"
                >
                  <label className="flex min-w-0 flex-col gap-2 text-sm">
                    Zone name
                    <Input
                      aria-label={`Zone ${index + 1} label`}
                      value={zone.label}
                      onChange={(e) =>
                        set(
                          "zones",
                          printer.zones.map((z, i) =>
                            i === index ? { ...z, label: e.target.value } : z,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {(["offsetMm", "footprintMm"] as const).flatMap((key) =>
                      [0, 1].map((axis) => (
                        <label
                          key={`${key}-${axis}`}
                          className="flex min-w-0 flex-col gap-2 text-sm"
                        >
                          {key === "offsetMm" ? "Offset" : "Size"} {axis === 0 ? "X" : "Y"} (mm)
                          <Input
                            type="number"
                            min={key === "offsetMm" ? 0 : 10}
                            max={2000}
                            value={zone[key][axis]}
                            onChange={(e) =>
                              set(
                                "zones",
                                printer.zones.map((z, i) =>
                                  i === index
                                    ? ({
                                        ...z,
                                        [key]: z[key].map((v, a) =>
                                          a === axis ? Number(e.target.value) : v,
                                        ),
                                      } as typeof z)
                                    : z,
                                ),
                              )
                            }
                          />
                        </label>
                      )),
                    )}
                  </div>
                  <label className="flex min-w-0 flex-col gap-2 text-sm">
                    Height limit (mm, blank for full height)
                    <Input
                      type="number"
                      value={zone.heightMm ?? ""}
                      min={10}
                      max={2000}
                      onChange={(e) =>
                        set(
                          "zones",
                          printer.zones.map((z, i) =>
                            i === index
                              ? e.target.value
                                ? { ...z, heightMm: Number(e.target.value) }
                                : {
                                    id: z.id,
                                    label: z.label,
                                    offsetMm: z.offsetMm,
                                    footprintMm: z.footprintMm,
                                  }
                              : z,
                          ),
                        )
                      }
                    />
                  </label>
                  <LoomSettingsActions>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        set(
                          "zones",
                          printer.zones.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove zone
                    </Button>
                  </LoomSettingsActions>
                </div>
              ))}
              <LoomSettingsActions>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={printer.zones.length >= 8}
                  onClick={() =>
                    set("zones", [
                      ...printer.zones,
                      {
                        id: `zone-${randomUUID().slice(0, 8)}`,
                        label: `Nozzle ${printer.zones.length + 1}`,
                        footprintMm: [printer.volumeMm[0], printer.volumeMm[1]],
                        offsetMm: [0, 0],
                      },
                    ])
                  }
                >
                  Add zone
                </Button>
              </LoomSettingsActions>
            </LoomSettingsDetails>
            <label className="flex min-w-0 flex-col gap-2 text-sm">
              Notes
              <Textarea
                aria-label="Printer notes"
                value={printer.notes}
                maxLength={2000}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </fieldset>
        </DialogPanel>
        <DialogFooter>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
            <div className="flex justify-end">
              <LoomSettingsActions>
                <Button disabled={busy} onClick={() => void save()}>
                  Save printer
                </Button>
                <Button variant="outline" disabled={busy} onClick={onClose}>
                  Cancel
                </Button>
              </LoomSettingsActions>
            </div>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
