import { useRef, useState } from "react";
import { View } from "react-native";
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
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentServerConfig } from "../../state/entities";
import { uuidv4 } from "../../lib/uuid";

const access = createVaultAccessAtoms(connectionAtomRuntime);

export function VaultApprovalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: VaultApprovalCardData;
}) {
  const config = useEnvironmentServerConfig(props.environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, VAULT_APPROVAL_CARDS_FEATURE))
    return (
      <Text className="text-sm text-foreground-muted">
        Vault access request for {props.item.itemLabel}. Connect to a computer with current Loom to
        review this request.
      </Text>
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
    await (async () => {
      const result = await decide({
        environmentId,
        input: { card, decision, durationMs, operationId: uuidv4().replaceAll("-", "") },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setUpdated({ source: item, card: result.value.card });
      setMessage(result.value.message);
    })()
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not save this decision. Check the connection and try again.",
        );
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
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
    <View
      accessibilityLabel={`Vault access request: ${card.itemLabel}`}
      className={
        pending ? "min-w-0 gap-3 rounded-lg border border-border bg-card p-4" : "min-w-0 gap-2"
      }
    >
      <View className="min-w-0 flex-row flex-wrap items-center gap-2">
        <Text className="min-w-0 flex-1 font-t3-medium text-sm">
          {VAULT_ACTION_LABELS[card.action]}: {card.itemLabel}
          {pending ? "" : ` · ${summary}`}
        </Text>
        {canRevoke ? (
          <Button
            label="Revoke"
            tone="secondary"
            disabled={disabled}
            onPress={() => void submit("revoke")}
          />
        ) : null}
      </View>
      {pending ? (
        <>
          <Text className="text-sm text-foreground-muted">
            {card.itemKind ? `${VAULT_KIND_LABELS[card.itemKind]} · ` : ""}
            {card.destination ?? "Any destination"}
          </Text>
          <Text className="text-sm text-foreground-muted">{summary}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Approve 5 min"
              tone="primary"
              disabled={disabled}
              onPress={() => void submit("approve")}
            />
            <Button
              label="Approve 15 min"
              disabled={disabled}
              onPress={() => void submit("approve", 900000)}
            />
            <Button label="Deny" disabled={disabled} onPress={() => void submit("deny")} />
            <Button
              label="Cancel"
              tone="text"
              disabled={disabled}
              onPress={() => void submit("cancel")}
            />
          </View>
        </>
      ) : null}
      {!allowed && (pending || canRevoke) ? (
        <Text className="text-sm text-foreground-muted">
          Your connection does not allow Vault access decisions.
        </Text>
      ) : null}
      {busy ? (
        <Text accessibilityRole="summary" className="text-sm text-foreground-muted">
          Checking the request and saving your decision…
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" className="text-sm">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
