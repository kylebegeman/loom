import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { VAULT_APPROVAL_RETENTION_MS, type VaultApprovalChange } from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  supportsLoomFeature,
  VAULT_ACTION_LABELS,
  vaultApprovalState,
  vaultApprovalReviewQueue,
  vaultApprovalNotificationMessage,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { useVaultTime } from "./useVaultTime";
const access = createVaultAccessAtoms(connectionAtomRuntime);
export function VaultApprovalInbox({
  environmentId,
  canWrite,
  connected,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
  connected: boolean;
}) {
  const allowed = useAtomValue(access.approvalChange.permissionAtom(environmentId));
  const config = useEnvironmentServerConfig(environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-approvals")) return null;
  return (
    <Inbox
      key={`${environmentId}:${canWrite}:${connected}`}
      environmentId={environmentId}
      canWrite={canWrite && allowed}
      connected={connected}
    />
  );
}
function Inbox({
  environmentId,
  canWrite,
  connected,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
  connected: boolean;
}) {
  const query = useEnvironmentQuery(
    connected ? access.approvalInbox({ environmentId, input: {} }) : null,
  );
  const data = query.error ? null : query.data;
  const now = useVaultTime(
    data?.requests.flatMap((r) => [
      r.requestExpiresAt,
      r.approvedUntil,
      r.requestedAt + VAULT_APPROVAL_RETENTION_MS,
    ]) ?? [],
  );
  const change = useAtomCommand(access.approvalChange, { reportFailure: false });
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const review = vaultApprovalReviewQueue(data?.requests ?? [], now, filter);
  const [pending, setPending] = useState<VaultApprovalChange | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setPending(null);
    setError(null);
    query.refresh();
  };
  const submit = async (input: VaultApprovalChange) => {
    if (busy) return;
    setPending(input);
    setBusy(true);
    setError(null);
    try {
      const result = await change({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPending(null);
      query.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The decision could not be confirmed. Retry or refresh its status.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View accessibilityLabel="Vault approvals" className="gap-3">
      <Text className="font-semibold">Remote approvals</Text>
      <Text>
        Review temporary access for the exact thread, record, action and destination. Notification
        delivery is not connected. Approvals do not restart an operation.
      </Text>
      {!connected ? <Text>Reconnect this computer to view requests.</Text> : null}
      <Button label="Refresh requests" onPress={refresh} disabled={!connected || busy} />
      {query.isPending && !data ? <Text>Loading requests…</Text> : null}
      {error || query.error ? <Text accessibilityRole="alert">{error ?? query.error}</Text> : null}
      {pending && error ? (
        <Button
          label="Retry decision"
          onPress={() => void submit(pending)}
          disabled={!connected || busy || !canWrite}
        />
      ) : null}
      {data?.retention ? (
        <Text>
          Requests are retained for 24 hours, up to 128 entries. Automatic resumption and allow-once
          access remain disabled.
        </Text>
      ) : null}
      {data ? (
        <View className="gap-2">
          <Text>
            {review.pendingCount} pending of {review.totalCount} retained requests.
          </Text>
          <Button
            label={filter === "pending" ? "Show all requests" : "Show pending requests"}
            disabled={busy}
            onPress={() => setFilter(filter === "pending" ? "all" : "pending")}
          />
          {filter === "pending" && review.pendingCount === 0 && review.totalCount > 0 ? (
            <Text>
              No pending requests. Show all requests to review decisions or revoke an approval.
            </Text>
          ) : null}
        </View>
      ) : null}
      {data && review.totalCount === 0 ? (
        <Text>No access requests. An agent can request access with the Vault request tool.</Text>
      ) : null}
      {data &&
        review.requests.map((r) => {
          const state = vaultApprovalState(r, now);
          const decide = (
            decision: VaultApprovalChange["decision"],
            durationMs: 300000 | 900000 = 300000,
          ) =>
            void submit({
              id: r.id,
              operationId: uuidv4().replaceAll("-", ""),
              expectedRevision: r.revision,
              expectedPolicyRevision: data.policyRevision,
              decision,
              durationMs,
            });
          const disabled = !connected || !canWrite || busy || pending !== null;
          return (
            <View key={r.id} className="gap-2 rounded-lg border border-border p-3">
              <Text className="font-semibold">
                {VAULT_ACTION_LABELS[r.action]} · {state}
              </Text>
              <Text>
                Thread {r.threadId}
                {"\n"}Project {r.projectId}
                {"\n"}Record {r.itemId} · version {r.itemVersion}
                {"\n"}Destination {r.destination ?? "Any destination (unrestricted)"}
              </Text>
              <Text>
                {vaultApprovalNotificationMessage(
                  data.notificationOutcomes?.find((outcome) => outcome.requestId === r.id),
                  state,
                )}
              </Text>
              {r.waitingOperation ? (
                <Text>
                  Waiting operation {r.waitingOperation.operationId}
                  {"\n"}Run {r.waitingOperation.runId}. Explicit retry and a fresh access check are
                  required.
                </Text>
              ) : (
                <Text>No run-bound operation correlation was captured.</Text>
              )}
              <Text>
                Requested by {r.requestedBy}. {r.decidedBy ? `Decided by ${r.decidedBy}.` : ""}{" "}
                Expires {new Date(r.approvedUntil ?? r.requestExpiresAt).toLocaleString()}.
              </Text>
              {state === "pending" ? (
                <>
                  <Button
                    label="Approve for 5 minutes"
                    onPress={() => decide("approve")}
                    disabled={disabled}
                  />
                  <Button
                    label="Approve for 15 minutes"
                    onPress={() => decide("approve", 900000)}
                    disabled={disabled}
                  />
                  <Button label="Deny" onPress={() => decide("deny")} disabled={disabled} />
                  <Button
                    label="Cancel request"
                    onPress={() => decide("cancel")}
                    disabled={disabled}
                  />
                </>
              ) : null}
              {r.grantId && (state === "approved" || state === "expired") ? (
                <Button
                  label="Revoke approval"
                  onPress={() => decide("revoke")}
                  disabled={disabled}
                />
              ) : null}
            </View>
          );
        })}
    </View>
  );
}
