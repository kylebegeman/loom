import { createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { Navigate } from "@tanstack/react-router"; // fork: library-only
import { useState } from "react";
import { useEnvironment } from "~/state/environments"; // fork: library-only
import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { NoProjectsHero } from "../components/NoProjectsHero";
import { WelcomePage } from "../components/onboarding/WelcomePage";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";

const decodeEnvironmentId = Schema.decodeOption(EnvironmentId);

export const Route = createFileRoute("/welcome")({
  beforeLoad: ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WelcomeRouteView,
});

function WelcomeRouteView() {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  // A ChatGPT sign-in returns here with the computer it set up.
  const resumeEnvironmentId = hash.startsWith("agents:")
    ? Option.getOrUndefined(decodeEnvironmentId(hash.slice("agents:".length)))
    : undefined;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments, isReady } = useEnvironments();
  // Trust the id only once the catalog has it; an unknown computer falls back to this one.
  const waitingForCatalog =
    !isReady && (resumeEnvironmentId !== undefined || primaryEnvironmentId === null);
  const resumeKnown =
    resumeEnvironmentId !== undefined &&
    environments.some((environment) => environment.environmentId === resumeEnvironmentId);
  const environmentId = (resumeKnown ? resumeEnvironmentId : undefined) ?? primaryEnvironmentId;
  // The root can remount this pending outlet after navigation; do not reopen setup.
  const isWelcomeRoute = useLocation({ select: (location) => location.pathname === "/welcome" });
  const [dismissed, setDismissed] = useState(false);
  const openNewThread = useNewThreadHandler();
  // fork: library-only A Library-only server has no execution setup to offer.
  const primaryEnvironment = useEnvironment(primaryEnvironmentId);
  const executionAvailable =
    primaryEnvironment?.serverConfig?.environment.capabilities.supportsExecution !== false;
  if (!executionAvailable) return isWelcomeRoute ? <Navigate to="/" replace /> : null; // fork: library-only
  if (waitingForCatalog) return null;
  if (environmentId === null || !isWelcomeRoute || dismissed) return <NoProjectsHero />;
  return (
    <WelcomePage
      key={environmentId}
      environmentId={environmentId}
      onDone={async (projectRef) => {
        setDismissed(true);
        if (projectRef !== undefined) {
          await openNewThread(projectRef, { replace: true }).catch(() =>
            navigate({ to: "/", replace: true }),
          );
          return;
        }
        await navigate({ to: "/", replace: true });
      }}
    />
  );
}
