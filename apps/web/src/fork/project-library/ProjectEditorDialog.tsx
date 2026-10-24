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
} from "lucide-react";
import { ProjectColorDot, ProjectTile } from "./ProjectIdentity";
import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import {
  LIBRARY_PROJECT_COLORS,
  PROJECT_WORKFLOWS_FEATURE,
  LibraryError,
  LibraryProjectColor,
  LibraryResource,
  LibraryBlueprint,
  LibraryProjectProfileInput,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import { PROJECT_COLOR_NAMES, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
import { useLibraryAttempt } from "./attempts";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission, useLibraryProjects } from "./state";

import { libraryResourceFromInput, validateResources } from "@t3tools/client-runtime/fork";

const decodeBlueprint = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryBlueprint));
const isLibraryError = Schema.is(LibraryError);
const EditorAttempt = Schema.NullOr(
  Schema.Struct({
    requestId: Schema.String,
    title: Schema.String,
    brief: Schema.String,
    resources: Schema.Array(LibraryResource),
    color: Schema.optional(LibraryProjectColor),
    profile: Schema.optional(LibraryProjectProfileInput),
  }),
);

/** Creating a project asks for a name; a brief and its repositories can come now or later. */
export function ProjectEditorDialog({
  open = true,
  embedded = false,
  onBack,
  initialTitle = "",
  initialResource = "",
  continueToConversation = false,
  authorityId,
  onSaved,
  onClose,
}: {
  readonly open?: boolean;
  readonly embedded?: boolean;
  readonly onBack?: (() => void) | undefined;
  readonly initialTitle?: string | undefined;
  readonly initialResource?: string | undefined;
  readonly continueToConversation?: boolean;
  readonly authorityId: EnvironmentId | null;
  readonly onSaved: (project: LibraryProject) => void;
  readonly onClose: () => void;
}) {
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:editor:${authorityId}:new`,
    EditorAttempt,
  );
  const [title, setTitle] = useState(attempt?.title ?? initialTitle);
  const [brief, setBrief] = useState(attempt?.brief ?? "");
  const [resources, setResources] = useState<readonly LibraryResource[]>(() => {
    const parsed = libraryResourceFromInput(initialResource, []);
    return attempt?.resources ?? (parsed ? [{ id: randomUUID(), ...parsed }] : []);
  });
  const [profile, setProfile] = useState<LibraryProjectProfileInput | undefined>(attempt?.profile);
  const [blueprintDraft, setBlueprintDraft] = useState("");
  const [resourceDraft, setResourceDraft] = useState("");
  const [color, setColor] = useState<LibraryProjectColor | undefined>(attempt?.color);
  const catalog = useLibraryProjects();
  const supportsBlueprint = supportsLoomFeature(
    catalog.environment?.serverConfig?.environment.capabilities,
    PROJECT_WORKFLOWS_FEATURE,
  );
  const existing = catalog.query.data?.find(
    (entry) =>
      !entry.archived && entry.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
  );
  const [page, setPage] = useState<"name" | "repository" | "brief" | "color" | "blueprint">("name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.createProject, authorityId);
  const locked = busy || attempt !== null;
  const save = async () => {
    if (!authorityId || !allowed || busy) return;
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
    const createProject = async () => {
      const input = attempt ?? {
        requestId: randomUUID(),
        title: title.trim(),
        brief,
        resources,
        ...(color ? { color } : {}),
        ...(profile ? { profile } : {}),
      };
      saveAttempt(input);
      const result = await create({ environmentId: authorityId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(result.value);
    };
    try {
      await createProject();
    } catch (cause) {
      const handleFailure = async () => {
        if (isLibraryError(cause) && ["invalid", "not-found"].includes(cause.reason))
          saveAttempt(null);
        setError(
          cause instanceof Error ? cause.message : "Could not create the project. Try again.",
        );
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
  };

  const back = () => {
    if (page !== "name") setPage("name");
    else onBack?.();
  };
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
    page === "blueprint" ? (
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
        title={
          page === "repository"
            ? "Add a repository or link"
            : page === "color"
              ? "Project color"
              : "New project"
        }
        placeholder={
          page === "repository"
            ? "Paste a repository URL or link..."
            : page === "color"
              ? "Search colors..."
              : "Name your project..."
        }
        query={page === "repository" ? resourceDraft : page === "color" ? colorSearch : title}
        onQueryChange={
          page === "repository" ? setResourceDraft : page === "color" ? setColorSearch : setTitle
        }
        onBack={page !== "name" || onBack ? back : undefined}
        onClose={onClose}
        busy={busy}
        readOnly={locked}
        filter={page === "color"}
        error={error ?? (page === "repository" ? resourceError : null)}
        message={
          attempt
            ? "Creation is waiting for confirmation. Retry to finish the same project."
            : continueToConversation
              ? "Create a project, then start a conversation. Repositories and a brief are optional."
              : "A shared home for your work. Repositories and a brief are optional."
        }
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
                    ) : parsed ? (
                      <FolderGit2Icon className="size-4" />
                    ) : (
                      <PlusIcon className="size-4" />
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
            : page === "color"
              ? [
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
              : [
                  {
                    id: "create-project",
                    title: busy
                      ? "Creating..."
                      : attempt
                        ? "Retry project creation"
                        : title.trim()
                          ? `Create “${title.trim()}”`
                          : "Enter a project name",
                    description: continueToConversation
                      ? "Continue to your conversation"
                      : "Open project",
                    disabled: !allowed || !title.trim(),
                    // The draft's mark previews name and color; an automatic color waits for an id.
                    icon: (
                      <ProjectTile
                        project={{ id: "draft", title: title.trim() || "?", color }}
                        neutral={!color}
                        size="sm"
                      />
                    ),
                    select: () => void save(),
                  },
                  ...(existing
                    ? [
                        {
                          id: "existing",
                          title: `Use existing ${existing.title}`,
                          description: "Keep work in the project already in your Library",
                          disabled: locked,
                          icon: <FolderOpenIcon className="size-4" />,
                          select: () => onSaved(existing),
                        },
                      ]
                    : []),
                  ...(supportsBlueprint
                    ? [
                        {
                          id: "blueprint",
                          title: profile ? "Review imported blueprint" : "Use a project blueprint",
                          description: profile
                            ? `${resources.length} repositories and links. Review shared scripts in Preferences before running them.`
                            : "Paste portable repository layout and setup",
                          disabled: locked,
                          icon: <FileJsonIcon className="size-4" />,
                          select: () => {
                            setError(null);
                            setPage("blueprint");
                          },
                        },
                      ]
                    : []),
                  {
                    id: "repository",
                    title: "Add a repository or link",
                    description: resources.length
                      ? `${resources.length} added`
                      : "Optional. You can also add these later.",
                    next: true,
                    disabled: locked || resources.length >= 64,
                    icon: <FolderGit2Icon className="size-4" />,
                    select: () => setPage("repository"),
                  },
                  {
                    id: "brief",
                    title: "Project brief",
                    description: brief || "Optional",
                    next: true,
                    disabled: locked,
                    icon: <PencilLineIcon className="size-4" />,
                    select: () => setPage("brief"),
                  },
                  {
                    id: "color",
                    title: "Project color",
                    description: color ? PROJECT_COLOR_NAMES[color] : "Automatic",
                    next: true,
                    disabled: locked,
                    icon: color ? (
                      <ProjectColorDot color={color} className="size-3" />
                    ) : (
                      <PaletteIcon className="size-4" />
                    ),
                    select: () => setPage("color"),
                  },
                  ...resources.map((resource) => ({
                    id: resource.id,
                    title: resource.title,
                    description: "Remove from this project",
                    disabled: locked,
                    icon:
                      resource.kind === "link" ? (
                        <LinkIcon className="size-4" />
                      ) : (
                        <FolderGit2Icon className="size-4" />
                      ),
                    select: () =>
                      setResources((current) =>
                        current.filter((entry) => entry.id !== resource.id),
                      ),
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
