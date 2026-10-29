import { useAtomValue } from "@effect/atom-react";
import {
  armUpdatePlans,
  createUpdatePlanAtoms,
  supportsLoomFeature,
  updatePlanCanCancel,
  updatePlanText,
  updatePlanUnavailableReason,
  type UpdatePlanOutcome,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { UPDATE_PLAN_FEATURE, type UpdatePlanStatus } from "@t3tools/contracts/fork";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { connectionAtomRuntime } from "~/connection/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironments } from "~/state/environments";
import { resolveVersionMismatch } from "~/versionSkew";

const updatePlans = createUpdatePlanAtoms(connectionAtomRuntime);
const NO_PLAN = Atom.make(AsyncResult.initial<UpdatePlanStatus>());

export function useUpdatePlan(environmentId: EnvironmentId, advertised: boolean) {
  const result = useAtomValue(
    advertised ? updatePlans.status({ environmentId, input: {} }) : NO_PLAN,
  );
  const status = AsyncResult.getOrElse(result, () => null);
  const canArm = useAtomValue(updatePlans.arm.permissionAtom(environmentId));
  const canCancel = useAtomValue(updatePlans.cancel.permissionAtom(environmentId));
  return { result, status, canArm, canCancel };
}

export function MachineUpdatePlanControls({
  environmentId,
  advertised,
  connected,
  targetVersion,
  currentVersion,
}: {
  readonly environmentId: EnvironmentId;
  readonly advertised: boolean;
  readonly connected: boolean;
  readonly targetVersion: string;
  readonly currentVersion: string | null;
}) {
  const { result, status, canArm, canCancel } = useUpdatePlan(environmentId, advertised);
  const arm = useAtomCommand(updatePlans.arm, { reportFailure: false });
  const cancel = useAtomCommand(updatePlans.cancel, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "arm" | "cancel") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome =
        kind === "arm"
          ? await arm({ environmentId, input: { targetVersion } })
          : await cancel({ environmentId, input: { id: status!.plan!.id } });
      if (outcome._tag === "Failure") throw squashAtomCommandFailure(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the update plan.");
    } finally {
      setBusy(false);
    }
  };
  const message = updatePlanText(status);
  const unavailable = updatePlanUnavailableReason({
    advertised,
    connected,
    canMaintain: canArm,
    status,
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {advertised && !status && result.waiting ? <span>Checking update plan...</span> : null}
      {message ? <span>{connected ? message : `Last reported: ${message}`}</span> : null}
      {unavailable ? <span>{unavailable}</span> : null}
      {advertised &&
      connected &&
      status?.supported &&
      canArm &&
      !updatePlanCanCancel(status) &&
      status.plan?.state !== "installing" &&
      currentVersion &&
      resolveVersionMismatch(currentVersion, targetVersion) !== null ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void act("arm")}>
          Update when agents finish
        </Button>
      ) : null}
      {connected && canCancel && updatePlanCanCancel(status) ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void act("cancel")}>
          Cancel update
        </Button>
      ) : null}
      {advertised && !status && !result.waiting && AsyncResult.isFailure(result) ? (
        <span>Could not read the update plan.</span>
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

export function UpdateAllWhenIdle({ targetVersion }: { readonly targetVersion: string }) {
  const { environments } = useEnvironments();
  const eligibility = useAtomValue(
    updatePlans.eligibility(
      environments.map((entry) => ({
        environmentId: entry.environmentId,
        advertised: supportsLoomFeature(
          entry.serverConfig?.environment.capabilities,
          UPDATE_PLAN_FEATURE,
        ),
      })),
    ),
  );
  const arm = useAtomCommand(updatePlans.arm, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<readonly UpdatePlanOutcome[]>([]);
  const targets = environments.map((entry, index) => ({
    environmentId: entry.environmentId,
    label: entry.label,
    unavailableReason: updatePlanUnavailableReason({
      advertised: supportsLoomFeature(
        entry.serverConfig?.environment.capabilities,
        UPDATE_PLAN_FEATURE,
      ),
      connected: entry.entry.enabled && entry.connection.phase === "connected",
      canMaintain: eligibility[index]?.canMaintain === true,
      status: eligibility[index]?.status ?? null,
      ready: eligibility[index]?.ready === true,
      targetVersion,
    }),
  }));
  const hasEligible = targets.some((target) => target.unavailableReason === null);
  const run = async () => {
    if (busy || !hasEligible) return;
    setBusy(true);

    setOutcomes(
      await armUpdatePlans(
        targets,
        async () => targetVersion,
        async (target, version) => {
          const result = await arm({
            environmentId: target.environmentId,
            input: { targetVersion: version },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value;
        },
      ),
    );
    setBusy(false);
  };
  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !hasEligible}
        onClick={() => void run()}
      >
        {busy ? "Arming updates..." : "Update all when agents finish"}
      </Button>
      {outcomes.map((outcome) => (
        <p
          key={outcome.environmentId}
          role={outcome.state === "failed" ? "alert" : "status"}
          className="text-xs text-muted-foreground"
        >
          {outcome.label}: {outcome.message}
        </p>
      ))}
    </div>
  );
}
