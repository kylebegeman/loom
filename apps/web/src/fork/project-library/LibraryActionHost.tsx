import {
  libraryCopyFolderConversations,
  libraryLaunchCanUseWorktree,
  libraryLaunchInputs,
  libraryLaunchWorkspace,
  libraryQuickLaunch,
  libraryStartIntent,
  libraryStartRepositoryProjects,
  rankLibraryStartProjects,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { ProjectTile } from "./ProjectIdentity";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentProviders } from "~/state/environments";
import { useProjects, useThreadShells } from "~/state/entities";
import { runtimeModeConfig } from "~/components/chat/runtimeModeConfig";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_WORKTREE_STARTS_FEATURE,
  type LibraryProject,
  type LibraryThreadSummary,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon, MessageSquareDashedIcon, PlusIcon } from "lucide-react";
import {
  projectLibrary,
  useLibraryProject,
  useLibraryLocalCatalog,
  useLibraryProjects,
  useSelectedLibraryProject,
} from "./state";
import { onLibraryAction, type LibraryConversationDefaults, type LibraryAction } from "./actions";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import {
  NewConversationDialog,
  libraryConversationDefaults,
  selectLastUsedModel,
} from "./NewConversationDialog";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ConversationAutoStartContext, type ConversationQuickStart } from "./ConversationPalette";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryPaletteView, type LibraryPaletteItem } from "./LibraryPalette";
import { useNoProjectStart } from "./useNoProjectStart";

const NO_PROJECT_TERMS = ["no project", "without project", "none"];

export interface LibraryPaletteSession {
  readonly id: number;
  readonly open: boolean;
  readonly action: LibraryAction;
  readonly projectId?: string | undefined;
  readonly defaults?: LibraryConversationDefaults | undefined;
  /** The project only leads the chooser; its settings open once the user picks it. */
  readonly suggest?: boolean | undefined;
}

/** Library setup occupies the original command popup, including actions launched inside it. */
export function useLibraryPaletteSession() {
  const [session, setSession] = useState<LibraryPaletteSession | null>(null);
  useEffect(() => {
    return onLibraryAction((action, projectId, defaults, suggest) =>
      setSession((previous) => ({
        id: (previous?.id ?? 0) + 1,
        open: true,
        action,
        projectId,
        defaults,
        suggest,
      })),
    );
  }, []);
  return {
    session,
    isOpen: session?.open === true,
    close: () => setSession((previous) => (previous ? { ...previous, open: false } : null)),
    // Keep the current page through the popup's exit transition.
    finishClose: () => setSession((previous) => (previous?.open ? previous : null)),
  };
}

type ProjectStep = "project" | "create" | "import" | "conversation";

export function LibraryActionHost({
  session,
  onClose,
}: {
  readonly session: LibraryPaletteSession;
  readonly onClose: () => void;
}) {
  const [, selectProject] = useSelectedLibraryProject();
  const [defaults, setDefaults] = useState(session.defaults);
  const [requestedProject, setRequestedProject] = useState(session.projectId ?? null);
  const [chosenProject, setChosenProject] = useState<LibraryProject | null>(null);
  const [chosenCopy, setChosenCopy] = useState<LibraryWorkingCopy | null>(null);
  const library = useLibraryProject(requestedProject ?? "");
  const catalog = useLibraryProjects();
  const navigate = useNavigate();
  const action = session.action;
  const [step, setStep] = useState<ProjectStep>(
    action === "create-project"
      ? "create"
      : action === "import-folder"
        ? "import"
        : session.projectId && !session.suggest
          ? "conversation"
          : "project",
  );
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [initialResource, setInitialResource] = useState("");
  const [initialFolder, setInitialFolder] = useState("");
  // A start a project row or a folder just added promised, `pending` until it runs or its settings
  // show instead. `run` remounts the settings so they begin from its defaults.
  const [quick, setQuick] = useState<{
    readonly projectId: string;
    readonly launch: ConversationQuickStart;
    readonly run: number;
    readonly pending: boolean;
  } | null>(null);
  const recent = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.threadIndex({ environmentId: catalog.authorityId, input: { limit: 200 } })
      : null,
  );
  const intent = libraryStartIntent(search);
  const repositoryProjects =
    intent.kind === "repository"
      ? libraryStartRepositoryProjects(catalog.query.data ?? [], intent.url)
      : [];
  // A visited step stays mounted so Back keeps its draft. Once saved it holds nothing to return to,
  // only checks and names from before the save, so the next visit starts fresh.
  const [visited, setVisited] = useState({
    create: action === "create-project",
    import: action === "import-folder",
  });
  const show = (next: "create" | "import") => {
    setVisited((previous) => ({ ...previous, [next]: true }));
    setStep(next);
  };
  const forget = (draft: "create" | "import") =>
    setVisited((previous) => ({ ...previous, [draft]: false }));
  // Inherited settings belong to their settings step, so only a chooser the user did not fill in
  // starts in one step.
  const quickStarts = useQuickStarts({
    enabled:
      action === "new-conversation" && (session.defaults === undefined || session.suggest === true),
    authorityId: catalog.authorityId,
    offline: catalog.offline,
    environments: catalog.environments,
    computers: catalog.computers,
    projects: catalog.query.data,
    threads: recent.data?.threads,
  });
  /**
   * `launch` is the start a row promised. `start` runs it; otherwise the settings open on its
   * computer and files, as the row showed them. Without a promise the settings choose.
   */
  const choose = (
    project: LibraryProject,
    copy?: LibraryWorkingCopy,
    launch?: ConversationQuickStart,
    start = true,
  ) => {
    // Returning to the same project keeps its settings and draft, unless a start remounts them.
    // Anything else ends the promise, whose computer would otherwise outrank the one holding a
    // folder added since.
    setQuick((previous) =>
      previous?.projectId === project.id && !copy && !(launch && start)
        ? { ...previous, pending: false }
        : launch
          ? { projectId: project.id, launch, run: (previous?.run ?? 0) + 1, pending: start }
          : null,
    );
    let nextDefaults = defaults;
    // Files and repositories carry only into the project they came from, and never into a
    // promise, which names its own.
    if (defaults && (launch || (requestedProject && requestedProject !== project.id)))
      nextDefaults = {
        ...(defaults.environmentId ? { environmentId: defaults.environmentId } : {}),
        ...(defaults.modelSelection ? { modelSelection: defaults.modelSelection } : {}),
        ...(defaults.runtimeMode ? { runtimeMode: defaults.runtimeMode } : {}),
        ...(defaults.interactionMode ? { interactionMode: defaults.interactionMode } : {}),
      };
    if (copy)
      nextDefaults = { ...nextDefaults, environmentId: copy.environmentId, workingCopyId: copy.id };
    setDefaults(nextDefaults);
    selectProject(project.id);
    setRequestedProject(project.id);
    setChosenProject(project);
    setChosenCopy(copy ?? (chosenCopy?.projectId === project.id ? chosenCopy : null));
    if (action === "new-conversation") setStep("conversation");
    else {
      onClose();
      void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
    }
  };
  const project =
    chosenProject ?? (library.project.data?.id === requestedProject ? library.project.data : null);
  const copies = library.copies.data ?? [];
  const launchCopies =
    chosenCopy &&
    chosenCopy.projectId === project?.id &&
    !copies.some((copy) => copy.id === chosenCopy.id)
      ? [...copies, chosenCopy]
      : copies;
  const loadingProject = step === "conversation" && !project && library.project.isPending;
  const needsProject =
    step === "project" || (step === "conversation" && (!project || project.archived));
  const back = () => {
    setStep("project");
    setQuick((previous) => (previous ? { ...previous, pending: false } : null));
  };
  const projectRow = (
    entry: LibraryProject,
    row: Omit<LibraryPaletteItem, "select" | "options">,
  ): LibraryPaletteItem => {
    const promise = quickStarts.starts.get(entry.id);
    return {
      ...row,
      summary: promise?.summary ?? row.summary,
      select: () => choose(entry, undefined, promise?.launch),
      ...(action === "new-conversation"
        ? {
            // Without a promise, Enter opens the settings too.
            enterLabel: promise ? "Start" : "Options",
            options: () => choose(entry, undefined, promise?.launch, false),
          }
        : {}),
    };
  };
  const quickProject = quick?.projectId === project?.id ? quick : null;
  const noProject = useNoProjectStart();
  // A new chat need not belong to a project, so the way out leads, even during Library setup.
  const noProjectItems: LibraryPaletteItem[] =
    action === "new-conversation" && noProject && !loadingProject
      ? [
          {
            id: "no-project",
            title: "No project",
            summary: `Starts on ${noProject.label}`,
            terms: NO_PROJECT_TERMS,
            enterLabel: "Start",
            icon: <MessageSquareDashedIcon className="size-4 text-muted-foreground" />,
            select: () => {
              onClose();
              void noProject.start();
            },
          },
        ]
      : [];
  const projectRows = rankLibraryStartProjects(
    catalog.query.data ?? [],
    recent.data?.threads ?? [],
  ).map((entry) => {
    const brief = entry.brief.trim().split("\n")[0];
    return projectRow(entry, {
      id: entry.id,
      title: entry.title,
      description: brief || undefined,
      summary: brief ? undefined : "Start a conversation",
      terms: entry.resources.map((resource) => `${resource.title} ${resource.remoteUrl ?? ""}`),
      icon: <ProjectTile project={entry} size="sm" />,
      next: true,
    });
  });
  // The project where the user is leads, ahead of No project, so Enter takes it.
  const suggested = session.suggest
    ? projectRows.filter((row) => row.id === session.projectId)
    : [];
  return (
    <>
      {!library.authorityId || needsProject ? (
        <LibraryPaletteView
          title="New conversation"
          placeholder="Search projects or choose an action..."
          query={search}
          onQueryChange={setSearch}
          onClose={onClose}
          busy={loadingProject}
          message={
            loadingProject
              ? "Loading project..."
              : catalog.query.isPending
                ? "Loading projects..."
                : undefined
          }
          // A suggested project that no longer loads is only left out, not an error.
          error={catalog.query.error ?? (step === "conversation" ? library.project.error : null)}
          items={
            !library.authorityId || loadingProject
              ? noProjectItems
              : [
                  ...suggested,
                  ...noProjectItems,
                  ...repositoryProjects.map((entry) =>
                    projectRow(entry, {
                      id: `repository:${entry.id}`,
                      title: `Continue ${entry.title}`,
                      description: "This repository is already part of this project",
                      terms: [search],
                      icon: <ProjectTile project={entry} size="sm" />,
                      next: true,
                    }),
                  ),
                  ...(intent.kind !== "search"
                    ? [
                        {
                          id: "resource-intent",
                          title:
                            intent.kind === "folder"
                              ? `Use folder: ${intent.title}`
                              : repositoryProjects.length
                                ? `Create another project from ${intent.title}`
                                : `Start from repository: ${intent.title}`,
                          description: intent.kind === "folder" ? intent.path : intent.url,
                          terms: [search],
                          icon: <FolderPlusIcon className="size-4 text-(--project-teal)" />,
                          next: true,
                          select: () => {
                            if (intent.kind === "folder") {
                              setInitialFolder(intent.path);
                              show("import");
                            } else {
                              setInitialResource(intent.url);
                              setNewTitle(intent.title);
                              show("create");
                            }
                          },
                        },
                      ]
                    : []),
                  ...projectRows.filter((row) => !suggested.includes(row)),
                  ...(intent.kind === "search"
                    ? [
                        {
                          id: "new-project",
                          title: search.trim()
                            ? visited.create
                              ? "Continue new project"
                              : `New project: ${search.trim()}`
                            : "New project",
                          terms: [search],
                          description: visited.create
                            ? "Return to your project draft"
                            : "Start something new",
                          icon: <PlusIcon className="size-4 text-(--project-green)" />,
                          next: true,
                          select: () => {
                            if (!visited.create) setNewTitle(search.trim());
                            show("create");
                          },
                        },
                      ]
                    : []),
                  {
                    id: "import",
                    title: "Add existing folder",
                    description: "Browse files on a connected computer",
                    icon: <FolderPlusIcon className="size-4 text-(--project-teal)" />,
                    next: true,
                    select: () => {
                      setInitialFolder("");
                      show("import");
                    },
                  },
                  ...(catalog.query.error
                    ? [
                        {
                          id: "retry",
                          title: "Try again",
                          select: () => {
                            catalog.query.refresh();
                            library.refresh();
                          },
                        },
                      ]
                    : []),
                ]
          }
        >
          {!library.authorityId ? (
            <div className="p-4">
              <LibrarySetup showConnectionsLink={false} />
            </div>
          ) : null}
        </LibraryPaletteView>
      ) : null}
      {library.authorityId && visited.create ? (
        <ProjectEditorDialog
          key={initialResource || "new"}
          embedded
          open={step === "create"}
          authorityId={library.authorityId}
          initialTitle={newTitle}
          initialResource={initialResource}
          continueToConversation={action === "new-conversation"}
          onBack={back}
          onClose={onClose}
          onSaved={(saved) => {
            forget("create");
            choose(saved);
          }}
        />
      ) : null}
      {library.authorityId && visited.import ? (
        <ImportProjectDialog
          key={initialFolder || "browse"}
          embedded
          open={step === "import"}
          initialHostId={defaults?.environmentId}
          initialRootPath={initialFolder}
          onBack={back}
          onClose={onClose}
          // The folder just added is where the user means to work, so it starts there when the
          // settings need no choice.
          onSaved={(saved, copy) => {
            forget("import");
            choose(
              saved,
              copy,
              copy && quickStarts.start(saved, [copy], copy.environmentId)?.launch,
            );
          }}
        />
      ) : null}
      {library.authorityId && project && !project.archived ? (
        <ConversationAutoStartContext
          value={
            quickProject?.pending && step === "conversation"
              ? {
                  launch: quickProject.launch,
                  settle: () =>
                    setQuick((previous) => (previous ? { ...previous, pending: false } : null)),
                }
              : null
          }
        >
          <NewConversationDialog
            key={`${project.id}:${defaults?.workingCopyId ?? ""}:${quickProject?.run ?? 0}`}
            embedded
            open={step === "conversation"}
            project={project}
            initialHostId={quickProject?.launch.environmentId ?? defaults?.environmentId}
            initialCopyId={defaults?.workingCopyId}
            initialResourceId={defaults?.resourceId}
            initialResourceIds={defaults?.resourceIds}
            initialModelSelection={defaults?.modelSelection}
            initialRuntimeMode={defaults?.runtimeMode}
            initialInteractionMode={defaults?.interactionMode}
            copies={launchCopies}
            copiesQuery={library.copies}
            onChooseProject={back}
            onChanged={library.refresh}
            onClose={onClose}
          />
        </ConversationAutoStartContext>
      ) : null}
    </>
  );
}

type LibraryCatalog = ReturnType<typeof useLibraryProjects>;

/**
 * What Enter starts for each project: the computer, model and permissions its settings would
 * open with, when they need no choice. Its inputs leave out the search, so typing reuses it.
 */
export function useQuickStarts({
  enabled,
  authorityId,
  offline = false,
  copies: suppliedCopies,
  environments,
  computers: remembered,
  projects,
  threads,
}: {
  readonly enabled: boolean;
  readonly authorityId: LibraryCatalog["authorityId"];
  readonly offline?: boolean;
  readonly copies?: readonly LibraryWorkingCopy[];
  readonly environments: LibraryCatalog["environments"];
  readonly computers: LibraryCatalog["computers"];
  readonly projects: readonly LibraryProject[] | null | undefined;
  readonly threads: readonly LibraryThreadSummary[] | undefined;
}) {
  const local = useLibraryLocalCatalog(
    enabled && offline && suppliedCopies === undefined,
    authorityId,
  );
  const copies = useEnvironmentQuery(
    enabled && authorityId && !offline && suppliedCopies === undefined
      ? projectLibrary.copies({ environmentId: authorityId, input: { includeReleased: true } })
      : null,
  );
  const providers = useEnvironmentProviders();
  const localProjects = useProjects();
  const shells = useThreadShells(enabled);
  const lastUsedSelection = useComposerDraftStore(selectLastUsedModel);
  const grants = useStartGrants(
    environments.map((entry) => entry.environmentId),
    authorityId,
  );
  const hosts = environments.map((entry) => ({
    environmentId: entry.environmentId,
    label: entry.label,
    online: entry.entry.enabled && entry.connection.phase === "connected",
    supportsExecution:
      entry.serverConfig?.environment.capabilities.supportsExecution !== false &&
      supportsLoomFeature(entry.serverConfig?.environment.capabilities, "project-library"),
    capabilities: entry.serverConfig?.environment.capabilities,
  }));
  /** The start `project` offers from `from`, limited to one computer when `environmentId` is set. */
  const start = (
    project: LibraryProject,
    from: readonly LibraryWorkingCopy[],
    environmentId?: EnvironmentId,
  ) => {
    if (!enabled) return null;
    const { computers } = libraryLaunchInputs({
      project,
      copies: [],
      hosts,
      remembered,
      workingThreads: new Map(),
    });
    const quick = libraryQuickLaunch({
      project,
      copies: from,
      computers: environmentId
        ? computers.filter((computer) => computer.environmentId === environmentId)
        : computers,
      threads: threads ?? [],
    });
    const host = environments.find((entry) => entry.environmentId === quick?.environmentId);
    if (!quick || !host?.serverConfig) return null;
    // The settings refuse to start without these grants, so the row must not promise a start.
    const computer = quick.environmentId;
    if (
      (!offline && !grants.register) ||
      (offline &&
        !supportsLoomFeature(host.serverConfig.environment.capabilities, "project-workflows")) ||
      !grants.bind.has(computer) ||
      (supportsLoomFeature(host.serverConfig.environment.capabilities, "project-workflows") &&
        !grants.launch.has(computer)) ||
      (!offline &&
        quick.copy.ownership !== "managed" &&
        !(grants.prepare.has(computer) && grants.registerCopy))
    )
      return null;
    const localProject =
      localProjects.find(
        (entry) =>
          entry.environmentId === quick.environmentId && entry.id === quick.copy.rootLocalProjectId,
      ) ?? null;
    const defaults = libraryConversationDefaults({
      settings: host.serverConfig.settings,
      localProject,
      project,
      providers: providers.get(quick.environmentId) ?? [],
      lastUsedSelection,
    });
    const { modelSelection, runtimeMode } = defaults;
    if (!modelSelection) return null;
    const model =
      defaults.entries
        .find((entry) => entry.instanceId === modelSelection.instanceId)
        ?.models.find((entry) => entry.slug === modelSelection.model)?.name ?? modelSelection.model;
    // The settings start in a new worktree while other conversations work in the folder, so the
    // row says so rather than promising the folder it will not use.
    const workspace = libraryLaunchWorkspace({
      available:
        supportsLoomFeature(
          host.serverConfig.environment.capabilities,
          LIBRARY_WORKTREE_STARTS_FEATURE,
        ) && libraryLaunchCanUseWorktree(project, null),
      chosen: null,
      conversations: libraryCopyFolderConversations(shells, quick.copy),
    });
    return {
      launch: {
        environmentId: quick.environmentId,
        workingCopyId: quick.copy.id,
        modelSelection,
        runtimeMode,
      },
      summary: `${quick.label} · ${model} · ${runtimeModeConfig[runtimeMode].label}${workspace === "worktree" ? " · New worktree" : ""}`,
    };
  };
  const starts = new Map<string, NonNullable<ReturnType<typeof start>>>();
  const library = suppliedCopies ?? (offline ? local.data?.copies : copies.data);
  if (library)
    for (const project of projects ?? []) {
      const promise = start(project, library);
      if (promise) starts.set(project.id, promise);
    }
  return { starts, start };
}

type PermissionCommand = {
  readonly permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean>;
};

/**
 * The grants the conversation settings check before starting on a ready copy: binding and
 * launching on its computer, registering on the Library, and preparing and registering a folder
 * Loom does not manage.
 */
function useStartGrants(
  environmentIds: readonly EnvironmentId[],
  authorityId: EnvironmentId | null,
) {
  const key = JSON.stringify([authorityId, ...environmentIds]);
  const grants = useMemo(() => {
    const [library, ...computers] = JSON.parse(key) as [EnvironmentId | null, ...EnvironmentId[]];
    return Atom.make((get) => {
      const on = (command: PermissionCommand) =>
        new Set(computers.filter((id) => get(command.permissionAtom(id))));
      const onLibrary = (command: PermissionCommand) =>
        library !== null && get(command.permissionAtom(library));
      return {
        bind: on(projectLibrary.bindThread),
        launch: on(projectLibrary.executeOperation),
        prepare: on(projectLibrary.prepareCopy),
        register: onLibrary(projectLibrary.registerThread),
        registerCopy: onLibrary(projectLibrary.registerCopy),
      };
    });
  }, [key]);
  return useAtomValue(grants);
}
