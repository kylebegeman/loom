import { FabSettings } from "./FabSettings";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { PcbToolStatus } from "@t3tools/contracts/fork";
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
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { pcb } from "./state";
import { useLengthUnit, usePcbPreferences } from "./preferences";
import { asyncError, asyncValue } from "./usePcbPreview";
import { electronicsDesignUrl } from "./summary";
import { OperationStatus } from "./OperationStatus";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsNotice,
} from "~/fork/settings/parts";
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
        <span className="break-words">
          {status?.problem === "tool-too-old"
            ? "KiCad 9 or newer is required."
            : status?.problem === "version-failed"
              ? "The executable could not report its version."
              : status?.found
                ? `${status.version ?? "Detected"}${status.path ? ` · ${status.path}` : ""}`
                : "Not detected on the environment host."}
        </span>
      }
      control={
        <a
          className="text-sm underline underline-offset-4"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Install instructions
        </a>
      }
    />
  );
}
function EnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const target = { environmentId, input: {} };
  const result = useAtomValue(pcb.status(target)),
    info = asyncValue(result);
  const saved = usePcbPreferences((s) => s.electronicsUrl),
    save = usePcbPreferences((s) => s.setElectronicsUrl);
  const mode = usePcbPreferences((s) => s.agentDesigns),
    setMode = usePcbPreferences((s) => s.setAgentDesigns);
  const unit = useLengthUnit();
  const setUnit = usePcbPreferences((s) => s.setLengthUnit);
  const [url, setUrl] = useState(saved),
    [message, setMessage] = useState<string | null>(null);
  const valid = !url.trim() || electronicsDesignUrl(url, "/design.kicad_pro") !== null;
  return (
    <div className="flex min-w-0 flex-col">
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          Tools run on this environment's host. Loom searches PATH, standard macOS KiCad
          installations, and each project's node_modules/.bin/tsci. tscircuit also needs Bun.
        </LoomSettingsNotice>
        {(result.waiting || result._tag === "Initial") && (
          <OperationStatus label="Detecting PCB tools" />
        )}
        {asyncError(result) && (
          <LoomSettingsNotice role="alert">{asyncError(result)}</LoomSettingsNotice>
        )}
      </LoomSettingsContent>
      <FabSettings environmentId={environmentId} />
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
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          A project-local tscircuit installation is detected when you open that project's preview.
          Detection refreshes at most once per minute.
        </LoomSettingsNotice>
        <LoomSettingsActions>
          <Button
            variant="outline"
            size="sm"
            disabled={result.waiting}
            onClick={() => appAtomRegistry.refresh(pcb.status(target))}
          >
            Check tools again
          </Button>
        </LoomSettingsActions>
      </LoomSettingsContent>
      <SettingsRow
        title="When an agent changes a design"
        description="Offer changed designs or open them in the PCB panel. Saved on this device."
        control={
          <Select<"offer" | "open" | "off">
            value={mode}
            onValueChange={(value) => value && setMode(value)}
            items={[
              { value: "offer", label: "Offer to open" },
              { value: "open", label: "Open automatically" },
              { value: "off", label: "Do nothing" },
            ]}
          >
            <SelectTrigger size="sm" aria-label="When an agent changes a design">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="offer">Offer to open</SelectItem>
              <SelectItem value="open">Open automatically</SelectItem>
              <SelectItem value="off">Do nothing</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Electronics app URL"
        description="Optional deep link for opening designs. Saved on this device."
      >
        <div className="flex min-w-0 flex-col gap-3 pt-3 pb-2">
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
          {!valid && (
            <LoomSettingsNotice role="alert">
              Enter an HTTP or HTTPS URL without embedded credentials.
            </LoomSettingsNotice>
          )}
          <LoomSettingsActions>
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
          </LoomSettingsActions>
          {message && <LoomSettingsNotice role="status">{message}</LoomSettingsNotice>}
        </div>
      </SettingsRow>
      <SettingsRow
        title="Length units"
        description="Drawing coordinates, marks and board sizes. Saved on this device. Agents always use millimetres."
        control={
          <Select
            value={unit}
            onValueChange={(value) => value && setUnit(value)}
            items={[
              { value: "mm", label: "Millimetres (mm)" },
              { value: "mil", label: "Mils (mil)" },
              { value: "in", label: "Inches (in)" },
            ]}
          >
            <SelectTrigger aria-label="PCB length units">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="mm">Millimetres (mm)</SelectItem>
              <SelectItem value="mil">Mils (mil)</SelectItem>
              <SelectItem value="in">Inches (in)</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </div>
  );
}
export function PcbPreviewSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>Select a connected environment to check PCB tools.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    )
  )
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>Needs a Loom server with PCB preview.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <EnvironmentSettings
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
