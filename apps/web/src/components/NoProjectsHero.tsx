import { Link } from "@tanstack/react-router"; // fork: fleet-connections
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { MessageSquareDashedIcon, PlusIcon } from "lucide-react";
import { useState } from "react"; // fork: fleet-connections

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { useScratchProject } from "../hooks/useScratchProject";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments"; // fork: fleet-connections
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

// fork: fleet-connections
export function NoProjectsHero({
  savedProjectsUnavailable = false,
}: {
  readonly savedProjectsUnavailable?: boolean;
}) {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  // fork: fleet-connections
  const scratchComputer = useEnvironment(scratchTargetEnvironmentId);
  const [startingScratch, setStartingScratch] = useState(false);
  const startWithoutProject = async () => {
    if (scratchTargetEnvironmentId === null || startingScratch) return;
    setStartingScratch(true);
    await startScratchThread(scratchTargetEnvironmentId).finally(() => setStartingScratch(false));
  };

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty size="hero" className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              {/* fork: fleet-connections */}
              <EmptyTitle>
                {savedProjectsUnavailable
                  ? "Reconnect to your projects"
                  : "What should we work on?"}
              </EmptyTitle>
              <EmptyDescription>
                {/* fork: fleet-connections */}
                {savedProjectsUnavailable
                  ? "Open connections to reconnect. Your saved conversations are still in the sidebar."
                  : scratchTargetEnvironmentId === null
                    ? "Choose a computer and add a project to start your first conversation."
                    : "Add a project, or start without one."}
              </EmptyDescription>
              {/* fork: fleet-connections */}
              {scratchComputer === null ? null : (
                <EmptyDescription>New work starts on {scratchComputer.label}.</EmptyDescription>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
                {scratchTargetEnvironmentId === null ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={startingScratch} // fork: fleet-connections
                    aria-busy={startingScratch}
                    onClick={() => void startWithoutProject()}
                  >
                    <MessageSquareDashedIcon className="size-4" />
                    {/* fork: fleet-connections */}
                    {startingScratch ? "Opening conversation…" : "Start without a project"}
                  </Button>
                )}
              </div>
              {/* fork: fleet-connections */}
              <div className="mt-3">
                <Button size="sm" variant="ghost" render={<Link to="/settings/connections" />}>
                  Open connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
