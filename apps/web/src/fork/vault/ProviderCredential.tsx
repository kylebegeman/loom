import { useState, type ReactNode } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthProvidersManageScope,
  type EnvironmentId,
  type SecretReference,
} from "@t3tools/contracts";
import {
  VAULT_PROVIDER_CREDENTIALS_FEATURE,
  isVaultProviderReference,
  vaultProviderBinding,
  vaultProviderReference,
  type VaultError,
  type VaultReference,
} from "@t3tools/contracts/fork";
import { createVaultReferenceAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { VaultReferencePicker } from "./ReferencePicker";
import { vault } from "./state";
import { useVaultEnvironment } from "./useVaultEnvironment";

const references = createVaultReferenceAtoms(connectionAtomRuntime);
const EMPTY = Atom.make(AsyncResult.initial<VaultReference | null, VaultError>(false));

export function VaultProviderCredential({
  environmentId,
  providerName,
  variableName,
  value,
  onChange,
  children,
}: {
  environmentId: EnvironmentId;
  providerName: string;
  variableName: string;
  value: string | SecretReference;
  onChange: (reference: SecretReference | undefined) => void;
  children: ReactNode;
}) {
  const configs = useServerConfigs();
  const { vaultEnvironmentId, resolved } = useVaultEnvironment(environmentId);
  const supported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    VAULT_PROVIDER_CREDENTIALS_FEATURE,
  );
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canInspect = useEnvironmentScope(vaultEnvironmentId, AuthAccessReadScope);
  const canWrite = useAtomValue(vault.save.permissionAtom(environmentId));
  const [open, setOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const binding = vaultProviderBinding(value);
  const fromVault = isVaultProviderReference(value);
  const boundHere =
    binding?.environmentId === environmentId || binding?.environmentId === vaultEnvironmentId;
  const query =
    binding && boundHere && supported && canInspect
      ? references.describe({ environmentId: vaultEnvironmentId, input: { id: binding.itemId } })
      : EMPTY;
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const item = Option.getOrNull(AsyncResult.value(result))?.item;
  const allowed = canManage && canWrite;
  const selectable = resolved && allowed && supported && variableName.trim().length > 0;
  const current =
    item?.state === "active" && item.kind === "secret" && item.version === binding?.expectedVersion;
  const status = !binding
    ? "This Vault binding is invalid. Choose a secret again."
    : !boundHere
      ? "This binding belongs to another Vault. Choose a secret from the connected Vault."
      : !supported
        ? "Update Loom on this computer to use Vault provider credentials."
        : !canInspect
          ? "Vault read access is required to inspect this item."
          : result.waiting
            ? "Checking the Vault item…"
            : result._tag === "Failure"
              ? "Could not load this Vault item. Refresh or choose another."
              : !item
                ? "This Vault item is unavailable. Choose another secret."
                : !current
                  ? "This Vault item changed or is inactive. Choose an active version again."
                  : null;

  if (!supported && !fromVault) return children;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {fromVault ? (
        <div className="flex min-w-0 items-start gap-2 text-xs">
          <KeyRoundIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <p className="wrap-anywhere font-medium">
              {item?.label ?? "Vault secret"}
              {binding ? ` · Version ${binding.expectedVersion}` : ""}
            </p>
            {binding ? (
              <p className="wrap-anywhere text-2xs text-muted-foreground">Item {binding.itemId}</p>
            ) : null}
            {status ? (
              <p
                role={result.waiting ? "status" : "alert"}
                className="wrap-anywhere text-muted-foreground"
              >
                {status}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        children
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={<Button type="button" size="xs" variant="outline" disabled={!selectable} />}
          >
            <KeyRoundIcon aria-hidden />
            {fromVault ? "Change Vault item" : "Use Vault"}
          </DialogTrigger>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Vault credential for {providerName}</DialogTitle>
              <DialogDescription>
                Supply <code className="wrap-anywhere">{variableName}</code> to this provider on the
                selected computer. The provider receives the secret value. Rotation requires
                choosing the new item version.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <VaultReferencePicker
                environmentId={vaultEnvironmentId}
                kind="secret"
                disabled={!selectable}
                onSelect={(reference) => {
                  if (
                    !selectable ||
                    reference.environmentId !== vaultEnvironmentId ||
                    reference.item.kind !== "secret" ||
                    reference.item.state !== "active"
                  ) {
                    setSelectionError("Choose an active secret from the connected Vault.");
                    return;
                  }
                  appAtomRegistry.refresh(
                    references.describe({
                      environmentId: vaultEnvironmentId,
                      input: { id: reference.item.id },
                    }),
                  );
                  onChange(
                    vaultProviderReference({
                      environmentId: vaultEnvironmentId,
                      itemId: reference.item.id,
                      expectedVersion: reference.item.version,
                    }),
                  );
                  setSelectionError(null);
                  setOpen(false);
                }}
              />
              {selectionError ? <p role="alert">{selectionError}</p> : null}
            </DialogPanel>
          </DialogPopup>
        </Dialog>
        {fromVault ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={!allowed}
            onClick={() => onChange(undefined)}
          >
            Remove Vault item
          </Button>
        ) : null}
        {fromVault && binding && boundHere && supported && canInspect ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={result.waiting}
            onClick={refresh}
          >
            Refresh item
          </Button>
        ) : null}
      </div>
      {!fromVault && !allowed ? (
        <p className="text-2xs text-muted-foreground">
          Provider management and Vault write access are required.
        </p>
      ) : null}
    </div>
  );
}
