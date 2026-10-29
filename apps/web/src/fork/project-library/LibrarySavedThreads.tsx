import { RecentlyDeletedConversations, useRecentlyDeletedSupported } from "./RecentlyDeleted";
import { useId, useMemo, useState } from "react";
import * as Schema from "effect/Schema";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { LibraryErrorNotice } from "./LibraryControls";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { Button, InlineButton } from "~/components/ui/button";
import { libraryOutsideArchivedProjects } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";
import { useEnvironmentQuery } from "~/state/query";
import { LIBRARY_THREAD_INDEX_LIMIT, projectLibrary, useLibraryProjects } from "./state";

/**
 * Saved conversations worth listing: not archived, deleted, open from a computer already, or in an
 * archived project. `projects` must include archived ones.
 */
export function librarySavedThreadsToList(
  threads: readonly LibraryThreadSummary[],
  projects: readonly LibraryProject[],
  filter: {
    readonly local?: ReadonlySet<string>;
    readonly projectKeys?: ReadonlySet<string> | null;
    readonly search?: string;
  } = {},
) {
  const query = filter.search?.trim().toLocaleLowerCase() ?? "";
  const titles = query ? new Map(projects.map((p) => [p.id, p.title])) : null;
  return libraryOutsideArchivedProjects(threads, projects).filter(
    (t) =>
      !t.archived &&
      !t.deleted &&
      !filter.local?.has(`${t.environmentId}:${t.threadId}`) &&
      (!filter.projectKeys || filter.projectKeys.has(`${t.environmentId}:${t.localProjectId}`)) &&
      (!titles ||
        `${t.title} ${titles.get(t.projectId) ?? ""}`.toLocaleLowerCase().includes(query)),
  );
}

/** Uploaded threads appear in normal navigation even without a connection to their source computer. */
export function LibrarySavedThreads({
  localThreads,
  projectKeys,
  search,
  showHeading = true,
}: {
  readonly localThreads: readonly {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
  }[];
  readonly projectKeys: ReadonlySet<string> | null;
  readonly search: string;
  readonly showHeading?: boolean;
}) {
  const library = useLibraryProjects(true);
  const deletedSupported = useRecentlyDeletedSupported();
  const [showDeleted, setShowDeleted] = useState(false);
  const [savedExpanded, setSavedExpanded] = useLocalStorage(
    "loom:sidebar-saved-expanded",
    false,
    Schema.Boolean,
  );
  const [deletedExpanded, setDeletedExpanded] = useLocalStorage(
    "loom:sidebar-deleted-expanded",
    false,
    Schema.Boolean,
  );
  const savedContentId = useId();
  const deletedContentId = useId();
  const index = useEnvironmentQuery(
    library.authorityId
      ? projectLibrary.threadIndex({
          environmentId: library.authorityId,
          input: { limit: LIBRARY_THREAD_INDEX_LIMIT },
        })
      : null,
  );
  const local = useMemo(
    () => new Set(localThreads.map((t) => `${t.environmentId}:${t.id}`)),
    [localThreads],
  );
  const titles = useMemo(
    () => new Map(library.query.data?.map((p) => [p.id, p.title]) ?? []),
    [library.query.data],
  );
  const threads = librarySavedThreadsToList(index.data?.threads ?? [], library.query.data ?? [], {
    local,
    projectKeys,
    search,
  });
  const hasMore = index.data?.nextOffset != null;
  const savedContent = (
    <>
      {threads.map((thread) => (
        <Link
          key={thread.id}
          to="/library/conversations/$conversationId"
          params={{ conversationId: thread.id }}
          className="flex items-start gap-2 rounded-md px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <MessageSquareIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-sidebar-muted-foreground"
          />
          <div className="min-w-0">
            <p className="truncate text-sm">{thread.title || "Untitled conversation"}</p>
            <p className="mt-0.5 truncate text-xs text-secondary-label">
              {titles.get(thread.projectId) ?? "Project"}
            </p>
          </div>
        </Link>
      ))}
      {hasMore ? (
        <p className="px-(--sidebar-row-content-inset) py-2 text-xs">
          <InlineButton tone="muted" render={<Link to="/projects" />}>
            Browse earlier conversations by project
          </InlineButton>
        </p>
      ) : null}
    </>
  );
  if (showHeading) {
    if (!library.authorityId) return null;
    return (
      <div className="space-y-0.5">
        <section aria-label="Saved conversations">
          <div className="mx-0.5">
            <CollapsibleSectionHeader
              expanded={savedExpanded}
              onClick={() => setSavedExpanded((value) => !value)}
              aria-controls={savedExpanded ? savedContentId : undefined}
              accessory={
                <span className="font-normal tabular-nums">
                  {index.data && (threads.length > 0 || !hasMore)
                    ? `${threads.length}${hasMore ? "+" : ""}`
                    : null}
                </span>
              }
            >
              Saved
            </CollapsibleSectionHeader>
          </div>
          {savedExpanded ? (
            <div id={savedContentId} className="space-y-0.5">
              <LibraryErrorNotice error={index.error} onRetry={index.refresh} />
              {index.isPending && !index.data ? (
                <p
                  role="status"
                  className="px-(--sidebar-row-content-inset) py-2 text-xs text-sidebar-muted-foreground"
                >
                  Loading saved conversations...
                </p>
              ) : index.isSuccess && !threads.length && !hasMore ? (
                <p className="px-(--sidebar-row-content-inset) py-2 text-xs text-sidebar-muted-foreground">
                  {search.trim() ? "No matching saved conversations." : "No saved conversations."}
                </p>
              ) : null}
              {savedContent}
            </div>
          ) : null}
        </section>
        {deletedSupported ? (
          <section aria-label="Recently deleted conversations">
            <div className="mx-0.5">
              <CollapsibleSectionHeader
                expanded={deletedExpanded}
                onClick={() => setDeletedExpanded((value) => !value)}
                aria-controls={deletedExpanded ? deletedContentId : undefined}
                accessory={<span />}
              >
                Recently deleted
              </CollapsibleSectionHeader>
            </div>
            {deletedExpanded ? (
              <div id={deletedContentId} className="space-y-0.5">
                <RecentlyDeletedConversations sidebar />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }
  if (!threads.length && !deletedSupported) return null;
  return (
    <section className="space-y-0.5 py-2" aria-label="Saved conversations">
      {deletedSupported ? (
        <div className="flex gap-2 px-2 py-1">
          <Button
            size="xs"
            variant={showDeleted ? "outline" : "secondary"}
            onClick={() => setShowDeleted(false)}
          >
            Saved
          </Button>
          <Button
            size="xs"
            variant={showDeleted ? "secondary" : "outline"}
            onClick={() => setShowDeleted(true)}
          >
            Recently deleted
          </Button>
        </div>
      ) : null}
      {showDeleted && deletedSupported ? <RecentlyDeletedConversations /> : savedContent}
    </section>
  );
}
