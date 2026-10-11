import styles from "./workspace.module.css";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, Grid3x3Icon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type BuildPlatePresetId,
  type BuildPlateSetting,
  type ModelPreviewSettings,
  type ScaleReference,
  SCALE_REFERENCE_LABELS,
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
  resolveBuildVolume,
} from "./buildPlate";
import { Segmented } from "./controls";
import { models, runModelCommand } from "./state";
import { formatLength, formatLengths, fromMm, toMm, useDisplayUnitsControl } from "./units";

export type ScaleReferenceControl = {
  readonly reference: ScaleReference;
  readonly canSave: boolean;
  readonly save: (reference: ScaleReference) => Promise<void>;
};

/** The environment's scale cue. A failed save rejects so editor commands can report failure. */
export function useScaleReference(
  environmentId: EnvironmentId,
  settings: ModelPreviewSettings,
  getSettings?: () => ModelPreviewSettings,
): ScaleReferenceControl {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const [pending, setPending] = useState<ScaleReference | null>(null);
  if (pending === settings.scaleReference) setPending(null);
  const reference = pending ?? settings.scaleReference;
  const latest = useRef({ settings, reference, getSettings });
  const request = useRef(0);
  const pendingSave = useRef<Promise<void> | null>(null);
  useLayoutEffect(() => {
    latest.current = { settings, reference, getSettings };
  });
  const save = useCallback(
    async (next: ScaleReference) => {
      if (!canSave) throw new Error("This connection cannot change model settings.");
      if (next === latest.current.reference) {
        await pendingSave.current;
        return;
      }
      const version = ++request.current;
      latest.current.reference = next;
      setPending(next);
      const operation = (async () => {
        try {
          const saved = await runModelCommand(models.updateSettings, {
            environmentId,
            input: {
              ...(latest.current.getSettings?.() ?? latest.current.settings),
              scaleReference: next,
            },
          });
          if (request.current === version) latest.current.settings = saved;
          appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
        } catch (error) {
          if (request.current === version) {
            latest.current.reference = latest.current.settings.scaleReference;
            setPending(null);
          }
          toastManager.add({
            type: "error",
            title: "Scale reference not changed",
            description: error instanceof Error ? error.message : "The setting could not be saved.",
          });
          throw error;
        }
      })();
      pendingSave.current = operation;
      try {
        await operation;
      } finally {
        if (pendingSave.current === operation) pendingSave.current = null;
      }
    },
    [canSave, environmentId],
  );
  return useMemo(() => ({ reference, canSave, save }), [reference, canSave, save]);
}

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
export function CustomBedSize({
  value,
  onCommit,
}: {
  value: readonly [number, number, number];
  onCommit: (value: [number, number, number]) => void;
}) {
  const { units } = useDisplayUnitsControl();
  const initial = value.map((mm) =>
    formatLength(mm, units, { digits: 1, trim: true, unit: false }),
  );
  const [draft, setDraft] = useState(initial);
  const valid = (text: string, index: number) =>
    text === initial[index] || (text.trim() !== "" && inRange(toMm(Number(text), units)));
  const commit = () => {
    if (draft.every((text, index) => text === initial[index])) return;
    const next = draft.map((text, index) =>
      text === initial[index] ? value[index]! : Math.round(toMm(Number(text), units) * 10) / 10,
    ) as [number, number, number];
    if (draft.every(valid) && next.every(inRange)) onCommit(next);
    else setDraft(initial);
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {AXES.map((axis, index) => (
        <label key={axis} className="flex flex-col gap-1 text-muted-foreground text-xs">
          {axis} {units}
          <Input
            aria-label={`Custom bed ${axis.toLowerCase()} in ${units}`}
            type="number"
            size="sm"
            min={fromMm(10, units)}
            max={fromMm(2000, units)}
            step={units === "in" ? 0.01 : 1}
            value={draft[index]}
            aria-invalid={!valid(draft[index]!, index)}
            title={`Use ${formatLength(10, units)} to ${formatLength(2000, units)}.`}
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
  referenceControl,
}: {
  environmentId: EnvironmentId;
  settings: ModelPreviewSettings;
  referenceControl?: ScaleReferenceControl;
}) {
  const { units, setUnits, canSave: canSaveUnits } = useDisplayUnitsControl();
  const ownReference = useScaleReference(environmentId, settings);
  const scale = referenceControl ?? ownReference;
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
                          {formatLengths(option.volumeMm, units, { trim: true })}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectPopup>
          </Select>
          {plate.preset === "custom" && (
            <CustomBedSize
              key={`${plate.customMm.join()}:${units}`}
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
          <fieldset disabled={!canSaveUnits}>
            <Segmented
              label="Units"
              options={[
                { value: "mm", label: "mm" },
                { value: "in", label: "in" },
              ]}
              value={units}
              onChange={setUnits}
            />
          </fieldset>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Show for scale
            <Select
              value={scale.reference}
              onValueChange={(next: ScaleReference | null) => {
                if (next) void scale.save(next).catch(() => undefined);
              }}
            >
              <SelectTrigger size="sm" aria-label="Show for scale">
                <SelectValue>{SCALE_REFERENCE_LABELS[scale.reference]}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {Object.entries(SCALE_REFERENCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        </fieldset>
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
          {formatLengths(volume, units, { trim: true })}
          {volume[2] === null ? ", no height limit." : "."}
          {note ? ` ${note}` : ""}
          {canSave ? "" : " This connection cannot change model settings."}
        </p>
      </PopoverPopup>
    </Popover>
  );
}
