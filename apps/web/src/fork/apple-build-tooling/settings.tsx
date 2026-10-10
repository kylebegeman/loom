import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AppleBuildSettingsPatch } from "@t3tools/contracts/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
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
import { Switch } from "~/components/ui/switch";
import { ensureLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { Alert, failureOf, formatBytes, useAction, valueOf } from "./parts";
import { FEATURE, apple, runAppleCommand } from "./state";

const DERIVED_DATA = [
  { value: "loom", label: "Loom folder" },
  { value: "xcode-default", label: "Xcode default" },
] as const;

const KEEP_MIN = 5;
const KEEP_MAX = 200;

function EnvironmentAppleBuild({ environmentId }: { environmentId: EnvironmentId }) {
  const settingsAtom = apple.settings({ environmentId, input: {} });
  const result = useAtomValue(settingsAtom);
  const view = valueOf(result);
  const canEdit = useAtomValue(apple.updateSettings.permissionAtom(environmentId));
  const canClear = useAtomValue(apple.clearHistory.permissionAtom(environmentId));
  const save = useAction();
  const clear = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const failure = failureOf(result);
  if (failure) return <Alert>{failure}</Alert>;
  if (!view) return <p>Loading Apple build settings...</p>;
  const { settings, storage } = view;

  const update = (patch: AppleBuildSettingsPatch) =>
    void save.act(async () => {
      await runAppleCommand(apple.updateSettings, { environmentId, input: patch });
      appAtomRegistry.refresh(settingsAtom);
    });
  const toggle = (
    key: "agentToolsEnabled" | "useXcbeautify" | "openLaunchedSimulatorInDevicePanel",
    title: string,
    description: string,
  ) => (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Switch
          aria-label={title}
          disabled={!canEdit || save.busy}
          checked={settings[key] === true}
          onCheckedChange={(checked) => update({ [key]: checked })}
        />
      }
    />
  );
  const clearHistory = async (includeDerivedData: boolean) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      includeDerivedData
        ? "Delete Loom's derived data and run history for every project on this environment? The next build starts from scratch."
        : "Clear the Apple build run history for every project on this environment? Logs and result bundles are deleted.",
    );
    if (!confirmed) return;
    setNotice(null);
    const done = await clear.act(async () => {
      await runAppleCommand(apple.clearHistory, {
        environmentId,
        input: includeDerivedData ? { includeDerivedData: true } : {},
      });
      appAtomRegistry.refresh(settingsAtom);
    });
    if (done)
      setNotice(includeDerivedData ? "Derived data and history deleted." : "History cleared.");
  };
  const keepValue = keep ?? String(settings.keepRunsPerProject);

  return (
    <div className="flex flex-col gap-3">
      {toggle(
        "agentToolsEnabled",
        "Agent tools",
        "Agents can build, test and run through Loom and get a compact summary. Off, the tools return an error.",
      )}
      {toggle(
        "useXcbeautify",
        "Readable logs",
        "Pipe xcodebuild output through xcbeautify when it is installed.",
      )}
      <SettingsRow
        title="Collect test diagnostics"
        description="Gathering diagnostics after a failed test can add minutes."
        control={
          <Switch
            aria-label="Collect test diagnostics"
            disabled={!canEdit || save.busy}
            checked={settings.collectTestDiagnostics === "on-failure"}
            onCheckedChange={(checked) =>
              update({ collectTestDiagnostics: checked ? "on-failure" : "never" })
            }
          />
        }
      />
      <SettingsRow
        title="Derived data"
        description={`Loom's own folder keeps its builds apart from a running Xcode. ${formatBytes(storage.derivedDataBytes)} in Loom's folder.`}
        control={
          <Select
            value={settings.derivedData}
            disabled={!canEdit || save.busy}
            onValueChange={(value) => {
              if (value) update({ derivedData: value });
            }}
            items={DERIVED_DATA}
          >
            <SelectTrigger size="sm" aria-label="Derived data">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {DERIVED_DATA.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Runs kept per project"
        description={`Older runs, their logs and result bundles are deleted. ${storage.runCount} runs use ${formatBytes(storage.runsBytes)}.`}
        control={
          <Input
            aria-label="Runs kept per project"
            type="number"
            size="sm"
            className="w-full sm:w-24"
            min={KEEP_MIN}
            max={KEEP_MAX}
            disabled={!canEdit || save.busy}
            value={keepValue}
            onChange={(event) => setKeep(event.target.value)}
            onBlur={() => {
              const next = Math.round(Number(keepValue));
              setKeep(null);
              if (
                Number.isFinite(next) &&
                next >= KEEP_MIN &&
                next <= KEEP_MAX &&
                next !== settings.keepRunsPerProject
              )
                update({ keepRunsPerProject: next });
            }}
          />
        }
      />
      {toggle(
        "openLaunchedSimulatorInDevicePanel",
        "Show launched simulators in the Device panel",
        "After Build and run on a simulator, open it in the thread's Device panel.",
      )}
      {save.error && (
        <div className="px-3 sm:px-4">
          <Alert>{save.error}</Alert>
        </div>
      )}
      <SettingsRow
        title="Run history"
        description="Clearing is refused while a run is going."
        control={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canClear || clear.busy}
              onClick={() => void clearHistory(false)}
            >
              Clear history
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={!canClear || clear.busy}
              onClick={() => void clearHistory(true)}
            >
              Delete derived data
            </Button>
          </div>
        }
      />
      {(clear.error || notice) && (
        <div className="flex flex-col gap-2 px-3 pb-3 sm:px-4">
          {clear.error && <Alert>{clear.error}</Alert>}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AppleBuildToolingSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment) return <p>Select a connected environment to manage Apple builds.</p>;
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return <p>This environment's server does not have Apple build tooling.</p>;
  return (
    <EnvironmentAppleBuild
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
