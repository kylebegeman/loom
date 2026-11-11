import { LibraryTextPalette } from "./LibraryTextPalette";
import { LibraryPaletteDialog, LibraryPaletteView } from "./LibraryPalette";
import {
  FileJsonIcon,
  FolderGit2Icon,
  FolderOpenIcon,
  LinkIcon,
  PaletteIcon,
  PencilLineIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { ProjectColorDot, ProjectTile } from "./ProjectIdentity";
import { randomUUID } from "~/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { LibraryErrorNotice, LibraryField } from "./LibraryControls";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  LIBRARY_PROJECT_COLORS,
  PROJECT_WORKFLOWS_FEATURE,
  LibraryError,
  LibraryProjectColor,
  LibraryProject,
  LibraryResource,
  LibraryBlueprint,
  LibraryProjectProfileInput,
} from "@t3tools/contracts/fork";
import { PROJECT_COLOR_NAMES, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
import { useLibraryAttempt } from "./attempts";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";

import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentSessionState } from "~/state/session";
import { LibraryAccessNotice } from "./LibraryAccessNotice";
import {
  projectLibrary,
  useLibraryAccessBlock,
  useLibraryPermission,
  useLibraryProjects,
} from "./state";

import { libraryResourceFromInput, validateResources } from "@t3tools/client-runtime/fork";
import { holdsGitRemote, newProjectDraftKey } from "./newProjectChoices";

const decodeBlueprint = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryBlueprint));
const isLibraryError = Schema.is(LibraryError);
const isProject = Schema.is(LibraryProject);
const EditorAttempt = Schema.NullOr(
  Schema.Struct({
    requestId: Schema.String,
    title: Schema.String,
    brief: Schema.String,
    resources: Schema.Array(LibraryResource),
    color: Schema.optional(LibraryProjectColor),
    profile: Schema.optional(LibraryProjectProfileInput),
    result: Schema.optional(LibraryProject),
    initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
  }),
);

/** Creating a project asks for a name; a brief and its repositories can come now or later. */
export function ProjectEditorDialog({
  open = true,
  embedded = false,
  onBack,
  initialTitle = "",
  initialResource = "",
  initialPage = "name",
  continueTo = "project",
  authorityId,
  onSaved,
  onClose,
}: {
  readonly open?: boolean;
  readonly embedded?: boolean;
  readonly onBack?: (() => void) | undefined;
  readonly initialTitle?: string | undefined;
  readonly initialResource?: string | undefined;
  /** Where the form opens; a blueprint fills in the name page once imported. */
  readonly initialPage?: "name" | "blueprint";
  /** What follows a save: the project page, a conversation, or cloning its repositories. */
  readonly continueTo?: "project" | "conversation" | "clone";
  readonly authorityId: EnvironmentId;
  readonly onSaved: (project: LibraryProject) => void;
  readonly onClose: () => void;
}) {
  const legacyKey = `loom:library:editor:${authorityId}:new`;
  const key = `${legacyKey}:${newProjectDraftKey({ step: "create", page: initialPage, repository: initialResource, title: initialTitle })}`;
  const [scopedAttempt, saveAttempt] = useLibraryAttempt(key, EditorAttempt);
  const [legacyAttempt, saveLegacyAttempt] = useLibraryAttempt(legacyKey, EditorAttempt);
  const matchingLegacy =
    initialPage === "name" &&
    legacyAttempt &&
    (initialResource
      ? holdsGitRemote(legacyAttempt.resources, initialResource)
      : !initialTitle || legacyAttempt.title === initialTitle)
      ? legacyAttempt
      : null;
  const attempt = scopedAttempt ?? matchingLegacy;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- migrates the matching saved request from the former single-slot browser key
  useEffect(() => {
    if (!scopedAttempt && matchingLegacy) {
      saveAttempt(matchingLegacy);
      saveLegacyAttempt(null, (latest) => latest?.requestId === matchingLegacy.requestId);
    }
  }, [scopedAttempt, matchingLegacy, saveAttempt, saveLegacyAttempt]);
  const [resumed, setResumed] = useState(() => attempt?.requestId ?? null);
  const saved = attempt?.requestId === resumed ? attempt : null;
  const [title, setTitle] = useState(saved?.title ?? initialTitle);
  const [brief, setBrief] = useState(saved?.brief ?? "");
  const [resources, setResources] = useState<readonly LibraryResource[]>(() => {
    const parsed = libraryResourceFromInput(initialResource, []);
    return saved?.resources ?? (parsed ? [{ id: randomUUID(), ...parsed }] : []);
  });
  const [profile, setProfile] = useState<LibraryProjectProfileInput | undefined>(saved?.profile);
  const [blueprintDraft, setBlueprintDraft] = useState("");
  const [resourceDraft, setResourceDraft] = useState("");
  const [color, setColor] = useState<LibraryProjectColor | undefined>(saved?.color);
  const catalog = useLibraryProjects();
  const supportsBlueprint = supportsLoomFeature(
    catalog.environment?.serverConfig?.environment.capabilities,
    PROJECT_WORKFLOWS_FEATURE,
  );
  const existing = catalog.query.data?.find(
    (entry) =>
      !entry.archived &&
      entry.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase() &&
      (!initialResource || holdsGitRemote(entry.resources, initialResource)),
  );
  const [page, setPage] = useState<"name" | "repository" | "brief" | "color" | "blueprint">(
    saved ? "name" : initialPage,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const lookup = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
  const identity = useEnvironmentSessionState(authorityId).data?.identity;
  const sameInitiator = (input: NonNullable<typeof EditorAttempt.Type>) =>
    !input.initiator ||
    (input.initiator.issuer === identity?.issuer && input.initiator.subject === identity?.subject);
  const accountMatches = !saved || sameInitiator(saved);
  const [checking, setChecking] = useState(false);
  const allowed = useLibraryPermission(projectLibrary.createProject, authorityId);
  const access = useLibraryAccessBlock(authorityId, [projectLibrary.createProject]);
  // Access is apart from the form: the notice on the name page says why and offers the repair.
  const canSave = allowed && access === null;
  const mounted = useRef(true);
  const inFlight = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks the lifetime of this editor for its in-flight server request
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useStableCallback(
    (input: NonNullable<typeof EditorAttempt.Type>) =>
      mounted.current && open && sameInitiator(input),
  );
  const checkingId = useRef<string | null>(null);
  const working = busy || checking;
  const reconcile = useStableCallback(async (input: NonNullable<typeof EditorAttempt.Type>) => {
    if (checkingId.current || !sameInitiator(input)) return undefined;
    checkingId.current = input.requestId;
    setChecking(true);
    const result = await lookup({
      environmentId: authorityId,
      input: { requestId: input.requestId, kind: "create" },
    });
    checkingId.current = null;
    if (mounted.current) setChecking(false);
    if (!current(input)) return undefined;
    if (result._tag !== "Success") {
      setError(
        "Could not check the original creation result. Reconnect to this Library and check again before retrying.",
      );
      return undefined;
    }
    const operation = result.value;
    if (operation?.state === "succeeded") {
      if (isProject(operation.result))
        saveAttempt(
          { ...input, result: operation.result },
          (latest) => latest?.requestId === input.requestId,
        );
      else
        setError(
          "The creation receipt does not contain a project. Keep these details and update Loom before retrying.",
        );
      return undefined;
    }
    if (operation?.state === "queued" || operation?.state === "running") {
      setError(
        "Project creation is already in progress. Check the result again before continuing.",
      );
      return undefined;
    }
    return operation;
  });
  const locked = working || saved !== null;
  const completeCreation = useStableCallback(
    async (input: NonNullable<typeof EditorAttempt.Type>) => {
      if (inFlight.current === input.requestId) return;
      inFlight.current = input.requestId;
      const { result: _result, initiator: _initiator, ...request } = input;
      const result = await create({ environmentId: authorityId, input: request });
      inFlight.current = null;
      if (!current(input)) {
        if (result._tag === "Success")
          saveAttempt(
            { ...input, result: result.value },
            (latest) => latest?.requestId === input.requestId,
          );
        if (mounted.current) setBusy(false);
        return;
      }
      if (result._tag === "Success") {
        saveAttempt(null, (latest) => latest?.requestId === input.requestId);
        onSaved(result.value);
      } else {
        const cause = squashLibraryCommandFailure(result);
        setAccessRepair(isLibraryError(cause) ? cause.accessRepair : undefined);
        if (isLibraryError(cause) && ["invalid", "not-found"].includes(cause.reason))
          saveAttempt(null, (latest) => latest?.requestId === input.requestId);
        setError(
          cause instanceof Error ? cause.message : "Could not create the project. Try again.",
        );
      }
      setBusy(false);
    },
  );
  const save = async () => {
    if (!canSave || working || !accountMatches) return;
    if (saved) {
      const operation = await reconcile(saved);
      if (operation === undefined) return;
      if (operation?.state === "cancelled") {
        setError("This creation was cancelled. Keep its receipt and start a different project.");
        return;
      }
    }
    if (profile && !supportsBlueprint) {
      setError("Connect an updated Library before creating a project from this blueprint.");
      return;
    }
    const validation = validateResources(resources);
    if (!title.trim() || validation) {
      setError(validation ?? "Give the project a name.");
      return;
    }
    setBusy(true);
    setError(null);
    setAccessRepair(undefined);
    const input = saved ?? {
      requestId: randomUUID(),
      title: title.trim(),
      brief,
      resources,
      ...(color ? { color } : {}),
      ...(profile ? { profile } : {}),
      ...(identity ? { initiator: identity } : {}),
    };
    setResumed(input.requestId);
    saveAttempt(input);
    await completeCreation(input);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- delivers an already received creation result when its editor becomes visible
  useEffect(() => {
    if (!open || !saved?.result || !accountMatches) return;
    saveAttempt(null, (latest) => latest?.requestId === saved.requestId);
    onSaved(saved.result);
  }, [open, saved, saveAttempt, onSaved, accountMatches]);

  const savedRequestId = saved?.requestId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles a persisted request by reading its receipt when access or visibility returns
  useEffect(() => {
    if (open && canSave && accountMatches && savedRequestId && !inFlight.current) {
      const input = attempt?.requestId === savedRequestId ? attempt : null;
      if (input && !input.result) void reconcile(input);
    }
  }, [open, canSave, accountMatches, savedRequestId, attempt, reconcile]);

  // A form that opened on the blueprint leaves from it until a blueprint fills in the name page.
  const back = () => {
    if (page !== "name" && !(page === initialPage && !profile)) setPage("name");
    else onBack?.();
  };
  const clones = continueTo === "clone" && holdsGitRemote(resources, initialResource);
  const parsed = libraryResourceFromInput(resourceDraft, resources);
  const target = parsed ? (parsed.kind === "link" ? parsed.url : parsed.remoteUrl) : null;
  const resourceError =
    target &&
    resources.some(
      (resource) => (resource.kind === "link" ? resource.url : resource.remoteUrl) === target,
    )
      ? "That's already in this project."
      : parsed
        ? validateResources([...resources, { id: "draft", ...parsed }])
        : null;
  const [colorSearch, setColorSearch] = useState("");
  if (!open) return null;
  const importBlueprint = () => {
    const result = decodeBlueprint(blueprintDraft);
    if (result._tag === "None") {
      setError("Paste a version 1 Loom blueprint without credentials or computer preferences.");
      return;
    }
    const value = result.value;
    const validation = validateResources(value.resources);
    if (validation) {
      setError(validation);
      return;
    }
    setTitle(value.title);
    setBrief(value.brief);
    setResources(value.resources);
    setColor(value.color);
    setProfile({ ...value.setup, connectionNames: value.connections });
    setError(null);
    setPage("name");
  };
  const content =
    page === "name" ? (
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !working) {
            event.preventDefault();
            event.stopPropagation();
            (onBack ?? onClose)();
          }
        }}
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">New project</h2>
            <p className="text-sm text-muted-foreground">
              {continueTo === "conversation"
                ? "Create your project, then start a thread."
                : clones
                  ? "Create your project and clone its repository."
                  : "Give your project a name to get started."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Close"
            disabled={working}
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </header>
        <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-5">
          <LibraryField label="Project name">
            <Input
              nativeInput
              autoFocus
              value={title}
              readOnly={locked}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project name"
            />
          </LibraryField>
          {resources.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {resources.length === 1
                  ? resources[0]?.kind === "link"
                    ? "Link"
                    : "Repository"
                  : "Repositories and links"}
              </p>
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/35 p-3"
                >
                  {resource.kind === "link" ? (
                    <LinkIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{resource.title}</p>
                    <p className="wrap-anywhere text-xs text-muted-foreground">
                      {resource.kind === "link" ? resource.url : resource.remoteUrl}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Remove ${resource.title}`}
                    disabled={locked}
                    onClick={() =>
                      setResources((current) => current.filter((entry) => entry.id !== resource.id))
                    }
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <details className="group">
            <summary className="w-fit cursor-pointer rounded-md text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              More options
            </summary>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || resources.length >= 64}
                onClick={() => setPage("repository")}
              >
                <PlusIcon aria-hidden /> Add a repository or link
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => setPage("brief")}
              >
                <PencilLineIcon aria-hidden /> Project brief
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => setPage("color")}
              >
                <PaletteIcon aria-hidden /> Project color
              </Button>
              {supportsBlueprint ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    setError(null);
                    setPage("blueprint");
                  }}
                >
                  <FileJsonIcon aria-hidden />{" "}
                  {profile ? "Review imported blueprint" : "Use a project blueprint"}
                </Button>
              ) : null}
            </div>
          </details>
          {saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              {accountMatches
                ? "Your project details are saved. Resume creation when you are ready."
                : "Sign in with the account that started creation to recover this request."}
            </p>
          ) : null}
          <LibraryErrorNotice error={error} accessRepair={accessRepair} onLeave={onClose} />
          {access ? <LibraryAccessNotice block={access} onLeave={onClose} /> : null}
          {saved && !working ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canSave || !accountMatches}
              onClick={async () => {
                const operation = await reconcile(saved);
                if (operation === undefined) return;
                if (operation !== null) {
                  setError(
                    "This request was already accepted. Resume it with its original details before starting another.",
                  );
                  return;
                }
                saveAttempt(null, (latest) => latest?.requestId === saved.requestId);
                setResumed(null);
                setError(null);
              }}
            >
              <RotateCcwIcon aria-hidden /> Start over
            </Button>
          ) : null}
          {existing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => onSaved(existing)}
            >
              <FolderOpenIcon aria-hidden /> Use existing {existing.title}
            </Button>
          ) : null}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <ProjectTile
              project={{ id: "draft", title: title.trim() || "?", color }}
              neutral={!color}
              size="sm"
            />
            {onBack ? (
              <Button type="button" variant="ghost" size="sm" disabled={working} onClick={onBack}>
                Back
              </Button>
            ) : null}
          </span>
          <Button type="submit" disabled={!canSave || !accountMatches || !title.trim() || working}>
            {checking
              ? "Checking result…"
              : busy
                ? "Creating…"
                : saved
                  ? "Resume creation"
                  : continueTo === "conversation"
                    ? "Create and continue"
                    : "Create project"}
          </Button>
        </footer>
      </form>
    ) : page === "blueprint" ? (
      <LibraryTextPalette
        title="Import project blueprint"
        value={blueprintDraft}
        onChange={setBlueprintDraft}
        onBack={back}
        onClose={onClose}
        onDone={importBlueprint}
        doneLabel="Review this blueprint"
        error={error}
      />
    ) : page === "brief" ? (
      <LibraryTextPalette
        title="Project brief"
        value={brief}
        onChange={setBrief}
        onBack={back}
        onClose={onClose}
      />
    ) : (
      <LibraryPaletteView
        key={page}
        title={page === "repository" ? "Add a repository or link" : "Project color"}
        placeholder={
          page === "repository" ? "Paste a repository URL or link..." : "Search colors..."
        }
        query={page === "repository" ? resourceDraft : colorSearch}
        onQueryChange={page === "repository" ? setResourceDraft : setColorSearch}
        onBack={back}
        onClose={onClose}
        busy={working}
        readOnly={locked}
        filter={page === "color"}
        error={error ?? (page === "repository" ? resourceError : null)}
        items={
          page === "repository"
            ? [
                {
                  id: "add-repository",
                  title: parsed ? `Add ${parsed.title}` : "Paste a repository URL or link",
                  disabled: locked || !parsed || !!resourceError,
                  icon:
                    parsed?.kind === "link" ? (
                      <LinkIcon className="size-4" />
                    ) : (
                      <FolderGit2Icon className="size-4" />
                    ),
                  select: () => {
                    if (parsed && !resourceError) {
                      setResources((current) => [...current, { id: randomUUID(), ...parsed }]);
                      setResourceDraft("");
                      setPage("name");
                    }
                  },
                },
              ]
            : [
                {
                  id: "automatic",
                  title: "Automatic",
                  description: "Loom picks one once the project exists",
                  icon: <PaletteIcon className="size-4" />,
                  selected: color === undefined,
                  select: () => {
                    setColor(undefined);
                    setPage("name");
                  },
                },
                ...LIBRARY_PROJECT_COLORS.map((choice) => ({
                  id: choice,
                  title: PROJECT_COLOR_NAMES[choice],
                  icon: <ProjectColorDot color={choice} className="size-3" />,
                  selected: color === choice,
                  select: () => {
                    setColor(choice);
                    setPage("name");
                  },
                })),
              ]
        }
      />
    );
  return embedded ? (
    content
  ) : (
    <LibraryPaletteDialog title="New project" onClose={onClose}>
      {content}
    </LibraryPaletteDialog>
  );
}
