import { Link } from "@tanstack/react-router";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  repositoryGroupingDisplayNameOf,
} from "@t3tools/contracts";
import { FolderGit2Icon, FolderPlusIcon, SettingsIcon } from "lucide-react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironments } from "~/state/environments";
import {
  useAllEnvironmentShellsBootstrapped,
  useThreadShellsForProjectRefs,
} from "~/state/entities";
import { useEnvironmentsWithScope } from "~/state/session";

/** Open existing projects here; creation and import keep their separate entry points. */
export function ProjectSettingsLanding() {
  const { groups, selectScope, search, environments, connectedEnvironments } = useSettingsScope();
  const { isReady } = useEnvironments();
  const snapshotsReady = useAllEnvironmentShellsBootstrapped();
  const permittedIds = useEnvironmentsWithScope(
    connectedEnvironments,
    AuthOrchestrationOperateScope,
  );
  const choices = groups.filter(
    (group) =>
      !group.isScratch &&
      (!search.machine ||
        group.memberProjects.some((member) => member.environmentId === search.machine)),
  );
  const writableEnvironments = connectedEnvironments.filter((environment) =>
    permittedIds.has(environment.environmentId),
  );
  const canAddExisting = writableEnvironments.length > 0;
  const createEnvironment = writableEnvironments.find(
    (environment) => environment.serverConfig?.newProjectsRoot,
  );
  const selectedEnvironment = environments.find(
    (environment) => environment.environmentId === search.machine,
  );
  const loading = !isReady || !snapshotsReady;
  const addProject = (open: "new-project" | "add-project") => {
    const destination = selectedEnvironment ?? (open === "new-project" ? createEnvironment : null);
    openCommandPalette({
      open,
      ...(destination ? { environmentId: destination.environmentId } : {}),
    });
  };

  return (
    <SettingsPageContainer>
      <header className="flex flex-wrap items-start justify-between gap-4 px-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Your projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a project to manage its resources and threads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!createEnvironment}
            title={
              canAddExisting && !createEnvironment
                ? "This computer does not support creating new projects"
                : undefined
            }
            onClick={() => addProject("new-project")}
          >
            <FolderGit2Icon aria-hidden="true" />
            New project
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canAddExisting}
            onClick={() => addProject("add-project")}
          >
            <FolderPlusIcon aria-hidden="true" />
            Add existing
          </Button>
        </div>
      </header>
      <SettingsSection id="project-overview" title="Projects" hideTitle>
        {choices.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {choices.map((group) => (
              <ProjectLibraryRow
                key={group.projectKey}
                group={group}
                environmentId={selectedEnvironment?.environmentId ?? null}
                onSettings={() =>
                  selectScope({ ...search, project: group.projectKey, checkout: undefined })
                }
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-1 px-4 py-8 text-sm" role="status">
            <p className="font-medium">
              {loading
                ? "Loading projects..."
                : connectedEnvironments.length === 0
                  ? "Connect a computer to see its projects"
                  : search.machine
                    ? "No projects on this computer"
                    : "Add your first project"}
            </p>
            <p className="text-muted-foreground">
              {loading
                ? "Waiting for your connected computers."
                : connectedEnvironments.length === 0
                  ? "Your saved projects will appear when their computer reconnects."
                  : "Create a new project, or add an existing folder or repository."}
            </p>
          </div>
        )}
      </SettingsSection>
      {!canAddExisting ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4">
          <p className="text-xs text-muted-foreground">
            {connectedEnvironments.length === 0
              ? "Connect a computer to add projects or start work."
              : "This connection does not have permission to add projects."}
          </p>
          <Button size="xs" variant="link" render={<Link to="/settings/connections" />}>
            Connections
          </Button>
        </div>
      ) : null}
      <div className="px-3 sm:px-4">
        <Button size="xs" variant="link" render={<Link to="/projects/storage" />}>
          Advanced: working files on computers
        </Button>
      </div>
    </SettingsPageContainer>
  );
}

function ProjectLibraryRow({
  group,
  environmentId,
  onSettings,
}: {
  readonly group: SidebarProjectSnapshot;
  readonly environmentId: EnvironmentId | null;
  readonly onSettings: () => void;
}) {
  const threads = useThreadShellsForProjectRefs(group.memberProjectRefs);
  const identity = group.memberProjects.find(
    (member) => member.repositoryIdentity,
  )?.repositoryIdentity;
  const repositoryName = identity ? repositoryGroupingDisplayNameOf(identity) : undefined;
  const preferredProject = group.memberProjects.find(
    (member) => member.environmentId === environmentId,
  );
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-1 sm:px-4">
      <Link
        to="/projects/$projectKey"
        params={{ projectKey: group.projectKey }}
        search={
          preferredProject
            ? { computer: preferredProject.environmentId, checkoutId: preferredProject.id }
            : {}
        }
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ProjectFavicon project={group} className="size-7 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{group.displayName}</span>
          {repositoryName ? (
            <span className="block truncate text-xs text-muted-foreground">{repositoryName}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {threads.length} {threads.length === 1 ? "thread" : "threads"}
        </span>
      </Link>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label={`Settings for ${group.displayName}`}
              onClick={onSettings}
            >
              <SettingsIcon aria-hidden="true" />
            </Button>
          }
        />
        <TooltipPopup>Project settings</TooltipPopup>
      </Tooltip>
    </li>
  );
}
