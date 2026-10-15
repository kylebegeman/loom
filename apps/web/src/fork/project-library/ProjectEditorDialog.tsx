import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { LibraryError, LibraryResource, type LibraryProject } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { useLibraryAttempt } from "./attempts";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission } from "./state";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { validateResources } from "./resources";

const isLibraryError = Schema.is(LibraryError);
const EditorAttempt = Schema.NullOr(
  Schema.Struct({
    requestId: Schema.String,
    title: Schema.String,
    brief: Schema.String,
    resources: Schema.Array(LibraryResource),
    expectedRevision: Schema.Number,
  }),
);

export function ProjectEditorDialog({
  project,
  authorityId,
  onSaved,
  onClose,
}: {
  readonly project?: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly onSaved: (project: LibraryProject) => void;
  readonly onClose: () => void;
}) {
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:editor:${authorityId}:${project?.id ?? "new"}`,
    EditorAttempt,
  );
  const [title, setTitle] = useState(attempt?.title ?? project?.title ?? "");
  const [brief, setBrief] = useState(attempt?.brief ?? project?.brief ?? "");
  const [resources, setResources] = useState<readonly LibraryResource[]>(
    attempt?.resources ?? project?.resources ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const update = useAtomCommand(projectLibrary.updateProject, { reportFailure: false });
  const allowed = useLibraryPermission(
    project ? projectLibrary.updateProject : projectLibrary.createProject,
    authorityId,
  );
  const change = (id: string, patch: Partial<LibraryResource>) =>
    setResources((current) =>
      current.map((resource) => (resource.id === id ? { ...resource, ...patch } : resource)),
    );
  const add = (kind: "repository" | "link") =>
    setResources((current) => [
      ...current,
      {
        id: randomUUID(),
        kind,
        title: "",
        remoteUrl: null,
        url: null,
        relativePath: "",
        defaultBranch: null,
      },
    ]);
  const save = async () => {
    const validation = validateResources(resources);
    if (!title.trim() || validation) {
      setError(validation ?? "Give the project a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = attempt ?? {
        requestId: randomUUID(),
        title: title.trim(),
        brief,
        resources,
        expectedRevision: project?.revision ?? 0,
      };
      saveAttempt(input);
      const result = project
        ? await update({
            environmentId: authorityId,
            input: { ...input, projectId: project.id, expectedRevision: input.expectedRevision },
          })
        : await create({ environmentId: authorityId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(result.value);
    } catch (cause) {
      if (
        isLibraryError(cause) &&
        ["invalid", "revision-conflict", "not-found"].includes(cause.reason)
      )
        saveAttempt(null);
      setError(cause instanceof Error ? cause.message : "Could not save the project. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={project ? "Edit project" : "New project"}
      description="Save the name, shared brief and resources in your Library. Choose a computer when you start work."
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={busy || !allowed || !title.trim()} onClick={() => void save()}>
            {busy
              ? "Saving..."
              : attempt
                ? "Retry save"
                : project
                  ? "Save project"
                  : "Create project"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <LibraryField label="Name">
          <Input
            autoFocus
            maxLength={160}
            value={title}
            disabled={busy || attempt !== null}
            onChange={(event) => setTitle(event.target.value)}
          />
        </LibraryField>
        <LibraryField label="Shared brief">
          <Textarea
            value={brief}
            maxLength={65536}
            disabled={busy || attempt !== null}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="What are we making, and what matters?"
          />
        </LibraryField>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Resources</h3>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={busy || attempt !== null || resources.length >= 64}
                onClick={() => add("repository")}
              >
                Add repository
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy || attempt !== null || resources.length >= 64}
                onClick={() => add("link")}
              >
                Add reference link
              </Button>
            </div>
          </div>
          {resources.map((resource) => (
            <div key={resource.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {resource.kind === "link" ? "Reference link" : "Repository"}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || attempt !== null}
                  onClick={() =>
                    setResources((current) => current.filter((entry) => entry.id !== resource.id))
                  }
                >
                  Remove
                </Button>
              </div>
              <LibraryField label="Resource name">
                <Input
                  maxLength={160}
                  disabled={busy || attempt !== null}
                  value={resource.title}
                  onChange={(event) => change(resource.id, { title: event.target.value })}
                />
              </LibraryField>
              <LibraryField
                label={
                  resource.kind === "link"
                    ? "URL"
                    : "Repository URL (optional for an existing local repository)"
                }
              >
                <Input
                  disabled={busy || attempt !== null}
                  value={(resource.kind === "link" ? resource.url : resource.remoteUrl) ?? ""}
                  onChange={(event) =>
                    change(
                      resource.id,
                      resource.kind === "link"
                        ? { url: event.target.value }
                        : { remoteUrl: event.target.value || null },
                    )
                  }
                />
              </LibraryField>
              {resource.kind !== "link" ? (
                <LibraryField label="Folder within the project">
                  <Input
                    disabled={busy || attempt !== null}
                    value={resource.relativePath}
                    placeholder="app"
                    onChange={(event) => change(resource.id, { relativePath: event.target.value })}
                  />
                </LibraryField>
              ) : null}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Removing a resource preserves existing files and conversation history.
          </p>
        </div>
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            This project save is waiting for confirmation. Retry to recover the same change.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
