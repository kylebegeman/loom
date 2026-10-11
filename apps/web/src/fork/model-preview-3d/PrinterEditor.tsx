import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import * as Schema from "effect/Schema";
import { Printer, libraryProblems, type PrinterLibrary } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "~/components/ui/dialog";
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
      if (problems.length) throw new Error(problems[0]);
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
        <DialogTitle>{initial.name}</DialogTitle>
        <DialogDescription>
          Printer dimensions, nozzle reach and materials. Dimensions are saved in millimetres.
        </DialogDescription>
        <fieldset disabled={busy} className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          <label className="text-sm">
            Name
            <Input
              aria-label="Printer name"
              value={printer.name}
              maxLength={60}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label className="text-sm">
            Kind
            <select
              aria-label="Printer kind"
              value={printer.kind}
              onChange={(e) => {
                const kind = e.target.value === "surface" ? "surface" : "printer";
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
              <option value="printer">Printer</option>
              <option value="surface">Surface</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {["Width", "Depth", "Height"].map((axis, index) => (
              <label key={axis} className="text-xs">
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
            <label className="text-sm">
              <input
                type="checkbox"
                checked={printer.volumeMm[2] === null}
                onChange={(e) =>
                  set("volumeMm", [
                    printer.volumeMm[0],
                    printer.volumeMm[1],
                    e.target.checked ? null : 250,
                  ])
                }
              />{" "}
              No height limit
            </label>
          )}
          <label className="text-sm">
            <input
              type="checkbox"
              checked={printer.bedShape === "round"}
              onChange={(e) => {
                set("bedShape", e.target.checked ? "round" : "rectangle");
                if (e.target.checked)
                  set("volumeMm", [printer.volumeMm[0], printer.volumeMm[0], printer.volumeMm[2]]);
              }}
            />{" "}
            Round bed
          </label>
          <label className="text-sm">
            Nozzles (mm, comma separated)
            <Input
              aria-label="Nozzle sizes"
              value={nozzles}
              onChange={(e) => setNozzles(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm">Materials</legend>
            {library.materials.map((m) => (
              <label key={m.id} className="text-xs">
                <input
                  type="checkbox"
                  checked={printer.materialIds.includes(m.id)}
                  onChange={(e) => {
                    const ids = e.target.checked
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
          <label className="text-sm">
            Default material
            <select
              aria-label="Default material"
              value={printer.defaultMaterialId ?? ""}
              onChange={(e) => set("defaultMaterialId", e.target.value || null)}
            >
              <option value="">None</option>
              {library.materials
                .filter((m) => printer.materialIds.includes(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">Nozzle zones</legend>
            {printer.zones.map((zone, index) => (
              <div
                key={zone.id}
                className="flex flex-col gap-2 rounded-md border border-border p-2"
              >
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
                <div className="grid grid-cols-2 gap-2">
                  {(["offsetMm", "footprintMm"] as const).flatMap((key) =>
                    [0, 1].map((axis) => (
                      <label key={`${key}-${axis}`} className="text-xs">
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
                <label className="text-xs">
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
              </div>
            ))}
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
          </fieldset>
          <label className="text-sm">
            Notes
            <textarea
              aria-label="Printer notes"
              value={printer.notes}
              maxLength={2000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Save printer</Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </DialogPopup>
    </Dialog>
  );
}
