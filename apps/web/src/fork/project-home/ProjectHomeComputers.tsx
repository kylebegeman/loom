import { useState } from "react";
import { ChevronDownIcon, MonitorIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";
import { ProjectCheckoutSettings } from "~/fork/project-checkout/ProjectCheckoutSettings";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function ProjectHomeComputers({
  projects,
  connectedEnvironmentIds,
}: {
  projects: readonly SidebarProjectGroupMember[];
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  return (
    <section aria-labelledby="project-home-computers" className="space-y-3">
      <div>
        <h2 id="project-home-computers" className="text-base font-medium">
          Computers and working folders
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The project and conversations stay available when a working folder is released. Review
          each computer's storage choices independently.
        </p>
      </div>
      <ul
        className="divide-y divide-border rounded-lg border border-border"
        aria-label="Project computers"
      >
        {projects.map((project) => (
          <ComputerFolder
            key={`${project.environmentId}:${project.id}`}
            project={project}
            connected={connectedEnvironmentIds.has(project.environmentId)}
          />
        ))}
      </ul>
    </section>
  );
}

function ComputerFolder({
  project,
  connected,
}: {
  project: SidebarProjectGroupMember;
  connected: boolean;
}) {
  const [showStorage, setShowStorage] = useState(false);
  const computer = project.environmentLabel ?? "Computer";
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <MonitorIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {computer}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {connected ? "Connected" : "Offline"}
              </span>
            </h3>
            <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
              {project.workspaceRoot}
            </p>
          </div>
        </div>
        <Button
          variant="ghost-muted"
          size="xs"
          aria-expanded={showStorage}
          aria-label={`Storage and retention on ${computer}`}
          onClick={() => setShowStorage((current) => !current)}
        >
          Storage and retention
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform duration-150 motion-reduce:transition-none",
              showStorage && "rotate-180",
            )}
          />
        </Button>
      </div>
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          This is a saved folder location.{" "}
          <Button variant="link" size="xs" render={<Link to="/settings/connections" />}>
            Reconnect this computer
          </Button>{" "}
          to review its current files or continue work.
        </p>
      ) : null}
      {showStorage ? <ProjectCheckoutSettings projects={[project]} /> : null}
    </li>
  );
}
