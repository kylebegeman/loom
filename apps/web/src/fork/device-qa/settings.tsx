import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { DeviceQaSettingsPatch } from "@t3tools/contracts/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { Alert, failureOf, useAction, valueOf } from "./parts";
import { FEATURE, deviceQa, runCommand } from "./state";

const KEEP = { min: 5, max: 200 };
const EXPIRE = { min: 1, max: 365, default: 30 };

/** A number field that saves on blur when the value is a whole number in range and changed. */
function NumberSetting({
  label,
  value,
  range,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  disabled: boolean;
  onSave: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  return (
    <Input
      aria-label={label}
      type="number"
      size="sm"
      className="w-full sm:w-24"
      min={range.min}
      max={range.max}
      disabled={disabled}
      value={shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Math.round(Number(shown));
        setDraft(null);
        if (Number.isFinite(next) && next >= range.min && next <= range.max && next !== value)
          onSave(next);
      }}
    />
  );
}

function EnvironmentDeviceQa({ environmentId }: { environmentId: EnvironmentId }) {
  const settingsAtom = deviceQa.settings({ environmentId, input: {} });
  const result = useAtomValue(settingsAtom);
  const settings = valueOf(result);
  const canEdit = useAtomValue(deviceQa.updateSettings.permissionAtom(environmentId));
  const save = useAction();
  const [argentPath, setArgentPath] = useState<string | null>(null);
  const failure = failureOf(result);
  if (failure) return <Alert>{failure}</Alert>;
  if (!settings) return <p>Loading Device QA settings...</p>;
  const disabled = !canEdit || save.busy;

  const update = (patch: DeviceQaSettingsPatch) =>
    void save.act(async () => {
      await runCommand(deviceQa.updateSettings, { environmentId, input: patch });
      appAtomRegistry.refresh(settingsAtom);
    });
  const pathValue = argentPath ?? settings.argentPath ?? "";

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        title="argent path"
        description="Leave empty to find argent on PATH and in npm's global folder."
      >
        <div className="flex flex-col gap-2 pb-2">
          <Input
            aria-label="argent path"
            placeholder="argent"
            disabled={disabled}
            value={pathValue}
            onChange={(event) => setArgentPath(event.target.value)}
            onBlur={() => {
              const next = pathValue.trim() === "" ? null : pathValue.trim();
              setArgentPath(null);
              if (next !== settings.argentPath) update({ argentPath: next });
            }}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Runs kept per project"
        description="Older flow runs and their snapshot images are deleted."
        control={
          <NumberSetting
            label="Runs kept per project"
            value={settings.keepRunsPerProject}
            range={KEEP}
            disabled={disabled}
            onSave={(next) => update({ keepRunsPerProject: next })}
          />
        }
      />
      <SettingsRow
        title="Delete old evidence"
        description="Off keeps screenshots and recordings until their thread is deleted."
        control={
          <Switch
            aria-label="Delete old evidence"
            disabled={disabled}
            checked={settings.evidenceExpireDays !== null}
            onCheckedChange={(checked) =>
              update({ evidenceExpireDays: checked ? EXPIRE.default : null })
            }
          />
        }
      />
      {settings.evidenceExpireDays !== null && (
        <SettingsRow
          title="Delete evidence older than (days)"
          description="Checked when the server starts and every six hours."
          control={
            <NumberSetting
              label="Delete evidence older than (days)"
              value={settings.evidenceExpireDays}
              range={EXPIRE}
              disabled={disabled}
              onSave={(next) => update({ evidenceExpireDays: next })}
            />
          }
        />
      )}
      <SettingsRow
        title="Clean status bar"
        description="iOS simulator captures show 9:41, full battery and full signal by default."
        control={
          <Switch
            aria-label="Clean status bar"
            disabled={disabled}
            checked={settings.defaultCleanStatusBar}
            onCheckedChange={(checked) => update({ defaultCleanStatusBar: checked })}
          />
        }
      />
      {save.error && (
        <div className="px-3 pb-3 sm:px-4">
          <Alert>{save.error}</Alert>
        </div>
      )}
    </div>
  );
}

export function DeviceQaSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment) return <p>Select a connected environment to manage Device QA.</p>;
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return <p>This environment's server does not have Device QA.</p>;
  return (
    <EnvironmentDeviceQa
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
