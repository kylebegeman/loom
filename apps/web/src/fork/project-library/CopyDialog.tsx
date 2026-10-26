import { LibraryCloneRepair } from "../vault/LibraryCloneRepair";
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
import {
  supportsLoomFeature,
  isRepositoryResource,
  LIBRARY_FOLDER_CHOICE_TITLES,
  LIBRARY_FOLDER_OCCUPIED_MESSAGE,
  libraryFolderChoice,
  libraryPlacementLine,
  libraryPlacementStrategy,
  serverChoosesFolders,
} from "@t3tools/client-runtime/fork";
import { getNewProjectPathPreview } from "@t3tools/client-runtime/operations/projects";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
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
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { readLocalApi } from "~/localApi";
import { desktopLocalBackendId } from "~/connection/desktopLocal";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { LibraryFolderPalette, libraryFolderActions } from "./LibraryFolderPalette";
import { LibraryPaletteDialog } from "./LibraryPalette";

const isLibraryError = Schema.is(LibraryError);
const PreparationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    input: LibraryPrepareCopyRequest,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
  }),
);

type ChosenFolder = { readonly path: string; readonly strategy: "clone" | "reuse" };

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
  const executionHosts = authority.environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.supportsExecution !== false,
  );
  const primaryId = usePrimaryEnvironmentId();
  const connectedHosts = executionHosts.filter(
    (entry) => entry.entry.enabled && entry.connection.phase === "connected",
  );
  // Default to the only connected computer, or this one, so a copy is usually one click away.
  const defaultHostId =
    connectedHosts.length === 1
      ? connectedHosts[0]!.environmentId
      : (connectedHosts.find((entry) => entry.environmentId === primaryId)?.environmentId ?? null);
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? defaultHostId,
  );
  const host = authority.environments.find((entry) => entry.environmentId === hostId);
  const [chosen, setChosen] = useState<ChosenFolder | null>(() => {
    const path = attempt ? attempt.input.rootPath : initialRootPath;
    return path ? { path, strategy: attempt?.input.strategy ?? strategy } : null;
  });
  const [browsing, setBrowsing] = useState(false);
  const connected = host?.connection.phase === "connected" && host.entry.enabled;
  // Computers that choose folders place a new copy themselves; older ones get today's suggestion.
  const serverPlaces =
    strategy === "clone" && serverChoosesFolders(host?.serverConfig) && chosen === null;
  const placement = useEnvironmentQuery(
    hostId && connected && serverPlaces && !attempt
      ? projectLibrary.placement.resultAtom({
          environmentId: hostId,
          input: { projectId: project.id, ...(resourceId ? { resourceIds: [resourceId] } : {}) },
        })
      : null,
  );
  const legacyPath =
    strategy === "clone" && host?.serverConfig?.newProjectsRoot
      ? getNewProjectPathPreview(host.serverConfig.newProjectsRoot, project.title)
      : "";
  const rootPath = chosen?.path ?? (serverPlaces ? "" : legacyPath);
  const folderLine = chosen
    ? chosen.strategy === "reuse"
      ? `Uses the files in ${chosen.path}`
      : `Loom will put the files in ${chosen.path}`
    : serverPlaces
      ? attempt
        ? attempt.copy
          ? `Loom will put the files in ${attempt.copy.rootPath}`
          : "Loom will choose a folder on this computer."
        : placement.data
          ? libraryPlacementLine(placement.data)
          : placement.error
            ? "Loom will choose a folder on this computer."
            : "Finding a folder on this computer..."
      : rootPath
        ? `Loom will put the files in ${rootPath}`
        : null;
  const browseStart =
    chosen?.path ??
    host?.serverConfig?.folders?.projects ??
    host?.serverConfig?.newProjectsRoot ??
    "~/";
  // The native picker reaches only the desktop's own computer.
  const backend = host ? desktopLocalBackendId(host.entry.target) : null;
  const nativePicker =
    hostId !== null && hostId === primaryId && backend !== null && !backend.startsWith("wsl:")
      ? readLocalApi()
      : undefined;
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recover = useAtomQueryRunner(projectLibrary.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [repair, setRepair] = useState<LibraryError["repair"]>(undefined);
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
  const supported = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    "project-library",
  );
  const submit = async () => {
    const authorityId = authority.authorityId;
    if (!authorityId || !hostId || (!serverPlaces && !rootPath.trim()) || busy) return;
    setBusy(true);
    setError(null);
    setRepair(undefined);
    let submitted = attempt;
    const prepareCopy = async () => {
      let next = attempt ?? {
        environmentId: hostId,
        input: {
          requestId: randomUUID(),
          project,
          ...(serverPlaces ? {} : { rootPath: rootPath.trim() }),
          strategy: serverPlaces
            ? libraryPlacementStrategy(placement.data)
            : (chosen?.strategy ?? strategy),
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
        environmentId: authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(result.value);
    };
    try {
      await prepareCopy();
    } catch (cause) {
      setRepair(isLibraryError(cause) ? cause.repair : undefined);
      const handleFailure = async () => {
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
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
  };
  const inspectFolder = async () => {
    if (!hostId || !rootPath.trim()) return;
    setBusy(true);
    setError(null);
    const loadInspection = async () => {
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
    };
    try {
      await loadInspection();
    } catch (cause) {
      const handleFailure = async () => {
        setError(cause instanceof Error ? cause.message : "Could not inspect the folder.");
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
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
  const pickNatively = async () => {
    const picked = await nativePicker?.dialogs
      .pickFolder({ initialPath: browseStart })
      .catch(() => null);
    if (picked) void chooseFolder(picked);
  };
  // A folder holding this project's files is used as it is; an empty or missing one gets new files.
  const chooseFolder = async (path: string, empty?: boolean) => {
    setBrowsing(false);
    setError(null);
    if (strategy === "reuse" || !hostId) {
      setChosen({ path, strategy });
      return;
    }
    if (!canInspect) {
      setChosen({ path, strategy: empty === false ? "reuse" : "clone" });
      return;
    }
    const result = await inspect({ environmentId: hostId, input: { rootPath: path } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not check this folder.");
      return;
    }
    const choice = libraryFolderChoice(result.value, selectedResources, empty);
    if (choice === "occupied") setError(LIBRARY_FOLDER_OCCUPIED_MESSAGE);
    else setChosen({ path, strategy: choice });
  };
  if (browsing && hostId && host)
    return (
      <LibraryPaletteDialog title="Choose a folder" onClose={() => setBrowsing(false)}>
        <LibraryFolderPalette
          environmentId={hostId}
          computerName={host.label}
          initialPath={browseStart}
          onBack={() => setBrowsing(false)}
          onClose={() => setBrowsing(false)}
          actions={(folder) =>
            !folder
              ? []
              : strategy === "reuse"
                ? [
                    {
                      id: "use-folder",
                      title: LIBRARY_FOLDER_CHOICE_TITLES.reuse,
                      description: folder.path,
                      select: () => void chooseFolder(folder.path),
                    },
                  ]
                : libraryFolderActions(
                    folder,
                    project.title,
                    (path, empty) => void chooseFolder(path, empty),
                  )
          }
        />
      </LibraryPaletteDialog>
    );
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
            ? "Prepare repository files"
            : "Prepare files"
          : "Use existing folder"
      }
      description={
        actualStrategy === "clone"
          ? "Prepare files on a computer. Temporary files can be removed after work finishes. Turn on Keep files on this computer to leave them available."
          : "Choose the folder that already contains your project. Its files stay on this computer."
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
              (!serverPlaces && !rootPath.trim()) ||
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
                  ? "Prepare files"
                  : "Use folder"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LibraryField label="Computer">
          <Select
            value={hostId}
            items={executionHosts.map((entry) => ({
              value: entry.environmentId,
              label: entry.label,
            }))}
            onValueChange={(value) => {
              setHostId(value);
              setChosen(null);
              setInspection(null);
            }}
            disabled={busy || attempt !== null}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a computer" />
            </SelectTrigger>
            <SelectPopup>
              {executionHosts.map((entry) => (
                <SelectItem key={entry.environmentId} value={entry.environmentId}>
                  {entry.label}
                  {entry.connection.phase !== "connected" ? " (offline)" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        {hostId ? (
          <div className="space-y-2">
            {folderLine ? (
              <p className="wrap-anywhere text-sm" role="status">
                {folderLine}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || attempt !== null || !connected}
                onClick={() => setBrowsing(true)}
              >
                {strategy === "reuse" && !chosen ? "Choose folder" : "Choose another folder"}
              </Button>
              {nativePicker ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || attempt !== null}
                  onClick={() => void pickNatively()}
                >
                  Use system folder picker
                </Button>
              ) : null}
              {chosen && strategy === "clone" && !attempt ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(null)}>
                  Let Loom choose
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
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
            A previous preparation is waiting for confirmation. Retry to continue.
          </p>
        ) : null}
        {hostId && !connected ? (
          <p className="text-xs text-muted-foreground">
            Reconnect this computer before preparing files.
          </p>
        ) : null}
        {hostId && connected && !supported ? (
          <p className="text-xs text-muted-foreground">
            Update Loom on this computer to prepare project files.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} onLeave={onClose} />
        {repair && repair.environmentId === hostId ? (
          <LibraryCloneRepair key={repair.environmentId} repair={repair} />
        ) : null}
      </div>
    </LibraryDialog>
  );
}
