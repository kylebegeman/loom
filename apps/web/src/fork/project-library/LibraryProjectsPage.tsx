import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  projectLibrary,
  useLibraryProjects,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { LibraryErrorNotice } from "./LibraryControls";
import { ImportProjectDialog } from "./ImportProjectDialog";

export function LibraryProjectsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const library = useLibraryProjects(includeArchived);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, selectProject] = useSelectedLibraryProject();
  const canCreate = useLibraryPermission(projectLibrary.createProject, library.authorityId);
  const navigate = useNavigate();
  const projects =
    library.query.data?.filter((project) =>
      project.title.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  return (
    <LibraryPageFrame>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Keep the brief, resources and conversations together. Prepare files on a computer
            whenever you need them.
          </p>
        </div>
        {library.authorityId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canCreate || !library.connected}
              onClick={() => setImporting(true)}
            >
              Add existing folder
            </Button>
            <Button disabled={!canCreate || !library.connected} onClick={() => setCreating(true)}>
              New project
            </Button>
          </div>
        ) : null}
      </div>
      {!library.authorityId ? (
        <LibrarySetup />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <Input
                type="search"
                aria-label="Search projects"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a project"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
              />
              Show archived
            </label>
          </div>
          <LibraryErrorNotice error={library.query.error} onRetry={library.query.refresh} />
          {!library.query.data && library.query.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading projects...
            </p>
          ) : null}
          <div className="divide-y divide-border">
            {projects.map((project) => (
              <Link
                key={project.id}
                to="/library/$projectId"
                params={{ projectId: project.id }}
                onClick={() => selectProject(project.id)}
                className="block rounded-md py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-medium">
                      {project.title}
                      {project.archived ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </h2>
                    <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-muted-foreground">
                      {project.brief || "Add a brief to share context across conversations."}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {project.resources.length} resources
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {library.query.data && projects.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {search
                ? "No projects match your search."
                : "Create a project with a name and brief, or add an existing folder. A project can stay here without a working copy."}
            </p>
          ) : null}
        </>
      )}
      {creating && library.authorityId ? (
        <ProjectEditorDialog
          authorityId={library.authorityId}
          onClose={() => setCreating(false)}
          onSaved={(project) => {
            setCreating(false);
            library.query.refresh();
            selectProject(project.id);
            void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
          }}
        />
      ) : null}
      {importing ? (
        <ImportProjectDialog
          onClose={() => setImporting(false)}
          onSaved={(project) => {
            setImporting(false);
            library.query.refresh();
            selectProject(project.id);
            void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
          }}
        />
      ) : null}
    </LibraryPageFrame>
  );
}
