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
import { Switch, View } from "react-native";
import { createVaultCoreAtoms } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
const vault = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
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
  const originalQuery = useEnvironmentQuery(connected ? originalAtom : null),
    replacementQuery = useEnvironmentQuery(connected ? replacementAtom : null),
    itemsQuery = useEnvironmentQuery(connected ? listAtom : null);
  const original = originalQuery.isSuccess && !originalQuery.isPending ? originalQuery.data : null,
    replacement =
      replacementQuery.isSuccess && !replacementQuery.isPending ? replacementQuery.data : null,
    page = itemsQuery.isSuccess && !itemsQuery.isPending ? itemsQuery.data : null;
  const loading = originalQuery.isPending || replacementQuery.isPending;
  const readError = originalQuery.error || replacementQuery.error;
  const run = useAtomCommand(atoms.originalVerify, { reportFailure: false });
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
    await run({ environmentId, input })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        const next = result.value;
        if (next.receipt?.state !== "running" || next.freshness === "interrupted") setPending(null);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Response was lost. Refresh the original receipt before retrying.",
        );
      })
      .finally(() => setBusy(false));
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
    <View
      accessibilityLabel="Original route and recovery design"
      className="gap-3 rounded-lg border border-border p-3"
    >
      <Text className="font-semibold">Original development route</Text>
      <Text>
        Choose a separate original development SSH key already in Vault. The selected key must match
        the explicit user, host, port and exact repository path in the reviewed source. This cannot
        identify or use a personal SSH agent, default user, alias or surrounding shell identity.
      </Text>
      {loading ? <Text>Refreshing route evidence…</Text> : null}
      {readError ? (
        <Text accessibilityRole="alert">
          Could not inspect route evidence. Refresh before continuing.
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {!busy && !error && original ? (
        <>
          <Text>
            Original route evidence: {originalFreshness}. Ambient terminal authentication is not
            evaluated.
          </Text>
          {original.receipt ? (
            <Text>
              Selected identity {original.receipt.itemId}, version {original.receipt.itemVersion}.
              Last check {original.receipt.state}
              {original.receipt.failure ? ` (${original.receipt.failure})` : ""}.{" "}
              {original.receipt.validUntil
                ? `Evidence expires ${new Date(original.receipt.validUntil).toLocaleTimeString()}.`
                : ""}
            </Text>
          ) : (
            <Text>No original route has been verified.</Text>
          )}
        </>
      ) : null}
      <Text>Original development key</Text>
      {items.map((entry) => (
        <Button
          key={entry.id}
          label={`${selected === entry.id ? "Selected: " : ""}${entry.label} · version ${entry.version}`}
          disabled={busy || !connected || !canWrite}
          onPress={() => {
            setSelected(entry.id);
            setPending(null);
            setReviewed(false);
            setContact(false);
          }}
        />
      ))}
      {page && items.length === 0 ? (
        <Text>
          No separate active SSH key on this page. Import a dedicated original development key or
          create one in Vault, then refresh. A new key must have access to the original endpoint
          before verification can pass.
        </Text>
      ) : null}
      {itemsQuery.error ? (
        <Text accessibilityRole="alert">Could not load development keys.</Text>
      ) : null}
      {itemsQuery.isPending ? <Text>Loading keys…</Text> : null}
      <Button label="Refresh original keys" onPress={refreshItems} disabled={busy || !connected} />
      <Button
        label="First original keys"
        onPress={() => {
          setCursor(null);
          setSelected("");
        }}
        disabled={busy || !cursor}
      />
      <Button
        label="More original keys"
        onPress={() => {
          setCursor(page?.nextCursor ?? null);
          setSelected("");
        }}
        disabled={busy || !page?.nextCursor}
      />
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
      <Button
        label="Verify original development route"
        onPress={() => void verify()}
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
      />
      <Button
        label="Refresh original route evidence"
        onPress={refresh}
        disabled={busy || !connected}
      />{" "}
      <Text>
        These checks read repository refs only. Push access, workload grants and later provider
        revocation remain unknown. No configuration is captured or written. Cutover and rollback
        execution stay unavailable.
      </Text>
      {designInput && !busy && !error ? (
        <RecoveryDesign
          key={`${designInput.expectedOriginalOperationId}:${designInput.expectedReplacementOperationId}`}
          environmentId={environmentId}
          connected={connected}
          input={designInput}
        />
      ) : (
        <Text>
          The recovery design needs fresh successful original and replacement repository-read
          evidence. GitHub API evidence cannot qualify.
        </Text>
      )}
    </View>
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
    <View className="gap-3">
      <Button
        label="Preview recovery snapshot design"
        onPress={() => {
          refresh();
          setOpened(true);
        }}
        disabled={!connected}
      />
      {opened ? (
        <>
          <Button label="Close snapshot design" onPress={() => setOpened(false)} disabled={false} />
          <Design environmentId={environmentId} connected={connected} input={input} />
        </>
      ) : null}
    </View>
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
  const query = useEnvironmentQuery(
      connected ? atoms.recoveryPreview({ environmentId, input }) : null,
    ),
    data = query.isSuccess && !query.isPending ? query.data : null,
    loading = query.isPending,
    error = query.error;
  const refresh = () => query.refresh();
  const now = useVaultTime([data?.validUntil ?? null]);
  return (
    <View
      accessibilityLabel="Recovery snapshot design"
      className="gap-2 rounded-lg border border-border p-3"
    >
      {loading ? <Text>Checking snapshot prerequisites…</Text> : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {data && now >= data.validUntil ? (
        <Text>This design preview expired. Refresh both route receipts before continuing.</Text>
      ) : null}
      {data && now < data.validUntil ? (
        <>
          <Text className="font-semibold">Recovery snapshot design only</Text>
          <Text>
            {data.source.remote} · fetch entry {data.source.position + 1} · {data.source.gitPath}
          </Text>
          <Text>
            Original {data.original.itemId} and replacement {data.replacement.itemId} have
            independent repository-read evidence. Expires{" "}
            {new Date(data.validUntil).toLocaleTimeString()}. The old shell's actual key remains
            unidentified.
          </Text>
          <Text>
            Proposed capture: only the selected nonsecret fetch entry and managed route manifest,
            with explicit absence and multiple-value ordering. Private credentials remain
            references. Personal and global SSH settings are excluded.
          </Text>
          <Text>
            Proposed storage: the existing encrypted replacement ledger. Before a future write,
            resolve repository identity, capture the exact relevant preimage and persist intent.
            Record a postimage and reconcile interrupted outcomes against both hashes. Conflicts
            stop recovery and preserve evidence.
          </Text>
          <Text>
            No snapshot or restorable backup exists. The capture engine and protection against
            concurrent external writers are unresolved. Both routes and workload grants must be
            checked again before future execution. Cutover, rollback and configuration writes remain
            disabled.
          </Text>
        </>
      ) : null}
      <Button label="Refresh snapshot design" onPress={refresh} disabled={!connected || loading} />
    </View>
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
    <View>
      <Text>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={change} disabled={disabled} />
    </View>
  );
}
