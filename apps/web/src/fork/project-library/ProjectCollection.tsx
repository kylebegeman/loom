import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PROJECT_COLORS, type LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  EllipsisIcon,
  FolderGit2Icon,
  HardDriveDownloadIcon,
  LinkIcon,
  MessageSquareIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { cn, randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  ComputerLabel,
  PathLabel,
  PROJECT_COLOR_NAMES,
  ProjectColorDot,
  ProjectTile,
  projectColorStyle,
} from "./ProjectIdentity";
import type { ProjectEntry } from "./projectList";
import { isRepositoryResource } from "./resources";
import { projectLibrary, useLibraryPermission } from "./state";
import { useProjectUpdate } from "./useProjectUpdate";

type CollectionProps = {
  readonly entries: readonly ProjectEntry[];
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onOpen: (projectId: string) => void;
  readonly onChanged: () => void;
};

const MAX_CARD_COPIES = 2;
// Shared by the header and every row so the columns line up.
const ROW_COLUMNS = "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_8.5rem_6rem_1.5rem]";
const MAX_CARD_RESOURCES = 3;

export function ProjectCards(props: CollectionProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Projects">
      {props.entries.map((entry) => (
        <ProjectCard key={entry.project.id} entry={entry} {...props} />
      ))}
    </ul>
  );
}

function ProjectCard({
  entry,
  authorityId,
  connected,
  hostLabel,
  onOpen,
  onChanged,
}: Omit<CollectionProps, "entries"> & { readonly entry: ProjectEntry }) {
  const { project, copies } = entry;
  const repositories = project.resources.filter(isRepositoryResource);
  const shownResources = project.resources.slice(0, MAX_CARD_RESOURCES);
  return (
    <li
      style={projectColorStyle(entry.color)}
      className="group/card relative flex min-h-52 flex-col gap-4 rounded-2xl border border-border bg-card p-4 transition-[border-color,box-shadow] duration-200 hover:border-(--project-color)/35 hover:shadow-lg/5"
    >
      <ProjectOpenLink entry={entry} onOpen={onOpen} />
      <div className="flex items-start gap-3">
        <ProjectTile project={project} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-sm font-semibold leading-5 tracking-tight">
            {project.title}
          </h2>
          <ProjectActivity entry={entry} />
        </div>
        <ProjectMenu
          entry={entry}
          authorityId={authorityId}
          connected={connected}
          onChanged={onChanged}
        />
      </div>
      {project.brief.trim() ? (
        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{project.brief}</p>
      ) : (
        <p className="text-sm leading-5 text-muted-foreground/60">No brief yet</p>
      )}
      {shownResources.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Repositories and links">
          {shownResources.map((resource) => {
            const Icon = isRepositoryResource(resource) ? FolderGit2Icon : LinkIcon;
            return (
              <li
                key={resource.id}
                className="inline-flex h-6 max-w-44 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-foreground/80 dark:bg-accent"
              >
                <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{resource.title}</span>
              </li>
            );
          })}
          {project.resources.length > MAX_CARD_RESOURCES ? (
            <li className="inline-flex h-6 items-center px-1 text-xs tabular-nums text-muted-foreground">
              +{project.resources.length - MAX_CARD_RESOURCES}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="mt-auto space-y-1 border-t border-border/70 pt-3">
        {copies.length ? (
          <>
            {copies.slice(0, MAX_CARD_COPIES).map((copy) => (
              <CopyLine key={copy.id} copy={copy} hostLabel={hostLabel} />
            ))}
            {copies.length > MAX_CARD_COPIES ? (
              <p className="text-xs tabular-nums text-muted-foreground">
                +{copies.length - MAX_CARD_COPIES} more{" "}
                {copies.length - MAX_CARD_COPIES === 1 ? "copy" : "copies"}
              </p>
            ) : null}
          </>
        ) : (
          <p className="flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
            <HardDriveDownloadIcon aria-hidden className="size-3.5" />
            {repositories.length
              ? "Not on a computer yet. Start a conversation to clone it."
              : "Not on a computer yet"}
          </p>
        )}
      </div>
    </li>
  );
}

export function ProjectRows(props: CollectionProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        aria-hidden
        className={cn(
          "hidden items-center gap-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground md:grid",
          ROW_COLUMNS,
        )}
      >
        <span>Project</span>
        <span>Where it lives</span>
        <span>Contents</span>
        <span>Active</span>
        <span />
      </div>
      <ul aria-label="Projects" className="divide-y divide-border">
        {props.entries.map((entry) => (
          <ProjectRow key={entry.project.id} entry={entry} {...props} />
        ))}
      </ul>
    </div>
  );
}

function ProjectRow({
  entry,
  authorityId,
  connected,
  hostLabel,
  onOpen,
  onChanged,
}: Omit<CollectionProps, "entries"> & { readonly entry: ProjectEntry }) {
  const { project, copies } = entry;
  const repositories = project.resources.filter(isRepositoryResource).length;
  const links = project.resources.length - repositories;
  const [firstCopy] = copies;
  return (
    <li
      style={projectColorStyle(entry.color)}
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-accent/60",
        ROW_COLUMNS,
      )}
    >
      <ProjectOpenLink entry={entry} onOpen={onOpen} />
      <div className="flex min-w-0 items-center gap-3">
        <ProjectTile project={project} size="sm" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{project.title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {project.brief.trim() || <span className="text-muted-foreground/60">No brief yet</span>}
          </p>
        </div>
      </div>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        {firstCopy ? (
          <>
            <CopyLine copy={firstCopy} hostLabel={hostLabel} />
            {copies.length > 1 ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                +{copies.length - 1}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-muted-foreground/70">Not on a computer yet</span>
        )}
      </div>
      <div className="hidden items-center gap-3 text-xs tabular-nums text-muted-foreground md:flex">
        <Count icon={FolderGit2Icon} value={repositories} label="repositories" />
        <Count icon={LinkIcon} value={links} label="links" />
        {entry.conversations !== null ? (
          <Count icon={MessageSquareIcon} value={entry.conversations} label="conversations" />
        ) : null}
      </div>
      <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
        {formatRelativeTimeLabel(entry.activeAt)}
      </span>
      <ProjectMenu
        entry={entry}
        authorityId={authorityId}
        connected={connected}
        onChanged={onChanged}
      />
    </li>
  );
}

/** The whole card or row opens the project; controls inside sit above this layer. */
function ProjectOpenLink({
  entry,
  onOpen,
}: {
  readonly entry: ProjectEntry;
  readonly onOpen: (projectId: string) => void;
}) {
  return (
    <Link
      to="/library/$projectId"
      params={{ projectId: entry.project.id }}
      onClick={() => onOpen(entry.project.id)}
      aria-label={entry.project.title}
      className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    />
  );
}

function ProjectActivity({ entry }: { readonly entry: ProjectEntry }) {
  const parts = [
    entry.conversations
      ? `${entry.conversations} ${entry.conversations === 1 ? "conversation" : "conversations"}`
      : null,
    `Active ${formatRelativeTimeLabel(entry.activeAt)}`,
  ].filter(Boolean);
  return <p className="truncate text-xs tabular-nums text-muted-foreground">{parts.join(" · ")}</p>;
}

function CopyLine({
  copy,
  hostLabel,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly hostLabel: (id: EnvironmentId) => string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ComputerLabel
        environmentId={copy.environmentId}
        label={hostLabel(copy.environmentId)}
        className="max-w-32"
      />
      <PathLabel path={copy.rootPath} className="min-w-0" />
      {copy.state === "missing" || copy.state === "failed" ? (
        <span className="shrink-0 text-xs text-warning-foreground">
          {copy.state === "missing" ? "Missing" : "Failed"}
        </span>
      ) : copy.state === "preparing" ? (
        <span className="shrink-0 text-xs text-muted-foreground">Preparing</span>
      ) : null}
    </div>
  );
}

function Count({
  icon: Icon,
  value,
  label,
}: {
  readonly icon: typeof LinkIcon;
  readonly value: number;
  readonly label: string;
}) {
  return (
    <span
      className={
        value ? "inline-flex items-center gap-1" : "inline-flex items-center gap-1 opacity-45"
      }
    >
      <Icon aria-hidden className="size-3.5" />
      {value}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Quick changes that don't need the project page: its color and whether it's archived. */
function ProjectMenu({
  entry,
  authorityId,
  connected,
  onChanged,
}: {
  readonly entry: ProjectEntry;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly onChanged: () => void;
}) {
  const { project } = entry;
  const update = useProjectUpdate({ project, authorityId, connected, onSaved: onChanged });
  const archive = useAtomCommand(projectLibrary.archiveProject, { reportFailure: false });
  const canArchive = useLibraryPermission(projectLibrary.archiveProject, authorityId);
  const setArchived = async (archived: boolean) => {
    const result = await archive({
      environmentId: authorityId,
      input: {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: project.revision,
        archived,
      },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: archived ? "Could not archive the project" : "Could not restore the project",
        ...(cause instanceof Error ? { description: cause.message } : {}),
      });
    }
    onChanged();
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Actions for ${project.title}`}
            className="relative z-10 -me-1"
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuItem render={<Link to="/library/$projectId" params={{ projectId: project.id }} />}>
          Open project
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={!update.canEdit || update.busy}>
            <ProjectColorDot color={entry.color} className="mx-1" />
            Color
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup
              value={project.color ?? "automatic"}
              onValueChange={async (value) => {
                const color = LIBRARY_PROJECT_COLORS.find((name) => name === value) ?? null;
                if ((project.color ?? null) === color) return;
                if (!(await update.save({ color })))
                  toastManager.add({ type: "error", title: "Could not change the color" });
              }}
            >
              <MenuRadioItem value="automatic">Automatic</MenuRadioItem>
              {LIBRARY_PROJECT_COLORS.map((color) => (
                <MenuRadioItem key={color} value={color}>
                  <span className="flex items-center gap-2">
                    <ProjectColorDot color={color} className="size-2.5" />
                    {PROJECT_COLOR_NAMES[color]}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          disabled={!canArchive || !connected}
          onClick={() => void setArchived(!project.archived)}
        >
          {project.archived ? "Restore project" : "Archive project"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function ProjectCollectionSkeleton({ view }: { readonly view: "cards" | "list" }) {
  return view === "cards" ? (
    <div
      role="status"
      aria-label="Loading projects"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-52 flex-col gap-4 rounded-2xl border border-border p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton shape="card" className="size-10" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="mt-auto h-3 w-1/2" />
        </div>
      ))}
    </div>
  ) : (
    <div
      role="status"
      aria-label="Loading projects"
      className="divide-y divide-border rounded-2xl border border-border"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton shape="card" className="size-7" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="ms-auto h-3 w-1/5" />
        </div>
      ))}
    </div>
  );
}
