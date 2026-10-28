import { VaultQueryFeedback } from "./SettingsFeedback";
import { Checkbox } from "~/components/ui/checkbox";
import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { VaultHealthContext } from "./HealthContext";
import { openVaultAccess } from "./access-navigation";
import { useVaultTime } from "./useVaultTime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { type VaultHealthMutation, type VaultHealthIssue } from "@t3tools/contracts/fork";
import {
  createVaultHealthAtoms,
  createVaultCoreAtoms,
  supportsLoomFeature,
  vaultHealthMessage,
  vaultHealthBackendMessage,
  vaultHealthRecheckMessage,
  vaultHealthVisibleState,
  vaultHealthInboxGroups,
} from "@t3tools/client-runtime/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
const atoms = createVaultHealthAtoms(connectionAtomRuntime),
  core = createVaultCoreAtoms(connectionAtomRuntime);
export function VaultHealthSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-health",
    )
  )
    return <LoomSettingsNotice>Choose a computer with Vault health support.</LoomSettingsNotice>;
  if (!canRead)
    return (
      <LoomSettingsNotice>Your connection does not include Vault inspection.</LoomSettingsNotice>
    );
  return (
    <Inbox
      key={environment.environmentId}
      environmentId={environment.environmentId}
      canWrite={canWrite}
      supportsSshValidation={supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-health-ssh-validation",
      )}
    />
  );
}
function Inbox({
  environmentId,
  canWrite,
  supportsSshValidation,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
  supportsSshValidation: boolean;
}) {
  const atom = atoms.snapshot({ environmentId, input: {} }),
    result = useAtomValue(atom),
    snapshot = result._tag === "Success" && !result.waiting ? result.value : null;
  const statusAtom = core.status({ environmentId, input: {} });
  const statusResult = useAtomValue(statusAtom);
  const backend =
    statusResult._tag === "Success" && !statusResult.waiting ? statusResult.value : null;
  const [contextIssue, setContextIssue] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [itemId, setItemId] = useState(""),
    [expires, setExpires] = useState(""),
    [repository, setRepository] = useState(""),
    [automatic, setAutomatic] = useState(false),
    [sshValidation, setSshValidation] = useState(false),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const pageAtom = core.list({ environmentId, input: { cursor, includeArchived: false } });
  const pageResult = useAtomValue(pageAtom),
    page = pageResult._tag === "Success" && !pageResult.waiting ? pageResult.value : null;
  const savedRule = snapshot?.rules.find((rule) => rule.itemId === itemId);
  const ruleChanged =
    !!itemId &&
    (!savedRule ||
      (expires ? Date.parse(expires) : null) !== savedRule.expiresAt ||
      (repository.trim() || null) !== savedRule.githubRepository ||
      automatic !== savedRule.automatic ||
      (supportsSshValidation && sshValidation !== (savedRule.sshValidation ?? false)));
  const canApply = useAtomValue(atoms.apply.permissionAtom(environmentId));
  const now = useVaultTime(snapshot?.issues.map((issue) => issue.snoozedUntil) ?? []);
  const locked =
    !snapshot || busy || !canWrite || !canApply || result.waiting || result._tag === "Failure";
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      appAtomRegistry.refresh(atom);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update health. Refresh and retry.",
      );
    }
    setBusy(false);
  };
  const apply = (change: VaultHealthMutation["change"]) => {
    if (!snapshot) return Promise.resolve();
    return runVault(atoms.apply, {
      environmentId,
      input: {
        operationId: randomUUID().replaceAll("-", ""),
        expectedRevision: snapshot.revision,
        change,
      },
    });
  };
  const issueAction = (
    issue: VaultHealthIssue,
    action: "snooze" | "unsnooze" | "dismiss" | "reopen",
  ) =>
    act(() =>
      apply({
        action,
        issueId: issue.id,
        until: action === "snooze" ? Date.now() + 86400_000 : null,
      }),
    );
  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed wrap-anywhere">
      <VaultQueryFeedback
        result={statusResult}
        loading="Checking Vault backend…"
        error="Could not check the Vault backend. Reconnect and refresh."
        onRetry={() => appAtomRegistry.refresh(statusAtom)}
      />
      {backend ? (
        <LoomSettingsNotice role="status">{vaultHealthBackendMessage(backend)}</LoomSettingsNotice>
      ) : null}
      <LoomSettingsPanel
        title="Maintenance inbox"
        description="Review expiry and failed development access. Provider outages do not revoke credentials. Only explicitly enabled rules run in the background."
      >
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              appAtomRegistry.refresh(atom);
              appAtomRegistry.refresh(statusAtom);
            }}
          >
            Refresh health
          </Button>
          <Button size="sm-multiline" variant="outline" onClick={() => setHistory(!history)}>
            {history ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
          </Button>
        </LoomSettingsActions>
        <VaultQueryFeedback
          result={result}
          loading="Loading Vault health…"
          error="Could not load Vault health. Check the backend and retry."
          onRetry={() => appAtomRegistry.refresh(atom)}
        />
        {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
        {busy ? (
          <LoomSettingsNotice role="status">Updating Vault health…</LoomSettingsNotice>
        ) : null}
        {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
        {snapshot?.issues.filter((i) => history || !["dismissed", "resolved"].includes(i.state))
          .length === 0 ? (
          <LoomSettingsNotice>
            {history
              ? "No maintenance issues in the retained history."
              : "No active maintenance issues. Saved health rules continue to monitor the records you selected."}
          </LoomSettingsNotice>
        ) : null}
        {snapshot
          ? vaultHealthInboxGroups(snapshot, history).map((group) => (
              <div key={group.id} className="flex flex-col gap-3">
                {group.label ? (
                  <>
                    <h4 className="text-sm font-medium">Outage reports: {group.label}</h4>
                    <p>
                      {group.issues.length} affected items. Reports share a destination; they may
                      have different causes. Review and update each item separately.
                    </p>
                  </>
                ) : null}
                <div className="flex min-w-0 flex-col divide-y divide-border/60">
                  {group.issues.map((issue) => (
                    <section
                      key={issue.id}
                      className="flex min-w-0 flex-col gap-4 py-4 first:pt-0 last:pb-0"
                      aria-label={`${issue.itemLabel} ${issue.category}`}
                    >
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <h4 className="wrap-anywhere text-sm font-medium">{issue.itemLabel}</h4>
                          <p className="text-sm text-muted-foreground">{issue.category}</p>
                        </div>
                        <Badge variant="secondary">{vaultHealthVisibleState(issue, now)}</Badge>
                      </div>
                      <p>{vaultHealthMessage(issue)}</p>
                      <LoomSettingsActions>
                        <Button
                          size="sm-multiline"
                          variant="outline"
                          onClick={() => openVaultAccess({ environmentId, itemId: issue.itemId })}
                        >
                          Review access
                        </Button>
                        <Button
                          size="sm-multiline"
                          variant="outline"
                          onClick={() =>
                            setContextIssue(contextIssue === issue.id ? null : issue.id)
                          }
                        >
                          {contextIssue === issue.id
                            ? "Hide project references"
                            : "Show project references"}
                        </Button>
                      </LoomSettingsActions>
                      {contextIssue === issue.id ? (
                        <VaultHealthContext environmentId={environmentId} itemId={issue.itemId} />
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {issue.occurrences} occurrences. Last seen{" "}
                        {new Date(issue.lastSeenAt).toLocaleString()}.
                      </p>
                      <LoomSettingsActions>
                        <Button
                          size="sm-multiline"
                          variant="outline"
                          disabled={locked}
                          onClick={() =>
                            void act(async () => {
                              const result = await runVault(atoms.recheck, {
                                environmentId,
                                input: { itemId: issue.itemId },
                              });
                              setNotice(vaultHealthRecheckMessage(result.outcome));
                            })
                          }
                        >
                          Recheck
                        </Button>
                        {issue.state === "snoozed" ? (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={locked}
                            onClick={() => void issueAction(issue, "unsnooze")}
                          >
                            Unsnooze
                          </Button>
                        ) : (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={locked}
                            onClick={() => void issueAction(issue, "snooze")}
                          >
                            Snooze 1 day
                          </Button>
                        )}
                        {["dismissed", "resolved"].includes(issue.state) ? (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={locked}
                            onClick={() => void issueAction(issue, "reopen")}
                          >
                            Reopen
                          </Button>
                        ) : (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={locked}
                            onClick={() => void issueAction(issue, "dismiss")}
                          >
                            Dismiss
                          </Button>
                        )}
                      </LoomSettingsActions>
                    </section>
                  ))}
                </div>
              </div>
            ))
          : null}
        {snapshot?.omittedIssues ? (
          <p>{snapshot.omittedIssues} older issues omitted by retention.</p>
        ) : null}
      </LoomSettingsPanel>
      <LoomSettingsPanel
        title="Expiry and validation rules"
        description="Choose a record to review or update its rule. Expiry warnings start seven days before the declared date."
      >
        <form
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const expiresAt = expires ? Date.parse(expires) : null;
              if (expiresAt !== null && !Number.isFinite(expiresAt))
                throw new Error("Enter a valid expiry date.");
              await apply({
                action: "configure",
                rule: {
                  itemId,
                  expiresAt,
                  warningDays: 7,
                  githubRepository: repository.trim() || null,
                  ...(supportsSshValidation ? { sshValidation } : {}),
                  automatic,
                  nextCheckAt: 0,
                },
              });
              setNotice("Health rule saved.");
            });
          }}
        >
          <VaultQueryFeedback
            result={pageResult}
            loading="Loading Vault items…"
            error="Could not load Vault items."
            onRetry={() => appAtomRegistry.refresh(pageAtom)}
          />
          {page?.items.length === 0 ? <p>No active items on this page.</p> : null}
          <LoomSettingsField label="Vault item">
            <Select
              value={itemId}
              disabled={locked}
              onValueChange={(nextValue) => {
                if (nextValue === null) return;
                setItemId(nextValue);
                const rule = snapshot?.rules.find((r) => r.itemId === nextValue);
                setExpires(rule?.expiresAt ? new Date(rule.expiresAt).toISOString() : "");
                setRepository(rule?.githubRepository ?? "");
                setAutomatic(rule?.automatic ?? false);
                setSshValidation(rule?.sshValidation ?? false);
              }}
            >
              <SelectTrigger aria-label="Health rule item">
                <SelectValue>
                  {page?.items.find((item) => item.id === itemId)?.label ??
                    (itemId || "Choose an item")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">Choose an item</SelectItem>
                {page?.items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LoomSettingsField>
          <LoomSettingsActions>
            <Button
              type="button"
              size="sm-multiline"
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              First items
            </Button>
            <Button
              type="button"
              size="sm-multiline"
              variant="outline"
              disabled={!page?.nextCursor}
              onClick={() => setCursor(page?.nextCursor ?? null)}
            >
              More items
            </Button>
          </LoomSettingsActions>
          <LoomSettingsField
            label="Declared expiry (optional)"
            description="Enter an ISO date, such as 2027-01-01T00:00:00Z. Warnings start seven days before this date."
          >
            <Input
              aria-label="Declared expiry"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              disabled={locked}
              placeholder="2027-01-01T00:00:00Z"
            />
          </LoomSettingsField>
          <p className="text-sm text-muted-foreground">
            Connection validation:{" "}
            {sshValidation
              ? "saved SSH connection"
              : repository.trim()
                ? `GitHub repository ${repository.trim()}`
                : "not configured"}
            .
          </p>
          <LoomSettingsDetails title="Connection validation options">
            {supportsSshValidation &&
            (sshValidation ||
              page?.items.find((item) => item.id === itemId)?.kind === "ssh-key") ? (
              <label className="flex items-start gap-2 text-sm leading-6">
                <Checkbox
                  aria-label="Validate SSH connection"
                  checked={sshValidation}
                  disabled={locked}
                  onCheckedChange={(checked) => {
                    setSshValidation(checked);
                    if (checked) setRepository("");
                  }}
                />{" "}
                Validate the saved SSH connection using its trusted host key and a fixed no-op
                command
              </label>
            ) : null}
            <LoomSettingsField label="GitHub repository to validate (optional)">
              <Input
                aria-label="Health GitHub repository"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                disabled={locked}
                placeholder="owner/repo"
                readOnly={sshValidation}
              />
            </LoomSettingsField>
          </LoomSettingsDetails>
          <label className="flex items-start gap-2 text-sm leading-6">
            <Checkbox
              checked={automatic}
              disabled={locked}
              onCheckedChange={(checked) => setAutomatic(checked)}
            />{" "}
            Run checks automatically, at most every 15 minutes
          </label>
          <p role="status" className="text-sm text-muted-foreground">
            {!itemId
              ? "Choose an item to configure its health rule."
              : ruleChanged
                ? "Unsaved rule changes. Save to apply this configuration."
                : "Showing the saved rule for this item."}
          </p>
          <LoomSettingsActions>
            <Button type="submit" size="sm-multiline" disabled={locked || !itemId}>
              Save health rule
            </Button>
            <Button
              type="button"
              size="sm-multiline"
              variant="outline"
              disabled={locked || !itemId}
              onClick={() =>
                void act(async () => {
                  const result = await runVault(atoms.recheck, {
                    environmentId,
                    input: { itemId },
                  });
                  setNotice(vaultHealthRecheckMessage(result.outcome));
                })
              }
            >
              Check selected item
            </Button>
          </LoomSettingsActions>
          <LoomSettingsDetails title="Remove health rule">
            <p className="text-sm text-muted-foreground">
              Stop monitoring the selected item. The Vault record and its access grants are
              preserved.
            </p>
            <LoomSettingsActions>
              <Button
                type="button"
                size="sm-multiline"
                variant="destructive-outline"
                disabled={locked || !itemId}
                onClick={() => void act(() => apply({ action: "remove-rule", itemId }))}
              >
                Remove rule
              </Button>
            </LoomSettingsActions>
          </LoomSettingsDetails>
        </form>
      </LoomSettingsPanel>
    </div>
  );
}
