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
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { findEnvironmentUpdate } from "../../features/settings/environment-maintenance";
import { environmentPresentations } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";

async function latestVersion(currentVersion: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    return await findEnvironmentUpdate(currentVersion, abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

const updatePlans = createUpdatePlanAtoms(connectionAtomRuntime);
const NO_PLAN = Atom.make(AsyncResult.initial<UpdatePlanStatus>());

function ComputerUpdatePlan({
  environmentId,
  label,
  connected,
  advertised,
  currentVersion,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly advertised: boolean;
  readonly currentVersion: string | null;
}) {
  const result = useAtomValue(
    advertised ? updatePlans.status({ environmentId, input: {} }) : NO_PLAN,
  );
  const status = AsyncResult.getOrElse(result, () => null);
  const canArm = useAtomValue(updatePlans.arm.permissionAtom(environmentId));
  const canCancel = useAtomValue(updatePlans.cancel.permissionAtom(environmentId));
  const arm = useAtomCommand(updatePlans.arm, { reportFailure: false });
  const cancel = useAtomCommand(updatePlans.cancel, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async () => {
    if (busy || !currentVersion) return;
    setBusy(true);
    setMessage(null);
    try {
      if (updatePlanCanCancel(status)) {
        const response = await cancel({ environmentId, input: { id: status!.plan!.id } });
        if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      } else {
        const targetVersion = await latestVersion(currentVersion);
        if (targetVersion === null) setMessage("Already up to date");
        else {
          const response = await arm({ environmentId, input: { targetVersion } });
          if (response._tag === "Failure") throw squashAtomCommandFailure(response);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change the update plan.");
    } finally {
      setBusy(false);
    }
  };
  const text = updatePlanText(status);
  const cancelable = updatePlanCanCancel(status);
  const limitation = updatePlanUnavailableReason({
    advertised,
    connected,
    canMaintain: canArm,
    status,
  });
  return (
    <View>
      <ListActionRow
        label={label}
        description={
          (!status && result.waiting
            ? "Checking update plan..."
            : !status && AsyncResult.isFailure(result)
              ? "Could not read the update plan."
              : null) ??
          (text
            ? connected
              ? text
              : `Last reported: ${text}`
            : (limitation ?? "Updates wait for running agents to finish."))
        }
        detail={cancelable ? "Cancel" : "Update when ready"}
        loading={busy}
        disabled={
          !connected ||
          !advertised ||
          !status?.supported ||
          (cancelable ? !canCancel : !canArm) ||
          status?.plan?.state === "installing" ||
          !currentVersion
        }
        onPress={() => void run()}
      />
      {message ? <Text className="px-4 pb-2 text-sm text-foreground-muted">{message}</Text> : null}
    </View>
  );
}

export function FleetUpdatePlans() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const environments = [...presentations].map(([environmentId, presentation]) => ({
    environmentId,
    ...presentation,
  }));
  const permissions = useAtomValue(
    updatePlans.permissions(environments.map((entry) => entry.environmentId)),
  );
  const arm = useAtomCommand(updatePlans.arm, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<readonly UpdatePlanOutcome[]>([]);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    const targets = environments.map((entry, index) => ({
      environmentId: entry.environmentId,
      label: entry.entry.target.label,
      unavailableReason: updatePlanUnavailableReason({
        advertised: supportsLoomFeature(
          entry.serverConfig?.environment.capabilities,
          UPDATE_PLAN_FEATURE,
        ),
        connected: entry.entry.enabled && entry.connection.phase === "connected",
        canMaintain: permissions[index] === true,
      }),
    }));
    setOutcomes(
      await armUpdatePlans(
        targets,
        async (target) => {
          const current = environments.find((entry) => entry.environmentId === target.environmentId)
            ?.serverConfig?.environment.serverVersion;
          if (!current) throw new Error("Reconnect this computer to check its version.");
          return latestVersion(current);
        },
        async (target, targetVersion) => {
          const response = await arm({
            environmentId: target.environmentId,
            input: { targetVersion },
          });
          if (response._tag === "Failure") throw squashAtomCommandFailure(response);
          return response.value;
        },
      ),
    );
    setBusy(false);
  };
  return (
    <SettingsSection
      title="Fleet updates"
      footer="Each computer remembers its update plan after this app closes."
    >
      <ListActionRow
        label="Update all when agents finish"
        onPress={() => void run()}
        loading={busy}
        disabled={
          !environments.some(
            (entry, index) =>
              permissions[index] &&
              entry.entry.enabled &&
              entry.connection.phase === "connected" &&
              supportsLoomFeature(
                entry.serverConfig?.environment.capabilities,
                UPDATE_PLAN_FEATURE,
              ),
          )
        }
      />
      {environments.length === 0 ? (
        <Text className="px-4 py-3 text-sm text-foreground-muted">
          Connect a computer to see its updates.
        </Text>
      ) : null}
      {outcomes.map((outcome) => (
        <Text key={outcome.environmentId} className="px-4 py-2 text-sm text-foreground-muted">
          {outcome.label}: {outcome.message}
        </Text>
      ))}
      {environments.map((entry) => (
        <ComputerUpdatePlan
          key={entry.environmentId}
          environmentId={entry.environmentId}
          label={entry.entry.target.label}
          connected={entry.entry.enabled && entry.connection.phase === "connected"}
          advertised={supportsLoomFeature(
            entry.serverConfig?.environment.capabilities,
            UPDATE_PLAN_FEATURE,
          )}
          currentVersion={entry.serverConfig?.environment.serverVersion ?? null}
        />
      ))}
    </SettingsSection>
  );
}
