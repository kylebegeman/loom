import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  CircuitBoardIcon,
  MonitorIcon,
  PlusIcon,
  ArrowUpRightIcon,
  FolderIcon,
  LinkIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useEnvironments } from "~/state/environments";
import { useProjects, setActiveEnvironmentId } from "~/state/entities";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { openCommandPalette } from "~/commandPaletteBus";
import { connectPairing } from "~/connection/onboarding";
import { environmentCatalog } from "~/connection/catalog";
import { Alert, useAction } from "~/fork/apple-build-tooling/parts";
import { serverEnvironment } from "~/state/server";
import { readyAgentCount } from "./presentation";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

export function Computers() {
  const { environments, isReady } = useEnvironments();
  const projects = useProjects();
  const setEnabled = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const retryNow = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const { handleNewThread } = useHandleNewThread();
  const { startScratchThread, scratchWorkspaceRootFor } = useScratchProject();
  const action = useAction();
  const [connecting, setConnecting] = useState(false);
  const [choosingProject, setChoosingProject] = useState<EnvironmentId | null>(null);
  const addProject = (environmentId: EnvironmentId) => {
    setActiveEnvironmentId(environmentId);
    openCommandPalette({ open: "add-project" });
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
          <MonitorIcon aria-hidden className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Your computers</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Macs, Linux machines and Mini boards. Choose where your next agent runs.
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setConnecting(true)} aria-expanded={connecting}>
          <PlusIcon aria-hidden /> Connect computer
        </Button>
        <Button variant="ghost" render={<Link to="/settings/connections" />}>
          Manage connections <ArrowUpRightIcon aria-hidden />
        </Button>
      </div>
      {connecting && <ConnectComputer onClose={() => setConnecting(false)} />}
      {action.error && <Alert>{action.error}</Alert>}
      {!isReady ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading computers...
        </p>
      ) : environments.length === 0 ? (
        <div className="py-8 text-center">
          <MonitorIcon aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 font-medium">A place for your agents</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a computer to start working there.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-label="Computers">
          {environments.map((environment) => {
            const connected =
              environment.entry.enabled && environment.connection.phase === "connected";
            const local = environment.entry.target._tag === "PrimaryConnectionTarget";
            const machineProjects = projects.filter(
              (project) =>
                project.environmentId === environment.environmentId &&
                project.workspaceRoot !== scratchWorkspaceRootFor(environment.environmentId),
            );
            const platform = environment.serverConfig?.environment.platform;
            const picking = choosingProject === environment.environmentId;
            const agentsReady = readyAgentCount(environment.serverConfig?.providers ?? []);
            return (
              <section
                key={environment.environmentId}
                aria-label={environment.label}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {platform?.arch === "arm64" && platform.os === "linux" ? (
                      <CircuitBoardIcon aria-hidden className="size-5" />
                    ) : (
                      <MonitorIcon aria-hidden className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-sm">{environment.label}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {local
                        ? "This environment"
                        : platform
                          ? `${platform.os === "linux" ? "Linux" : platform.os === "darwin" ? "macOS" : platform.os} ${platform.arch}`
                          : "Remote computer"}
                    </p>
                  </div>
                  <span
                    className={
                      connected
                        ? "rounded-full bg-primary/8 px-2 py-1 text-xs font-medium text-primary"
                        : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                    }
                  >
                    {!environment.entry.enabled
                      ? "Disabled"
                      : connectionStatusTitle(environment.connection)}
                  </span>
                </div>
                {environment.connection.error && (
                  <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {environment.connection.error}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {connected
                      ? `${agentsReady} ${agentsReady === 1 ? "agent" : "agents"} ready${machineProjects.length ? `, ${machineProjects.length} ${machineProjects.length === 1 ? "project" : "projects"}` : ""}`
                      : "Projects appear when connected"}
                  </span>
                  {!environment.entry.enabled ? (
                    <Button
                      size="sm"
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
                      size="sm"
                      variant="outline"
                      disabled={
                        action.busy ||
                        ["connecting", "reconnecting"].includes(environment.connection.phase)
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
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          to="/settings/providers"
                          search={{ machine: environment.environmentId }}
                        />
                      }
                    >
                      Set up agents
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={local ? "outline" : "default"}
                      disabled={action.busy}
                      aria-expanded={picking}
                      onClick={() => {
                        if (machineProjects.length === 0) {
                          if (scratchWorkspaceRootFor(environment.environmentId))
                            void action.act(() => startScratchThread(environment.environmentId));
                          else addProject(environment.environmentId);
                        } else if (machineProjects.length === 1)
                          void action.act(() =>
                            handleNewThread(
                              scopeProjectRef(environment.environmentId, machineProjects[0]!.id),
                            ).then(() => undefined),
                          );
                        else setChoosingProject(picking ? null : environment.environmentId);
                      }}
                    >
                      {machineProjects.length === 0 &&
                      !scratchWorkspaceRootFor(environment.environmentId)
                        ? "Add project"
                        : "Start thread"}
                      <ArrowUpRightIcon aria-hidden />
                    </Button>
                  )}
                </div>
                {connected && agentsReady === 0 && (
                  <AgentReadiness environmentId={environment.environmentId} />
                )}
                {picking && connected && (
                  <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
                    <p className="text-xs font-medium">Choose a project on {environment.label}</p>
                    {machineProjects.map((project) => (
                      <button
                        key={project.id}
                        disabled={action.busy}
                        onClick={() =>
                          void action.act(() =>
                            handleNewThread(
                              scopeProjectRef(environment.environmentId, project.id),
                            ).then(() => undefined),
                          )
                        }
                        className="flex min-w-0 items-center gap-2 rounded-lg p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                      >
                        <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{project.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {project.workspaceRoot}
                          </span>
                        </span>
                      </button>
                    ))}
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => addProject(environment.environmentId)}
                      >
                        <PlusIcon aria-hidden />
                        Add project
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each computer has its own projects and agents. Start a thread and work in the normal
        composer.
      </p>
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
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Providers need setup or a fresh status check.</span>
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

function ConnectComputer({ onClose }: { onClose: () => void }) {
  const action = useAction();
  const pair = useAtomCommand(connectPairing, { reportFailure: false });
  const [pairingUrl, setPairingUrl] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void action.act(async () => {
          const result = await pair({ pairingUrl: pairingUrl.trim() });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          setPairingUrl("");
          onClose();
        });
      }}
    >
      <div>
        <h3 className="font-medium text-sm">Connect to Loom</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Paste the pairing link from the other computer. It joins your environments, with its own
          projects and agents.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        Pairing link
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={pairingUrl}
          onChange={(event) => setPairingUrl(event.target.value)}
          placeholder="Paste a Loom pairing link"
          required
          disabled={action.busy}
        />
      </label>
      {action.error && <Alert>{action.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={action.busy || !pairingUrl.trim()}>
          <LinkIcon aria-hidden />
          {action.busy ? "Connecting..." : "Connect"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            setPairingUrl("");
          }}
          disabled={action.busy}
        >
          Cancel
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Use Manage connections for SSH or additional routes. On the other computer, run{" "}
        <code>t3 pair</code> to get a fresh link.
      </p>
    </form>
  );
}
