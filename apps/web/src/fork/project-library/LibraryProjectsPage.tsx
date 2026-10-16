import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ChevronRightIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  ListFilterIcon,
  ListIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PROJECT_COLORS, type LibraryProjectColor } from "@t3tools/contracts/fork";
import { libraryActiveCopies, libraryHoldsLocalRefs } from "@t3tools/client-runtime/fork";
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
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
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
import {
  ProjectCards,
  ProjectCollectionSkeleton,
  ProjectCompactCards,
  ProjectRows,
} from "./ProjectCollection";
import {
  ComputerLabel,
  PathLabel,
  PROJECT_COLOR_NAMES,
  ProjectColorDot,
  projectColorStyle,
} from "./ProjectIdentity";
import {
  filterProjectEntries,
  isRestingEntry,
  PROJECT_GROUP_LABELS,
  PROJECT_GROUPS,
  PROJECT_SORT_LABELS,
  PROJECT_SORTS,
  projectEntries,
  projectSections,
  sortProjectEntries,
  type ProjectEntry,
  type ProjectGroup,
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
  // Optional so views saved before grouping still load.
  group: Schema.optional(Schema.Literals(PROJECT_GROUPS)),
});
type ProjectsPreferences = typeof ProjectsPreferences.Type;
const DEFAULT_PREFERENCES: ProjectsPreferences = {
  view: "cards",
  sort: "activity",
  group: "activity",
};
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
  const group = preferences.group ?? "activity";
  // Read once per visit: a project that goes quiet while the page is open can wait for the next one.
  const [now] = useState(() => Date.now());
  const [query, setQuery] = useState("");
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
    (group) => !libraryHoldsLocalRefs([], group.memberProjectRefs, activeCopies),
  );
  const entries = projectEntries(
    catalog.query.data ?? [],
    activeCopies,
    threadIndex.data,
    environmentProjects,
  );
  const filtered = sortProjectEntries(
    filterProjectEntries(entries, { search: query, colors, computer }, hostLabel),
    preferences.sort,
  );
  const current = filtered.filter((entry) => !entry.project.archived);
  const archived = filtered.filter((entry) => entry.project.archived);
  const sections = projectSections(current, group, now);
  const liveEntries = entries.filter((entry) => !entry.project.archived);
  const restingCount = liveEntries.filter((entry) => isRestingEntry(entry, now)).length;
  const archivedCount = entries.length - liveEntries.length;
  const colorCounts = LIBRARY_PROJECT_COLORS.flatMap((color) => {
    const count = liveEntries.filter((entry) => entry.color === color).length;
    return count ? [{ color, count }] : [];
  });
  const usedComputers = [...new Set(activeCopies.map((copy) => copy.environmentId))];
  const narrowed = !!query.trim() || colors.size > 0 || computer !== null;
  const clearFilters = () => {
    setQuery("");
    setColors(new Set());
    setComputer(null);
  };
  const toggleColor = (color: LibraryProjectColor) =>
    setColors((selected) => {
      const next = new Set(selected);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
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
  const show = (list: readonly ProjectEntry[], compact: boolean) => {
    if (!catalog.authorityId) return null;
    const props = {
      entries: list,
      authorityId: catalog.authorityId,
      connected: catalog.connected,
      hostLabel,
      onOpen: selectProject,
      onChanged: refresh,
    };
    if (preferences.view === "list") return <ProjectRows {...props} />;
    return compact ? <ProjectCompactCards {...props} /> : <ProjectCards {...props} />;
  };
  return (
    <LibraryPageFrame>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-xl text-xs text-muted-foreground tabular-nums">
            {catalog.authorityId && liveEntries.length
              ? [
                  plural(liveEntries.length, "project"),
                  restingCount ? `${restingCount} resting` : null,
                  usedComputers.length ? `on ${plural(usedComputers.length, "computer")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
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
          {entries.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup shape="pill" className="w-full sm:w-72">
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
              <FilterMenu
                colorCounts={colorCounts}
                computers={usedComputers}
                colors={colors}
                computer={computer}
                hostLabel={hostLabel}
                onToggleColor={toggleColor}
                onComputer={setComputer}
              />
              {[...colors].map((color) => (
                <Button
                  key={color}
                  shape="pill"
                  size="xs"
                  variant="secondary"
                  aria-label={`Stop showing only ${PROJECT_COLOR_NAMES[color]} projects`}
                  onClick={() => toggleColor(color)}
                >
                  <ProjectColorDot color={color} />
                  {PROJECT_COLOR_NAMES[color]}
                  <XIcon aria-hidden />
                </Button>
              ))}
              {computer ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="secondary"
                  aria-label={`Stop showing only projects on ${hostLabel(computer)}`}
                  onClick={() => setComputer(null)}
                >
                  <ComputerLabel
                    environmentId={computer}
                    label={hostLabel(computer)}
                    className="text-foreground"
                  />
                  <XIcon aria-hidden />
                </Button>
              ) : null}
              <div className="ms-auto flex items-center gap-1.5">
                <DisplayMenu
                  preferences={{ ...preferences, group }}
                  onChange={(next) => setPreferences(next)}
                />
                <ToggleGroup
                  shape="pill"
                  aria-label="Layout"
                  variant="segmented"
                  value={[preferences.view]}
                  onValueChange={(value) => {
                    const view = value[0];
                    if (view === "cards" || view === "list")
                      setPreferences({ ...preferences, view });
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
          ) : null}
          <LibraryErrorNotice error={catalog.query.error} onRetry={catalog.query.refresh} />
          {loading ? (
            <ProjectCollectionSkeleton view={preferences.view} />
          ) : sections.length ? (
            <div className="space-y-7">
              {sections.map((section) => {
                const heading = SECTION_HEADINGS[section.kind];
                return (
                  <section
                    key={section.kind === "color" ? section.color : section.kind}
                    className="space-y-2.5"
                  >
                    {section.kind === "all" ? null : (
                      <SectionHeading
                        title={
                          section.kind === "color"
                            ? PROJECT_COLOR_NAMES[section.color]
                            : heading.title
                        }
                        count={section.entries.length}
                        hint={section.kind === "color" ? undefined : heading.hint}
                        color={section.kind === "color" ? section.color : undefined}
                      />
                    )}
                    {show(section.entries, section.kind === "resting")}
                  </section>
                );
              })}
            </div>
          ) : catalog.query.error ? null : narrowed ? (
            archived.length ? null : (
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
            )
          ) : archivedCount ? (
            <div className="rounded-xl border border-dashed border-border">
              <Empty size="compact">
                <EmptyHeader>
                  <EmptyTitle>Everything is archived</EmptyTitle>
                  <EmptyDescription>
                    Restore a project below to pick it up again, or start something new.
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
          {archived.length ? (
            <FoldedSection
              // A search that finds archived projects opens the section so the match is visible.
              key={narrowed ? "narrowed" : "all"}
              defaultOpen={narrowed}
              title="Archived"
              count={archived.length}
              hint="Finished or set aside. Conversations stay readable, and the project leaves the project pickers until you restore it."
            >
              {show(archived, true)}
            </FoldedSection>
          ) : null}
        </>
      )}
      {catalog.authorityId && looseFolders.length && !narrowed ? (
        <FoldedSection
          title="Folders not in a project"
          count={looseFolders.length}
          hint="Folders you’ve worked in on your computers. Add one to a project without moving or deleting its files."
        >
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
        </FoldedSection>
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

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

const SECTION_HEADINGS = {
  active: { title: "Active", hint: "Worked on in the last two weeks" },
  resting: {
    title: "Resting",
    hint: "Quiet for two weeks or more. The next conversation brings one back.",
  },
  all: { title: "Projects", hint: undefined },
  color: { title: "", hint: undefined },
} as const;

function SectionHeading({
  title,
  count,
  hint,
  color,
}: {
  readonly title: string;
  readonly count: number;
  readonly hint?: string | undefined;
  readonly color?: LibraryProjectColor | undefined;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {color ? <ProjectColorDot color={color} className="self-center" /> : null}
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      {hint ? (
        <p className="ms-1 hidden min-w-0 truncate text-xs text-muted-foreground/75 sm:block">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A section that stays out of the way until asked for, like archived projects and loose folders. */
function FoldedSection({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly hint: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/fold space-y-2.5">
      <summary className="-mx-2 flex w-fit max-w-full cursor-pointer list-none items-baseline gap-2 rounded-full px-2 py-1 outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 self-center text-muted-foreground transition-transform duration-150 group-open/fold:rotate-90"
        />
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </summary>
      <p className="max-w-2xl text-xs text-muted-foreground">{hint}</p>
      {children}
    </details>
  );
}

/**
 * Narrowing lives behind one control, the way the pull request list does it, so twenty projects
 * in eight colors never turn into a row of dots. Chosen filters show beside it as chips.
 */
function FilterMenu({
  colorCounts,
  computers,
  colors,
  computer,
  hostLabel,
  onToggleColor,
  onComputer,
}: {
  readonly colorCounts: readonly { color: LibraryProjectColor; count: number }[];
  readonly computers: readonly EnvironmentId[];
  readonly colors: ReadonlySet<LibraryProjectColor>;
  readonly computer: EnvironmentId | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onToggleColor: (color: LibraryProjectColor) => void;
  readonly onComputer: (id: EnvironmentId | null) => void;
}) {
  const showComputers = computers.length > 1 || computer !== null;
  if (colorCounts.length < 2 && !showComputers && !colors.size) return null;
  const active = colors.size + (computer ? 1 : 0);
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        Filters
        {active ? (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {active}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuGroup>
          <MenuGroupLabel>Color</MenuGroupLabel>
          {colorCounts.map(({ color, count }) => (
            <MenuCheckboxItem
              key={color}
              checked={colors.has(color)}
              onCheckedChange={() => onToggleColor(color)}
            >
              <span className="flex w-full items-center gap-2">
                <ProjectColorDot color={color} className="size-2.5" />
                <span className="flex-1">{PROJECT_COLOR_NAMES[color]}</span>
                <span className="ps-4 text-xs tabular-nums text-muted-foreground">{count}</span>
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {showComputers ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Computer</MenuGroupLabel>
              <MenuRadioGroup
                value={computer ?? "all"}
                onValueChange={(value) => onComputer(computers.find((id) => id === value) ?? null)}
              >
                <MenuRadioItem value="all">Any computer</MenuRadioItem>
                {computers.map((id) => (
                  <MenuRadioItem key={id} value={id}>
                    <ComputerLabel
                      environmentId={id}
                      label={hostLabel(id)}
                      className="text-foreground"
                    />
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function DisplayMenu({
  preferences,
  onChange,
}: {
  readonly preferences: ProjectsPreferences & { readonly group: ProjectGroup };
  readonly onChange: (preferences: ProjectsPreferences) => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
        <SlidersHorizontalIcon />
        Display
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuGroup>
          <MenuGroupLabel>Group by</MenuGroupLabel>
          <MenuRadioGroup
            value={preferences.group}
            onValueChange={(value) => {
              const group = PROJECT_GROUPS.find((entry) => entry === value);
              if (group) onChange({ ...preferences, group });
            }}
          >
            {PROJECT_GROUPS.map((group) => (
              <MenuRadioItem key={group} value={group}>
                {PROJECT_GROUP_LABELS[group]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup
            value={preferences.sort}
            onValueChange={(value) => {
              const sort = PROJECT_SORTS.find((entry) => entry === value);
              if (sort) onChange({ ...preferences, sort });
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
