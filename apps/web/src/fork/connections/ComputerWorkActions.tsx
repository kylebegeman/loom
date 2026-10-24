import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { ArrowUpRightIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { noProjectWorkspaceRoot } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "~/components/ui/button";
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

/** Work remains available beside the connection that owns its projects and history. */
export function ComputerWorkActions({ environment }: { environment: EnvironmentPresentation }) {
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
  const [choosingProject, setChoosingProject] = useState(false);
  const connected = environment.entry.enabled && environment.connection.phase === "connected";
  // The scratch folder still hides this computer's No project home from its project list, but
  // only a computer that can run work offers to start one.
  const scratchRoot = scratchWorkspaceRootFor(environment.environmentId);
  const canStartScratch =
    noProjectWorkspaceRoot(environment.connection.phase, environment.serverConfig) !== null;
  const machineProjects = projects.filter(
    (project) =>
      project.environmentId === environment.environmentId && project.workspaceRoot !== scratchRoot,
  );
  const recentConversation = recentConversationForComputer(
    threads,
    projects,
    environment.environmentId,
  );
  const recentProject = projects.find(
    (project) =>
      project.environmentId === environment.environmentId &&
      project.id === recentConversation?.projectId,
  );
  const agentsReady = readyAgentCount(providersByEnvironment.get(environment.environmentId) ?? []);
  const choiceCount = machineProjects.length + (canStartScratch ? 1 : 0);
  const addProject = () =>
    openCommandPalette({ open: "add-project", environmentId: environment.environmentId });

  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {connected
            ? `${agentsReady} ${agentsReady === 1 ? "agent" : "agents"} ready${machineProjects.length ? `, ${machineProjects.length} ${machineProjects.length === 1 ? "project" : "projects"}` : ""}`
            : "Projects appear when connected"}
        </span>
        {!environment.entry.enabled ? (
          <Button
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
            size="xs"
            variant="outline"
            render={
              <Link to="/settings/providers" search={{ machine: environment.environmentId }} />
            }
          >
            Set up agents
          </Button>
        ) : choiceCount > 0 ? (
          <Button
            size="xs"
            variant="outline"
            disabled={action.busy || !canStartWork}
            title={
              !canStartWork ? "This connection does not have permission to start work" : undefined
            }
            aria-expanded={choiceCount > 1 ? choosingProject : undefined}
            aria-controls={
              choiceCount > 1 ? `computer-projects-${environment.environmentId}` : undefined
            }
            onClick={() => {
              if (choiceCount > 1) setChoosingProject((open) => !open);
              else if (canStartScratch)
                void action.act(() => startScratchThread(environment.environmentId));
              else if (machineProjects[0])
                void action.act(() =>
                  handleNewThread(
                    scopeProjectRef(environment.environmentId, machineProjects[0]!.id),
                  ).then(() => undefined),
                );
            }}
          >
            New conversation
            <ArrowUpRightIcon aria-hidden />
          </Button>
        ) : null}
        <Button
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
          onClick={addProject}
        >
          <PlusIcon aria-hidden />
          Add project
        </Button>
      </div>
      {action.error && <Alert>{action.error}</Alert>}
      {connected && agentsReady === 0 && (
        <AgentReadiness environmentId={environment.environmentId} />
      )}
      {choosingProject && connected && agentsReady > 0 && (
        <div
          id={`computer-projects-${environment.environmentId}`}
          className="space-y-1 rounded-lg bg-muted/30 p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Start on {environment.label}</p>
            <Button size="xs" variant="ghost" onClick={() => setChoosingProject(false)}>
              Cancel
            </Button>
          </div>
          {canStartScratch && (
            <button
              disabled={action.busy || !canStartWork}
              onClick={() => void action.act(() => startScratchThread(environment.environmentId))}
              className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <MessageSquareIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>
                <span className="block text-sm font-medium">No project</span>
                <span className="block text-xs text-muted-foreground">
                  Start immediately in a temporary workspace
                </span>
              </span>
            </button>
          )}
          {machineProjects.map((project) => (
            <button
              key={project.id}
              disabled={action.busy || !canStartWork}
              onClick={() =>
                void action.act(() =>
                  handleNewThread(scopeProjectRef(environment.environmentId, project.id)).then(
                    () => undefined,
                  ),
                )
              }
              className="flex w-full min-w-0 items-start gap-2 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <FolderIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{project.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {project.workspaceRoot}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {recentConversation && (
        <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg bg-muted/30 p-2.5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 w-full items-start gap-2 sm:flex-1 sm:items-center">
            <MessageSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs font-medium sm:truncate">
                {recentConversation.title || "Untitled conversation"}
              </p>
              <p className="break-words text-xs text-muted-foreground sm:truncate">
                {recentProject?.title ?? "Recent conversation"}
              </p>
            </div>
          </div>
          <Button
            size="xs"
            variant="outline"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(
                  scopeThreadRef(environment.environmentId, recentConversation.id),
                )}
              />
            }
          >
            Continue recent work
          </Button>
        </div>
      )}
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
      {action.error && <Alert>{action.error}</Alert>}
    </div>
  );
}
