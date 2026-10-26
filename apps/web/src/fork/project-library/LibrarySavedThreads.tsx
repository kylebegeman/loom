import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
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
  if (!threads.length) return null;
  return (
    <section className="space-y-1 py-3" aria-label="Saved conversations">
      {showHeading ? (
        <h2 className="px-2 text-xs font-medium text-muted-foreground">Saved conversations</h2>
      ) : null}
      {threads.map((thread) => (
        <Link
          key={thread.id}
          to="/library/conversations/$conversationId"
          params={{ conversationId: thread.id }}
          className="flex items-start gap-2 rounded-md px-2 py-3 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <MessageSquareIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm">{thread.title || "Untitled conversation"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {titles.get(thread.projectId) ?? "Project"}
            </p>
          </div>
        </Link>
      ))}
      {index.data?.nextOffset !== null ? (
        <Link
          to="/projects"
          className="block px-2 py-2 text-xs text-muted-foreground underline underline-offset-4"
        >
          Browse earlier conversations by project
        </Link>
      ) : null}
    </section>
  );
}
