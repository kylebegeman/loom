import { LibraryTextPalette } from "./LibraryTextPalette";
import {
  LibraryPaletteDialog,
  LibraryPaletteView,
  type LibraryPaletteItem,
} from "./LibraryPalette";
import { LibraryFolderPalette, type LibraryBrowsedFolder } from "./LibraryFolderPalette";
import { MonitorIcon, FolderInputIcon, FolderPlusIcon, RotateCcwIcon } from "lucide-react";
import { randomUUID } from "~/lib/utils";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  type LibraryError,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryCreateProjectRequest,
  type LibraryFolderInspection,
} from "@t3tools/contracts/fork";
import { libraryAccessRepairFromFailure } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { useLibraryAttempt } from "./attempts";
import { useEnvironmentSessionState } from "~/state/session";
import { useStableCallback } from "~/hooks/useStableCallback";

import { usePrimaryEnvironmentId } from "~/state/environments";
import {
  libraryFolderAction,
  libraryFolderOwner,
  libraryFolderOwnerIssue,
  libraryFolderRegistrations,
  libraryFolderTakeover,
  libraryFolderTitle,
  libraryStartFolderProjects,
  sameLibraryFolderAction,
  type LibraryFolderAction,
  type LibraryFolderOwner,
} from "@t3tools/client-runtime/fork";
import { folderProjectMatches } from "./folderProjectMatches";

import {
  projectLibrary,
  useAccessBlock,
  useLibraryAccessBlock,
  useLibraryProjects,
  useLibraryPermission,
} from "./state";
import { LibraryAccessNotice, LibraryAccessRepairNotice } from "./LibraryAccessNotice";

const isProject = Schema.is(LibraryProject);
const isCopy = Schema.is(LibraryWorkingCopy);
const ImportRequest = Schema.Struct({
  authorityId: Schema.optionalKey(EnvironmentId),
  initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
  authorityInitiator: Schema.optionalKey(
    Schema.Struct({ issuer: Schema.String, subject: Schema.String }),
  ),
  creation: Schema.optionalKey(Schema.Literals(["unknown", "ready"])),
  preparation: Schema.optionalKey(Schema.Literals(["unknown", "ready"])),
  registration: Schema.optionalKey(Schema.Literals(["unknown", "ready", "succeeded"])),
  environmentId: EnvironmentId,
  rootPath: Schema.String,
  createInput: Schema.NullOr(LibraryCreateProjectRequest),
  project: Schema.NullOr(LibraryProject),
  prepareRequestId: Schema.String,
  registerRequestId: Schema.String,
  copy: Schema.NullOr(LibraryWorkingCopy),
});
const ImportAttempt = Schema.NullOr(
  Schema.Struct({
    ...ImportRequest.fields,
    previous: Schema.optionalKey(Schema.Array(ImportRequest)),
  }),
);

const lookupKey = (environmentId: EnvironmentId, path: string) => `${environmentId}\n${path}`;
const ASSOCIATIONS_UNCHECKED =
  "Could not check the Library's existing folder associations. Reconnect it and check this folder again.";

/**
 * Import metadata separately from folder ownership. The folder browser names what adding the
 * browsed folder does and does it in one step; the confirmation page stays for retries, typed
 * paths, naming a new project and choices that could not finish.
 */
export function ImportProjectDialog({
  open = true,
  embedded = false,
  onBack,
  onSaved,
  onClose,
  initialHostId: requestedHostId,
  initialRootPath,
  initialTitle,
  autoAddInitial = false,
}: {
  readonly open?: boolean;
  readonly embedded?: boolean;
  readonly onBack?: (() => void) | undefined;
  readonly initialHostId?: EnvironmentId | undefined;
  readonly initialRootPath?: string | undefined;
  readonly initialTitle?: string | undefined;
  readonly autoAddInitial?: boolean;
  readonly onSaved: (project: LibraryProject, copy?: LibraryWorkingCopy) => void;
  readonly onClose: () => void;
}) {
  // Archived projects tell a folder's archived owner apart from one the Library no longer has.
  const library = useLibraryProjects(true);
  const [authorityId, pinAuthority] = useState(library.authorityId);
  if (!authorityId && library.authorityId) pinAuthority(library.authorityId);
  const correctAuthority = authorityId !== null && library.authorityId === authorityId;
  const authorityIdentity = useEnvironmentSessionState(authorityId).data?.identity;
  const [attempt, storeAttempt, unreadable] = useLibraryAttempt(
    `loom:library:import:${authorityId}`,
    ImportAttempt,
  );
  const primaryId = usePrimaryEnvironmentId();
  const executionHosts = library.environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.supportsExecution !== false,
  );
  // An entry point can name the Library itself, which runs no work and so holds no folders.
  const initialHostId = library.environments.some(
    (entry) =>
      entry.environmentId === requestedHostId &&
      entry.serverConfig?.environment.capabilities.supportsExecution === false,
  )
    ? undefined
    : requestedHostId;
  const connectedHosts = executionHosts.filter(
    (entry) => entry.entry.enabled && entry.connection.phase === "connected",
  );
  const defaultHostId =
    connectedHosts.length === 1
      ? connectedHosts[0]!.environmentId
      : (connectedHosts.find((entry) => entry.environmentId === primaryId)?.environmentId ?? null);
  // The saved import this dialog presents, by its request. Opening for another folder or computer
  // only offers it, so an import that keeps failing never takes over adding a different folder.
  const [resumed, setResumed] = useState(() =>
    attempt &&
    (!initialRootPath || initialRootPath === attempt.rootPath) &&
    (!initialHostId || initialHostId === attempt.environmentId)
      ? attempt.registerRequestId
      : null,
  );
  const attempts = attempt ? [attempt, ...(attempt.previous ?? [])] : [];
  const saved = attempts.find((entry) => entry.registerRequestId === resumed) ?? null;
  const saveAttempt = useStableCallback(
    (
      value: typeof ImportRequest.Type | null,
      onlyIf?: (latest: typeof ImportRequest.Type | null) => boolean,
    ) => {
      const requestId = value?.registerRequestId ?? saved?.registerRequestId;
      const latest = onlyIf
        ? (attempts.find((entry) => onlyIf(entry)) ?? null)
        : (attempts.find((entry) => entry.registerRequestId === requestId) ?? null);
      if (onlyIf && !onlyIf(latest)) return;
      const previous = attempts.filter(
        (entry) =>
          entry.registerRequestId !== (value?.registerRequestId ?? latest?.registerRequestId),
      );
      storeAttempt(
        value
          ? { ...value, previous }
          : previous[0]
            ? { ...previous[0], previous: previous.slice(1) }
            : null,
      );
    },
  );
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    saved?.environmentId ?? initialHostId ?? defaultHostId,
  );
  const identity = useEnvironmentSessionState(hostId).data?.identity;
  const accountMatches =
    (!saved?.initiator ||
      (saved.initiator.issuer === identity?.issuer &&
        saved.initiator.subject === identity?.subject)) &&
    (!saved?.authorityInitiator ||
      (saved.authorityInitiator.issuer === authorityIdentity?.issuer &&
        saved.authorityInitiator.subject === authorityIdentity?.subject));
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prevents a late import reply from continuing after this dialog closes
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = useStableCallback(
    () => mounted.current && open && correctAuthority && accountMatches,
  );
  const submitting = useRef(false);
  const [page, setPage] = useState<
    "computers" | "folders" | "project" | "choose-project" | "name" | "brief"
  >(
    saved || initialRootPath ? "project" : defaultHostId || initialHostId ? "folders" : "computers",
  );
  const [search, setSearch] = useState("");
  const [rootPath, setRootPath] = useState(saved?.rootPath ?? initialRootPath ?? "");
  const [title, setTitle] = useState(saved?.createInput?.title ?? initialTitle ?? "");
  const [brief, setBrief] = useState(saved?.createInput?.brief ?? "");
  const [projectId, setProjectId] = useState(
    saved?.project?.id ?? (saved?.createInput ? "new" : "choose"),
  );
  const [inspection, setInspection] = useState<LibraryFolderInspection | null>(null);
  // Repository roots are checked as they are browsed, so their row can name the project they
  // join. Other folders can hold many repositories and wait for Enter, as checks are costly.
  const [lookups, setLookups] = useState<ReadonlyMap<string, LibraryFolderInspection>>(
    () => new Map(),
  );
  const looking = useRef(new Set<string>());
  const [browsed, setBrowsed] = useState<LibraryBrowsedFolder | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [chooseFrom, setChooseFrom] = useState<"project" | "folders">("project");
  // A project this dialog, or a saved import from an earlier visit, created for a folder. A
  // failure can clear the import and Start over drops it, so adding that folder again must join
  // this project rather than create another.
  const [created, setCreated] = useState<{
    readonly environmentId: EnvironmentId;
    readonly rootPath: string;
    readonly project: LibraryProject;
  } | null>(() =>
    attempt?.createInput && attempt.project
      ? {
          environmentId: attempt.environmentId,
          rootPath: attempt.rootPath,
          project: attempt.project,
        }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recover = useAtomQueryRunner(projectLibrary.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const readCopies = useAtomQueryRunner(projectLibrary.copies, {
    refresh: true,
    reportFailure: false,
  });
  // The copies read with the last folder check. Rows use them once read, so a row never names a
  // different action than Enter resolves to with the same data.
  const [registeredCopies, setRegisteredCopies] = useState<readonly LibraryWorkingCopy[] | null>(
    null,
  );
  const libraryCopies = useEnvironmentQuery(
    open && page === "folders" && library.authorityId
      ? projectLibrary.copies({ environmentId: library.authorityId, input: {} })
      : null,
  );
  const matchingProjects = (
    inspection: LibraryFolderInspection,
    copies: readonly LibraryWorkingCopy[],
  ) => {
    const exact = libraryStartFolderProjects(
      library.query.data ?? [],
      copies,
      hostId ?? "",
      inspection.rootPath,
    );
    return exact.length ? exact : folderProjectMatches(library.query.data ?? [], inspection);
  };
  const [error, setError] = useState<string | null>(null);
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
  const inspect = useAtomCommand(projectLibrary.inspectFolder, { reportFailure: false });
  const lookup = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const prepare = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const canLookup = useLibraryPermission(
    projectLibrary.operationOutcome,
    saved?.project ? saved.environmentId : authorityId,
  );
  const checkingSaved =
    saved !== null &&
    ((!saved.project && saved.creation !== "ready") ||
      (saved.project && !saved.copy && saved.preparation !== "ready") ||
      (saved.copy?.state === "ready" &&
        (saved.registration === undefined ||
          saved.registration === "unknown" ||
          saved.registration === "succeeded")));
  const canInspect = useLibraryPermission(projectLibrary.inspectFolder, hostId);
  const canPrepare = useLibraryPermission(projectLibrary.prepareCopy, hostId);
  const canCreate = useLibraryPermission(projectLibrary.createProject, library.authorityId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, library.authorityId);
  const host = library.environments.find((entry) => entry.environmentId === hostId);
  const hostBlock = useAccessBlock(hostId, [projectLibrary.prepareCopy]);
  const registerBlock = useLibraryAccessBlock(library.authorityId, [projectLibrary.registerCopy]);
  const createBlock = useLibraryAccessBlock(library.authorityId, [
    projectLibrary.registerCopy,
    projectLibrary.createProject,
  ]);
  const libraryBlock = projectId === "new" ? createBlock : registerBlock;
  const canAdd = (creating: boolean) =>
    canPrepare &&
    canRegister &&
    (!creating || canCreate) &&
    library.connected &&
    host?.connection.phase === "connected";
  const blockFor = (creating: boolean) =>
    canAdd(creating) ? null : (hostBlock ?? (creating ? createBlock : registerBlock));
  const issueFor = (holder: LibraryFolderOwner | null, id: string) =>
    saved
      ? null
      : holder?.kind === "unchecked" && library.query.isPending
        ? "Checking which project owns this folder..."
        : libraryFolderOwnerIssue(holder, id === "choose" ? null : id);
  // A project created moments ago may not be listed yet. One archived since, which a saved import
  // from an earlier visit can name, takes no folders.
  const findProject = (id: string) => {
    const listed = library.query.data?.find((project) => project.id === id);
    if (listed) return listed.archived ? undefined : listed;
    return created?.project.id === id ? created.project : undefined;
  };
  /** What adding a folder does, from its check when there is one and its path otherwise. */
  const folderTarget = (
    path: string,
    report: LibraryFolderInspection | null,
    copies: readonly LibraryWorkingCopy[],
  ) => {
    const folderPath = report?.rootPath ?? path;
    const owner = libraryFolderOwner(libraryFolderRegistrations(report), library.query.data);
    const action = libraryFolderAction({
      rootPath: folderPath,
      owner,
      created:
        created?.environmentId === hostId && created.rootPath === folderPath
          ? (findProject(created.project.id) ?? null)
          : null,
      matches: report
        ? matchingProjects(report, copies)
        : libraryStartFolderProjects(library.query.data ?? [], copies, hostId ?? "", folderPath),
    });
    const id =
      action.kind === "add" ? action.project.id : action.kind === "create" ? "new" : "choose";
    return {
      report,
      owner,
      action,
      projectId: id,
      title: libraryFolderTitle(folderPath),
      issue: issueFor(owner, id),
    };
  };
  /**
   * Whether the folder may join a project of the user's choice. A current holder keeps its folder
   * and a refusal applies to every project, so neither offers another one.
   */
  const choosable = (target: ReturnType<typeof folderTarget>) =>
    target.report?.exists !== false && target.owner?.kind !== "current" && target.issue === null;
  const inspectFolder = async (path = rootPath) => {
    if (!hostId || !path.trim()) return null;
    setBusy(true);
    setError(null);
    const result = await inspect({ environmentId: hostId, input: { rootPath: path.trim() } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not check this folder.");
      setBusy(false);
      return null;
    }
    const report = result.value;
    setInspection(report);
    setLookups((previous) => new Map(previous).set(lookupKey(hostId, path), report));
    if (!report.exists)
      setError("This folder no longer exists on this computer. Choose another folder.");
    const copies = library.authorityId
      ? await readCopies({ environmentId: library.authorityId, input: {} })
      : null;
    if (!copies || copies._tag === "Failure") {
      setError(ASSOCIATIONS_UNCHECKED);
      setProjectId("choose");
      setBusy(false);
      return null;
    }
    setRegisteredCopies(copies.value);
    const target = folderTarget(path, report, copies.value);
    setProjectId(target.projectId);
    if (!title) setTitle(target.title);
    setBusy(false);
    return target;
  };
  const lookUpFolder = async (folder: LibraryBrowsedFolder | null) => {
    setBrowsed(folder);
    if (!folder?.repository || !hostId || !canInspect) return;
    const key = lookupKey(hostId, folder.path);
    if (lookups.has(key) || looking.current.has(key)) return;
    looking.current.add(key);
    const result = await inspect({ environmentId: hostId, input: { rootPath: folder.path } });
    looking.current.delete(key);
    // A failed look-up only leaves the row naming its best guess; Enter checks again and reports.
    if (result._tag === "Success")
      setLookups((previous) => new Map(previous).set(key, result.value));
  };
  const matches = inspection ? matchingProjects(inspection, registeredCopies ?? []) : [];
  const owner = libraryFolderOwner(libraryFolderRegistrations(inspection), library.query.data);
  const ownerIssue = issueFor(owner, projectId);
  /** Add a checked folder to a project, creating it first for "new". True once it is saved. */
  const submit = async (target: {
    readonly projectId: string;
    readonly title: string;
    readonly inspection: LibraryFolderInspection | null;
  }) => {
    const { inspection } = target;
    const holder = libraryFolderOwner(libraryFolderRegistrations(inspection), library.query.data);
    if (
      unreadable ||
      !hostId ||
      !authorityId ||
      !correctAuthority ||
      !accountMatches ||
      busy ||
      submitting.current ||
      issueFor(holder, target.projectId) ||
      (!saved && !inspection?.exists)
    )
      return false;
    const retry =
      saved ??
      attempts.find(
        (entry) =>
          entry.environmentId === hostId &&
          entry.rootPath === inspection?.rootPath &&
          (entry.project?.id === target.projectId ||
            (!entry.project && target.projectId === "new")),
      ) ??
      null;
    const existing = findProject(target.projectId);
    if (!saved && target.projectId !== "new" && !existing) return false;
    const title = target.title.trim();
    submitting.current = true;
    setBusy(true);
    setError(null);
    let submitted = retry;
    let finished = false;
    let requestEnvironmentId = authorityId;
    setAccessRepair(undefined);
    const importFolder = async () => {
      let next: typeof ImportRequest.Type = retry ?? {
        authorityId,
        ...(identity ? { initiator: identity } : {}),
        ...(authorityIdentity ? { authorityInitiator: authorityIdentity } : {}),
        environmentId: hostId,
        rootPath: inspection!.rootPath,
        createInput: existing
          ? null
          : {
              requestId: randomUUID(),
              title,
              brief,
              resources: inspection!.repositories.map((repository) => ({
                id: randomUUID(),
                kind: "repository" as const,
                title: repository.relativePath === "." ? title : repository.relativePath,
                remoteUrl:
                  repository.remoteUrl?.startsWith("file:") || repository.remoteUrl?.startsWith("/")
                    ? null
                    : repository.remoteUrl,
                relativePath: repository.relativePath,
                defaultBranch: null,
              })),
            },
        project: existing ?? null,
        prepareRequestId: randomUUID(),
        registerRequestId: randomUUID(),
        copy: null,
      };
      saveAttempt(next);
      setResumed(next.registerRequestId);
      submitted = next;
      if (!next.project) {
        if (!next.createInput) throw new Error("Choose a project before importing.");
        if (retry && next.creation !== "ready") {
          const receipt = await lookup({
            environmentId: authorityId,
            input: { requestId: next.createInput.requestId, kind: "create" },
          });
          if (receipt._tag === "Failure") throw squashAtomCommandFailure(receipt);
          const operation = receipt.value;
          if (operation && (operation.kind !== "create" || operation.environmentId !== authorityId))
            throw new Error("The creation receipt belongs to another request or Library.");
          if (
            operation?.state === "queued" ||
            operation?.state === "running" ||
            operation?.state === "cancelled"
          )
            throw new Error(
              "This project request is running or cancelled. Review its saved result before continuing.",
            );
          if (operation?.state === "succeeded") {
            if (!isProject(operation.result))
              throw new Error("The creation receipt does not contain this project.");
            next = { ...next, project: operation.result };
            setCreated({
              environmentId: next.environmentId,
              rootPath: next.rootPath,
              project: operation.result,
            });
          } else next = { ...next, creation: "ready" };
          saveAttempt(next);
          setAccessRepair(operation?.accessRepair);
          setError(
            "The saved project request has been checked. Continue explicitly when you are ready.",
          );
          return;
        }
        const createInput = next.createInput;
        next = { ...next, creation: "unknown" };
        submitted = next;
        saveAttempt(next);
        const result = await create({
          environmentId: authorityId,
          input: createInput,
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        next = { ...next, project: result.value };
        setCreated({
          environmentId: next.environmentId,
          rootPath: next.rootPath,
          project: result.value,
        });
        saveAttempt(next);
        submitted = next;
      }
      if (!active()) return;
      if (!next.copy || next.copy.state !== "ready") {
        if (retry && next.preparation !== "ready") {
          const receipt = await lookup({
            environmentId: next.environmentId,
            input: { requestId: next.prepareRequestId, kind: "prepare" },
          });
          if (receipt._tag === "Failure") throw squashAtomCommandFailure(receipt);
          const operation = receipt.value;
          if (
            operation &&
            (operation.kind !== "prepare" ||
              operation.environmentId !== next.environmentId ||
              operation.projectId !== next.project!.id)
          )
            throw new Error("The preparation receipt belongs to another project or computer.");
          if (
            operation?.state === "queued" ||
            operation?.state === "running" ||
            operation?.state === "cancelled"
          )
            throw new Error(
              "This preparation is running or cancelled. Review its saved result before continuing.",
            );
          if (operation?.state === "succeeded") {
            const copy = operation.result;
            if (
              !isCopy(copy) ||
              copy.projectId !== next.project!.id ||
              copy.environmentId !== next.environmentId ||
              copy.rootPath !== next.rootPath ||
              copy.state !== "ready"
            )
              throw new Error("The preparation receipt does not match the saved folder.");
            next = { ...next, copy };
          } else next = { ...next, preparation: "ready" };
          saveAttempt(next);
          setAccessRepair(operation?.accessRepair);
          setError(
            "The saved preparation has been checked. Continue explicitly when you are ready.",
          );
          return;
        }
        next = { ...next, preparation: "unknown" };
        submitted = next;
        saveAttempt(next);
        requestEnvironmentId = next.environmentId;
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
      if (!active()) return;
      requestEnvironmentId = authorityId;
      if (next.registration === "succeeded") {
        saveAttempt(null);
        finished = true;
        onSaved(next.project!, next.copy!);
        return;
      }
      if (
        next.registration === "unknown" ||
        (retry && next.registration === undefined && retry.copy?.state === "ready")
      ) {
        const result = await readCopies({
          environmentId: authorityId,
          input: { projectId: next.project!.id },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        const copy = result.value.find((entry) => entry.id === next.copy!.id);
        if (
          copy &&
          (copy.environmentId !== next.environmentId ||
            copy.projectId !== next.project!.id ||
            copy.rootPath !== next.rootPath ||
            copy.state !== "ready" ||
            copy.registered === false)
        )
          throw new Error("The registered folder does not match this saved import.");
        saveAttempt({ ...next, registration: copy ? "succeeded" : "ready" });
        setError(
          "The saved folder registration has been checked. Continue explicitly when you are ready.",
        );
        return;
      }
      next = { ...next, registration: "unknown" };
      submitted = next;
      saveAttempt(next);
      const result = await register({
        environmentId: authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (active()) {
        saveAttempt(null, (latest) => latest?.registerRequestId === next.registerRequestId);
        finished = true;
        onSaved(next.project!, result.value);
      } else saveAttempt({ ...next, copy: result.value, registration: "succeeded" });
    };
    try {
      await importFolder();
    } catch (cause) {
      setAccessRepair(libraryAccessRepairFromFailure(cause, requestEnvironmentId));
      const handleFailure = async () => {
        if (submitted?.project) {
          const receipt = await recover({
            environmentId: submitted.environmentId,
            input: { requestId: submitted.prepareRequestId },
          });
          if (receipt._tag === "Success") {
            if (receipt.value) saveAttempt({ ...submitted, copy: receipt.value });
          }
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not register this folder. Retry the same import.",
        );
      };
      await handleFailure().finally(() => {
        submitting.current = false;
        setBusy(false);
      });
      return false;
    }
    submitting.current = false;
    setBusy(false);
    return finished;
  };
  const inspectedInitial = useRef(false);
  const autoAdd = useRef(autoAddInitial && correctAuthority && library.connected && canAdd(false));
  const inspectInitial = useEffectEvent(async () => {
    const target = await inspectFolder();
    if (
      !autoAdd.current ||
      !target?.report?.exists ||
      target.action.kind === "choose" ||
      target.issue ||
      !canAdd(target.action.kind === "create")
    )
      return;
    setProgress("Adding folder...");
    await submit({ ...target, inspection: target.report });
    setProgress(null);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- inspects the initial folder once its host connects and the library query loads
  useEffect(() => {
    if (
      !inspectedInitial.current &&
      open &&
      initialRootPath &&
      hostId &&
      canInspect &&
      host?.connection.phase === "connected" &&
      !library.query.isPending &&
      !saved
    ) {
      inspectedInitial.current = true;
      inspectInitial();
    }
  }, [
    open,
    initialRootPath,
    hostId,
    canInspect,
    host?.connection.phase,
    library.query.isPending,
    saved,
  ]);
  const openChoice = (from: "project" | "folders") => {
    setChooseFrom(from);
    setSearch("");
    setPage("choose-project");
  };
  /**
   * Run the action a browser row named. A fresh check that resolves differently, or that takes the
   * folder from an archived project the row did not mention, only updates the row, so Enter never
   * does something the row did not say.
   */
  const addFolder = async (
    path: string,
    shown: LibraryFolderAction,
    shownTakeover: string | null,
  ) => {
    setRootPath(path);
    setInspection(null);
    setProgress("Checking this folder...");
    const target = await inspectFolder(path);
    setProgress(null);
    if (
      !target?.report?.exists ||
      !sameLibraryFolderAction(target.action, shown) ||
      libraryFolderTakeover(target.owner) !== shownTakeover
    )
      return;
    setTitle(target.title);
    if (target.action.kind === "choose") return openChoice("folders");
    if (target.issue || !canAdd(target.action.kind === "create")) return;
    setProgress("Adding folder...");
    const added = await submit({ ...target, inspection: target.report });
    setProgress(null);
    if (!added) {
      setSearch("");
      setPage("project");
    }
  };
  const chooseProjectFor = async (path: string) => {
    setRootPath(path);
    setInspection(null);
    setProgress("Checking this folder...");
    const target = await inspectFolder(path);
    setProgress(null);
    // A fresh check can show the folder held or refused, which only updates the rows.
    if (!target || !choosable(target)) return;
    setTitle(target.title);
    openChoice("folders");
  };
  const resume = (next: NonNullable<typeof attempt>) => {
    setResumed(next.registerRequestId);
    setHostId(next.environmentId);
    setRootPath(next.rootPath);
    setTitle(next.createInput?.title ?? "");
    setBrief(next.createInput?.brief ?? "");
    setProjectId(next.project?.id ?? (next.createInput ? "new" : "choose"));
    setInspection(null);
    setError(null);
    setSearch("");
    setPage("project");
  };
  /**
   * Forget the saved request and browse its folder again. The computer may still finish it, and a
   * project it created stays in `created`, so the folder's row joins that project and reuses files
   * already prepared there instead of creating another.
   */
  const startOver = async () => {
    if (!saved || busy || !active()) return;
    setBusy(true);
    const clear = async () => {
      const requestId = saved.project ? saved.prepareRequestId : saved.createInput?.requestId;
      if (!requestId) throw new Error("Keep this saved import for recovery.");
      const result = await lookup({
        environmentId: saved.project ? saved.environmentId : authorityId!,
        input: { requestId, kind: saved.project ? "prepare" : "create" },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (result.value !== null || saved.copy)
        throw new Error(
          "This import was already accepted. Continue it with its original details before starting another.",
        );
      if (!active()) return;
      saveAttempt(null, (latest) => latest?.registerRequestId === saved.registerRequestId);
      setResumed(null);
      setError(null);
      setSearch("");
      setPage("folders");
    };
    await clear().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not check this import."),
    );
    setBusy(false);
  };
  const savedPlace = (unfinished: NonNullable<typeof attempt>) => {
    const computer =
      library.environments.find((entry) => entry.environmentId === unfinished.environmentId)
        ?.label ?? "another computer";
    const target = unfinished.project
      ? unfinished.project.title
      : `a new project named ${unfinished.createInput?.title ?? libraryFolderTitle(unfinished.rootPath)}`;
    return `Adds ${unfinished.rootPath} on ${computer} to ${target}.`;
  };
  const savedOffer: LibraryPaletteItem[] = attempts
    .filter((entry) => entry.registerRequestId !== saved?.registerRequestId)
    .map((entry) => ({
      id: `saved-import:${entry.registerRequestId}`,
      title: "Retry earlier import",
      description: savedPlace(entry),
      icon: <RotateCcwIcon className="size-4" />,
      next: true,
      select: () => resume(entry),
    }));
  const reviewCleanup = async () => {
    if (!saved?.copy || !authorityId || !correctAuthority || !accountMatches || busy) return;
    setBusy(true);
    setError(null);
    const result = await register({
      environmentId: authorityId,
      input: {
        requestId: `${saved.registerRequestId}:failed:${saved.copy.updatedAt}`,
        copy: saved.copy,
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
  if (cleaning && saved?.copy && saved.project && correctAuthority)
    return (
      <ReleaseCopyDialog
        copy={saved.copy}
        onClose={() => setCleaning(false)}
        onReleased={() => {
          saveAttempt(null);
          setCleaning(false);
          onSaved(saved.project!);
        }}
      />
    );
  if (!open) return null;
  const locked = saved !== null;
  const selectedProject = findProject(projectId);
  const canImport =
    !unreadable &&
    correctAuthority &&
    accountMatches &&
    (checkingSaved ? canLookup : canAdd(projectId === "new")) &&
    !ownerIssue &&
    (!!saved ||
      (!!inspection?.exists && projectId !== "choose" && (projectId !== "new" || !!title.trim())));
  const accessIssue = canImport ? null : (hostBlock ?? libraryBlock);
  const formIssue = saved
    ? null
    : !inspection
      ? busy
        ? "Checking this folder..."
        : "Choose a folder first."
      : !inspection.exists
        ? "This folder no longer exists on this computer. Choose another folder."
        : (ownerIssue ??
          (projectId === "choose"
            ? "Choose which project this folder belongs to."
            : projectId === "new" && !title.trim()
              ? "Name the project first."
              : null));
  const repositories = inspection?.repositories ?? [];
  const importDescription = canImport
    ? saved
      ? savedPlace(saved)
      : (libraryFolderTakeover(owner) ??
        (selectedProject
          ? "Use the existing Library project"
          : repositories.length > 1
            ? `One Library project for ${repositories.length} repositories: ${repositories.map((repository) => repository.relativePath).join(", ")}`
            : "Create a Library project for these files"))
    : accessIssue?.repair
      ? "Restore access above to add this folder."
      : (accessIssue?.message ?? formIssue ?? "Checking this device's access...");
  const folderActions = (folder: LibraryBrowsedFolder | null): LibraryPaletteItem[] => {
    const icon = <FolderPlusIcon className="size-4" />;
    const copies = registeredCopies ?? libraryCopies.data;
    // Without the Library's projects and folder associations a row could only guess, and Enter
    // would create a project that may already exist. A refresh keeps the last answer.
    const unknown = !library.authorityId
      ? null
      : !library.query.data
        ? (library.query.error ?? "Loading your Library projects...")
        : !copies
          ? libraryCopies.error
            ? ASSOCIATIONS_UNCHECKED
            : "Loading your Library projects..."
          : null;
    if (!folder || unknown)
      return [
        {
          id: "add-folder",
          title: "Add this folder",
          description: folder && unknown ? unknown : undefined,
          icon,
          disabled: true,
          select: () => {},
        },
        ...savedOffer,
      ];
    const report = hostId ? (lookups.get(lookupKey(hostId, folder.path)) ?? null) : null;
    const target = folderTarget(folder.path, report, copies ?? []);
    const { action } = target;
    const creating = action.kind === "create";
    const block = blockFor(creating);
    const folders = report?.repositories ?? [];
    const description = () => {
      if (report?.exists === false)
        return "This folder no longer exists on this computer. Choose another folder.";
      if (target.issue) return target.issue;
      if (block) return block.repair ? "Restore access above to add this folder." : block.message;
      if (!canAdd(creating)) return "Checking this device's access...";
      if (action.kind === "choose") return "Several Library projects match these files.";
      const takeover = libraryFolderTakeover(target.owner);
      if (takeover) return takeover;
      if (action.kind === "add")
        return `Uses your Library project ${action.project.title}. Files stay here.`;
      return folders.length > 1
        ? `One new Library project for ${folders.length} repositories: ${folders.map((repository) => repository.relativePath).join(", ")}. Files stay here.`
        : "A new Library project for these files. Files stay here.";
    };
    const others = (library.query.data ?? []).filter(
      (project) => !project.archived && (action.kind !== "add" || project.id !== action.project.id),
    );
    return [
      {
        id: "add-folder",
        title:
          progress ??
          (action.kind === "add"
            ? `Add to ${action.project.title}`
            : action.kind === "create"
              ? `Create project ${action.title}`
              : "Choose a project for this folder"),
        description: description(),
        icon,
        next: action.kind === "choose",
        disabled: report?.exists === false || target.issue !== null || !canAdd(creating),
        select: () => void addFolder(folder.path, action, libraryFolderTakeover(target.owner)),
      },
      ...(action.kind !== "choose" && choosable(target) && others.length > 0
        ? [
            {
              id: "add-to-another",
              title: "Add to another project...",
              icon: <FolderInputIcon className="size-4" />,
              next: true,
              disabled: !canAdd(false),
              select: () => void chooseProjectFor(folder.path),
            },
          ]
        : []),
      ...savedOffer,
    ];
  };
  const browsedBlock =
    page === "folders" && browsed
      ? blockFor(
          folderTarget(
            browsed.path,
            hostId ? (lookups.get(lookupKey(hostId, browsed.path)) ?? null) : null,
            registeredCopies ?? libraryCopies.data ?? [],
          ).action.kind === "create",
        )
      : null;
  const back = () => {
    setSearch("");
    if (page === "choose-project") setPage(chooseFrom);
    else if (page === "name" || page === "brief") setPage("project");
    else if (page === "project") {
      // Browsing adds the browsed folder; the saved import stays offered there.
      setResumed(null);
      setPage("folders");
    } else if (page === "folders") setPage("computers");
    else onBack?.();
  };
  const close = () => {
    if (!busy) onClose();
  };
  const content =
    page === "brief" ? (
      <LibraryTextPalette
        title="Project brief"
        value={brief}
        onChange={setBrief}
        onBack={back}
        onClose={close}
      />
    ) : page === "folders" &&
      hostId &&
      host &&
      host.entry.enabled &&
      host.connection.phase === "connected" ? (
      <LibraryFolderPalette
        key={hostId}
        environmentId={hostId}
        computerName={host.label}
        initialPath={rootPath || "~/"}
        onBack={back}
        onClose={close}
        busy={busy}
        error={
          error ??
          (unreadable
            ? "The saved import could not be read. Keep it for recovery before importing another folder."
            : null)
        }
        accessRepair={accessRepair}
        actions={folderActions}
        onFolderChange={(folder) => void lookUpFolder(folder)}
      >
        {browsedBlock?.repair ? (
          <div className="px-4 py-2">
            <LibraryAccessNotice block={browsedBlock} onLeave={onClose} />
          </div>
        ) : null}
      </LibraryFolderPalette>
    ) : (
      <LibraryPaletteView
        key={page}
        title={
          page === "computers" || page === "folders"
            ? "Choose a computer"
            : page === "choose-project"
              ? "Choose a project for this folder"
              : page === "name"
                ? "Project name"
                : "Add existing folder"
        }
        placeholder={
          page === "computers" || page === "folders"
            ? "Search computers..."
            : page === "choose-project"
              ? "Search projects..."
              : page === "name"
                ? "Name your project..."
                : "Search folder actions..."
        }
        query={page === "name" ? title : search}
        onQueryChange={page === "name" ? setTitle : setSearch}
        onBack={page !== "computers" || onBack ? back : undefined}
        onClose={close}
        busy={busy}
        filter={page !== "name"}
        error={error ?? library.query.error}
        accessRepair={accessRepair}
        accessContext={{
          environmentId: hostId,
          authorityEnvironmentId: authorityId,
          computerLabel: host?.label,
        }}
        message={
          progress ??
          (saved
            ? "This import did not finish. Retry it, or start over to choose the folder again."
            : inspection
              ? `${inspection.rootPath} on ${host?.label ?? "the selected computer"}. Your files stay here.`
              : initialRootPath
                ? "Checking this folder..."
                : "Choose the computer whose folders you want to browse.")
        }
        items={
          page === "computers" || page === "folders"
            ? executionHosts.map((entry) => ({
                id: entry.environmentId,
                title: entry.label,
                description:
                  entry.connection.phase === "connected"
                    ? "Browse folders on this computer"
                    : "Reconnect this computer first",
                disabled: !entry.entry.enabled || entry.connection.phase !== "connected",
                next: true,
                icon: <MonitorIcon className="size-4" />,
                select: () => {
                  setHostId(entry.environmentId);
                  setInspection(null);
                  setSearch("");
                  setPage("folders");
                },
              }))
            : page === "choose-project"
              ? [
                  {
                    id: "new",
                    title: "Create a new project",
                    next: true,
                    select: () => {
                      setProjectId("new");
                      setPage("name");
                    },
                  },
                  ...(library.query.data ?? [])
                    .filter((project) => !project.archived)
                    .map((project) => ({
                      id: project.id,
                      title: project.title,
                      description: owner?.holders.some(
                        (holder) => holder.kind === "current" && holder.project.id === project.id,
                      )
                        ? "This folder already belongs to this project"
                        : matches.some((match) => match.id === project.id)
                          ? "Matching repositories and folder layout"
                          : project.brief,
                      select: () => {
                        setProjectId(project.id);
                        setSearch("");
                        // From the folder browser a project with nothing to confirm is added
                        // right away. The confirmation page explains anything that stops it and
                        // names a takeover from an archived project, which no row here mentions.
                        if (
                          chooseFrom === "folders" &&
                          issueFor(owner, project.id) === null &&
                          libraryFolderTakeover(owner) === null &&
                          canAdd(false)
                        ) {
                          setProgress("Adding folder...");
                          void submit({ projectId: project.id, title, inspection }).then(
                            (added) => {
                              setProgress(null);
                              if (!added) setPage("project");
                            },
                          );
                        } else setPage("project");
                      },
                    })),
                ]
              : page === "name"
                ? [
                    {
                      id: "keep",
                      title: "Keep this name",
                      disabled: !title.trim(),
                      select: () => setPage("project"),
                    },
                  ]
                : [
                    {
                      id: "import",
                      title: saved
                        ? "Retry import"
                        : `Add folder to ${selectedProject?.title ?? (title || "a project")}`,
                      description: importDescription,
                      disabled: !canImport,
                      icon: <FolderPlusIcon className="size-4" />,
                      select: () => void submit({ projectId, title, inspection }),
                    },
                    ...(saved
                      ? [
                          {
                            id: "start-over",
                            title: "Start over",
                            description:
                              "Forget this import and choose the folder again. A project it already created stays in your Library.",
                            icon: <RotateCcwIcon className="size-4 text-muted-foreground" />,
                            select: startOver,
                          },
                        ]
                      : []),
                    ...(!inspection && rootPath && !saved
                      ? [
                          {
                            id: "inspect-again",
                            title: "Check this folder again",
                            disabled: !canInspect || host?.connection.phase !== "connected",
                            select: () => {
                              void inspectFolder();
                            },
                          },
                        ]
                      : []),
                    {
                      id: "project",
                      title: "Project",
                      description:
                        selectedProject?.title ??
                        (projectId === "new" ? `New project: ${title}` : "Choose a project"),
                      next: true,
                      disabled: locked,
                      select: () => openChoice("project"),
                    },
                    ...(projectId === "new"
                      ? [
                          {
                            id: "name",
                            title: "Project name",
                            description: title,
                            next: true,
                            disabled: locked,
                            select: () => setPage("name"),
                          },
                          {
                            id: "brief",
                            title: "Project brief",
                            description: brief || "Optional",
                            next: true,
                            disabled: locked,
                            select: () => setPage("brief"),
                          },
                        ]
                      : []),
                    ...(saved?.copy?.state === "failed"
                      ? [
                          {
                            id: "review",
                            title: "Review failed copy",
                            disabled:
                              !correctAuthority ||
                              !accountMatches ||
                              !canRegister ||
                              !library.connected,
                            select: () => void reviewCleanup(),
                          },
                        ]
                      : []),
                    ...savedOffer,
                  ]
        }
      >
        {!correctAuthority || !accountMatches ? (
          <LibraryAccessRepairNotice
            accessRepair={{
              kind: !accountMatches ? "ownership" : "connection",
              ...(authorityId ? { environmentId: authorityId } : {}),
            }}
            context={{ environmentId: authorityId, originalAccount: saved?.authorityInitiator }}
          />
        ) : null}
        {page === "project" && accessIssue?.repair ? (
          <div className="px-4 py-2">
            <LibraryAccessNotice block={accessIssue} onLeave={onClose} />
          </div>
        ) : null}
      </LibraryPaletteView>
    );
  return embedded ? (
    content
  ) : (
    <LibraryPaletteDialog title="Add existing folder" onClose={close}>
      {content}
    </LibraryPaletteDialog>
  );
}
