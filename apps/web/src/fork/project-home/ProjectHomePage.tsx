import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { buildProjectHome, resolveProjectHomeDestination } from "@t3tools/client-runtime/fork";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { FolderPlusIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
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
import { requestProjectThreadView } from "~/fork/project-navigation/threadView";
import { ProjectHomeComputers } from "./ProjectHomeComputers";
import { ProjectPreparationDialog } from "./ProjectPreparationDialog";
import { ProjectHomeThreads } from "./ProjectHomeThreads";
import { useProjectHomeGroup } from "./useProjectHomeGroup";
import { useProjectHomeClock } from "./useProjectHomeClock";
import { useProjectHomeNewThreadShortcuts } from "./useProjectHomeNewThreadShortcuts";
import type { ProjectHomeThreadAction } from "./threadActions";

const EMPTY_PROJECT_REFS: readonly ScopedProjectRef[] = [];
const projectRefKey = (project: { environmentId: string; id: string }) =>
  JSON.stringify([project.environmentId, project.id]);

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
  const [, setNavigatorView] = useProjectNavigationView();
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
  const selection = chosen ? projectRefKey(chosen) : null;
  const handleNewThread = useNewThreadHandler();
  const actions = useThreadActions();
  const [preparing, setPreparing] = useState(false);
  const preparationSource =
    group.memberProjects.find((project) => connectedEnvironmentIds.has(project.environmentId)) ??
    group;
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
  const viewThreads = () => {
    requestProjectThreadView(group.projectKey);
    setNavigatorView("threads");
  };
  const computerCheckoutCounts = new Map<string, number>();
  for (const project of group.memberProjects) {
    computerCheckoutCounts.set(
      project.environmentId,
      (computerCheckoutCounts.get(project.environmentId) ?? 0) + 1,
    );
  }
  const choices = group.memberProjects.map((project) => ({
    value: projectRefKey(project),
    label: `${environmentLabels.get(project.environmentId) ?? project.environmentLabel ?? "Computer"}${(computerCheckoutCounts.get(project.environmentId) ?? 0) > 1 ? `, ${project.workspaceRoot}` : ""}${connectedEnvironmentIds.has(project.environmentId) ? (permittedEnvironmentIds.has(project.environmentId) ? "" : " (read only)") : " (offline)"}`,
  }));
  return (
    <WorkspacePageContainer width="wide">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectFavicon project={group} className="mt-1 size-7 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{group.displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {projectHome.counts.total}{" "}
              {projectHome.counts.total === 1 ? "conversation" : "conversations"} across{" "}
              {group.memberProjects.length}{" "}
              {group.memberProjects.length === 1 ? "working folder" : "working folders"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={viewThreads}>
            View threads
          </Button>
          <Button
            size="sm"
            variant="outline"
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
            Project settings
          </Button>
        </div>
      </div>
      <section
        aria-labelledby="project-home-new-thread"
        className="rounded-lg border border-border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="project-home-new-thread" className="text-sm font-medium">
              Start work
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose where the agent runs. Released folders restore when you start work.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64 max-w-full">
              <Select
                items={choices}
                value={selection}
                onValueChange={(value) => {
                  const project = group.memberProjects.find(
                    (candidate) => projectRefKey(candidate) === value,
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
                <SelectTrigger size="sm" aria-label="Computer for new thread">
                  <SelectValue placeholder="Choose a computer" />
                </SelectTrigger>
                <SelectPopup>
                  {group.memberProjects.map((project, index) => (
                    <SelectItem key={choices[index]!.value} value={choices[index]!.value}>
                      {choices[index]!.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button size="sm" disabled={!destination || starting} onClick={() => void newThread()}>
              <SquarePenIcon aria-hidden="true" />
              {starting ? "Starting..." : "New thread"}
            </Button>
          </div>
        </div>
        {!destination ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {chosenProjectRef
              ? "The selected computer is offline or lacks permission to start work. Reconnect it or choose another computer."
              : "Connect a computer with permission to start work, or prepare this project on another computer."}
          </p>
        ) : null}
        {startError ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {startError}
          </p>
        ) : null}
      </section>
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
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="text-sm font-medium">Use another computer</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Open or clone this project's repository on another connected computer.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPreparing(true)}>
          <FolderPlusIcon aria-hidden="true" />
          Prepare on another computer
        </Button>
      </div>
      {preparing ? (
        <ProjectPreparationDialog
          sourceProject={preparationSource}
          onClose={() => setPreparing(false)}
        />
      ) : null}
    </WorkspacePageContainer>
  );
}
