import { VaultGitHubConnectionPicker } from "../vault/GitHubConnectionPicker";
import { LibraryAccessNotice, LibraryAccessRepairNotice } from "./LibraryAccessNotice";
import { LibraryCloneRepair } from "../vault/LibraryCloneRepair";
import { randomUUID } from "~/lib/utils";
import { useEffect, useRef, useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryPrepareCopyRequest,
  LIBRARY_REPOSITORY_ACCESS_FEATURE,
  type LibraryResourceRepositoryAccess,
} from "@t3tools/contracts/fork";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import {
  libraryAccessRepairFromFailure,
  supportsLoomFeature,
  libraryGitHubRepository,
  cancelEmptyLibraryPreparation,
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
import { useEnvironmentSessionState } from "~/state/session";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useLibraryAttempt } from "./attempts";
import {
  libraryGitHub,
  projectLibrary,
  useAccessBlock,
  useLibraryAuthority,
  useLibraryPermission,
} from "./state";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { readLocalApi } from "~/localApi";
import { desktopLocalBackendId } from "~/connection/desktopLocal";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { LibraryFolderPalette, libraryFolderActions } from "./LibraryFolderPalette";
import { LibraryPaletteDialog } from "./LibraryPalette";

const isLibraryError = Schema.is(LibraryError);
const isCopy = Schema.is(LibraryWorkingCopy);
const PreparationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    input: LibraryPrepareCopyRequest,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
    registered: Schema.optionalKey(Schema.Boolean),
    initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
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
  embedded = false,
  newProject = false,
}: {
  readonly project: LibraryProject;
  readonly strategy: "clone" | "reuse";
  readonly initialHostId?: EnvironmentId;
  readonly initialRootPath?: string;
  readonly resourceId?: string;
  readonly onSaved: (copy: LibraryWorkingCopy) => void;
  readonly onClose: () => void;
  readonly embedded?: boolean;
  readonly newProject?: boolean;
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
  const identity = useEnvironmentSessionState(hostId).data?.identity;
  const [accessSelection, setAccessSelection] = useState<{
    environmentId: EnvironmentId | null;
    entries: LibraryResourceRepositoryAccess;
  }>({ environmentId: hostId, entries: attempt?.input.repositoryAccess ?? [] });
  const [choosingAccess, setChoosingAccess] = useState<string | null>(null);
  const repositoryAccess =
    attempt?.input.repositoryAccess ??
    (accessSelection.environmentId === hostId ? accessSelection.entries : []);
  const usesVault = repositoryAccess.some((entry) => entry.access.kind === "vault-github");
  const vaultSupported = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    LIBRARY_REPOSITORY_ACCESS_FEATURE,
  );
  const canUseVault = useLibraryPermission(libraryGitHub.readiness, hostId);
  const vaultBlock = useAccessBlock(hostId, [libraryGitHub.readiness, projectLibrary.prepareCopy]);
  const accountMatches =
    !attempt?.initiator ||
    (attempt.initiator.issuer === identity?.issuer &&
      attempt.initiator.subject === identity?.subject);
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prevents a late preparation reply from navigating after the dialog closes
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const activeAccount = useStableCallback(() => mounted.current && accountMatches);
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
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
  const [inspection, setInspection] = useState<string | null>(null);
  const prepare = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const lookup = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
  const cancel = useAtomCommand(projectLibrary.cancelOperation, { reportFailure: false });
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
  const changePreparation = async () => {
    if (!attempt || busy || !accountMatches) return;
    setBusy(true);
    setError(null);
    const change = async () => {
      await cancelEmptyLibraryPreparation(attempt.input.requestId, {
        outcome: async (requestId) => {
          const result = await lookup({
            environmentId: attempt.environmentId,
            input: { requestId, kind: "prepare" },
          });
          if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
          return result.value;
        },
        preparation: async (requestId) => {
          const result = await recover({
            environmentId: attempt.environmentId,
            input: { requestId },
          });
          if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
          return result.value;
        },
        cancel: async (operationId) => {
          const result = await cancel({
            environmentId: attempt.environmentId,
            input: { operationId },
          });
          if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
          return result.value;
        },
      });
      saveAttempt(null, (latest) => latest?.input.requestId === attempt.input.requestId);
      setRepair(undefined);
      setAccessRepair(undefined);
    };
    await change().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change this preparation. Check its result first.",
      ),
    );
    setBusy(false);
  };
  const submit = async () => {
    const authorityId = authority.authorityId;
    if (!authorityId || !hostId || !accountMatches || (!serverPlaces && !rootPath.trim()) || busy)
      return;
    if (usesVault && (!vaultSupported || !canUseVault)) {
      setError(
        vaultSupported
          ? "Vault credential-use access is required on this computer."
          : "Update this computer before preparing files with a Vault connection.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setRepair(undefined);
    setAccessRepair(undefined);
    let submitted = attempt;
    let requestEnvironmentId = hostId;
    const prepareCopy = async () => {
      let next = attempt ?? {
        environmentId: hostId,
        ...(identity ? { initiator: identity } : {}),
        input: {
          requestId: randomUUID(),
          project,
          ...(serverPlaces ? {} : { rootPath: rootPath.trim() }),
          ...(repositoryAccess.length ? { repositoryAccess } : {}),
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
      if (next.registered && next.copy?.state === "ready") {
        if (activeAccount()) {
          saveAttempt(null);
          onSaved(next.copy);
        }
        return;
      }
      if ((!next.copy || next.copy.state !== "ready") && attempt) {
        const outcome = await lookup({
          environmentId: next.environmentId,
          input: { requestId: next.input.requestId, kind: "prepare" },
        });
        if (outcome._tag === "Failure") throw squashLibraryCommandFailure(outcome);
        if (!activeAccount()) return;
        const operation = outcome.value;
        if (operation?.state === "queued" || operation?.state === "running")
          throw new Error(
            "This preparation is already in progress. Check its result before retrying.",
          );
        if (operation?.state === "cancelled")
          throw new Error(
            "This preparation was cancelled. Review its completed steps before starting another.",
          );
        if (operation?.state === "succeeded") {
          const copy = operation.result;
          if (
            !isCopy(copy) ||
            copy.environmentId !== next.environmentId ||
            copy.projectId !== next.input.project.id ||
            copy.state !== "ready"
          )
            throw new Error(
              "The preparation receipt does not match this project and computer. Keep the saved request for recovery.",
            );
          next = { ...next, copy };
          saveAttempt(next);
        }
      }
      if (!next.copy || next.copy.state !== "ready") {
        const result = await prepare({ environmentId: next.environmentId, input: next.input });
        if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
        next = { ...next, copy: result.value };
        saveAttempt(next);
      }
      if (!activeAccount()) return;
      requestEnvironmentId = authorityId;
      const result = await register({
        environmentId: authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
      if (activeAccount()) {
        saveAttempt(null);
        onSaved(result.value);
      } else saveAttempt({ ...next, copy: result.value, registered: true });
    };
    try {
      await prepareCopy();
    } catch (cause) {
      setRepair(isLibraryError(cause) ? cause.repair : undefined);
      setAccessRepair(libraryAccessRepairFromFailure(cause, requestEnvironmentId));
      const handleFailure = async () => {
        if (submitted) {
          const receipt = await recover({
            environmentId: submitted.environmentId,
            input: { requestId: submitted.input.requestId },
          });
          if (receipt._tag === "Success") {
            if (receipt.value) saveAttempt({ ...submitted, copy: receipt.value });
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
      if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
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
      const cause = squashLibraryCommandFailure(result);
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
      const cause = squashLibraryCommandFailure(result);
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
      embedded={embedded}
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={
        newProject
          ? "Finish project setup"
          : actualStrategy === "clone"
            ? resourceId
              ? "Prepare repository files"
              : "Prepare files"
            : "Use existing folder"
      }
      description={
        newProject
          ? `${project.title} is saved in your Library. Choose where to prepare its working copy.`
          : actualStrategy === "clone"
            ? "Prepare files on a computer. Temporary files can be removed after work finishes. Turn on Keep files on this computer to leave them available."
            : "Choose the folder that already contains your project. Its files stay on this computer."
      }
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {newProject ? "Finish later" : "Close"}
          </Button>
          {attempt && !attempt.copy ? (
            <Button
              variant="outline"
              disabled={busy || !accountMatches || !allowed || !connected}
              onClick={() => void changePreparation()}
            >
              Change setup
            </Button>
          ) : null}
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
              !accountMatches ||
              (usesVault && (!vaultSupported || !canUseVault)) ||
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
        {!accountMatches ? (
          <p role="status" className="text-sm text-muted-foreground">
            Sign in with the account that started this preparation before continuing.
          </p>
        ) : null}
        {hostId && actualStrategy === "clone" && selectedResources.length ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Repository access</p>
            {selectedResources.map((resource) => {
              const selected = repositoryAccess.find(
                (entry) => entry.resourceId === resource.id,
              )?.access;
              const repository = libraryGitHubRepository(resource.remoteUrl);
              return (
                <div key={resource.id} className="space-y-2 rounded-lg bg-muted/35 p-3">
                  <p className="text-sm font-medium">{resource.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected?.kind === "vault-github"
                      ? `Vault GitHub for ${selected.repository}, version ${selected.expectedVersion}`
                      : `Git credentials configured on ${host?.label ?? "this computer"}`}
                  </p>
                  {vaultSupported && repository ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || attempt !== null || !canUseVault}
                        onClick={() =>
                          setChoosingAccess(choosingAccess === resource.id ? null : resource.id)
                        }
                      >
                        Choose Vault GitHub connection
                      </Button>
                      {selected?.kind === "vault-github" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || attempt !== null}
                          onClick={() =>
                            setAccessSelection({
                              environmentId: hostId,
                              entries: repositoryAccess.filter(
                                (entry) => entry.resourceId !== resource.id,
                              ),
                            })
                          }
                        >
                          Use computer credentials
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {choosingAccess === resource.id ? (
                    <VaultGitHubConnectionPicker
                      environmentId={hostId}
                      disabled={busy || attempt !== null}
                      onSelect={(id, selectedRepository, info) => {
                        if (selectedRepository.toLowerCase() !== repository) {
                          setError(`Choose the connection's access to ${repository}.`);
                          return;
                        }
                        setAccessSelection({
                          environmentId: hostId,
                          entries: [
                            ...repositoryAccess.filter((entry) => entry.resourceId !== resource.id),
                            {
                              resourceId: resource.id,
                              access: {
                                kind: "vault-github",
                                id,
                                expectedVersion: info.item.version,
                                repository: selectedRepository.toLowerCase(),
                              },
                            },
                          ],
                        });
                        setChoosingAccess(null);
                        setError(null);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {usesVault && !vaultSupported ? (
              <p role="status" className="text-sm text-muted-foreground">
                Update this computer to use the selected Vault connection.
              </p>
            ) : null}
            {usesVault && vaultBlock ? (
              <LibraryAccessNotice block={vaultBlock} onLeave={onClose} />
            ) : null}
          </div>
        ) : null}
        {hostId ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Repository access is checked on {host?.label ?? "this computer"} before creating
              folders.
            </p>
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
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Preparing {project.title} on {host?.label ?? "the selected computer"}. Your project is
            already saved.
          </p>
        ) : null}
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            A previous preparation is waiting for confirmation. Retry to continue.
          </p>
        ) : null}
        {hostId && !connected ? (
          <LibraryAccessRepairNotice
            accessRepair={{ kind: "connection", environmentId: hostId }}
            onLeave={onClose}
          />
        ) : null}
        {!accountMatches && hostId ? (
          <LibraryAccessRepairNotice
            accessRepair={{ kind: "ownership", environmentId: hostId }}
            context={{ environmentId: hostId, originalAccount: attempt?.initiator }}
            onLeave={onClose}
          />
        ) : null}
        {hostId && connected && !supported ? (
          <p className="text-xs text-muted-foreground">
            Update Loom on this computer to prepare project files.
          </p>
        ) : null}
        <LibraryErrorNotice
          accessRepair={accessRepair}
          accessContext={{
            environmentId: hostId,
            authorityEnvironmentId: authority.authorityId,
            originalAccount:
              accessRepair?.environmentId === authority.authorityId
                ? undefined
                : attempt?.initiator,
          }}
          error={error}
          onLeave={onClose}
        />
        {repair && repair.environmentId === hostId ? (
          <LibraryCloneRepair key={repair.environmentId} repair={repair} />
        ) : null}
      </div>
    </LibraryDialog>
  );
}
