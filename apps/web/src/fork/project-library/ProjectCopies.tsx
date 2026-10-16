import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  effectiveLibraryCopyHealth,
  libraryActiveCopies,
  libraryProjectTimeline,
  libraryRepositoryCanPull,
  libraryRepositoryHealthSummary,
  supportsLoomFeature,
  type LibraryProjectEvent,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  MessageSquarePlusIcon,
  MonitorIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibraryPanel } from "./LibraryControls";
import { LibraryRecoveryDownload } from "./LibraryRecoveryDownload";
import { ComputerLabel, PathLabel } from "./ProjectIdentity";
import { projectLibrary, useLibraryPermission } from "./state";

export type CopyRequest = {
  readonly strategy: "clone" | "reuse";
  readonly hostId?: EnvironmentId;
  readonly rootPath?: string;
};

type CopyStatus = { readonly label: string; readonly tone: "ready" | "quiet" | "warning" };

function copyStatus(copy: LibraryWorkingCopy, online: boolean): CopyStatus {
  if (!online) return { label: "Offline", tone: "quiet" };
  switch (copy.state) {
    case "ready":
      return { label: "Ready", tone: "ready" };
    case "preparing":
      return { label: "Preparing", tone: "quiet" };
    case "missing":
      return { label: "Folder missing", tone: "warning" };
    case "failed":
      return { label: "Copy failed", tone: "warning" };
    case "released":
      return { label: "Removed", tone: "quiet" };
  }
}

const STATUS_DOT: Record<CopyStatus["tone"], string> = {
  ready: "bg-success",
  quiet: "bg-muted-foreground/45",
  warning: "bg-warning",
};

const repositoryTitle = (project: LibraryProject, resourceId: string) =>
  project.resources.find((resource) => resource.id === resourceId)?.title ?? resourceId;

/**
 * The last health the copy's computer published to the Library, aged by when the Library last
 * heard from that computer. Renders nothing when the computer never reported.
 */
function PublishedCopyHealth({
  project,
  copy,
  lastSeenAt,
  offlineLabel,
}: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
  readonly lastSeenAt: string | undefined;
  /** The computer's name when it is not connected here. */
  readonly offlineLabel: string | null;
}) {
  const effective = effectiveLibraryCopyHealth({ copy, live: null, lastSeenAt });
  if (effective === null) return null;
  const { repositories } = effective.health;
  const named = repositories.length > 1;
  return (
    <div className="space-y-0.5">
      {repositories.map((repository, index) => (
        <p
          key={repository.resourceId}
          className={cn(
            "min-w-0 truncate text-xs",
            repository.error ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {named ? (
            <span className="text-foreground">
              {repositoryTitle(project, repository.resourceId)} ·{" "}
            </span>
          ) : null}
          {libraryRepositoryHealthSummary(repository)}
          {index === repositories.length - 1 ? (
            <span>
              {" "}
              · as of {formatRelativeTimeLabel(effective.asOf)}
              {offlineLabel === null ? null : ` · ${offlineLabel} offline`}
            </span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

/**
 * Live branch and change counts for a ready copy, read on its own computer. Only rendered when
 * that computer is connected and advertises copy health, so older computers show nothing. Until
 * the live read arrives, or when it fails, the last published health stands in.
 */
function CopyHealth({
  project,
  copy,
  published,
  lastSeenAt,
}: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
  /** The Library keeps published health, so it can stand in for the live read. */
  readonly published: boolean;
  readonly lastSeenAt: string | undefined;
}) {
  const health = useEnvironmentQuery(
    projectLibrary.copyHealth({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id },
    }),
  );
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const canPull = useLibraryPermission(vcsEnvironment.pull, copy.environmentId);
  const refreshRemote = useAtomCommand(projectLibrary.refreshCopyHealth, { reportFailure: false });
  // The server checks the same read scope it uses for vcs.refreshStatus.
  const canRefreshRemote = useEnvironmentScope(copy.environmentId, AuthOrchestrationReadScope);
  const [pulling, setPulling] = useState<string | null>(null);
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = pulling !== null || checkingRemote;
  const pullRepository = async (resourceId: string, cwd: string) => {
    setPulling(resourceId);
    setActionError(null);
    const result = await pull({ environmentId: copy.environmentId, input: { cwd } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setActionError(cause instanceof Error ? cause.message : "Could not pull the latest changes.");
    }
    setPulling(null);
    health.refresh();
  };
  const checkRemote = async () => {
    setCheckingRemote(true);
    setActionError(null);
    const result = await refreshRemote({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, refreshRemote: true },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setActionError(cause instanceof Error ? cause.message : "Could not check the remote.");
    } else if (result.value.repositories.some((repository) => repository.fetchFailed)) {
      setActionError("Could not reach the remote. Counts are from the last fetch.");
    }
    setCheckingRemote(false);
    // The fetch updated the remote refs, so a plain read now shows the new counts.
    health.refresh();
  };
  const data = health.data;
  if (
    data === null &&
    published &&
    effectiveLibraryCopyHealth({ copy, live: null, lastSeenAt }) !== null
  )
    return (
      <PublishedCopyHealth
        project={project}
        copy={copy}
        lastSeenAt={lastSeenAt}
        offlineLabel={null}
      />
    );
  if (data === null)
    return health.error ? (
      <p className="text-xs text-muted-foreground">Could not check this copy.</p>
    ) : health.isPending ? (
      <p role="status" className="text-xs text-muted-foreground">
        Checking repositories...
      </p>
    ) : null;
  const named = data.repositories.length > 1;
  return (
    <div className="space-y-0.5">
      {data.repositories.map((repository, index) => {
        const title = repositoryTitle(project, repository.resourceId);
        const cwd = copy.repositories.find(
          (entry) => entry.resourceId === repository.resourceId,
        )?.path;
        return (
          <div key={repository.resourceId} className="flex min-w-0 items-center gap-2 text-xs">
            <p
              className={cn(
                "min-w-0 truncate",
                repository.error ? "text-warning-foreground" : "text-muted-foreground",
              )}
            >
              {named ? <span className="text-foreground">{title} · </span> : null}
              {libraryRepositoryHealthSummary(repository)}
              {index === data.repositories.length - 1 ? (
                <span> · checked {formatRelativeTimeLabel(data.checkedAt)}</span>
              ) : null}
            </p>
            {cwd !== undefined && canPull && libraryRepositoryCanPull(repository) ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => void pullRepository(repository.resourceId, cwd)}
              >
                {pulling === repository.resourceId ? "Pulling..." : "Pull"}
              </Button>
            ) : null}
            {index === data.repositories.length - 1 && canRefreshRemote ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => void checkRemote()}
              >
                {checkingRemote ? "Checking..." : "Check remote"}
              </Button>
            ) : null}
          </div>
        );
      })}
      {actionError ? <p className="text-xs text-warning-foreground">{actionError}</p> : null}
    </div>
  );
}

/** The two ways to put a project on a computer, shared by the panel header and the setup steps. */
export function GetCopyMenu({
  disabled,
  label = "Get a copy",
  variant = "ghost",
  onGetCopy,
}: {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly variant?: "ghost" | "outline" | "default";
  readonly onGetCopy: (request: CopyRequest) => void;
}) {
  return (
    <Menu>
      <MenuTrigger disabled={disabled} render={<Button shape="pill" size="xs" variant={variant} />}>
        {label}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuItem onClick={() => onGetCopy({ strategy: "clone" })}>Clone to a computer</MenuItem>
        <MenuItem onClick={() => onGetCopy({ strategy: "reuse" })}>
          Use a folder I already have
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * Where the project currently lives on disk. A copy is disposable: get one to work, remove it
 * when done. Conversations and the project itself never depend on a copy staying around.
 */
export function ProjectCopies({
  project,
  copies,
  loading,
  error,
  onRetry,
  canAct,
  canStart,
  hostLabel,
  hostConnected,
  lastSeenAt,
  publishedHealth,
  onGetCopy,
  onStart,
  onRemove,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly canAct: boolean;
  readonly canStart: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  /** When the Library last heard from a computer. */
  readonly lastSeenAt: (id: EnvironmentId) => string | undefined;
  /** The Library keeps the health each computer publishes for its copies. */
  readonly publishedHealth: boolean;
  readonly onGetCopy: (request: CopyRequest) => void;
  readonly onStart: (copy: LibraryWorkingCopy) => void;
  readonly onRemove: (copy: LibraryWorkingCopy) => void;
}) {
  const active = libraryActiveCopies(copies);
  const { environments } = useEnvironments();
  const supportsHealth = (id: EnvironmentId) =>
    supportsLoomFeature(
      environments.find((entry) => entry.environmentId === id)?.serverConfig?.environment
        .capabilities,
      LIBRARY_COPY_HEALTH_FEATURE,
    );
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (path) =>
      toastManager.add({ type: "success", title: "Path copied", description: path }),
  });
  return (
    <LibraryPanel
      title="On your computers"
      count={active.length}
      action={canAct && active.length ? <GetCopyMenu label="Add" onGetCopy={onGetCopy} /> : null}
    >
      {error ? (
        <div className="px-3.5">
          <LibraryErrorNotice error={error} onRetry={onRetry} />
        </div>
      ) : null}
      {active.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {active.map((copy) => {
            const online = hostConnected(copy.environmentId);
            const status = copyStatus(copy, online);
            const label = hostLabel(copy.environmentId);
            return (
              <li
                key={copy.id}
                className="space-y-1 py-2.5 ps-3.5 pe-2 transition-colors duration-150 hover:bg-accent/40"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ComputerLabel
                    environmentId={copy.environmentId}
                    label={label}
                    className="min-w-0 shrink text-sm font-medium text-foreground"
                  />
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", STATUS_DOT[status.tone])}
                    />
                    <span className={status.tone === "warning" ? "text-warning-foreground" : ""}>
                      {status.label}
                    </span>
                  </span>
                  <span className="ms-auto flex shrink-0 items-center">
                    {copy.state === "ready" ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              shape="pill"
                              size="icon-xs"
                              variant="ghost"
                              disabled={!canStart || !online}
                              aria-label={`Start a conversation on ${label}`}
                              onClick={() => onStart(copy)}
                            />
                          }
                        >
                          <MessageSquarePlusIcon />
                        </TooltipTrigger>
                        <TooltipPopup side="top">Start a conversation here</TooltipPopup>
                      </Tooltip>
                    ) : null}
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            shape="pill"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Actions for the copy on ${label}`}
                          />
                        }
                      >
                        <EllipsisIcon />
                      </MenuTrigger>
                      <MenuPopup side="bottom" align="end">
                        <MenuItem
                          disabled={copy.state !== "ready" || !canStart || !online}
                          onClick={() => onStart(copy)}
                        >
                          Start a conversation here
                        </MenuItem>
                        <MenuItem onClick={() => copyToClipboard(copy.rootPath, copy.rootPath)}>
                          Copy path
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          variant="destructive"
                          disabled={!canAct}
                          onClick={() => onRemove(copy)}
                        >
                          {copy.ownership === "borrowed" ? "Stop using this folder" : "Remove copy"}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </span>
                </div>
                <PathLabel path={copy.rootPath} className="-ms-1.5" />
                {copy.state !== "ready" ? null : online && supportsHealth(copy.environmentId) ? (
                  <CopyHealth
                    project={project}
                    copy={copy}
                    published={publishedHealth}
                    lastSeenAt={lastSeenAt(copy.environmentId)}
                  />
                ) : publishedHealth ? (
                  <PublishedCopyHealth
                    project={project}
                    copy={copy}
                    lastSeenAt={lastSeenAt(copy.environmentId)}
                    offlineLabel={online ? null : label}
                  />
                ) : null}
                {copy.projectRevision !== project.revision && copy.state === "ready" ? (
                  <p className="text-xs text-muted-foreground">
                    From an earlier version of the project
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <p role="status" className="px-3.5 pb-3 text-xs text-muted-foreground">
          Checking your computers...
        </p>
      ) : error ? null : (
        <div className="flex flex-col items-start gap-3 px-3.5 pb-3.5">
          <div className="flex items-start gap-2.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent">
              <MonitorIcon aria-hidden className="size-3.5" />
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Not on a computer right now. Get a copy when you want to work and remove it when
              you're done. Conversations stay either way.
            </p>
          </div>
          {canAct ? <GetCopyMenu variant="outline" onGetCopy={onGetCopy} /> : null}
        </div>
      )}
    </LibraryPanel>
  );
}

/** A quiet record of copies coming and going, folded away until someone needs it. */
export function ProjectHistory({
  project,
  copies,
  authorityId,
  connected,
  canAct,
  hostLabel,
  hostConnected,
  onReuse,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly canAct: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onReuse: (request: CopyRequest) => void;
}) {
  const events = libraryProjectTimeline(project, copies);
  const anyRemoved = events.some((event) => event.kind === "copy-removed");
  return (
    <details className="group/fold overflow-hidden rounded-xl border border-border bg-card">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3.5 py-1.5 outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold tracking-tight">History</span>
        <span className="text-xs tabular-nums text-muted-foreground">{events.length}</span>
        <ChevronRightIcon
          aria-hidden
          className="ms-auto size-3.5 text-muted-foreground transition-transform duration-150 group-open/fold:rotate-90"
        />
      </summary>
      <ol className="space-y-3 border-t border-border px-3.5 py-3">
        {events.map((event) => (
          <li
            key={`${event.kind}:${"copy" in event ? event.copy.id : ""}`}
            className="flex gap-2.5"
          >
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                event.kind === "copy-failed"
                  ? "bg-warning"
                  : event.kind === "created"
                    ? "bg-(--project-color)"
                    : "bg-muted-foreground/45",
              )}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs leading-relaxed">
                {describe(event, hostLabel)}
                <span className="ms-1.5 text-muted-foreground">
                  {formatRelativeTimeLabel(event.at)}
                </span>
              </p>
              {"copy" in event ? (
                <PathLabel path={event.copy.rootPath} className="-ms-1.5" />
              ) : null}
              {event.kind === "copy-removed" &&
              event.copy.ownership === "managed" &&
              event.copy.recovery ? (
                <LibraryRecoveryDownload
                  authorityId={authorityId}
                  connected={connected}
                  copy={event.copy}
                />
              ) : null}
              {event.kind === "copy-removed" && event.copy.ownership === "borrowed" ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={!canAct || !hostConnected(event.environmentId)}
                  onClick={() =>
                    onReuse({
                      strategy: "reuse",
                      hostId: event.environmentId,
                      rootPath: event.copy.rootPath,
                    })
                  }
                >
                  Use this folder again
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {anyRemoved ? (
        <p className="px-3.5 pb-3 text-xs text-muted-foreground">
          Removing a copy never touches conversations. Folders you brought stay on disk.
        </p>
      ) : null}
    </details>
  );
}

function describe(event: LibraryProjectEvent, hostLabel: (id: EnvironmentId) => string) {
  switch (event.kind) {
    case "created":
      return "Project created";
    case "copy-added":
      return event.copy.ownership === "borrowed"
        ? `Started using a folder on ${hostLabel(event.environmentId)}`
        : `Cloned to ${hostLabel(event.environmentId)}`;
    case "copy-removed":
      return event.copy.ownership === "borrowed"
        ? `Stopped using the folder on ${hostLabel(event.environmentId)}`
        : `Removed the copy from ${hostLabel(event.environmentId)}`;
    case "copy-failed":
      return `Copy failed on ${hostLabel(event.environmentId)}`;
  }
}
