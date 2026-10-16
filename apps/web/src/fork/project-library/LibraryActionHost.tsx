import { libraryRouteParams } from "@t3tools/client-runtime/fork";
import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useLibraryProject, useLibraryProjects, useSelectedLibraryProject } from "./state";
import { onLibraryAction, type LibraryConversationDefaults, type LibraryAction } from "./actions";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import { NewConversationDialog } from "./NewConversationDialog";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";

export function LibraryActionHost() {
  const [projectId, selectProject] = useSelectedLibraryProject();
  const [defaults, setDefaults] = useState<LibraryConversationDefaults | undefined>();
  const [requestedProject, setRequestedProject] = useState<string | null>(null);
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
  useEffect(
    () =>
      onLibraryAction((next, requestedProjectId, contextDefaults) => {
        setDefaults(contextDefaults);
        setRequestedProject(requestedProjectId ?? null);
        if (requestedProjectId) selectProject(requestedProjectId);
        else if (next === "new-conversation" && unrelatedLiveThread) selectProject(null);
        setAction(next);
      }),
    [unrelatedLiveThread, selectProject],
  );
  if (!action) return null;
  const saved = (project: { id: string }) => {
    setAction(null);
    selectProject(project.id);
    void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
  };
  if (action === "create-project")
    return (
      <ProjectEditorDialog
        authorityId={library.authorityId}
        onClose={() => setAction(null)}
        onSaved={saved}
      />
    );
  if (!library.authorityId)
    return (
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={action === "import-folder" ? "Add existing folder" : "New conversation"}
        description="Connect your shared Library once to keep projects and conversations available across your devices."
        actions={
          <Button variant="outline" onClick={() => setAction(null)}>
            Cancel
          </Button>
        }
      >
        <LibrarySetup showConnectionsLink={false} />
      </LibraryDialog>
    );
  if (action === "import-folder")
    return <ImportProjectDialog onClose={() => setAction(null)} onSaved={saved} />;
  if (!library.project.data || library.project.data.archived)
    return (
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title="Choose a project"
        description="Start a conversation in an existing Library project, or create a new project first."
        actions={
          <>
            <Button variant="outline" onClick={() => setAction(null)}>
              Close
            </Button>
            <Button onClick={() => setAction("create-project")}>New project</Button>
          </>
        }
      >
        <div className="space-y-4">
          <LibraryField label="Project">
            <Select
              value={projectId}
              items={(catalog.query.data ?? []).map((project) => ({
                value: project.id,
                label: project.title,
              }))}
              onValueChange={(value) => selectProject(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectPopup>
                {catalog.query.data?.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
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
        </div>
      </LibraryDialog>
    );
  return (
    <NewConversationDialog
      key={library.project.data.id}
      project={library.project.data}
      initialHostId={defaults?.environmentId}
      initialCopyId={defaults?.workingCopyId}
      initialResourceId={defaults?.resourceId}
      copies={library.copies.data ?? []}
      copiesQuery={library.copies}
      onChanged={library.refresh}
      onClose={() => setAction(null)}
    />
  );
}
