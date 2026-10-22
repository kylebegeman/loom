import { Checkbox } from "~/components/ui/checkbox";
import { VaultQueryFeedback } from "./SettingsFeedback";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
} from "../settings/parts";
import { useState } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  VaultReplacementPlan,
  VaultOriginalVerify,
  VaultRecoverySnapshotInput,
} from "@t3tools/contracts/fork";
import { migrationInventory as atoms } from "./migrationState";
import { useVaultTime } from "./useVaultTime";
import * as Cause from "effect/Cause";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { randomUUID } from "~/lib/utils";
import { vault, runVault } from "./state";
const newId = () => randomUUID().replaceAll("-", "");
export function OriginalRouteReview({
  environmentId,
  plan,
  connected = true,
}: {
  environmentId: EnvironmentId;
  plan: VaultReplacementPlan;
  connected?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [contact, setContact] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState<VaultOriginalVerify | null>(null);
  const canWrite = useAtomValue(atoms.originalVerify.permissionAtom(environmentId));
  const originalAtom = atoms.originalVerification({ environmentId, input: { id: plan.id } }),
    replacementAtom = atoms.verification({ environmentId, input: { id: plan.id } }),
    listAtom = vault.list({ environmentId, input: { cursor, includeArchived: false } });
  const refreshOriginal = useAtomRefresh(originalAtom),
    refreshReplacement = useAtomRefresh(replacementAtom),
    refreshItems = useAtomRefresh(listAtom);
  const originalQuery = useAtomValue(originalAtom),
    replacementQuery = useAtomValue(replacementAtom),
    itemsQuery = useAtomValue(listAtom);
  const original =
      originalQuery._tag === "Success" && !originalQuery.waiting ? originalQuery.value : null,
    replacement =
      replacementQuery._tag === "Success" && !replacementQuery.waiting
        ? replacementQuery.value
        : null,
    page = itemsQuery._tag === "Success" && !itemsQuery.waiting ? itemsQuery.value : null;
  const loading = originalQuery.waiting || replacementQuery.waiting;
  const readError = originalQuery._tag === "Failure" || replacementQuery._tag === "Failure";
  const items =
      page?.items.filter(
        (item) => item.kind === "ssh-key" && item.id !== plan.replacement.itemId,
      ) ?? [],
    item = items.find((item) => item.id === selected);
  const now = useVaultTime([
    plan.expiresAt,
    original?.receipt?.validUntil ?? null,
    replacement?.receipt?.validUntil ?? null,
    original?.receipt?.state === "running" ? original.receipt.deadlineAt : null,
  ]);
  const current = (status: typeof original | typeof replacement) =>
    status?.freshness === "current" &&
    status.planState === "reviewed" &&
    status.receipt?.validUntil != null &&
    now < status.receipt.validUntil &&
    plan.state === "reviewed" &&
    now < plan.expiresAt;
  const originalFreshness =
    original?.freshness === "running" && original.receipt && now >= original.receipt.deadlineAt
      ? "interrupted"
      : original?.freshness === "current" && !current(original)
        ? "expired or invalidated"
        : original?.freshness;
  const designInput =
    current(original) && current(replacement) && original?.receipt && replacement?.receipt
      ? {
          id: plan.id,
          expectedOriginalOperationId: original.receipt.operationId,
          expectedReplacementOperationId: replacement.receipt.operationId,
        }
      : null;
  const verify = async () => {
    if (busy || !connected || !canWrite || !reviewed || !contact || (!item && !pending)) return;
    const input = pending ?? {
      id: plan.id,
      operationId: newId(),
      expectedOperationId: original?.receipt?.operationId ?? null,
      original: { itemId: item!.id, expectedVersion: item!.version },
      developmentOnly: true as const,
      reviewedOriginalRoute: true as const,
      contactDestination: true as const,
    };
    setPending(input);
    setBusy(true);
    setError(null);
    setContact(false);
    setReviewed(false);
    try {
      const next = await runVault(atoms.originalVerify, { environmentId, input });
      if (next.receipt?.state !== "running" || next.freshness === "interrupted") setPending(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Response was lost. Refresh the original receipt before retrying.",
      );
    }
    setBusy(false);
  };
  const refresh = () => {
    setError(null);
    setPending(null);
    setContact(false);
    setReviewed(false);
    refreshOriginal();
    refreshReplacement();
  };
  return (
    <LoomSettingsDetails title="Original route and recovery planning">
      <section
        aria-label="Original route and recovery design"
        className="flex min-w-0 flex-col gap-5"
      >
        <h4 className="font-medium">Original development route</h4>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Choose a separate original development SSH key already in Vault. The selected key must
          match the explicit user, host, port and exact repository path in the reviewed source. This
          cannot identify or use a personal SSH agent, default user, alias or surrounding shell
          identity.
        </p>
        {loading ? (
          <LoomSettingsNotice role="status">Refreshing route evidence…</LoomSettingsNotice>
        ) : null}
        {readError ? (
          <LoomSettingsNotice role="alert">
            Could not inspect route evidence. Refresh before continuing.
          </LoomSettingsNotice>
        ) : null}
        {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
        {!busy && !error && original ? (
          <>
            <p>
              Original route evidence: {originalFreshness}. Ambient terminal authentication is not
              evaluated.
            </p>
            {original.receipt ? (
              <p>
                Selected identity {original.receipt.itemId}, version {original.receipt.itemVersion}.
                Last check {original.receipt.state}
                {original.receipt.failure ? ` (${original.receipt.failure})` : ""}.{" "}
                {original.receipt.validUntil
                  ? `Evidence expires ${new Date(original.receipt.validUntil).toLocaleTimeString()}.`
                  : ""}
              </p>
            ) : (
              <p>No original route has been verified.</p>
            )}
          </>
        ) : null}
        <LoomSettingsField label="Original development key">
          <Select
            value={selected}
            disabled={busy || !connected || !canWrite}
            onValueChange={(nextValue) => {
              if (nextValue === null) return;
              setSelected(nextValue);
              setPending(null);
              setReviewed(false);
              setContact(false);
            }}
          >
            <SelectTrigger aria-label="Original development key">
              <SelectValue>
                {item
                  ? `${item.label} · version ${item.version}`
                  : "Choose a separate development key"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">Choose a separate development key</SelectItem>
              {items.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label} · version {entry.version}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
        {page && items.length === 0 ? (
          <p>
            No separate active SSH key on this page. Import a dedicated original development key or
            create one in Vault, then refresh. A new key must have access to the original endpoint
            before verification can pass.
          </p>
        ) : null}
        <VaultQueryFeedback
          result={itemsQuery}
          loading="Loading original development keys…"
          error="Could not load development keys."
          onRetry={refreshItems}
        />
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={refreshItems}
            disabled={busy || !connected}
          >
            Refresh original keys
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => {
              setCursor(null);
              setSelected("");
            }}
            disabled={busy || !cursor}
          >
            First original keys
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => {
              setCursor(page?.nextCursor ?? null);
              setSelected("");
            }}
            disabled={busy || !page?.nextCursor}
          >
            More original keys
          </Button>
        </LoomSettingsActions>
        <Confirm
          label="I reviewed this original key and route. It is dedicated to development, separate from personal and production credentials."
          value={reviewed}
          change={setReviewed}
          disabled={busy || !connected || !canWrite || plan.state !== "reviewed"}
        />
        <Confirm
          label="Allow a repository-read verification using the selected original development key."
          value={contact}
          change={setContact}
          disabled={busy || !connected || !canWrite || plan.state !== "reviewed"}
        />
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => void verify()}
            disabled={
              busy ||
              !connected ||
              !canWrite ||
              !reviewed ||
              !contact ||
              (!item && !pending) ||
              plan.state !== "reviewed" ||
              now >= plan.expiresAt ||
              (!original && !pending) ||
              originalFreshness === "running"
            }
          >
            {busy ? "Verifying original route…" : "Verify original development route"}
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={refresh}
            disabled={busy || !connected}
          >
            Refresh original route evidence
          </Button>
        </LoomSettingsActions>
        <p>
          These checks read repository refs only. Push access, workload grants and later provider
          revocation remain unknown. No configuration is captured or written. Cutover and rollback
          execution stay unavailable.
        </p>
        {designInput && !busy && !error ? (
          <RecoveryDesign
            key={`${designInput.expectedOriginalOperationId}:${designInput.expectedReplacementOperationId}`}
            environmentId={environmentId}
            connected={connected}
            input={designInput}
          />
        ) : (
          <p>
            The recovery design needs fresh successful original and replacement repository-read
            evidence. GitHub API evidence cannot qualify.
          </p>
        )}
      </section>
    </LoomSettingsDetails>
  );
}
function RecoveryDesign({
  environmentId,
  connected,
  input,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  input: VaultRecoverySnapshotInput;
}) {
  const [opened, setOpened] = useState(false),
    atom = atoms.recoveryPreview({ environmentId, input }),
    refresh = useAtomRefresh(atom);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Button
        size="sm-multiline"
        variant="outline"
        onClick={() => {
          refresh();
          setOpened(true);
        }}
        disabled={!connected}
      >
        Preview recovery snapshot design
      </Button>
      {opened ? (
        <>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => setOpened(false)}
            disabled={false}
          >
            Close snapshot design
          </Button>
          <Design environmentId={environmentId} connected={connected} input={input} />
        </>
      ) : null}
    </div>
  );
}
function Design({
  environmentId,
  connected,
  input,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  input: VaultRecoverySnapshotInput;
}) {
  const atom = atoms.recoveryPreview({ environmentId, input }),
    query = useAtomValue(atom),
    data = query._tag === "Success" && !query.waiting ? query.value : null,
    loading = query.waiting;
  const cause = query._tag === "Failure" ? Cause.squash(query.cause) : null,
    error = cause
      ? cause instanceof Error
        ? cause.message
        : "Could not check the snapshot design."
      : null;
  const refresh = useAtomRefresh(atom);
  const now = useVaultTime([data?.validUntil ?? null]);
  return (
    <section
      aria-label="Recovery snapshot design"
      className="flex min-w-0 flex-col gap-4 rounded-lg bg-muted/30 p-4 wrap-anywhere"
    >
      {loading ? (
        <LoomSettingsNotice role="status">Checking snapshot prerequisites…</LoomSettingsNotice>
      ) : null}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {data && now >= data.validUntil ? (
        <LoomSettingsNotice role="status">
          This design preview expired. Refresh both route receipts before continuing.
        </LoomSettingsNotice>
      ) : null}
      {data && now < data.validUntil ? (
        <>
          <h5 className="font-medium">Recovery snapshot design only</h5>
          <p>
            {data.source.remote} · fetch entry {data.source.position + 1} · {data.source.gitPath}
          </p>
          <p>
            Original {data.original.itemId} and replacement {data.replacement.itemId} have
            independent repository-read evidence. Expires{" "}
            {new Date(data.validUntil).toLocaleTimeString()}. The old shell's actual key remains
            unidentified.
          </p>
          <LoomSettingsDetails title="Proposed capture and storage">
            <p>
              Proposed capture: only the selected nonsecret fetch entry and managed route manifest,
              with explicit absence and multiple-value ordering. Private credentials remain
              references. Personal and global SSH settings are excluded.
            </p>
            <p>
              Proposed storage: the existing encrypted replacement ledger. Before a future write,
              resolve repository identity, capture the exact relevant preimage and persist intent.
              Record a postimage and reconcile interrupted outcomes against both hashes. Conflicts
              stop recovery and preserve evidence.
            </p>
          </LoomSettingsDetails>
          <LoomSettingsNotice>
            No snapshot or restorable backup exists. The capture engine and protection against
            concurrent external writers are unresolved. Both routes and workload grants must be
            checked again before future execution. Cutover, rollback and configuration writes remain
            disabled.
          </LoomSettingsNotice>
        </>
      ) : null}
      <Button
        size="sm-multiline"
        variant="outline"
        onClick={refresh}
        disabled={!connected || loading}
      >
        Refresh snapshot design
      </Button>
    </section>
  );
}
function Confirm({
  label,
  value,
  change,
  disabled,
}: {
  label: string;
  value: boolean;
  change: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm leading-6">
      <Checkbox
        aria-label={label}

        checked={value}
        onCheckedChange={(checked) => change(checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
