import {
  libraryStartIntent,
  libraryStartRepositoryProjects,
  rankLibraryStartProjects,
} from "@t3tools/client-runtime/fork";
import { ProjectTile } from "./ProjectIdentity";
import { useEnvironmentQuery } from "~/state/query";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon, PlusIcon } from "lucide-react";
import {
  projectLibrary,
  useLibraryProject,
  useLibraryProjects,
  useSelectedLibraryProject,
} from "./state";
import { onLibraryAction, type LibraryConversationDefaults, type LibraryAction } from "./actions";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import { NewConversationDialog } from "./NewConversationDialog";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryPaletteView } from "./LibraryPalette";

export interface LibraryPaletteSession {
  readonly id: number;
  readonly open: boolean;
  readonly action: LibraryAction;
  readonly projectId?: string | undefined;
  readonly defaults?: LibraryConversationDefaults | undefined;
}

/** Library setup occupies the original command popup, including actions launched inside it. */
export function useLibraryPaletteSession() {
  const [session, setSession] = useState<LibraryPaletteSession | null>(null);
  useEffect(() => {
    return onLibraryAction((action, projectId, defaults) =>
      setSession((previous) => ({
        id: (previous?.id ?? 0) + 1,
        open: true,
        action,
        projectId,
        defaults,
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
        : session.projectId
          ? "conversation"
          : "project",
  );
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [initialResource, setInitialResource] = useState("");
  const [initialFolder, setInitialFolder] = useState("");
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
  const [visited, setVisited] = useState({
    create: action === "create-project",
    import: action === "import-folder",
  });
  const show = (next: "create" | "import") => {
    setVisited((previous) => ({ ...previous, [next]: true }));
    setStep(next);
  };
  const choose = (project: LibraryProject, copy?: LibraryWorkingCopy) => {
    let nextDefaults = defaults;
    if (requestedProject && requestedProject !== project.id && defaults)
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
  const back = () => setStep("project");
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
          error={catalog.query.error ?? library.project.error}
          items={
            !library.authorityId || loadingProject
              ? []
              : [
                  ...repositoryProjects.map((entry) => ({
                    id: `repository:${entry.id}`,
                    title: `Continue ${entry.title}`,
                    description: "This repository is already part of this project",
                    terms: [search],
                    icon: <ProjectTile project={entry} size="sm" />,
                    next: true,
                    select: () => choose(entry),
                  })),
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
                  ...rankLibraryStartProjects(
                    catalog.query.data ?? [],
                    recent.data?.threads ?? [],
                  ).map((entry) => ({
                    id: entry.id,
                    title: entry.title,
                    description: entry.brief.trim().split("\n")[0] || "Start a conversation",
                    terms: entry.resources.map(
                      (resource) => `${resource.title} ${resource.remoteUrl ?? ""}`,
                    ),
                    icon: <ProjectTile project={entry} size="sm" />,
                    next: true,
                    select: () => choose(entry),
                  })),
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
                    select: () => show("import"),
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
          onSaved={choose}
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
          onSaved={choose}
        />
      ) : null}
      {library.authorityId && project && !project.archived ? (
        <NewConversationDialog
          key={`${project.id}:${defaults?.workingCopyId ?? ""}`}
          embedded
          open={step === "conversation"}
          project={project}
          initialHostId={defaults?.environmentId}
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
      ) : null}
    </>
  );
}
