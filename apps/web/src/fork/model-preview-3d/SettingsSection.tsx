import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ModelPreviewSettings,
  activeBed,
  DISPLAY_PRECISIONS,
  type DisplayPrecision,
  type DisplayUnits,
  type AgentModelsMode,
  type ScaleReference,
  SCALE_REFERENCE_LABELS,
  type BuildPlatePattern,
  selectBed,
  customBedNameError,
  type ModelPreviewStatus,
} from "@t3tools/contracts/fork";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { PathField } from "~/fork/settings/PathField";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { OperationStatus } from "./OperationStatus";
import { BUILD_PLATE_PATTERNS, bedGroups, buildPlateLabel, buildPlateNote } from "./buildPlate";
import { models, runModelCommand } from "./state";
import { DisplayUnitsProvider, formatLengths, precisionLabel } from "./units";
import { ManageBeds } from "./ManageBeds";
import { PrintersSection } from "./PrintersSection";
import { usePrinterLibrary } from "./printers";
import { PythonCadSettings } from "./PythonCadSettings";
import { SlicingSettings } from "./SlicingSettings";

const validateSettings = Schema.decodeSync(ModelPreviewSettings);
const isValidSettings = Schema.is(ModelPreviewSettings);
const BACKENDS = [
  { value: "auto", label: "Automatic" },
  { value: "manifold", label: "Manifold" },
  { value: "cgal", label: "CGAL" },
] as const satisfies readonly { value: ModelPreviewSettings["backend"]; label: string }[];
function useSettingsAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const act = async (task: () => Promise<unknown>, success: string) => {
    setBusy(
      success === "Detection refreshed."
        ? "Detecting OpenSCAD"
        : success === "Render cache cleared."
          ? "Clearing render cache"
          : "Saving model settings",
    );
    setMessage(null);
    setFailed(false);
    try {
      await task();
      setMessage(success);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy(null);
  };
  return { busy, message, failed, act, clearMessage: () => setMessage(null) };
}
function SettingsForm({
  environmentId,
  initial,
  action,
}: {
  environmentId: EnvironmentId;
  initial: ModelPreviewSettings;
  action: ReturnType<typeof useSettingsAction>;
}) {
  const [draft, setDraft] = useState<Partial<ModelPreviewSettings>>({});
  const [savedResult, setSavedResult] = useState<{
    source: ModelPreviewSettings;
    value: ModelPreviewSettings;
  } | null>(null);
  // Keep the command result visible until the refreshed settings snapshot arrives.
  const baseline = savedResult?.source === initial ? savedResult.value : initial;
  const settings = { ...baseline, ...draft };
  const [detection, setDetection] = useState<ModelPreviewStatus | null>(null);
  const [numbers, setNumbers] = useState<
    Partial<
      Record<
        | "renderTimeoutSeconds"
        | "maxFileMegabytes"
        | "nozzleDiameterMm"
        | "overhangAngleDegrees"
        | "firstLayerHeightMm",
        string
      >
    >
  >({});
  const { busy, message, failed, act, clearMessage } = action;
  const configs = useServerConfigs();
  const library = usePrinterLibrary(environmentId);
  const features = loomFeaturesOf(configs.get(environmentId)?.environment.capabilities);
  const canSetupPython = useAtomValue(models.pythonSetup.permissionAtom(environmentId));
  const supportsPrinters = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes("printer-library");
  const supportsAgentModels = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes("model-follow-agent");
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const status = useAtomValue(models.status({ environmentId, input: {} }));
  const info = detection ?? Option.getOrNull(AsyncResult.value(status));
  const precision: DisplayPrecision = settings.displayPrecision ?? "auto";
  const set = <K extends keyof ModelPreviewSettings>(key: K, value: ModelPreviewSettings[K]) => {
    clearMessage();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setNumber = (key: keyof typeof numbers, value: string) => {
    setNumbers((current) => ({ ...current, [key]: value }));
    set(key, value.trim() === "" ? Number.NaN : Number(value));
  };
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);
  const valid = isValidSettings(settings);
  const invalidBedName =
    !supportsPrinters &&
    settings.buildPlate.customBeds.some((bed) =>
      customBedNameError(settings.buildPlate, bed.name, bed.id),
    );
  const save = () =>
    act(async () => {
      const validated = validateSettings(settings);
      const saved = await runModelCommand(models.updateSettings, {
        environmentId,
        input: validated,
      });
      setSavedResult({ source: initial, value: saved });
      setDraft({});
      setNumbers({});
      appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
      appAtomRegistry.refresh(models.status({ environmentId, input: {} }));
    }, "Settings saved.");
  return (
    <DisplayUnitsProvider
      value={{
        units: settings.displayUnits,
        setUnits: (units) => set("displayUnits", units),
        canSave,
        precision: settings.displayPrecision,
      }}
    >
      <fieldset disabled={!canSave || busy !== null} className="flex min-w-0 flex-col">
        <LoomSettingsContent className="flex flex-col gap-5">
          <LoomSettingsPanel
            title="Viewer preferences"
            description="Choose how models, measurements and captures appear."
          >
            <SettingsRow
              title="Units"
              description="Lengths shown in the 3D panel. Models and agent tools stay in millimetres."
              control={
                <Select
                  disabled={!canSave}
                  value={settings.displayUnits}
                  onValueChange={(next: DisplayUnits | null) => {
                    if (next) set("displayUnits", next);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Units">
                    <SelectValue>
                      {settings.displayUnits === "in" ? "Inches" : "Millimetres"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="mm">Millimetres</SelectItem>
                    <SelectItem value="in">Inches</SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              title="Precision"
              description="Decimal places for lengths, changes and areas, shown and copied. Automatic keeps each value's usual form."
              control={
                <Select<DisplayPrecision>
                  disabled={!canSave}
                  value={precision}
                  onValueChange={(next: DisplayPrecision | null) => {
                    if (next !== null) set("displayPrecision", next);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Precision">
                    <SelectValue>{precisionLabel(precision)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {DISPLAY_PRECISIONS.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {precisionLabel(choice)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              title="Render colors"
              description="Export SCAD as 3MF to preserve model colors."
              control={
                <Switch
                  aria-label="Render colors"
                  checked={settings.renderColors}
                  onCheckedChange={(checked) => set("renderColors", checked)}
                />
              }
            />
            <SettingsRow
              title="Show for scale"
              description="An everyday object beside the part, included in captures when visible."
              control={
                <Select
                  disabled={!canSave}
                  value={settings.scaleReference}
                  onValueChange={(next: ScaleReference | null) => {
                    if (next) set("scaleReference", next);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Show for scale">
                    <SelectValue>{SCALE_REFERENCE_LABELS[settings.scaleReference]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {Object.entries(SCALE_REFERENCE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          </LoomSettingsPanel>
          <LoomSettingsPanel
            title="Build plate and print checks"
            description="Choose the active plate and the defaults used to check printability."
          >
            <SettingsRow
              title="Bed"
              description="The plate under the model and the size fit checks use."
              control={
                <Select
                  value={activeBed(settings.buildPlate, { library }).id}
                  onValueChange={(next: string | null) => {
                    if (next) set("buildPlate", selectBed(settings.buildPlate, next, { library }));
                  }}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Bed">
                    <SelectValue>{buildPlateLabel(settings.buildPlate, library)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {bedGroups(settings.buildPlate, library).map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectGroupLabel>{group.label}</SelectGroupLabel>
                        {group.options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <span className="flex min-w-0 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
                              <span className="min-w-0 break-words">{option.label}</span>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {formatLengths(option.volumeMm, settings.displayUnits, {
                                  trim: true,
                                })}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              title="Bed pattern"
              control={
                <Select
                  value={settings.buildPlate.pattern}
                  onValueChange={(next: BuildPlatePattern | null) => {
                    if (next) set("buildPlate", { ...settings.buildPlate, pattern: next });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Bed pattern">
                    <SelectValue>
                      {
                        BUILD_PLATE_PATTERNS.find(
                          ({ value }) => value === settings.buildPlate.pattern,
                        )?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {BUILD_PLATE_PATTERNS.map((pattern) => (
                      <SelectItem key={pattern.value} value={pattern.value}>
                        {pattern.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            {!!activeBed(settings.buildPlate, { library }).zones?.length && (
              <SettingsRow
                title="Show nozzle zones"
                description="Tint areas that only one nozzle reaches. Fit checks always use nozzle limits."
                control={
                  <Switch
                    size="sm"
                    aria-label="Show nozzle zones"
                    disabled={!canSave}
                    checked={settings.buildPlate.showZones}
                    onCheckedChange={(showZones) =>
                      set("buildPlate", { ...settings.buildPlate, showZones })
                    }
                  />
                }
              />
            )}
            <h4 className="text-sm font-semibold">Print check defaults</h4>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <LoomSettingsField
                label="Nozzle diameter (mm)"
                description="Used for print checks unless the selected printer provides its nozzle diameter."
              >
                <Input
                  aria-label="Nozzle diameter (mm)"
                  type="number"
                  size="sm"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={numbers.nozzleDiameterMm ?? String(settings.nozzleDiameterMm)}
                  aria-invalid={
                    !Number.isFinite(settings.nozzleDiameterMm) ||
                    settings.nozzleDiameterMm < 0.1 ||
                    settings.nozzleDiameterMm > 2
                  }
                  onChange={(event) => setNumber("nozzleDiameterMm", event.target.value)}
                />
              </LoomSettingsField>
              <LoomSettingsField
                label="Overhang limit (degrees)"
                description="Faces beyond this angle from vertical are flagged by print checks and overhang shading."
              >
                <Input
                  aria-label="Overhang limit (degrees)"
                  type="number"
                  size="sm"
                  min={30}
                  max={70}
                  step={1}
                  value={numbers.overhangAngleDegrees ?? String(settings.overhangAngleDegrees)}
                  aria-invalid={
                    !Number.isInteger(settings.overhangAngleDegrees) ||
                    settings.overhangAngleDegrees < 30 ||
                    settings.overhangAngleDegrees > 70
                  }
                  onChange={(event) => setNumber("overhangAngleDegrees", event.target.value)}
                />
              </LoomSettingsField>
              <LoomSettingsField
                label="First layer height (mm)"
                description="Used to estimate contact with the bed in print checks."
              >
                <Input
                  aria-label="First layer height (mm)"
                  type="number"
                  size="sm"
                  min={0.04}
                  max={1}
                  step={0.01}
                  value={numbers.firstLayerHeightMm ?? String(settings.firstLayerHeightMm)}
                  aria-invalid={
                    !Number.isFinite(settings.firstLayerHeightMm) ||
                    settings.firstLayerHeightMm < 0.04 ||
                    settings.firstLayerHeightMm > 1
                  }
                  onChange={(event) => setNumber("firstLayerHeightMm", event.target.value)}
                />
              </LoomSettingsField>
            </div>
          </LoomSettingsPanel>
          <LoomSettingsDetails title="Printers, surfaces and materials">
            {supportsPrinters ? (
              <PrintersSection environmentId={environmentId} />
            ) : (
              <ManageBeds
                value={settings.buildPlate}
                onChange={(plate) => set("buildPlate", plate)}
                disabled={!canSave || busy !== null}
              />
            )}
            {buildPlateNote(settings.buildPlate, library) && (
              <div className="flex min-w-0 flex-col gap-3">
                <LoomSettingsNotice>
                  {buildPlateNote(settings.buildPlate, library)}
                </LoomSettingsNotice>
              </div>
            )}
          </LoomSettingsDetails>
          <LoomSettingsPanel
            title="Agent model workflow"
            description="Choose how agents use models and where STEP files can open."
          >
            <SettingsRow title="Fabrication app URL" description="Optional link for STEP files.">
              <div className="flex min-w-0 flex-col gap-3 pt-3 pb-2">
                <Input
                  aria-label="Fabrication app URL"
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.fabricationUrl ?? ""}
                  onChange={(event) => set("fabricationUrl", event.target.value || null)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title="Let agents render models and propose variants"
              description="Enable shared tools for model PNG views and parameter proposals in the variant workbench."
              control={
                <Switch
                  aria-label="Let agents render models and propose variants"
                  checked={settings.agentToolEnabled}
                  onCheckedChange={(checked) => set("agentToolEnabled", checked)}
                />
              }
            />
            {supportsAgentModels && (
              <SettingsRow
                title="When an agent writes a model"
                description="Offer models a turn wrote or changed, or open them in the 3D panel."
                control={
                  <Select
                    disabled={!canSave}
                    value={settings.agentModels}
                    onValueChange={(next: AgentModelsMode | null) => {
                      if (next) set("agentModels", next);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full sm:w-48"
                      aria-label="When an agent writes a model"
                    >
                      <SelectValue>
                        {
                          { offer: "Offer to open", open: "Open automatically", off: "Do nothing" }[
                            settings.agentModels
                          ]
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="offer">Offer to open</SelectItem>
                      <SelectItem value="open">Open automatically</SelectItem>
                      <SelectItem value="off">Do nothing</SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            )}
          </LoomSettingsPanel>
          <LoomSettingsDetails title="Model rendering and host setup">
            <div className="flex min-w-0 flex-col gap-3">
              <LoomSettingsNotice>
                These settings apply to the selected environment. OpenSCAD runs on that host.
              </LoomSettingsNotice>
              {status._tag === "Failure" && (
                <LoomSettingsNotice role="alert">
                  {String(Cause.squash(status.cause))}
                </LoomSettingsNotice>
              )}
              {!info && status.waiting && <OperationStatus label="Detecting OpenSCAD" />}
              <p className="break-words text-sm leading-relaxed">
                {info?.openscad.path
                  ? `OpenSCAD ${info.openscad.version ?? "unknown version"} · ${info.openscad.supportsManifold ? "Manifold available" : "CGAL"} · ${info.openscad.supportsSummary ? "Geometry summaries available" : "No geometry summaries"}`
                  : info
                    ? "OpenSCAD was not detected. Mesh previews still work."
                    : "Host detection has not completed. Mesh previews remain available."}{" "}
                <a
                  href="https://openscad.org/downloads.html#snapshots"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Get a development snapshot
                </a>
              </p>
            </div>
            {info?.openscad.path && (
              <p className="text-sm text-muted-foreground wrap-anywhere">{info.openscad.path}</p>
            )}
            <SettingsRow
              title="OpenSCAD executable"
              description="Unset searches PATH and macOS applications."
              control={
                <PathField
                  environmentId={environmentId}
                  kind="file"
                  label="OpenSCAD executable"
                  defaultLabel="Found automatically"
                  value={settings.openscadPath ?? ""}
                  onChange={(next) => set("openscadPath", next || null)}
                  className="w-full @min-[32rem]/settings-row:w-80"
                />
              }
            />
            {features.includes("model-python-cad") && (
              <PythonCadSettings
                environmentId={environmentId}
                info={info?.python}
                pythonPath={settings.pythonPath}
                canSetup={canSetupPython}
                onPathChange={(pythonPath) => set("pythonPath", pythonPath)}
                onSetup={async (action) => {
                  const saved = await runModelCommand(models.updateSettings, {
                    environmentId,
                    input: { ...baseline, pythonPath: settings.pythonPath },
                  });
                  setSavedResult({ source: initial, value: saved });
                  const result = await runModelCommand(models.pythonSetup, {
                    environmentId,
                    input: { action },
                  });
                  appAtomRegistry.refresh(models.status({ environmentId, input: {} }));
                  appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
                  setDetection(null);
                  return result;
                }}
              />
            )}
            <h4 className="text-sm font-semibold">Render performance and limits</h4>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <LoomSettingsField label="Render backend">
                <Select
                  value={settings.backend}
                  onValueChange={(next) => {
                    if (next) set("backend", next);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Render backend">
                    <SelectValue>
                      {BACKENDS.find(({ value }) => value === settings.backend)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {BACKENDS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
              <LoomSettingsField label="Render timeout (seconds)">
                <Input
                  aria-label="Render timeout"
                  type="number"
                  size="sm"
                  min={1}
                  max={600}
                  value={numbers.renderTimeoutSeconds ?? String(settings.renderTimeoutSeconds)}
                  aria-invalid={
                    !Number.isInteger(settings.renderTimeoutSeconds) ||
                    settings.renderTimeoutSeconds < 1 ||
                    settings.renderTimeoutSeconds > 600
                  }
                  onChange={(event) => setNumber("renderTimeoutSeconds", event.target.value)}
                />
              </LoomSettingsField>
              <LoomSettingsField label="Maximum file size (MB)">
                <Input
                  aria-label="Maximum file size"
                  type="number"
                  size="sm"
                  min={1}
                  max={2048}
                  value={numbers.maxFileMegabytes ?? String(settings.maxFileMegabytes)}
                  aria-invalid={
                    !Number.isInteger(settings.maxFileMegabytes) ||
                    settings.maxFileMegabytes < 1 ||
                    settings.maxFileMegabytes > 2048
                  }
                  onChange={(event) => setNumber("maxFileMegabytes", event.target.value)}
                />
              </LoomSettingsField>
            </div>
          </LoomSettingsDetails>
          {features.includes("model-slicer-bridge") && (
            <LoomSettingsDetails title="Slicing applications and profiles">
              <SlicingSettings
                environmentId={environmentId}
                value={settings.slicer}
                onChange={(slicer) => set("slicer", slicer)}
                buildPlate={settings.buildPlate}
                disabled={!canSave || busy !== null}
                {...(info?.slicers ? { status: info.slicers } : {})}
              />
            </LoomSettingsDetails>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            <LoomSettingsNotice>
              {busy === "Saving model settings"
                ? "Saving settings..."
                : dirty
                  ? "You have unsaved model settings."
                  : "Settings are up to date."}
            </LoomSettingsNotice>
            {dirty && (!valid || invalidBedName) && (
              <LoomSettingsNotice role="alert">
                Check the marked fields, printer names, slicer options and app URL before saving.
              </LoomSettingsNotice>
            )}
            <LoomSettingsActions>
              <Button
                disabled={busy !== null || !canSave || invalidBedName || !dirty || !valid}
                title={
                  canSave
                    ? undefined
                    : "This connection requires permission to edit model settings."
                }
                onClick={() => void save()}
              >
                Save settings
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft({});
                    setNumbers({});
                    clearMessage();
                  }}
                >
                  Discard changes
                </Button>
              )}
            </LoomSettingsActions>
            {busy && <OperationStatus label={busy} />}
            {message && (
              <LoomSettingsNotice role={failed ? "alert" : "status"}>{message}</LoomSettingsNotice>
            )}
          </div>
          <LoomSettingsDetails title="Detection and render cache">
            <p className="text-sm text-muted-foreground">
              Refresh host tool detection or remove cached render output. Save changed executable
              paths before refreshing.
            </p>
            <LoomSettingsActions>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void act(async () => {
                    if (settings.openscadPath !== baseline.openscadPath)
                      throw new Error("Save the executable path before refreshing detection.");
                    setDetection(
                      await runModelCommand(models.detect, {
                        environmentId,
                        input: { refresh: true },
                      }),
                    );
                  }, "Detection refreshed.")
                }
              >
                Refresh detection
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null || !canSave}
                onClick={() =>
                  void act(
                    () => runModelCommand(models.clearCache, { environmentId, input: {} }),
                    "Render cache cleared.",
                  )
                }
              >
                Clear render cache
              </Button>
            </LoomSettingsActions>
          </LoomSettingsDetails>
        </LoomSettingsContent>
      </fieldset>
    </DisplayUnitsProvider>
  );
}
function EnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const action = useSettingsAction();
  const result = useAtomValue(models.settings({ environmentId, input: {} }));
  if (result._tag === "Failure")
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="alert">{String(Cause.squash(result.cause))}</LoomSettingsNotice>
        <LoomSettingsActions>
          <Button
            variant="outline"
            onClick={() => appAtomRegistry.refresh(models.settings({ environmentId, input: {} }))}
          >
            Try again
          </Button>
        </LoomSettingsActions>
      </LoomSettingsContent>
    );
  const settings = Option.getOrNull(AsyncResult.value(result));
  return settings ? (
    <SettingsForm environmentId={environmentId} initial={settings} action={action} />
  ) : (
    <LoomSettingsContent className="flex flex-col gap-3">
      <LoomSettingsNotice role="status">Loading 3D model settings...</LoomSettingsNotice>
    </LoomSettingsContent>
  );
}
export function ModelPreviewSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          Select a connected environment to edit 3D model settings.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "model-preview-3d",
    )
  )
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>This environment does not support 3D model preview.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <EnvironmentSettings
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
