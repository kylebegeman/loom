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
  const [saved, setSaved] = useState(false);
  const [argentPath, setArgentPath] = useState<string | null>(null);
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

  const update = async (patch: DeviceQaSettingsPatch) => {
    setSaved(false);
    const done = await save.act(async () => {
      await runCommand(deviceQa.updateSettings, { environmentId, input: patch });
      appAtomRegistry.refresh(settingsAtom);
    });
    setSaved(done);
    return done;
  };
  const pathValue = argentPath ?? settings.argentPath ?? "";

  return (
    <LoomSettingsContent className="flex flex-col gap-5">
      <LoomSettingsPanel
        title="Capture defaults"
        description="Prepare consistent evidence when testing on a device."
      >
        <SettingsRow
          className="px-0 sm:px-0"
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
          className="px-0 sm:px-0"
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
          className="px-0 sm:px-0"
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
            className="px-0 sm:px-0"
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
          className="px-0 sm:px-0"
          title="argent executable"
          description="Leave empty to find argent on PATH and in npm's global folder."
        >
          <div className="flex min-w-0 flex-col gap-3 pt-3 pb-2">
            <Input
              aria-label="argent path"
              placeholder="argent"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              value={pathValue}
              onChange={(event) => {
                setArgentPath(event.target.value);
                setSaved(false);
              }}
              onBlur={() => {
                const next = pathValue.trim() === "" ? null : pathValue.trim();
                if (next === settings.argentPath) setArgentPath(null);
                else
                  void update({ argentPath: next }).then((done) => {
                    if (done) setArgentPath(null);
                  });
              }}
            />
          </div>
        </SettingsRow>
      </LoomSettingsDetails>
      <LoomSettingsNotice role="status">
        {save.busy
          ? "Saving changes..."
          : saved
            ? "Changes saved."
            : "Changes save automatically. Text and numbers save when you leave the field."}
      </LoomSettingsNotice>
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
