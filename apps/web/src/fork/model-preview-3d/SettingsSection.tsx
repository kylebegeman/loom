import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  BUILD_PLATE_PRESETS,
  ModelPreviewSettings,
  type BuildPlatePresetId,
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
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { OperationStatus } from "./OperationStatus";
import { buildPlateOptions } from "./buildPlate";
import { models, runModelCommand } from "./state";

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
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const status = useAtomValue(models.status({ environmentId, input: {} }));
  const info = detection ?? Option.getOrNull(AsyncResult.value(status));
  const printers = buildPlateOptions(settings.buildPlate.customMm);
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
  const save = () =>
    act(async () => {
      const validated = validateSettings(settings);
      await runModelCommand(models.updateSettings, { environmentId, input: validated });
      appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
      appAtomRegistry.refresh(models.status({ environmentId, input: {} }));
    }, "Settings saved.");
  return (
    <div className="flex flex-col gap-3">
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
        title="Build plate"
        control={
          <Select
            value={settings.buildPlate.preset}
            onValueChange={(next: BuildPlatePresetId | null) => {
              if (next) set("buildPlate", { ...settings.buildPlate, preset: next });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Build plate">
              <SelectValue>
                {printers.find(({ id }) => id === settings.buildPlate.preset)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {printers.map((printer) => (
                <SelectItem key={printer.id} value={printer.id}>
                  <span className="flex w-full items-center gap-4">
                    <span className="flex-1">{printer.label}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {printer.volumeMm.join(" × ")} mm
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {settings.buildPlate.preset === "custom" ? (
        <div className="flex gap-2 px-3 sm:px-4">
          {(["X", "Y", "Z"] as const).map((axis, index) => (
            <label key={axis}>
              {axis} mm
              <Input
                aria-label={`Custom build volume ${axis}`}
                type="number"
                min={10}
                max={2000}
                value={settings.buildPlate.customMm[index]}
                onChange={(event) => {
                  const customMm: [number, number, number] = [...settings.buildPlate.customMm];
                  customMm[index] = Number(event.target.value);
                  set("buildPlate", { ...settings.buildPlate, customMm });
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        BUILD_PLATE_PRESETS[settings.buildPlate.preset].note && (
          <p className="px-3 text-xs text-muted-foreground sm:px-4">
            {BUILD_PLATE_PRESETS[settings.buildPlate.preset].note}
          </p>
        )
      )}
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
      <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy !== null || !canSave}
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
                  await runModelCommand(models.detect, { environmentId, input: { refresh: true } }),
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
    </div>
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
