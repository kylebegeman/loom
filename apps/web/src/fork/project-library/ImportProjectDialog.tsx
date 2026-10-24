import { LibraryTextPalette } from "./LibraryTextPalette";
import { LibraryPaletteDialog, LibraryPaletteView } from "./LibraryPalette";
import { LibraryFolderPalette } from "./LibraryFolderPalette";
import { MonitorIcon, FolderPlusIcon, KeyRoundIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { randomUUID } from "~/lib/utils";
import { useEffect, useEffectEvent, useRef, useState } from "react";
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

import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAttempt } from "./attempts";

import { usePrimaryEnvironmentId } from "~/state/environments";
import { libraryStartFolderProjects } from "@t3tools/client-runtime/fork";
import { folderProjectMatches } from "./folderProjectMatches";

import { projectLibrary, useAccessBlock, useLibraryProjects, useLibraryPermission } from "./state";

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
  open = true,
  embedded = false,
  onBack,
  onSaved,
  onClose,
  initialHostId,
  initialRootPath,
  initialTitle,
}: {
  readonly open?: boolean;
  readonly embedded?: boolean;
  readonly onBack?: (() => void) | undefined;
  readonly initialHostId?: EnvironmentId | undefined;
  readonly initialRootPath?: string | undefined;
  readonly initialTitle?: string | undefined;
  readonly onSaved: (project: LibraryProject, copy?: LibraryWorkingCopy) => void;
  readonly onClose: () => void;
}) {
  const library = useLibraryProjects();
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:import:${library.authorityId}`,
    ImportAttempt,
  );
  const primaryId = usePrimaryEnvironmentId();
  const executionHosts = library.environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.supportsExecution !== false,
  );
  const connectedHosts = executionHosts.filter(
    (entry) => entry.entry.enabled && entry.connection.phase === "connected",
  );
  const defaultHostId =
    connectedHosts.length === 1
      ? connectedHosts[0]!.environmentId
      : (connectedHosts.find((entry) => entry.environmentId === primaryId)?.environmentId ?? null);
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? defaultHostId,
  );
  const [page, setPage] = useState<
    "computers" | "folders" | "project" | "choose-project" | "name" | "brief"
  >(
    attempt || initialRootPath
      ? "project"
      : defaultHostId || initialHostId
        ? "folders"
        : "computers",
  );
  const [search, setSearch] = useState("");
  const [rootPath, setRootPath] = useState(attempt?.rootPath ?? initialRootPath ?? "");
  const [title, setTitle] = useState(attempt?.createInput?.title ?? initialTitle ?? "");
  const [brief, setBrief] = useState(attempt?.createInput?.brief ?? "");
  const [projectId, setProjectId] = useState(attempt?.project?.id ?? "choose");
  const [inspection, setInspection] = useState<LibraryFolderInspection | null>(null);
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
  const [registeredCopies, setRegisteredCopies] = useState<readonly LibraryWorkingCopy[]>([]);
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
  const inspect = useAtomCommand(projectLibrary.inspectFolder, { reportFailure: false });
  const create = useAtomCommand(projectLibrary.createProject, { reportFailure: false });
  const prepare = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const canInspect = useLibraryPermission(projectLibrary.inspectFolder, hostId);
  const canPrepare = useLibraryPermission(projectLibrary.prepareCopy, hostId);
  const canCreate = useLibraryPermission(projectLibrary.createProject, library.authorityId);
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, library.authorityId);
  const host = library.environments.find((entry) => entry.environmentId === hostId);
  const hostBlock = useAccessBlock(hostId, [projectLibrary.prepareCopy]);
  const libraryBlock = useAccessBlock(
    library.authorityId,
    projectId === "new"
      ? [projectLibrary.registerCopy, projectLibrary.createProject]
      : [projectLibrary.registerCopy],
  );
  const navigate = useNavigate();
  const inspectFolder = async (path = rootPath) => {
    if (!hostId || !path.trim()) return;
    setBusy(true);
    setError(null);
    const result = await inspect({ environmentId: hostId, input: { rootPath: path.trim() } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not check this folder.");
    } else {
      setInspection(result.value);
      if (!result.value.exists)
        setError("This folder no longer exists on this computer. Choose another folder.");
      const copies = library.authorityId
        ? await readCopies({ environmentId: library.authorityId, input: {} })
        : null;
      if (!copies || copies._tag === "Failure") {
        setError(
          "Could not check the Library's existing folder associations. Reconnect it and check this folder again.",
        );
        setProjectId("choose");
        setBusy(false);
        return null;
      }
      setRegisteredCopies(copies.value);
      const matches = matchingProjects(result.value, copies.value);
      setProjectId(matches.length === 1 ? matches[0]!.id : matches.length > 1 ? "choose" : "new");
      if (!title)
        setTitle(
          result.value.rootPath
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .at(-1) ?? "Project",
        );
    }
    setBusy(false);
    return result._tag === "Success" ? result.value : null;
  };
  const inspectedInitial = useRef(false);
  const inspectInitial = useEffectEvent(() => {
    void inspectFolder();
  });
  useEffect(() => {
    if (
      !inspectedInitial.current &&
      open &&
      initialRootPath &&
      hostId &&
      canInspect &&
      host?.connection.phase === "connected" &&
      !library.query.isPending &&
      !attempt
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
    attempt,
  ]);
  const matches = inspection ? matchingProjects(inspection, registeredCopies) : [];
  const submit = async () => {
    const authorityId = library.authorityId;
    if (!hostId || !authorityId || busy || (!attempt && !inspection?.exists)) return;
    const existing = library.query.data?.find((project) => project.id === projectId);
    if (!attempt && projectId !== "new" && !existing) return;
    setBusy(true);
    setError(null);
    let submitted = attempt;
    const importFolder = async () => {
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
          environmentId: authorityId,
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
        environmentId: authorityId,
        input: { requestId: next.registerRequestId, copy: next.copy! },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      saveAttempt(null);
      onSaved(next.project!, result.value);
    };
    try {
      await importFolder();
    } catch (cause) {
      const handleFailure = async () => {
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
      };
      await handleFailure().finally(() => setBusy(false));
      return;
    }
    setBusy(false);
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
  if (!open) return null;
  const locked = attempt !== null;
  const selectedProject = library.query.data?.find((project) => project.id === projectId);
  const canImport =
    canPrepare &&
    canRegister &&
    (projectId !== "new" || canCreate) &&
    library.connected &&
    host?.connection.phase === "connected" &&
    (!!attempt ||
      (!!inspection?.exists && projectId !== "choose" && (projectId !== "new" || !!title.trim())));
  const accessIssue = canImport ? null : (hostBlock ?? libraryBlock);
  const formIssue = attempt
    ? null
    : !inspection
      ? busy
        ? "Checking this folder..."
        : "Choose a folder first."
      : !inspection.exists
        ? "This folder no longer exists on this computer. Choose another folder."
        : projectId === "choose"
          ? "Choose which project this folder belongs to."
          : projectId === "new" && !title.trim()
            ? "Name the project first."
            : null;
  const repositories = inspection?.repositories ?? [];
  const importDescription = canImport
    ? selectedProject
      ? "Use the existing Library project"
      : repositories.length > 1
        ? `One Library project for ${repositories.length} repositories: ${repositories.map((repository) => repository.relativePath).join(", ")}`
        : "Create a Library project for these files"
    : (accessIssue?.message ?? formIssue ?? "Checking this device's access...");
  const back = () => {
    setSearch("");
    if (page === "choose-project" || page === "name" || page === "brief") setPage("project");
    else if (page === "project") setPage("folders");
    else if (page === "folders") setPage("computers");
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
        error={error}
        onSelect={(path) => {
          setRootPath(path);
          setInspection(null);
          void inspectFolder(path).then((report) => {
            if (report?.exists) {
              setSearch("");
              setPage("project");
            }
          });
        }}
      />
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
        onBack={!locked && (page !== "computers" || onBack) ? back : undefined}
        onClose={close}
        busy={busy}
        readOnly={locked}
        filter={page !== "name"}
        error={error ?? library.query.error}
        message={
          attempt
            ? "An import is waiting for confirmation. Retry to finish the same import."
            : inspection
              ? `${inspection.rootPath} on ${host?.label ?? "the selected computer"}. Your files stay here.`
              : initialRootPath
                ? "Checking this folder..."
                : "Choose the computer whose folders you want to browse."
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
                      description: matches.some((match) => match.id === project.id)
                        ? "Matching repositories and folder layout"
                        : project.brief,
                      select: () => {
                        setProjectId(project.id);
                        setSearch("");
                        setPage("project");
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
                      title: attempt
                        ? "Retry import"
                        : `Add folder to ${selectedProject?.title ?? (title || "a project")}`,
                      description: importDescription,
                      disabled: !canImport,
                      icon: <FolderPlusIcon className="size-4" />,
                      select: () => void submit(),
                    },
                    ...(accessIssue?.repair
                      ? [
                          {
                            id: "repair-access",
                            title:
                              accessIssue.repair === "sign-in"
                                ? `Sign in to ${accessIssue.label} again`
                                : `Review ${accessIssue.label} connection`,
                            description: "Opens Settings > Connections",
                            next: true,
                            icon: <KeyRoundIcon className="size-4" />,
                            select: () => {
                              onClose();
                              void navigate({ to: "/settings/connections" });
                            },
                          },
                        ]
                      : []),
                    ...(!inspection && rootPath && !attempt
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
                      select: () => {
                        setSearch("");
                        setPage("choose-project");
                      },
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
                    {
                      id: "folder",
                      title: "Choose another folder",
                      description: inspection?.rootPath,
                      next: true,
                      disabled: locked,
                      select: () => setPage("folders"),
                    },
                    ...(attempt?.copy?.state === "failed"
                      ? [
                          {
                            id: "review",
                            title: "Review failed copy",
                            disabled: !canRegister || !library.connected,
                            select: () => void reviewCleanup(),
                          },
                        ]
                      : []),
                  ]
        }
      />
    );
  return embedded ? (
    content
  ) : (
    <LibraryPaletteDialog title="Add existing folder" onClose={close}>
      {content}
    </LibraryPaletteDialog>
  );
}
