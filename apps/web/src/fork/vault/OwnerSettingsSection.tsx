import { useEffect, useId, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { VAULT_ITEM_SEARCH_FEATURE, type VaultItemSummary } from "@t3tools/contracts/fork";
import { useEnvironmentQuery } from "~/state/query";
import {
  createVaultAccessAtoms,
  createVaultHealthAtoms,
  createVaultSshAtoms,
  createVaultBrokerAtoms,
  vaultBrokerState,
  supportsLoomFeature,
  vaultOwnerAccessSummary,
  vaultStatusMessage,
  vaultHealthMessage,
  vaultHealthVisibleState,
  VAULT_OWNER_SETUP_HELP,
} from "@t3tools/client-runtime/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import { forkSettingsTarget } from "../settings/navigation";
import { LoomSettingsDetails, LoomSettingsNotice, LoomSettingsPanel } from "../settings/parts";
import type { ForkSettingsTopicId } from "../settings/registry";
import { VaultSshDialog } from "./SshDialog";
import { vault } from "./state";
import { useVaultTime } from "./useVaultTime";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

const access = createVaultAccessAtoms(connectionAtomRuntime);
const health = createVaultHealthAtoms(connectionAtomRuntime);
const ssh = createVaultSshAtoms(connectionAtomRuntime);
const brokers = createVaultBrokerAtoms(connectionAtomRuntime);

export function VaultOwnerSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const configs = useServerConfigs();
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  if (!supportsLoomFeature(capabilities, "vault-owner-trusted")) return null;
  return <OwnerSettings key={environmentId} environmentId={environmentId} />;
}

function OwnerSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const configs = useServerConfigs();
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  const snapshotAtom = access.snapshot({ environmentId, input: {} });
  const result = useAtomValue(snapshotAtom);
  const [fresh, setFresh] = useState(false);
  const [request, setRequest] = useState({ environmentId, input: {} });
  const snapshot = fresh && result._tag === "Success" && !result.waiting ? result.value : null;
  const policy = snapshot?.ownerPolicy;
  const summary = vaultOwnerAccessSummary(policy);
  const allowed = useAtomValue(access.setOwnerPolicy.permissionAtom(environmentId));
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const field = useId();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the vault access snapshot from the server and aborts it on change
  useEffect(() => {
    const controller = new AbortController();
    void executeAtomQuery(appAtomRegistry, access.snapshot(request), {
      refresh: true,
      signal: controller.signal,
      reportFailure: false,
      reportDefect: false,
    }).then((checked) => {
      if (controller.signal.aborted) return;
      setFresh(checked._tag === "Success");
    });
    return () => controller.abort();
  }, [request]);
  const changePolicy = async () => {
    if (busy || !allowed || !snapshot || !policy || (!summary.enabled && !personal)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const changed = await access.setOwnerPolicy.run(appAtomRegistry, {
      environmentId,
      input: {
        operationId: randomUUID().replaceAll("-", ""),
        expectedRevision: snapshot.revision,
        mode: summary.enabled ? "restricted" : "owner-trusted",
      },
    });
    if (changed._tag === "Failure") {
      const cause = squashAtomCommandFailure(changed);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change owner access. Refresh and check this environment's owner permissions before trying again.",
      );
      appAtomRegistry.refresh(snapshotAtom);
    } else {
      setNotice(
        changed.value.ownerPolicy?.mode === "owner-trusted"
          ? "Owner access enabled for this environment."
          : "Restricted access enabled. Your saved project grants still apply.",
      );
    }
    setPersonal(false);
    setBusy(false);
  };
  return (
    <LoomSettingsPanel
      title="Owner access"
      description={
        snapshot
          ? summary.description
          : "Load this environment's access settings before making changes."
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {snapshot ? <Badge variant="secondary">{summary.title}</Badge> : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError(null);
            setNotice(null);
            setPersonal(false);
            setFresh(false);
            setRequest({ environmentId, input: {} });
          }}
        >
          Refresh status
        </Button>
      </div>
      {result.waiting || result._tag === "Initial" || (!fresh && result._tag !== "Failure") ? (
        <LoomSettingsNotice role="status">Loading owner access…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" || error ? (
        <LoomSettingsNotice role="alert">
          {error ??
            "Could not load owner access. Check this environment's Vault connection, then refresh."}
        </LoomSettingsNotice>
      ) : null}
      {snapshot && !policy ? (
        <LoomSettingsNotice>
          This server has not reported owner access. Update the server to enable it.
        </LoomSettingsNotice>
      ) : null}
      {policy ? (
        <div className="flex max-w-prose flex-col gap-3">
          {!summary.enabled ? (
            <>
              <label htmlFor={field} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={field}
                  checked={personal}
                  disabled={busy || !allowed}
                  onCheckedChange={(checked) => setPersonal(checked === true)}
                />
                This is my personal environment
              </label>
              <p className="text-sm text-muted-foreground">
                Enable this only when you are the sole owner of this Loom environment. Agents
                running here will be able to inspect and use your connected Vault access across
                projects.
              </p>
            </>
          ) : null}
          <div>
            <Button
              size="sm"
              variant={summary.enabled ? "outline" : "default"}
              disabled={busy || !allowed || (!summary.enabled && !personal)}
              onClick={() => void changePolicy()}
            >
              {busy ? "Saving access…" : summary.actionLabel}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Owner access covers inspection and credential use. Changes to Vault records and
            revealing or exporting values keep their existing permissions. Turning this off keeps
            your saved project grants.
          </p>
          {!allowed ? (
            <p className="text-sm">
              Only the authenticated environment owner can change this setting.
            </p>
          ) : null}
        </div>
      ) : null}
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
      <ConnectionOverview
        environmentId={environmentId}
        ownerEnabled={summary.enabled && !!snapshot}
        sshEnabled={supportsLoomFeature(capabilities, "vault-ssh-management")}
      />
      {supportsLoomFeature(capabilities, "vault-brokers") ? (
        <OwnerBrokers environmentId={environmentId} />
      ) : null}
      {supportsLoomFeature(capabilities, "vault-health") ? (
        <OwnerHealth environmentId={environmentId} />
      ) : null}
      <LoomSettingsDetails title="Connection setup and repair">
        <dl className="flex max-w-prose flex-col gap-3 text-sm">
          {VAULT_OWNER_SETUP_HELP.map((help) => (
            <div key={help.id}>
              <dt className="font-medium">{help.title}</dt>
              <dd className="mt-1 text-muted-foreground">{help.description}</dd>
            </div>
          ))}
        </dl>
      </LoomSettingsDetails>
      <p className="max-w-prose text-sm text-muted-foreground">
        Project profiles are optional shortcuts for choosing connections. Owner access does not
        require a profile. The destination still needs to accept the credential, and SSH needs
        verified host trust and a working execution broker.
      </p>
    </LoomSettingsPanel>
  );
}

function ConnectionOverview({
  environmentId,
  ownerEnabled,
  sshEnabled,
}: {
  environmentId: EnvironmentId;
  ownerEnabled: boolean;
  sshEnabled: boolean;
}) {
  const statusResult = useAtomValue(vault.status({ environmentId, input: {} }));
  const status =
    statusResult._tag === "Success" && !statusResult.waiting ? statusResult.value : null;
  if (!status)
    return (
      <LoomSettingsNotice role={statusResult._tag === "Failure" ? "alert" : "status"}>
        {statusResult._tag === "Failure"
          ? "Could not check the Vault connection. Refresh Vault below."
          : "Checking the Vault connection…"}
      </LoomSettingsNotice>
    );
  if (status.state !== "ready")
    return <LoomSettingsNotice>{vaultStatusMessage(status)}</LoomSettingsNotice>;
  return (
    <ConnectedItems
      environmentId={environmentId}
      ownerEnabled={ownerEnabled}
      sshEnabled={sshEnabled}
    />
  );
}

function ConnectedItems({
  environmentId,
  ownerEnabled,
  sshEnabled,
}: {
  environmentId: EnvironmentId;
  ownerEnabled: boolean;
  sshEnabled: boolean;
}) {
  const configs = useServerConfigs();
  const searchable = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    VAULT_ITEM_SEARCH_FEATURE,
  );
  const legacy = useEnvironmentQuery(
    !searchable
      ? vault.list({ environmentId, input: { cursor: null, includeArchived: false } })
      : null,
  );
  const sshRecords = useEnvironmentQuery(
    searchable
      ? vault.kindSummary({
          environmentId,
          input: { cursor: null, includeArchived: false, kind: "ssh-key", sort: "label" },
        })
      : null,
  );
  const githubRecords = useEnvironmentQuery(
    searchable
      ? vault.kindSummary({
          environmentId,
          input: {
            cursor: null,
            includeArchived: false,
            kind: "service-connection",
            sort: "label",
          },
        })
      : null,
  );
  const loaded = searchable
    ? sshRecords.isSuccess &&
      githubRecords.isSuccess &&
      !sshRecords.isPending &&
      !githubRecords.isPending
    : legacy.isSuccess && !legacy.isPending;
  const error = searchable ? (sshRecords.error ?? githubRecords.error) : legacy.error;
  const items = searchable
    ? [...(sshRecords.data?.items ?? []), ...(githubRecords.data?.items ?? [])]
    : (legacy.data?.items.filter(
        (item) => item.kind === "ssh-key" || item.kind === "service-connection",
      ) ?? []);
  const count = searchable
    ? (sshRecords.data?.total ?? 0) + (githubRecords.data?.total ?? 0)
    : items.length;
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const canCreateSsh = useAtomValue(ssh.generate.permissionAtom(environmentId));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          Connected development access{loaded && searchable ? ` (${count})` : ""}
        </h4>
        {sshEnabled ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!canCreateSsh}
            onClick={() => setSshItem(null)}
          >
            Add SSH connection
          </Button>
        ) : null}
      </div>
      {!loaded ? (
        <LoomSettingsNotice role={error !== null ? "alert" : "status"}>
          {error !== null
            ? "Could not load connections. Refresh Vault below."
            : "Loading connections…"}
        </LoomSettingsNotice>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No development connections. Create an SSH key below or connect GitHub in{" "}
          <TopicLink topic="vault-github">GitHub for agents</TopicLink>.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              {item.kind === "ssh-key" && sshEnabled ? (
                <SshConnection
                  environmentId={environmentId}
                  item={item}
                  ownerEnabled={ownerEnabled}
                  onOpen={() => setSshItem(item.id)}
                />
              ) : (
                <div className="flex flex-col gap-1 text-sm">
                  <p className="break-words font-medium">{item.label}</p>
                  <p className="text-muted-foreground">
                    {ownerEnabled
                      ? "Available to agents through owner access. Check the upstream connection before use."
                      : "Saved connection. Restricted project access applies."}
                  </p>
                  <TopicLink topic="vault-github">Review connection</TopicLink>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(searchable ? count > items.length : !!legacy.data?.nextCursor) ? (
        <p className="text-sm text-muted-foreground">
          More connections are available in the Vault item list below.
        </p>
      ) : null}
      {sshItem !== undefined ? (
        <VaultSshDialog
          environmentId={environmentId}
          itemId={sshItem}
          onClose={() => setSshItem(undefined)}
        />
      ) : null}
    </div>
  );
}

function SshConnection({
  environmentId,
  item,
  ownerEnabled,
  onOpen,
}: {
  environmentId: EnvironmentId;
  item: VaultItemSummary;
  ownerEnabled: boolean;
  onOpen: () => void;
}) {
  const result = useAtomValue(ssh.info({ environmentId, input: { id: item.id } }));
  const info = result._tag === "Success" && !result.waiting ? result.value : null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{item.label}</p>
        {info ? <p className="break-all text-muted-foreground">{info.destination}</p> : null}
        <p className="mt-1 text-muted-foreground">
          {result._tag === "Failure"
            ? "Could not inspect this SSH connection. Open it to retry."
            : !info
              ? "Checking SSH setup…"
              : !info.target.hostKey
                ? "Setup needed: verify and save this destination's host key."
                : ownerEnabled
                  ? "Owner access allows use. Test SSH to verify public key enrollment and broker connectivity."
                  : "Host trust saved. Restricted project access applies."}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {info && !info.target.hostKey ? "Finish SSH setup" : "Test or repair SSH"}
      </Button>
    </div>
  );
}

function OwnerHealth({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(health.snapshot({ environmentId, input: {} }));
  const snapshot = result._tag === "Success" && !result.waiting ? result.value : null;
  const now = useVaultTime(snapshot?.issues.map((issue) => issue.snoozedUntil) ?? []);
  const issues =
    snapshot?.issues.filter((issue) => vaultHealthVisibleState(issue, now) === "open") ?? [];
  if (!snapshot)
    return (
      <p className="text-sm text-muted-foreground">
        {result._tag === "Failure"
          ? "Connection health is unavailable. Review Health & recovery and retry."
          : "Checking reported connection problems…"}
      </p>
    );
  if (issues.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No open connection problems reported. Test a connection to check it now.
      </p>
    );
  const issue = issues[0]!;
  return (
    <div className="flex max-w-prose flex-col gap-2 text-sm">
      <p className="font-medium">{issue.itemLabel} needs attention</p>
      <p>{vaultHealthMessage(issue)}</p>
      <TopicLink topic="vault-health">Repair in Health & recovery</TopicLink>
      {issues.length > 1 ? (
        <p className="text-muted-foreground">
          {issues.length - 1} more reported problems in Health & recovery.
        </p>
      ) : null}
    </div>
  );
}

function OwnerBrokers({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(brokers.snapshot({ environmentId, input: {} }));
  const snapshot = result._tag === "Success" && !result.waiting ? result.value : null;
  const now = useVaultTime(snapshot?.machines.map((machine) => machine.leaseUntil) ?? []);
  const online =
    snapshot?.machines.filter((machine) => vaultBrokerState(machine, now) === "Online").length ?? 0;
  return (
    <div className="flex max-w-prose flex-col gap-2 text-sm">
      <p className="font-medium">SSH execution broker</p>
      <p className="text-muted-foreground">
        {!snapshot
          ? result._tag === "Failure"
            ? "Could not check registered brokers. Refresh Credential brokers and retry."
            : "Checking registered brokers…"
          : online > 0
            ? `${online} registered ${online === 1 ? "broker is" : "brokers are"} online. The Loom server must be configured to use its enrolled broker.`
            : "No registered broker is online. Enroll this Loom server's computer and keep its broker running before using SSH."}
      </p>
      {snapshot && online === 0 ? (
        <TopicLink topic="vault-brokers">Set up the execution broker</TopicLink>
      ) : null}
    </div>
  );
}

/** Hash anchors would replace the desktop app's hash route, so topic links go through the router. */
function TopicLink({ topic, children }: { topic: ForkSettingsTopicId; children: ReactNode }) {
  return (
    <Link
      {...forkSettingsTarget(topic)}
      hashScrollIntoView={false}
      className="text-primary underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
