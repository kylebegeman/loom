import { LoomSettingsActions, LoomSettingsNotice } from "../settings/parts";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { VAULT_APPROVAL_RETENTION_MS, type VaultApprovalChange } from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  supportsLoomFeature,
  VAULT_ACTION_LABELS,
  vaultApprovalState,
  vaultApprovalReviewLabels,
  vaultApprovalReviewQueue,
  vaultApprovalNotificationMessage,
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
import { useVaultTime } from "./useVaultTime";
const access = createVaultAccessAtoms(connectionAtomRuntime);
export function VaultApprovalInbox({
  environmentId,
  canWrite,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
}) {
  const allowed = useAtomValue(access.approvalChange.permissionAtom(environmentId));
  const configs = useServerConfigs();
  if (!supportsLoomFeature(configs.get(environmentId)?.environment.capabilities, "vault-approvals"))
    return null;
  return (
    <Inbox
      key={`${environmentId}:${canWrite}`}
      environmentId={environmentId}
      canWrite={canWrite && allowed}
    />
  );
}
function Inbox({ environmentId, canWrite }: { environmentId: EnvironmentId; canWrite: boolean }) {
  const query = access.approvalInbox({ environmentId, input: {} }),
    result = useAtomValue(query);
  const data = result._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(result));
  const now = useVaultTime(
    data?.requests.flatMap((r) => [
      r.requestExpiresAt,
      r.approvedUntil,
      r.requestedAt + VAULT_APPROVAL_RETENTION_MS,
    ]) ?? [],
  );
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const review = vaultApprovalReviewQueue(data?.requests ?? [], now, filter);
  const [pending, setPending] = useState<VaultApprovalChange | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setPending(null);
    setError(null);
    appAtomRegistry.refresh(query);
  };
  const submit = async (input: VaultApprovalChange) => {
    if (busy) return;
    setPending(input);
    setBusy(true);
    setError(null);
    try {
      await runVault(access.approvalChange, { environmentId, input });
      setPending(null);
      appAtomRegistry.refresh(query);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The decision could not be confirmed. Retry or refresh its status.",
      );
    }
    setBusy(false);
  };
  return (
    <section
      aria-label="Vault approvals"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-5 sm:p-6"
    >
      <h3 className="text-base font-medium">Remote approvals</h3>
      <p className="text-sm text-muted-foreground">
        Review temporary access for the exact thread, record, action and destination. Notification
        delivery is not connected. Approvals do not restart an operation.
      </p>
      <LoomSettingsActions>
        <Button size="sm-multiline" variant="outline" onClick={refresh} disabled={busy}>
          Refresh requests
        </Button>
      </LoomSettingsActions>
      {result._tag === "Initial" ? (
        <LoomSettingsNotice role="status">Loading requests…</LoomSettingsNotice>
      ) : null}
      {error || result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          {error ?? (result._tag === "Failure" ? String(Cause.squash(result.cause)) : null)}
        </LoomSettingsNotice>
      ) : null}
      {busy ? <LoomSettingsNotice role="status">Saving access decision…</LoomSettingsNotice> : null}
      {pending && error ? (
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            onClick={() => void submit(pending)}
            disabled={busy || !canWrite}
          >
            Retry decision
          </Button>
        </LoomSettingsActions>
      ) : null}
      {data?.retention ? (
        <p className="text-sm text-muted-foreground">
          Requests are retained for 24 hours, up to 128 entries. Automatic resumption and allow-once
          access remain disabled.
        </p>
      ) : null}
      {data ? (
        <div className="flex flex-col items-start gap-2">
          <LoomSettingsNotice role="status">
            {review.pendingCount} pending of {review.totalCount} retained requests.
          </LoomSettingsNotice>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={busy}
            onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
          >
            {filter === "pending" ? "Show all requests" : "Show pending requests"}
          </Button>
          {filter === "pending" && review.pendingCount === 0 && review.totalCount > 0 ? (
            <p className="text-sm">
              No pending requests. Show all requests to review decisions or revoke an approval.
            </p>
          ) : null}
        </div>
      ) : null}
      {data && review.totalCount === 0 ? (
        <p>No access requests. An agent can request access with the Vault request tool.</p>
      ) : null}
      {data &&
        review.requests.map((r) => {
          const state = vaultApprovalState(r, now);
          const labels = vaultApprovalReviewLabels(
            r,
            data.reviewContext?.find((c) => c.requestId === r.id),
          );
          const decide = (
            decision: VaultApprovalChange["decision"],
            durationMs: 300000 | 900000 = 300000,
          ) =>
            void submit({
              id: r.id,
              operationId: randomUUID().replaceAll("-", ""),
              expectedRevision: r.revision,
              expectedPolicyRevision: data.policyRevision,
              decision,
              durationMs,
            });
          return (
            <article
              key={r.id}
              aria-labelledby={`vault-request-${r.id}`}
              className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-3 text-sm leading-relaxed wrap-anywhere sm:p-4"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h4 id={`vault-request-${r.id}`} className="wrap-anywhere text-sm font-medium">
                    {labels.item}
                  </h4>
                  <p className="text-sm text-muted-foreground">{VAULT_ACTION_LABELS[r.action]}</p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">{state}</span>
              </div>
              <p className="break-words text-sm">
                {labels.thread} · {labels.project}
              </p>
              {state === "pending" && labels.warning ? (
                <LoomSettingsNotice role="status">{labels.warning}</LoomSettingsNotice>
              ) : null}
              <dl className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs text-muted-foreground">Thread</dt>
                  <dd>{r.threadId}</dd>
                </div>
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs text-muted-foreground">Project</dt>
                  <dd>{r.projectId}</dd>
                </div>
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs text-muted-foreground">Record</dt>
                  <dd>
                    {r.itemId} · version {r.itemVersion}
                  </dd>
                </div>
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs text-muted-foreground">Destination</dt>
                  <dd>{r.destination ?? "Any destination (unrestricted)"}</dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                {vaultApprovalNotificationMessage(
                  data.notificationOutcomes?.find((outcome) => outcome.requestId === r.id),
                  state,
                )}
              </p>
              {r.waitingOperation ? (
                <p className="break-all text-sm">
                  Waiting operation {r.waitingOperation.operationId}
                  <br />
                  Run {r.waitingOperation.runId}. Explicit retry and a fresh access check are
                  required.
                </p>
              ) : (
                <p className="text-sm">No run-bound operation correlation was captured.</p>
              )}
              <p className="text-sm">
                Requested by {r.requestedBy}. {r.decidedBy ? `Decided by ${r.decidedBy}.` : ""}{" "}
                Expires {new Date(r.approvedUntil ?? r.requestExpiresAt).toLocaleString()}.
              </p>
              <LoomSettingsActions>
                {state === "pending" ? (
                  <>
                    <Button
                      size="sm-multiline"
                      disabled={!canWrite || busy || pending !== null || labels.approvalBlocked}
                      aria-label={`Approve for 5 minutes: ${labels.accessibleContext}`}
                      onClick={() => decide("approve")}
                    >
                      Approve for 5 minutes
                    </Button>
                    <Button
                      size="sm-multiline"
                      variant="outline"
                      disabled={!canWrite || busy || pending !== null || labels.approvalBlocked}
                      aria-label={`Approve for 15 minutes: ${labels.accessibleContext}`}
                      onClick={() => decide("approve", 900000)}
                    >
                      Approve for 15 minutes
                    </Button>
                    <Button
                      size="sm-multiline"
                      variant="outline"
                      disabled={!canWrite || busy || pending !== null}
                      aria-label={`Deny for ${labels.accessibleContext}`}
                      onClick={() => decide("deny")}
                    >
                      Deny
                    </Button>
                    <Button
                      size="sm-multiline"
                      variant="ghost"
                      disabled={!canWrite || busy || pending !== null}
                      aria-label={`Cancel request for ${labels.accessibleContext}`}
                      onClick={() => decide("cancel")}
                    >
                      Cancel request
                    </Button>
                  </>
                ) : null}
                {r.grantId && (state === "approved" || state === "expired") ? (
                  <Button
                    size="sm-multiline"
                    variant="destructive-outline"
                    disabled={!canWrite || busy || pending !== null}
                    aria-label={`Revoke approval for ${labels.accessibleContext}`}
                    onClick={() => decide("revoke")}
                  >
                    Revoke approval
                  </Button>
                ) : null}
              </LoomSettingsActions>
            </article>
          );
        })}
    </section>
  );
}
