import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryCreateProjectRequest,
  type LibraryFolderInspection,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAttempt } from "./attempts";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { projectLibrary, useLibraryProjects, useLibraryPermission } from "./state";

const isLibraryError = Schema.is(LibraryError);
const ImportAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    rootPath: Schema.String,
    createInput: Schema.NullOr(LibraryCreateProjectRequest),
    project: Schema.NullOr(LibraryProject),
    prepareRequestId: Schema.String,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
  }),
);

/** Import metadata separately from folder ownership; existing Library projects remain an explicit choice. */
export function ImportProjectDialog({
  onSaved,
  onClose,
  initialHostId,
  initialRootPath,
  initialTitle,
}: {
  readonly initialHostId?: EnvironmentId | undefined;
  readonly initialRootPath?: string | undefined;
  readonly initialTitle?: string | undefined;
  readonly onSaved: (project: LibraryProject) => void;
  readonly onClose: () => void;
}) {
  const library = useLibraryProjects();
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:import:${library.authorityId}`,
    ImportAttempt,
  );
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? null,
  );
  const [rootPath, setRootPath] = useState(attempt?.rootPath ?? initialRootPath ?? "");
  const [title, setTitle] = useState(attempt?.createInput?.title ?? initialTitle ?? "");
  const [brief, setBrief] = useState(attempt?.createInput?.brief ?? "");
  const [projectId, setProjectId] = useState(attempt?.project?.id ?? "new");
  const [inspection, setInspection] = useState<LibraryFolderInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recover = useAtomQueryRunner(projectLibrary.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const inspect = useAtomCommand(projectLibrary.inspectFolder, { reportFailure: false });
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const prepare = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const canInspect = useLibraryPermission(projectLibrary.inspectFolder, hostId);
  const canPrepare = useLibraryPermission(projectLibrary.prepareCopy, hostId);
  const canCreate = useLibraryPermission(projectLibrary.createProject, library.authorityId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, library.authorityId);
  const host = library.environments.find((entry) => entry.environmentId === hostId);
  const inspectFolder = async () => {
    if (!hostId || !rootPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inspect({ environmentId: hostId, input: { rootPath: rootPath.trim() } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setInspection(result.value);
      if (!title)
        setTitle(result.value.rootPath.replace(/\/+$/, "").split("/").at(-1) ?? "Project");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect this folder.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!hostId || !library.authorityId || busy || (!attempt && !inspection?.exists)) return;
    const existing = library.query.data?.find((project) => project.id === projectId);
    if (!attempt && projectId !== "new" && !existing) return;
    setBusy(true);
    setError(null);
    let submitted = attempt;
    try {
      let next = attempt ?? {
        environmentId: hostId,
        rootPath: inspection!.rootPath,
        createInput: existing
          ? null
          : {
              requestId: randomUUID(),
              title: title.trim(),
              brief,
              resources: inspection!.repositories.map((repository) => ({
                id: randomUUID(),
                kind: "repository" as const,
                title: repository.relativePath === "." ? title.trim() : repository.relativePath,
                remoteUrl:
                  repository.remoteUrl?.startsWith("file:") || repository.remoteUrl?.startsWith("/")
                    ? null
                    : repository.remoteUrl,
                relativePath: repository.relativePath,
                defaultBranch: repository.branch,
              })),
            },
        project: existing ?? null,
        prepareRequestId: randomUUID(),
        registerRequestId: randomUUID(),
        copy: null,
      };
      saveAttempt(next);
      submitted = next;
      if (!next.project) {
        if (!next.createInput) throw new Error("Choose a project before importing.");
        const result = await create({
          environmentId: library.authorityId,
          input: next.createInput,
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        next = { ...next, project: result.value };
        saveAttempt(next);
        submitted = next;
      }
      if (!next.copy || next.copy.state !== "ready") {
        const result = await prepare({
          environmentId: next.environmentId,
          input: {
            requestId: next.prepareRequestId,
            project: next.project!,
            rootPath: next.rootPath,
            strategy: "reuse",
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        next = { ...next, copy: result.value };
        saveAttempt(next);
      }
      const result = await register({
        environmentId: library.authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(next.project!);
    } catch (cause) {
      if (submitted?.project) {
        const receipt = await recover({
          environmentId: submitted.environmentId,
          input: { requestId: submitted.prepareRequestId },
        });
        if (receipt._tag === "Success") {
          if (receipt.value) saveAttempt({ ...submitted, copy: receipt.value });
          else if (
            isLibraryError(cause) &&
            ["invalid", "not-found", "blocked", "request-conflict"].includes(cause.reason)
          )
            saveAttempt(null);
        }
      } else if (isLibraryError(cause) && cause.reason === "invalid") saveAttempt(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not register this folder. Retry the same import.",
      );
    } finally {
      setBusy(false);
    }
  };
  const reviewCleanup = async () => {
    if (!attempt?.copy || !library.authorityId) return;
    setBusy(true);
    setError(null);
    const result = await register({
      environmentId: library.authorityId,
      input: {
        requestId: `${attempt.registerRequestId}:failed:${attempt.copy.updatedAt}`,
        copy: attempt.copy,
      },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "Could not register this failed copy for review.",
      );
    } else setCleaning(true);
    setBusy(false);
  };
  if (cleaning && attempt?.copy && attempt.project)
    return (
      <ReleaseCopyDialog
        copy={attempt.copy}
        onClose={() => setCleaning(false)}
        onReleased={() => {
          saveAttempt(null);
          setCleaning(false);
          onSaved(attempt.project!);
        }}
      />
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Add existing folder"
      description="Inspect the folder, then use an existing Library project or create a new one. Your files remain borrowed."
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {attempt?.copy?.state === "failed" ? (
            <Button
              variant="outline"
              disabled={busy || !canRegister || !library.connected}
              onClick={() => void reviewCleanup()}
            >
              Review failed copy
            </Button>
          ) : null}
          <Button
            disabled={
              busy ||
              !canPrepare ||
              !canRegister ||
              !canCreate ||
              !library.connected ||
              host?.connection.phase !== "connected" ||
              (!attempt && (!inspection?.exists || (projectId === "new" && !title.trim())))
            }
            onClick={() => void submit()}
          >
            {busy ? "Adding..." : attempt ? "Retry import" : "Add folder"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LibraryField label="Computer">
          <Select
            disabled={busy || attempt !== null}
            value={hostId}
            items={library.environments.map((entry) => ({
              value: entry.environmentId,
              label: entry.label,
            }))}
            onValueChange={(value) => {
              setHostId(value);
              setInspection(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a computer" />
            </SelectTrigger>
            <SelectPopup>
              {library.environments.map((entry) => (
                <SelectItem key={entry.environmentId} value={entry.environmentId}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        <LibraryField label="Existing folder">
          <Input
            font="mono"
            value={rootPath}
            disabled={busy || attempt !== null}
            onChange={(event) => {
              setRootPath(event.target.value);
              setInspection(null);
            }}
          />
        </LibraryField>
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy ||
            attempt !== null ||
            !canInspect ||
            !rootPath.trim() ||
            host?.connection.phase !== "connected"
          }
          onClick={() => void inspectFolder()}
        >
          Inspect folder
        </Button>
        {inspection ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            {!inspection.exists ? (
              <p>The folder does not exist.</p>
            ) : inspection.repositories.length ? (
              inspection.repositories.map((repository) => (
                <p key={repository.path} className="break-words">
                  {repository.relativePath}: {repository.remoteUrl ?? "local repository"}
                </p>
              ))
            ) : (
              <p>No repositories found. You can use this folder as a project workspace.</p>
            )}
          </div>
        ) : null}
        <LibraryField label="Library project">
          <Select
            disabled={busy || attempt !== null}
            value={projectId}
            onValueChange={(value) => setProjectId(value ?? "new")}
            items={[
              { value: "new", label: "Create a new project" },
              ...(library.query.data ?? []).map((project) => ({
                value: project.id,
                label: project.title,
              })),
            ]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="new">Create a new project</SelectItem>
              {library.query.data?.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        {projectId === "new" ? (
          <>
            <LibraryField label="Project name">
              <Input
                value={title}
                maxLength={160}
                disabled={busy || attempt !== null}
                onChange={(event) => setTitle(event.target.value)}
              />
            </LibraryField>
            <LibraryField label="Shared brief">
              <Textarea
                value={brief}
                disabled={busy || attempt !== null}
                onChange={(event) => setBrief(event.target.value)}
              />
            </LibraryField>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            The folder must contain the selected project repositories at their saved relative paths.
          </p>
        )}
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            A previous import is waiting for confirmation. Retry to recover it.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
