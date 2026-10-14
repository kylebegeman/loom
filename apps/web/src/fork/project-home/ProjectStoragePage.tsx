import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon, MonitorIcon, SlidersHorizontalIcon } from "lucide-react";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { SidebarInset } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { useProjects, useAllEnvironmentProjectSnapshotsReady } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
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
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
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
  const groups = useMemo(
    () => buildProjectStorageInventory({ projects, query, environmentLabels: labels }),
    [projects, query, labels],
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
          projectName: project.title,
          environmentLabel: labels.get(project.environmentId) ?? "Saved computer",
          connected: computer?.entry.enabled === true && computer.connection.phase === "connected",
          supported: supportsLoomFeature(
            configs.get(project.environmentId)?.environment.capabilities,
            PROJECT_CHECKOUT_FEATURE,
          ),
          canRead: permitted.has(project.environmentId),
        };
      }),
    [projects, computerById, labels, configs, permitted],
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
        <span className="text-sm font-medium">Project storage</span>
      </WorkspacePageHeader>
      <main className="flex min-h-0 flex-1 flex-col">
        <SettingsPageContainer className="max-w-3xl gap-6">
          <div className="space-y-1 px-3 sm:px-4">
            <h1 className="text-lg font-semibold tracking-tight">Project storage</h1>
            <p className="text-xs text-muted-foreground">
              Review known folders and choose what stays on each computer.
            </p>
          </div>
          <ProjectStorageRollout controller={controller} snapshot={snapshot} />
          <div className="max-w-sm px-3 sm:px-4">
            <Input
              nativeInput
              type="search"
              size="sm"
              aria-label="Search known project folders"
              placeholder="Search project, computer or folder"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          {groups.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {!ready
                ? "Loading known project folders..."
                : query.trim()
                  ? "No project folders match this search."
                  : "Add a project to review its working folder here."}
            </p>
          ) : (
            groups.map((group) => {
              const computer = computerById.get(group.environmentId);
              const connected =
                computer?.entry.enabled === true && computer.connection.phase === "connected";
              const supported = supportsLoomFeature(
                configs.get(group.environmentId)?.environment.capabilities,
                PROJECT_CHECKOUT_FEATURE,
              );
              const readable = permitted.has(group.environmentId);
              const reason = !connected
                ? "Reconnect this computer to review its current files."
                : !supported
                  ? "Update Loom on this computer to review project storage."
                  : !readable
                    ? "This connection cannot review project folders on this computer."
                    : null;
              return (
                <SettingsSection
                  key={group.environmentId}
                  id={`project-storage-${group.environmentId}`}
                  title={group.label}
                  icon={<MonitorIcon aria-hidden="true" className="size-3.5 text-icon-muted" />}
                  headerAction={
                    <span className="text-xs text-muted-foreground">
                      {connected ? "Connected" : "Offline"}, {group.projects.length}{" "}
                      {group.projects.length === 1 ? "folder" : "folders"}
                    </span>
                  }
                >
                  {reason ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
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
                  ) : null}
                  <ul
                    className="divide-y divide-border/50"
                    aria-label={`Folders on ${group.label}`}
                  >
                    {group.projects.map(({ project, key }) => {
                      const queueKey = projectStorageRolloutKey({
                        environmentId: project.environmentId,
                        projectId: project.id,
                        workspaceRoot: project.workspaceRoot,
                      });
                      const row = queueRows.get(queueKey);
                      const writable = row?.target.canAdopt || row?.target.canSetRetention;
                      return (
                        <li
                          key={key}
                          className="space-y-3 px-3 py-2.5 sm:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_64px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              <div className="shrink-0">
                                <Checkbox
                                  aria-label={`Select ${project.title} on ${group.label} at ${project.workspaceRoot}`}
                                  checked={row?.selected ?? false}
                                  disabled={
                                    busy || reason !== null || row?.status === "saved" || !row
                                  }
                                  onCheckedChange={(checked) =>
                                    controller.setSelected(queueKey, checked)
                                  }
                                />
                              </div>
                              <FolderIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 text-icon-muted"
                              />
                              <div className="min-w-0 flex-1">
                                <Link
                                  to="/projects/$projectKey"
                                  className="block truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                  search={{
                                    computer: project.environmentId,
                                    checkoutId: project.id,
                                  }}
                                  params={{
                                    projectKey: deriveLogicalProjectKeyFromSettings(
                                      project,
                                      settings,
                                      { groupScratchProjects: true },
                                    ),
                                  }}
                                >
                                  {project.title}
                                </Link>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span
                                        tabIndex={0}
                                        className="block truncate rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                      />
                                    }
                                  >
                                    {project.workspaceRoot}
                                  </TooltipTrigger>
                                  <TooltipPopup>
                                    <span className="wrap-anywhere">{project.workspaceRoot}</span>
                                  </TooltipPopup>
                                </Tooltip>
                                {row?.status === "saved" ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Saved in this review
                                  </p>
                                ) : reason !== null ? null : !writable ? (
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
                              aria-label={`Individual storage settings for ${project.title} on ${group.label}`}
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
                              projects={[{ ...project, environmentLabel: group.label }]}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </SettingsSection>
              );
            })
          )}
        </SettingsPageContainer>
      </main>
    </SidebarInset>
  );
}
