import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryPrepareCopyRequest,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { isRepositoryResource } from "./resources";

const isLibraryError = Schema.is(LibraryError);
const PreparationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    input: LibraryPrepareCopyRequest,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
  }),
);

/** Keep the request and returned receipt until both the host and Library acknowledge it. */
export function CopyDialog({
  project,
  strategy,
  initialHostId,
  initialRootPath,
  resourceId,
  onSaved,
  onClose,
}: {
  readonly project: LibraryProject;
  readonly strategy: "clone" | "reuse";
  readonly initialHostId?: EnvironmentId;
  readonly initialRootPath?: string;
  readonly resourceId?: string;
  readonly onSaved: (copy: LibraryWorkingCopy) => void;
  readonly onClose: () => void;
}) {
  const authority = useLibraryAuthority();
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:prepare:${authority.authorityId}:${project.id}`,
    PreparationAttempt,
  );
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? null,
  );
  const host = authority.environments.find((entry) => entry.environmentId === hostId);
  const [rootPath, setRootPath] = useState(attempt?.input.rootPath ?? initialRootPath ?? "");
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recover = useAtomQueryRunner(projectLibrary.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<string | null>(null);
  const prepare = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const inspect = useAtomCommand(projectLibrary.inspectFolder, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.prepareCopy, hostId);
  const canInspect = useLibraryPermission(projectLibrary.inspectFolder, hostId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, authority.authorityId);
  const selectedResources = (attempt?.input.project ?? project).resources.filter(
    (resource) =>
      isRepositoryResource(resource) &&
      (!(attempt?.input.resourceIds?.[0] ?? resourceId) ||
        resource.id === (attempt?.input.resourceIds?.[0] ?? resourceId)),
  );
  const actualStrategy = attempt?.input.strategy ?? strategy;
  const connected = host?.connection.phase === "connected" && host.entry.enabled;
  const supported = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    "project-library",
  );
  const submit = async () => {
    if (!authority.authorityId || !hostId || !rootPath.trim() || busy) return;
    setBusy(true);
    setError(null);
    let submitted = attempt;
    try {
      let next = attempt ?? {
        environmentId: hostId,
        input: {
          requestId: randomUUID(),
          project,
          rootPath: rootPath.trim(),
          strategy,
          ...(resourceId ? { resourceIds: [resourceId] } : {}),
        },
        registerRequestId: randomUUID(),
        copy: null,
      };
      saveAttempt(next);
      submitted = next;
      if (!next.copy || next.copy.state !== "ready") {
        const result = await prepare({ environmentId: next.environmentId, input: next.input });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        next = { ...next, copy: result.value };
        saveAttempt(next);
      }
      const result = await register({
        environmentId: authority.authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(result.value);
    } catch (cause) {
      if (submitted) {
        const receipt = await recover({
          environmentId: submitted.environmentId,
          input: { requestId: submitted.input.requestId },
        });
        if (receipt._tag === "Success") {
          if (receipt.value) saveAttempt({ ...submitted, copy: receipt.value });
          else if (
            isLibraryError(cause) &&
            ["invalid", "not-found", "blocked", "request-conflict"].includes(cause.reason)
          )
            saveAttempt(null);
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare the working copy. Retry the same request.",
      );
    } finally {
      setBusy(false);
    }
  };
  const inspectFolder = async () => {
    if (!hostId || !rootPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inspect({ environmentId: hostId, input: { rootPath: rootPath.trim() } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setInspection(
        result.value.exists
          ? result.value.repositories.length
            ? result.value.repositories
                .map(
                  (repository) =>
                    `${repository.relativePath}: ${repository.remoteUrl ?? "local repository"}`,
                )
                .join("\n")
            : "Folder exists. No repositories were found at its root or directly inside it."
          : "This folder does not exist.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect the folder.");
    } finally {
      setBusy(false);
    }
  };
  const reviewCleanup = async () => {
    if (!attempt?.copy || !authority.authorityId) return;
    setBusy(true);
    setError(null);
    const result = await register({
      environmentId: authority.authorityId,
      input: {
        requestId: `${attempt.registerRequestId}:failed:${attempt.copy.updatedAt}`,
        copy: attempt.copy,
      },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "Could not register the failed copy for review.",
      );
    } else setCleaning(true);
    setBusy(false);
  };
  if (cleaning && attempt?.copy)
    return (
      <ReleaseCopyDialog
        copy={attempt.copy}
        onClose={() => setCleaning(false)}
        onReleased={() => {
          saveAttempt(null);
          setCleaning(false);
          onSaved({ ...attempt.copy!, state: "released" });
        }}
      />
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={
        actualStrategy === "clone"
          ? resourceId
            ? "Prepare repository"
            : "Clone project"
          : "Use existing folder"
      }
      description={
        actualStrategy === "clone"
          ? "Prepare project repositories together under one parent folder on the selected computer."
          : "Register an existing folder as a borrowed working copy. Removing its registration preserves your files."
      }
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {attempt?.copy?.state === "failed" ? (
            <Button
              variant="outline"
              disabled={busy || !canRegister || !authority.connected}
              onClick={() => void reviewCleanup()}
            >
              Review failed copy
            </Button>
          ) : null}
          <Button
            disabled={
              busy ||
              !allowed ||
              !canRegister ||
              !connected ||
              !supported ||
              !authority.connected ||
              !rootPath.trim() ||
              (actualStrategy === "clone" &&
                selectedResources.some((resource) => !resource.remoteUrl))
            }
            onClick={() => void submit()}
          >
            {busy
              ? "Preparing..."
              : attempt
                ? "Retry preparation"
                : actualStrategy === "clone"
                  ? "Clone project"
                  : "Use folder"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LibraryField label="Computer">
          <Select
            value={hostId}
            items={authority.environments.map((entry) => ({
              value: entry.environmentId,
              label: entry.label,
            }))}
            onValueChange={(value) => setHostId(value)}
            disabled={busy || attempt !== null}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a computer" />
            </SelectTrigger>
            <SelectPopup>
              {authority.environments.map((entry) => (
                <SelectItem key={entry.environmentId} value={entry.environmentId}>
                  {entry.label}
                  {entry.connection.phase !== "connected" ? " (offline)" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        <LibraryField label="Parent folder">
          <Input
            font="mono"
            placeholder={
              host?.serverConfig?.newProjectsRoot
                ? `${host.serverConfig.newProjectsRoot}/${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
                : "/path/to/project"
            }
            disabled={busy || attempt !== null}
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
          />
        </LibraryField>
        {actualStrategy === "reuse" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canInspect || !connected || !rootPath.trim()}
            onClick={() => void inspectFolder()}
          >
            Inspect folder
          </Button>
        ) : null}
        {inspection ? (
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {inspection}
          </p>
        ) : null}
        <div className="space-y-1 text-sm text-muted-foreground">
          {selectedResources.map((resource) => (
            <p key={resource.id}>
              {resource.title}: <span className="font-mono text-xs">{resource.relativePath}</span>
            </p>
          ))}
          {selectedResources.length === 0 ? (
            <p>A project workspace will hold the shared brief and resources.</p>
          ) : null}
          {actualStrategy === "clone" &&
          selectedResources.some((resource) => !resource.remoteUrl) ? (
            <p>Add a repository URL or use an existing folder for local repositories.</p>
          ) : null}
        </div>
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            A previous preparation is waiting for confirmation. Retry it to recover the same working
            copy.
          </p>
        ) : null}
        {hostId && !connected ? (
          <p className="text-xs text-muted-foreground">
            Reconnect this computer before preparing files.
          </p>
        ) : null}
        {hostId && connected && !supported ? (
          <p className="text-xs text-muted-foreground">
            Update Loom on this computer to prepare a Library working copy.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
