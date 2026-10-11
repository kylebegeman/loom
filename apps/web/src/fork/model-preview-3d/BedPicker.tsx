import styles from "./workspace.module.css";
import { useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, Grid3x3Icon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type BuildPlatePresetId,
  type BuildPlateSetting,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  BUILD_PLATE_PATTERNS,
  bedGroups,
  buildPlateLabel,
  buildPlateNote,
  formatVolume,
  resolveBuildVolume,
} from "./buildPlate";
import { Segmented } from "./controls";
import { models, runModelCommand } from "./state";

const samePlate = (a: BuildPlateSetting, b: BuildPlateSetting) =>
  a.preset === b.preset &&
  a.pattern === b.pattern &&
  a.customMm.every((value, axis) => value === b.customMm[axis]);

/**
 * The environment's bed setting with an optimistic save. The viewport and the Part tab both use
 * it, so the plate, its pattern and the fit checks always follow one saved value.
 */
export function useBuildPlate(environmentId: EnvironmentId, settings: ModelPreviewSettings) {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  // Shows the choice while the save and settings refresh are in flight.
  const [pending, setPending] = useState<BuildPlateSetting | null>(null);
  if (pending !== null && samePlate(pending, settings.buildPlate)) setPending(null);
  const plate = pending ?? settings.buildPlate;
  // Saves send the whole settings object, so they read the newest props, not the ones captured
  // when the control rendered, and a failed save only undoes its own choice.
  const latest = useRef({ settings, plate });
  useLayoutEffect(() => {
    latest.current = { settings, plate };
  });
  const save = async (next: BuildPlateSetting) => {
    if (samePlate(next, latest.current.plate)) return;
    latest.current.plate = next;
    setPending(next);
    try {
      await runModelCommand(models.updateSettings, {
        environmentId,
        input: { ...latest.current.settings, buildPlate: next },
      });
      appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
    } catch (error) {
      setPending((current) => (current === next ? null : current));
      toastManager.add({
        type: "error",
        title: "Bed not changed",
        description: error instanceof Error ? error.message : "The setting could not be saved.",
      });
    }
  };
  return { plate, canSave, save };
}

const AXES = ["Width", "Depth", "Height"] as const;
const inRange = (value: number) => Number.isFinite(value) && value >= 10 && value <= 2000;

/** Width, depth and height of the custom bed. Saves when every field holds 10 to 2000 mm. */
function CustomSize({
  value,
  onCommit,
}: {
  value: readonly [number, number, number];
  onCommit: (value: [number, number, number]) => void;
}) {
  const [draft, setDraft] = useState(() => value.map(String));
  const commit = () => {
    const next = draft.map(Number) as [number, number, number];
    if (next.every(inRange)) onCommit(next);
    else setDraft(value.map(String));
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {AXES.map((axis, index) => (
        <label key={axis} className="flex flex-col gap-1 text-muted-foreground text-xs">
          {axis}
          <Input
            aria-label={`Custom bed ${axis.toLowerCase()} in mm`}
            type="number"
            size="sm"
            min={10}
            max={2000}
            value={draft[index]}
            aria-invalid={!inRange(Number(draft[index]))}
            onChange={(event) =>
              setDraft((current) => current.map((v, i) => (i === index ? event.target.value : v)))
            }
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
        </label>
      ))}
    </div>
  );
}

/** Viewport control for the bed under the model: printer or surface, custom size, pattern. */
export function BedPicker({
  environmentId,
  settings,
}: {
  environmentId: EnvironmentId;
  settings: ModelPreviewSettings;
}) {
  const { plate, canSave, save } = useBuildPlate(environmentId, settings);
  const volume = resolveBuildVolume(plate);
  const note = buildPlateNote(plate);
  const label = buildPlateLabel(plate);
  return (
    <Popover>
      <PopoverTrigger
        render={<button className={styles["model-tool"]} aria-label={`Bed: ${label}`} />}
      >
        <Grid3x3Icon />
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverPopup align="end" width="sm">
        <PopoverTitle>Bed</PopoverTitle>
        <fieldset disabled={!canSave} className="mt-3 flex flex-col gap-3">
          <Select
            value={plate.preset}
            onValueChange={(next: BuildPlatePresetId | null) => {
              if (next) void save({ ...plate, preset: next });
            }}
          >
            <SelectTrigger size="sm" aria-label="Bed">
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {bedGroups(plate).map((group) => (
                <SelectGroup key={group.label}>
                  <SelectGroupLabel>{group.label}</SelectGroupLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex w-full items-center gap-4">
                        <span className="flex-1">{option.label}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatVolume(option.volumeMm)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectPopup>
          </Select>
          {plate.preset === "custom" && (
            <CustomSize
              key={plate.customMm.join()}
              value={plate.customMm}
              onCommit={(customMm) => void save({ ...plate, customMm })}
            />
          )}
          <Segmented
            label="Bed pattern"
            options={BUILD_PLATE_PATTERNS}
            value={plate.pattern}
            onChange={(pattern) => void save({ ...plate, pattern })}
          />
        </fieldset>
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
          {formatVolume(volume)} mm{volume[2] === null ? ", no height limit." : "."}
          {note ? ` ${note}` : ""}
          {canSave ? "" : " This connection cannot change model settings."}
        </p>
      </PopoverPopup>
    </Popover>
  );
}
