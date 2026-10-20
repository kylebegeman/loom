import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultApprovalChange } from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  supportsLoomFeature,
  VAULT_ACTION_LABELS,
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
    data?.requests.flatMap((r) => [r.requestExpiresAt, r.approvedUntil]) ?? [],
  );
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
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Vault approvals" className="flex flex-col gap-3">
      <h3 className="font-medium">Remote approvals</h3>
      <p className="text-sm text-muted-foreground">
        Review temporary access for the exact thread, record, action and destination. Notification
        delivery is not connected. Approvals do not restart an operation.
      </p>
      <div>
        <Button variant="outline" onClick={refresh} disabled={busy}>
          Refresh requests
        </Button>
      </div>
      {result._tag === "Initial" ? <p>Loading requests…</p> : null}
      {error || result._tag === "Failure" ? (
        <p role="alert">
          {error ?? (result._tag === "Failure" ? String(Cause.squash(result.cause)) : null)}
        </p>
      ) : null}
      {pending && error ? (
        <div>
          <Button onClick={() => void submit(pending)} disabled={busy || !canWrite}>
            Retry decision
          </Button>
        </div>
      ) : null}
      {data?.requests.length === 0 ? (
        <p>No access requests. An agent can request access with the Vault request tool.</p>
      ) : null}
      {data?.requests.map((r) => {
        const state =
          (r.state === "pending" && now >= r.requestExpiresAt) ||
          (r.state === "approved" && r.approvedUntil !== null && now >= r.approvedUntil)
            ? "expired"
            : r.state;
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
          <article key={r.id} className="flex flex-col gap-2 rounded-md border p-3">
            <p className="font-medium">
              {VAULT_ACTION_LABELS[r.action]} · {state}
            </p>
            <p className="break-all text-sm">
              Thread {r.threadId} · Project {r.projectId}
              <br />
              Record {r.itemId} · version {r.itemVersion}
              <br />
              Destination {r.destination ?? "Any destination (unrestricted)"}
            </p>
            <p className="text-sm">
              Requested by {r.requestedBy}. {r.decidedBy ? `Decided by ${r.decidedBy}.` : ""}{" "}
              Expires {new Date(r.approvedUntil ?? r.requestExpiresAt).toLocaleString()}.
            </p>
            <div className="flex flex-wrap gap-2">
              {state === "pending" ? (
                <>
                  <Button
                    disabled={!canWrite || busy || pending !== null}
                    onClick={() => decide("approve")}
                  >
                    Approve for 5 minutes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!canWrite || busy || pending !== null}
                    onClick={() => decide("approve", 900000)}
                  >
                    Approve for 15 minutes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!canWrite || busy || pending !== null}
                    onClick={() => decide("deny")}
                  >
                    Deny
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!canWrite || busy || pending !== null}
                    onClick={() => decide("cancel")}
                  >
                    Cancel request
                  </Button>
                </>
              ) : null}
              {r.grantId && (state === "approved" || state === "expired") ? (
                <Button
                  variant="outline"
                  disabled={!canWrite || busy || pending !== null}
                  onClick={() => decide("revoke")}
                >
                  Revoke approval
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
