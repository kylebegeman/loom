import { useState } from "react";
import * as Schema from "effect/Schema";
import { Material, MATERIAL_LIMIT, type PrinterLibrary } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3" aria-label="Materials">
      <h3 className="text-sm font-medium">Materials</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Density</th>
              <th>Price/kg</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {library.materials.map((material) => {
              const used = library.printers.filter((p) =>
                p.materialIds.includes(material.id),
              ).length;
              return (
                <tr key={material.id}>
                  <td>
                    {material.name}
                    {used > 0 && (
                      <span className="block text-muted-foreground">
                        Used by {used} {used === 1 ? "printer" : "printers"}
                      </span>
                    )}
                  </td>
                  <td>{material.type}</td>
                  <td>{material.densityGCm3} g/cm³</td>
                  <td>{material.costPerKg ?? "Unknown"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
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
                    </div>
                    {deleting === material.id && (
                      <div className="flex flex-col gap-1">
                        <p>
                          Remove this material from {used} {used === 1 ? "printer" : "printers"}?
                        </p>
                        <div className="flex gap-1">
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
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
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
      </div>
      {draft && (
        <div
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          role="group"
          aria-label="Edit material"
        >
          <div className="grid grid-cols-2 gap-2">
            {(["name", "type", "brand", "colorHex"] as const).map((key) => (
              <label key={key} className="text-xs">
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
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
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
            <label className="text-xs">
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
          {(["nozzleC", "bedC"] as const).map((key) => (
            <fieldset key={key} className="grid grid-cols-2 gap-2">
              <legend className="text-xs">
                {key === "nozzleC" ? "Nozzle" : "Bed"} temperature (°C)
              </legend>
              {[0, 1].map((axis) => (
                <Input
                  key={axis}
                  aria-label={`${key} ${axis === 0 ? "minimum" : "maximum"}`}
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
              ))}
            </fieldset>
          ))}
          <label className="text-xs">
            Notes
            <textarea
              value={draft.notes}
              maxLength={2000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void commit()}>
              Save material
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
