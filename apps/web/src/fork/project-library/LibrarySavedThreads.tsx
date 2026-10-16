import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryProjects } from "./state";

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
      ? projectLibrary.threadIndex({ environmentId: library.authorityId, input: { limit: 100 } })
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
  const query = search.trim().toLocaleLowerCase();
  const threads =
    index.data?.threads.filter(
      (t) =>
        !t.archived &&
        !t.deleted &&
        !local.has(`${t.environmentId}:${t.threadId}`) &&
        (!projectKeys || projectKeys.has(`${t.environmentId}:${t.localProjectId}`)) &&
        (!query ||
          `${t.title} ${titles.get(t.projectId) ?? ""}`.toLocaleLowerCase().includes(query)),
    ) ?? [];
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
