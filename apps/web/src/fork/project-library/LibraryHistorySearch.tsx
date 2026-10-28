import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_SEARCH_FEATURE,
  type LibrarySearchHit,
  type LibrarySearchRequest,
} from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_SEARCH_FEED,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  LIBRARY_SEARCH_ROLE_LABELS,
  librarySearchHitKey,
  librarySearchKey,
  librarySearchRequest,
  librarySnippetParts,
  mergeLibrarySearchPage,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import { MessagesSquareIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { onLibraryHistorySearch, takeLibraryHistorySearch } from "./actions";
import { LIBRARY_ROW, LibraryErrorNotice, LibrarySearch } from "./LibraryControls";
import { ComputerLabel } from "./ProjectIdentity";
import { projectLibrary } from "./state";

type Capabilities = Parameters<typeof supportsLoomFeature>[0];

/**
 * Searches what was said in saved conversations, from every computer, as the Library keeps them.
 * Scoped to one project when `projectId` is set. Renders nothing until the Library can search.
 * With `query`, the page owns the field and this shows only the conversation matches, so one
 * search box can find projects and what was said in them.
 */
export function LibraryHistorySearch({
  authorityId,
  connected,
  capabilities,
  projectId,
  hostLabel,
  projectTitle,
  query,
  onQueryChange,
  inputRef: sharedInputRef,
}: {
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly capabilities: Capabilities;
  readonly projectId?: string;
  readonly hostLabel: (id: EnvironmentId) => string;
  /** Names each hit's project. Omit when every hit is in the page's own project. */
  readonly projectTitle?: (id: string) => string;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  /** The page's own field, focused by the command palette's Search project history. */
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [ownText, setText] = useState("");
  const text = query ?? ownText;
  const sent = useDebouncedValue(text, LIBRARY_SEARCH_DEBOUNCE_MS);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = sharedInputRef ?? ownInputRef;
  const supported = supportsLoomFeature(capabilities, LIBRARY_SEARCH_FEATURE);
  // The command palette's Search project history lands here, whether or not this page was open.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for command palette history search requests and unsubscribes on unmount
  useEffect(() => {
    if (!supported) return;
    const focus = () => {
      const request = takeLibraryHistorySearch(projectId);
      if (!request) return;
      (onQueryChange ?? setText)(request.query);
      inputRef.current?.focus();
    };
    focus();
    return onLibraryHistorySearch(focus);
  }, [supported, projectId, inputRef, onQueryChange]);
  if (!supported) return null;
  const scope = projectId ? { projectId } : {};
  // Clearing the field hides results at once; new words wait for typing to pause.
  const typed = librarySearchRequest(text, scope);
  const request = typed ? librarySearchRequest(sent, scope) : null;
  const results = request ? (
    // A cursor belongs to one search, so each new search starts its results over.
    <SearchResults
      key={librarySearchKey(request)}
      request={request}
      authorityId={authorityId}
      connected={connected}
      hostLabel={hostLabel}
      projectTitle={projectTitle}
    />
  ) : typed ? (
    <p role="status" className="py-2 text-xs text-muted-foreground">
      Searching saved history...
    </p>
  ) : null;
  if (query !== undefined)
    return results ? (
      <section aria-label="Mentioned in conversations" className="flex min-w-0 flex-col gap-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <MessagesSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Mentioned in conversations
        </h2>
        {results}
      </section>
    ) : null;
  return (
    <section aria-label="Search history" className="flex min-w-0 flex-col gap-2">
      <LibrarySearch
        value={text}
        onChange={setText}
        inputRef={inputRef}
        placeholder={
          projectId
            ? "Search what was said in this project"
            : "Search what was said in every project"
        }
        label={projectId ? "Search this project's history" : "Search project history"}
      />
      {results}
    </section>
  );
}

function SearchResults({
  request,
  authorityId,
  connected,
  hostLabel,
  projectTitle,
}: {
  readonly request: LibrarySearchRequest;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly projectTitle: ((id: string) => string) | undefined;
}) {
  const [feed, setFeed] = useState(EMPTY_LIBRARY_SEARCH_FEED);
  // The cursor of the page being read after the first, if any. One page at a time.
  const [reading, setReading] = useState<string | null>(null);
  const first = useEnvironmentQuery(
    projectLibrary.search({ environmentId: authorityId, input: request }),
  );
  const more = useEnvironmentQuery(
    reading === null
      ? null
      : projectLibrary.search({
          environmentId: authorityId,
          input: { ...request, cursor: reading },
        }),
  );
  // Each page merges once, while rendering, as it arrives.
  const firstPage = first.data;
  const [mergedFirst, setMergedFirst] = useState<typeof firstPage>(null);
  if (firstPage !== mergedFirst) {
    setMergedFirst(firstPage);
    if (firstPage) setFeed((current) => mergeLibrarySearchPage(current, firstPage));
  }
  const morePage = more.data;
  const [mergedMore, setMergedMore] = useState<{
    page: typeof morePage;
    reading: typeof reading;
  }>({ page: null, reading: null });
  if (morePage !== mergedMore.page || reading !== mergedMore.reading) {
    setMergedMore({ page: morePage, reading });
    if (morePage && reading !== null)
      setFeed((current) => mergeLibrarySearchPage(current, morePage, reading));
  }

  const cursor = feed.nextCursor;
  if (cursor === undefined) {
    return first.error ? (
      <LibraryErrorNotice error={first.error} onRetry={first.refresh} />
    ) : (
      <p role="status" className="py-2 text-xs text-muted-foreground">
        {connected ? "Searching saved history..." : "Connect your Library to search saved history."}
      </p>
    );
  }
  if (!feed.hits.length) {
    return (
      <p role="status" className="py-2 text-xs text-muted-foreground">
        {request.projectId
          ? `Nothing saved in this project matches "${request.query}".`
          : `Nothing saved matches "${request.query}".`}
      </p>
    );
  }
  const loadingMore = reading !== null && reading === cursor && more.isPending;
  return (
    <div className="flex flex-col gap-1">
      <ol aria-label="Search results" className="flex flex-col gap-0.5">
        {feed.hits.map((hit) => (
          <li key={librarySearchHitKey(hit)}>
            <SearchHit hit={hit} hostLabel={hostLabel} projectTitle={projectTitle} />
          </li>
        ))}
      </ol>
      {cursor === null ? null : more.error && reading === cursor ? (
        <LibraryErrorNotice error={more.error} onRetry={more.refresh} />
      ) : (
        <div>
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={loadingMore}
            onClick={() => setReading(cursor)}
          >
            {loadingMore ? "Loading..." : "Show more results"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SearchHit({
  hit,
  hostLabel,
  projectTitle,
}: {
  readonly hit: LibrarySearchHit;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly projectTitle: ((id: string) => string) | undefined;
}) {
  return (
    <Link
      to="/library/conversations/$conversationId"
      params={{ conversationId: hit.id }}
      search={{ item: hit.itemId, position: hit.position }}
      className={`${LIBRARY_ROW} flex flex-col gap-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      <span className="truncate text-sm font-medium">
        {hit.title.trim() || "Untitled conversation"}
      </span>
      {/* Snippets come from other computers' history: text only, with matches as plain marks. */}
      <span className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
        {snippetRuns(hit).map(({ at, text, match }) =>
          match ? (
            <mark key={at} className="bg-transparent font-semibold text-foreground">
              {text}
            </mark>
          ) : (
            <Fragment key={at}>{text}</Fragment>
          ),
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {projectTitle ? (
          <>
            <span className="truncate text-foreground">{projectTitle(hit.projectId)}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <ComputerLabel environmentId={hit.environmentId} label={hostLabel(hit.environmentId)} />
        <span aria-hidden>·</span>
        <span>
          {LIBRARY_SEARCH_ROLE_LABELS[hit.role]} ·{" "}
          <time dateTime={hit.occurredAt}>{formatRelativeTimeLabel(hit.occurredAt)}</time>
          {hit.archived ? " · Archived" : null}
          {/* Only a Library with semantic search sets `match`; these hits have no marked words. */}
          {hit.match === "semantic" ? " · Similar meaning" : null}
        </span>
      </span>
    </Link>
  );
}

/** Snippet parts keyed by where each starts, which is unique within one snippet. */
function snippetRuns(hit: LibrarySearchHit) {
  let at = 0;
  return librarySnippetParts(hit.snippet, hit.highlights).map((part) => {
    const run = { ...part, at };
    at += part.text.length;
    return run;
  });
}
