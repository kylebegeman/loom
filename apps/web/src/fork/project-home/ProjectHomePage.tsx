import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import {
  buildProjectHome,
  resolveProjectHomeDestination,
  buildProjectHomeComputerChoices,
  projectHomeComputerChoiceKey,
} from "@t3tools/client-runtime/fork";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ProjectResource } from "@t3tools/contracts/fork";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { FolderPlusIcon, MonitorIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { filterSidebarV2VisibleThreads } from "~/components/Sidebar.logic";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useThreadActions } from "~/hooks/useThreadActions";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { useConnectedEnvironmentIds } from "~/state/environments";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";
import { readEnvironmentScope, useEnvironmentsWithScope } from "~/state/session";
import { buildThreadRouteParams } from "~/threadRoutes";
import { isElectron } from "~/env";
import { useProjectNavigationView } from "~/fork/project-navigation/preference";
import { resolveProjectThreadActivity } from "~/fork/project-navigation/activity";
import { ProjectHomeComputers } from "./ProjectHomeComputers";
import { ProjectPreparationDialog } from "./ProjectPreparationDialog";
import { ProjectHomeThreads } from "./ProjectHomeThreads";
import { ProjectResourcesSection } from "./ProjectResourcesSection";
import { useProjectHomeGroup } from "./useProjectHomeGroup";
import { useProjectHomeClock } from "./useProjectHomeClock";
import { useProjectHomeNewThreadShortcuts } from "./useProjectHomeNewThreadShortcuts";
import type { ProjectHomeThreadAction } from "./threadActions";

const EMPTY_PROJECT_REFS: readonly ScopedProjectRef[] = [];

export function ProjectHomePage({
  projectKey,
  chosenProjectRef,
}: {
  projectKey: string;
  chosenProjectRef: ScopedProjectRef | null;
}) {
  useEscapeToGoBack();
  const navigate = useNavigate();
  const home = useProjectHomeGroup(projectKey, chosenProjectRef);
  const [, setNavigatorView] = useProjectNavigationView();
  const goToProjects = useCallback(() => {
    setNavigatorView("projects");
    void navigate({ to: "/" });
  }, [navigate, setNavigatorView]);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Project">
          <WorkspaceBreadcrumbItem>
            <Button variant="link" size="xs" onClick={goToProjects}>
              Projects
            </Button>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current>
            <WorkspaceBreadcrumbText>
              {home.group?.displayName ?? "Project"}
            </WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {home.group ? (
          <ProjectHomeContent
            key={home.group.projectKey}
            {...home}
            group={home.group}
            chosenProjectRef={home.resolvedProjectRef ?? chosenProjectRef}
          />
        ) : (
          <WorkspacePageContainer>
            <h1 className="text-xl font-medium">
              {home.snapshotsReady ? "Project unavailable" : "Loading project..."}
            </h1>
            <p role="status" className="text-sm text-muted-foreground">
              {home.snapshotsReady
                ? "This project is not in the saved computer catalog. Open Projects to choose another project, or reconnect its computer."
                : "Waiting for the project catalog from your computers."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={goToProjects}>
                Open Projects
              </Button>
              <Button variant="outline" render={<Link to="/settings/connections" />}>
                Connections
              </Button>
            </div>
          </WorkspacePageContainer>
        )}
      </main>
    </SidebarInset>
  );
}

function ProjectHomeContent({
  group,
  settingsProjectKey,
  environments,
  primaryEnvironmentId,
  chosenProjectRef,
}: Omit<ReturnType<typeof useProjectHomeGroup>, "group"> & {
  group: NonNullable<ReturnType<typeof useProjectHomeGroup>["group"]>;
  chosenProjectRef: ScopedProjectRef | null;
}) {
  const navigate = useNavigate();
  const connectedIds = useConnectedEnvironmentIds();
  const connectedEnvironmentIds = useMemo(() => new Set(connectedIds), [connectedIds]);
  const permittedEnvironmentIds = useEnvironmentsWithScope(
    group.memberProjects,
    AuthOrchestrationOperateScope,
  );
  const configs = useAtomValue(environmentServerConfigsAtom);
  const threads = useThreadShellsForProjectRefs(group.memberProjectRefs ?? EMPTY_PROJECT_REFS);
  const now = useProjectHomeClock(threads);
  const projectHome = useMemo(
    () =>
      buildProjectHome({
        projectRefs: group.memberProjectRefs,
        threads: filterSidebarV2VisibleThreads(threads, null),
        connectedEnvironmentIds,
        getThreadActivity: (thread) =>
          resolveProjectThreadActivity(thread, configs.get(thread.environmentId), now),
      }),
    [group.memberProjectRefs, threads, connectedEnvironmentIds, configs, now],
  );
  const environmentLabels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const preferredProject =
    group.memberProjects.find((project) => project.environmentId === primaryEnvironmentId) ?? group;
  const destination = resolveProjectHomeDestination({
    memberProjects: group.memberProjects,
    preferredProjectRef: scopeProjectRef(preferredProject.environmentId, preferredProject.id),
    chosenProjectRef,
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const chosen = chosenProjectRef
    ? group.memberProjects.find(
        (project) =>
          project.environmentId === chosenProjectRef.environmentId &&
          project.id === chosenProjectRef.projectId,
      )
    : destination;
  const selection = chosen ? projectHomeComputerChoiceKey(chosen) : null;
  const handleNewThread = useNewThreadHandler();
  const actions = useThreadActions();
  const [preparing, setPreparing] = useState(false);
  const [selectedResource, setSelectedResource] = useState<{
    readonly resource: ProjectResource;
    readonly project: EnvironmentProject;
  } | null>(null);
  // Keep an unavailable explicit choice from targeting another computer's resources.
  const resourceProject = chosenProjectRef
    ? (chosen ?? null)
    : (chosen ?? destination ?? preferredProject);
  const prepareProject = () => {
    setSelectedResource(null);
    setPreparing(true);
  };
  const cloneResource = (resource: ProjectResource) => {
    if (resource.kind !== "repository" || resourceProject === null) return;
    setSelectedResource({ resource, project: resourceProject });
    setPreparing(true);
  };
  const preparationSource =
    group.memberProjects.find((project) => connectedEnvironmentIds.has(project.environmentId)) ??
    group;
  const hasConnectedPreparationSource = connectedEnvironmentIds.has(
    preparationSource.environmentId,
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const newThread = async () => {
    if (
      !destination ||
      startingRef.current ||
      !readEnvironmentScope(destination.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      await handleNewThread(scopeProjectRef(destination.environmentId, destination.id), {
        environmentSelection: "manual",
      });
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "Could not start a conversation on this computer. Try again.",
      );
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  useProjectHomeNewThreadShortcuts(newThread);
  const openThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
    },
    [navigate],
  );
  const onThreadAction = useCallback(
    (action: ProjectHomeThreadAction, threadRef: ScopedThreadRef) =>
      action === "settle"
        ? actions.settleThread(threadRef)
        : action === "unsettle"
          ? actions.unsettleThread(threadRef)
          : actions.unsnoozeThread(threadRef),
    [actions],
  );
  const choices = buildProjectHomeComputerChoices({
    projects: group.memberProjects,
    environmentLabels,
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const selectedChoice = choices.find((choice) => choice.value === selection);
  const computerCount = new Set(group.memberProjects.map((project) => project.environmentId)).size;
  return (
    <WorkspacePageContainer width="wide">
      <header className="space-y-6 pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ProjectFavicon project={group} className="mt-1.5 size-8 shrink-0" />
            <div className="min-w-0">
              <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight sm:text-3xl">
                {group.displayName}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {projectHome.counts.total} {projectHome.counts.total === 1 ? "thread" : "threads"}{" "}
                on {computerCount} {computerCount === 1 ? "computer" : "computers"}
              </p>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={`Settings for ${group.displayName}`}
                  render={
                    <Link
                      to="/settings/projects"
                      search={{
                        project: settingsProjectKey ?? group.projectKey,
                        machine: undefined,
                        checkout: undefined,
                      }}
                    />
                  }
                >
                  <SettingsIcon aria-hidden="true" />
                </Button>
              }
            />
            <TooltipPopup>Project settings</TooltipPopup>
          </Tooltip>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64 min-w-0 max-w-full">
              <Select
                items={choices}
                value={selection}
                onValueChange={(value) => {
                  const project = group.memberProjects.find(
                    (candidate) => projectHomeComputerChoiceKey(candidate) === value,
                  );
                  if (project)
                    void navigate({
                      to: "/projects/$projectKey",
                      params: { projectKey: group.projectKey },
                      search: { computer: project.environmentId, checkoutId: project.id },
                      replace: true,
                      resetScroll: false,
                    });
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SelectTrigger
                        size="default"
                        aria-label="Computer for new thread"
                        aria-description={selectedChoice?.label}
                      >
                        <MonitorIcon aria-hidden="true" />
                        <SelectValue>
                          {selectedChoice?.triggerLabel ?? "Choose a computer"}
                        </SelectValue>
                      </SelectTrigger>
                    }
                  />
                  {selectedChoice ? <TooltipPopup>{selectedChoice.label}</TooltipPopup> : null}
                </Tooltip>
                <SelectPopup>
                  {group.memberProjects.map((project, index) => (
                    <SelectItem key={choices[index]!.value} value={choices[index]!.value}>
                      <span className="block max-w-[min(32rem,var(--available-width))] wrap-anywhere">
                        {choices[index]!.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button disabled={!destination || starting} onClick={() => void newThread()}>
              <SquarePenIcon aria-hidden="true" />
              {starting ? "Starting..." : "New thread"}
            </Button>
            <Button variant="outline" onClick={prepareProject}>
              <FolderPlusIcon aria-hidden="true" />
              Clone repository
            </Button>
          </div>
          {!destination ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p role="status" className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                {!hasConnectedPreparationSource
                  ? "Reconnect one of this project's computers to start work or prepare it on another computer."
                  : chosenProjectRef
                    ? "The selected computer is offline or lacks permission to start work. Choose another computer or prepare the project elsewhere."
                    : "Choose a computer with permission to start work, or prepare the project on another computer."}
              </p>
              {hasConnectedPreparationSource ? (
                <Button size="sm" variant="outline" onClick={prepareProject}>
                  <FolderPlusIcon aria-hidden="true" />
                  Prepare on another computer
                </Button>
              ) : (
                <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
                  Connections
                </Button>
              )}
            </div>
          ) : null}
          {startError ? (
            <p role="alert" className="text-xs text-destructive">
              {startError}
            </p>
          ) : null}
        </div>
      </header>
      {resourceProject ? (
        <ProjectResourcesSection project={resourceProject} onCloneResource={cloneResource} />
      ) : (
        <section aria-labelledby="project-resources-heading" className="space-y-2">
          <h2 id="project-resources-heading" className="text-base font-semibold">
            Resources
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            The selected project is unavailable on this computer. Choose another computer to see its
            resources.
          </p>
        </section>
      )}
      <ProjectHomeThreads
        sections={projectHome.sections}
        environmentLabels={environmentLabels}
        serverConfigs={configs}
        onOpenThread={openThread}
        onThreadAction={onThreadAction}
      />
      <ProjectHomeComputers
        projects={group.memberProjects}
        connectedEnvironmentIds={connectedEnvironmentIds}
        onPrepare={prepareProject}
      />
      {preparing ? (
        <ProjectPreparationDialog
          sourceProject={selectedResource?.project ?? preparationSource}
          {...(selectedResource ? { resourceSource: selectedResource.resource } : {})}
          {...(chosen ? { initialEnvironmentId: chosen.environmentId } : {})}
          onClose={() => {
            setPreparing(false);
            setSelectedResource(null);
          }}
        />
      ) : null}
    </WorkspacePageContainer>
  );
}
