import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowDownUpIcon,
  ChevronRightIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  ListIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProjectColor } from "@t3tools/contracts/fork";
import { libraryActiveCopies, libraryProjectForLocalRefs } from "@t3tools/client-runtime/fork";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryErrorNotice } from "./LibraryControls";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";
import { ProjectCards, ProjectCollectionSkeleton, ProjectRows } from "./ProjectCollection";
import {
  ComputerLabel,
  PathLabel,
  PROJECT_COLOR_NAMES,
  projectColorStyle,
} from "./ProjectIdentity";
import {
  filterProjectEntries,
  PROJECT_SORT_LABELS,
  PROJECT_SORTS,
  projectEntries,
  sortProjectEntries,
} from "./projectList";
import {
  useLibraryPermission,
  useLibraryProjects,
  useSelectedLibraryProject,
  projectLibrary,
} from "./state";

const PREFERENCES_KEY = "loom:library:projects-view:v1";
const ProjectsPreferences = Schema.Struct({
  view: Schema.Literals(["cards", "list"]),
  sort: Schema.Literals(PROJECT_SORTS),
});
const DEFAULT_PREFERENCES: typeof ProjectsPreferences.Type = { view: "cards", sort: "activity" };
/** Shares the sidebar's request, so the page adds no extra index fetch. */
const THREAD_INDEX_LIMIT = 100;

/** Management shares the normal app shell. The thread filter remains the only project selector. */
export function LibraryProjectsPage() {
  const catalog = useLibraryProjects(true);
  const [, selectProject] = useSelectedLibraryProject();
  const localProjects = useSidebarProjectGroups();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useLocalStorage(
    PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    ProjectsPreferences,
  );
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [colors, setColors] = useState<ReadonlySet<LibraryProjectColor>>(new Set());
  const [computer, setComputer] = useState<EnvironmentId | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<{
    hostId?: EnvironmentId;
    rootPath?: string | undefined;
    title?: string;
  } | null>(null);
  const canCreate = useLibraryPermission(projectLibrary.createProject, catalog.authorityId);
  const environmentProjects = useProjects();
  const copies = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.copies({ environmentId: catalog.authorityId, input: {} })
      : null,
  );
  const threadIndex = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.threadIndex({
          environmentId: catalog.authorityId,
          input: { limit: THREAD_INDEX_LIMIT },
        })
      : null,
  );
  const activeCopies = libraryActiveCopies(copies.data ?? []);
  const hostLabel = (id: EnvironmentId) =>
    catalog.environments.find((entry) => entry.environmentId === id)?.label ??
    catalog.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  // Folders already behind a project copy are part of that project, not loose folders.
  const looseFolders = localProjects.filter(
    (group) => libraryProjectForLocalRefs([], group.memberProjectRefs, activeCopies) === null,
  );
  const entries = projectEntries(
    catalog.query.data ?? [],
    activeCopies,
    threadIndex.data,
    environmentProjects,
  );
  const statusEntries = entries.filter((entry) => entry.project.archived === archived);
  const archivedCount = entries.filter((entry) => entry.project.archived).length;
  const activeCount = entries.length - archivedCount;
  const usedColors = new Set(statusEntries.map((entry) => entry.color));
  const usedComputers = [
    ...new Set(statusEntries.flatMap((entry) => entry.copies.map((copy) => copy.environmentId))),
  ];
  const filtered = filterProjectEntries(
    entries,
    { archived, search: query, colors, computer },
    hostLabel,
  );
  const visible = sortProjectEntries(filtered, preferences.sort);
  const narrowed = !!query.trim() || colors.size > 0 || computer !== null;
  const clearFilters = () => {
    setQuery("");
    setColors(new Set());
    setComputer(null);
  };
  const saved = (project: { id: string }) => {
    setCreating(false);
    setImporting(null);
    selectProject(project.id);
    catalog.query.refresh();
    void navigate({ to: "/library/$projectId", params: { projectId: project.id } });
  };
  const refresh = () => {
    catalog.query.refresh();
    copies.refresh();
  };
  const loading = catalog.query.isPending && !catalog.query.data;
  const computersInUse = new Set(activeCopies.map((copy) => copy.environmentId)).size;
  return (
    <LibraryPageFrame>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-xl text-xs text-muted-foreground tabular-nums">
            {catalog.authorityId && activeCount
              ? [
                  `${activeCount} ${activeCount === 1 ? "project" : "projects"}`,
                  computersInUse
                    ? `on ${computersInUse} ${computersInUse === 1 ? "computer" : "computers"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "Keep the context, repositories and conversations for each thing you’re building together."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            disabled={!catalog.authorityId || !catalog.connected}
            onClick={() => setImporting({})}
          >
            <FolderPlusIcon />
            Add existing folder
          </Button>
          <Button
            shape="pill"
            size="sm"
            onClick={() => setCreating(true)}
            disabled={!!catalog.authorityId && (!canCreate || !catalog.connected)}
          >
            <PlusIcon />
            New project
          </Button>
        </div>
      </header>
      {!catalog.authorityId ? (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <LibrarySetup />
          <p className="max-w-xl text-xs text-muted-foreground">
            Your existing threads and folders stay available while you connect the shared Library.
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <InputGroup shape="pill" className="w-full sm:w-64">
                <InputGroupAddon>
                  <SearchIcon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && query) {
                      event.preventDefault();
                      setQuery("");
                    }
                  }}
                  size="sm"
                  placeholder="Search names, repos, folders"
                  aria-label="Search projects"
                />
                {query ? (
                  <InputGroupAddon align="inline-end">
                    <Button
                      shape="pill"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <XIcon />
                    </Button>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              {usedColors.size > 1 ? (
                <ColorFilter
                  colors={[...usedColors]}
                  selected={colors}
                  onToggle={(color) =>
                    setColors((current) => {
                      const next = new Set(current);
                      if (next.has(color)) next.delete(color);
                      else next.add(color);
                      return next;
                    })
                  }
                />
              ) : null}
              {usedComputers.length > 1 || computer ? (
                <ComputerFilter
                  computers={usedComputers}
                  selected={computer}
                  hostLabel={hostLabel}
                  onSelect={setComputer}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                shape="pill"
                aria-label="Project status"
                variant="segmented"
                value={[archived ? "archived" : "active"]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "active" || next === "archived") setArchived(next === "archived");
                }}
              >
                <ToggleGroupItem value="active">
                  Active
                  <span className="tabular-nums opacity-60">{activeCount}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="archived">
                  Archived
                  <span className="tabular-nums opacity-60">{archivedCount}</span>
                </ToggleGroupItem>
              </ToggleGroup>
              <Menu>
                <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
                  <ArrowDownUpIcon />
                  {PROJECT_SORT_LABELS[preferences.sort]}
                </MenuTrigger>
                <MenuPopup side="bottom" align="end">
                  <MenuGroup>
                    <MenuGroupLabel>Sort by</MenuGroupLabel>
                    <MenuRadioGroup
                      value={preferences.sort}
                      onValueChange={(value) => {
                        const sort = PROJECT_SORTS.find((entry) => entry === value);
                        if (sort) setPreferences({ ...preferences, sort });
                      }}
                    >
                      {PROJECT_SORTS.map((sort) => (
                        <MenuRadioItem key={sort} value={sort}>
                          {PROJECT_SORT_LABELS[sort]}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                </MenuPopup>
              </Menu>
              <ToggleGroup
                shape="pill"
                aria-label="Layout"
                variant="segmented"
                value={[preferences.view]}
                onValueChange={(value) => {
                  const view = value[0];
                  if (view === "cards" || view === "list") setPreferences({ ...preferences, view });
                }}
              >
                <ToggleGroupItem value="cards" aria-label="Cards">
                  <LayoutGridIcon />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List">
                  <ListIcon />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <LibraryErrorNotice error={catalog.query.error} onRetry={catalog.query.refresh} />
          {loading ? (
            <ProjectCollectionSkeleton view={preferences.view} />
          ) : visible.length ? (
            preferences.view === "cards" ? (
              <ProjectCards
                entries={visible}
                authorityId={catalog.authorityId}
                connected={catalog.connected}
                hostLabel={hostLabel}
                onOpen={selectProject}
                onChanged={refresh}
              />
            ) : (
              <ProjectRows
                entries={visible}
                authorityId={catalog.authorityId}
                connected={catalog.connected}
                hostLabel={hostLabel}
                onOpen={selectProject}
                onChanged={refresh}
              />
            )
          ) : catalog.query.error ? null : narrowed ? (
            <div className="rounded-xl border border-dashed border-border">
              <Empty size="compact">
                <EmptyHeader>
                  <EmptyTitle>No projects match</EmptyTitle>
                  <EmptyDescription>
                    Search looks at names, briefs, repositories, folders and computers.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button shape="pill" size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : archived ? (
            <div className="rounded-xl border border-dashed border-border">
              <Empty size="compact">
                <EmptyHeader>
                  <EmptyTitle>No archived projects</EmptyTitle>
                  <EmptyDescription>
                    Archiving keeps a project’s context and conversations. Restore it whenever you
                    need it.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia>
                    <StarterTiles />
                  </EmptyMedia>
                  <EmptyTitle>Bring your work together</EmptyTitle>
                  <EmptyDescription>
                    A project holds a brief, its repositories and every conversation about it. Give
                    each one a color so it’s easy to spot, then choose a computer when you start
                    working.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="flex-row justify-center">
                  <Button
                    shape="pill"
                    onClick={() => setCreating(true)}
                    disabled={!canCreate || !catalog.connected}
                  >
                    <PlusIcon />
                    Create your first project
                  </Button>
                  <Button
                    shape="pill"
                    variant="outline"
                    disabled={!catalog.connected}
                    onClick={() => setImporting({})}
                  >
                    Add existing folder
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </>
      )}
      {catalog.authorityId && looseFolders.length ? (
        <details className="group/folders space-y-3">
          <summary className="-mx-2 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden
              className="size-4 text-muted-foreground transition-transform duration-150 group-open/folders:rotate-90"
            />
            Folders not in a project
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {looseFolders.length}
            </span>
          </summary>
          <p className="max-w-xl text-xs text-muted-foreground">
            Folders you've worked in on your computers. Add one to a project without moving or
            deleting its files.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {looseFolders.map((group) => {
              const ref = group.memberProjectRefs[0];
              const member = group.memberProjects[0];
              const root = member?.workspaceRoot;
              return (
                <li
                  key={group.projectKey}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5"
                >
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground dark:bg-accent">
                    {member ? (
                      <ProjectFavicon
                        project={member}
                        className="size-3.5"
                        fallbackIcon={FolderIcon}
                      />
                    ) : (
                      <FolderIcon aria-hidden className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {group.displayName}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {ref ? (
                      <ComputerLabel
                        environmentId={ref.environmentId}
                        label={hostLabel(ref.environmentId)}
                        className="max-w-32"
                      />
                    ) : null}
                    {root ? <PathLabel path={root} className="min-w-0 max-w-72" /> : null}
                  </span>
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    disabled={!catalog.connected}
                    onClick={() =>
                      setImporting({
                        ...(ref ? { hostId: ref.environmentId } : {}),
                        title: group.displayName,
                        rootPath: root,
                      })
                    }
                  >
                    Add to project
                  </Button>
                </li>
              );
            })}
          </ul>
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

/** Narrows to the colors people chose, so a color can stand for a client, a team or a phase. */
function ColorFilter({
  colors,
  selected,
  onToggle,
}: {
  readonly colors: readonly LibraryProjectColor[];
  readonly selected: ReadonlySet<LibraryProjectColor>;
  readonly onToggle: (color: LibraryProjectColor) => void;
}) {
  return (
    <div role="group" aria-label="Filter by color" className="flex items-center gap-1">
      {colors.map((color) => {
        const pressed = selected.has(color);
        return (
          <Tooltip key={color}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`${PROJECT_COLOR_NAMES[color]} projects`}
                  style={projectColorStyle(color)}
                  onClick={() => onToggle(color)}
                  className="inline-flex size-6 items-center justify-center rounded-full outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 rounded-full bg-(--project-color) transition-[box-shadow,opacity] duration-150",
                  pressed && "ring-2 ring-(--project-color) ring-offset-1 ring-offset-background",
                  selected.size > 0 && !pressed && "opacity-40",
                )}
              />
            </TooltipTrigger>
            <TooltipPopup side="top">{PROJECT_COLOR_NAMES[color]}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ComputerFilter({
  computers,
  selected,
  hostLabel,
  onSelect,
}: {
  readonly computers: readonly EnvironmentId[];
  readonly selected: EnvironmentId | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onSelect: (id: EnvironmentId | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button shape="pill" size="sm" variant={selected ? "secondary" : "ghost"} />}
      >
        {selected ? (
          <ComputerLabel
            environmentId={selected}
            label={hostLabel(selected)}
            className="text-foreground"
          />
        ) : (
          "All computers"
        )}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuRadioGroup
          value={selected ?? "all"}
          onValueChange={(value) => onSelect(computers.find((id) => id === value) ?? null)}
        >
          <MenuRadioItem value="all">All computers</MenuRadioItem>
          {computers.map((id) => (
            <MenuRadioItem key={id} value={id}>
              <ComputerLabel environmentId={id} label={hostLabel(id)} className="text-foreground" />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** A small arrangement of project tiles that shows what the page will look like once it's in use. */
function StarterTiles() {
  const tiles = [
    { color: "plum", icon: FolderGit2Icon, offset: "-rotate-6 translate-y-1" },
    { color: "teal", icon: MessageSquareIcon, offset: "z-10 -translate-y-1" },
    { color: "gold", icon: FolderIcon, offset: "rotate-6 translate-y-1" },
  ] as const;
  return (
    <div aria-hidden className="flex items-center -space-x-2">
      {tiles.map(({ color, icon: Icon, offset }) => (
        <span
          key={color}
          style={projectColorStyle(color)}
          className={cn("rounded-2xl bg-background ring-4 ring-background", offset)}
        >
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-(--project-color)/16 text-(--project-color)">
            <Icon className="size-5" />
          </span>
        </span>
      ))}
    </div>
  );
}
