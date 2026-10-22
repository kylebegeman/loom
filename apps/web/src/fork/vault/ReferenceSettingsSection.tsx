import { useState } from "react";
import { AuthAccessReadScope, EnvironmentId } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { LoomSettingsField, LoomSettingsNotice, LoomSettingsPanel } from "~/fork/settings/parts";
import { VaultReferencePicker } from "./ReferencePicker";

export function VaultReferenceSettingsSection() {
  const { environment } = useSettingsScope();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const target = selected ?? environment?.environmentId ?? null;
  const source = environments.find((e) => e.environmentId === target);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Find development records and copy stable references. References contain no credential values
        and grant no access. Each computer checks its own inspection permission.
      </p>
      <LoomSettingsPanel
        title="Find a reference"
        description="Choose the computer whose Vault you want to search."
      >
        <LoomSettingsField label="Search on computer">
          <Select
            value={target ?? ""}
            onValueChange={(value) => setSelected(value ? EnvironmentId.make(value) : null)}
          >
            <SelectTrigger aria-label="Search on computer">
              <SelectValue>
                {source?.label ??
                  (target ? `Unavailable computer (${target})` : "Choose a computer")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {!target ? <SelectItem value="">Choose a computer</SelectItem> : null}
              {target && !source ? (
                <SelectItem value={target}>Unavailable computer ({target})</SelectItem>
              ) : null}
              {environments.map((e) => (
                <SelectItem key={e.environmentId} value={e.environmentId}>
                  {e.label} ({e.environmentId})
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
        {source ? (
          <p className="wrap-anywhere text-xs text-muted-foreground">
            Computer ID: {source.environmentId}
          </p>
        ) : null}
      </LoomSettingsPanel>
      {!source || !target ? (
        <LoomSettingsNotice role="status">
          The selected computer is unavailable. Choose a connected computer.
        </LoomSettingsNotice>
      ) : (
        <ReferenceSearchTarget
          key={target}
          environmentId={target}
          connected={source.connection.phase === "connected"}
        />
      )}
    </div>
  );
}
function ReferenceSearchTarget({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const configs = useServerConfigs();
  if (!connected)
    return (
      <LoomSettingsNotice role="status">
        Connect the selected computer to search its Vault.
      </LoomSettingsNotice>
    );
  if (
    !supportsLoomFeature(configs.get(environmentId)?.environment.capabilities, "vault-references")
  )
    return (
      <LoomSettingsNotice>
        Reference search needs a server with Vault reference support.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>
        Your connection to this computer does not include Vault inspection.
      </LoomSettingsNotice>
    );
  return <VaultReferencePicker environmentId={environmentId} />;
}
