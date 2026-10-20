import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react"; // fork: library-only
import { primaryServerConfigAtom } from "~/state/server"; // fork: library-only
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"; // fork: fleet-connections
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { LibraryThreadHome } from "~/fork/project-library/LibraryThreadHome"; // fork: library-only
import { useLibraryAuthority } from "~/fork/project-library/state"; // fork: library-only
import { Button } from "../components/ui/button";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  readProject,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useConnectedEnvironmentIds, useEnvironments } from "../state/environments"; // fork: fleet-connections
import { resolveIndexDraftProject } from "../lib/indexDraftLanding"; // fork: fleet-connections

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  // fork: library-only
  const { authGateState } = Route.useRouteContext();
  const library = useLibraryAuthority();
  const primaryConfig = useAtomValue(primaryServerConfigAtom);
  const primaryReady = authGateState.status === "hosted-static" || primaryConfig !== null;
  const libraryOnly =
    primaryConfig?.environment.capabilities.libraryAuthority === true &&
    primaryConfig.environment.capabilities.supportsExecution === false;
  const projects = useProjects();
  const threads = useThreadShells();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  // fork: fleet-connections Only connected computers that can run agents start a draft.
  const executionEnvironments = connectedEnvironmentIds.filter(
    (id) =>
      environments.find((entry) => entry.environmentId === id)?.serverConfig?.environment
        .capabilities.supportsExecution !== false,
  );
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
  // Read at effect time: this page stays mounted while a navigation away from
  // "/" is still loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const startedAttemptRef = useRef<number | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const mostRecentProject =
    primaryReady && !libraryOnly // fork: library-only
      ? resolveIndexDraftProject(projects, threads, executionEnvironments) // fork: fleet-connections
      : null;
  const attempt = startState.retryRequest;

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    if (mostRecentProject === null || startedAttemptRef.current === attempt || !isStillOnIndex()) {
      return;
    }
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      return;
    }
    startedAttemptRef.current = attempt;
    void handleNewThread(projectRef, { replace: true })
      .then((opened) => {
        if (opened === null) {
          setStartState((state) => ({ ...state, retryRequest: state.retryRequest + 1 }));
        }
      })
      .catch(() => {
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [attempt, handleNewThread, mostRecentProject]);

  if (mostRecentProject !== null) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  // A pending environment cannot prove the workspace is empty.
  if (!bootstrapped) return null;
  // fork: library-only
  return libraryOnly || library.authorityId ? (
    <LibraryThreadHome />
  ) : (
    <NoProjectsHero savedProjectsUnavailable={projects.length > 0} /> // fork: fleet-connections
  );
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
            {/* fork: fleet-connections */}
            <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
              Open connections
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
