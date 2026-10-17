import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryResource, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import {
  libraryActiveCopies,
  libraryResourceFromInput,
  libraryResourceLocation,
  isRepositoryResource,
  resourceLink,
} from "@t3tools/client-runtime/fork";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  EllipsisIcon,
  FolderGit2Icon,
  LinkIcon,
  MessageSquarePlusIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { randomUUID } from "~/lib/utils";
import { LibraryField, LibraryPanel, LibrarySection } from "./LibraryControls";

const MAX_RESOURCES = 64;

function ResourceIcon({ resource }: { readonly resource: LibraryResource }) {
  const Icon = isRepositoryResource(resource) ? FolderGit2Icon : LinkIcon;
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent">
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** The computers whose ready copy holds this repository, so a row says where the code already is. */
function computersHolding(
  resource: LibraryResource,
  copies: readonly LibraryWorkingCopy[],
  hostLabel: (id: EnvironmentId) => string,
) {
  const labels = libraryActiveCopies(copies)
    .filter(
      (copy) =>
        copy.state === "ready" &&
        copy.repositories.some((repository) => repository.resourceId === resource.id),
    )
    .map((copy) => hostLabel(copy.environmentId));
  return [...new Set(labels)];
}

/**
 * Repositories and links, edited in place. Pasting a URL is the whole add flow, and a repository
 * is also a way into a conversation scoped to just that code.
 */
export function ProjectResources({
  resources,
  copies,
  hostLabel,
  canEdit,
  busy,
  adding,
  canStart,
  onAddingChange,
  onChange,
  onStart,
}: {
  readonly resources: readonly LibraryResource[];
  readonly copies: readonly LibraryWorkingCopy[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly adding: boolean;
  readonly canStart: boolean;
  readonly onAddingChange: (adding: boolean) => void;
  readonly onChange: (resources: readonly LibraryResource[]) => Promise<boolean>;
  readonly onStart: (resource: LibraryResource) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const canAdd = canEdit && resources.length < MAX_RESOURCES;
  return (
    <LibrarySection
      title="Repositories and links"
      count={resources.length}
      action={
        canAdd && resources.length ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            aria-expanded={adding}
            onClick={() => onAddingChange(!adding)}
          >
            {adding ? (
              "Done"
            ) : (
              <>
                <PlusIcon />
                Add
              </>
            )}
          </Button>
        ) : null
      }
    >
      {canAdd && (adding || !resources.length) ? (
        <div className="max-w-2xl pb-2">
          <ResourceAdder
            resources={resources}
            busy={busy}
            autoFocus={adding}
            onAdd={(resource) => onChange([...resources, resource])}
          />
        </div>
      ) : null}
      {resources.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {resources.map((resource) =>
            editingId === resource.id ? (
              <li key={resource.id} className="max-w-2xl px-4 py-3.5">
                <ResourceEditor
                  resource={resource}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={async (next) => {
                    const saved = await onChange(
                      resources.map((entry) => (entry.id === next.id ? next : entry)),
                    );
                    if (saved) setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <ResourceRow
                key={resource.id}
                resource={resource}
                computers={computersHolding(resource, copies, hostLabel)}
                canEdit={canEdit && !busy}
                canStart={canStart}
                onEdit={() => setEditingId(resource.id)}
                onStart={() => onStart(resource)}
                onRemove={() =>
                  void onChange(resources.filter((entry) => entry.id !== resource.id))
                }
              />
            ),
          )}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The repositories this project is made of, plus any links worth keeping close.
        </p>
      )}
    </LibrarySection>
  );
}

function ResourceRow({
  resource,
  computers,
  canEdit,
  canStart,
  onEdit,
  onStart,
  onRemove,
}: {
  readonly resource: LibraryResource;
  readonly computers: readonly string[];
  readonly canEdit: boolean;
  readonly canStart: boolean;
  readonly onEdit: () => void;
  readonly onStart: () => void;
  readonly onRemove: () => void;
}) {
  const href = resourceLink(resource);
  const repository = isRepositoryResource(resource);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 ps-4 pe-2.5">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        <ResourceIcon resource={resource} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{resource.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {libraryResourceLocation(resource)}
          </p>
        </div>
      </div>
      {repository ? (
        <p className="w-40 shrink-0 truncate text-xs text-muted-foreground">
          {computers.length ? `On ${computers.join(", ")}` : "Not on a computer"}
        </p>
      ) : null}
      <div className="ms-auto flex shrink-0 items-center gap-1">
        {repository ? (
          <Button shape="pill" size="xs" variant="ghost" disabled={!canStart} onClick={onStart}>
            <MessageSquarePlusIcon />
            Start a conversation
          </Button>
        ) : null}
        {href ? (
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Open ${resource.title}`}
            render={<a href={href} target="_blank" rel="noopener noreferrer" />}
          >
            <ArrowUpRightIcon />
          </Button>
        ) : null}
        {canEdit ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Actions for ${resource.title}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem onClick={onEdit}>Edit</MenuItem>
              <MenuItem variant="destructive" onClick={onRemove}>
                Remove from project
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    </li>
  );
}

/** The overview's glance at what the project is made of. */
export function ResourcesSummary({
  resources,
  onShowAll,
}: {
  readonly resources: readonly LibraryResource[];
  readonly onShowAll: () => void;
}) {
  return (
    <LibraryPanel
      title="Repositories and links"
      count={resources.length}
      action={
        <Button shape="pill" size="xs" variant="ghost" onClick={onShowAll}>
          {resources.length ? "Manage" : "Add"}
          <ArrowRightIcon />
        </Button>
      }
    >
      {resources.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {resources.map((resource) => (
            <li key={resource.id} className="flex min-w-0 items-center gap-2.5 px-3.5 py-2">
              <ResourceIcon resource={resource} />
              <p className="min-w-0 truncate text-sm">{resource.title}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground">
          The repositories this project is made of, plus any links worth keeping close.
        </p>
      )}
    </LibraryPanel>
  );
}

/** Works inside another form, so Enter adds the resource rather than submitting the outer form. */
export function ResourceAdder({
  resources,
  busy,
  autoFocus = false,
  onAdd,
}: {
  readonly resources: readonly LibraryResource[];
  readonly busy: boolean;
  readonly autoFocus?: boolean;
  readonly onAdd: (resource: LibraryResource) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const parsed = libraryResourceFromInput(value, resources);
  const submit = async () => {
    if (!value.trim() || busy) return;
    if (!parsed) {
      setProblem("Paste a full web address, like github.com/owner/repo.");
      return;
    }
    const target = parsed.kind === "link" ? parsed.url : parsed.remoteUrl;
    if (
      resources.some((entry) => (entry.kind === "link" ? entry.url : entry.remoteUrl) === target)
    ) {
      setProblem("That's already in this project.");
      return;
    }
    if (await onAdd({ id: randomUUID(), ...parsed })) setValue("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          autoFocus={autoFocus}
          aria-label="Add a repository or link"
          placeholder="Paste a GitHub URL or any link"
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
        <Button
          type="button"
          shape="pill"
          variant="outline"
          disabled={busy || !value.trim()}
          onClick={() => void submit()}
        >
          Add
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : parsed ? (
        <p className="text-xs text-muted-foreground">
          {parsed.kind === "link"
            ? `Adds a link to ${parsed.title}.`
            : `Adds the ${parsed.title} repository. Copies clone it into ${parsed.relativePath}/.`}
        </p>
      ) : null}
    </div>
  );
}

function ResourceEditor({
  resource,
  busy,
  onSave,
  onCancel,
}: {
  readonly resource: LibraryResource;
  readonly busy: boolean;
  readonly onSave: (resource: LibraryResource) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(resource);
  const repository = isRepositoryResource(resource);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ ...draft, title: draft.title.trim() });
      }}
    >
      <LibraryField label="Name">
        <Input
          autoFocus
          maxLength={160}
          value={draft.title}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </LibraryField>
      <LibraryField label={repository ? "Repository URL" : "URL"}>
        <Input
          value={(repository ? draft.remoteUrl : draft.url) ?? ""}
          disabled={busy}
          placeholder={repository ? "Leave empty for a repository that only exists locally" : ""}
          onChange={(event) =>
            setDraft(
              repository
                ? { ...draft, remoteUrl: event.target.value.trim() || null }
                : { ...draft, url: event.target.value.trim() },
            )
          }
        />
      </LibraryField>
      {repository ? (
        <LibraryField label="Folder inside each copy">
          <Input
            font="mono"
            value={draft.relativePath}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, relativePath: event.target.value })}
          />
        </LibraryField>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" shape="pill" size="sm" disabled={busy || !draft.title.trim()}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Button
          type="button"
          shape="pill"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
