import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ModelPreviewSettings,
  activeBed,
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
import { DisplayUnitsProvider, formatLengths } from "./units";
import { ManageBeds } from "./ManageBeds";
import { PrintersSection } from "./PrintersSection";
import { usePrinterLibrary } from "./printers";
import { PythonCadSettings } from "./PythonCadSettings";
import { SlicingSettings } from "./SlicingSettings";

const validateSettings = Schema.decodeSync(ModelPreviewSettings);
const BACKENDS = [
  { value: "auto", label: "Automatic" },
  { value: "manifold", label: "Manifold" },
  { value: "cgal", label: "CGAL" },
] as const satisfies readonly { value: ModelPreviewSettings["backend"]; label: string }[];
function SettingsForm({
  environmentId,
  initial,
}: {
  environmentId: EnvironmentId;
  initial: ModelPreviewSettings;
}) {
  const [settings, setSettings] = useState(initial),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [failed, setFailed] = useState(false),
    [detection, setDetection] = useState<ModelPreviewStatus | null>(null);
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
  const set = <K extends keyof ModelPreviewSettings>(key: K, value: ModelPreviewSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
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
    } finally {
      setBusy(null);
    }
  };
  const invalidBedName =
    !supportsPrinters &&
    settings.buildPlate.customBeds.some((bed) =>
      customBedNameError(settings.buildPlate, bed.name, bed.id),
    );
  const save = () =>
    act(async () => {
      const validated = validateSettings(settings);
      await runModelCommand(models.updateSettings, { environmentId, input: validated });
      appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
      appAtomRegistry.refresh(models.status({ environmentId, input: {} }));
    }, "Settings saved.");
  return (
    <DisplayUnitsProvider
      value={{
        units: settings.displayUnits,
        setUnits: (units) => set("displayUnits", units),
        canSave,
      }}
    >
      <fieldset disabled={!canSave || busy !== null} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-3 px-3 pt-3 sm:px-4">
          <p className="text-sm text-muted-foreground">
            These settings apply to the selected environment. OpenSCAD runs on that host.
          </p>
          {!info && status.waiting && <OperationStatus label="Detecting OpenSCAD" />}
          <p className="text-sm">
            {info?.openscad.path
              ? `OpenSCAD ${info.openscad.version ?? "unknown version"} · ${info.openscad.supportsManifold ? "Manifold available" : "CGAL"} · ${info.openscad.supportsSummary ? "Geometry summaries available" : "No geometry summaries"}`
              : "OpenSCAD was not detected. Mesh previews still work."}{" "}
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
        <SettingsRow
          title="OpenSCAD executable"
          description="Leave blank to search PATH and macOS applications."
        >
          <div className="flex flex-col gap-2 pb-2">
            <Input
              aria-label="OpenSCAD executable"
              value={settings.openscadPath ?? ""}
              onChange={(event) => set("openscadPath", event.target.value || null)}
            />
          </div>
        </SettingsRow>
        {features.includes("model-python-cad") && (
          <PythonCadSettings
            info={info?.python}
            pythonPath={settings.pythonPath}
            canSetup={canSetupPython}
            onPathChange={(pythonPath) => set("pythonPath", pythonPath)}
            onSetup={async (action) => {
              await runModelCommand(models.updateSettings, {
                environmentId,
                input: { ...initial, pythonPath: settings.pythonPath },
              });
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
        {features.includes("model-slicer-bridge") && (
          <SlicingSettings
            environmentId={environmentId}
            value={settings.slicer}
            onChange={(slicer) => set("slicer", slicer)}
            buildPlate={settings.buildPlate}
            disabled={!canSave || busy !== null}
            {...(info?.slicers ? { status: info.slicers } : {})}
          />
        )}
        <SettingsRow
          title="Render backend"
          control={
            <Select
              value={settings.backend}
              onValueChange={(next) => {
                if (next) set("backend", next);
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Render backend">
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
          }
        />
        <SettingsRow
          title="Render timeout (seconds)"
          control={
            <Input
              aria-label="Render timeout"
              type="number"
              size="sm"
              className="w-full sm:w-24"
              min={1}
              max={600}
              value={settings.renderTimeoutSeconds}
              onChange={(event) => set("renderTimeoutSeconds", Number(event.target.value))}
            />
          }
        />
        <SettingsRow
          title="Render colors"
          description="Export SCAD as 3MF to preserve model colors."
          control={
            <input
              aria-label="Render colors"
              type="checkbox"
              checked={settings.renderColors}
              onChange={(event) => set("renderColors", event.target.checked)}
            />
          }
        />
        <SettingsRow
          title="Nozzle diameter (mm)"
          description="Used for print checks unless the selected printer provides its nozzle diameter."
          control={
            <Input
              aria-label="Nozzle diameter (mm)"
              type="number"
              size="sm"
              className="w-full sm:w-24"
              min={0.1}
              max={2}
              step={0.05}
              value={settings.nozzleDiameterMm}
              onChange={(event) => set("nozzleDiameterMm", Number(event.target.value))}
            />
          }
        />
        <SettingsRow
          title="Overhang limit (degrees)"
          description="Faces beyond this angle from vertical are flagged by print checks and overhang shading."
          control={
            <Input
              aria-label="Overhang limit (degrees)"
              type="number"
              size="sm"
              className="w-full sm:w-24"
              min={30}
              max={70}
              step={1}
              value={settings.overhangAngleDegrees}
              onChange={(event) => set("overhangAngleDegrees", Number(event.target.value))}
            />
          }
        />
        <SettingsRow
          title="First layer height (mm)"
          description="Used to estimate contact with the bed in print checks."
          control={
            <Input
              aria-label="First layer height (mm)"
              type="number"
              size="sm"
              className="w-full sm:w-24"
              min={0.04}
              max={1}
              step={0.01}
              value={settings.firstLayerHeightMm}
              onChange={(event) => set("firstLayerHeightMm", Number(event.target.value))}
            />
          }
        />
        <SettingsRow
          title="Maximum file size (MB)"
          control={
            <Input
              aria-label="Maximum file size"
              type="number"
              size="sm"
              className="w-full sm:w-24"
              min={1}
              max={2048}
              value={settings.maxFileMegabytes}
              onChange={(event) => set("maxFileMegabytes", Number(event.target.value))}
            />
          }
        />
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
                        <span className="flex w-full items-center gap-4">
                          <span className="flex-1">{option.label}</span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {formatLengths(option.volumeMm, settings.displayUnits, { trim: true })}
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
          <p className="px-3 text-xs text-muted-foreground sm:px-4">
            {buildPlateNote(settings.buildPlate, library)}
          </p>
        )}
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
                    BUILD_PLATE_PATTERNS.find(({ value }) => value === settings.buildPlate.pattern)
                      ?.name
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
        <SettingsRow title="Fabrication app URL" description="Optional link for STEP files.">
          <div className="flex flex-col gap-2 pb-2">
            <Input
              aria-label="Fabrication app URL"
              type="url"
              value={settings.fabricationUrl ?? ""}
              onChange={(event) => set("fabricationUrl", event.target.value || null)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Let agents render models and propose variants"
          description="Enable shared tools for model PNG views and parameter proposals in the variant workbench."
          control={
            <input
              aria-label="Let agents render models and propose variants"
              type="checkbox"
              checked={settings.agentToolEnabled}
              onChange={(event) => set("agentToolEnabled", event.target.checked)}
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
        <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || !canSave || invalidBedName}
              title={
                canSave ? undefined : "This connection requires permission to edit model settings."
              }
              onClick={() => void save()}
            >
              Save settings
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void act(async () => {
                  if (settings.openscadPath !== initial.openscadPath)
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
          </div>
          {busy && <OperationStatus label={busy} />}
          {message && (
            <p role={failed ? "alert" : "status"} className="text-sm">
              {message}
            </p>
          )}
        </div>
      </fieldset>
    </DisplayUnitsProvider>
  );
}
function EnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(models.settings({ environmentId, input: {} }));
  if (result._tag === "Failure") return <p role="alert">{String(Cause.squash(result.cause))}</p>;
  const settings = Option.getOrNull(AsyncResult.value(result));
  return settings ? (
    <SettingsForm key={JSON.stringify(settings)} environmentId={environmentId} initial={settings} />
  ) : (
    <p>Loading 3D model settings...</p>
  );
}
export function ModelPreviewSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  if (!environment) return <p>Select a connected environment to edit 3D model settings.</p>;
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "model-preview-3d",
    )
  )
    return <p>This environment does not support 3D model preview.</p>;
  return (
    <EnvironmentSettings
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
