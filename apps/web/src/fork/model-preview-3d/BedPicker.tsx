import { blankPrinter, usePrinterLibrary } from "./printers";
import { randomUUID } from "~/lib/utils";
import styles from "./workspace.module.css";
import { Link } from "@tanstack/react-router";
import { forkSettingsTarget } from "../settings/navigation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, Grid3x3Icon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type BuildPlateSetting,
  type ModelPreviewSettings,
  type ScaleReference,
  SCALE_REFERENCE_LABELS,
  activeBed,
  addCustomBed,
  CUSTOM_BED_LIMIT,
  USER_PRINTER_LIMIT,
  customBedNameError,
  newCustomBedId,
  selectBed,
  updateCustomBed,
  type BedVolume,
  sharedZone,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
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
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  BUILD_PLATE_PATTERNS,
  bedGroups,
  buildPlateLabel,
  buildPlateNote,
  resolveBuildVolume,
} from "./buildPlate";
import { Segmented, Tip } from "./controls";
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the latest settings and reference into a ref read by async save callbacks
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
      await operation.finally(() => {
        if (pendingSave.current === operation) pendingSave.current = null;
      });
    },
    [canSave, environmentId],
  );
  return useMemo(() => ({ reference, canSave, save }), [reference, canSave, save]);
}

export const samePlate = (a: BuildPlateSetting, b: BuildPlateSetting) =>
  a.preset === b.preset &&
  a.pattern === b.pattern &&
  a.showZones === b.showZones &&
  a.customBedId === b.customBedId &&
  a.customMm.every((value, axis) => value === b.customMm[axis]) &&
  a.hiddenPresets.length === b.hiddenPresets.length &&
  a.hiddenPresets.every((id, index) => id === b.hiddenPresets[index]) &&
  a.customBeds.length === b.customBeds.length &&
  a.customBeds.every((bed, index) => {
    const other = b.customBeds[index];
    return (
      other &&
      bed.id === other.id &&
      bed.name === other.name &&
      bed.volumeMm.every((value, axis) => value === other.volumeMm[axis])
    );
  });

/** Optimistic choices serialize writes so a slow earlier save cannot undo the latest choice. */
export function useBuildPlate(environmentId: EnvironmentId, settings: ModelPreviewSettings) {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const [pending, setPending] = useState<BuildPlateSetting | null>(null);
  if (pending !== null && samePlate(pending, settings.buildPlate)) setPending(null);
  const plate = pending ?? settings.buildPlate;
  const latest = useRef({ settings, plate });
  const request = useRef(0);
  const queue = useRef(Promise.resolve());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the latest settings and plate into a ref read by queued save operations
  useLayoutEffect(() => {
    latest.current = { settings, plate };
  });
  const save = (next: BuildPlateSetting): Promise<void> => {
    if (!canSave || samePlate(next, latest.current.plate)) return queue.current;
    const version = ++request.current;
    latest.current.plate = next;
    setPending(next);
    const operation = queue.current.then(async () => {
      try {
        const saved = await runModelCommand(models.updateSettings, {
          environmentId,
          input: { ...latest.current.settings, buildPlate: next },
        });
        latest.current.settings = saved;
        if (version === request.current) {
          latest.current.plate = saved.buildPlate;
          setPending(saved.buildPlate);
        }
        appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
      } catch (error) {
        if (version === request.current) {
          latest.current.plate = latest.current.settings.buildPlate;
          setPending(null);
        }
        toastManager.add({
          type: "error",
          title: "Bed not changed",
          description: error instanceof Error ? error.message : "The setting could not be saved.",
        });
      }
    });
    queue.current = operation;
    return operation;
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
  value: BedVolume;
  onCommit: (value: [number, number, number | null]) => void;
}) {
  const { units } = useDisplayUnitsControl();
  const initial = value.map((mm) =>
    mm === null ? "No limit" : formatLength(mm, units, { digits: 1, trim: true, unit: false }),
  );
  const [draft, setDraft] = useState(initial);
  const valid = (text: string, index: number) =>
    text === initial[index] || (text.trim() !== "" && inRange(toMm(Number(text), units)));
  const commit = () => {
    if (draft.every((text, index) => text === initial[index])) return;
    const next = draft.map((text, index) =>
      text === initial[index] ? value[index]! : Math.round(toMm(Number(text), units) * 10) / 10,
    ) as [number, number, number | null];
    if (draft.every(valid) && next.every((number) => number === null || inRange(number)))
      onCommit(next);
    else setDraft(initial);
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {AXES.map((axis, index) => (
        <label key={axis} className="flex flex-col gap-1 text-muted-foreground text-xs">
          {axis} {units}
          <Input
            aria-label={`Custom size ${axis.toLowerCase()} in ${units}`}
            type={value[index] === null ? "text" : "number"}
            readOnly={value[index] === null}
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
  const library = usePrinterLibrary(environmentId);
  const { units, setUnits, canSave: canSaveUnits } = useDisplayUnitsControl();
  const ownReference = useScaleReference(environmentId, settings);
  const scale = referenceControl ?? ownReference;
  const { plate, canSave, save } = useBuildPlate(environmentId, settings);
  const volume = resolveBuildVolume(plate, library);
  const chosen = activeBed(plate, { library });
  const [bedName, setBedName] = useState<string | null>(null);
  const nameError =
    bedName === null
      ? null
      : library
        ? !bedName.trim()
          ? "Enter a bed name."
          : bedName.trim().length > 60
            ? "Use up to 60 characters."
            : library.printers.some(
                  (p) => p.name.trim().toLocaleLowerCase() === bedName.trim().toLocaleLowerCase(),
                )
              ? "A printer with this name already exists."
              : null
        : customBedNameError(plate, bedName);
  const atLimit = library
    ? library.printers.length >= USER_PRINTER_LIMIT
    : plate.customBeds.length >= CUSTOM_BED_LIMIT;
  const saveAsBed = () => {
    if (bedName === null || nameError || atLimit) return;
    if (library) {
      const entry = {
        ...blankPrinter(newCustomBedId(randomUUID()), "printer"),
        name: bedName.trim(),
        volumeMm: plate.customMm,
      };
      void runModelCommand(models.updatePrinters, {
        environmentId,
        input: {
          expectedVersion: library.version,
          printers: [...library.printers, entry],
          materials: library.materials,
          hiddenBuiltIns: library.hiddenBuiltIns,
        },
      })
        .then(async (next) => {
          appAtomRegistry.refresh(models.printers({ environmentId, input: {} }));
          await save(selectBed(plate, entry.id, { library: next }));
          setBedName(null);
        })
        .catch((cause) =>
          toastManager.add({
            type: "error",
            title: "Bed not saved",
            description:
              cause instanceof Error ? cause.message : "The printer library could not be saved.",
          }),
        );
      return;
    }
    void save(
      addCustomBed(plate, {
        id: newCustomBedId(randomUUID()),
        name: bedName.trim(),
        volumeMm: plate.customMm,
      }),
    );
    setBedName(null);
  };
  const note = buildPlateNote(plate, library);
  const zones = activeBed(plate, { library }).zones ?? [];
  const common = sharedZone(zones, volume[2]);
  const label = buildPlateLabel(plate, library);
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
            value={chosen.id}
            onValueChange={(next: string | null) => {
              if (next) {
                setBedName(null);
                void save(selectBed(plate, next, { library }));
              }
            }}
          >
            <SelectTrigger size="sm" aria-label="Bed">
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {bedGroups(plate, library).map((group) => (
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
          {plate.preset === "custom" && (!library || chosen.id === "custom") && (
            <CustomBedSize
              key={`${chosen.id}:${volume.join()}:${units}`}
              value={volume}
              onCommit={(next) =>
                void save(
                  chosen.id === "custom"
                    ? { ...plate, customMm: [next[0], next[1], next[2] ?? plate.customMm[2]] }
                    : updateCustomBed(plate, chosen.id, { volumeMm: next }),
                )
              }
            />
          )}
          {chosen.id === "custom" &&
            (bedName === null ? (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={atLimit}
                  onClick={() => setBedName("")}
                >
                  Save as bed
                </Button>
                {atLimit && <p className="text-muted-foreground text-xs">Up to 24 custom beds.</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Input
                  autoFocus
                  aria-label="New bed name"
                  size="sm"
                  value={bedName}
                  aria-invalid={!!nameError}
                  onChange={(event) => setBedName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveAsBed();
                    } else if (event.key === "Escape") {
                      event.stopPropagation();
                      setBedName(null);
                    }
                  }}
                />
                {nameError && (
                  <p role="alert" className="text-xs text-destructive">
                    {nameError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" disabled={!!nameError} onClick={saveAsBed}>
                    Save bed
                  </Button>
                  <Button size="sm" variant="ghost-muted" onClick={() => setBedName(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          <Segmented
            label="Bed pattern"
            options={BUILD_PLATE_PATTERNS}
            value={plate.pattern}
            onChange={(pattern) => void save({ ...plate, pattern })}
          />
          {zones.length > 0 && (
            <Tip
              label={
                canSave
                  ? "Tint the areas reached by one nozzle only."
                  : "This connection cannot change model settings."
              }
            >
              <label
                className="flex items-center justify-between gap-3 text-xs"
                tabIndex={canSave ? undefined : 0}
              >
                Show nozzle zones
                <Switch
                  size="sm"
                  aria-label="Show nozzle zones"
                  checked={plate.showZones}
                  disabled={!canSave}
                  onCheckedChange={(showZones) => void save({ ...plate, showZones })}
                />
              </label>
            </Tip>
          )}
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
        <div className="mt-2">
          <Button
            variant="link"
            size="xs"
            render={<Link {...forkSettingsTarget("model-preview-3d")} />}
          >
            Manage printers
          </Button>
        </div>
        {zones.length > 0 && (
          <div className={styles["model-zone-legend"]}>
            {common && (
              <div>
                {plate.showZones && (
                  <span className={styles["model-zone-swatch"]} aria-hidden="true" />
                )}
                <span>
                  Both nozzles{" "}
                  {formatLengths([...common.footprintMm, common.heightMm], units, { trim: true })}
                </span>
              </div>
            )}
            <div>
              {plate.showZones && (
                <span className={styles["model-zone-swatch"]} data-single aria-hidden="true" />
              )}
              <span>One nozzle only</span>
            </div>
          </div>
        )}
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
          {formatLengths(volume, units, { trim: true })}
          {volume[2] === null ? ", no height limit." : "."}
          {note ? ` ${note}` : ""}
          {zones.length > 0
            ? " Move parts in the slicer; Loom centres the plate under the part."
            : ""}
          {canSave ? "" : " This connection cannot change model settings."}
        </p>
      </PopoverPopup>
    </Popover>
  );
}
