import { Link } from "@tanstack/react-router";
import { useSettingsProjectGroups } from "~/components/settings/useSettingsProjectGroups";
import { AuthOrchestrationReadScope, EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_FILE_LIFECYCLE_FEATURE,
  type LibraryProject,
  type LibraryRepositoryHealth,
  LibraryWorkingCopy,
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
import * as Schema from "effect/Schema";
import { useRef, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquarePlusIcon,
  MonitorIcon,
} from "lucide-react";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { cn, randomUUID } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  LIBRARY_SURFACE,
  LibraryErrorNotice,
  LibraryPanel,
  LibrarySection,
  LibraryStateBadge,
} from "./LibraryControls";
import { LibraryRecoveryDownload } from "./LibraryRecoveryDownload";
import { useLibraryAttempt } from "./attempts";
import { ExistingFolderStorage } from "./ExistingFolderStorage";
import { TemporaryResources } from "./TemporaryResources";
import { CopyProfileSetup } from "./ProfileReadiness";
import { ComputerIcon, ComputerTile, PathLabel } from "./ProjectIdentity";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";

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
      return { label: "Could not prepare files", tone: "warning" };
    case "released":
      return { label: "Removed", tone: "quiet" };
  }
}

const STATUS_TONES = { ready: "success", quiet: "neutral", warning: "warning" } as const;

function CopyStatusLabel({ status }: { readonly status: CopyStatus }) {
  return <LibraryStateBadge tone={STATUS_TONES[status.tone]}>{status.label}</LibraryStateBadge>;
}

const repositoryTitle = (project: LibraryProject, resourceId: string) =>
  project.resources.find((resource) => resource.id === resourceId)?.title ?? resourceId;

/** One row per repository in the copy, then when the counts were read and what to do next. */
function RepositoryHealthList({
  project,
  repositories,
  renderAction,
  footer,
}: {
  readonly project: LibraryProject;
  readonly repositories: readonly LibraryRepositoryHealth[];
  readonly renderAction?: (repository: LibraryRepositoryHealth) => ReactNode;
  readonly footer: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <ul
        aria-label="Repositories"
        className="divide-y divide-border rounded-lg border border-border"
      >
        {repositories.map((repository) => (
          <li
            key={repository.resourceId}
            className="flex min-h-9 min-w-0 items-center gap-3 py-1 ps-3 pe-1.5 text-xs"
          >
            <span className="w-28 shrink-0 truncate font-medium sm:w-44">
              {repositoryTitle(project, repository.resourceId)}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                repository.error ? "text-warning-foreground" : "text-muted-foreground",
              )}
            >
              {libraryRepositoryHealthSummary(repository)}
            </span>
            {renderAction?.(repository)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {footer}
      </div>
    </div>
  );
}

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
  return (
    <RepositoryHealthList
      project={project}
      repositories={effective.health.repositories}
      footer={
        <span>
          As of {formatRelativeTimeLabel(effective.asOf)}
          {offlineLabel === null ? null : ` · ${offlineLabel} offline`}
        </span>
      }
    />
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
      <p className="text-xs text-muted-foreground">Could not check these files.</p>
    ) : health.isPending ? (
      <p role="status" className="text-xs text-muted-foreground">
        Checking repositories...
      </p>
    ) : null;
  return (
    <RepositoryHealthList
      project={project}
      repositories={data.repositories}
      renderAction={(repository) => {
        const cwd = copy.repositories.find(
          (entry) => entry.resourceId === repository.resourceId,
        )?.path;
        return cwd !== undefined && canPull && libraryRepositoryCanPull(repository) ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void pullRepository(repository.resourceId, cwd)}
          >
            {pulling === repository.resourceId ? "Pulling..." : "Pull"}
          </Button>
        ) : null;
      }}
      footer={
        <>
          <span>Checked {formatRelativeTimeLabel(data.checkedAt)}</span>
          {canRefreshRemote ? (
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
          {actionError ? <span className="text-warning-foreground">{actionError}</span> : null}
        </>
      }
    />
  );
}

/** The two ways to put a project on a computer, shared by the copies view and the setup steps. */
function GetCopyMenu({
  disabled,
  label = "Add files",
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
        <MenuItem onClick={() => onGetCopy({ strategy: "clone" })}>Prepare on a computer</MenuItem>
        <MenuItem onClick={() => onGetCopy({ strategy: "reuse" })}>Use existing folder</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function NoCopies({
  canAct,
  onGetCopy,
}: {
  readonly canAct: boolean;
  readonly onGetCopy: (request: CopyRequest) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-start gap-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16">
          <MonitorIcon aria-hidden className="size-4" />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Files are prepared when you start a conversation. Your project and conversations stay
          available when files are removed.
        </p>
      </div>
      {canAct ? <GetCopyMenu variant="outline" onGetCopy={onGetCopy} /> : null}
    </div>
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
  const removed = copies.filter(
    (copy) =>
      (copy.state === "released" || copy.registered === false) &&
      !active.some(
        (current) =>
          current.environmentId === copy.environmentId && current.rootPath === copy.rootPath,
      ),
  );
  const { environments } = useEnvironments();
  const authority = useLibraryAuthority();
  const supportsHealth = (id: EnvironmentId) =>
    supportsLoomFeature(
      environments.find((entry) => entry.environmentId === id)?.serverConfig?.environment
        .capabilities,
      LIBRARY_COPY_HEALTH_FEATURE,
    );
  return (
    <LibrarySection
      title="Library copies"
      icon={MonitorIcon}
      count={active.length}
      action={
        canAct && active.length ? <GetCopyMenu variant="outline" onGetCopy={onGetCopy} /> : null
      }
    >
      <LibraryErrorNotice error={error} onRetry={onRetry} />
      {active.length ? (
        <ul className="flex flex-col gap-3">
          {active.map((copy) => {
            const online = hostConnected(copy.environmentId);
            const label = hostLabel(copy.environmentId);
            return (
              <li
                key={copy.id}
                aria-label={`Files on ${label}`}
                className={cn("space-y-4 p-4 sm:p-5", LIBRARY_SURFACE)}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <div className="flex min-w-0 flex-1 basis-60 items-start gap-3">
                    <ComputerTile environmentId={copy.environmentId} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="truncate text-base font-semibold tracking-tight">
                          {label}
                        </span>
                        {copy.ownership !== "borrowed" || copy.state !== "ready" || !online ? (
                          <CopyStatusLabel status={copyStatus(copy, online)} />
                        ) : null}
                      </div>
                      <PathLabel path={copy.rootPath} className="-ms-1.5" />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {copy.state === "ready" ? (
                      <Button
                        shape="pill"
                        size="xs"
                        variant="outline"
                        disabled={!canStart || !online}
                        onClick={() => onStart(copy)}
                      >
                        <MessageSquarePlusIcon />
                        Start conversation
                      </Button>
                    ) : null}
                    <Button
                      shape="pill"
                      size="xs"
                      variant="ghost"
                      disabled={!canAct}
                      onClick={() => onRemove(copy)}
                    >
                      {copy.ownership === "borrowed" ? "Stop using this folder" : "Remove files"}
                    </Button>
                  </div>
                </div>
                {copy.state === "ready" ? (
                  <CopyFileControls
                    copy={copy}
                    online={online}
                    canAct={canAct}
                    onChanged={onRetry}
                  />
                ) : null}
                {copy.state !== "ready" && copy.recovery && authority.authorityId ? (
                  <LibraryRecoveryDownload
                    authorityId={authority.authorityId}
                    connected={authority.connected}
                    copy={copy}
                  />
                ) : null}
                <TemporaryResources copy={copy} connected={online} />
                <details className="space-y-3">
                  <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
                    Computer details
                  </summary>
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
                  <ComputerFolderSettingsLink copy={copy} />
                  {online && copy.state === "ready" ? (
                    <CopyProfileSetup project={project} copy={copy} />
                  ) : null}
                </details>
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
        <p role="status" className="text-xs text-muted-foreground">
          Checking your computers...
        </p>
      ) : error ? null : (
        <NoCopies canAct={canAct} onGetCopy={onGetCopy} />
      )}
      {removed.length ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Previously used on these computers</p>
          {removed.map((copy) => (
            <div
              key={copy.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
            >
              <ComputerIcon environmentId={copy.environmentId} />
              <span className="min-w-0 flex-1 text-sm">{hostLabel(copy.environmentId)}</span>
              <CopyFileControls
                copy={copy}
                online={hostConnected(copy.environmentId)}
                canAct={canAct}
                onChanged={onRetry}
              />
              {copy.ownership === "borrowed" ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={!canAct || !hostConnected(copy.environmentId)}
                  onClick={() =>
                    onGetCopy({
                      strategy: "reuse",
                      hostId: copy.environmentId,
                      rootPath: copy.rootPath,
                    })
                  }
                >
                  Use folder again
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </LibrarySection>
  );
}

function ComputerFolderSettingsLink({ copy }: { readonly copy: LibraryWorkingCopy }) {
  const groups = useSettingsProjectGroups();
  const rootId =
    copy.rootLocalProjectId ??
    copy.repositories.find((repo) => repo.path === copy.rootPath)?.localProjectId;
  const group = groups.find((group) =>
    group.memberProjects.some(
      (member) => member.environmentId === copy.environmentId && member.id === rootId,
    ),
  );
  const member = group?.memberProjects.find(
    (member) => member.environmentId === copy.environmentId && member.id === rootId,
  );
  if (!group || !member) return null;
  return (
    <Button
      variant="outline"
      size="xs"
      render={
        <Link
          to="/settings/projects"
          search={{
            project: group.projectKey,
            machine: copy.environmentId,
            checkout: member.physicalProjectKey,
          }}
        />
      }
    >
      Computer folder settings
    </Button>
  );
}

const FileChangeAttempt = Schema.NullOr(
  Schema.Struct({
    authorityId: EnvironmentId,
    requestId: Schema.String,
    keepOnComputer: Schema.NullOr(Schema.Boolean),
    copy: Schema.NullOr(LibraryWorkingCopy),
  }),
);

function CopyFileControls({
  copy,
  online,
  canAct,
  onChanged,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly online: boolean;
  readonly canAct: boolean;
  readonly onChanged: () => void;
}) {
  const authority = useLibraryAuthority();
  const host = authority.environments.find((entry) => entry.environmentId === copy.environmentId);
  const supported = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    LIBRARY_FILE_LIFECYCLE_FEATURE,
  );
  const setRetention = useAtomCommand(projectLibrary.setCopyRetention, { reportFailure: false });
  const reopen = useAtomCommand(projectLibrary.reopenCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const canRetain = useLibraryPermission(projectLibrary.setCopyRetention, copy.environmentId);
  const canReopen = useLibraryPermission(projectLibrary.reopenCopy, copy.environmentId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, authority.authorityId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:file-change:${copy.environmentId}:${copy.id}`,
    FileChangeAttempt,
  );
  const changing = useRef(false);
  const current = attempt?.copy && attempt.copy.updatedAt >= copy.updatedAt ? attempt.copy : copy;
  const removed = current.state === "released" || current.registered === false;
  const kept = current.keepOnComputer !== false;
  const change = async (keepOnComputer?: boolean) => {
    if (
      !authority.authorityId ||
      changing.current ||
      !online ||
      !supported ||
      !canAct ||
      !canRegister ||
      !authority.connected ||
      (attempt && attempt.authorityId !== authority.authorityId) ||
      (!attempt?.copy && (keepOnComputer === undefined ? !canReopen : !canRetain))
    )
      return;
    changing.current = true;
    setBusy(true);
    setError(null);
    let pending = attempt ?? {
      authorityId: authority.authorityId,
      requestId: randomUUID(),
      keepOnComputer: keepOnComputer ?? null,
      copy: null,
    };
    saveAttempt(pending);
    const applyChange = async () => {
      if (!pending.copy) {
        const result =
          pending.keepOnComputer === null
            ? await reopen({
                environmentId: copy.environmentId,
                input: { requestId: pending.requestId, workingCopyId: copy.id },
              })
            : await setRetention({
                environmentId: copy.environmentId,
                input: { workingCopyId: copy.id, keepOnComputer: pending.keepOnComputer },
              });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        pending = { ...pending, copy: result.value };
        saveAttempt(pending);
      }
      const published = await register({
        environmentId: pending.authorityId,
        input: { requestId: `${pending.requestId}:publish`, copy: pending.copy! },
      });
      if (published._tag === "Failure") throw squashAtomCommandFailure(published);
      saveAttempt(null);
      onChanged();
    };
    try {
      await applyChange();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update project files. Try again.",
      );
    }
    changing.current = false;
    setBusy(false);
  };
  if (copy.ownership === "borrowed")
    return removed ? null : (
      <ExistingFolderStorage copy={copy} online={online} canAct={canAct} onChanged={onChanged} />
    );
  return (
    <div className="space-y-2">
      {removed ? (
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={
            busy ||
            attempt !== null ||
            !supported ||
            !online ||
            !canAct ||
            !canReopen ||
            !canRegister ||
            !authority.connected
          }
          onClick={() => void change()}
        >
          {busy ? "Restoring..." : "Restore files"}
        </Button>
      ) : (
        <label className="flex cursor-pointer items-start gap-3">
          <Switch
            checked={kept}
            disabled={
              busy ||
              attempt !== null ||
              !supported ||
              !online ||
              !canAct ||
              !canRetain ||
              !canRegister ||
              !authority.connected
            }
            onCheckedChange={(value) => void change(value)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Keep files on this computer</span>
            <span className="block max-w-lg text-xs leading-relaxed text-muted-foreground">
              {kept
                ? "Files stay available until you remove them."
                : "Loom frees space after all conversations are finished, once your work is safely saved."}
            </span>
          </span>
        </label>
      )}
      {!supported && online ? (
        <p className="text-xs text-muted-foreground">
          Update Loom on this computer to manage automatic cleanup and restore files.
        </p>
      ) : null}
      {attempt ? (
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={busy || !online || !canRegister || !authority.connected}
          onClick={() => void change(attempt.keepOnComputer ?? undefined)}
        >
          {busy ? "Saving..." : "Retry file update"}
        </Button>
      ) : null}
      {attempt && !attempt.copy ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => {
            saveAttempt(null);
            setError(null);
            onChanged();
          }}
        >
          Cancel update
        </Button>
      ) : null}
      <LibraryErrorNotice error={error} />
    </div>
  );
}

/** The overview's glance at where the project lives, with the way to manage each copy. */
export function CopiesSummary({
  copies,
  loading,
  canAct,
  hostLabel,
  hostConnected,
  onGetCopy,
  onShowAll,
}: {
  readonly copies: readonly LibraryWorkingCopy[];
  readonly loading: boolean;
  readonly canAct: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onGetCopy: (request: CopyRequest) => void;
  readonly onShowAll: () => void;
}) {
  const active = libraryActiveCopies(copies);
  return (
    <LibraryPanel
      title="Library copies"
      icon={MonitorIcon}
      count={active.length}
      action={
        active.length ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={onShowAll}>
            Manage
            <ArrowRightIcon />
          </Button>
        ) : null
      }
    >
      {active.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {active.map((copy) => (
            <li key={copy.id} className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
              <ComputerIcon environmentId={copy.environmentId} />
              <span className="min-w-0 truncate text-sm font-medium">
                {hostLabel(copy.environmentId)}
              </span>
              <span className="ms-auto">
                <CopyStatusLabel status={copyStatus(copy, hostConnected(copy.environmentId))} />
              </span>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p role="status" className="px-3.5 pb-3 text-xs text-muted-foreground">
          Checking your computers...
        </p>
      ) : (
        <div className="px-3.5 pb-3.5">
          <NoCopies canAct={canAct} onGetCopy={onGetCopy} />
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
    <details className={cn("group/fold overflow-hidden", LIBRARY_SURFACE)}>
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
          Removing files keeps your project and conversations. Existing folders stay on disk.
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
        : `Prepared files on ${hostLabel(event.environmentId)}`;
    case "copy-removed":
      return event.copy.ownership === "borrowed"
        ? `Stopped using the folder on ${hostLabel(event.environmentId)}`
        : `Removed files from ${hostLabel(event.environmentId)}`;
    case "copy-failed":
      return `Could not prepare files on ${hostLabel(event.environmentId)}`;
  }
}
