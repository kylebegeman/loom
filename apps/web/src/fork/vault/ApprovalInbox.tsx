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
      <h3 className="text-base font-medium">Temporary access requests</h3>
      <p className="text-sm text-muted-foreground">
        These requests authorize one thread for 5 or 15 minutes. For ongoing GitHub access,
        configure projects in GitHub for agents. Approvals do not restart an operation.
      </p>
      <div>
        <Button size="sm-multiline" variant="outline" onClick={refresh} disabled={busy}>
          Refresh requests
        </Button>
      </div>
      {result._tag === "Initial" ? (
        <LoomSettingsNotice role="status">Loading requests…</LoomSettingsNotice>
      ) : null}
      {busy ? <LoomSettingsNotice role="status">Saving access decision…</LoomSettingsNotice> : null}
      {error || result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          {error ?? (result._tag === "Failure" ? String(Cause.squash(result.cause)) : null)}
        </LoomSettingsNotice>
      ) : null}
      {pending && error ? (
        <div>
          <Button
            size="sm-multiline"
            onClick={() => void submit(pending)}
            disabled={busy || !canWrite}
          >
            Retry decision
          </Button>
        </div>
      ) : null}
      {data?.retention && filter === "all" ? (
        <p className="text-sm text-muted-foreground">
          Requests are retained for 24 hours, up to 128 entries. Automatic resumption and allow-once
          access remain disabled.
        </p>
      ) : null}
      {data ? (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm">
            {review.pendingCount === 0
              ? "No pending temporary requests."
              : `${review.pendingCount} pending temporary ${review.pendingCount === 1 ? "request" : "requests"}.`}
          </p>
          {review.totalCount > review.pendingCount ? (
            <Button
              size="sm-multiline"
              variant="ghost"
              disabled={busy}
              onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
            >
              {filter === "pending"
                ? `Show request history (${review.totalCount - review.pendingCount})`
                : "Hide request history"}
            </Button>
          ) : null}
          {filter === "pending" && review.pendingCount === 0 && review.totalCount > 0 ? (
            <p className="text-sm">
              Previous decisions and cancelled requests are in request history.
            </p>
          ) : null}
        </div>
      ) : null}
      {data && review.totalCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Temporary requests appear here when an agent asks for access to a specific operation.
          Saved project access is managed above.
        </p>
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
              <h4 id={`vault-request-${r.id}`} className="break-words font-medium">
                {labels.item} · {VAULT_ACTION_LABELS[r.action]} · {state}
              </h4>
              <p className="break-words text-sm">
                {labels.thread} · {labels.project}
              </p>
              {state === "pending" && labels.warning ? (
                <p role="status" className="text-sm">
                  {labels.warning}
                </p>
              ) : null}
              <p className="break-words text-sm">
                {r.destination ?? "Any destination (unrestricted)"}
              </p>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Request details
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p className="break-all text-sm">
                    Thread {r.threadId} · Project {r.projectId}
                    <br />
                    Record {r.itemId} · version {r.itemVersion}
                    <br />
                    Destination {r.destination ?? "Any destination (unrestricted)"}
                  </p>
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
                </div>
              </details>
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
                    variant="outline"
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
