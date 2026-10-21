import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon, MonitorIcon, SlidersHorizontalIcon } from "lucide-react";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { SettingsPageContainer } from "~/components/settings/settingsLayout";
import { SettingsGroup } from "~/components/settings/SettingsGroup";
import { ProjectFolderLocation } from "~/components/settings/ProjectFolderLocation";
import { SidebarInset } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { useProjects, useAllEnvironmentProjectSnapshotsReady } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentsWithScope } from "~/state/session";
import { environmentServerConfigsAtom } from "~/state/server";
import { ProjectCheckoutSettings } from "~/fork/project-checkout/ProjectCheckoutSettings";
import { PROJECT_CHECKOUT_FEATURE } from "~/fork/project-checkout/state";
import {
  projectStorageRolloutComputerLabels,
  projectStorageRolloutKey,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { useProjectStorageRollout } from "~/fork/project-checkout/useProjectStorageRollout";
import { ProjectStorageRollout } from "~/fork/project-checkout/ProjectStorageRollout";
import { selectProjectGroupingSettings } from "~/logicalProject";
import { buildSidebarProjectSnapshots } from "~/sidebarProjectGrouping";
import { useClientSettings } from "~/hooks/useSettings";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { BrowseProjectsButton } from "./BrowseProjectsButton";
import { isElectron } from "~/env";
import { buildProjectStorageInventory } from "./storageInventory";

export function ProjectStoragePage() {
  useEscapeToGoBack();
  const projects = useProjects();
  const ready = useAllEnvironmentProjectSnapshotsReady();
  const { environments } = useEnvironments();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const permitted = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [query, setQuery] = useState("");
  const [singleReview, setSingleReview] = useState<string | null>(null);
  const labels = useMemo(() => {
    const names = new Map(
      environments.map((environment) => [environment.environmentId, environment.label]),
    );
    for (const project of projects) {
      if (!names.has(project.environmentId)) names.set(project.environmentId, "Saved computer");
    }
    return projectStorageRolloutComputerLabels(names);
  }, [environments, projects]);
  const projectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings,
        groupScratchProjects: true,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
      }),
    [projects, settings, primaryEnvironmentId, labels],
  );
  const unfilteredInventory = useMemo(
    () =>
      buildProjectStorageInventory({
        projects,
        groups: projectGroups,
        query: "",
        environmentLabels: labels,
      }),
    [projects, projectGroups, labels],
  );
  const projectNamesByTarget = useMemo(
    () =>
      new Map(
        unfilteredInventory.flatMap((group) =>
          group.locations.map((location) => [location.key, location.projectName] as const),
        ),
      ),
    [unfilteredInventory],
  );
  const groups = useMemo(
    () =>
      query.trim()
        ? buildProjectStorageInventory({
            projects,
            groups: projectGroups,
            query,
            environmentLabels: labels,
          })
        : unfilteredInventory,
    [projects, projectGroups, query, labels, unfilteredInventory],
  );
  const computerById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const inventoryTargets = useMemo(
    () =>
      projects.map((project) => {
        const computer = computerById.get(project.environmentId);
        return {
          environmentId: project.environmentId,
          projectId: project.id,
          workspaceRoot: project.workspaceRoot,
          projectName:
            projectNamesByTarget.get(
              projectStorageRolloutKey({
                environmentId: project.environmentId,
                projectId: project.id,
                workspaceRoot: project.workspaceRoot,
              }),
            ) ?? project.title,
          environmentLabel: labels.get(project.environmentId) ?? "Saved computer",
          connected: computer?.entry.enabled === true && computer.connection.phase === "connected",
          supported: supportsLoomFeature(
            configs.get(project.environmentId)?.environment.capabilities,
            PROJECT_CHECKOUT_FEATURE,
          ),
          canRead: permitted.has(project.environmentId),
        };
      }),
    [projects, computerById, labels, configs, permitted, projectNamesByTarget],
  );
  const { controller, snapshot } = useProjectStorageRollout(inventoryTargets);
  const queueRows = new Map(snapshot.rows.map((row) => [row.key, row]));
  const busy = snapshot.phase === "reviewing" || snapshot.phase === "saving";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        <BrowseProjectsButton variant="link" size="xs" label="Projects" />
        <span aria-hidden="true" className="text-icon-muted">
          /
        </span>
        <span className="text-sm font-medium">Files on computers</span>
      </WorkspacePageHeader>
      <main className="flex min-h-0 flex-1 flex-col">
        <SettingsPageContainer className="max-w-3xl gap-6">
          <div className="space-y-1 px-3 sm:px-4">
            <h1 className="text-lg font-semibold tracking-tight">Files on computers</h1>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Projects organize your conversations in Loom. Working files are the code and other
              files at the locations below. Automatic removal frees safe copies after work is
              settled; Loom restores managed copies when you resume work.
            </p>
          </div>
          <ProjectStorageRollout controller={controller} snapshot={snapshot} />
          <div className="max-w-sm px-3 sm:px-4">
            <Input
              nativeInput
              type="search"
              size="sm"
              aria-label="Search projects and their working files"
              placeholder="Search project, computer or location"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          {groups.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {!ready
                ? "Loading project file locations..."
                : query.trim()
                  ? "No project file locations match this search."
                  : "Add a project to review where its working files live."}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.projectKey} className="space-y-2.5">
                <div className="flex items-start justify-between gap-3 px-3 sm:px-4">
                  <h2 className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <FolderIcon aria-hidden="true" className="size-3.5 shrink-0 text-icon-muted" />
                    <span className="wrap-anywhere">{group.label}</span>
                  </h2>
                  <div className="flex min-h-7 shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {group.locations.length}{" "}
                      {group.locations.length === 1 ? "location" : "locations"}
                    </span>
                    <Button
                      variant="link"
                      size="xs"
                      render={
                        <Link
                          to="/projects/$projectKey"
                          params={{ projectKey: group.projectKey }}
                        />
                      }
                      aria-label={`Open ${group.label} project`}
                    >
                      Open project
                    </Button>
                  </div>
                </div>
                <SettingsGroup>
                  <ul
                    className="divide-y divide-border/50"
                    aria-label={`Working files for ${group.label}`}
                  >
                    {group.locations.map(({ project, key, computerLabel, recordLabel }) => {
                      const computer = computerById.get(project.environmentId);
                      const connected =
                        computer?.entry.enabled === true &&
                        computer.connection.phase === "connected";
                      const supported = supportsLoomFeature(
                        configs.get(project.environmentId)?.environment.capabilities,
                        PROJECT_CHECKOUT_FEATURE,
                      );
                      const readable = permitted.has(project.environmentId);
                      const reason = !connected
                        ? "Reconnect this computer to review its current files."
                        : !supported
                          ? "Update Loom on this computer to review its working files."
                          : !readable
                            ? "This connection cannot review files on this computer."
                            : null;
                      const row = queueRows.get(key);
                      const writable = row?.target.canAdopt || row?.target.canSetRetention;
                      return (
                        <li
                          key={key}
                          className="space-y-3 px-3 py-2.5 sm:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_64px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                              <div className="shrink-0 pt-0.5">
                                <Checkbox
                                  aria-label={`Select working files for ${group.label} on ${computerLabel} at ${project.workspaceRoot}${recordLabel ? `, saved project ${recordLabel}` : ""}`}
                                  checked={row?.selected ?? false}
                                  disabled={
                                    busy || reason !== null || row?.status === "saved" || !row
                                  }
                                  onCheckedChange={(checked) =>
                                    controller.setSelected(key, checked)
                                  }
                                />
                              </div>
                              <MonitorIcon
                                aria-hidden="true"
                                className="mt-0.5 size-4 shrink-0 text-icon-muted"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <p className="text-sm text-foreground/80">
                                    Working files on {computerLabel}
                                  </p>
                                  <span className="text-xs text-muted-foreground">
                                    {connected ? "Connected" : "Offline"}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                                  <span className="shrink-0">Location</span>
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <span
                                          tabIndex={0}
                                          className="min-w-0 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                        />
                                      }
                                    >
                                      {project.workspaceRoot}
                                    </TooltipTrigger>
                                    <TooltipPopup>
                                      <span className="wrap-anywhere">{project.workspaceRoot}</span>
                                    </TooltipPopup>
                                  </Tooltip>
                                </div>
                                <ProjectFolderLocation
                                  project={{ ...project, environmentLabel: computerLabel }}
                                />
                                {recordLabel ? (
                                  <p className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">
                                    Saved project: {recordLabel}
                                  </p>
                                ) : null}
                                {row?.status === "saved" ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Saved in this review
                                  </p>
                                ) : reason !== null ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {reason}
                                    {!connected ? (
                                      <Button
                                        variant="link"
                                        size="xs"
                                        render={<Link to="/settings/connections" />}
                                      >
                                        Connections
                                      </Button>
                                    ) : null}
                                  </p>
                                ) : !writable ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Read-only connection
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <Button
                              variant="ghost-muted"
                              size="icon-xs"
                              aria-expanded={singleReview === key}
                              disabled={busy || reason !== null}
                              onClick={() =>
                                setSingleReview((current) => (current === key ? null : key))
                              }
                              aria-label={`Working file settings for ${group.label} on ${computerLabel} at ${project.workspaceRoot}${recordLabel ? `, saved project ${recordLabel}` : ""}`}
                            >
                              {singleReview === key ? (
                                <ChevronDownIcon aria-hidden="true" className="size-3.5" />
                              ) : (
                                <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
                              )}
                            </Button>
                          </div>
                          {singleReview === key && reason === null && !busy ? (
                            <ProjectCheckoutSettings
                              projects={[{ ...project, environmentLabel: computerLabel }]}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </SettingsGroup>
              </section>
            ))
          )}
        </SettingsPageContainer>
      </main>
    </SidebarInset>
  );
}
