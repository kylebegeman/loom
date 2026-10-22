import { LoomSettingsActions, LoomSettingsNotice } from "../settings/parts";
import { migrationInventory as atoms } from "./migrationState";
import { ReplacementPreview } from "./ReplacementPreview";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultReplacementPlan, VaultReplacementVerify } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { runVault } from "./state";
import { useVaultTime } from "./useVaultTime";
export function ReplacementVerification({
  environmentId,
  plan,
  previewsSupported,
}: {
  environmentId: EnvironmentId;
  plan: VaultReplacementPlan;
  previewsSupported: boolean;
}) {
  const [pending, setPending] = useState<VaultReplacementVerify | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const canWrite = useAtomValue(atoms.verify.permissionAtom(environmentId));
  const queryAtom = atoms.verification({ environmentId, input: { id: plan.id } }),
    query = useAtomValue(queryAtom);
  const status = !busy && !error && query._tag === "Success" && !query.waiting ? query.value : null;
  const refresh = () => {
    setError(null);
    setPending(null);
    setConfirmed(false);
    appAtomRegistry.refresh(queryAtom);
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
    if (busy || !canWrite || !confirmed) return;
    const input = pending ?? {
      id: plan.id,
      operationId: randomUUID().replaceAll("-", ""),
      expectedOperationId: status?.receipt?.operationId ?? null,
      contactDestination: true as const,
    };
    setPending(input);
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      const next = await runVault(atoms.verify, { environmentId, input });
      if (next.receipt?.state !== "running" || next.freshness === "interrupted") setPending(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Verification response was lost. Refresh its receipt before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Replacement verification"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-3 sm:p-4"
    >
      <h4 className="font-medium">Verify replacement access</h4>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {plan.replacement.scope === "ssh-git-transport"
          ? `Check read access to ${plan.dependency.gitPath} using the saved SSH key and pinned host. The check reads refs without fetching or changing Git configuration.`
          : "Check this repository through the dedicated GitHub connection's API. This does not test Git SSH/HTTPS transport or the local gh executable."}
      </p>
      {busy || query.waiting ? (
        <LoomSettingsNotice role="status">Updating verification receipt…</LoomSettingsNotice>
      ) : null}
      {query._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          Could not load verification evidence. Refresh before continuing.
        </LoomSettingsNotice>
      ) : null}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {status ? (
        <>
          <LoomSettingsNotice role="status">
            Evidence: {freshness}. Cutover remains unavailable.
          </LoomSettingsNotice>
          {status.receipt ? (
            <>
              <p>
                Last attempt: {status.receipt.state} ·{" "}
                {new Date(status.receipt.startedAt).toLocaleString()} ·{" "}
                {status.receipt.scope === "ssh-git-transport"
                  ? "SSH repository read"
                  : "GitHub repository API"}
              </p>
              {status.receipt.failure ? (
                <LoomSettingsNotice role="status">
                  Check failed: {status.receipt.failure.replaceAll("-", " ")}. Review the source,
                  record, trust and connection before retrying.
                </LoomSettingsNotice>
              ) : null}
              {status.invalidatedBy && freshness === "invalidated" ? (
                <LoomSettingsNotice role="status">
                  Evidence is invalidated by {status.invalidatedBy.replaceAll("-", " ")}.
                </LoomSettingsNotice>
              ) : null}
              {freshness === "current" && status.receipt.validUntil !== null ? (
                <p>Evidence expires {new Date(status.receipt.validUntil).toLocaleTimeString()}.</p>
              ) : null}
              {freshness === "interrupted" ? (
                <p>
                  The final outcome was not recorded. Refresh first; a new attempt needs explicit
                  confirmation.
                </p>
              ) : null}
            </>
          ) : (
            <p>No verification has been attempted.</p>
          )}
        </>
      ) : null}
      <p>
        A workload still needs its own current grant. Upstream access can be revoked after a
        successful check. This receipt cannot authorize a repository change.
      </p>
      {previewsSupported ? (
        status && freshness === "current" && plan.state === "reviewed" && status.receipt ? (
          <ReplacementPreview
            key={status.receipt.operationId}
            environmentId={environmentId}
            planId={plan.id}
            operationId={status.receipt.operationId}
          />
        ) : (
          <p>Route previews need fresh successful repository-read evidence.</p>
        )
      ) : (
        <p>Route previews need a newer Vault server.</p>
      )}
      <label className="flex items-start gap-2 text-sm leading-6">
        <input
          className="mt-1 shrink-0"
          type="checkbox"
          aria-label="Allow replacement verification"
          checked={confirmed}
          disabled={busy || !canWrite || plan.state !== "reviewed"}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        Allow a verification attempt against the saved destination. Missing host trust will block
        it.
      </label>
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          disabled={
            busy ||
            !canWrite ||
            !confirmed ||
            plan.state !== "reviewed" ||
            now >= plan.expiresAt ||
            (!status && !pending) ||
            freshness === "running" ||
            status?.planState === "cancelled" ||
            status?.freshness === "invalidated"
          }
          onClick={() => void verify()}
        >
          {pending ? "Retry verification request" : "Verify replacement access"}
        </Button>
        <Button size="sm-multiline" variant="outline" disabled={busy} onClick={refresh}>
          Refresh verification receipt
        </Button>
      </LoomSettingsActions>
    </section>
  );
}
