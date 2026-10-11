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
    <Select
      disabled={disabled}
      value={current}
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
    [reload, setReload] = useState(0);
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
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("This profile is too large. Choose a file under 2 MiB.");
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
  };
  const suggestion = DEFAULT_BAMBU_MAPPINGS[bedId];
  const materialSelect = (slot: number) => (
    <Select
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
        <SelectValue />
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
  );
  return (
    <>
      <SettingsRow
        title="Slicer applications"
        description="Slicing runs on this host. Loom estimates and exports projects; open them in the slicer to review and print."
      >
        <div className="flex flex-col gap-3 py-2">
          {(Object.keys(SLICER_LABELS) as SlicerApp[]).map((name) => {
            const info = status.find((item) => item.app === name);
            return (
              <label key={name} className="flex flex-col gap-1 text-xs">
                {SLICER_LABELS[name]}
                {info?.path
                  ? ` ${info.version ?? ""}${info.supported ? "" : " (unsupported version)"}`
                  : " (not detected)"}
                <Input
                  size="sm"
                  aria-label={`${SLICER_LABELS[name]} executable`}
                  placeholder="Automatic detection"
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
      <SettingsRow
        title="Slicer profile mapping"
        description="Choose the printer, process and filament presets used for its estimates."
      >
        <div className="flex flex-col gap-2 py-2">
          <Select
            value={bedId}
            items={beds.map((bed) => ({ value: bed.id, label: bed.label }))}
            onValueChange={(next) => {
              if (next) setChosenBed(next);
            }}
          >
            <SelectTrigger size="sm" aria-label="Printer for slicer mapping">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {beds.map((bed) => (
                <SelectItem key={bed.id} value={bed.id}>
                  {bed.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
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
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {(Object.keys(SLICER_LABELS) as SlicerApp[]).map((name) => (
                <SelectItem key={name} value={name}>
                  {SLICER_LABELS[name]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
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
                <div key={slot} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
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
                      size="xs"
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
                <Button
                  variant="ghost-muted"
                  size="xs"
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
              )}
            </>
          )}
          {app === "prusa-slicer" && mapping && materialSelect(0)}
          {!mapping && suggestion && app === "bambu-studio" && (
            <Button variant="outline" size="xs" onClick={() => setMapping(suggestion)}>
              Use suggested Bambu profiles
            </Button>
          )}
          {mapping && (
            <Button variant="ghost-muted" size="xs" onClick={() => setMapping(null)}>
              Clear mapping
            </Button>
          )}
          {loading && (
            <p role="status" className="text-xs">
              Loading profiles...
            </p>
          )}
          {app !== "prusa-slicer" && (
            <Select
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
                    {kind}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          <label className="flex flex-col gap-1 text-xs">
            {app === "prusa-slicer"
              ? "Import exported Prusa config (INI)"
              : "Import exported preset (JSON)"}
            <Input
              type="file"
              size="sm"
              aria-label="Import slicer profile"
              accept={app === "prusa-slicer" ? ".ini" : ".json"}
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-warning">
              {error}
            </p>
          )}
        </div>
      </SettingsRow>
      <SettingsRow
        title="Slicing timeout (seconds)"
        control={
          <Input
            size="sm"
            type="number"
            min={30}
            max={1800}
            aria-label="Slicing timeout"
            value={value.timeoutSeconds}
            onChange={(event) => onChange({ ...value, timeoutSeconds: Number(event.target.value) })}
          />
        }
      />
      <SettingsRow
        title="Estimate currency"
        description="Cost uses saved material prices or an explicitly priced user profile."
        control={
          <Input
            size="sm"
            maxLength={3}
            aria-label="Estimate currency"
            value={value.currency}
            onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })}
          />
        }
      />
    </>
  );
}
