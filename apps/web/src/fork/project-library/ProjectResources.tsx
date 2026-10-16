import { useState } from "react";
import type { LibraryResource } from "@t3tools/contracts/fork";
import { libraryResourceFromInput, libraryResourceLocation } from "@t3tools/client-runtime/fork";
import { EllipsisIcon, ExternalLinkIcon, FolderGit2Icon, LinkIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { randomUUID } from "~/lib/utils";
import { LibraryField, LibrarySection } from "./LibraryControls";
import { isRepositoryResource, resourceLink } from "./resources";

const MAX_RESOURCES = 64;

/** Repositories and links, edited in place. Pasting a URL is the whole add flow. */
export function ProjectResources({
  resources,
  canEdit,
  busy,
  onChange,
}: {
  readonly resources: readonly LibraryResource[];
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly onChange: (resources: readonly LibraryResource[]) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <LibrarySection title="Repositories and links">
      {resources.length ? (
        <ul className="divide-y divide-border">
          {resources.map((resource) =>
            editingId === resource.id ? (
              <li key={resource.id} className="py-3">
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
                canEdit={canEdit && !busy}
                onEdit={() => setEditingId(resource.id)}
                onRemove={() =>
                  void onChange(resources.filter((entry) => entry.id !== resource.id))
                }
              />
            ),
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add the repositories this project is made of, plus any links worth keeping close.
        </p>
      )}
      {canEdit && resources.length < MAX_RESOURCES ? (
        <ResourceAdder
          resources={resources}
          busy={busy}
          onAdd={(resource) => onChange([...resources, resource])}
        />
      ) : null}
    </LibrarySection>
  );
}

function ResourceRow({
  resource,
  canEdit,
  onEdit,
  onRemove,
}: {
  readonly resource: LibraryResource;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const href = resourceLink(resource);
  const Icon = isRepositoryResource(resource) ? FolderGit2Icon : LinkIcon;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{resource.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {libraryResourceLocation(resource)}
        </p>
      </div>
      {href ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Open ${resource.title}`}
          render={<a href={href} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
        </Button>
      ) : null}
      {canEdit ? (
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${resource.title}`} />
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
    </li>
  );
}

/** Works inside another form, so Enter adds the resource rather than submitting the outer form. */
export function ResourceAdder({
  resources,
  busy,
  onAdd,
}: {
  readonly resources: readonly LibraryResource[];
  readonly busy: boolean;
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
        <Button type="submit" size="sm" disabled={busy || !draft.title.trim()}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
