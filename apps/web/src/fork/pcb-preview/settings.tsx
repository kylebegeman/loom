import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { PcbToolStatus } from "@t3tools/contracts/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { pcb } from "./state";
import { usePcbPreferences } from "./preferences";
import { asyncError, asyncValue } from "./usePcbPreview";
import { electronicsDesignUrl } from "./summary";
import { OperationStatus } from "./OperationStatus";
function Tool({
  name,
  status,
  url,
}: {
  name: string;
  status: PcbToolStatus | undefined;
  url: string;
}) {
  return (
    <SettingsRow
      title={name}
      description={
        status?.problem === "tool-too-old"
          ? "KiCad 9 or newer is required."
          : status?.problem === "version-failed"
            ? "The executable could not report its version."
            : status?.found
              ? `${status.version ?? "Detected"}${status.path ? ` · ${status.path}` : ""}`
              : "Not detected on the environment host."
      }
    >
      <a className="text-sm underline" href={url} target="_blank" rel="noreferrer">
        Install instructions
      </a>
    </SettingsRow>
  );
}
function EnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const target = { environmentId, input: {} };
  const result = useAtomValue(pcb.status(target)),
    info = asyncValue(result);
  const saved = usePcbPreferences((s) => s.electronicsUrl),
    save = usePcbPreferences((s) => s.setElectronicsUrl);
  const [url, setUrl] = useState(saved),
    [message, setMessage] = useState<string | null>(null);
  const valid = !url.trim() || electronicsDesignUrl(url, "/design.kicad_pro") !== null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Tools run on this environment's host. Loom searches PATH, standard macOS KiCad
        installations, and each project's node_modules/.bin/tsci. tscircuit also needs Bun.
      </p>
      {(result.waiting || result._tag === "Initial") && (
        <OperationStatus label="Detecting PCB tools" />
      )}
      {asyncError(result) && <p role="alert">{asyncError(result)}</p>}
      <Tool name="KiCad CLI" status={info?.kicad} url="https://www.kicad.org/download/" />
      <Tool
        name="tscircuit CLI"
        status={info?.tscircuit}
        url="https://docs.tscircuit.com/intro/installation"
      />
      <Tool
        name="ngspice"
        status={info?.ngspice}
        url="https://ngspice.sourceforge.io/download.html"
      />
      <p className="text-xs text-muted-foreground">
        A project-local tscircuit installation is detected when you open that project's preview.
        Detection refreshes at most once per minute.
      </p>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={result.waiting}
          onClick={() => appAtomRegistry.refresh(pcb.status(target))}
        >
          Check tools again
        </Button>
      </div>
      <SettingsRow
        title="Electronics app URL"
        description="Optional deep link for opening designs. Saved on this device."
      >
        <Input
          aria-label="Electronics app URL"
          type="url"
          placeholder="https://electronics.example.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setMessage(null);
          }}
        />
      </SettingsRow>
      {!valid && (
        <p role="alert" className="text-sm">
          Enter an HTTP or HTTPS URL without embedded credentials.
        </p>
      )}
      <div>
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => {
            save(url.trim());
            setMessage(url.trim() ? "Electronics link saved." : "Electronics link removed.");
          }}
        >
          Save link
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
export function PcbPreviewSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  if (!environment) return <p>Select a connected environment to check PCB tools.</p>;
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    )
  )
    return <p>Needs a Loom server with PCB preview.</p>;
  return (
    <EnvironmentSettings
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
