import { Link } from "@tanstack/react-router";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { useServerConfigs } from "~/state/entities";
import type { ForkPanelProps } from "../panels/types";
import CommandJobs from "./CommandJobs";

export default function CommandJobsPanel(props: ForkPanelProps) {
  const configs = useServerConfigs();
  const supportsJobs = loomFeaturesOf(
    configs.get(props.threadRef.environmentId)?.environment.capabilities,
  ).includes("mini-offload");
  if (!props.visible) return null;
  // Restored tabs can belong to a server that has never supported command jobs.
  if (!supportsJobs)
    return (
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Command jobs are unavailable on this Loom server. Open connections to start a normal agent
          thread.
        </p>
        <div>
          <Button variant="outline" render={<Link to="/settings/connections" />}>
            Open connections
          </Button>
        </div>
      </div>
    );
  return <CommandJobs {...props} />;
}
