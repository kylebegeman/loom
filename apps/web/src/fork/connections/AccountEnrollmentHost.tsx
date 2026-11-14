import { useEffect, useEffectEvent } from "react";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type EnvironmentPresentation, usePrimaryEnvironment } from "~/state/environments";
import { accountSetupApplies, useComputerEnrollment } from "./accountEnrollment";

/**
 * Adds the computer serving this app to the signed-in account without a click: once per app
 * start, and again after a new sign-in. A computer the owner removed stays removed.
 */
export function AccountEnrollmentHost() {
  const environment = usePrimaryEnvironment();
  if (environment === null || !accountSetupApplies(environment)) return null;
  return <OwnComputerEnrollment key={environment.environmentId} environment={environment} />;
}

function OwnComputerEnrollment({ environment }: { readonly environment: EnvironmentPresentation }) {
  const enrollment = useComputerEnrollment(environment);
  const due = enrollment.plan.kind === "enroll" && enrollment.run === null;
  const label = environment.label;
  const enroll = async () => {
    const progress = toastManager.add({
      type: "loading",
      title: `Adding ${label} to your account...`,
      description: "Your other devices can open it when this finishes.",
    });
    const run = await enrollment.start();
    toastManager.update(
      progress,
      run.phase === "done"
        ? {
            type: "success",
            title: `${label} is in your account`,
            description:
              "Your phone, browser and other computers can open it now. Remote access starts automatically.",
          }
        : stackedThreadToast({
            type: "error",
            title: `Could not add ${label} to your account`,
            description:
              run.phase === "failed"
                ? `${run.error} Loom tries again the next time it starts.`
                : "Loom tries again the next time it starts.",
            actionProps: { children: "Try again", onClick: () => void enroll() },
          }),
    );
  };
  const startWhenDue = useEffectEvent(() => void enroll());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts account setup once this computer is due; the shared run state keeps it to one run a session
  useEffect(() => {
    if (due) startWhenDue();
  }, [due]);
  return null;
}
