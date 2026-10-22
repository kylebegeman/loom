import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  activeBed,
  DEFAULT_BAMBU_MAPPINGS,
  listBeds,
  SLICER_LABELS,
  type BuildPlateSetting,
  type ImportSlicerProfile,
  type SlicerApp,
  type SlicerInfo,
  type SlicerMapping,
  type SlicerProfileEntry,
  type SlicerProfileList,
  type SlicerProfileRef,
  type SlicerSettings,
} from "@t3tools/contracts/fork";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { models, runModelCommand } from "./state";
import { usePrinterLibrary } from "./printers";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
} from "../settings/parts";

const NO_STATUS: readonly SlicerInfo[] = [];
const reference = (entry: SlicerProfileEntry): SlicerProfileRef => ({
  source: entry.source === "imported" ? "imported" : "installed",
  name: entry.name,
});
function ProfileSelect({
  label,
  entries,
  value,
  onChange,
  disabled,
}: {
  label: string;
  entries: readonly SlicerProfileEntry[];
  value: SlicerProfileRef | null;
  onChange: (value: SlicerProfileRef) => void;
  disabled: boolean;
}) {
  const current = value ? `${value.source}:${value.name}` : "";
  const options = entries.map((entry) => ({
    label: entry.name,
    value: `${reference(entry).source}:${entry.name}`,
  }));
  if (value && !options.some((option) => option.value === current))
    options.unshift({ label: `${value.name} (not found)`, value: current });
  return (
    <LoomSettingsField label={label}>
      <Select
        disabled={disabled}
        value={value ? current : null}
        items={options}
        onValueChange={(next) => {
          const entry = entries.find((item) => `${reference(item).source}:${item.name}` === next);
          if (entry) onChange(reference(entry));
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </LoomSettingsField>
  );
}
/** Profile imports are uploaded to the selected environment, including remote hosts. */
export function SlicingSettings({
  environmentId,
  value,
  onChange,
  buildPlate,
  disabled,
  status = NO_STATUS,
}: {
  environmentId: EnvironmentId;
  value: SlicerSettings;
  onChange: (value: SlicerSettings) => void;
  buildPlate: BuildPlateSetting;
  disabled: boolean;
  status?: readonly SlicerInfo[];
}) {
  const library = usePrinterLibrary(environmentId);
  const beds = listBeds(buildPlate, { library }).filter((bed) => bed.kind === "printer");
  const [chosenBed, setChosenBed] = useState<string | null>(null),
    [chosenApp, setChosenApp] = useState<SlicerApp>("bambu-studio"),
    [profiles, setProfiles] = useState<SlicerProfileList | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [importKind, setImportKind] = useState<ImportSlicerProfile["kind"]>("machine"),
    [reload, setReload] = useState(0),
    [importing, setImporting] = useState(false);
  const bedId =
    chosenBed && beds.some((bed) => bed.id === chosenBed)
      ? chosenBed
      : activeBed(buildPlate, { library }).id;
  const mapping = value.mappings[bedId];
  const app = mapping?.app ?? chosenApp;
  const machine = mapping?.machine.name;
  const latest = useRef({ value, bedId, app });
  useLayoutEffect(() => {
    latest.current = { value, bedId, app };
  });
  /* oxlint-disable react/set-state-in-effect, react/exhaustive-effect-dependencies -- Profile queries own their loading state and imports invalidate their cache. */
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setProfiles(null);
    void runModelCommand(models.slicerProfiles, {
      environmentId,
      input: { app, ...(machine ? { machine } : {}) },
    })
      .then((result) => {
        if (active) setProfiles(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [environmentId, app, machine, reload]);
  /* oxlint-enable react/set-state-in-effect, react/exhaustive-effect-dependencies */
  const setMapping = (next: SlicerMapping | null) => {
    const mappings = { ...value.mappings };
    if (next) mappings[bedId] = next;
    else delete mappings[bedId];
    onChange({ ...value, mappings });
  };
  const chooseMachine = (next: SlicerProfileRef) =>
    setMapping({
      app,
      machine: next,
      process: mapping?.app === app ? mapping.process : null,
      filaments: mapping?.app === app ? mapping.filaments : [],
      ...(mapping?.app === app && mapping.materialIds ? { materialIds: mapping.materialIds } : {}),
    });
  const importFile = async (file: File) => {
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("This profile is too large. Choose a file under 2 MiB.");
      return;
    }
    setImporting(true);
    try {
      const kind = app === "prusa-slicer" ? "config" : importKind;
      const entry = await runModelCommand(models.importSlicerProfile, {
        environmentId,
        input: { app, kind, fileName: file.name, text: await file.text() },
      });
      const ref = reference(entry);
      const current = latest.current;
      if (current.app === app && current.bedId === bedId) {
        const previous = current.value.mappings[bedId];
        const next =
          kind === "machine" || kind === "config"
            ? {
                app,
                machine: ref,
                process: previous?.app === app ? previous.process : null,
                filaments: previous?.app === app ? previous.filaments : [],
                ...(previous?.materialIds ? { materialIds: previous.materialIds } : {}),
              }
            : previous
              ? {
                  ...previous,
                  ...(kind === "process"
                    ? { process: ref }
                    : { filaments: [ref], materialIds: [previous.materialIds?.[0] ?? null] }),
                }
              : null;
        if (next)
          onChange({ ...current.value, mappings: { ...current.value.mappings, [bedId]: next } });
      }
      setReload((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setImporting(false);
  };
  const suggestion = DEFAULT_BAMBU_MAPPINGS[bedId];
  const materialSelect = (slot: number) => (
    <LoomSettingsField label={`Material for filament ${slot + 1}`}>
      <Select
        disabled={disabled}
        value={mapping?.materialIds?.[slot] ?? "profile"}
        items={[
          { value: "profile", label: "Default material or profile price" },
          ...(library?.materials ?? []).map((material) => ({
            value: material.id,
            label: material.name,
          })),
        ]}
        onValueChange={(next) => {
          if (mapping && next) {
            const materialIds = mapping.filaments.map(
              (_ref, index) => mapping.materialIds?.[index] ?? null,
            );
            materialIds[slot] = next === "profile" ? null : next;
            setMapping({ ...mapping, materialIds });
          }
        }}
      >
        <SelectTrigger size="sm" aria-label={`Material for filament ${slot + 1}`}>
          <SelectValue placeholder="Choose a material">
            {mapping?.materialIds?.[slot]
              ? (library?.materials.find((material) => material.id === mapping.materialIds?.[slot])
                  ?.name ?? "Saved material (not found)")
              : "Default material or profile price"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="profile">Default material or profile price</SelectItem>
          {library?.materials.map((material) => (
            <SelectItem key={material.id} value={material.id}>
              {material.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </LoomSettingsField>
  );
  return (
    <>
      <LoomSettingsNotice>
        Profile mappings are saved with model settings. Imported profile files are stored on this
        environment immediately.
      </LoomSettingsNotice>
      <LoomSettingsDetails title="Slicer executables on this environment">
        <SettingsRow
          className="px-0 sm:px-0"
          title="Slicer applications"
          description="Slicing runs on this host. Loom estimates and exports projects; open them in the slicer to review and print."
        >
          <div className="grid min-w-0 gap-4 pt-3 pb-2 sm:grid-cols-2">
            {(Object.keys(SLICER_LABELS) as SlicerApp[]).map((name) => {
              const info = status.find((item) => item.app === name);
              return (
                <label key={name} className="flex min-w-0 flex-col gap-2 text-sm">
                  <span className="font-medium">{SLICER_LABELS[name]}</span>
                  <span className="text-xs text-muted-foreground wrap-anywhere">
                    {info?.path
                      ? ` ${info.version ?? ""}${info.supported ? "" : " (unsupported version)"}`
                      : info
                        ? "Not detected"
                        : "Detection pending"}
                  </span>
                  <Input
                    size="sm"
                    aria-label={`${SLICER_LABELS[name]} executable`}
                    placeholder="Automatic detection"
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    value={value.paths[name] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        paths: { ...value.paths, [name]: event.target.value || null },
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </SettingsRow>
      </LoomSettingsDetails>
      <SettingsRow
        className="px-0 sm:px-0"
        title="Slicer profile mapping"
        description="Choose the printer, process and filament presets used for its estimates."
      >
        <div className="flex min-w-0 flex-col gap-4 pt-3 pb-2">
          {beds.length === 0 && (
            <LoomSettingsNotice>
              Add a printer in Printers, surfaces and materials before assigning slicer profiles.
            </LoomSettingsNotice>
          )}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <LoomSettingsField label="Printer">
              <Select
                disabled={disabled}
                value={bedId}
                items={beds.map((bed) => ({ value: bed.id, label: bed.label }))}
                onValueChange={(next) => {
                  if (next) setChosenBed(next);
                }}
              >
                <SelectTrigger size="sm" aria-label="Printer for slicer mapping">
                  <SelectValue placeholder="Choose a printer">
                    {beds.find((bed) => bed.id === bedId)?.label ?? "Choose a printer"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {beds.map((bed) => (
                    <SelectItem key={bed.id} value={bed.id}>
                      {bed.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </LoomSettingsField>
            <LoomSettingsField label="Slicer application">
              <Select
                disabled={disabled}
                value={app}
                items={(Object.keys(SLICER_LABELS) as SlicerApp[]).map((name) => ({
                  value: name,
                  label: SLICER_LABELS[name],
                }))}
                onValueChange={(next) => {
                  if (next) {
                    setChosenApp(next);
                    setMapping(null);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Slicer application">
                  <SelectValue>{SLICER_LABELS[app]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {(Object.keys(SLICER_LABELS) as SlicerApp[]).map((name) => (
                    <SelectItem key={name} value={name}>
                      {SLICER_LABELS[name]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </LoomSettingsField>
          </div>
          <ProfileSelect
            label={app === "prusa-slicer" ? "Config" : "Machine"}
            value={mapping?.machine ?? null}
            entries={profiles?.machines ?? []}
            disabled={disabled || loading}
            onChange={chooseMachine}
          />
          {app !== "prusa-slicer" && (
            <>
              <ProfileSelect
                label="Process"
                value={mapping?.process ?? null}
                entries={profiles?.processes ?? []}
                disabled={disabled || loading || !mapping}
                onChange={(process) => {
                  if (mapping) setMapping({ ...mapping, process });
                }}
              />
              {/* oxlint-disable react/no-array-index-key -- Filament slots are fixed positional identities in the slicer contract. */}
              {(mapping?.filaments.length ? mapping.filaments : [null]).map((filament, slot) => (
                <div key={slot} className="flex min-w-0 flex-wrap items-end gap-3">
                  <div className="grid min-w-0 flex-1 basis-64 gap-4 sm:grid-cols-2">
                    <ProfileSelect
                      label={`Filament ${slot + 1}`}
                      value={filament}
                      entries={profiles?.filaments ?? []}
                      disabled={disabled || loading || !mapping}
                      onChange={(ref) => {
                        if (mapping) {
                          const filaments = [...mapping.filaments];
                          filaments[slot] = ref;
                          setMapping({ ...mapping, filaments });
                        }
                      }}
                    />
                    {materialSelect(slot)}
                  </div>
                  {mapping && mapping.filaments.length > 1 && (
                    <Button
                      variant="ghost-muted"
                      size="sm"
                      onClick={() =>
                        setMapping({
                          ...mapping,
                          filaments: mapping.filaments.filter((_ref, index) => index !== slot),
                          ...(mapping.materialIds
                            ? {
                                materialIds: mapping.materialIds.filter(
                                  (_id, index) => index !== slot,
                                ),
                              }
                            : {}),
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {mapping && mapping.filaments.length > 0 && mapping.filaments.length < 16 && (
                <LoomSettingsActions>
                  <Button
                    variant="ghost-muted"
                    size="sm"
                    onClick={() =>
                      setMapping({
                        ...mapping,
                        filaments: [...mapping.filaments, mapping.filaments[0]!],
                        materialIds: [
                          ...mapping.filaments.map(
                            (_ref, index) => mapping.materialIds?.[index] ?? null,
                          ),
                          null,
                        ],
                      })
                    }
                  >
                    Add filament slot
                  </Button>
                </LoomSettingsActions>
              )}
            </>
          )}
          {app === "prusa-slicer" && mapping && materialSelect(0)}
          {!mapping && suggestion && app === "bambu-studio" && (
            <LoomSettingsActions>
              <Button variant="outline" size="sm" onClick={() => setMapping(suggestion)}>
                Use suggested Bambu profiles
              </Button>
            </LoomSettingsActions>
          )}
          {mapping && (
            <LoomSettingsActions>
              <Button variant="ghost-muted" size="sm" onClick={() => setMapping(null)}>
                Clear mapping
              </Button>
            </LoomSettingsActions>
          )}
          {loading && <LoomSettingsNotice role="status">Loading profiles...</LoomSettingsNotice>}
          {!loading && !error && profiles && profiles.machines.length === 0 && (
            <LoomSettingsNotice>
              No machine profiles were found for this slicer. Import an exported profile below, or
              create a preset in the slicer and reload profiles.
            </LoomSettingsNotice>
          )}
          <LoomSettingsActions>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || importing}
              onClick={() => setReload((current) => current + 1)}
            >
              Reload profiles
            </Button>
          </LoomSettingsActions>
          <LoomSettingsDetails title="Import slicer profiles">
            {app !== "prusa-slicer" && (
              <LoomSettingsField label="Profile type">
                <Select
                  disabled={disabled}
                  value={importKind}
                  items={[
                    { value: "machine", label: "Machine" },
                    { value: "process", label: "Process" },
                    { value: "filament", label: "Filament" },
                  ]}
                  onValueChange={(next) => {
                    if (next) setImportKind(next);
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Profile import kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {(["machine", "process", "filament"] as const).map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {{ machine: "Machine", process: "Process", filament: "Filament" }[kind]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            )}
            <label className="flex min-w-0 flex-col gap-2 text-sm">
              {app === "prusa-slicer"
                ? "Import exported Prusa config (INI)"
                : "Import exported preset (JSON)"}
              <Input
                type="file"
                size="sm"
                aria-label="Import slicer profile"
                accept={app === "prusa-slicer" ? ".ini" : ".json"}
                disabled={disabled || importing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = "";
                }}
              />
            </label>
          </LoomSettingsDetails>
          {importing && (
            <LoomSettingsNotice role="status">Importing slicer profile...</LoomSettingsNotice>
          )}
          {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
        </div>
      </SettingsRow>
      <SettingsRow
        className="px-0 sm:px-0"
        title="Slicing timeout"
        description="30 to 1800 seconds per slice. Longer jobs stop at this limit."
        control={
          <Input
            size="sm"
            type="number"
            min={30}
            max={1800}
            aria-label="Slicing timeout"
            value={Number.isNaN(value.timeoutSeconds) ? "" : value.timeoutSeconds}
            aria-invalid={
              !Number.isInteger(value.timeoutSeconds) ||
              value.timeoutSeconds < 30 ||
              value.timeoutSeconds > 1800
            }
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutSeconds:
                  event.target.value.trim() === "" ? Number.NaN : Number(event.target.value),
              })
            }
          />
        }
      />
      <SettingsRow
        className="px-0 sm:px-0"
        title="Estimate currency"
        description="Three-letter currency code, such as USD or EUR. Cost uses saved material prices or an explicitly priced user profile."
        control={
          <Input
            size="sm"
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="USD"
            aria-invalid={!/^[A-Z]{3}$/.test(value.currency)}
            disabled={disabled}
            aria-label="Estimate currency"
            value={value.currency}
            onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })}
          />
        }
      />
    </>
  );
}
