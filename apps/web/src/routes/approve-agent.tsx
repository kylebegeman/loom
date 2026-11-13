import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { LEGACY_CONNECT_UI_ENABLED } from "@t3tools/client-runtime/fork"; // fork: connect-ui
import { ApproveAgentSurface } from "../components/auth/ApproveAgentSurface";
import { isHostedStaticApp } from "../hostedPairing";

export const Route = createFileRoute("/approve-agent")({
  beforeLoad: () => {
    if (!LEGACY_CONNECT_UI_ENABLED || !isHostedStaticApp() || !hasCloudPublicConfig()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ApproveAgentSurface,
});
