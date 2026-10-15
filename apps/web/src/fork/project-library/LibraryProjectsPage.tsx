import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useLibraryProjects, useSelectedLibraryProject } from "./state";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { openLibraryAction } from "./actions";
import { FolderGit2Icon, PlusIcon } from "lucide-react";
import { LibraryErrorNotice } from "./LibraryControls";

export function LibraryProjectsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const library = useLibraryProjects(includeArchived);
  const [search, setSearch] = useState("");
  const [, selectProject] = useSelectedLibraryProject();
  const projects =
    library.query.data?.filter((project) =>
      project.title.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  return (
    <LibraryPageFrame>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your work, with its conversations and context. One project can span several repositories
            and computers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openLibraryAction("import-folder")}>
            Add existing folder
          </Button>
          <Button onClick={() => openLibraryAction("create-project")}>
            <PlusIcon />
            New project
          </Button>
        </div>
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
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                to="/library/$projectId"
                params={{ projectId: project.id }}
                onClick={() => selectProject(project.id)}
                className="group flex min-h-44 flex-col rounded-xl border border-border bg-card/40 p-5 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FolderGit2Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold tracking-tight">
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
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-5 text-xs text-muted-foreground">
                  {project.resources
                    .filter((resource) => resource.kind !== "link")
                    .map((resource) => (
                      <span key={resource.id} className="rounded-md bg-muted px-2 py-1">
                        {resource.title}
                      </span>
                    ))}
                  {project.resources.every((resource) => resource.kind === "link") ? (
                    <span>Add components as the project grows</span>
                  ) : null}
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
    </LibraryPageFrame>
  );
}
