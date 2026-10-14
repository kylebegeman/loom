import { useId, useState } from "react";
import { ChevronRightIcon, FolderPlusIcon, MonitorIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";
import { ProjectCheckoutSettings } from "~/fork/project-checkout/ProjectCheckoutSettings";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function ProjectHomeComputers({
  projects,
  connectedEnvironmentIds,
  onPrepare,
}: {
  projects: readonly SidebarProjectGroupMember[];
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  onPrepare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const computerCount = new Set(projects.map((project) => project.environmentId)).size;
  return (
    <section className="border-t border-border pt-5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <MonitorIcon aria-hidden="true" className="size-4 shrink-0 text-icon-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Working files</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {computerCount} {computerCount === 1 ? "computer" : "computers"}, {projects.length}{" "}
            {projects.length === 1 ? "file location" : "file locations"}
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-icon-muted transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
      </button>
      <div id={panelId} hidden={!expanded}>
        {expanded ? (
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                This project's working files live at the locations below. You can keep them here or
                let Loom free space after work settles. Resuming work restores removed files; your
                conversations stay in Loom.
              </p>
              <Button size="sm" variant="outline" onClick={onPrepare}>
                <FolderPlusIcon aria-hidden="true" />
                Prepare on another computer
              </Button>
            </div>
            <ul className="divide-y divide-border" aria-label="Project computers">
              {projects.map((project) => (
                <ComputerFolder
                  key={`${project.environmentId}:${project.id}`}
                  project={project}
                  connected={connectedEnvironmentIds.has(project.environmentId)}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
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
  const storageId = useId();
  const computer = project.environmentLabel ?? "Computer";
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <MonitorIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              Working files on {computer}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {connected ? "Connected" : "Offline"}
              </span>
            </h3>
            <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
              Location: {project.workspaceRoot}
            </p>
          </div>
        </div>
        <Button
          variant="ghost-muted"
          size="xs"
          aria-expanded={showStorage}
          aria-controls={storageId}
          aria-label={`Manage working files on ${computer}`}
          onClick={() => setShowStorage((current) => !current)}
        >
          Manage working files
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform duration-150 motion-reduce:transition-none",
              showStorage && "rotate-90",
            )}
          />
        </Button>
      </div>
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          This is a saved location for this project's working files.{" "}
          <Button variant="link" size="xs" render={<Link to="/settings/connections" />}>
            Reconnect this computer
          </Button>{" "}
          to review its current files or continue work.
        </p>
      ) : null}
      <div id={storageId} hidden={!showStorage}>
        {showStorage ? <ProjectCheckoutSettings projects={[project]} /> : null}
      </div>
    </li>
  );
}
