import { SitesSummary } from "../sites/ProjectSites";
import { randomUUID, cn } from "~/lib/utils";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_BRIEF_PROPOSALS_FEATURE,
  LIBRARY_BRIEF_SUGGESTIONS_FEATURE,
  LIBRARY_COPY_HEALTH_PUBLISHED_FEATURE,
  LIBRARY_PROJECT_PROFILE_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  CalendarIcon,
  ClockIcon,
  EllipsisIcon,
  MoonIcon,
  PencilLineIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProjects } from "~/state/entities";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  libraryActiveCopies,
  libraryProjectColor,
  libraryCopyReadiness,
  isRestingSince,
  libraryLocalProjectIcon,
  localProjectsByRef,
  type LocalProjectIcon,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  projectLibrary,
  useLibraryProject,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryBackLink, LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { LIBRARY_ROW, LibraryErrorNotice } from "./LibraryControls";
import { CopyDialog } from "./CopyDialog";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { NewConversationDialog } from "./NewConversationDialog";
import { useProjectUpdate } from "./useProjectUpdate";
import { ProjectResources } from "./ProjectResources";
import { ProjectProfile } from "./ProjectProfile";
import { CopiesSummary, ProjectCopies, ProjectHistory, type CopyRequest } from "./ProjectCopies";
import { ProjectColorPicker, ProjectGlow, ProjectTile, projectColorStyle } from "./ProjectIdentity";
import { ProjectConversations, RecentConversations } from "./ProjectConversations";
import { ProjectTimeline, TimelinePreview } from "./ProjectTimeline";
import { PROJECT_VIEWS, projectViewSearch, type ProjectViewName } from "./projectViews";
import { ProjectTabs } from "./ProjectTabs";
import { LibraryHistorySearch } from "./LibraryHistorySearch";
import { ProjectBriefProposals } from "./ProjectBriefProposals";
import { dropLibraryBriefEdit, onLibraryBriefEdit, takeLibraryBriefEdit } from "./actions";

/** Briefs longer than this start folded to a few lines, so the conversations stay in view. */
const LONG_BRIEF_CHARACTERS = 320;
const LONG_BRIEF_LINES = 4;
/** A fine dot grid fading out from the hero's far corner, for texture behind the title. */
const HERO_DOTS = {
  backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  maskImage: "radial-gradient(ellipse at 100% 0%, black, transparent 60%)",
};

type LibraryProjectView = ReturnType<typeof useLibraryProject>;
type ConversationRequest = {
  readonly hostId?: EnvironmentId;
  readonly copyId?: string;
  readonly resourceId?: string;
};

/**
 * A project is a name, a brief and the repositories and links it is made of. Copies on
 * computers come and go; conversations and the project outlive them.
 */
export function LibraryProjectPage({
  projectId,
  view,
}: {
  readonly projectId: string;
  readonly view: ProjectViewName;
}) {
  // Removed copies feed the folded history, so the page always asks for them.
  const library = useLibraryProject(projectId, true);
  const [, selectProject] = useSelectedLibraryProject();
  useEffect(() => {
    selectProject(projectId);
  }, [projectId, selectProject]);
  // Leaving before the project loads drops the palette's brief request with it.
  useEffect(() => () => dropLibraryBriefEdit(projectId), [projectId]);
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
  return (
    <LibraryPageFrame title={project.title}>
      <ProjectView
        library={library}
        authorityId={library.authorityId}
        project={project}
        view={view}
      />
    </LibraryPageFrame>
  );
}

/**
 * The hero always says what the project is. Below it one view at a time gets the full width:
 * the overview glances at everything, and each other view is where that part gets managed. The
 * view lives in the URL so back, reload and shared links land where the reader was.
 */
function ProjectView({
  library,
  authorityId,
  project,
  view,
}: {
  readonly library: LibraryProjectView;
  readonly authorityId: EnvironmentId;
  readonly project: LibraryProject;
  readonly view: ProjectViewName;
}) {
  const navigate = useNavigate();
  const [copyRequest, setCopyRequest] = useState<CopyRequest | null>(null);
  const [releasing, setReleasing] = useState<LibraryWorkingCopy | null>(null);
  const [conversation, setConversation] = useState<ConversationRequest | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  // The command palette's Open project brief lands here, whether or not this page was open.
  useEffect(() => {
    const open = () => {
      if (takeLibraryBriefEdit(project.id)) setEditingBrief(true);
    };
    open();
    return onLibraryBriefEdit(open);
  }, [project.id]);
  const [addingResource, setAddingResource] = useState(false);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authorityId);
  const update = useProjectUpdate({
    project,
    authorityId,
    connected: library.connected,
    onSaved: library.refresh,
  });
  const localProjects = useProjects();
  // Read once per visit, like the projects page, so render stays pure.
  const [now] = useState(() => Date.now());
  const hostLabel = (id: EnvironmentId) =>
    library.environments.find((entry) => entry.environmentId === id)?.label ??
    library.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const hostConnected = (id: EnvironmentId) =>
    library.environments.some(
      (entry) =>
        entry.environmentId === id && entry.entry.enabled && entry.connection.phase === "connected",
    );
  // Info and copies are cached separately, so a newer cached lastSeenAt could make older cached
  // health look recent. Only copies read live from the connected Library may be aged by it, and
  // they stay trusted while a refresh is in flight so the age does not jump back and forth.
  const [liveCopies, setLiveCopies] = useState<typeof library.copies.data>(null);
  const nextLiveCopies = !library.connected
    ? null
    : libraryCopyReadiness(library.copies) === "ready"
      ? library.copies.data
      : liveCopies;
  if (nextLiveCopies !== liveCopies) setLiveCopies(nextLiveCopies);
  const copiesLive = liveCopies !== null && library.copies.data === liveCopies;
  const copies = library.copies.data ?? [];
  const activeCopies = libraryActiveCopies(copies);
  const capabilities = library.environment?.serverConfig?.environment.capabilities;
  // An older Library would drop a saved profile, so the section waits until it says it keeps one.
  const keepsProfile = supportsLoomFeature(capabilities, LIBRARY_PROJECT_PROFILE_FEATURE);
  // Suggested brief updates appear only once the Library says it keeps them.
  const proposesBrief = supportsLoomFeature(capabilities, LIBRARY_BRIEF_PROPOSALS_FEATURE);
  // An older Library would drop the brief suggestion setting, so the field waits for it too.
  const keepsBriefSuggestions = supportsLoomFeature(
    capabilities,
    LIBRARY_BRIEF_SUGGESTIONS_FEATURE,
  );
  const canWork = library.connected && !project.archived;
  const canStart = canRegister && canWork;
  const threads = (library.threads.data ?? [])
    .filter((thread) => !thread.deleted)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const activeAt =
    threads[0] && threads[0].updatedAt > project.updatedAt
      ? threads[0].updatedAt
      : project.updatedAt;
  const copiesLoading = libraryCopyReadiness(library.copies) === "loading";
  const views = PROJECT_VIEWS.filter(
    (entry) => entry !== "repositories" && (entry !== "setup" || keepsProfile),
  );
  // A link to the setup view still lands somewhere on a Library that keeps no setup.
  const shown = view === "repositories" ? "computers" : views.includes(view) ? view : "overview";
  const show = (next: ProjectViewName) =>
    void navigate({
      to: "/library/$projectId",
      params: { projectId: project.id },
      search: projectViewSearch(next),
    });
  const viewCount = (entry: ProjectViewName) =>
    entry === "conversations"
      ? threads.length
      : entry === "computers"
        ? activeCopies.length
        : entry === "repositories"
          ? project.resources.length
          : 0;
  // A project nobody has talked about yet gets a path to its first conversation instead.
  const settingUp =
    !project.archived && !library.threads.isPending && !library.threads.error && !threads.length;
  return (
    <div style={projectColorStyle(libraryProjectColor(project))} className="contents">
      <ProjectHero
        project={project}
        localIcon={libraryLocalProjectIcon(activeCopies, localProjectsByRef(localProjects))}
        activeAt={activeAt}
        resting={isRestingSince(activeAt, now)}
        authorityId={authorityId}
        connected={library.connected}
        canStart={canStart}
        update={update}
        editingBrief={editingBrief}
        onEditingBriefChange={setEditingBrief}
        showEmptyBrief={false}
        proposesBrief={proposesBrief}
        hostLabel={hostLabel}
        onSaved={library.refresh}
        onNewConversation={() => setConversation({})}
      />
      <LibraryErrorNotice error={library.project.error} onRetry={library.project.refresh} />
      <ProjectTabs views={views} selected={shown} count={viewCount} onSelect={show}>
        {shown === "overview" ? (
          <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-10">
              {settingUp ? (
                <ProjectSetup
                  project={project}
                  hasCopy={activeCopies.length > 0}
                  canEdit={update.canEdit}
                  canWork={canWork}
                  canStart={canStart}
                  onWriteBrief={() => setEditingBrief(true)}
                  onAddResource={() => {
                    setAddingResource(true);
                    show("computers");
                  }}
                  onGetCopy={setCopyRequest}
                  onStart={() => setConversation({})}
                />
              ) : (
                <RecentConversations
                  project={project}
                  threads={threads}
                  loading={library.threads.isPending}
                  error={library.threads.error}
                  onRetry={library.threads.refresh}
                  hostLabel={hostLabel}
                  hostConnected={hostConnected}
                  onShowAll={() => show("conversations")}
                />
              )}
            </div>
            <aside aria-label="Project details" className="flex min-w-0 flex-col gap-4">
              <CopiesSummary
                copies={copies}
                loading={copiesLoading}
                canAct={canWork}
                hostLabel={hostLabel}
                hostConnected={hostConnected}
                onGetCopy={setCopyRequest}
                onShowAll={() => show("computers")}
              />
              <SitesSummary environmentId={authorityId} projectId={project.id} />
            </aside>
            {/* Below both columns, so the side cards never leave it a narrow strip. */}
            <TimelinePreview
              className="lg:col-span-2"
              projectId={project.id}
              authorityId={authorityId}
              connected={library.connected}
              capabilities={capabilities}
              hostLabel={hostLabel}
              hostConnected={hostConnected}
              onShowAll={() => show("timeline")}
            />
          </div>
        ) : shown === "conversations" ? (
          <div className="flex min-w-0 flex-col gap-8">
            <LibraryHistorySearch
              authorityId={authorityId}
              connected={library.connected}
              capabilities={capabilities}
              projectId={project.id}
              hostLabel={hostLabel}
            />
            <ProjectConversations
              project={project}
              threads={threads}
              loading={library.threads.isPending}
              error={library.threads.error}
              onRetry={library.threads.refresh}
              hostLabel={hostLabel}
              hostConnected={hostConnected}
            />
          </div>
        ) : shown === "timeline" ? (
          <ProjectTimeline
            projectId={project.id}
            authorityId={authorityId}
            connected={library.connected}
            capabilities={capabilities}
            hostLabel={hostLabel}
            hostConnected={hostConnected}
            fallback={
              <ProjectHistory
                project={project}
                copies={copies}
                authorityId={authorityId}
                connected={library.connected}
                canAct={canWork}
                hostLabel={hostLabel}
                hostConnected={hostConnected}
                onReuse={setCopyRequest}
              />
            }
          />
        ) : shown === "computers" ? (
          <div className="flex min-w-0 flex-col gap-10">
            <ProjectResources
              resources={project.resources}
              copies={copies}
              hostLabel={hostLabel}
              canEdit={update.canEdit}
              busy={update.busy}
              adding={addingResource}
              canStart={canStart}
              onAddingChange={setAddingResource}
              onChange={(resources) => update.save({ resources })}
              onStart={(resource) => setConversation({ resourceId: resource.id })}
            />
            <ProjectCopies
              project={project}
              copies={copies}
              loading={copiesLoading}
              error={library.copies.error}
              onRetry={library.copies.refresh}
              canAct={canWork}
              canStart={canStart}
              hostLabel={hostLabel}
              hostConnected={hostConnected}
              lastSeenAt={(id) =>
                copiesLive
                  ? library.computers.find((entry) => entry.environmentId === id)?.lastSeenAt
                  : undefined
              }
              publishedHealth={supportsLoomFeature(
                capabilities,
                LIBRARY_COPY_HEALTH_PUBLISHED_FEATURE,
              )}
              onGetCopy={setCopyRequest}
              onStart={(copy) => setConversation({ hostId: copy.environmentId, copyId: copy.id })}
              onRemove={setReleasing}
            />
          </div>
        ) : (
          <ProjectProfile
            project={project}
            copies={activeCopies}
            computers={library.computers}
            canEdit={update.canEdit}
            keepsBriefSuggestions={keepsBriefSuggestions}
            busy={update.busy}
            error={update.error}
            hostLabel={hostLabel}
            onEdit={update.clearError}
            onSave={(profile) => update.save({ profile })}
          />
        )}
      </ProjectTabs>
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
          {...(conversation.resourceId ? { initialResourceId: conversation.resourceId } : {})}
          onChanged={library.refresh}
          onClose={() => setConversation(null)}
        />
      ) : null}
    </div>
  );
}

/** Who the project is at a glance: its mark, name, pulse and brief, with the way to start work. */
function ProjectHero({
  project,
  localIcon,
  activeAt,
  resting,
  authorityId,
  connected,
  canStart,
  update,
  editingBrief,
  onEditingBriefChange,
  showEmptyBrief,
  proposesBrief,
  hostLabel,
  onSaved,
  onNewConversation,
}: {
  readonly project: LibraryProject;
  readonly localIcon: LocalProjectIcon | null;
  readonly activeAt: string;
  readonly resting: boolean;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly canStart: boolean;
  readonly update: ReturnType<typeof useProjectUpdate>;
  readonly editingBrief: boolean;
  readonly onEditingBriefChange: (editing: boolean) => void;
  readonly showEmptyBrief: boolean;
  readonly proposesBrief: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onSaved: () => void;
  readonly onNewConversation: () => void;
}) {
  const archive = useAtomCommand(projectLibrary.archiveProject, { reportFailure: false });
  const canArchive = useLibraryPermission(projectLibrary.archiveProject, authorityId);
  const [renaming, setRenaming] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
    <header className="flex flex-col gap-4">
      <div>
        <LibraryBackLink to="/projects">Projects</LibraryBackLink>
      </div>
      <div className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-xs/5 sm:p-7">
        <ProjectGlow strength="strong" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 text-foreground/10"
          style={HERO_DOTS}
        />
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <Popover>
            <PopoverTrigger
              disabled={!update.canEdit || update.busy}
              aria-label="Change project color"
              render={
                <button
                  type="button"
                  className="shrink-0 rounded-2xl bg-card shadow-sm ring-1 ring-border outline-none transition-shadow duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring enabled:hover:shadow-md disabled:cursor-default"
                />
              }
            >
              <ProjectTile project={project} local={localIcon} size="2xl" />
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
          <div className="min-w-0 flex-1 basis-60 space-y-2 pt-0.5">
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
              <h1 className="wrap-anywhere text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
                {project.title}
              </h1>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums text-muted-foreground">
              <StatusPill archived={project.archived} resting={resting} />
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon aria-hidden className="size-3.5 opacity-70" />
                Last active {formatRelativeTimeLabel(activeAt)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon aria-hidden className="size-3.5 opacity-70" />
                Started {formatDay(project.createdAt)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 pt-1.5">
            <Button shape="pill" disabled={!canStart} onClick={onNewConversation}>
              <PlusIcon />
              New conversation
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button shape="pill" size="icon" variant="outline" aria-label="Project actions" />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                <MenuItem disabled={!update.canEdit} onClick={() => setRenaming(true)}>
                  Rename
                </MenuItem>
                <MenuItem disabled={!update.canEdit} onClick={() => onEditingBriefChange(true)}>
                  Edit brief
                </MenuItem>
                <MenuSeparator />
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
        <div className="mt-5 space-y-2 sm:ps-21">
          <ProjectBrief
            brief={project.brief}
            canEdit={update.canEdit}
            busy={update.busy}
            editing={editingBrief}
            showEmpty={showEmptyBrief}
            onEditingChange={onEditingBriefChange}
            onSave={(brief) => update.save({ brief })}
          />
          {proposesBrief ? (
            <ProjectBriefProposals
              project={project}
              authorityId={authorityId}
              connected={connected}
              hostLabel={hostLabel}
              onDecided={onSaved}
            />
          ) : null}
        </div>
      </div>
      {project.archived ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3 dark:bg-accent/50">
          <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <ArchiveIcon aria-hidden className="size-4 shrink-0" />
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
      <LibraryErrorNotice error={update.error} />
    </header>
  );
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The same three states the projects page groups by, so a project reads the same in both places. */
function StatusPill({
  archived,
  resting,
}: {
  readonly archived: boolean;
  readonly resting: boolean;
}) {
  if (archived || resting) {
    const Icon = archived ? ArchiveIcon : MoonIcon;
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-2xs font-medium text-foreground/80 dark:bg-accent">
        <Icon aria-hidden className="size-3" />
        {archived ? "Archived" : "Resting"}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-(--project-color)/12 px-2 text-2xs font-medium text-(--project-color) dark:bg-(--project-color)/16">
      <span aria-hidden className="size-1.5 rounded-full bg-(--project-color)" />
      Active
    </span>
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

/** The brief rides along with every conversation, so it reads as the project's opening lines. */
function ProjectBrief({
  brief,
  canEdit,
  busy,
  editing,
  showEmpty,
  onEditingChange,
  onSave,
}: {
  readonly brief: string;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly editing: boolean;
  readonly showEmpty: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly onSave: (brief: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(brief);
  const [wasEditing, setWasEditing] = useState(editing);
  // The hero menu and the command palette open the editor too; each starts from the saved brief.
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setDraft(brief);
  }
  const [expanded, setExpanded] = useState(false);
  const long = brief.length > LONG_BRIEF_CHARACTERS || brief.split("\n").length > LONG_BRIEF_LINES;
  const edit = () => onEditingChange(true);
  if (editing)
    return (
      <form
        className="max-w-3xl space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft).then((saved) => {
            if (saved) onEditingChange(false);
          });
        }}
      >
        <Textarea
          autoFocus
          rows={6}
          maxLength={65536}
          aria-label="Project brief"
          placeholder="What are we making, and what matters?"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onEditingChange(false);
          }}
        />
        <div className="flex items-center gap-2">
          <Button shape="pill" type="submit" size="sm" disabled={busy || draft === brief}>
            {busy ? "Saving..." : "Save brief"}
          </Button>
          <Button
            shape="pill"
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onEditingChange(false)}
          >
            Cancel
          </Button>
          <span className="ms-auto hidden text-xs text-muted-foreground sm:inline">
            Every new conversation starts with this.
          </span>
        </div>
      </form>
    );
  if (brief)
    return (
      <div className="max-w-3xl space-y-1">
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-relaxed text-foreground/80",
            long && !expanded && "line-clamp-4",
          )}
        >
          {brief}
        </p>
        {long || canEdit ? (
          <div className="-ms-2 flex items-center gap-0.5">
            {long ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show less" : "Read the whole brief"}
              </Button>
            ) : null}
            {canEdit ? (
              <Button shape="pill" size="xs" variant="ghost" onClick={edit}>
                <PencilLineIcon />
                Edit brief
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  if (!showEmpty) return null;
  if (!canEdit) return <p className="text-sm text-muted-foreground">No brief yet.</p>;
  return (
    <button
      type="button"
      onClick={edit}
      className={cn(
        LIBRARY_ROW,
        "flex w-full max-w-3xl items-start gap-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      <PencilLineIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-(--project-color)" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">Write a brief</span>
        <span className="block text-xs text-muted-foreground">
          Every conversation in this project starts with it. Say what you're building and what
          matters.
        </span>
      </span>
    </button>
  );
}

/** Starting work is the only required step; project details can grow with the work. */
function ProjectSetup({
  hasCopy,
  canEdit,
  canWork,
  canStart,
  onWriteBrief,
  onAddResource,
  onGetCopy,
  onStart,
}: {
  readonly project: LibraryProject;
  readonly hasCopy: boolean;
  readonly canEdit: boolean;
  readonly canWork: boolean;
  readonly canStart: boolean;
  readonly onWriteBrief: () => void;
  readonly onAddResource: () => void;
  readonly onGetCopy: (request: CopyRequest) => void;
  readonly onStart: () => void;
}) {
  return (
    <section aria-label="Start work" className="space-y-5">
      <div className="max-w-xl space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Ready when you are</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Choose where to work when you start a conversation. Loom checks existing files or prepares
          the files you need. Your project and conversations stay available when files are removed.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button shape="pill" disabled={!canStart} onClick={onStart}>
          Start conversation
        </Button>
        {!hasCopy ? (
          <Button
            shape="pill"
            variant="outline"
            disabled={!canWork}
            onClick={() => onGetCopy({ strategy: "reuse" })}
          >
            Use existing folder
          </Button>
        ) : null}
      </div>
      {canEdit ? (
        <details className="space-y-3">
          <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
            Optional project details
          </summary>
          <div className="flex flex-wrap gap-2">
            <Button shape="pill" size="xs" variant="outline" onClick={onWriteBrief}>
              Write a brief
            </Button>
            <Button shape="pill" size="xs" variant="outline" onClick={onAddResource}>
              Add repository or link
            </Button>
          </div>
        </details>
      ) : null}
    </section>
  );
}
