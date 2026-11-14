import * as Schema from "effect/Schema";
import { EnvironmentId, PositiveInt } from "../baseSchemas.ts";
import { SecretProviderId, type SecretReference } from "../secretReference.ts";
import type { ProviderInstanceMutation } from "../providerInstance.ts";
import type { ServerSettingsPatch } from "../settings.ts";
import { AuthVaultWriteScope, AuthProvidersManageScope } from "../auth.ts";
import { VaultItemId } from "./vault-core.ts";

export const VAULT_PROVIDER_CREDENTIALS_FEATURE = "vault-provider-credentials";
const VAULT_PROVIDER_SECRET_SOURCE = SecretProviderId.make("loom-vault");
const VaultProviderBinding = Schema.Struct({
  environmentId: EnvironmentId,
  itemId: VaultItemId,
  expectedVersion: PositiveInt,
});
type VaultProviderBinding = typeof VaultProviderBinding.Type;
const decodeBinding = Schema.decodeUnknownOption(VaultProviderBinding);

export const isVaultProviderReference = (value: string | SecretReference) =>
  typeof value !== "string" && value.provider === VAULT_PROVIDER_SECRET_SOURCE;

export const vaultProviderReference = (binding: VaultProviderBinding): SecretReference => ({
  provider: VAULT_PROVIDER_SECRET_SOURCE,
  reference: `loom-vault:${encodeURIComponent(binding.environmentId)}:${binding.itemId}:${binding.expectedVersion}`,
});

export const vaultProviderBinding = (
  value: string | SecretReference,
): VaultProviderBinding | null => {
  if (!isVaultProviderReference(value) || typeof value === "string") return null;
  const parts = /^loom-vault:([^:]+):([a-f0-9]{32}):([1-9][0-9]*)$/.exec(value.reference);
  if (parts === null) return null;
  try {
    const decoded = decodeBinding({
      environmentId: decodeURIComponent(parts[1]!),
      itemId: parts[2],
      expectedVersion: Number(parts[3]),
    });
    return decoded._tag === "Some" ? decoded.value : null;
  } catch {
    return null;
  }
};

export const vaultProviderSettingsScopes = (input: {
  readonly patch: ServerSettingsPatch;
  readonly providerInstanceMutation?: ProviderInstanceMutation;
}) => {
  const mutation = input.providerInstanceMutation;
  const instances = [
    ...Object.values(input.patch.providerInstances ?? {}),
    ...(mutation && mutation.operation !== "remove" ? [mutation.instance] : []),
  ];
  return instances.some((instance) =>
    instance?.environment?.some((variable) => isVaultProviderReference(variable.value)),
  )
    ? [AuthProvidersManageScope, AuthVaultWriteScope]
    : [];
};
