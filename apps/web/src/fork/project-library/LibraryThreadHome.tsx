import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryErrorNotice } from "./LibraryControls";
import { LibrarySavedThreads } from "./LibrarySavedThreads";
import { projectLibrary, useLibraryAuthority } from "./state";

/** A history authority opens conversations without pretending to be an execution computer. */
export function LibraryThreadHome() {
  const library = useLibraryAuthority();
  const index = useEnvironmentQuery(
    library.authorityId
      ? projectLibrary.threadIndex({ environmentId: library.authorityId, input: { limit: 100 } })
      : null,
  );
  if (!library.authorityId)
    return (
      <SidebarInset>
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Connecting your Library...
        </p>
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
            </p>
            <Button size="sm" variant="outline" render={<Link to="/projects" />}>
              Manage projects
            </Button>
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
