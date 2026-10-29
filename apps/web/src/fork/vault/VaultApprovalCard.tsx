import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  VAULT_APPROVAL_CARDS_FEATURE,
  type VaultApprovalCardData,
  type VaultApprovalChange,
} from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  supportsLoomFeature,
  VAULT_ACTION_LABELS,
  VAULT_KIND_LABELS,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useAtomCommand } from "~/state/use-atom-command";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";

const access = createVaultAccessAtoms(connectionAtomRuntime);

export function VaultApprovalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: VaultApprovalCardData;
}) {
  const configs = useServerConfigs();
  const supported = supportsLoomFeature(
    configs.get(props.environmentId)?.environment.capabilities,
    VAULT_APPROVAL_CARDS_FEATURE,
  );
  if (!supported)
    return (
      <p className="text-sm text-muted-foreground wrap-anywhere">
        Vault access request for {props.item.itemLabel}. Connect to a computer with current Loom to
        review this request.
      </p>
    );
  return <ApprovalCard key={`${props.environmentId}:${props.item.requestId}`} {...props} />;
}

function ApprovalCard({
  environmentId,
  item,
}: {
  readonly environmentId: EnvironmentId;
  readonly item: VaultApprovalCardData;
}) {
  const allowed = useAtomValue(access.approvalCardChange.permissionAtom(environmentId));
  const decide = useAtomCommand(access.approvalCardChange, {
    reportFailure: false,
    reportDefect: false,
  });
  const [updated, setUpdated] = useState<{
    source: VaultApprovalCardData;
    card: VaultApprovalCardData | null;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    source: VaultApprovalCardData;
    message: string | null;
  } | null>(null);
  const message = feedback?.source === item ? feedback.message : null;
  const setMessage = (message: string | null) => setFeedback({ source: item, message });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const card =
    updated?.card && (updated.source === item || updated.card.revision > item.revision)
      ? updated.card
      : item;
  const unavailable = updated?.source === item && updated.card === null;
  const state = card.state;
  const pending = state === "pending";
  const canRevoke = (state === "approved" || state === "expired") && card.approvedUntil !== null;
  const disabled = busy || !allowed || unavailable;
  const submit = async (
    decision: VaultApprovalChange["decision"],
    durationMs: 300000 | 900000 = 300000,
  ) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await decide({
        environmentId,
        input: { card, decision, durationMs, operationId: randomUUID().replaceAll("-", "") },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setUpdated({ source: item, card: result.value.card });
      setMessage(result.value.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save this decision. Check the connection and try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const deadline = new Date(card.approvedUntil ?? card.requestExpiresAt).toLocaleString();
  const summary =
    state === "approved"
      ? `Approved until ${deadline}`
      : state === "expired"
        ? `Expired ${deadline}`
        : {
            pending: `Request expires ${deadline}`,
            denied: "Denied",
            cancelled: "Cancelled",
            revoked: "Revoked",
          }[state];
  return (
    <section
      aria-label={`Vault access request: ${card.itemLabel}`}
      className={
        pending
          ? "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm wrap-anywhere"
          : "flex min-w-0 flex-col gap-2 text-sm wrap-anywhere"
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">
          <strong className="font-medium">
            {VAULT_ACTION_LABELS[card.action]}: {card.itemLabel}
          </strong>
          {pending ? null : <span className="text-muted-foreground"> · {summary}</span>}
        </p>
        {canRevoke ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void submit("revoke")}
          >
            Revoke
          </Button>
        ) : null}
      </div>
      {pending ? (
        <>
          <p className="text-muted-foreground">
            {card.itemKind ? `${VAULT_KIND_LABELS[card.itemKind]} · ` : ""}
            {card.destination ?? "Any destination"}
          </p>
          <p className="text-muted-foreground">{summary}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm-multiline"
              disabled={disabled}
              onClick={() => void submit("approve")}
            >
              Approve 5 min
            </Button>
            <Button
              type="button"
              size="sm-multiline"
              variant="outline"
              disabled={disabled}
              onClick={() => void submit("approve", 900000)}
            >
              Approve 15 min
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void submit("deny")}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void submit("cancel")}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : null}
      {!allowed && (pending || canRevoke) ? (
        <p className="text-muted-foreground">
          Your connection does not allow Vault access decisions.
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-muted-foreground">
          Checking the request and saving your decision…
        </p>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
