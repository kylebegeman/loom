import { useState } from "react";
import * as Schema from "effect/Schema";
import { Material, MATERIAL_LIMIT, type PrinterLibrary } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";
import { randomUUID } from "~/lib/utils";

const decodeMaterial = Schema.decodeUnknownSync(Material);

export function MaterialsSection({
  library,
  disabled,
  save,
}: {
  library: PrinterLibrary;
  disabled: boolean;
  save: (value: PrinterLibrary) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Material | null>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const newId = () => `material-${randomUUID()}`;
  const commit = async () => {
    if (!draft) return;
    try {
      const material = decodeMaterial(draft);
      await save({
        ...library,
        materials: [...library.materials.filter((m) => m.id !== material.id), material],
      });
      setDraft(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the material fields.");
    }
  };
  const remove = async (id: string) => {
    await save({
      ...library,
      materials: library.materials.filter((m) => m.id !== id),
      printers: library.printers.map((p) => ({
        ...p,
        materialIds: p.materialIds.filter((value) => value !== id),
        defaultMaterialId: p.defaultMaterialId === id ? null : p.defaultMaterialId,
      })),
    });
    setDeleting(null);
  };
  const set = <K extends keyof Material>(key: K, value: Material[K]) =>
    setDraft((current) => current && { ...current, [key]: value });
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4" aria-label="Materials">
      <legend className="mb-3 text-sm font-medium">Materials</legend>
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full min-w-lg text-left text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Type
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Density
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Price/kg
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {library.materials.map((material) => {
              const used = library.printers.filter((p) =>
                p.materialIds.includes(material.id),
              ).length;
              return (
                <tr key={material.id} className="align-top">
                  <td className="max-w-48 px-3 py-3 wrap-anywhere">
                    <span className="font-medium">{material.name}</span>
                    {used > 0 && (
                      <span className="block text-muted-foreground">
                        Used by {used} {used === 1 ? "printer" : "printers"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">{material.type}</td>
                  <td className="px-3 py-3">{material.densityGCm3} g/cm³</td>
                  <td className="px-3 py-3">{material.costPerKg ?? "Unknown"}</td>
                  <td className="min-w-48 px-3 py-3">
                    <LoomSettingsActions>
                      <Button size="xs" variant="ghost" onClick={() => setDraft(material)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={library.materials.length >= MATERIAL_LIMIT}
                        onClick={() =>
                          setDraft({
                            ...material,
                            id: newId(),
                            name: `${material.name} copy`.slice(0, 60),
                          })
                        }
                      >
                        Duplicate
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          if (used) setDeleting(material.id);
                          else void remove(material.id);
                        }}
                      >
                        Delete
                      </Button>
                    </LoomSettingsActions>
                    {deleting === material.id && (
                      <div className="mt-3 flex min-w-0 flex-col gap-3">
                        <LoomSettingsNotice>
                          Remove this material from {used} {used === 1 ? "printer" : "printers"}?
                        </LoomSettingsNotice>
                        <LoomSettingsActions>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void remove(material.id)}
                          >
                            Remove material
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setDeleting(null)}>
                            Cancel
                          </Button>
                        </LoomSettingsActions>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoomSettingsActions>
        <Button
          size="sm"
          variant="outline"
          disabled={library.materials.length >= MATERIAL_LIMIT}
          onClick={() =>
            setDraft({
              id: newId(),
              name: "New material",
              type: "PLA",
              brand: null,
              colorHex: null,
              densityGCm3: 1.24,
              costPerKg: null,
              nozzleC: null,
              bedC: null,
              notes: "",
            })
          }
        >
          Add material
        </Button>
      </LoomSettingsActions>
      {draft && (
        <LoomSettingsPanel title="Edit material">
          <div className="flex min-w-0 flex-col gap-4" role="group" aria-label="Edit material">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              {(["name", "type", "brand", "colorHex"] as const).map((key) => (
                <label key={key} className="flex min-w-0 flex-col gap-2 text-sm">
                  {{ name: "Name", type: "Type", brand: "Brand", colorHex: "Colour hex" }[key]}
                  <Input
                    aria-label={`Material ${key}`}
                    value={draft[key] ?? ""}
                    onChange={(e) =>
                      set(
                        key,
                        key === "name" || key === "type" ? e.target.value : e.target.value || null,
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                Density (g/cm³)
                <Input
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.01}
                  value={draft.densityGCm3}
                  onChange={(e) => set("densityGCm3", Number(e.target.value))}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                Price per kg (blank if unknown)
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  step={0.1}
                  value={draft.costPerKg ?? ""}
                  onChange={(e) => set("costPerKg", e.target.value ? Number(e.target.value) : null)}
                />
              </label>
            </div>
            <LoomSettingsDetails title="Temperature ranges and notes">
              {(["nozzleC", "bedC"] as const).map((key) => (
                <fieldset key={key} className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <legend className="mb-2 text-sm font-medium">
                    {key === "nozzleC" ? "Nozzle" : "Bed"} temperature (°C)
                  </legend>
                  {[0, 1].map((axis) => (
                    <label key={axis} className="flex min-w-0 flex-col gap-2 text-sm">
                      {axis === 0 ? "Minimum" : "Maximum"}
                      <Input
                        aria-label={`${key === "nozzleC" ? "Nozzle" : "Bed"} temperature ${axis === 0 ? "minimum" : "maximum"} (°C)`}
                        type="number"
                        min={0}
                        max={500}
                        value={draft[key]?.[axis] ?? ""}
                        onChange={(e) => {
                          const range: [number, number] = draft[key] ? [...draft[key]] : [0, 0];
                          range[axis] = Number(e.target.value);
                          set(key, e.target.value ? range : null);
                        }}
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                Notes
                <Textarea
                  aria-label="Material notes"
                  value={draft.notes}
                  maxLength={2000}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </label>
            </LoomSettingsDetails>
            {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
            <LoomSettingsActions>
              <Button size="sm" onClick={() => void commit()}>
                Save material
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </LoomSettingsActions>
          </div>
        </LoomSettingsPanel>
      )}
    </fieldset>
  );
}
