import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryWorkstream,
  LibraryWorkstreamReference,
  LibraryWorkingCopy,
  LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import {
  LIBRARY_WORKSTREAM_REFERENCE_KINDS,
  LIBRARY_WORKSTREAM_REFERENCE_STATE_ORDER,
  LIBRARY_WORKSTREAM_REFERENCE_STATES,
  LIBRARY_WORKSTREAM_STATES,
  LIBRARY_WORKSTREAM_TYPED_KINDS,
  isWorkstreamReferenceDone,
  sortWorkstreams,
  workstreamLinkOptions,
  workstreamProgress,
  workstreamReferenceKey,
  workstreamReferenceThread,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  LinkIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlusIcon,
  WaypointsIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { cn, randomUUID } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { projectLibrary, useLibraryPermission } from "./state";
import {
  LIBRARY_SURFACE,
  LibraryErrorNotice,
  LibrarySection,
  LibraryStateBadge,
} from "./LibraryControls";

const KIND_ICONS: Record<LibraryWorkstreamReference["kind"], LucideIcon> = {
  thread: MessageSquareIcon,
  copy: FolderIcon,
  repository: FolderGit2Icon,
  branch: GitBranchIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  verification: ListChecksIcon,
};

const TYPED_PLACEHOLDERS: Record<(typeof LIBRARY_WORKSTREAM_TYPED_KINDS)[number], string> = {
  verification: "Check name, such as Unit tests",
  branch: "Branch name",
  "pull-request": "Pull request URL",
};

const CHIP_TONES: Record<LibraryWorkflowTone, string> = {
  neutral: "border-border bg-background text-foreground",
  active: "border-border bg-background text-foreground",
  success: "border-transparent bg-success/12 text-success-foreground",
  warning: "border-transparent bg-warning/14 text-warning-foreground",
  danger: "border-transparent bg-destructive/10 text-destructive-foreground dark:bg-destructive/16",
};

const LINK_GROUPS = [
  { kind: "thread", title: "Conversations" },
  { kind: "copy", title: "Files on computers" },
  { kind: "repository", title: "Repositories" },
] as const;

type Editing = LibraryWorkstream | "new" | null;

/**
 * Larger pieces of work grouped around a goal, with the conversations, files and checks that
 * prove it done. Optional: everyday conversations never need one.
 */
export function ProjectWorkstreams({
  project,
  authorityId,
  copies,
  threads,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly threads: readonly LibraryThreadSummary[];
}) {
  const query = useEnvironmentQuery(
    projectLibrary.workstreams({ environmentId: authorityId, input: { projectId: project.id } }),
  );
  const allowed = useLibraryPermission(projectLibrary.saveWorkstream, authorityId);
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);
  const streams = sortWorkstreams(query.data ?? []);
  const current = streams.filter((stream) => stream.state !== "archived");
  const archived = streams.filter((stream) => stream.state === "archived");
  const options = workstreamLinkOptions(project, threads, copies);
  const editor = (stream: LibraryWorkstream | "new") => (
    <WorkstreamEditor
      key={stream === "new" ? "new" : stream.id}
      stream={stream}
      projectId={project.id}
      authorityId={authorityId}
      allowed={allowed}
      options={options}
      onDone={(saved) => {
        setEditing(null);
        if (saved) query.refresh();
      }}
    />
  );
  const list = (entries: readonly LibraryWorkstream[]) =>
    entries.map((stream) =>
      editing !== "new" && editing?.id === stream.id ? (
        editor(stream)
      ) : (
        <WorkstreamCard
          key={stream.id}
          stream={stream}
          threads={threads}
          canEdit={allowed && editing === null}
          onEdit={() => setEditing(stream)}
        />
      ),
    );
  return (
    <LibrarySection
      title="Workstreams"
      icon={WaypointsIcon}
      count={current.length}
      action={
        <Button
          shape="pill"
          size="sm"
          variant="outline"
          disabled={!allowed || editing !== null}
          onClick={() => setEditing("new")}
        >
          <PlusIcon />
          New workstream
        </Button>
      }
    >
      <p className="-mt-1 max-w-2xl text-sm text-muted-foreground">
        Keep conversations, branches and checks together around a goal. Optional for everyday work.
      </p>
      <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      {editing === "new" ? editor("new") : null}
      {query.isPending && !streams.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading workstreams...
        </p>
      ) : null}
      {!query.isPending && !query.error && !current.length && editing !== "new" ? (
        <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-5 dark:bg-accent/30">
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
          >
            <WaypointsIcon className="size-4" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {archived.length ? "Nothing active right now" : "No workstreams yet"}
            </p>
            <p className="max-w-lg text-sm text-muted-foreground">
              Start a conversation as usual. When work spans several conversations, branches or
              checks, group it here so finishing it means something.
            </p>
          </div>
        </div>
      ) : null}
      {current.length ? <div className="flex flex-col gap-3">{list(current)}</div> : null}
      {archived.length ? (
        <div className="flex flex-col gap-3">
          <div>
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              <ChevronDownIcon
                className={cn("transition-transform", !showArchived && "-rotate-90")}
              />
              {showArchived ? "Hide archived" : `Show ${archived.length} archived`}
            </Button>
          </div>
          {showArchived ? list(archived) : null}
        </div>
      ) : null}
    </LibrarySection>
  );
}

function WorkstreamCard({
  stream,
  threads,
  canEdit,
  onEdit,
}: {
  readonly stream: LibraryWorkstream;
  readonly threads: readonly LibraryThreadSummary[];
  readonly canEdit: boolean;
  readonly onEdit: () => void;
}) {
  const state = LIBRARY_WORKSTREAM_STATES[stream.state];
  const progress = workstreamProgress(stream);
  return (
    <article
      aria-label={stream.title}
      className={cn(
        "flex min-w-0 flex-col gap-3 p-4 sm:p-5",
        LIBRARY_SURFACE,
        stream.state === "archived" && "bg-transparent shadow-none",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight">
              {stream.title}
            </h3>
            <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            Updated {formatRelativeTimeLabel(stream.updatedAt)}
          </p>
        </div>
        <Button shape="pill" size="xs" variant="ghost" disabled={!canEdit} onClick={onEdit}>
          Review
        </Button>
      </div>
      {stream.goal ? (
        <p className="line-clamp-4 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
          {stream.goal}
        </p>
      ) : null}
      {progress.total ? <WorkstreamProgress {...progress} /> : null}
      {stream.references.length ? (
        <ul aria-label="Linked work" className="flex flex-wrap gap-1.5">
          {stream.references.map((reference) => (
            <li key={workstreamReferenceKey(reference)} className="min-w-0">
              <ReferenceChip reference={reference} threads={threads} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function WorkstreamProgress({
  done,
  blocked,
  total,
}: {
  readonly done: number;
  readonly blocked: number;
  readonly total: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Linked work done"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="flex h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-muted dark:bg-accent"
      >
        <span className="bg-(--project-color)" style={{ width: `${(done / total) * 100}%` }} />
        <span className="bg-destructive" style={{ width: `${(blocked / total) * 100}%` }} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {done} of {total} done
        {blocked ? <span className="text-destructive-foreground"> · {blocked} blocked</span> : null}
      </p>
    </div>
  );
}

function ReferenceChip({
  reference,
  threads,
}: {
  readonly reference: LibraryWorkstreamReference;
  readonly threads: readonly LibraryThreadSummary[];
}) {
  const Icon = KIND_ICONS[reference.kind];
  const state = LIBRARY_WORKSTREAM_REFERENCE_STATES[reference.state];
  const StateIcon = isWorkstreamReferenceDone(reference)
    ? CheckIcon
    : reference.state === "blocked"
      ? CircleAlertIcon
      : null;
  const className = cn(
    "inline-flex h-7 max-w-72 items-center gap-1.5 rounded-full border px-2.5 text-xs",
    CHIP_TONES[state.tone],
  );
  const body = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{reference.label}</span>
      {StateIcon ? <StateIcon aria-hidden className="size-3.5 shrink-0" /> : null}
      <span className="sr-only">
        {LIBRARY_WORKSTREAM_REFERENCE_KINDS[reference.kind]}, {state.label}
      </span>
    </>
  );
  const interactive = cn(className, "transition-colors duration-150 hover:bg-accent/60");
  if (reference.kind === "thread")
    return (
      <Link
        to="/library/conversations/$conversationId"
        params={{
          conversationId: workstreamReferenceThread(reference, threads)?.id ?? reference.id,
        }}
        className={interactive}
      >
        {body}
      </Link>
    );
  if (reference.url)
    return (
      <a href={reference.url} target="_blank" rel="noreferrer" className={interactive}>
        {body}
      </a>
    );
  return <span className={className}>{body}</span>;
}

function WorkstreamEditor({
  stream,
  projectId,
  authorityId,
  allowed,
  options,
  onDone,
}: {
  readonly stream: LibraryWorkstream | "new";
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly allowed: boolean;
  readonly options: readonly LibraryWorkstreamReference[];
  readonly onDone: (saved: boolean) => void;
}) {
  const save = useAtomCommand(projectLibrary.saveWorkstream, { reportFailure: false });
  const isNew = stream === "new";
  const [title, setTitle] = useState(isNew ? "" : stream.title);
  const [goal, setGoal] = useState(isNew ? "" : stream.goal);
  const [references, setReferences] = useState<readonly LibraryWorkstreamReference[]>(
    isNew ? [] : stream.references,
  );
  const [typedKind, setTypedKind] =
    useState<(typeof LIBRARY_WORKSTREAM_TYPED_KINDS)[number]>("verification");
  const [typedText, setTypedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftId = useRef(isNew ? randomUUID() : stream.id);
  // A retry after a lost response reuses the receipt, so the Library applies the save once.
  const pendingSave = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const persist = async (state: LibraryWorkstream["state"]) => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    const input = {
      id: draftId.current,
      projectId,
      expectedRevision: isNew ? 0 : stream.revision,
      title: title.trim(),
      goal,
      references,
      state,
    };
    const fingerprint = JSON.stringify(input);
    if (pendingSave.current?.fingerprint !== fingerprint)
      pendingSave.current = { fingerprint, requestId: randomUUID() };
    const result = await save({
      environmentId: authorityId,
      input: { ...input, requestId: pendingSave.current.requestId },
    });
    setBusy(false);
    if (result._tag === "Success") return onDone(true);
    const cause = squashAtomCommandFailure(result);
    setError(
      cause instanceof Error
        ? cause.message
        : "Could not save. Refresh and review linked work before completing.",
    );
  };
  const linked = new Set(references.map(workstreamReferenceKey));
  const add = (reference: LibraryWorkstreamReference) => {
    if (!linked.has(workstreamReferenceKey(reference)))
      setReferences((previous) => [...previous, reference]);
  };
  const addTyped = () => {
    const text = typedText.trim();
    if (!text) return;
    add({
      kind: typedKind,
      id: randomUUID(),
      label: text,
      ...(typedKind === "pull-request" ? { url: text } : {}),
      state: "open",
    });
    setTypedText("");
  };
  const reopening = !isNew && stream.state !== "active";
  return (
    <form
      aria-label={isNew ? "New workstream" : `Edit ${stream.title}`}
      className={cn("flex min-w-0 flex-col gap-4 p-4 sm:p-5", LIBRARY_SURFACE)}
      onSubmit={(event) => {
        event.preventDefault();
        void persist("active");
      }}
    >
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          size="lg"
          aria-label="Workstream title"
          placeholder="What are we working toward?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          disabled={busy}
        />
        <Textarea
          aria-label="Workstream goal"
          placeholder="Outcome and what done looks like"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          maxLength={8192}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Linked work
            {references.length ? (
              <span className="ms-1 font-normal tabular-nums">({references.length})</span>
            ) : null}
          </p>
          <Menu>
            <MenuTrigger
              disabled={busy || !options.length}
              render={<Button shape="pill" size="xs" variant="outline" />}
            >
              <LinkIcon />
              Link existing work
            </MenuTrigger>
            <MenuPopup align="end" className="max-h-80 w-80">
              {LINK_GROUPS.map((group) => {
                const entries = options.filter((option) => option.kind === group.kind);
                if (!entries.length) return null;
                const Icon = KIND_ICONS[group.kind];
                return (
                  <MenuGroup key={group.kind}>
                    <MenuGroupLabel>{group.title}</MenuGroupLabel>
                    {entries.map((option) => (
                      <MenuItem
                        key={workstreamReferenceKey(option)}
                        disabled={linked.has(workstreamReferenceKey(option))}
                        onClick={() => add(option)}
                      >
                        <Icon />
                        <span className="min-w-0 flex-1 truncate">
                          {option.label.trim() || "Untitled"}
                        </span>
                        {linked.has(workstreamReferenceKey(option)) ? (
                          <CheckIcon className="text-muted-foreground" />
                        ) : null}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                );
              })}
            </MenuPopup>
          </Menu>
        </div>
        {references.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {references.map((reference, index) => (
              <EditorReferenceRow
                key={workstreamReferenceKey(reference)}
                reference={reference}
                busy={busy}
                onState={(state) =>
                  setReferences((previous) =>
                    previous.map((entry, position) =>
                      position === index ? { ...entry, state } : entry,
                    ),
                  )
                }
                onUnlink={() =>
                  setReferences((previous) => previous.filter((_, position) => position !== index))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing linked yet. Link conversations or files, or add a check, branch or pull request
            below.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="New reference type"
            value={[typedKind]}
            onValueChange={(value) => {
              const kind = LIBRARY_WORKSTREAM_TYPED_KINDS.find((entry) => entry === value[0]);
              if (kind) setTypedKind(kind);
            }}
          >
            {LIBRARY_WORKSTREAM_TYPED_KINDS.map((kind) => {
              const Icon = KIND_ICONS[kind];
              return (
                <ToggleGroupItem key={kind} value={kind}>
                  <Icon />
                  {LIBRARY_WORKSTREAM_REFERENCE_KINDS[kind]}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              size="sm"
              aria-label="Reference name or URL"
              placeholder={TYPED_PLACEHOLDERS[typedKind]}
              value={typedText}
              onChange={(event) => setTypedText(event.target.value)}
              onKeyDown={(event) => {
                // Enter adds the reference instead of saving the whole workstream.
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTyped();
                }
              }}
              maxLength={160}
              disabled={busy}
            />
            <Button
              shape="pill"
              size="sm"
              type="button"
              variant="outline"
              disabled={busy || !typedText.trim()}
              onClick={addTyped}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
      <LibraryErrorNotice error={error} />
      <p className="text-xs text-muted-foreground">
        You or your agent record check results and pull request completion. Completing rechecks
        linked local work and refuses unfinished items.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button shape="pill" size="sm" type="submit" disabled={!allowed || busy || !title.trim()}>
          {reopening ? "Reopen workstream" : "Save active"}
        </Button>
        <Button
          shape="pill"
          size="sm"
          type="button"
          variant="outline"
          disabled={!allowed || busy || !title.trim()}
          onClick={() => void persist("completed")}
        >
          <CheckIcon />
          Complete
        </Button>
        <div className="ms-auto flex gap-1">
          {!isNew && stream.state !== "archived" ? (
            <Button
              shape="pill"
              size="sm"
              type="button"
              variant="ghost"
              disabled={!allowed || busy}
              onClick={() => void persist("archived")}
            >
              Archive
            </Button>
          ) : null}
          <Button
            shape="pill"
            size="sm"
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function EditorReferenceRow({
  reference,
  busy,
  onState,
  onUnlink,
}: {
  readonly reference: LibraryWorkstreamReference;
  readonly busy: boolean;
  readonly onState: (state: LibraryWorkstreamReference["state"]) => void;
  readonly onUnlink: () => void;
}) {
  const Icon = KIND_ICONS[reference.kind];
  const state = LIBRARY_WORKSTREAM_REFERENCE_STATES[reference.state];
  return (
    <li className="flex min-w-0 items-center gap-2.5 py-1.5 ps-3 pe-1.5">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{reference.label.trim() || "Untitled"}</p>
        <p className="text-2xs text-muted-foreground">
          {LIBRARY_WORKSTREAM_REFERENCE_KINDS[reference.kind]}
        </p>
      </div>
      <Menu>
        <MenuTrigger
          disabled={busy}
          aria-label={`State of ${reference.label}`}
          render={
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-64"
            />
          }
        >
          <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
          <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuRadioGroup
            value={reference.state}
            onValueChange={(value) => {
              const next = LIBRARY_WORKSTREAM_REFERENCE_STATE_ORDER.find(
                (entry) => entry === value,
              );
              if (next) onState(next);
            }}
          >
            {LIBRARY_WORKSTREAM_REFERENCE_STATE_ORDER.map((entry) => (
              <MenuRadioItem key={entry} value={entry}>
                {LIBRARY_WORKSTREAM_REFERENCE_STATES[entry].label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <Button
        type="button"
        shape="pill"
        size="icon-xs"
        variant="ghost"
        aria-label={`Unlink ${reference.label}`}
        disabled={busy}
        onClick={onUnlink}
      >
        <XIcon />
      </Button>
    </li>
  );
}
