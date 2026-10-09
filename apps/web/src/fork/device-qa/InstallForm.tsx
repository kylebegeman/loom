import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { DeviceQaEvidence } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Input } from "~/components/ui/input";
import type { DeviceQaOption } from "./devices";
import { Alert, Done, Muted, useAction } from "./parts";
import { deviceQa, runCommand } from "./state";

/** Installs a built `.app` on an iOS simulator or an `.apk` on an Android emulator. */
export function InstallForm({
  threadRef,
  device,
}: {
  threadRef: ScopedThreadRef;
  device: DeviceQaOption | null;
}) {
  const [artifactPath, setArtifactPath] = useState("");
  const [launch, setLaunch] = useState(true);
  const [installed, setInstalled] = useState<DeviceQaEvidence | null>(null);
  const install = useAction();
  const kind = device?.target.platform === "android" ? ".apk file" : ".app folder";
  const canInstall = device?.local === true && artifactPath.trim() !== "" && !install.busy;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!device || !canInstall) return;
        setInstalled(null);
        void install.act(async () => {
          setInstalled(
            await runCommand(deviceQa.installApp, {
              environmentId: threadRef.environmentId,
              input: {
                threadId: threadRef.threadId,
                target: device.target,
                artifactPath: artifactPath.trim(),
                launch,
              },
            }),
          );
        });
      }}
    >
      {device?.local !== true && (
        <Muted>Installs need a booted simulator or emulator on this environment.</Muted>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-xs">
          {device?.target.platform === "android" ? "APK file" : "App bundle"}
        </span>
        <Input
          placeholder={
            device?.target.platform === "android"
              ? "app/build/outputs/apk/debug/app-debug.apk"
              : "build/Build/Products/Debug-iphonesimulator/App.app"
          }
          value={artifactPath}
          onChange={(event) => setArtifactPath(event.target.value)}
        />
        <span className="text-muted-foreground text-xs">
          The {kind}, relative to the workspace or absolute on the environment host.
        </span>
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <span className="font-medium text-sm">Launch after installing</span>
        <Switch checked={launch} onCheckedChange={(checked) => setLaunch(checked === true)} />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" type="submit" disabled={!canInstall}>
          {install.busy ? <Spinner /> : <DownloadIcon />}
          {install.busy ? "Installing..." : device ? `Install on ${device.name}` : "Install"}
        </Button>
      </div>
      {install.error && <Alert>{install.error}</Alert>}
      {installed && (
        <Done>
          Installed {installed.detail ?? "the app"} on {installed.deviceName}
          {launch ? " and launched it" : ""}.
        </Done>
      )}
    </form>
  );
}
