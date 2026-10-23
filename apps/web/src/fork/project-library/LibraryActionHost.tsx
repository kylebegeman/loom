import { libraryRouteParams } from "@t3tools/client-runtime/fork";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useLibraryProject, useLibraryProjects, useSelectedLibraryProject } from "./state";
import { onLibraryAction, type LibraryConversationDefaults, type LibraryAction } from "./actions";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import { NewConversationDialog } from "./NewConversationDialog";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryDialog, LibrarySearch, LibraryErrorNotice } from "./LibraryControls";
import { Button } from "~/components/ui/button";
import { FolderKanbanIcon, FolderPlusIcon, PlusIcon } from "lucide-react";

type ProjectStep = "project" | "create" | "import" | "conversation";

export function LibraryActionHost() {
  const [projectId, selectProject] = useSelectedLibraryProject();
  const [launchId, setLaunchId] = useState(0);
  const [defaults, setDefaults] = useState<LibraryConversationDefaults | undefined>();
  const [requestedProject, setRequestedProject] = useState<string | null>(null);
  const [chosenProject, setChosenProject] = useState<LibraryProject | null>(null);
  const [chosenCopy, setChosenCopy] = useState<LibraryWorkingCopy | null>(null);
  const library = useLibraryProject(requestedProject ?? projectId ?? "");
  const catalog = useLibraryProjects();
  const navigate = useNavigate();
  const params = useRouterState({
    select: (state) => libraryRouteParams(state.matches.at(-1)?.params),
  });
  const unrelatedLiveThread =
    !!params.threadId &&
    !!params.environmentId &&
    library.threads.data !== null &&
    !library.threads.data.some(
      (thread) =>
        thread.threadId === params.threadId && thread.environmentId === params.environmentId,
    );
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [step, setStep] = useState<ProjectStep>("project");
  const [search, setSearch] = useState("");
  const [visited, setVisited] = useState({ create: false, import: false });
  useEffect(
    () =>
      onLibraryAction((next, requestedProjectId, contextDefaults) => {
        setLaunchId((current) => current + 1);
        setDefaults(contextDefaults);
        setRequestedProject(requestedProjectId ?? null);
        setChosenProject(null);
        setChosenCopy(null);
        setSearch("");
        setVisited({ create: next === "create-project", import: next === "import-folder" });
        setStep(
          next === "create-project"
            ? "create"
            : next === "import-folder"
              ? "import"
              : requestedProjectId
                ? "conversation"
                : "project",
        );
        if (requestedProjectId) selectProject(requestedProjectId);
        else if (next === "new-conversation" && unrelatedLiveThread) selectProject(null);
        setAction(next);
      }),
    [unrelatedLiveThread, selectProject],
  );
  if (!action) return null;
  const close = () => setAction(null);
  const show = (next: "create" | "import") => {
    setVisited((previous) => ({ ...previous, [next]: true }));
    setStep(next);
  };
  const choose = (project: LibraryProject, copy?: LibraryWorkingCopy) => {
    let nextDefaults = defaults;
    if (requestedProject && requestedProject !== project.id && defaults) {
      nextDefaults = {
        ...(defaults.environmentId ? { environmentId: defaults.environmentId } : {}),
        ...(defaults.modelSelection ? { modelSelection: defaults.modelSelection } : {}),
        ...(defaults.runtimeMode ? { runtimeMode: defaults.runtimeMode } : {}),
        ...(defaults.interactionMode ? { interactionMode: defaults.interactionMode } : {}),
      };
    }
    if (copy)
      nextDefaults = { ...nextDefaults, environmentId: copy.environmentId, workingCopyId: copy.id };
    setDefaults(nextDefaults);
    selectProject(project.id);
    setRequestedProject(project.id);
    setChosenProject(project);
    setChosenCopy(copy ?? (chosenCopy?.projectId === project.id ? chosenCopy : null));
    if (action === "new-conversation") setStep("conversation");
    else {
      close();
      void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
    }
  };
  const project =
    chosenProject ?? (library.project.data?.id === requestedProject ? library.project.data : null);
  const query = search.trim().toLocaleLowerCase();
  const projects = (catalog.query.data ?? []).filter(
    (entry) =>
      !entry.archived &&
      [
        entry.title,
        entry.brief,
        ...entry.resources.map((resource) => `${resource.title} ${resource.remoteUrl ?? ""}`),
      ].some((text) => text.toLocaleLowerCase().includes(query)),
  );
  const conversationFlow = {
    steps: ["Project", "Computer & files", "Agent"],
    current: 0,
    onBack: () => setStep("project"),
  };
  const loadingProject = step === "conversation" && !project && library.project.isPending;
  const copies = library.copies.data ?? [];
  const launchCopies =
    chosenCopy &&
    chosenCopy.projectId === project?.id &&
    !copies.some((copy) => copy.id === chosenCopy.id)
      ? [...copies, chosenCopy]
      : copies;
  const needsProject =
    step === "project" || (step === "conversation" && (!project || project.archived));
  return (
    <>
      <LibraryDialog
        open={!library.authorityId || needsProject}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={
          action === "new-conversation"
            ? "New conversation"
            : action === "create-project"
              ? "New project"
              : "Add existing folder"
        }
        description={
          !library.authorityId
            ? "Connect your Library to keep projects and conversations available across your devices."
            : "Find a project, create one, or choose a folder you already have."
        }
        flow={{ steps: conversationFlow.steps, current: 0 }}
        actions={
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
        }
      >
        {!library.authorityId ? (
          <LibrarySetup showConnectionsLink={false} />
        ) : loadingProject ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading project...
          </p>
        ) : (
          <div className="space-y-4">
            <LibrarySearch
              value={search}
              onChange={setSearch}
              placeholder="Search projects or repositories"
              label="Search projects"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => show("create")}>
                <PlusIcon />
                New project
              </Button>
              <Button size="sm" variant="outline" onClick={() => show("import")}>
                <FolderPlusIcon />
                Add existing folder
              </Button>
            </div>
            <LibraryErrorNotice
              error={catalog.query.error ?? library.project.error}
              onRetry={() => {
                catalog.query.refresh();
                library.refresh();
              }}
            />
            {catalog.query.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading projects...
              </p>
            ) : null}
            <ul aria-label="Projects" className="max-h-72 space-y-1 overflow-y-auto">
              {projects.map((entry) => (
                <li key={entry.id}>
                  <Button variant="ghost" onClick={() => choose(entry)}>
                    <FolderKanbanIcon />
                    <span className="truncate">{entry.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
            {!catalog.query.isPending && projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {query
                  ? "No matching projects. Try another search or create one."
                  : "Create your first project or add an existing folder."}
              </p>
            ) : null}
          </div>
        )}
      </LibraryDialog>
      {library.authorityId && visited.create ? (
        <ProjectEditorDialog
          key={`create:${launchId}`}
          open={step === "create"}
          authorityId={library.authorityId}
          continueToConversation={action === "new-conversation"}
          flow={
            action === "new-conversation"
              ? conversationFlow
              : { steps: ["Project"], current: 0, onBack: () => setStep("project") }
          }
          onClose={close}
          onSaved={choose}
        />
      ) : null}
      {library.authorityId && visited.import ? (
        <ImportProjectDialog
          key={`import:${launchId}`}
          open={step === "import"}
          flow={
            action === "new-conversation"
              ? conversationFlow
              : {
                  steps: ["Computer & files", "Project"],
                  current: 0,
                  onBack: () => setStep("project"),
                }
          }
          onClose={close}
          onSaved={choose}
        />
      ) : null}
      {library.authorityId && project && !project.archived ? (
        <NewConversationDialog
          key={`${project.id}:${launchId}:${defaults?.workingCopyId ?? ""}`}
          open={step === "conversation"}
          project={project}
          initialStep={defaults?.workingCopyId ? "agent" : "files"}
          initialHostId={defaults?.environmentId}
          initialCopyId={defaults?.workingCopyId}
          initialResourceId={defaults?.resourceId}
          initialResourceIds={defaults?.resourceIds}
          initialModelSelection={defaults?.modelSelection}
          initialRuntimeMode={defaults?.runtimeMode}
          initialInteractionMode={defaults?.interactionMode}
          copies={launchCopies}
          copiesQuery={library.copies}
          onChooseProject={() => setStep("project")}
          onChanged={library.refresh}
          onClose={close}
        />
      ) : null}
    </>
  );
}
