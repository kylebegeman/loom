import { useId, useState } from "react";
import { AuthAccessReadScope, EnvironmentId } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { VaultReferencePicker } from "./ReferencePicker";

export function VaultReferenceSettingsSection() {
  const { environment } = useSettingsScope();
  const { environments } = useEnvironments();
  const field = useId();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const target = selected ?? environment?.environmentId ?? null;
  const source = environments.find((e) => e.environmentId === target);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Find development records and copy stable references. Each computer checks its own inspection
        permission. References contain no credential values and grant no access.
      </p>
      <label htmlFor={field} className="flex flex-col gap-1 text-sm">
        Search on computer
        <select
          id={field}
          value={target ?? ""}
          onChange={(event) =>
            setSelected(event.target.value ? EnvironmentId.make(event.target.value) : null)
          }
        >
          {!target ? <option value="">Choose a computer</option> : null}
          {target && !source ? (
            <option value={target}>Unavailable computer ({target})</option>
          ) : null}
          {environments.map((e) => (
            <option key={e.environmentId} value={e.environmentId}>
              {e.label} ({e.environmentId})
            </option>
          ))}
        </select>
      </label>
      {!source || !target ? (
        <p role="status" className="text-sm">
          The selected computer is unavailable. Choose a connected computer.
        </p>
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
      <p role="status" className="text-sm">
        Connect the selected computer to search its Vault.
      </p>
    );
  if (
    !supportsLoomFeature(configs.get(environmentId)?.environment.capabilities, "vault-references")
  )
    return <p className="text-sm">Reference search needs a server with Vault reference support.</p>;
  if (!canRead)
    return (
      <p className="text-sm">Your connection to this computer does not include Vault inspection.</p>
    );
  return <VaultReferencePicker environmentId={environmentId} />;
}
