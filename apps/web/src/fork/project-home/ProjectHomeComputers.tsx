import { useId, useState } from "react";
import { ChevronRightIcon, FolderPlusIcon, MonitorIcon } from "lucide-react";
import { Link, useParams } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";

import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ProjectWorkingCopyActions } from "./ProjectWorkingCopyActions";

export function ProjectHomeComputers({
  projects,
  connectedEnvironmentIds,
  onPrepare,
}: {
  projects: readonly SidebarProjectGroupMember[];
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  onPrepare: () => void;
}) {
  const projectKey = useParams({
    strict: false,
    select: (params) => (typeof params.projectKey === "string" ? params.projectKey : null),
  });
  return (
    <section className="space-y-3" aria-label="Working copies">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Working copies</h2>
          <p className="text-xs text-muted-foreground">
            Clone a repository when you need files. Remove a safe copy when you're done.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onPrepare}>
          <FolderPlusIcon aria-hidden="true" />
          Clone repository
        </Button>
      </header>
      <ul className="divide-y divide-border/50" aria-label="Project working copies">
        {projects.map((project) => (
          <ComputerFolder
            key={`${project.environmentId}:${project.id}:${project.workspaceRoot}`}
            project={project}
            projectKey={projectKey}
            connected={connectedEnvironmentIds.has(project.environmentId)}
          />
        ))}
      </ul>
    </section>
  );
}

function ComputerFolder({
  project,
  projectKey,
  connected,
}: {
  project: SidebarProjectGroupMember;
  projectKey: string | null;
  connected: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const computer = project.environmentLabel ?? "Computer";
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <MonitorIcon aria-hidden="true" className="size-4 shrink-0 text-icon-muted" />
          <span className="truncate">{computer}</span>
          {!connected ? (
            <span className="text-xs font-normal text-muted-foreground">Offline</span>
          ) : null}
        </h3>
        <Button
          variant="ghost-muted"
          size="xs"
          aria-expanded={showDetails}
          aria-controls={detailsId}
          aria-label={`Working copy details on ${computer}`}
          onClick={() => setShowDetails((current) => !current)}
        >
          Details
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform duration-150 motion-reduce:transition-none",
              showDetails && "rotate-90",
            )}
          />
        </Button>
      </div>
      <ProjectWorkingCopyActions project={project} projectKey={projectKey} connected={connected} />
      <div id={detailsId} hidden={!showDetails} className="space-y-2 pt-1">
        <p className="wrap-anywhere text-xs text-muted-foreground">{project.workspaceRoot}</p>
        {projectKey ? (
          <Button
            variant="link"
            size="xs"
            render={
              <Link
                to="/settings/projects"
                search={{
                  project: projectKey,
                  machine: project.environmentId,
                  checkout: project.physicalProjectKey,
                }}
                hash="project-checkout-storage"
              />
            }
          >
            Advanced: automatic cleanup and file management
          </Button>
        ) : null}
      </div>
    </li>
  );
}
