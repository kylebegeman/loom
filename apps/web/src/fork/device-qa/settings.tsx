import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { DeviceQaSettingsPatch } from "@t3tools/contracts/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsDetails,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PathField } from "~/fork/settings/PathField";
import { Switch } from "~/components/ui/switch";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { failureOf, useAction, valueOf } from "./parts";
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
  onSave: (next: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const next = Number(shown);
  const invalid =
    shown.trim() === "" || !Number.isInteger(next) || next < range.min || next > range.max;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-40">
      <Input
        aria-label={label}
        type="number"
        size="sm"
        min={range.min}
        max={range.max}
        disabled={disabled}
        value={shown}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (invalid) return;
          if (next === value) setDraft(null);
          else
            void onSave(next).then((saved) => {
              if (saved) setDraft(null);
            });
        }}
      />
      {!invalid && draft !== null && shown !== String(value) && (
        <p className="text-xs text-muted-foreground">Saves when you leave this field.</p>
      )}
      {invalid && (
        <p role="alert" className="text-sm text-destructive-foreground">
          Enter a whole number from {range.min} to {range.max}.
        </p>
      )}
    </div>
  );
}

function EnvironmentDeviceQa({ environmentId }: { environmentId: EnvironmentId }) {
  const settingsAtom = deviceQa.settings({ environmentId, input: {} });
  const result = useAtomValue(settingsAtom);
  const settings = valueOf(result);
  const canEdit = useAtomValue(deviceQa.updateSettings.permissionAtom(environmentId));
  const save = useAction();
  const failure = failureOf(result);
  if (failure)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="alert">{failure}</LoomSettingsNotice>
        <LoomSettingsActions>
          <Button variant="outline" onClick={() => appAtomRegistry.refresh(settingsAtom)}>
            Try again
          </Button>
        </LoomSettingsActions>
      </LoomSettingsContent>
    );
  if (!settings)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="status">Loading Device QA settings...</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  const disabled = !canEdit || save.busy;

  const update = (patch: DeviceQaSettingsPatch) =>
    save.act(async () => {
      await runCommand(deviceQa.updateSettings, { environmentId, input: patch });
      appAtomRegistry.refresh(settingsAtom);
    });

  return (
    <LoomSettingsContent className="flex flex-col gap-5">
      <LoomSettingsPanel
        title="Capture defaults"
        description="Prepare consistent evidence when testing on a device."
      >
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
      </LoomSettingsPanel>
      <LoomSettingsPanel
        title="Evidence retention"
        description="Control how much test history and captured evidence this environment keeps."
      >
        <SettingsRow
          title="Runs kept per project"
          description="Keep 5 to 200 runs per project. Older flow runs and their snapshot images are deleted."
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
            title="Evidence age limit"
            description="Keep evidence for 1 to 365 days. Checked when the server starts and every six hours."
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
      </LoomSettingsPanel>
      <LoomSettingsDetails title="Device automation executable">
        <SettingsRow
          title="argent executable"
          description="Unset finds argent on PATH and in npm's global folder."
          control={
            <PathField
              environmentId={environmentId}
              kind="file"
              label="argent executable"
              defaultLabel="Found automatically"
              value={settings.argentPath ?? ""}
              disabled={disabled}
              onChange={(next) => void update({ argentPath: next === "" ? null : next })}
              className="w-full @min-[32rem]/settings-row:w-80"
            />
          }
        />
      </LoomSettingsDetails>
      {save.error && <LoomSettingsNotice role="alert">{save.error}</LoomSettingsNotice>}
    </LoomSettingsContent>
  );
}

export function DeviceQaSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>Select a connected environment to manage Device QA.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>This environment's server does not have Device QA.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <EnvironmentDeviceQa
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
