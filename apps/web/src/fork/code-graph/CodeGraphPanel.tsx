import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  FileCodeIcon,
  GitCompareIcon,
  MessageSquarePlusIcon,
  NetworkIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import {
  TESTED_GRAPHIFY_VERSION,
  type CodeGraphBuildMode,
  type CodeGraphImpactDepth,
  type CodeGraphNeighborhood,
  type CodeGraphNode,
  type CodeGraphStatus,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { ForkPanelProps } from "../panels/types";
import { impactSummary } from "./impactSummary";
import { NeighborhoodGraph } from "./NeighborhoodGraph";
import {
  Alert,
  CommandLine,
  EmptyNote,
  Muted,
  Section,
  failureOf,
  formatBytes,
  formatSeconds,
  plural,
  useAction,
  useNow,
  useSettled,
  valueOf,
} from "./parts";
import { appendToComposer, codeGraph, runCommand } from "./state";
import { useCodeGraphViewStore, viewOf, type CodeGraphTab, type ImpactRequest } from "./viewStore";

const TABS: ReadonlyArray<{ value: CodeGraphTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "search", label: "Search" },
  { value: "impact", label: "Impact" },
];
const DEPTHS: ReadonlyArray<CodeGraphImpactDepth> = [1, 2, 3];
const SEARCH_SETTLE_MS = 250;
const HUBS_SHOWN = 10;
const GROUPS_SHOWN = 8;
const GROUP_FILES_SHOWN = 3;
const UNKNOWN_FILES_SHOWN = 5;

const BUILD_TITLES: Record<CodeGraphBuildMode, string> = {
  full: "Building the graph",
  update: "Updating the graph",
  force: "Rebuilding the graph",
};

const hops = (depth: number) => `${depth} hop${depth === 1 ? "" : "s"}`;

function openFile(threadRef: ScopedThreadRef, path: string, line: number | null) {
  useRightPanelStore.getState().openFile(threadRef, path, line ?? undefined);
}

/** Queries answer from the graph in memory; a new build means asking again. */
function useRefreshOn(atom: Atom.Atom<unknown> | null, builtAt: string | null) {
  const seen = useRef(builtAt);
  useEffect(() => {
    if (builtAt === seen.current) return;
    seen.current = builtAt;
    if (atom) appAtomRegistry.refresh(atom);
  }, [atom, builtAt]);
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" aria-busy="true">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
      <Muted>{text}</Muted>
    </div>
  );
}

/** A symbol or file in a list: selecting it focuses it, the icon opens its file. */
function NodeRow({
  threadRef,
  node,
  detail,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  node: CodeGraphNode;
  detail?: string;
  onFocus?: (nodeId: string) => void;
}) {
  const place = `${node.file}${node.line === null ? "" : `:${node.line}`}`;
  return (
    <li className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => (onFocus ? onFocus(node.id) : openFile(threadRef, node.file, node.line))}
      >
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate">{node.label}</span>
          {detail && <span className="shrink-0 text-muted-foreground text-xs">{detail}</span>}
        </span>
        <span className="truncate text-muted-foreground text-xs">{place}</span>
      </button>
      {onFocus && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Open ${place}`}
          onClick={() => openFile(threadRef, node.file, node.line)}
        >
          <FileCodeIcon />
        </Button>
      )}
    </li>
  );
}

// --- Graph state ----------------------------------------------------------------------------

function MissingGraphify({
  threadRef,
  projectId,
  availability,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  availability: Extract<CodeGraphStatus["availability"], { _tag: "missing" }>;
}) {
  const check = useAction();
  return (
    <Section title="Graphify">
      <EmptyNote
        icon={<PackageIcon />}
        title="Graphify is not installed"
        action={
          <Button
            size="xs"
            variant="outline"
            disabled={check.busy}
            onClick={() =>
              void check.act(() =>
                runCommand(codeGraph.recheck, {
                  environmentId: threadRef.environmentId,
                  input: { projectId },
                }),
              )
            }
          >
            Check again
          </Button>
        }
      >
        Loom builds the code map with Graphify {TESTED_GRAPHIFY_VERSION}. Install it on this
        environment's host, then check again. Loom never installs it for you.
      </EmptyNote>
      <CommandLine command={availability.installHint} />
      <Muted>
        Loom looked for <code className="font-mono">{availability.command.join(" ")}</code>. You can
        change the command in Settings, under Loom.
      </Muted>
      {check.error && <Alert>{check.error}</Alert>}
    </Section>
  );
}

function GraphState({
  threadRef,
  projectId,
  status,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
}) {
  const { environmentId } = threadRef;
  const action = useAction();
  const canOperate = useAtomValue(codeGraph.build.permissionAtom(environmentId));
  const building = status.state === "building";
  const now = useNow(building);
  const disabled = !canOperate || action.busy;
  const build = (mode: CodeGraphBuildMode) =>
    void action.act(() =>
      runCommand(codeGraph.build, { environmentId, input: { projectId, mode } }),
    );
  const cancel = () =>
    void action.act(() => runCommand(codeGraph.cancel, { environmentId, input: { projectId } }));

  if (status.availability._tag === "missing")
    return (
      <MissingGraphify
        threadRef={threadRef}
        projectId={projectId}
        availability={status.availability}
      />
    );
  const hasGraph = status.builtAt !== null;
  const untested = !status.availability.tested && (
    <Muted>
      Graphify {status.availability.version} is an untested version. Loom is tested with{" "}
      {TESTED_GRAPHIFY_VERSION}, so some graphs may not load.
    </Muted>
  );
  const cancelButton = (
    <Button size="xs" variant="outline" disabled={disabled} onClick={cancel}>
      Cancel
    </Button>
  );

  if (building && status.progress)
    return (
      <Section
        title={BUILD_TITLES[status.progress.mode]}
        description={`${formatSeconds((now - Date.parse(status.progress.startedAt)) / 1000)} elapsed`}
        actions={cancelButton}
      >
        {status.progress.lastLine && (
          <p className="truncate font-mono text-muted-foreground text-xs">
            {status.progress.lastLine}
          </p>
        )}
        {hasGraph && <Muted>The previous graph answers questions until the build finishes.</Muted>}
        {untested}
        {action.error && <Alert>{action.error}</Alert>}
      </Section>
    );

  if (status.queued)
    return (
      <Section
        title="Waiting for another build"
        description="One graph builds at a time on this environment."
        actions={cancelButton}
      >
        {action.error && <Alert>{action.error}</Alert>}
      </Section>
    );

  if (!hasGraph && status.state !== "failed")
    return (
      <Section title="Graph">
        <EmptyNote
          icon={<NetworkIcon />}
          title="No code graph yet"
          action={
            <Button size="xs" disabled={disabled} onClick={() => build("full")}>
              Build graph
            </Button>
          }
        >
          Map this project's files and symbols and how they connect. Large repositories can take a
          few minutes.
        </EmptyNote>
        {untested}
        {action.error && <Alert>{action.error}</Alert>}
      </Section>
    );

  const facts = [
    status.builtAt && `Built ${formatRelativeTimeLabel(status.builtAt)}`,
    status.builtAtCommit && `at ${status.builtAtCommit.slice(0, 7)}`,
    hasGraph && plural(status.nodeCount, "node"),
    hasGraph && plural(status.edgeCount, "link"),
    hasGraph && formatBytes(status.graphBytes),
  ].filter(Boolean);
  const outdated = status.stale || status.dirty;
  return (
    <Section
      title="Graph"
      description={facts.length > 0 ? facts.join(", ") : undefined}
      actions={
        status.state === "failed" ? (
          <>
            {status.error?.shrinkRefused && (
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => build("force")}
              >
                Rebuild anyway
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => build(hasGraph ? "update" : "full")}
            >
              Try again
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant={outdated ? "outline" : "ghost"}
            disabled={disabled}
            onClick={() => build(outdated ? "update" : "full")}
          >
            {outdated ? "Update" : "Rebuild"}
          </Button>
        )
      }
    >
      {status.state === "failed" && status.error && (
        <Alert>
          <p>{status.error.summary}</p>
          {status.error.shrinkRefused && (
            <p className="mt-1">
              Graphify would not replace the graph with a much smaller one. Rebuild anyway if files
              were removed on purpose.
            </p>
          )}
          {status.error.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer">Details</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs">
                {status.error.detail}
              </pre>
            </details>
          )}
        </Alert>
      )}
      {status.state === "failed" && hasGraph && <Muted>The previous graph is still in use.</Muted>}
      {status.stale && <Muted>Built at an older commit than the project's current one.</Muted>}
      {!status.stale && status.dirty && (
        <Muted>The project has uncommitted changes since the build.</Muted>
      )}
      {untested}
      {action.error && <Alert>{action.error}</Alert>}
    </Section>
  );
}

// --- Overview -------------------------------------------------------------------------------

function AgentAccess({
  threadRef,
  projectId,
  status,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
}) {
  const { environmentId } = threadRef;
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const canOperate = useAtomValue(codeGraph.setAgentTool.permissionAtom(environmentId));
  const disabled = !canOperate || action.busy;
  return (
    <Section title="This project">
      <label className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">Let agents query the code graph for this project</span>
          <span className="text-muted-foreground text-xs">
            Agents can look up symbols, neighbors and change impact. Each answer adds to the
            conversation, so it uses tokens.
          </span>
        </span>
        <Switch
          checked={status.agentTool}
          disabled={disabled}
          onCheckedChange={(enabled) =>
            void action.act(() =>
              runCommand(codeGraph.setAgentTool, { environmentId, input: { projectId, enabled } }),
            )
          }
        />
      </label>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">
            Delete this project's graph? Building it again takes time.
          </span>
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={disabled}
            onClick={() =>
              void action.act(async () => {
                await runCommand(codeGraph.deleteGraph, { environmentId, input: { projectId } });
                setConfirming(false);
              })
            }
          >
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <div>
          <Button
            size="xs"
            variant="ghost-destructive"
            disabled={disabled}
            onClick={() => setConfirming(true)}
          >
            Delete graph
          </Button>
        </div>
      )}
      {action.error && <Alert>{action.error}</Alert>}
    </Section>
  );
}

function Overview({
  threadRef,
  projectId,
  status,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
  onFocus: (nodeId: string) => void;
}) {
  const atom = codeGraph.summary({ environmentId: threadRef.environmentId, input: { projectId } });
  useRefreshOn(atom, status.builtAt);
  const result = useAtomValue(atom);
  const summary = valueOf(result);
  const failure = failureOf(result);
  return (
    <>
      {failure ? (
        <div className="px-4 py-4">
          <Alert>{failure}</Alert>
        </div>
      ) : !summary ? (
        <Loading text="Reading the graph..." />
      ) : (
        <>
          <Section
            title="Most connected"
            description={`${plural(summary.fileCount, "file")}, ${summary.relations
              .slice(0, 3)
              .map((entry) => `${entry.count.toLocaleString()} ${entry.relation}`)
              .join(", ")}`}
          >
            <ul className="-mx-2 flex flex-col">
              {summary.hubs.slice(0, HUBS_SHOWN).map((hub) => (
                <NodeRow
                  key={hub.node.id}
                  threadRef={threadRef}
                  node={hub.node}
                  detail={plural(hub.degree, "link")}
                  onFocus={onFocus}
                />
              ))}
            </ul>
          </Section>
          {summary.communities.length > 0 && (
            <Section
              title="Groups"
              description="Symbols Graphify found tightly connected, largest first."
            >
              <ul className="flex flex-col gap-2">
                {summary.communities.slice(0, GROUPS_SHOWN).map((group) => (
                  <li key={group.community} className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {plural(group.size, "symbol")}
                    </span>
                    {group.topFiles.slice(0, GROUP_FILES_SHOWN).map((file) => (
                      <button
                        key={file}
                        type="button"
                        className="cursor-pointer truncate text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openFile(threadRef, file, null)}
                      >
                        {file}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      <AgentAccess threadRef={threadRef} projectId={projectId} status={status} />
    </>
  );
}

// --- Search ---------------------------------------------------------------------------------

function Neighbors({
  threadRef,
  hood,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  hood: CodeGraphNeighborhood;
  onFocus: (nodeId: string) => void;
}) {
  const near = new Map(
    hood.nodes.filter((entry) => entry.depth === 1).map((entry) => [entry.node.id, entry.node]),
  );
  const uses = hood.edges.flatMap((edge) => {
    const node = edge.from === hood.focus.id ? near.get(edge.to) : undefined;
    return node ? [{ node, relation: edge.relation }] : [];
  });
  const usedBy = hood.edges.flatMap((edge) => {
    const node = edge.to === hood.focus.id ? near.get(edge.from) : undefined;
    return node ? [{ node, relation: edge.relation }] : [];
  });
  const list = (title: string, entries: typeof uses) =>
    entries.length > 0 && (
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
        <ul className="-mx-2 flex flex-col">
          {entries.map(({ node, relation }) => (
            <NodeRow
              key={`${relation}:${node.id}`}
              threadRef={threadRef}
              node={node}
              detail={relation}
              onFocus={onFocus}
            />
          ))}
        </ul>
      </div>
    );
  return (
    <>
      {list("Uses", uses)}
      {list("Used by", usedBy)}
    </>
  );
}

function Focus({
  threadRef,
  projectId,
  status,
  focusId,
  onFocus,
  onClear,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
  focusId: string;
  onFocus: (nodeId: string) => void;
  onClear: () => void;
}) {
  const atom = codeGraph.neighborhood({
    environmentId: threadRef.environmentId,
    input: { projectId, nodeId: focusId, depth: 2 },
  });
  useRefreshOn(atom, status.builtAt);
  const result = useAtomValue(atom);
  const hood = valueOf(result);
  const failure = failureOf(result);
  const close = (
    <Button size="icon-xs" variant="ghost" aria-label="Close this symbol" onClick={onClear}>
      <XIcon />
    </Button>
  );
  if (failure)
    return (
      <Section title="Neighborhood" actions={close}>
        <Alert>{failure}</Alert>
      </Section>
    );
  if (!hood) return <Loading text="Finding neighbors..." />;
  const place = `${hood.focus.file}${hood.focus.line === null ? "" : `:${hood.focus.line}`}`;
  return (
    <Section
      title={hood.focus.label}
      description={place}
      actions={
        <>
          <Button
            size="xs"
            variant="outline"
            onClick={() => openFile(threadRef, hood.focus.file, hood.focus.line)}
          >
            <FileCodeIcon />
            Open file
          </Button>
          {close}
        </>
      }
    >
      {hood.nodes.length === 0 ? (
        <Muted>Nothing in the graph links to this {hood.focus.kind}.</Muted>
      ) : (
        <>
          <NeighborhoodGraph hood={hood} onFocus={onFocus} />
          {hood.truncated && <Muted>Showing the nearest neighbors only.</Muted>}
          <Neighbors threadRef={threadRef} hood={hood} onFocus={onFocus} />
        </>
      )}
    </Section>
  );
}

function SearchResults({
  threadRef,
  projectId,
  status,
  query,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
  query: string;
  onFocus: (nodeId: string) => void;
}) {
  const atom = codeGraph.search({
    environmentId: threadRef.environmentId,
    input: { projectId, query },
  });
  useRefreshOn(atom, status.builtAt);
  const result = useAtomValue(atom);
  const found = valueOf(result);
  const failure = failureOf(result);
  if (failure) return <Alert>{failure}</Alert>;
  if (!found) return <Muted>Searching...</Muted>;
  if (found.nodes.length === 0) return <Muted>No symbols or files match "{query}".</Muted>;
  return (
    <>
      <ul className="-mx-2 flex flex-col">
        {found.nodes.map((node) => (
          <NodeRow
            key={node.id}
            threadRef={threadRef}
            node={node}
            detail={node.kind}
            onFocus={onFocus}
          />
        ))}
      </ul>
      {found.truncated && <Muted>Showing the first matches. Type more to narrow them.</Muted>}
    </>
  );
}

function Search({
  threadRef,
  projectId,
  status,
  focusId,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
  focusId: string | null;
  onFocus: (nodeId: string | null) => void;
}) {
  const [text, setText] = useState("");
  const query = useSettled(text.trim(), SEARCH_SETTLE_MS);
  return (
    <>
      <Section title="Find a symbol or file">
        <Input
          type="search"
          size="sm"
          aria-label="Find a symbol or file"
          placeholder="Name of a function, class or file"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {query !== "" && (
          <SearchResults
            threadRef={threadRef}
            projectId={projectId}
            status={status}
            query={query}
            onFocus={onFocus}
          />
        )}
      </Section>
      {focusId === null ? (
        query === "" && (
          <div className="px-4 pb-4">
            <EmptyNote icon={<SearchIcon />} title="Nothing selected">
              Search, or pick a symbol in Overview, to see what it uses and what uses it.
            </EmptyNote>
          </div>
        )
      ) : (
        <Focus
          threadRef={threadRef}
          projectId={projectId}
          status={status}
          focusId={focusId}
          onFocus={onFocus}
          onClear={() => onFocus(null)}
        />
      )}
    </>
  );
}

// --- Impact ---------------------------------------------------------------------------------

function Impact({
  threadRef,
  projectId,
  status,
  request,
  onClearRequest,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  status: CodeGraphStatus;
  request: ImpactRequest | null;
  onClearRequest: () => void;
}) {
  const [depth, setDepth] = useState<CodeGraphImpactDepth>(2);
  const atom = codeGraph.impact({
    environmentId: threadRef.environmentId,
    input: {
      projectId,
      threadId: threadRef.threadId,
      depth,
      ...(request ? { files: request.files } : {}),
    },
  });
  useRefreshOn(atom, status.builtAt);
  const result = useAtomValue(atom);
  const impact = valueOf(result);
  const failure = failureOf(result);
  const scopeLabel = request?.scopeLabel ?? "the uncommitted changes";

  const body = () => {
    if (failure) return <Alert>{failure}</Alert>;
    if (!impact) return <Muted>Tracing...</Muted>;
    if (impact.seedFiles.length === 0)
      return (
        <EmptyNote icon={<GitCompareIcon />} title="No changes to trace">
          This thread's checkout has no uncommitted changes. To trace a turn, open it in the diff
          panel and use the code map button.
        </EmptyNote>
      );
    const unknown = impact.unknownFiles;
    return (
      <>
        {impact.stale && (
          <Muted>The graph was built at an older commit, so new code may be missing.</Muted>
        )}
        {unknown.length > 0 && (
          <Muted>
            Not in the graph: {unknown.slice(0, UNKNOWN_FILES_SHOWN).join(", ")}
            {unknown.length > UNKNOWN_FILES_SHOWN &&
              `, and ${unknown.length - UNKNOWN_FILES_SHOWN} more`}
            .
          </Muted>
        )}
        {impact.files.length === 0 ? (
          <Muted>Nothing else in the graph depends on these files.</Muted>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {impact.files.map((entry) => {
              const line = impact.hits.find((hit) => hit.node.file === entry.file)?.viaLine ?? null;
              return (
                <li key={entry.file}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 cursor-pointer items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openFile(threadRef, entry.file, line)}
                  >
                    <span className="truncate text-sm">{entry.file}</span>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {plural(entry.hitCount, "symbol")}, {hops(entry.minDepth)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {impact.truncated && <Muted>Showing the nearest results only.</Muted>}
      </>
    );
  };

  return (
    <Section
      title={`Impact of ${scopeLabel}`}
      description={
        impact && impact.seedFiles.length > 0
          ? `${plural(impact.seedFiles.length, "changed file")}, ${plural(impact.files.length, "file")} reached`
          : undefined
      }
      actions={
        <>
          {request && (
            <Button size="xs" variant="ghost" onClick={onClearRequest}>
              Use uncommitted changes
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Trace again"
            onClick={() => appAtomRegistry.refresh(atom)}
          >
            <RefreshCwIcon />
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Hops</span>
          <ToggleGroup
            aria-label="Hops to follow"
            value={[String(depth)]}
            onValueChange={(next) => {
              const chosen = DEPTHS.find((entry) => String(entry) === next[0]);
              if (chosen) setDepth(chosen);
            }}
          >
            {DEPTHS.map((entry) => (
              <Toggle key={entry} value={String(entry)} aria-label={hops(entry)}>
                {entry}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={!impact || impact.seedFiles.length === 0}
          onClick={() => {
            if (!impact) return;
            appendToComposer(threadRef, impactSummary(impact, scopeLabel, depth));
            toastManager.add({ type: "success", title: "Impact added to the message" });
          }}
        >
          <MessageSquarePlusIcon />
          Add to message
        </Button>
      </div>
      {body()}
    </Section>
  );
}

// --- Panel ----------------------------------------------------------------------------------

function Body({ threadRef, projectId }: { threadRef: ScopedThreadRef; projectId: ProjectId }) {
  const { environmentId } = threadRef;
  const statusResult = useAtomValue(codeGraph.status({ environmentId, input: { projectId } }));
  const status = valueOf(statusResult);
  const failure = failureOf(statusResult);
  const view = useCodeGraphViewStore((store) => viewOf(store.byThread, threadRef));
  const update = useCodeGraphViewStore((store) => store.update);
  const recheck = useAction();
  const focus = (focusId: string | null) => update(threadRef, { tab: "search", focusId });
  const ready =
    status !== null && status.availability._tag === "available" && status.builtAt !== null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-col px-4 pt-3 pb-1">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="shrink-0 font-semibold text-sm">Code map</h1>
            {status && (
              <span className="truncate text-muted-foreground text-xs">{status.projectName}</span>
            )}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Check for Graphify and the graph again"
            disabled={recheck.busy}
            onClick={() =>
              void recheck.act(() =>
                runCommand(codeGraph.recheck, { environmentId, input: { projectId } }),
              )
            }
          >
            <RefreshCwIcon />
          </Button>
        </div>
        {recheck.error && <Alert>{recheck.error}</Alert>}
      </header>
      {failure ? (
        <div className="px-4 py-4">
          <Alert>{failure}</Alert>
        </div>
      ) : !status ? (
        <Loading text="Looking for Graphify and this project's graph..." />
      ) : (
        <>
          <GraphState threadRef={threadRef} projectId={projectId} status={status} />
          {ready && (
            <>
              <div className="px-4 pt-1 pb-1">
                <ToggleGroup
                  aria-label="Code map view"
                  className="w-full"
                  value={[view.tab]}
                  onValueChange={(next) => {
                    const tab = TABS.find((entry) => entry.value === next[0]);
                    if (tab) update(threadRef, { tab: tab.value });
                  }}
                >
                  {TABS.map((tab) => (
                    <Toggle key={tab.value} value={tab.value} className="flex-1">
                      {tab.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
              {view.tab === "overview" && (
                <Overview
                  threadRef={threadRef}
                  projectId={projectId}
                  status={status}
                  onFocus={focus}
                />
              )}
              {view.tab === "search" && (
                <Search
                  threadRef={threadRef}
                  projectId={projectId}
                  status={status}
                  focusId={view.focusId}
                  onFocus={focus}
                />
              )}
              {view.tab === "impact" && (
                <Impact
                  threadRef={threadRef}
                  projectId={projectId}
                  status={status}
                  request={view.impact}
                  onClearRequest={() => update(threadRef, { impact: null })}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function CodeGraphPanel({ threadRef, visible }: ForkPanelProps) {
  const shell = useThreadShell(threadRef);
  if (!shell)
    return (
      <div className="p-3">
        <Muted>
          The code map uses this thread's project. Send a message to start the thread first.
        </Muted>
      </div>
    );
  // Hidden panels drop their status stream; a build continues on the server.
  if (!visible) return null;
  return <Body threadRef={threadRef} projectId={shell.projectId} />;
}
