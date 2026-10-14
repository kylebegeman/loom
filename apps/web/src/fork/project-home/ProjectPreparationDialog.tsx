import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Cause from "effect/Cause";
import {
  buildProjectPreparationPlan,
  matchingProjectPreparationCopies,
  getProjectPreparationDestination,
  getProjectPreparationRecovery,
  projectPreparationSource,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationReadScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type ScopedProjectRef,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import type { ProjectCheckoutPreview, WorkspaceHandoffOffer } from "@t3tools/contracts/fork";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { useEnvironment, useEnvironments } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { environmentShell } from "~/state/shell";
import * as Option from "effect/Option";
import { useEnvironmentProjectClones } from "~/state/projectClones";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { projectCheckouts, PROJECT_CHECKOUT_FEATURE } from "~/fork/project-checkout/state";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { useClientSettings } from "~/hooks/useSettings";
import { newProjectId } from "~/lib/utils";
import { readCurrentPreparationAttempt, useProjectPreparationAttempt } from "./preparationState";

const EMPTY_PREVIEW = Atom.make(AsyncResult.initial<ProjectCheckoutPreview>());
const EMPTY_CLONE_RESULT = Atom.make(AsyncResult.initial<readonly ProjectCloneSnapshot[]>());

export function ProjectPreparationDialog({
  sourceProject,
  sourceOffer,
  initialEnvironmentId,
  onClose,
  onPrepared,
}: {
  sourceProject: EnvironmentProject;
  sourceOffer?: WorkspaceHandoffOffer | null;
  initialEnvironmentId?: EnvironmentId;
  onClose: () => void;
  onPrepared?: (projectRef: ScopedProjectRef) => void;
}) {
  const sourceComputer = useEnvironment(sourceProject.environmentId);
  const sourceReadable = useEnvironmentScope(
    sourceProject.environmentId,
    AuthOrchestrationReadScope,
  );
  const sourceReviewable =
    sourceComputer?.connection.phase === "connected" &&
    sourceReadable &&
    supportsLoomFeature(
      sourceComputer?.serverConfig?.environment.capabilities,
      PROJECT_CHECKOUT_FEATURE,
    );
  const query = useMemo(
    () =>
      !sourceOffer && sourceReviewable
        ? projectCheckouts.preview({
            environmentId: sourceProject.environmentId,
            input: { projectId: sourceProject.id },
          })
        : EMPTY_PREVIEW,
    [sourceOffer, sourceReviewable, sourceProject.environmentId, sourceProject.id],
  );
  const result = useAtomValue(query);
  const [attempt] = useProjectPreparationAttempt(
    `${sourceProject.environmentId}:${sourceProject.id}`,
  );
  const source = projectPreparationSource({
    offer:
      sourceOffer ??
      (attempt ? { remoteUrl: attempt.remoteUrl, repositoryKey: attempt.repositoryKey } : null),
    checkout: result._tag === "Success" && !result.waiting ? result.value : null,
  });
  const { environments } = useEnvironments();
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialEnvironmentId ?? null,
  );
  const activeHostId = attempt?.environmentId ?? hostId;
  const host =
    environments.find((environment) => environment.environmentId === activeHostId) ?? null;
  const registry = useContext(RegistryContext);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Prepare project on another computer</DialogTitle>
          <DialogDescription>
            Review the repository and destination. Loom creates a working copy; moving a
            conversation is a separate step.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2 text-sm">
            <p className="font-medium">{sourceProject.title}</p>
            <p className="text-muted-foreground">
              From {sourceComputer?.label ?? "source computer"}
            </p>
          </div>
          {source.ready ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {attempt ? "Previously reviewed source origin" : "Reviewed source origin"}
              </p>
              <p className="wrap-anywhere text-sm">{source.remoteUrl}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p
                role={result._tag === "Failure" ? "alert" : "status"}
                className="text-sm text-muted-foreground"
              >
                {!sourceOffer && !sourceReviewable
                  ? "Connect or update the source computer with permission to review its actual Git origin."
                  : result.waiting || result._tag === "Initial"
                    ? "Reviewing the source repository..."
                    : result._tag === "Failure"
                      ? String(Cause.squash(result.cause))
                      : source.reason}
              </p>
              {sourceReviewable && !sourceOffer ? (
                <Button size="sm" variant="outline" onClick={() => registry.refresh(query)}>
                  Refresh source review
                </Button>
              ) : null}
            </div>
          )}
          <label className="space-y-2">
            <span className="block text-sm font-medium">Destination computer</span>
            <Select
              value={activeHostId}
              items={environments.map((environment) => ({
                value: environment.environmentId,
                label: environment.label,
              }))}
              disabled={attempt !== null}
              onValueChange={(value) => {
                if (value) setHostId(value as EnvironmentId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Preparation computer">
                <SelectValue placeholder="Choose a computer" />
              </SelectTrigger>
              <SelectPopup>
                {environments
                  .filter(
                    (environment) => environment.environmentId !== sourceProject.environmentId,
                  )
                  .map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                      {environment.connection.phase === "connected" ? "" : " (offline)"}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </label>
          {host && source.ready ? (
            <PreparationOnComputer
              key={host.environmentId}
              sourceProject={sourceProject}
              source={source}
              environmentId={host.environmentId}
              onClose={onClose}
              onPrepared={onPrepared}
              onStartAnother={() => setHostId(null)}
            />
          ) : null}
          {!host ? (
            <p className="text-sm text-muted-foreground">
              Choose a destination computer to review its folder before preparing.
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PreparationOnComputer({
  sourceProject,
  source,
  environmentId,
  onClose,
  onPrepared,
  onStartAnother,
}: {
  sourceProject: EnvironmentProject;
  source: Extract<ReturnType<typeof projectPreparationSource>, { ready: true }>;
  environmentId: EnvironmentId;
  onClose: () => void;
  onPrepared: ((ref: ScopedProjectRef) => void) | undefined;
  onStartAnother: () => void;
}) {
  const registry = useContext(RegistryContext);
  const environment = useEnvironment(environmentId);
  const projects = useProjects();
  const clones = useEnvironmentProjectClones(environmentId);
  const supported =
    environment?.serverConfig?.environment.capabilities.projectCloneTracking === true;
  const cloneResult = useAtomValue(
    supported
      ? sourceControlEnvironment.projectClones({ environmentId, input: {} })
      : EMPTY_CLONE_RESULT,
  );
  const destinationShell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const projectsReady =
    destinationShell.status === "live" && Option.isSome(destinationShell.snapshot);
  const progressReady = cloneResult._tag === "Success" && !cloneResult.waiting && projectsReady;
  const canClone = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canStart = useAtomValue(
    sourceControlEnvironment.startProjectClone.permissionAtom(environmentId),
  );
  const canCancel = useAtomValue(
    sourceControlEnvironment.cancelProjectClone.permissionAtom(environmentId),
  );
  const canRetry = useAtomValue(
    sourceControlEnvironment.retryProjectClone.permissionAtom(environmentId),
  );
  const start = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const cancel = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retry = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const [attempt, saveAttempt] = useProjectPreparationAttempt(
    `${sourceProject.environmentId}:${sourceProject.id}`,
  );
  const [proposal] = useState(() => ({
    projectId: newProjectId(),
    createdAt: new Date().toISOString(),
  }));
  const defaultPath = getProjectPreparationDestination({
    newProjectsRoot: environment?.serverConfig?.newProjectsRoot,
    remoteUrl: source.remoteUrl,
  });
  const [editedPath, setPath] = useState<string | null>(attempt?.destinationPath ?? null);
  const path = editedPath ?? defaultPath ?? "";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const plan = buildProjectPreparationPlan({
    source,
    host: {
      environmentId,
      connected,
      canClone: canClone && canStart && supported,
      newProjectsRoot: environment?.serverConfig?.newProjectsRoot,
    },
    projectId: attempt?.projectId ?? proposal.projectId,
    title: attempt?.title ?? sourceProject.title,
    createdAt: attempt?.createdAt ?? proposal.createdAt,
    destinationPath: path,
    projects,
    clones,
  });
  const existingCopies = matchingProjectPreparationCopies({ source, environmentId, projects });
  const recovery = attempt
    ? getProjectPreparationRecovery({
        environmentId: attempt.environmentId,
        projectId: attempt.projectId,
        repositoryKey: attempt.repositoryKey,
        expectedDestinationPath: attempt.destinationPath,
        projects,
        clones,
      })
    : null;
  const clone = attempt
    ? clones.find((snapshot) => snapshot.projectId === attempt.projectId)
    : null;
  const navigate = useNavigate();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const openProject = (projectRef: ScopedProjectRef) => {
    if (onPrepared) {
      onPrepared(projectRef);
      onClose();
      return;
    }
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === projectRef.environmentId &&
        candidate.id === projectRef.projectId,
    );
    if (!project) return;
    onClose();
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: deriveLogicalProjectKeyFromSettings(project, groupingSettings) },
      search: { computer: project.environmentId, checkoutId: project.id },
    });
  };
  const run = async (action: "start" | "cancel" | "retry") => {
    if (pendingRef.current || !connected) return;
    if (
      action === "start" &&
      (plan.kind !== "create" ||
        !canStart ||
        (attempt && (recovery?.state !== "idle" || !progressReady)))
    )
      return;
    if (action === "cancel" && (!attempt || !canCancel || recovery?.state !== "running")) return;
    if (action === "retry" && (!attempt || !canRetry || !recovery?.canRetryTrackedClone)) return;
    if (action === "start" && plan.kind === "create") {
      const current = readCurrentPreparationAttempt(
        `${sourceProject.environmentId}:${sourceProject.id}`,
      );
      if (
        current &&
        (current.projectId !== plan.input.projectId || current.environmentId !== environmentId)
      ) {
        setError(
          "A preparation already started for this project. Use its saved progress before starting another.",
        );
        return;
      }
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      let command;
      if (action === "start" && plan.kind === "create") {
        saveAttempt({
          environmentId,
          projectId: plan.input.projectId,
          repositoryKey: source.repositoryKey,
          remoteUrl: source.remoteUrl,
          destinationPath: plan.input.destinationPath,
          title: plan.input.title,
          createdAt: plan.input.createdAt,
        });
        command = await start({ environmentId, input: plan.input });
      } else if (attempt) {
        command = await (action === "cancel" ? cancel : retry)({
          environmentId,
          input: { projectId: attempt.projectId },
        });
      }
      if (command?._tag === "Failure" && !isAtomCommandInterrupted(command)) {
        const failure = squashAtomCommandFailure(command);
        setError(
          failure instanceof Error
            ? failure.message
            : "The computer could not complete this request. Refresh its saved progress before trying again.",
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The response was lost. Refresh progress before continuing.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {!supported ? (
        <p role="status" className="text-sm text-muted-foreground">
          Update Loom on this computer to track project preparation safely.
        </p>
      ) : null}
      <label className="space-y-1.5">
        <span className="block text-sm font-medium">
          Destination folder on {environment?.label ?? "this computer"}
        </span>
        <Input
          nativeInput
          size="sm"
          font="mono"
          aria-label="Preparation destination folder"
          value={path}
          disabled={attempt !== null || pending}
          onChange={(event) => setPath(event.currentTarget.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Existing files are preserved. Repository credentials and private Git access come from the
        selected computer. Setup runs when you start an agent.
      </p>
      {attempt && recovery ? (
        <p role="status" className="text-sm">
          {!connected
            ? "Reconnect the selected computer to inspect this saved preparation."
            : recovery.message}
        </p>
      ) : plan.kind === "blocked" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {plan.reason}
        </p>
      ) : plan.kind === "existing" ? (
        <p className="text-sm">This repository already has a project on this computer.</p>
      ) : null}
      {clone ? (
        <p className="text-sm text-muted-foreground">
          {clone.stage}
          {clone.percent != null ? `, ${clone.percent}%` : ""}
          {clone.detail ? `: ${clone.detail}` : ""}
        </p>
      ) : null}
      {clone?.error ? (
        <p role="alert" className="wrap-anywhere text-sm text-destructive">
          {clone.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="wrap-anywhere text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!attempt && existingCopies.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Choose an existing working folder on {environment?.label ?? "this computer"}
          </p>
          <ul className="space-y-2">
            {existingCopies.map((project) => (
              <li key={project.id}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!connected}
                  aria-label={`Use existing project ${project.title} at ${project.workspaceRoot}`}
                  onClick={() => openProject(scopeProjectRef(project.environmentId, project.id))}
                >
                  {project.title}
                </Button>
                <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
                  {project.workspaceRoot}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!attempt && plan.kind === "create" ? (
          <Button disabled={pending || !connected || !canStart} onClick={() => void run("start")}>
            {pending ? "Starting..." : `Prepare on ${environment?.label ?? "computer"}`}
          </Button>
        ) : null}
        {!attempt && plan.kind === "existing" ? (
          <Button
            onClick={() =>
              openProject(scopeProjectRef(plan.project.environmentId, plan.project.id))
            }
          >
            Use existing project
          </Button>
        ) : null}
        {attempt && recovery?.state === "idle" && plan.kind === "create" ? (
          <Button
            disabled={pending || !connected || !canStart || !progressReady}
            onClick={() => void run("start")}
          >
            Retry saved request
          </Button>
        ) : null}
        {attempt && recovery?.state === "inspect" ? (
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              const known = projects.find(
                (project) =>
                  project.environmentId === attempt.environmentId &&
                  project.id === attempt.projectId,
              );
              if (known)
                void navigate({
                  to: "/settings/projects",
                  search: {
                    project: deriveLogicalProjectKeyFromSettings(known, groupingSettings),
                    machine: known.environmentId,
                    checkout: derivePhysicalProjectKey(known),
                  },
                });
            }}
            disabled={
              !projects.some(
                (project) =>
                  project.environmentId === attempt.environmentId &&
                  project.id === attempt.projectId,
              )
            }
          >
            Review saved project and folder
          </Button>
        ) : null}
        {attempt && recovery?.state === "ready" ? (
          <Button
            onClick={() => openProject(scopeProjectRef(attempt.environmentId, attempt.projectId))}
          >
            Open prepared project
          </Button>
        ) : null}
        {attempt && recovery?.state === "running" ? (
          <Button
            variant="outline"
            disabled={pending || !connected || !canCancel}
            onClick={() => void run("cancel")}
          >
            Cancel preparation
          </Button>
        ) : null}
        {attempt && recovery?.canRetryTrackedClone ? (
          <Button
            variant="outline"
            disabled={pending || !connected || !canRetry}
            onClick={() => void run("retry")}
          >
            Retry tracked clone
          </Button>
        ) : null}
        {attempt && recovery && ["ready", "retry", "cancelled"].includes(recovery.state) ? (
          <Button
            variant="outline"
            disabled={pending || !connected}
            onClick={() => {
              saveAttempt(null);
              onStartAnother();
            }}
          >
            Prepare another computer
          </Button>
        ) : null}
        {attempt ? (
          <Button
            variant="outline"
            disabled={!connected || pending}
            onClick={() => {
              registry.refresh(
                sourceControlEnvironment.projectClones({ environmentId, input: {} }),
              );
            }}
          >
            Refresh progress
          </Button>
        ) : null}
      </div>
    </div>
  );
}
