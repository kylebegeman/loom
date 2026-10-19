import { AuthAccessReadScope } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { VaultReferencePicker } from "./ReferencePicker";
export function VaultReferenceSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-references",
    )
  )
    return <p className="text-sm">Reference search needs a server with Vault reference support.</p>;
  if (!canRead)
    return <p className="text-sm">Your connection does not include Vault inspection.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Find development records and copy stable references. A reference contains no credential
        value and grants no access.
      </p>
      <VaultReferencePicker
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
    </div>
  );
}
