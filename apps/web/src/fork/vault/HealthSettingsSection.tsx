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
  vaultHealthRecheckMessage,
  vaultHealthVisibleState,
  vaultHealthInboxGroups,
} from "@t3tools/client-runtime/fork";
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
    return <p>Choose a computer with Vault health support.</p>;
  if (!canRead) return <p>Your connection does not include Vault inspection.</p>;
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
  const pageResult = useAtomValue(
      core.list({ environmentId, input: { cursor, includeArchived: false } }),
    ),
    page = pageResult._tag === "Success" && !pageResult.waiting ? pageResult.value : null;
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
    } finally {
      setBusy(false);
    }
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
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Maintenance inbox</h3>
        <p className="max-w-prose text-muted-foreground">
          Review expiry and failed development access. Provider outages do not revoke credentials.
          Only explicitly enabled rules run in the background.
        </p>
      </div>
      <LoomSettingsActions>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError(null);
            setNotice(null);
            appAtomRegistry.refresh(atom);
          }}
        >
          Refresh health
        </Button>
        <Button size="sm" variant="outline" onClick={() => setHistory(!history)}>
          {history ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
        </Button>
      </LoomSettingsActions>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Loading Vault health…</LoomSettingsNotice>
      ) : null}
      {error || result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          {error ?? "Could not load Vault health. Check the backend and refresh."}
        </LoomSettingsNotice>
      ) : null}
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
      {snapshot?.issues.filter((i) => history || !["dismissed", "resolved"].includes(i.state))
        .length === 0 ? (
        <p>No active maintenance issues.</p>
      ) : null}
      {snapshot
        ? vaultHealthInboxGroups(snapshot, history).map((group) => (
            <div key={group.id} className="flex flex-col gap-3">
              {group.label ? (
                <>
                  <h3 className="font-medium">Outage reports: {group.label}</h3>
                  <p>
                    {group.issues.length} affected items. Reports share a destination; they may have
                    different causes. Review and update each item separately.
                  </p>
                </>
              ) : null}
              {group.issues.map((issue) => (
                <section
                  key={issue.id}
                  className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-3 sm:p-4"
                  aria-label={`${issue.itemLabel} ${issue.category}`}
                >
                  <p className="font-medium">
                    {issue.itemLabel}: {issue.category}
                  </p>
                  <p>{vaultHealthMessage(issue)}</p>
                  <LoomSettingsActions>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openVaultAccess({ environmentId, itemId: issue.itemId })}
                    >
                      Review access
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setContextIssue(contextIssue === issue.id ? null : issue.id)}
                    >
                      {contextIssue === issue.id
                        ? "Hide project references"
                        : "Show project references"}
                    </Button>
                  </LoomSettingsActions>
                  {contextIssue === issue.id ? (
                    <VaultHealthContext environmentId={environmentId} itemId={issue.itemId} />
                  ) : null}
                  <p className="text-sm">
                    {vaultHealthVisibleState(issue, now)} · {issue.occurrences} occurrences · Last
                    seen {new Date(issue.lastSeenAt).toLocaleString()}
                  </p>
                  <LoomSettingsActions>
                    <Button
                      size="sm"
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
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() => void issueAction(issue, "unsnooze")}
                      >
                        Unsnooze
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() => void issueAction(issue, "snooze")}
                      >
                        Snooze 1 day
                      </Button>
                    )}
                    {["dismissed", "resolved"].includes(issue.state) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() => void issueAction(issue, "reopen")}
                      >
                        Reopen
                      </Button>
                    ) : (
                      <Button
                        size="sm"
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
          ))
        : null}
      {snapshot?.omittedIssues ? (
        <p>{snapshot.omittedIssues} older issues omitted by retention.</p>
      ) : null}
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
          {pageResult.waiting ? (
            <LoomSettingsNotice role="status">Loading Vault items…</LoomSettingsNotice>
          ) : null}
          {pageResult._tag === "Failure" ? (
            <LoomSettingsNotice role="alert">
              Could not load Vault items. Refresh and retry.
            </LoomSettingsNotice>
          ) : null}
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
              size="sm"
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              First items
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!page?.nextCursor}
              onClick={() => setCursor(page?.nextCursor ?? null)}
            >
              More items
            </Button>
          </LoomSettingsActions>
          <LoomSettingsField label="Declared expiry, ISO date (optional)">
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
                <input
                  className="mt-1 shrink-0"
                  type="checkbox"
                  aria-label="Validate SSH connection"
                  checked={sshValidation}
                  disabled={locked}
                  onChange={(e) => {
                    setSshValidation(e.target.checked);
                    if (e.target.checked) setRepository("");
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
            <input
              className="mt-1 shrink-0"
              type="checkbox"
              checked={automatic}
              disabled={locked}
              onChange={(e) => setAutomatic(e.target.checked)}
            />{" "}
            Run checks automatically, at most every 15 minutes
          </label>
          <LoomSettingsActions>
            <Button type="submit" size="sm" disabled={locked || !itemId}>
              Save health rule
            </Button>
            <Button
              type="button"
              size="sm"
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
            <Button
              type="button"
              size="sm"
              variant="destructive-outline"
              disabled={locked || !itemId}
              onClick={() => void act(() => apply({ action: "remove-rule", itemId }))}
            >
              Remove rule
            </Button>
          </LoomSettingsActions>
        </form>
      </LoomSettingsPanel>
    </div>
  );
}
