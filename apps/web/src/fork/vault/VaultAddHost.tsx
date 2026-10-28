import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemKind, VaultItemSummary } from "@t3tools/contracts/fork";
import {
  supportsLoomFeature,
  vaultItemActions,
  vaultStatusMessage,
} from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { LoomSettingsField, LoomSettingsNotice } from "../settings/parts";
import { vaultAddTarget, type VaultAddOptions } from "./add-navigation";
import { VaultEditor } from "./VaultEditor";
import { VaultSshDialog } from "./SshDialog";
import { VaultGitHubAddDialog } from "./GitHubSettingsSection";
import { vault } from "./state";

export function VaultAddHost() {
  const target = useAtomValue(vaultAddTarget);
  return target ? <VaultAddDialog key={target.requestId} target={target} /> : null;
}

function VaultAddDialog({ target }: { target: VaultAddOptions }) {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const configs = useServerConfigs();
  const available = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-core",
      ),
  );
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    target.environmentId ?? primary ?? available[0]?.environmentId ?? null,
  );
  const [kind, setKind] = useState<VaultItemKind>(target.kind ?? "secret");
  const capabilities = environmentId
    ? configs.get(environmentId)?.environment.capabilities
    : undefined;
  const supported = supportsLoomFeature(capabilities, "vault-core");
  const status = useEnvironmentQuery(
    environmentId && supported ? vault.status({ environmentId, input: {} }) : null,
  );
  const close = () => appAtomRegistry.set(vaultAddTarget, null);
  const saved = (item: VaultItemSummary) => {
    target.onSaved?.(item);
    close();
  };
  const manager = vaultItemActions(kind).manager;
  const fixedKind = target.onSaved !== undefined && target.kind !== undefined;
  const selector = !target.environmentId ? (
    <div className="px-6 pb-4">
      <LoomSettingsField label="Computer">
        <Select
          value={environmentId ?? ""}
          onValueChange={(next) =>
            setEnvironmentId(
              available.find((environment) => environment.environmentId === next)?.environmentId ??
                null,
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a connected computer" />
          </SelectTrigger>
          <SelectPopup>
            {available.map((environment) => (
              <SelectItem key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
    </div>
  ) : null;
  const needsSsh = manager === "ssh" && !supportsLoomFeature(capabilities, "vault-ssh-management");
  const needsGitHub = manager === "github" && !supportsLoomFeature(capabilities, "vault-github");
  const ready = status.isSuccess && !status.isPending && status.data?.state === "ready";
  if (!environmentId || !supported || (manager !== null && !ready) || needsSsh || needsGitHub)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add to Vault</DialogTitle>
            <DialogDescription>Choose a connected computer whose Vault is ready.</DialogDescription>
          </DialogHeader>
          {selector}
          <div className="flex flex-col gap-3 px-6 pb-5">
            <LoomSettingsNotice role={status.error ? "alert" : "status"}>
              {needsSsh || needsGitHub
                ? "This computer does not support this connection manager. Update Loom before creating the connection."
                : (status.error ??
                  (status.data
                    ? vaultStatusMessage(status.data)
                    : supported
                      ? "Checking Vault connection…"
                      : "Choose a connected computer with Vault support."))}
            </LoomSettingsNotice>
            <Button variant="outline" onClick={status.refresh}>
              Refresh
            </Button>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    );
  if (manager === "ssh")
    return (
      <VaultSshDialog
        environmentId={environmentId}
        itemId={null}
        initialLabel={target.label ?? ""}
        onSaved={saved}
        onClose={close}
      />
    );
  if (manager === "github")
    return (
      <VaultGitHubAddDialog
        environmentId={environmentId}
        initialLabel={target.label ?? ""}
        onSaved={saved}
        onClose={close}
      />
    );
  return (
    <VaultEditor
      key={environmentId}
      environmentId={environmentId}
      item={null}
      initialFile={null}
      initialKind={kind}
      initialLabel={target.label ?? ""}
      initialValue={target.value ?? ""}
      lockKind={fixedKind}
      saveDisabled={!ready}
      header={
        <>
          {selector}
          {!ready ? (
            <div className="px-6 pb-4">
              <LoomSettingsNotice role={status.error ? "alert" : "status"}>
                {status.error ??
                  (status.data ? vaultStatusMessage(status.data) : "Checking Vault connection…")}
              </LoomSettingsNotice>
              <Button size="sm" variant="outline" onClick={status.refresh}>
                Refresh Vault
              </Button>
            </div>
          ) : null}
        </>
      }
      onCreateSsh={
        !fixedKind && supportsLoomFeature(capabilities, "vault-ssh-management")
          ? () => setKind("ssh-key")
          : undefined
      }
      githubEnabled={!fixedKind && supportsLoomFeature(capabilities, "vault-github")}
      onConnectGitHub={() => setKind("service-connection")}
      onSaved={saved}
      onClose={close}
    />
  );
}
