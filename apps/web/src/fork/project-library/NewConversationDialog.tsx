import { useState } from "react";
import {
  libraryContinuationContext,
  libraryCopiesForScope,
  libraryCopyReadiness,
  libraryLaunchChoice,
  libraryLaunchWarning,
  isRepositoryResource,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { libraryLaunchCandidateSummary } from "@t3tools/shared/fork/library-launch";
import { useEnvironmentQuery } from "~/state/query";
import { Link, useNavigate } from "@tanstack/react-router";
import { EnvironmentId, ModelSelection, RuntimeMode, ThreadId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LibraryThreadBinding,
  LibraryProject,
  type LibraryWorkingCopy,
  type LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { threadEnvironment } from "~/state/threads";
import { resolveDefaultProviderModelSelection } from "~/providerInstances";
import { newThreadId, randomUUID } from "~/lib/utils";
import { useLibraryAttempt } from "./attempts";
import { useComposerDraftStore } from "~/composerDraftStore";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { CopyDialog } from "./CopyDialog";
import { LaunchGetCopy } from "./LaunchGetCopy";
import { useLibraryLaunchRanking } from "./useLibraryLaunchRanking";
import { vcsEnvironment } from "~/state/vcs";
import type { EnvironmentQueryView } from "~/state/query";

const ConversationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    threadId: ThreadId,
    binding: LibraryThreadBinding,
    project: LibraryProject,
    title: Schema.String,
    context: Schema.String,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    createdAt: Schema.String,
    created: Schema.Boolean,
    registerRequestId: Schema.String,
  }),
);

/** Persist an empty upstream thread, bind verified files, and register history before its first send. */
export function NewConversationDialog({
  project,
  copies,
  copiesQuery,
  initialHostId,
  initialCopyId,
  initialResourceId,
  continuation,
  onChanged,
  onClose,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly copiesQuery: Pick<
    EnvironmentQueryView<readonly LibraryWorkingCopy[]>,
    "isPending" | "isSuccess" | "error" | "refresh"
  >;
  readonly initialHostId?: EnvironmentId | undefined;
  readonly initialCopyId?: string | undefined;
  readonly initialResourceId?: string | undefined;
  readonly continuation?: LibraryThreadSummary;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const authority = useLibraryAuthority();
  const navigate = useNavigate();
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:conversation:${authority.authorityId}:${project.id}`,
    ConversationAttempt,
  );
  // Null until the user picks a computer, so the ranked choice can follow data as it arrives.
  const [hostChoice, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? null,
  );
  const [resourceId, setResourceId] = useState<string | null>(
    attempt?.binding.resourceIds.length === 1
      ? attempt.binding.resourceIds[0]!
      : (initialResourceId ??
          (continuation?.resourceIds.length === 1 ? continuation.resourceIds[0]! : null)),
  );
  const [title, setTitle] = useState(
    attempt?.title ?? (continuation ? `Continue: ${continuation.title}` : ""),
  );
  const [contextInput, setContext] = useState<string | null>(attempt?.context ?? null);
  const source = useEnvironmentQuery(
    authority.authorityId && continuation
      ? projectLibrary.history({
          environmentId: authority.authorityId,
          input: { id: continuation.id, offset: 0, limit: 100 },
        })
      : null,
  );
  const context =
    attempt?.context ??
    contextInput ??
    (source.data ? libraryContinuationContext(source.data) : "");
  const [preparedCopy, setPreparedCopy] = useState<LibraryWorkingCopy | null>(null);
  const [copyId, setCopyId] = useState<string | null>(
    attempt?.binding.workingCopyId ?? initialCopyId ?? null,
  );
  const [preparing, setPreparing] = useState<"clone" | "reuse" | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiesReadiness = libraryCopyReadiness(copiesQuery);
  const knownCopies = [
    ...copies,
    ...(preparedCopy && !copies.some((copy) => copy.id === preparedCopy.id) ? [preparedCopy] : []),
  ];
  const ranking = useLibraryLaunchRanking({
    project,
    copies: copiesReadiness === "ready" ? knownCopies : [],
    resourceId,
  });
  // Nothing is preselected while copies load, so the choice never jumps away from a copy.
  const choice =
    copiesReadiness === "ready"
      ? libraryLaunchChoice({ ranking, hostId: hostChoice, copyId })
      : { hostId: hostChoice, candidate: null };
  const hostId = choice.hostId;
  const host = authority.environments.find((entry) => entry.environmentId === hostId);
  const candidates = ranking.candidates.flatMap((candidate) =>
    candidate.kind === "copy" && candidate.environmentId === hostId
      ? knownCopies.filter((entry) => entry.id === candidate.copyId)
      : [],
  );
  const chosen = choice.candidate;
  const copy =
    copiesReadiness !== "ready"
      ? null
      : attempt
        ? (copies.find((entry) => entry.id === attempt.binding.workingCopyId) ?? preparedCopy)
        : chosen?.kind === "copy"
          ? (knownCopies.find((entry) => entry.id === chosen.copyId) ?? null)
          : null;
  const warning = attempt ? null : libraryLaunchWarning(chosen, copy, resourceId);
  const modelSelectionFor = (environmentId: EnvironmentId | null) => {
    const entry = authority.environments.find((item) => item.environmentId === environmentId);
    return entry?.serverConfig
      ? resolveDefaultProviderModelSelection(
          entry.serverConfig.providers,
          entry.serverConfig.settings.defaultModelSelection,
        )
      : null;
  };
  const modelSelection = attempt?.modelSelection ?? modelSelectionFor(hostId);
  const copyHealth = useEnvironmentQuery(
    copy &&
      supportsLoomFeature(host?.serverConfig?.environment.capabilities, LIBRARY_COPY_HEALTH_FEATURE)
      ? projectLibrary.copyHealth({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id },
        })
      : null,
  );
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const canPull = useLibraryPermission(vcsEnvironment.pull, hostId);
  const resolve = useAtomQueryRunner(projectLibrary.resolveBinding, {
    refresh: true,
    reportFailure: false,
  });
  const snapshot = useAtomQueryRunner(projectLibrary.snapshotThread, {
    refresh: true,
    reportFailure: false,
  });
  const create = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const bind = useAtomCommand(projectLibrary.bindThread, { reportFailure: false });
  const prepareCopy = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const registerCopy = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerThread, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.bindThread, hostId);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  /** Launch on the current choice, or on a copy saved a moment ago by the get-a-copy step. */
  const submit = async (target = { hostId, copy }) => {
    const launchHost = authority.environments.find(
      (entry) => entry.environmentId === target.hostId,
    );
    const launchModel = attempt?.modelSelection ?? modelSelectionFor(target.hostId);
    if (
      !authority.authorityId ||
      !target.hostId ||
      !target.copy ||
      !launchModel ||
      busy ||
      copiesReadiness !== "ready"
    )
      return;
    const launchCopy = target.copy;
    setBusy(true);
    setError(null);
    try {
      let next = attempt ?? {
        environmentId: target.hostId,
        project,
        threadId: newThreadId(),
        binding: {
          projectId: project.id,
          projectRevision: project.revision,
          workingCopyId: launchCopy.id,
          environmentId: target.hostId,
          resourceIds: resourceId ? [resourceId] : [],
          ...(continuation
            ? {
                continuationOf: {
                  environmentId: continuation.environmentId,
                  threadId: continuation.threadId,
                  sequence: continuation.sequence,
                },
              }
            : {}),
        },
        title: title.trim() || "New project conversation",
        context,
        modelSelection: launchModel,
        runtimeMode: launchHost?.serverConfig?.settings.defaultRuntimeMode ?? "approval-required",
        createdAt: new Date().toISOString(),
        created: false,
        registerRequestId: randomUUID(),
      };
      saveAttempt(next);
      if (launchCopy.ownership === "borrowed" && !next.created) {
        const prepared = await prepareCopy({
          environmentId: next.environmentId,
          input: {
            requestId: `${next.registerRequestId}:files`,
            project: next.project,
            rootPath: launchCopy.rootPath,
            strategy: "reuse",
            resourceIds: next.binding.resourceIds,
          },
        });
        if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
        if (prepared.value.id !== next.binding.workingCopyId)
          throw new Error("The prepared folder does not match this conversation's working copy.");
        const savedCopy = await registerCopy({
          environmentId: authority.authorityId,
          input: { requestId: `${next.registerRequestId}:copy`, copy: prepared.value },
        });
        if (savedCopy._tag === "Failure") throw squashAtomCommandFailure(savedCopy);
      }
      const resolved = await resolve({
        environmentId: next.environmentId,
        input: { binding: next.binding, project: next.project },
      });
      if (resolved._tag === "Failure") throw squashAtomCommandFailure(resolved);
      if (!next.created) {
        const created = await create({
          environmentId: next.environmentId,
          input: {
            threadId: next.threadId,
            projectId: resolved.value.localProjectId,
            title: next.title,
            modelSelection: next.modelSelection,
            runtimeMode: next.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: resolved.value.cwd,
            createdAt: next.createdAt,
          },
        });
        // A lost create response may leave the same empty thread upstream. Binding that ID is recoverable.
        if (created._tag === "Failure") {
          const recovery = await bind({
            environmentId: next.environmentId,
            input: { threadId: next.threadId, binding: next.binding, project: next.project },
          });
          if (recovery._tag === "Failure") throw squashAtomCommandFailure(created);
        }
        next = { ...next, created: true };
        saveAttempt(next);
      }
      const bound = await bind({
        environmentId: next.environmentId,
        input: { threadId: next.threadId, binding: next.binding, project: next.project },
      });
      if (bound._tag === "Failure") throw squashAtomCommandFailure(bound);
      const archived = await snapshot({
        environmentId: next.environmentId,
        input: { threadId: next.threadId },
      });
      if (archived._tag === "Failure") throw squashAtomCommandFailure(archived);
      const saved = await register({
        environmentId: authority.authorityId,
        input: { requestId: next.registerRequestId, thread: archived.value },
      });
      if (saved._tag === "Failure") throw squashAtomCommandFailure(saved);
      if (next.context.trim())
        useComposerDraftStore
          .getState()
          .setPrompt(scopeThreadRef(next.environmentId, next.threadId), next.context);
      saveAttempt(null);
      onChanged();
      onClose();
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.threadId },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the conversation. Retry the same request.",
      );
    } finally {
      setBusy(false);
    }
  };
  /** Fast-forward the stale repositories, then launch on the refreshed copy. */
  const pullThenSubmit = async (paths: readonly string[]) => {
    if (!hostId) return;
    setPulling(true);
    setError(null);
    for (const cwd of paths) {
      const result = await pull({ environmentId: hostId, input: { cwd } });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not pull the latest changes.");
        setPulling(false);
        copyHealth.refresh();
        return;
      }
    }
    setPulling(false);
    copyHealth.refresh();
    await submit();
  };
  const canCreate =
    !busy &&
    !pulling &&
    copiesReadiness === "ready" &&
    copy !== null &&
    allowed &&
    canRegister &&
    modelSelection !== null &&
    (continuation === undefined || (source.isSuccess && !source.isPending)) &&
    authority.connected &&
    host?.connection.phase === "connected";
  const rankOf = (environmentId: EnvironmentId) => {
    const index = ranking.candidates.findIndex(
      (candidate) => candidate.environmentId === environmentId,
    );
    return index === -1 ? ranking.candidates.length : index;
  };
  const executionHosts = authority.environments
    .filter((entry) => entry.serverConfig?.environment.capabilities.supportsExecution !== false)
    .toSorted((left, right) => rankOf(left.environmentId) - rankOf(right.environmentId));
  if (preparing)
    return (
      <CopyDialog
        project={project}
        strategy={preparing}
        {...(hostId ? { initialHostId: hostId } : {})}
        {...(resourceId ? { resourceId } : {})}
        onSaved={(value) => {
          setPreparedCopy(value);
          setHostId(value.environmentId);
          setCopyId(value.id);
          setPreparing(null);
          onChanged();
          // Getting a copy is a step of this launch, so the conversation continues on it.
          if (
            allowed &&
            canRegister &&
            authority.connected &&
            (continuation === undefined || source.isSuccess) &&
            libraryCopiesForScope(
              project,
              [value],
              value.environmentId,
              resourceId === null ? null : [resourceId],
            ).length > 0
          )
            void submit({ hostId: value.environmentId, copy: value });
        }}
        onClose={() => setPreparing(null)}
      />
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={continuation ? "Continue elsewhere" : "New conversation"}
      description={
        continuation
          ? "Create a linked conversation with a fresh provider session. The original conversation keeps its computer and history."
          : "Choose a computer and project scope. Files are verified before the conversation opens."
      }
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={!canCreate} onClick={() => void submit()}>
            {busy ? "Creating..." : attempt ? "Retry conversation" : "Create conversation"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LibraryField label="Conversation title">
          <Input
            value={title}
            disabled={busy || attempt !== null}
            onChange={(event) => setTitle(event.target.value)}
          />
        </LibraryField>
        <LibraryField label="Scope">
          <Select
            value={resourceId ?? "whole"}
            disabled={busy || attempt !== null}
            onValueChange={(value) => {
              setResourceId(value === "whole" ? null : value);
              setCopyId(null);
            }}
            items={[
              { value: "whole", label: "Whole project" },
              ...project.resources
                .filter(isRepositoryResource)
                .map((resource) => ({ value: resource.id, label: resource.title })),
            ]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="whole">Whole project</SelectItem>
              {project.resources.filter(isRepositoryResource).map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  {resource.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        <LibraryField label="Computer">
          <Select
            value={hostId}
            disabled={busy || attempt !== null}
            onValueChange={(value) => {
              setHostId(value);
              setCopyId(null);
            }}
            items={executionHosts.map((entry) => ({
              value: entry.environmentId,
              label: entry.label,
            }))}
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
              {authority.computers
                .filter(
                  (computer) =>
                    computer.supportsExecution &&
                    !authority.environments.some(
                      (entry) => entry.environmentId === computer.environmentId,
                    ),
                )
                .map((computer) => (
                  <SelectItem key={computer.environmentId} value={computer.environmentId} disabled>
                    {computer.label} (connect first)
                  </SelectItem>
                ))}
            </SelectPopup>
          </Select>
          {chosen && !attempt ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {libraryLaunchCandidateSummary(chosen)}
            </p>
          ) : null}
        </LibraryField>
        {authority.computers.some(
          (computer) =>
            computer.supportsExecution &&
            !authority.environments.some((entry) => entry.environmentId === computer.environmentId),
        ) ? (
          <p className="text-sm text-muted-foreground">
            Your Library remembers other computers.{" "}
            <Link to="/settings/connections" className="underline underline-offset-4">
              Connect a computer
            </Link>{" "}
            to run work there. Saved conversations are available here.
          </p>
        ) : null}
        {candidates.length > 1 ? (
          <LibraryField label="Working copy">
            <Select
              value={copy?.id ?? null}
              onValueChange={setCopyId}
              disabled={busy || attempt !== null}
              items={candidates.map((entry) => ({ value: entry.id, label: entry.rootPath }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a working copy" />
              </SelectTrigger>
              <SelectPopup>
                {candidates.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.rootPath}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
        ) : null}
        {copiesReadiness === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading existing working copies...
          </p>
        ) : copiesReadiness === "error" ? (
          <LibraryErrorNotice
            error={copiesQuery.error ?? "Could not load existing working copies."}
            onRetry={copiesQuery.refresh}
          />
        ) : copy ? (
          <div className="space-y-2">
            <p className="break-words text-sm text-muted-foreground">
              Use the existing {copy.ownership === "borrowed" ? "borrowed folder" : "working copy"}{" "}
              on {host?.label}: {copy.rootPath}
            </p>
            {warning ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-warning-foreground">{warning.message}</p>
                {warning.pullPaths && canPull ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canCreate}
                    onClick={() => void pullThenSubmit(warning.pullPaths ?? [])}
                  >
                    {pulling ? "Pulling..." : "Pull first"}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canCreate}
                  onClick={() => void submit()}
                >
                  Continue anyway
                </Button>
              </div>
            ) : null}
          </div>
        ) : hostId ? (
          <LaunchGetCopy
            environmentId={hostId}
            project={project}
            hostLabel={host?.label ?? "this computer"}
            firstCopy={!ranking.candidates.some((candidate) => candidate.kind === "copy")}
            disabled={busy || pulling || attempt !== null || host?.connection.phase !== "connected"}
            onGetCopy={setPreparing}
          />
        ) : null}
        {project.brief ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Shared project brief</summary>
            <p className="mt-2 whitespace-pre-wrap">{project.brief}</p>
          </details>
        ) : null}
        {continuation && !source.data ? (
          <LibraryErrorNotice
            error={source.error ?? "Loading recent saved context..."}
            onRetry={source.refresh}
          />
        ) : null}
        {continuation ? (
          <LibraryField label="Context to carry forward">
            <Textarea
              disabled={busy || attempt !== null}
              value={context}
              onChange={(event) => {
                setContext(event.target.value);
              }}
              placeholder="Summarize the decisions and next step to carry into the new conversation."
            />
          </LibraryField>
        ) : null}
        {hostId && !modelSelection ? (
          <p className="text-xs text-muted-foreground">
            Connect this computer and enable a provider before creating a conversation.
          </p>
        ) : null}
        {attempt ? (
          <p className="text-xs text-muted-foreground">
            This conversation is waiting for confirmation. Retry to recover it without starting
            another one.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
