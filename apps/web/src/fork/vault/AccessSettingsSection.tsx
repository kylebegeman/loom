import { VaultApprovalInbox } from "./ApprovalInbox";
import { useVaultTime } from "./useVaultTime";
import { vaultAccessTarget } from "./access-navigation";
import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import {
  VaultAccessAction,
  type VaultGrant,
  type VaultGrantMutation,
  type VaultGrantPreview,
  VaultGrantDefinition,
  type VaultAccessExplanation,
  type VaultReadinessReport,
  type VaultAccessCatalog,
} from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  VAULT_ACTION_LABELS,
  vaultGrantExpiry,
  vaultDecisionMessage,
  vaultReadinessIsStale,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { vault, runVault } from "./state";
const access = createVaultAccessAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
const decodeDefinition = Schema.decodeUnknownOption(VaultGrantDefinition);
const data = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  Option.getOrNull(AsyncResult.value(result));
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The Vault access operation failed. Refresh and try again.";
const failure = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  result._tag === "Failure" ? message(Cause.squash(result.cause)) : null;

export function VaultAccessSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-grants",
    )
  )
    return (
      <p className="text-sm text-muted-foreground">
        Vault access management needs a server with grant support.
      </p>
    );
  if (!canRead)
    return <p className="text-sm">Your connection does not include Vault inspection.</p>;
  return (
    <AccessManager
      key={`${environment.environmentId}:${canWrite}`}
      environmentId={environment.environmentId}
      canWrite={canWrite}
    />
  );
}
function AccessManager({
  environmentId,
  canWrite,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
}) {
  const target = useAtomValue(vaultAccessTarget);
  const initial = target?.environmentId === environmentId ? target : null;
  const snapshotAtom = access.snapshot({ environmentId, input: {} });
  const catalogAtom = access.catalog({ environmentId, input: {} });
  const snapshotResult = useAtomValue(snapshotAtom),
    catalogResult = useAtomValue(catalogAtom);
  const snapshot = data(snapshotResult),
    catalog = data(catalogResult);
  const grantTime = useVaultTime(
    snapshot?.grants.flatMap((grant) => [grant.definition.notBefore, grant.definition.expiresAt]) ??
      [],
  );
  const [editing, setEditing] = useState<VaultGrant | "new" | null>(null);
  const [pending, setPending] = useState<{
    input: VaultGrantMutation;
    preview: VaultGrantPreview;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setPending(null);
    appAtomRegistry.refresh(snapshotAtom);
    appAtomRegistry.refresh(catalogAtom);
  };
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const preview = (input: VaultGrantMutation) =>
    act(async () => {
      const result = await runVault(access.preview, { environmentId, input });
      setPending({ input, preview: result });
    });
  const apply = () =>
    act(async () => {
      if (!pending) return;
      await runVault(access.apply, { environmentId, input: pending.input });
      setPending(null);
      setEditing(null);
      refresh();
    });
  const grantLabel = (grant: VaultGrant) =>
    catalog?.subjects.find(
      (subject) =>
        subject.principal.kind === grant.definition.principal.kind &&
        subject.principal.id === grant.definition.principal.id,
    )?.label ?? grant.definition.principal.id;
  return (
    <div className="flex flex-col gap-5">
      <VaultApprovalInbox environmentId={environmentId} canWrite={canWrite} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">Choose who may inspect, manage or use development records.</p>
          <p className="text-sm text-muted-foreground">
            Every thread starts without access. Project grants cover all threads in that project.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
            Refresh access
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || busy || pending !== null || !snapshot || !catalog}
            onClick={() => setEditing("new")}
          >
            Add grant
          </Button>
        </div>
      </div>
      {error || failure(snapshotResult) || failure(catalogResult) ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error ?? failure(snapshotResult) ?? failure(catalogResult)}
        </p>
      ) : null}
      {!snapshot ? (
        <p role="status" className="text-sm">
          Loading access policy…
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Policy revision {snapshot.revision}. Changes use this revision to protect newer edits.
          </p>
          {snapshot.grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grants yet. Add one for a thread or project, then check its access below.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {snapshot.grants.map((grant) => (
                <div key={grant.definition.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{grant.definition.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {grant.definition.principal.kind === "project"
                          ? "All threads in"
                          : "Thread"}{" "}
                        {grantLabel(grant)}
                      </p>
                    </div>
                    <span className="text-sm">{vaultGrantExpiry(grant, grantTime)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {grant.definition.itemIds.length} selected items.{" "}
                    {grant.definition.actions
                      .map((action) => VAULT_ACTION_LABELS[action])
                      .join(", ")}
                    .{" "}
                    {grant.definition.destination
                      ? `Destination: ${grant.definition.destination}`
                      : "Any destination within the project scope."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {grant.definition.expiresAt === null
                      ? "No expiry"
                      : `Expires ${new Date(grant.definition.expiresAt).toLocaleString()}`}
                    {grant.definition.parentId
                      ? `; inherits from ${grant.definition.parentId}`
                      : ""}
                  </p>
                  {grant.state !== "revoked" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!canWrite || busy || pending !== null}
                        onClick={() => setEditing(grant)}
                      >
                        Edit grant
                      </Button>
                      {(
                        [grant.state === "active" ? "suspended" : "active", "revoked"] as const
                      ).map((state) => (
                        <Button
                          key={state}
                          size="xs"
                          variant="ghost"
                          disabled={!canWrite || busy || pending !== null}
                          onClick={() =>
                            void preview({
                              operationId: newId(),
                              expectedRevision: snapshot.revision,
                              change: { type: "state", id: grant.definition.id, state },
                            })
                          }
                        >
                          {state === "revoked"
                            ? "Preview revocation"
                            : state === "active"
                              ? "Preview resume"
                              : "Preview suspension"}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Revocation is permanent. Create a new grant to restore access deliberately.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {pending && (
            <div
              className="flex flex-col gap-3 rounded-lg bg-muted p-4"
              role="region"
              aria-label="Grant change preview"
            >
              <p className="text-sm font-medium">Review {pending.preview.grant.definition.label}</p>
              <p className="text-sm">
                {pending.input.change.type === "state"
                  ? `Set grant to ${pending.input.change.state}.`
                  : "Save the selected principal, items, actions and time window."}{" "}
                {pending.preview.affectedGrantIds.length} known grant relationships and{" "}
                {pending.preview.knownItemIds.length} item references are affected.
              </p>
              {pending.preview.unknowns.map((text) => (
                <p key={text} className="text-xs text-muted-foreground">
                  {text}
                </p>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  Abandon preview
                </Button>
                <Button size="sm" disabled={!canWrite || busy} onClick={() => void apply()}>
                  {busy ? "Applying…" : "Apply reviewed change"}
                </Button>
              </div>
            </div>
          )}
          <AccessCheck
            key={`${initial?.itemId ?? ""}:${initial?.threadId ?? ""}`}
            environmentId={environmentId}
            catalog={catalog}
            initialItemId={initial?.itemId ?? ""}
            initialThreadId={initial?.threadId ?? ""}
            policyRevision={snapshot.revision}
          />
          <details>
            <summary className="cursor-pointer text-sm">
              Recent access decisions and policy changes
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {snapshot.audit.length === 0 ? (
                <p className="text-sm">No recorded decisions.</p>
              ) : (
                snapshot.audit.map((event) => (
                  <p key={event.id} className="break-words text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()} · {event.actor} · {event.type} ·{" "}
                    {event.reason} · policy {event.policyRevision}
                  </p>
                ))
              )}
              <p className="text-xs text-muted-foreground">
                {snapshot.omittedAuditEvents} older events omitted. History is bounded and records
                authorization decisions, not successful external logins.
              </p>
            </div>
          </details>
        </>
      )}
      {editing !== null && catalog && snapshot ? (
        <GrantEditor
          key={editing === "new" ? "new" : editing.definition.id}
          environmentId={environmentId}
          catalog={catalog}
          grant={editing === "new" ? null : editing}
          revision={snapshot.revision}
          disabled={!canWrite || busy}
          onClose={() => setEditing(null)}
          onPreview={(input) => {
            void preview(input);
          }}
          previewOpen={pending !== null}
          previewError={error}
        />
      ) : null}
    </div>
  );
}
const localDate = (milliseconds: number) =>
  new Date(milliseconds - new Date(milliseconds).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, -1);
function GrantEditor({
  environmentId,
  catalog,
  grant,
  revision,
  disabled,
  onClose,
  onPreview,
  previewOpen,
  previewError,
}: {
  environmentId: EnvironmentId;
  catalog: VaultAccessCatalog;
  grant: VaultGrant | null;
  revision: number;
  disabled: boolean;
  onClose: () => void;
  onPreview: (input: VaultGrantMutation) => void;
  previewOpen: boolean;
  previewError: string | null;
}) {
  const [id] = useState(() => grant?.definition.id ?? newId());
  const [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(grant?.definition.label ?? "");
  const [principal, setPrincipal] = useState(
    grant ? `${grant.definition.principal.kind}:${grant.definition.principal.id}` : "",
  );
  const [items, setItems] = useState<readonly string[]>(grant?.definition.itemIds ?? []);
  const [actions, setActions] = useState<readonly VaultAccessAction[]>(
    grant?.definition.actions ?? ["inspect", "manage"],
  );
  const [destination, setDestination] = useState(grant?.definition.destination ?? "");
  const [start, setStart] = useState(() => localDate(grant?.definition.notBefore ?? Date.now()));
  const [expiry, setExpiry] = useState(() =>
    localDate(grant?.definition.expiresAt ?? Date.now() + 86_400_000),
  );
  const [noExpiry, setNoExpiry] = useState(grant !== null && grant.definition.expiresAt === null);
  const [futureItem, setFutureItem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const itemAtom = vault.list({ environmentId, input: { cursor, includeArchived: true } });
  const itemResult = useAtomValue(itemAtom);
  const page = data(itemResult);
  const changed = () => {
    setOperationId(newId());
    setError(null);
  };
  const submit = () => {
    const subject = catalog.subjects.find(
      (value) => `${value.principal.kind}:${value.principal.id}` === principal,
    );
    const decoded = decodeDefinition({
      id,
      label,
      principal: subject?.principal ?? grant?.definition.principal,
      projectId: subject?.projectId ?? grant?.definition.projectId ?? null,
      itemIds: items,
      actions,
      destination: destination.trim() || null,
      notBefore: new Date(start).getTime(),
      expiresAt: noExpiry ? null : new Date(expiry).getTime(),
      parentId: grant?.definition.parentId ?? null,
    });
    if (Option.isNone(decoded)) {
      setError("Choose a principal, at least one item and action, and a valid access window.");
      return;
    }
    onPreview({
      operationId,
      expectedRevision: revision,
      change: { type: "save", grant: decoded.value },
    });
  };
  return (
    <Dialog
      open={!previewOpen}
      onOpenChange={(open) => {
        if (!open && !disabled) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{grant ? "Edit access grant" : "Add access grant"}</DialogTitle>
          <DialogDescription>
            Choose exact items and actions. Credential delivery still requires a supported broker.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-2 text-sm">
            Grant name
            <Input
              autoFocus
              value={label}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => {
                setLabel(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Thread or project
            <select
              className="rounded-md border border-input bg-background p-2"
              value={principal}
              disabled={disabled}
              onChange={(event) => {
                setPrincipal(event.target.value);
                changed();
              }}
            >
              <option value="">Select a workload</option>
              {grant &&
              !catalog.subjects.some(
                (value) => `${value.principal.kind}:${value.principal.id}` === principal,
              ) ? (
                <option value={principal}>
                  {grant.definition.principal.kind}: {grant.definition.principal.id}
                </option>
              ) : null}
              {catalog.subjects.map((subject) => (
                <option
                  key={`${subject.principal.kind}:${subject.principal.id}`}
                  value={`${subject.principal.kind}:${subject.principal.id}`}
                >
                  {subject.principal.kind === "project" ? "All project threads" : "Thread"}:{" "}
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
          {catalog.truncated ? (
            <p className="text-xs text-muted-foreground">
              The workload picker is limited to 250 projects and 250 threads. The CLI supports exact
              identities.
            </p>
          ) : null}
          <fieldset disabled={disabled} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm">Selected items ({items.length}/32)</legend>
            {itemResult.waiting ? (
              <p role="status" className="text-sm">
                Loading items…
              </p>
            ) : null}
            {page?.items.length === 0 && !itemResult.waiting ? (
              <p className="text-sm">
                No items on this page. Add a Vault item or preauthorize an item ID below.
              </p>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => appAtomRegistry.refresh(itemAtom)}
            >
              Refresh items
            </Button>
            {page?.items.map((item) => (
              <label key={item.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={items.includes(item.id)}
                  disabled={!items.includes(item.id) && items.length >= 32}
                  onChange={(event) => {
                    setItems((previous) =>
                      event.target.checked
                        ? [...previous, item.id]
                        : previous.filter((id) => id !== item.id),
                    );
                    changed();
                  }}
                />
                {item.label}
                {item.state !== "active" ? ` (${item.state})` : ""}
              </label>
            ))}
            {failure(itemResult) ? (
              <p role="alert" className="text-sm">
                {failure(itemResult)}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={cursor === null}
                onClick={() => setCursor(null)}
              >
                First items
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!page?.nextCursor}
                onClick={() => {
                  if (page?.nextCursor) setCursor(page.nextCursor);
                }}
              >
                Next items
              </Button>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              Selected IDs: {items.join(", ") || "None"}
            </p>
            <div className="flex gap-2">
              <Input
                aria-label="Additional item ID"
                placeholder="Existing or pre-authorized item ID"
                value={futureItem}
                onChange={(event) => setFutureItem(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!/^[a-f0-9]{32}$/.test(futureItem) || items.length >= 32}
                onClick={() => {
                  setItems((previous) => [...new Set([...previous, futureItem])]);
                  setFutureItem("");
                  changed();
                }}
              >
                Add ID
              </Button>
            </div>
            {items.some((id) => !page?.items.some((item) => item.id === id)) ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setItems([]);
                  changed();
                }}
              >
                Clear selected items
              </Button>
            ) : null}
          </fieldset>
          <fieldset disabled={disabled} className="flex flex-wrap gap-3">
            <legend className="mb-2 text-sm">Allowed actions</legend>
            {VaultAccessAction.literals.map((action) => (
              <label key={action} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={actions.includes(action)}
                  onChange={(event) => {
                    setActions((previous) =>
                      event.target.checked
                        ? [...previous, action]
                        : previous.filter((value) => value !== action),
                    );
                    changed();
                  }}
                />
                {VAULT_ACTION_LABELS[action]}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Use, reveal and export grants do not enable a delivery channel by themselves. Delegate
            lets this workload pass a narrower grant to a real subagent.
          </p>
          <label className="flex flex-col gap-2 text-sm">
            Exact destination, optional
            <Input
              placeholder="Leave empty for any destination in scope"
              value={destination}
              maxLength={2048}
              disabled={disabled}
              onChange={(event) => {
                setDestination(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Starts
            <Input
              type="datetime-local"
              step="0.001"
              value={start}
              disabled={disabled}
              onChange={(event) => {
                setStart(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={noExpiry}
              disabled={disabled}
              onChange={(event) => {
                setNoExpiry(event.target.checked);
                changed();
              }}
            />
            No expiry
          </label>
          {!noExpiry ? (
            <label className="flex flex-col gap-2 text-sm">
              Expires
              <Input
                type="datetime-local"
                step="0.001"
                value={expiry}
                disabled={disabled}
                onChange={(event) => {
                  setExpiry(event.target.value);
                  changed();
                }}
              />
            </label>
          ) : null}
          {error || previewError ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error ?? previewError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              Preview grant
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
function AccessCheck({
  environmentId,
  catalog,
  initialItemId,
  initialThreadId,
  policyRevision,
}: {
  environmentId: EnvironmentId;
  catalog: VaultAccessCatalog | null;
  initialItemId: string;
  initialThreadId: string;
  policyRevision: number;
}) {
  const [thread, setThread] = useState(initialThreadId);
  const [itemId, setItemId] = useState(initialItemId);
  const [cursor, setCursor] = useState<string | null>(null);
  const itemPage = data(
    useAtomValue(vault.list({ environmentId, input: { cursor, includeArchived: true } })),
  );
  const [action, setAction] = useState<VaultAccessAction>("manage");
  const [destination, setDestination] = useState("");
  const [explanation, setExplanation] = useState<VaultAccessExplanation | null>(null);
  const [report, setReport] = useState<VaultReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => () => controller?.abort(), [controller]);
  const [error, setError] = useState<string | null>(null);
  const checkedTime = useVaultTime([report?.freshUntil ?? null]);
  const policyChanged =
    explanation !== null && explanation.decision.policyRevision !== policyRevision;
  const changed = () => {
    setExplanation(null);
    setReport(null);
    setError(null);
  };
  const check = async () => {
    if (busy) return;
    const cancellation = new AbortController();
    setController(cancellation);
    setBusy(true);
    setReport(null);
    setExplanation(null);
    setError(null);
    try {
      const input = {
        threadId: ThreadId.make(thread),
        itemId,
        action,
        destination: destination.trim() || null,
      };
      const options = {
        signal: cancellation.signal,
        refresh: true,
        reportFailure: false,
        reportDefect: false,
      };
      const result = await executeAtomQuery(
        appAtomRegistry,
        access.explain.resultAtom({ environmentId, input }),
        options,
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setExplanation(result.value);
      const readiness = await executeAtomQuery(
        appAtomRegistry,
        access.readiness.resultAtom({
          environmentId,
          input: {
            threadId: input.threadId,
            requirements: [{ itemId, action, destination: input.destination }],
          },
        }),
        options,
      );
      if (readiness._tag === "Failure") throw squashAtomCommandFailure(readiness);
      setReport(readiness.value);
    } catch (cause) {
      setError(
        cancellation.signal.aborted
          ? "Check cancelled. Run it again for a fresh result."
          : message(cause),
      );
    } finally {
      setController(null);
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
      <p className="text-sm font-medium">Why this access?</p>
      <p className="text-sm text-muted-foreground">
        Check the actual thread context. A grant alone does not prove an external service is
        reachable.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        Thread
        <select
          className="rounded-md border border-input bg-background p-2"
          value={thread}
          disabled={busy}
          onChange={(event) => {
            setThread(event.target.value);
            changed();
          }}
        >
          <option value="">Select a thread</option>
          {catalog?.subjects
            .filter((subject) => subject.principal.kind === "thread")
            .map((subject) => (
              <option key={subject.principal.id} value={subject.principal.id}>
                {subject.label}
              </option>
            ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        Item
        <select
          className="rounded-md border border-input bg-background p-2"
          value={itemPage?.items.some((item) => item.id === itemId) ? itemId : ""}
          disabled={busy}
          onChange={(event) => {
            setItemId(event.target.value);
            changed();
          }}
        >
          <option value="">Select an item on this page</option>
          {itemPage?.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy || cursor === null}
          onClick={() => setCursor(null)}
        >
          First items
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !itemPage?.nextCursor}
          onClick={() => {
            if (itemPage?.nextCursor) setCursor(itemPage.nextCursor);
          }}
        >
          Next items
        </Button>
      </div>
      <label className="flex flex-col gap-2 text-sm">
        Item ID
        <Input
          value={itemId}
          disabled={busy}
          onChange={(event) => {
            setItemId(event.target.value);
            changed();
          }}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        Action
        <select
          className="rounded-md border border-input bg-background p-2"
          value={action}
          disabled={busy}
          onChange={(event) => {
            setAction(event.target.value as VaultAccessAction);
            changed();
          }}
        >
          {VaultAccessAction.literals.map((value) => (
            <option key={value} value={value}>
              {VAULT_ACTION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        Exact destination, optional
        <Input
          value={destination}
          disabled={busy}
          onChange={(event) => {
            setDestination(event.target.value);
            changed();
          }}
        />
      </label>
      <div>
        <Button
          size="sm"
          disabled={busy || !thread || !/^[a-f0-9]{32}$/.test(itemId)}
          onClick={() => void check()}
        >
          {busy ? "Checking…" : "Explain and check readiness"}
        </Button>
      </div>
      {busy ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => controller?.abort()}>
            Cancel access check
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {policyChanged ? (
        <p role="status" className="text-sm">
          Policy changed after this check. Run it again for the current decision.
        </p>
      ) : null}
      {explanation && !policyChanged ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-sm">
            {explanation.decision.allowed ? "Allowed by policy" : "Denied by policy"}:{" "}
            {vaultDecisionMessage(explanation.decision.reason)} Policy revision{" "}
            {explanation.decision.policyRevision}.
          </p>
          {explanation.decision.grantId ? (
            <p className="break-all text-xs">
              Grant {explanation.decision.grantId}, revision {explanation.decision.grantRevision}.
              Lineage: {explanation.decision.lineage.join(", ")}
            </p>
          ) : null}
          {explanation.unknowns.map((text) => (
            <p key={text} className="text-xs text-muted-foreground">
              {text}
            </p>
          ))}
        </div>
      ) : null}
      {report && !policyChanged ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {vaultReadinessIsStale(report, checkedTime)
              ? "Stale readiness result"
              : report.ready
                ? "Policy and connection checks passed"
                : "Not ready for the requested operation"}
            . Checked in Loom server context at {new Date(report.checkedAt).toLocaleTimeString()};
            valid until {new Date(report.freshUntil).toLocaleTimeString()}.
          </p>
          {report.checks.map((check) => (
            <p key={check.id} className="text-xs text-muted-foreground">
              {check.state}: {vaultDecisionMessage(check.reason)}{" "}
              {check.state === "passed" ? "" : check.repair}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
