import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { noProjectWorkspaceRoot } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  readyAgentCount,
  recentConversationForComputer,
} from "~/components/computers/presentation";
import { type EnvironmentPresentation, useEnvironmentProviders } from "~/state/environments";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { openCommandPalette } from "~/commandPaletteBus";
import { environmentCatalog } from "~/connection/catalog";
import { Alert, useAction } from "~/fork/apple-build-tooling/parts";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

export function ComputerWorkActions({
  environment,
  presentation = "details",
}: {
  readonly environment: EnvironmentPresentation;
  readonly presentation?: "card" | "row" | "details";
}) {
  const projects = useProjects();
  const threads = useThreadShells();
  const providersByEnvironment = useEnvironmentProviders();
  const setEnabled = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const retryNow = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const { handleNewThread } = useHandleNewThread();
  const { startScratchThread, scratchWorkspaceRootFor } = useScratchProject();
  const canStartWork = useEnvironmentScope(
    environment.environmentId,
    AuthOrchestrationOperateScope,
  );
  const action = useAction();
  if (environment.serverConfig?.environment.capabilities.supportsExecution === false) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Stores your projects and conversations. Start work on one of your other computers.
      </p>
    );
  }
  const connected = environment.entry.enabled && environment.connection.phase === "connected";
  const scratchRoot = scratchWorkspaceRootFor(environment.environmentId);
  const canStartScratch =
    noProjectWorkspaceRoot(environment.connection.phase, environment.serverConfig) !== null;
  const machineProjects = projects.filter(
    (project) =>
      project.environmentId === environment.environmentId && project.workspaceRoot !== scratchRoot,
  );
  const recentConversations = [];
  let remainingThreads = threads;
  for (let index = 0; index < (presentation === "details" ? 3 : 1); index++) {
    const recent = recentConversationForComputer(
      remainingThreads,
      projects,
      environment.environmentId,
    );
    if (recent === null) break;
    recentConversations.push(recent);
    remainingThreads = remainingThreads.filter((thread) => thread !== recent);
  }
  const agentsReady = readyAgentCount(providersByEnvironment.get(environment.environmentId) ?? []);
  const choiceCount = machineProjects.length + (canStartScratch ? 1 : 0);
  const canCreateThread = connected && agentsReady > 0 && canStartWork && !action.busy;
  const startInProject = async (projectId: ProjectId) => {
    await handleNewThread(scopeProjectRef(environment.environmentId, projectId));
  };
  const newThreadButton = (
    <Button
      shape="pill"
      size="xs"
      variant="outline"
      disabled={!canCreateThread}
      title={!canStartWork ? "This connection does not have permission to start work" : undefined}
    />
  );

  return (
    <div
      className={
        presentation === "card"
          ? "flex flex-1 flex-col gap-4"
          : presentation === "row"
            ? "min-w-0 space-y-2"
            : "space-y-4"
      }
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {connected ? (
          <span>
            {agentsReady} {agentsReady === 1 ? "agent" : "agents"} ready
          </span>
        ) : (
          <span>Reconnect to start work</span>
        )}
        <span>
          {machineProjects.length} {machineProjects.length === 1 ? "project" : "projects"}
        </span>
      </div>
      {presentation !== "details" && recentConversations[0] ? (
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(
            scopeThreadRef(environment.environmentId, recentConversations[0].id),
          )}
          className="flex min-w-0 items-start gap-2 text-sm leading-relaxed outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <MessageSquareIcon
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          />
          <span className={presentation === "row" ? "min-w-0 truncate" : "line-clamp-2 min-w-0"}>
            {recentConversations[0].title || "Untitled thread"}
          </span>
        </Link>
      ) : null}
      <div
        className={
          presentation === "card"
            ? "mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
            : "flex flex-wrap items-center gap-2"
        }
      >
        {!environment.entry.enabled ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.act(async () => {
                const result = await setEnabled({
                  environmentId: environment.environmentId,
                  enabled: true,
                });
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              })
            }
          >
            Enable
          </Button>
        ) : !connected ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={
              action.busy ||
              ["connecting", "reconnecting", "unsupported"].includes(environment.connection.phase)
            }
            onClick={() =>
              void action.act(async () => {
                const result = await retryNow(environment.environmentId);
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              })
            }
          >
            Reconnect
          </Button>
        ) : agentsReady === 0 ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            render={
              <Link to="/settings/providers" search={{ machine: environment.environmentId }} />
            }
          >
            Set up agents
          </Button>
        ) : choiceCount > 1 ? (
          <Menu>
            <MenuTrigger render={newThreadButton}>
              <PlusIcon aria-hidden />
              New thread
              <ChevronDownIcon aria-hidden />
            </MenuTrigger>
            <MenuPopup align="start" width="content">
              <MenuGroup>
                <MenuGroupLabel>Start on {environment.label}</MenuGroupLabel>
                {canStartScratch ? (
                  <MenuItem
                    disabled={!canCreateThread}
                    onClick={() =>
                      void action.act(() => startScratchThread(environment.environmentId))
                    }
                  >
                    <MessageSquareIcon aria-hidden />
                    No project
                  </MenuItem>
                ) : null}
                {machineProjects.map((project) => (
                  <MenuItem
                    key={project.id}
                    disabled={!canCreateThread}
                    onClick={() => void action.act(() => startInProject(project.id))}
                  >
                    <FolderIcon aria-hidden />
                    <span className="max-w-56 truncate">{project.title}</span>
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        ) : choiceCount === 1 ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={!canCreateThread}
            title={
              !canStartWork ? "This connection does not have permission to start work" : undefined
            }
            onClick={() => {
              if (canStartScratch)
                void action.act(() => startScratchThread(environment.environmentId));
              else if (machineProjects[0])
                void action.act(() => startInProject(machineProjects[0]!.id));
            }}
          >
            <PlusIcon aria-hidden />
            New thread
          </Button>
        ) : null}
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={!connected || action.busy || !canStartWork}
          title={
            !connected
              ? "Reconnect this computer to add a project"
              : !canStartWork
                ? "This connection does not have permission to add projects"
                : undefined
          }
          onClick={() =>
            openCommandPalette({ open: "add-project", environmentId: environment.environmentId })
          }
        >
          Add project
        </Button>
      </div>
      {action.error ? <Alert>{action.error}</Alert> : null}
      {connected && agentsReady === 0 ? (
        <AgentReadiness environmentId={environment.environmentId} />
      ) : null}
      {presentation === "details" ? (
        <div className="grid gap-8 pt-2 @min-[44rem]/computers:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <section className="min-w-0 space-y-3" aria-label="Projects on this computer">
            <h3 className="text-sm font-medium">Projects</h3>
            {machineProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {connected
                  ? "No projects yet. Add a folder or clone a repository to get started."
                  : "Connect this computer to see its projects."}
              </p>
            ) : (
              <ul className="space-y-1">
                {machineProjects.map((project) => (
                  <li key={project.id} className="flex min-w-0 items-center gap-3 py-2">
                    <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{project.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.workspaceRoot}
                      </p>
                    </div>
                    <Button
                      shape="pill"
                      size="icon-xs"
                      variant="ghost-muted"
                      disabled={!canCreateThread}
                      aria-label={`New thread in ${project.title}`}
                      title={`New thread in ${project.title}`}
                      onClick={() => void action.act(() => startInProject(project.id))}
                    >
                      <PlusIcon aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="min-w-0 space-y-3" aria-label="Recent threads on this computer">
            <h3 className="text-sm font-medium">Recent threads</h3>
            {recentConversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No thread history yet.</p>
            ) : (
              <ul className="space-y-1">
                {recentConversations.map((thread) => {
                  const project = machineProjects.find((entry) => entry.id === thread.projectId);
                  return (
                    <li key={thread.id}>
                      <Link
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(
                          scopeThreadRef(environment.environmentId, thread.id),
                        )}
                        className="flex min-w-0 items-start gap-3 rounded-lg py-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <MessageSquareIcon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {thread.title || "Untitled thread"}
                          </span>
                          {project ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {project.title}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function AgentReadiness({ environmentId }: { environmentId: EnvironmentId }) {
  const action = useAction();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const canRefresh = useAtomValue(serverEnvironment.refreshProviders.permissionAtom(environmentId));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Agents need setup or a fresh status check.</span>
      <Button
        shape="pill"
        size="xs"
        variant="ghost"
        disabled={action.busy || !canRefresh}
        onClick={() =>
          void action.act(async () => {
            const result = await refreshProviders({ environmentId, input: {} });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          })
        }
      >
        {action.busy ? "Checking..." : "Check agents"}
      </Button>
      {action.error ? <Alert>{action.error}</Alert> : null}
    </div>
  );
}
