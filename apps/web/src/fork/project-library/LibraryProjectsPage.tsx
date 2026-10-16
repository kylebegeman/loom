import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, FolderIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryErrorNotice } from "./LibraryControls";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import {
  useLibraryPermission,
  useLibraryProjects,
  useSelectedLibraryProject,
  projectLibrary,
} from "./state";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryActiveCopies, libraryProjectForLocalRefs } from "@t3tools/client-runtime/fork";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { isRepositoryResource } from "./resources";

/** Management shares the normal app shell. The thread filter remains the only project selector. */
export function LibraryProjectsPage() {
  const catalog = useLibraryProjects(true);
  const [, selectProject] = useSelectedLibraryProject();
  const localProjects = useSidebarProjectGroups();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<{
    hostId?: EnvironmentId;
    rootPath?: string | undefined;
    title?: string;
  } | null>(null);
  const canCreate = useLibraryPermission(projectLibrary.createProject, catalog.authorityId);
  const copies = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.copies({ environmentId: catalog.authorityId, input: {} })
      : null,
  );
  const activeCopies = libraryActiveCopies(copies.data ?? []);
  const hostLabel = (id: EnvironmentId) =>
    catalog.environments.find((entry) => entry.environmentId === id)?.label ??
    catalog.computers.find((entry) => entry.environmentId === id)?.label ??
    "a saved computer";
  // Folders already behind a project copy are part of that project, not loose folders.
  const looseFolders = localProjects.filter(
    (group) => libraryProjectForLocalRefs([], group.memberProjectRefs, activeCopies) === null,
  );
  const search = query.trim().toLocaleLowerCase();
  const projects = (catalog.query.data ?? [])
    .filter(
      (project) =>
        project.archived === archived &&
        (!search ||
          [project.title, project.brief, ...project.resources.map((r) => r.title)].some((text) =>
            text.toLocaleLowerCase().includes(search),
          )),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const saved = (project: { id: string }) => {
    setCreating(false);
    setImporting(null);
    selectProject(project.id);
    catalog.query.refresh();
    void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
  };
  return (
    <LibraryPageFrame>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Keep the context, repositories and conversations for each thing you’re building
            together.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!catalog.authorityId || !catalog.connected}
            onClick={() => setImporting({})}
          >
            Add existing folder
          </Button>
          <Button
            onClick={() => setCreating(true)}
            disabled={!!catalog.authorityId && (!canCreate || !catalog.connected)}
          >
            <PlusIcon />
            New project
          </Button>
        </div>
      </div>
      {!catalog.authorityId ? (
        <section className="space-y-4 rounded-xl border border-border p-5">
          <LibrarySetup />
          <p className="max-w-xl text-xs text-muted-foreground">
            Your existing threads and folders stay available while you connect the shared Library.
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-sm">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
              />
            </div>
            <div className="flex gap-1" aria-label="Project status">
              <Button
                size="sm"
                variant={archived ? "ghost" : "secondary"}
                aria-pressed={!archived}
                onClick={() => setArchived(false)}
              >
                Active
              </Button>
              <Button
                size="sm"
                variant={archived ? "secondary" : "ghost"}
                aria-pressed={archived}
                onClick={() => setArchived(true)}
              >
                Archived
              </Button>
            </div>
          </div>
          <LibraryErrorNotice error={catalog.query.error} onRetry={catalog.query.refresh} />
          {catalog.query.isPending && !catalog.query.data ? (
            <p role="status" className="py-8 text-sm text-muted-foreground">
              Loading projects...
            </p>
          ) : projects.length ? (
            <div className="divide-y divide-border">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  to="/library/$projectId"
                  params={{ projectId: project.id }}
                  onClick={() => selectProject(project.id)}
                  className="group flex items-start gap-4 rounded-lg px-3 py-4 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <FolderIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-base font-medium">{project.title}</h2>
                    {project.brief ? (
                      <p className="line-clamp-1 max-w-2xl text-sm text-muted-foreground">
                        {project.brief}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {projectSummary(project, activeCopies, hostLabel)}
                    </p>
                  </div>
                  <ArrowRightIcon
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              ))}
            </div>
          ) : !catalog.query.error ? (
            <section className="space-y-3 py-10">
              <h2 className="text-base font-medium">
                {search
                  ? "No matching projects"
                  : archived
                    ? "No archived projects"
                    : "Bring your work together"}
              </h2>
              <p className="max-w-lg text-sm text-muted-foreground">
                {search
                  ? "Try another name or component."
                  : archived
                    ? "Archiving keeps the project’s context and conversations. Restore it whenever you need it."
                    : "Create a project with its own brief and repositories, or add a folder you already use. Choose a computer when you start a conversation."}
              </p>
              {!search && !archived ? (
                <Button
                  size="sm"
                  onClick={() => setCreating(true)}
                  disabled={!canCreate || !catalog.connected}
                >
                  Create your first project
                </Button>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {catalog.authorityId && looseFolders.length ? (
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            Folders not in a project
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {looseFolders.length}
            </span>
          </summary>
          <p className="max-w-xl text-xs text-muted-foreground">
            Folders you've worked in on your computers. Add one to a project without moving or
            deleting its files.
          </p>
          <div className="divide-y divide-border">
            {looseFolders.map((project) => (
              <div
                key={project.projectKey}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!catalog.connected}
                  onClick={() => {
                    const ref = project.memberProjectRefs[0];
                    setImporting({
                      ...(ref ? { hostId: ref.environmentId } : {}),
                      title: project.displayName,
                      rootPath: project.memberProjects[0]?.workspaceRoot,
                    });
                  }}
                >
                  Add to project
                </Button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {creating ? (
        <ProjectEditorDialog
          authorityId={catalog.authorityId}
          onClose={() => setCreating(false)}
          onSaved={saved}
        />
      ) : null}
      {importing ? (
        <ImportProjectDialog
          initialHostId={importing.hostId}
          initialRootPath={importing.rootPath}
          initialTitle={importing.title}
          onClose={() => setImporting(null)}
          onSaved={saved}
        />
      ) : null}
    </LibraryPageFrame>
  );
}

/** What a project holds and where it currently lives, in one glanceable line. */
function projectSummary(
  project: LibraryProject,
  copies: readonly LibraryWorkingCopy[],
  hostLabel: (id: EnvironmentId) => string,
) {
  const repositories = project.resources.filter(isRepositoryResource).length;
  const links = project.resources.length - repositories;
  const hosts = [
    ...new Set(
      copies.filter((copy) => copy.projectId === project.id).map((copy) => copy.environmentId),
    ),
  ];
  return [
    repositories ? `${repositories} ${repositories === 1 ? "repository" : "repositories"}` : null,
    links ? `${links} ${links === 1 ? "link" : "links"}` : null,
    hosts.length === 1
      ? `Copy on ${hostLabel(hosts[0]!)}`
      : hosts.length
        ? `Copies on ${hosts.length} computers`
        : null,
    `Edited ${formatRelativeTimeLabel(project.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
