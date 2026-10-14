import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { FolderIcon, MonitorIcon } from "lucide-react";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { SidebarInset } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useProjects, useAllEnvironmentProjectSnapshotsReady } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentsWithScope } from "~/state/session";
import { environmentServerConfigsAtom } from "~/state/server";
import { ProjectCheckoutSettings } from "~/fork/project-checkout/ProjectCheckoutSettings";
import { PROJECT_CHECKOUT_FEATURE } from "~/fork/project-checkout/state";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { useClientSettings } from "~/hooks/useSettings";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { useProjectNavigationView } from "~/fork/project-navigation/preference";
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
  const [selected, setSelected] = useState<string | null>(null);
  const navigate = useNavigate();
  const [, setNavigatorView] = useProjectNavigationView();
  const labels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const groups = useMemo(
    () => buildProjectStorageInventory({ projects, query, environmentLabels: labels }),
    [projects, query, labels],
  );
  const computerById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const openProjects = () => {
    setNavigatorView("projects");
    void navigate({ to: "/" });
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        <Button variant="link" size="xs" onClick={openProjects}>
          Projects
        </Button>
        <span aria-hidden="true" className="text-icon-muted">
          /
        </span>
        <span className="text-sm font-medium">Project storage</span>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Known project folders</h1>
            <p className="text-sm text-muted-foreground">
              Review where each computer keeps its working copies. These are saved project
              locations; only a storage review checks the files. Choosing Keep or Release applies to
              one computer and folder.
            </p>
          </div>
          <div className="max-w-sm">
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
                <section
                  key={group.environmentId}
                  aria-labelledby={`project-storage-${group.environmentId}`}
                  className="space-y-3"
                >
                  <h2
                    id={`project-storage-${group.environmentId}`}
                    className="flex items-center gap-2 text-base font-medium"
                  >
                    <MonitorIcon aria-hidden="true" className="size-4 text-icon-muted" />
                    {group.label}
                    <span className="text-xs font-normal text-muted-foreground">
                      {connected ? "Connected" : "Offline"}, {group.projects.length}{" "}
                      {group.projects.length === 1 ? "folder" : "folders"}
                    </span>
                  </h2>
                  {reason ? (
                    <p className="text-xs text-muted-foreground">
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
                    className="divide-y divide-border rounded-lg border border-border"
                    aria-label={`Folders on ${group.label}`}
                  >
                    {group.projects.map(({ project, key }) => (
                      <li
                        key={key}
                        className="space-y-3 p-4 [content-visibility:auto] [contain-intrinsic-size:auto_90px]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            <FolderIcon
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0 text-icon-muted"
                            />
                            <div className="min-w-0">
                              <Button
                                variant="link"
                                size="xs"
                                render={
                                  <Link
                                    to="/projects/$projectKey"
                                    params={{
                                      projectKey: deriveLogicalProjectKeyFromSettings(
                                        project,
                                        settings,
                                        { groupScratchProjects: true },
                                      ),
                                    }}
                                  />
                                }
                              >
                                {project.title}
                              </Button>
                              <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
                                {project.workspaceRoot}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="xs"
                            aria-expanded={selected === key}
                            disabled={reason !== null}
                            onClick={() => setSelected((current) => (current === key ? null : key))}
                            aria-label={`Review storage for ${project.title} on ${group.label}`}
                          >
                            {selected === key ? "Close review" : "Review storage"}
                          </Button>
                        </div>
                        {selected === key && reason === null ? (
                          <ProjectCheckoutSettings
                            projects={[{ ...project, environmentLabel: group.label }]}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}
