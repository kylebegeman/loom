import { Link } from "@tanstack/react-router";
import { MessageSquareDashedIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryErrorNotice } from "./LibraryControls";
import { LibrarySavedThreads } from "./LibrarySavedThreads";
import { projectLibrary, useLibraryAuthority } from "./state";
import { useNoProjectStart } from "./useNoProjectStart";

/** A history authority opens conversations without pretending to be an execution computer. */
export function LibraryThreadHome() {
  const library = useLibraryAuthority();
  const index = useEnvironmentQuery(
    library.authorityId
      ? projectLibrary.threadIndex({ environmentId: library.authorityId, input: { limit: 100 } })
      : null,
  );
  // This page replaces the no-projects home, so it keeps that page's way to start without one.
  const noProject = useNoProjectStart();
  const [startingScratch, setStartingScratch] = useState(false);
  const startWithoutProject = async () => {
    if (!noProject || startingScratch) return;
    setStartingScratch(true);
    try {
      await noProject.start();
    } finally {
      setStartingScratch(false);
    }
  };
  const noProjectNote = noProject
    ? ` Without a project, new work starts on ${noProject.label}.`
    : null;
  const startWithoutProjectButton = noProject ? (
    <Button
      size="sm"
      variant="outline"
      disabled={startingScratch}
      aria-busy={startingScratch}
      onClick={() => void startWithoutProject()}
    >
      <MessageSquareDashedIcon className="size-4" />
      {startingScratch ? "Opening conversation…" : "Start without a project"}
    </Button>
  ) : null;
  // The Library may never resolve (its info request can fail), so starting without a project
  // stays reachable while it connects.
  if (!library.authorityId)
    return (
      <SidebarInset>
        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <p className="text-sm text-muted-foreground">
            <span role="status">Connecting your Library...</span>
            {noProjectNote}
          </p>
          {startWithoutProjectButton}
        </div>
      </SidebarInset>
    );
  const hasConversations = index.data?.threads.some(
    (thread) => !thread.deleted && !thread.archived,
  );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">Conversations</h1>
      </WorkspacePageHeader>
      <main className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Your saved conversations are available even when their computer is offline.
              {noProjectNote}
            </p>
            <div className="flex flex-wrap gap-2">
              {startWithoutProjectButton}
              <Button size="sm" variant="outline" render={<Link to="/projects" />}>
                Manage projects
              </Button>
            </div>
          </div>
          <LibraryErrorNotice error={index.error} onRetry={index.refresh} />
          {index.isPending && !index.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading conversations...
            </p>
          ) : hasConversations ? (
            <LibrarySavedThreads
              localThreads={[]}
              projectKeys={null}
              search=""
              showHeading={false}
            />
          ) : !index.error ? (
            <div className="space-y-2 py-8">
              <h2 className="font-medium">Start with a project</h2>
              <p className="text-sm text-muted-foreground">
                Add your brief and repositories in Projects. Choose a computer when you start a
                conversation.
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </SidebarInset>
  );
}
