import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { ChevronDownIcon, MonitorIcon, SlidersHorizontalIcon } from "lucide-react";
import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { ProjectFolderLocation } from "~/components/settings/ProjectFolderLocation";
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
import { buildProjectStorageInventory } from "./storageInventory";

export function ProjectStoragePage() {
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
    <SettingsPageContainer scopePresentation="none">
      <SettingsSection id="project-files" title="Files on computers" hideTitle variant="plain">
        <p className="max-w-xl px-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
          Projects organize your conversations in Loom. Working files are the code and other files
          at the locations below. Automatic removal frees safe copies after work is settled; Loom
          restores managed copies when you resume work.
        </p>
        <div className="max-w-sm px-3 pt-3 sm:px-4">
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
      </SettingsSection>
      <ProjectStorageRollout controller={controller} snapshot={snapshot} />
      {groups.length === 0 ? (
        <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
          {!ready
            ? "Loading project file locations..."
            : query.trim()
              ? "No project file locations match this search."
              : "Add a project to review where its working files live."}
        </p>
      ) : (
        groups.map((group) => (
          <SettingsSection
            key={group.projectKey}
            title={group.label}
            headerAction={
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {group.locations.length} {group.locations.length === 1 ? "location" : "locations"}
                </span>
                <Button
                  variant="link"
                  size="xs"
                  render={
                    <Link
                      to="/settings/projects"
                      search={{
                        project: group.projectKey,
                        machine: undefined,
                        checkout: undefined,
                      }}
                    />
                  }
                  aria-label={`Settings for ${group.label}`}
                >
                  Project settings
                </Button>
              </div>
            }
          >
            <ul
              className="divide-y divide-border/50"
              aria-label={`Working files for ${group.label}`}
            >
              {group.locations.map(({ project, key, computerLabel, recordLabel }) => {
                const computer = computerById.get(project.environmentId);
                const connected =
                  computer?.entry.enabled === true && computer.connection.phase === "connected";
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
                            disabled={busy || reason !== null || row?.status === "saved" || !row}
                            onCheckedChange={(checked) => controller.setSelected(key, checked)}
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
                        onClick={() => setSingleReview((current) => (current === key ? null : key))}
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
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
