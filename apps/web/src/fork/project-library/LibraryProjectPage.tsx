import { randomUUID } from "~/lib/utils";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EllipsisIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  projectLibrary,
  useLibraryProject,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryBackLink, LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";
import { CopyDialog } from "./CopyDialog";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { libraryCopyReadiness } from "./copyChoice";
import { NewConversationDialog } from "./NewConversationDialog";
import { isRepositoryResource } from "./resources";
import { useProjectUpdate } from "./useProjectUpdate";
import { ProjectResources } from "./ProjectResources";
import { ProjectCopies, ProjectHistory, type CopyRequest } from "./ProjectCopies";
import { ProjectColorPicker, ProjectTile } from "./ProjectIdentity";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { libraryProjectColor } from "@t3tools/client-runtime/fork";

const RECENT_CONVERSATIONS = 5;

/**
 * A project is a name, a brief and the repositories and links it is made of. Copies on
 * computers come and go; conversations and the project outlive them.
 */
export function LibraryProjectPage({ projectId }: { readonly projectId: string }) {
  // Removed copies feed the folded history, so the page always asks for them.
  const library = useLibraryProject(projectId, true);
  const [, selectProject] = useSelectedLibraryProject();
  const [copyRequest, setCopyRequest] = useState<CopyRequest | null>(null);
  const [releasing, setReleasing] = useState<LibraryWorkingCopy | null>(null);
  const [conversation, setConversation] = useState<{
    hostId?: EnvironmentId;
    copyId?: string;
  } | null>(null);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, library.authorityId);
  useEffect(() => {
    selectProject(projectId);
  }, [projectId, selectProject]);
  const project = library.project.data;
  if (!library.authorityId)
    return (
      <LibraryPageFrame>
        <LibrarySetup />
      </LibraryPageFrame>
    );
  if (!project)
    return (
      <LibraryPageFrame>
        <LibraryErrorNotice error={library.project.error} onRetry={library.project.refresh} />
        <p role="status" className="text-sm text-muted-foreground">
          {library.project.isPending
            ? "Loading project..."
            : "This project is not saved on this device yet. Connect your Library to load it."}
        </p>
      </LibraryPageFrame>
    );
  const hostLabel = (id: EnvironmentId) =>
    library.environments.find((entry) => entry.environmentId === id)?.label ??
    library.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const hostConnected = (id: EnvironmentId) =>
    library.environments.some(
      (entry) =>
        entry.environmentId === id && entry.entry.enabled && entry.connection.phase === "connected",
    );
  const copies = library.copies.data ?? [];
  const canWork = library.connected && !project.archived;
  return (
    <LibraryPageFrame title={project.title} width="readable">
      <ProjectOverview
        project={project}
        authorityId={library.authorityId}
        connected={library.connected}
        canStart={canRegister && canWork}
        onSaved={library.refresh}
        onNewConversation={() => setConversation({})}
      />
      <LibraryErrorNotice error={library.project.error} onRetry={library.project.refresh} />
      <ProjectCopies
        project={project}
        copies={copies}
        loading={libraryCopyReadiness(library.copies) === "loading"}
        error={library.copies.error}
        onRetry={library.copies.refresh}
        canAct={canWork}
        canStart={canRegister && canWork}
        hostLabel={hostLabel}
        hostConnected={hostConnected}
        onGetCopy={setCopyRequest}
        onStart={(copy) => setConversation({ hostId: copy.environmentId, copyId: copy.id })}
        onRemove={setReleasing}
      />
      <ProjectConversations
        project={project}
        threads={library.threads.data}
        loading={library.threads.isPending}
        error={library.threads.error}
        onRetry={library.threads.refresh}
        hostLabel={hostLabel}
      />
      <ProjectHistory
        project={project}
        copies={copies}
        authorityId={library.authorityId}
        connected={library.connected}
        canAct={canWork}
        hostLabel={hostLabel}
        hostConnected={hostConnected}
        onReuse={setCopyRequest}
      />
      {copyRequest ? (
        <CopyDialog
          project={project}
          strategy={copyRequest.strategy}
          {...(copyRequest.hostId ? { initialHostId: copyRequest.hostId } : {})}
          {...(copyRequest.rootPath ? { initialRootPath: copyRequest.rootPath } : {})}
          onClose={() => setCopyRequest(null)}
          onSaved={() => {
            setCopyRequest(null);
            library.refresh();
          }}
        />
      ) : null}
      {releasing ? (
        <ReleaseCopyDialog
          copy={releasing}
          onClose={() => setReleasing(null)}
          onReleased={() => {
            setReleasing(null);
            library.refresh();
          }}
        />
      ) : null}
      {conversation ? (
        <NewConversationDialog
          project={project}
          copies={copies}
          copiesQuery={library.copies}
          {...(conversation.hostId ? { initialHostId: conversation.hostId } : {})}
          {...(conversation.copyId ? { initialCopyId: conversation.copyId } : {})}
          onChanged={library.refresh}
          onClose={() => setConversation(null)}
        />
      ) : null}
    </LibraryPageFrame>
  );
}

/** Name, brief and contents: the parts of a project someone defines, all edited in place. */
function ProjectOverview({
  project,
  authorityId,
  connected,
  canStart,
  onSaved,
  onNewConversation,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly canStart: boolean;
  readonly onSaved: () => void;
  readonly onNewConversation: () => void;
}) {
  const update = useProjectUpdate({ project, authorityId, connected, onSaved });
  const archive = useAtomCommand(projectLibrary.archiveProject, { reportFailure: false });
  const canArchive = useLibraryPermission(projectLibrary.archiveProject, authorityId);
  const [renaming, setRenaming] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const repositories = project.resources.filter(isRepositoryResource).length;
  const links = project.resources.length - repositories;
  const meta = [
    `Edited ${formatRelativeTimeLabel(project.updatedAt)}`,
    repositories ? `${repositories} ${repositories === 1 ? "repository" : "repositories"}` : null,
    links ? `${links} ${links === 1 ? "link" : "links"}` : null,
  ].filter(Boolean);
  const setArchived = async (archived: boolean) => {
    setArchiveError(null);
    const result = await archive({
      environmentId: authorityId,
      input: {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: project.revision,
        archived,
      },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setArchiveError(cause instanceof Error ? cause.message : "Could not update this project.");
    }
    onSaved();
  };
  return (
    <>
      <div className="flex flex-col gap-2">
        <LibraryBackLink to="/projects">Projects</LibraryBackLink>
        <div className="flex flex-wrap items-start justify-between gap-4">
          {renaming ? (
            <TitleEditor
              title={project.title}
              busy={update.busy}
              onCancel={() => setRenaming(false)}
              onSave={async (title) => {
                if (await update.save({ title })) setRenaming(false);
              }}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <Popover>
                <PopoverTrigger
                  disabled={!update.canEdit || update.busy}
                  aria-label="Change project color"
                  render={
                    <button
                      type="button"
                      className="shrink-0 rounded-2xl outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring enabled:hover:scale-103 disabled:cursor-default"
                    />
                  }
                >
                  <ProjectTile project={project} size="lg" />
                </PopoverTrigger>
                <PopoverPopup align="start" className="w-auto">
                  <p className="mb-3 text-sm font-medium">Project color</p>
                  <ProjectColorPicker
                    value={project.color}
                    automatic={libraryProjectColor({ id: project.id })}
                    disabled={update.busy}
                    onChange={(color) => {
                      if ((project.color ?? null) !== color) void update.save({ color });
                    }}
                  />
                </PopoverPopup>
              </Popover>
              <div className="min-w-0 space-y-1">
                <h1 className="wrap-anywhere text-xl font-semibold tracking-tight">
                  {project.title}
                </h1>
                <p className="text-xs tabular-nums text-muted-foreground">{meta.join(" · ")}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button shape="pill" disabled={!canStart} onClick={onNewConversation}>
              New conversation
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button shape="pill" size="icon" variant="ghost" aria-label="Project actions" />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                <MenuItem disabled={!update.canEdit} onClick={() => setRenaming(true)}>
                  Rename
                </MenuItem>
                <MenuItem
                  disabled={!canArchive || !connected}
                  onClick={() => void setArchived(!project.archived)}
                >
                  {project.archived ? "Restore project" : "Archive project"}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
      </div>
      {project.archived ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Archived. Conversations stay readable; restore the project to change it or start new
            work.
          </p>
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            disabled={!canArchive || !connected}
            onClick={() => void setArchived(false)}
          >
            Restore
          </Button>
        </div>
      ) : null}
      <LibraryErrorNotice error={archiveError} />
      <BriefEditor
        brief={project.brief}
        canEdit={update.canEdit}
        busy={update.busy}
        onSave={(brief) => update.save({ brief })}
      />
      <ProjectResources
        resources={project.resources}
        canEdit={update.canEdit}
        busy={update.busy}
        onChange={(resources) => update.save({ resources })}
      />
      <LibraryErrorNotice error={update.error} />
    </>
  );
}

function TitleEditor({
  title,
  busy,
  onSave,
  onCancel,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly onSave: (title: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(title);
  return (
    <form
      className="flex min-w-0 flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}
    >
      <Input
        autoFocus
        aria-label="Project name"
        maxLength={160}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <Button shape="pill" type="submit" disabled={busy || !draft.trim()}>
        Save
      </Button>
      <Button shape="pill" type="button" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** The brief rides along with every conversation, so it reads as prose until edited. */
function BriefEditor({
  brief,
  canEdit,
  busy,
  onSave,
}: {
  readonly brief: string;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly onSave: (brief: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <LibrarySection
      title="Brief"
      action={
        canEdit && draft === null && brief ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={() => setDraft(brief)}>
            Edit
          </Button>
        ) : null
      }
    >
      {draft !== null ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(draft).then((saved) => {
              if (saved) setDraft(null);
            });
          }}
        >
          <Textarea
            autoFocus
            rows={5}
            maxLength={65536}
            aria-label="Project brief"
            placeholder="What are we making, and what matters?"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-2">
            <Button shape="pill" type="submit" size="sm" disabled={busy || draft === brief}>
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button
              shape="pill"
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : brief ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{brief}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Every conversation in this project starts with the brief. Say what you're building and
            what matters.
          </p>
          {canEdit ? (
            <Button shape="pill" size="xs" variant="outline" onClick={() => setDraft("")}>
              Add a brief
            </Button>
          ) : null}
        </div>
      )}
    </LibrarySection>
  );
}

function ProjectConversations({
  project,
  threads,
  loading,
  error,
  onRetry,
  hostLabel,
}: {
  readonly project: LibraryProject;
  readonly threads: readonly LibraryThreadSummary[] | null | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hostLabel: (id: EnvironmentId) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = (threads ?? [])
    .filter((thread) => !thread.deleted)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = showAll ? visible : visible.slice(0, RECENT_CONVERSATIONS);
  return (
    <LibrarySection
      title={
        showAll || visible.length <= RECENT_CONVERSATIONS ? "Conversations" : "Recent conversations"
      }
    >
      <LibraryErrorNotice error={error} onRetry={onRetry} />
      {shown.length ? (
        <ul className="-mx-2">
          {shown.map((thread) => {
            const scope =
              thread.resourceIds.length === 1
                ? project.resources.find((resource) => resource.id === thread.resourceIds[0])?.title
                : null;
            return (
              <li key={thread.id}>
                <Link
                  to="/library/conversations/$conversationId"
                  params={{ conversationId: thread.id }}
                  className="flex items-baseline gap-3 rounded-md px-2 py-2 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {thread.title || "Untitled conversation"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[hostLabel(thread.environmentId), scope, thread.archived ? "Archived" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {formatRelativeTimeLabel(thread.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading conversations...
        </p>
      ) : error ? null : (
        <p className="text-sm text-muted-foreground">
          No conversations yet. Start one about the whole project or a single repository.
        </p>
      )}
      {visible.length > RECENT_CONVERSATIONS ? (
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show recent only" : `Show all ${visible.length}`}
        </Button>
      ) : null}
    </LibrarySection>
  );
}
