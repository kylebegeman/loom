import { randomUUID } from "~/lib/utils";
import { Trash2Icon } from "lucide-react";
import {
  activeBed,
  addCustomBed,
  BUILD_PLATE_PRESETS,
  CUSTOM_BED_LIMIT,
  customBedNameError,
  listBeds,
  newCustomBedId,
  removeCustomBed,
  setPresetHidden,
  updateCustomBed,
  type BuildPlateSetting,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { CustomBedSize } from "./BedPicker";
import { useDisplayUnits } from "./units";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsDetails,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";

/** All edits stay in the settings draft until Save settings. */
export function ManageBeds({
  value,
  onChange,
  disabled,
}: {
  value: BuildPlateSetting;
  onChange: (value: BuildPlateSetting) => void;
  disabled: boolean;
}) {
  const units = useDisplayUnits();
  const chosen = activeBed(value);
  const add = () => {
    let number = value.customBeds.length + 1;
    while (customBedNameError(value, `Custom bed ${number}`)) number++;
    onChange(
      addCustomBed(value, {
        id: newCustomBedId(randomUUID()),
        name: `Custom bed ${number}`,
        volumeMm: value.customMm,
      }),
    );
  };
  return (
    <LoomSettingsContent>
      <fieldset
        disabled={disabled}
        className="flex min-w-0 flex-col gap-4"
        aria-label="Manage beds"
      >
        {chosen.id === "custom" && (
          <LoomSettingsPanel title="Custom size">
            <CustomBedSize
              key={`${value.customMm.join()}:${units}`}
              value={value.customMm}
              onCommit={(customMm) =>
                onChange({
                  ...value,
                  customMm: [customMm[0], customMm[1], customMm[2] ?? value.customMm[2]],
                })
              }
            />
          </LoomSettingsPanel>
        )}
        <LoomSettingsPanel
          title="Custom beds"
          description="Save custom beds and choose which presets appear in menus."
        >
          {!value.customBeds.length && <LoomSettingsNotice>No custom beds yet.</LoomSettingsNotice>}
          {value.customBeds.map((bed) => {
            const error = customBedNameError(value, bed.name, bed.id);
            return (
              <div
                key={bed.id}
                className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-32">
                    <Input
                      size="sm"
                      aria-label={`Name for ${bed.name || "custom bed"}`}
                      value={bed.name}
                      aria-invalid={!!error}
                      onChange={(event) =>
                        onChange(updateCustomBed(value, bed.id, { name: event.target.value }))
                      }
                      onBlur={() =>
                        onChange(updateCustomBed(value, bed.id, { name: bed.name.trim() }))
                      }
                    />
                  </div>
                  {chosen.id === bed.id && (
                    <span className="text-muted-foreground text-xs">In use</span>
                  )}
                  <Button
                    variant="ghost-muted"
                    size="icon-sm"
                    aria-label={`Delete ${bed.name || "custom bed"}`}
                    onClick={() => onChange(removeCustomBed(value, bed.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
                <CustomBedSize
                  key={`${bed.volumeMm.join()}:${units}`}
                  value={bed.volumeMm}
                  onCommit={(volumeMm) => onChange(updateCustomBed(value, bed.id, { volumeMm }))}
                />
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    disabled={disabled}
                    checked={bed.volumeMm[2] === null}
                    onCheckedChange={(unlimited) =>
                      onChange(
                        updateCustomBed(value, bed.id, {
                          volumeMm: [
                            bed.volumeMm[0],
                            bed.volumeMm[1],
                            unlimited ? null : value.customMm[2],
                          ],
                        }),
                      )
                    }
                  />
                  No height limit
                </label>
              </div>
            );
          })}
          <LoomSettingsActions>
            <Button
              variant="outline"
              size="sm"
              disabled={value.customBeds.length >= CUSTOM_BED_LIMIT}
              onClick={add}
            >
              Add custom bed
            </Button>
          </LoomSettingsActions>
          {value.customBeds.length >= CUSTOM_BED_LIMIT && (
            <LoomSettingsNotice>Up to 24 custom beds.</LoomSettingsNotice>
          )}
        </LoomSettingsPanel>
        <LoomSettingsDetails title="Show presets in menus">
          {(["printer", "surface"] as const).map((kind) => (
            <div key={kind} className="flex min-w-0 flex-col gap-3">
              <h5 className="text-xs text-muted-foreground">
                {kind === "printer" ? "Printers" : "Surfaces"}
              </h5>
              {listBeds(value, { includeHidden: true })
                .filter((bed) => bed.kind === kind)
                .map((bed) => {
                  const id = bed.id as keyof typeof BUILD_PLATE_PRESETS;
                  const inUse = value.preset === id;
                  return (
                    <label
                      key={id}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 wrap-anywhere">{bed.label}</span>
                      {inUse && <span className="text-muted-foreground">In use</span>}
                      <Switch
                        size="sm"
                        aria-label={`Show ${bed.label} in menus`}
                        checked={inUse || !value.hiddenPresets.includes(id)}
                        disabled={disabled || inUse}
                        onCheckedChange={(shown) => onChange(setPresetHidden(value, id, !shown))}
                      />
                    </label>
                  );
                })}
            </div>
          ))}
        </LoomSettingsDetails>
      </fieldset>
    </LoomSettingsContent>
  );
}
