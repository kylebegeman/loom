import { migrationInventory as atoms } from "./migrationState";
import { ReplacementPreview } from "./ReplacementPreview";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Switch, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultReplacementPlan, VaultReplacementVerify } from "@t3tools/contracts/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { uuidv4 } from "../../lib/uuid";
import { useVaultTime } from "./useVaultTime";
const unwrap = <A, E>(result: AtomCommandResult<A, E>) => {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
};
export function ReplacementVerification({
  environmentId,
  connected,
  plan,
  previewsSupported,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  plan: VaultReplacementPlan;
  previewsSupported: boolean;
}) {
  const [pending, setPending] = useState<VaultReplacementVerify | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const canWrite = useAtomValue(atoms.verify.permissionAtom(environmentId));
  const run = useAtomCommand(atoms.verify, { reportFailure: false });
  const query = useEnvironmentQuery(
    connected ? atoms.verification({ environmentId, input: { id: plan.id } }) : null,
  );
  const status = !busy && !error && query.isSuccess && !query.isPending ? query.data : null;
  const refresh = () => {
    setError(null);
    setPending(null);
    setConfirmed(false);
    query.refresh();
  };
  const now = useVaultTime([
    plan.expiresAt,
    status?.receipt?.validUntil ?? null,
    status?.receipt?.state === "running" ? status.receipt.deadlineAt : null,
  ]);
  const freshness =
    status?.freshness === "current" &&
    status.receipt?.validUntil != null &&
    now >= status.receipt.validUntil
      ? "expired"
      : status?.freshness === "running" && status.receipt && now >= status.receipt.deadlineAt
        ? "interrupted"
        : status?.freshness;
  const verify = async () => {
    if (busy || !connected || !canWrite || !confirmed) return;
    const input = pending ?? {
      id: plan.id,
      operationId: uuidv4().replaceAll("-", ""),
      expectedOperationId: status?.receipt?.operationId ?? null,
      contactDestination: true as const,
    };
    setPending(input);
    setBusy(true);
    setError(null);
    setConfirmed(false);
    await run({ environmentId, input })
      .then((result) => {
        const next = unwrap(result);
        if (next.receipt?.state !== "running" || next.freshness === "interrupted") setPending(null);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Verification response was lost. Refresh its receipt before retrying.",
        );
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-3 rounded-lg border border-border p-3">
      <Text className="font-semibold">Verify replacement access</Text>
      <Text>
        {plan.replacement.scope === "ssh-git-transport"
          ? `Check read access to ${plan.dependency.gitPath} using the saved SSH key and pinned host. The check reads refs without fetching or changing Git configuration.`
          : "Check this repository through the dedicated GitHub connection's API. This does not test Git SSH/HTTPS transport or the local gh executable."}
      </Text>
      {busy || query.isPending ? <Text>Updating verification receipt…</Text> : null}
      {query.error ? (
        <Text accessibilityRole="alert">
          Could not load verification evidence. Refresh before continuing.
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {status ? (
        <>
          <Text>Evidence: {freshness}. Cutover remains unavailable.</Text>
          {status.receipt ? (
            <>
              <Text>
                Last attempt: {status.receipt.state} ·{" "}
                {new Date(status.receipt.startedAt).toLocaleString()} ·{" "}
                {status.receipt.scope === "ssh-git-transport"
                  ? "SSH repository read"
                  : "GitHub repository API"}
              </Text>
              {status.receipt.failure ? (
                <Text>
                  Check failed: {status.receipt.failure.replaceAll("-", " ")}. Review the source,
                  record, trust and connection before retrying.
                </Text>
              ) : null}
              {status.invalidatedBy && freshness === "invalidated" ? (
                <Text>Evidence is invalidated by {status.invalidatedBy.replaceAll("-", " ")}.</Text>
              ) : null}
              {freshness === "current" && status.receipt.validUntil !== null ? (
                <Text>
                  Evidence expires {new Date(status.receipt.validUntil).toLocaleTimeString()}.
                </Text>
              ) : null}
              {freshness === "interrupted" ? (
                <Text>
                  The final outcome was not recorded. Refresh first; a new attempt needs explicit
                  confirmation.
                </Text>
              ) : null}
            </>
          ) : (
            <Text>No verification has been attempted.</Text>
          )}
        </>
      ) : null}
      <Text>
        A workload still needs its own current grant. Upstream access can be revoked after a
        successful check. This receipt cannot authorize a repository change.
      </Text>
      {previewsSupported ? (
        status && freshness === "current" && plan.state === "reviewed" && status.receipt ? (
          <ReplacementPreview
            key={status.receipt.operationId}
            environmentId={environmentId}
            connected={connected}
            planId={plan.id}
            operationId={status.receipt.operationId}
          />
        ) : (
          <Text>Route previews need fresh successful repository-read evidence.</Text>
        )
      ) : (
        <Text>Route previews need a newer Vault server.</Text>
      )}
      <Text>
        Allow a verification attempt against the saved destination. Missing host trust will block
        it.
      </Text>
      <Switch
        accessibilityLabel="Allow replacement verification"
        value={confirmed}
        onValueChange={setConfirmed}
        disabled={busy || !connected || !canWrite || plan.state !== "reviewed"}
      />
      <Button
        label={pending ? "Retry verification request" : "Verify replacement access"}
        disabled={
          busy ||
          !connected ||
          !canWrite ||
          !confirmed ||
          plan.state !== "reviewed" ||
          now >= plan.expiresAt ||
          (!status && !pending) ||
          freshness === "running" ||
          status?.planState === "cancelled" ||
          status?.freshness === "invalidated"
        }
        onPress={() => void verify()}
      />
      <Button
        label="Refresh verification receipt"
        disabled={busy || !connected}
        onPress={refresh}
      />
    </View>
  );
}
