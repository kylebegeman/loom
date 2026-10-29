import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { UPDATE_PLAN_FEATURE } from "@t3tools/contracts/fork";
import { useEnvironments } from "~/state/environments";
import { APP_VERSION } from "~/branding";
import { SidebarMenuItem } from "~/components/ui/sidebar";
import { MachineUpdatePlanControls, useUpdatePlan } from "./UpdatePlans";

function ComputerPlan({
  environment,
}: {
  readonly environment: ReturnType<typeof useEnvironments>["environments"][number];
}) {
  const advertised = supportsLoomFeature(
    environment.serverConfig?.environment.capabilities,
    UPDATE_PLAN_FEATURE,
  );
  const { status } = useUpdatePlan(environment.environmentId, advertised);
  if (!status?.plan || status.plan.state === "cancelled") return null;
  return (
    <SidebarMenuItem>
      <div className="space-y-1 rounded-lg bg-sidebar-control-surface px-3 py-2 text-xs">
        <p>{environment.label}</p>
        <MachineUpdatePlanControls
          environmentId={environment.environmentId}
          advertised={advertised}
          connected={environment.entry.enabled && environment.connection.phase === "connected"}
          targetVersion={APP_VERSION}
          currentVersion={environment.serverConfig?.environment.serverVersion ?? null}
        />
      </div>
    </SidebarMenuItem>
  );
}

export function SidebarUpdatePlans() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <ComputerPlan key={environment.environmentId} environment={environment} />
      ))}
    </>
  );
}
