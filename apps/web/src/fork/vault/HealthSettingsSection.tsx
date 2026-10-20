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
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
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
    />
  );
}
function Inbox({ environmentId, canWrite }: { environmentId: EnvironmentId; canWrite: boolean }) {
  const atom = atoms.snapshot({ environmentId, input: {} }),
    result = useAtomValue(atom),
    snapshot = Option.getOrNull(AsyncResult.value(result));
  const [contextIssue, setContextIssue] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [itemId, setItemId] = useState(""),
    [expires, setExpires] = useState(""),
    [repository, setRepository] = useState(""),
    [automatic, setAutomatic] = useState(false),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const pageResult = useAtomValue(
      core.list({ environmentId, input: { cursor, includeArchived: false } }),
    ),
    page = Option.getOrNull(AsyncResult.value(pageResult));
  const canApply = useAtomValue(atoms.apply.permissionAtom(environmentId));
  const now = useVaultTime(snapshot?.issues.map((issue) => issue.snoozedUntil) ?? []);
  const locked = busy || !canWrite || !canApply || result.waiting || result._tag === "Failure";
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
    <div className="flex flex-col gap-4">
      <p>
        Review expiry and failed development access. Provider outages do not revoke credentials.
        Only explicitly enabled rules run in the background.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => appAtomRegistry.refresh(atom)}
        >
          Refresh health
        </Button>
        <Button size="sm" variant="outline" onClick={() => setHistory(!history)}>
          {history ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
        </Button>
      </div>
      {result.waiting ? <p role="status">Loading Vault health…</p> : null}
      {error || result._tag === "Failure" ? (
        <p role="alert">{error ?? "Could not load Vault health. Check the backend and refresh."}</p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {snapshot?.issues.filter((i) => history || !["dismissed", "resolved"].includes(i.state))
        .length === 0 ? (
        <p>No active maintenance issues.</p>
      ) : null}
      {snapshot?.issues
        .filter((i) => history || !["dismissed", "resolved"].includes(i.state))
        .map((issue) => (
          <section
            key={issue.id}
            className="flex flex-col gap-2 rounded-md border p-3"
            aria-label={`${issue.itemLabel} ${issue.category}`}
          >
            <p className="font-medium">
              {issue.itemLabel}: {issue.category}
            </p>
            <p>{vaultHealthMessage(issue)}</p>
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
              {contextIssue === issue.id ? "Hide project references" : "Show project references"}
            </Button>
            {contextIssue === issue.id ? (
              <VaultHealthContext environmentId={environmentId} itemId={issue.itemId} />
            ) : null}
            <p className="text-sm">
              {vaultHealthVisibleState(issue, now)} · {issue.occurrences} occurrences · Last seen{" "}
              {new Date(issue.lastSeenAt).toLocaleString()}
            </p>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </section>
        ))}
      {snapshot?.omittedIssues ? (
        <p>{snapshot.omittedIssues} older issues omitted by retention.</p>
      ) : null}
      <form
        className="flex flex-col gap-3 rounded-md border p-3"
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
                automatic,
                nextCheckAt: 0,
              },
            });
            setNotice(
              "Health rule saved. Expiry warnings begin seven days before the declared date.",
            );
          });
        }}
      >
        <p className="font-medium">Expiry and validation rules</p>
        {pageResult.waiting ? <p role="status">Loading Vault items…</p> : null}
        {pageResult._tag === "Failure" ? (
          <p role="alert">Could not load Vault items. Refresh and retry.</p>
        ) : null}
        {page?.items.length === 0 ? <p>No active items on this page.</p> : null}
        <label>
          Vault item
          <select
            aria-label="Health rule item"
            value={itemId}
            disabled={locked}
            onChange={(e) => {
              setItemId(e.target.value);
              const rule = snapshot?.rules.find((r) => r.itemId === e.target.value);
              setExpires(rule?.expiresAt ? new Date(rule.expiresAt).toISOString() : "");
              setRepository(rule?.githubRepository ?? "");
              setAutomatic(rule?.automatic ?? false);
            }}
          >
            <option value="">Choose an item</option>
            {page?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
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
        </div>
        <label>
          Declared expiry, ISO date (optional)
          <Input
            aria-label="Declared expiry"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            disabled={locked}
            placeholder="2027-01-01T00:00:00Z"
          />
        </label>
        <label>
          GitHub repository to validate (optional)
          <Input
            aria-label="Health GitHub repository"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            disabled={locked}
            placeholder="owner/repo"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={automatic}
            disabled={locked}
            onChange={(e) => setAutomatic(e.target.checked)}
          />{" "}
          Run checks automatically, at most every 15 minutes
        </label>
        <div className="flex flex-wrap gap-2">
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
                const result = await runVault(atoms.recheck, { environmentId, input: { itemId } });
                setNotice(vaultHealthRecheckMessage(result.outcome));
              })
            }
          >
            Check selected item
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked || !itemId}
            onClick={() => void act(() => apply({ action: "remove-rule", itemId }))}
          >
            Remove rule
          </Button>
        </div>
      </form>
    </div>
  );
}
