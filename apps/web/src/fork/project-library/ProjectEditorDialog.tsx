import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import {
  LibraryError,
  LibraryProjectColor,
  LibraryResource,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { useLibraryAttempt } from "./attempts";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission, useLibraryProjects } from "./state";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { LibrarySetup } from "./LibrarySetup";
import {
  libraryResourceLocation,
  isRepositoryResource,
  validateResources,
} from "@t3tools/client-runtime/fork";
import { FolderGit2Icon, LinkIcon, XIcon } from "lucide-react";
import { ResourceAdder } from "./ProjectResources";
import { ProjectColorPicker, ProjectTile } from "./ProjectIdentity";

const isLibraryError = Schema.is(LibraryError);
const EditorAttempt = Schema.NullOr(
  Schema.Struct({
    requestId: Schema.String,
    title: Schema.String,
    brief: Schema.String,
    resources: Schema.Array(LibraryResource),
    color: Schema.optional(LibraryProjectColor),
  }),
);

/** Creating a project asks for a name; a brief and its repositories can come now or later. */
export function ProjectEditorDialog({
  open = true,
  flow,
  continueToConversation = false,
  authorityId,
  onSaved,
  onClose,
}: {
  readonly open?: boolean;
  readonly flow?: import("./LibraryFlow").LibraryFlowNavigation | undefined;
  readonly continueToConversation?: boolean;
  readonly authorityId: EnvironmentId | null;
  readonly onSaved: (project: LibraryProject) => void;
  readonly onClose: () => void;
}) {
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:editor:${authorityId}:new`,
    EditorAttempt,
  );
  const [title, setTitle] = useState(attempt?.title ?? "");
  const [brief, setBrief] = useState(attempt?.brief ?? "");
  const [resources, setResources] = useState<readonly LibraryResource[]>(attempt?.resources ?? []);
  const [resourceDraft, setResourceDraft] = useState("");
  const [color, setColor] = useState<LibraryProjectColor | undefined>(attempt?.color);
  const catalog = useLibraryProjects();
  const existing = catalog.query.data?.find(
    (entry) => entry.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.createProject, authorityId);
  const locked = busy || attempt !== null;
  const save = async () => {
    if (!authorityId || !allowed || busy) return;
    const validation = validateResources(resources);
    if (!title.trim() || validation) {
      setError(validation ?? "Give the project a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const createProject = async () => {
      const input = attempt ?? {
        requestId: randomUUID(),
        title: title.trim(),
        brief,
        resources,
        ...(color ? { color } : {}),
      };
      saveAttempt(input);
      const result = await create({ environmentId: authorityId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(result.value);
    };
    try {
      await createProject();
    } catch (cause) {
      const handleFailure = async () => {
        if (isLibraryError(cause) && ["invalid", "not-found"].includes(cause.reason))
          saveAttempt(null);
        setError(
          cause instanceof Error ? cause.message : "Could not create the project. Try again.",
        );
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
  };
  return (
    <LibraryDialog
      open={open}
      flow={flow ? { ...flow, busy: locked } : undefined}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="New project"
      description="A home for one thing you're building: its brief, repositories and conversations."
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="library-project-editor"
            disabled={busy || !allowed || !title.trim()}
          >
            {busy
              ? "Creating..."
              : attempt
                ? "Retry"
                : continueToConversation
                  ? "Create project & continue"
                  : "Create project"}
          </Button>
        </>
      }
    >
      <form
        id="library-project-editor"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-end gap-3">
          <ProjectTile project={{ id: "", title, color }} neutral={!color} />
          <div className="min-w-0 flex-1">
            <LibraryField label="Name">
              <Input
                autoFocus
                placeholder="AspectAvy"
                maxLength={160}
                value={title}
                disabled={locked}
                onChange={(event) => setTitle(event.target.value)}
              />
            </LibraryField>
          </div>
        </div>
        {existing ? (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <p className="text-sm">A project named {existing.title} already exists.</p>
            <Button size="sm" variant="outline" disabled={locked} onClick={() => onSaved(existing)}>
              Open existing project
            </Button>
          </div>
        ) : null}
        <details className="space-y-4" open={attempt !== null || undefined}>
          <summary className="w-fit cursor-pointer text-sm text-muted-foreground">
            Optional details
          </summary>
          <div className="space-y-2">
            <p className="text-sm font-medium">Color</p>
            <ProjectColorPicker
              value={color}
              disabled={locked}
              onChange={(next) => setColor(next ?? undefined)}
            />
          </div>
          <LibraryField label="Brief (optional)">
            <Textarea
              rows={3}
              value={brief}
              maxLength={65536}
              disabled={locked}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="What are we making, and what matters?"
            />
          </LibraryField>
          <div className="space-y-2">
            <p className="text-sm font-medium">Repositories and links (optional)</p>
            {resources.length ? (
              <ul className="divide-y divide-border">
                {resources.map((resource) => {
                  const Icon = isRepositoryResource(resource) ? FolderGit2Icon : LinkIcon;
                  return (
                    <li key={resource.id} className="flex items-center gap-3 py-2">
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{resource.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {libraryResourceLocation(resource)}
                        </p>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${resource.title}`}
                        disabled={locked}
                        onClick={() =>
                          setResources((current) =>
                            current.filter((entry) => entry.id !== resource.id),
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {resources.length < 64 ? (
              <ResourceAdder
                resources={resources}
                draft={{ value: resourceDraft, onChange: setResourceDraft }}
                busy={locked}
                onAdd={async (resource) => {
                  setResources((current) => [...current, resource]);
                  return true;
                }}
              />
            ) : null}
          </div>
        </details>
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            Creating this project is waiting for confirmation. Retry to finish it.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </form>
      {!authorityId ? (
        <section className="mt-6 rounded-lg bg-muted/40 p-4" aria-label="Connect shared Library">
          <LibrarySetup />
        </section>
      ) : null}
    </LibraryDialog>
  );
}
