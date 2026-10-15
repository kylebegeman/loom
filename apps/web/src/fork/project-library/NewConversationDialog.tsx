import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EnvironmentId, ModelSelection, RuntimeMode, ThreadId } from "@t3tools/contracts";
import {
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
import { libraryCopiesForScope, libraryCopyReadiness } from "./copyChoice";
import type { EnvironmentQueryView } from "~/state/query";
import { isRepositoryResource } from "./resources";

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
  const [hostId, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ?? initialHostId ?? null,
  );
  const [resourceId, setResourceId] = useState<string | null>(
    attempt?.binding.resourceIds.length === 1 ? attempt.binding.resourceIds[0]! : null,
  );
  const [title, setTitle] = useState(
    attempt?.title ?? (continuation ? `Continue: ${continuation.title}` : ""),
  );
  const [context, setContext] = useState(attempt?.context ?? "");
  const [preparedCopy, setPreparedCopy] = useState<LibraryWorkingCopy | null>(null);
  const [copyId, setCopyId] = useState<string | null>(
    attempt?.binding.workingCopyId ?? initialCopyId ?? null,
  );
  const [preparing, setPreparing] = useState<"clone" | "reuse" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = authority.environments.find((entry) => entry.environmentId === hostId);
  const copiesReadiness = libraryCopyReadiness(copiesQuery);
  const candidates =
    copiesReadiness === "ready"
      ? libraryCopiesForScope(
          project,
          [
            ...copies,
            ...(preparedCopy && !copies.some((copy) => copy.id === preparedCopy.id)
              ? [preparedCopy]
              : []),
          ],
          hostId,
          resourceId,
        )
      : [];
  const copy =
    copiesReadiness !== "ready"
      ? null
      : attempt
        ? (copies.find((entry) => entry.id === attempt.binding.workingCopyId) ?? preparedCopy)
        : (candidates.find((entry) => entry.id === copyId) ??
          (candidates.length === 1 ? candidates[0]! : null));
  const modelSelection =
    attempt?.modelSelection ??
    (host?.serverConfig
      ? resolveDefaultProviderModelSelection(
          host.serverConfig.providers,
          host.serverConfig.settings.defaultModelSelection,
        )
      : null);
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
  const register = useAtomCommand(projectLibrary.registerThread, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.bindThread, hostId);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  const submit = async () => {
    if (
      !authority.authorityId ||
      !hostId ||
      !copy ||
      !modelSelection ||
      busy ||
      copiesReadiness !== "ready"
    )
      return;
    setBusy(true);
    setError(null);
    try {
      let next = attempt ?? {
        environmentId: hostId,
        project,
        threadId: newThreadId(),
        binding: {
          projectId: project.id,
          projectRevision: project.revision,
          workingCopyId: copy.id,
          environmentId: hostId,
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
        modelSelection,
        runtimeMode: host?.serverConfig?.settings.defaultRuntimeMode ?? "approval-required",
        createdAt: new Date().toISOString(),
        created: false,
        registerRequestId: randomUUID(),
      };
      saveAttempt(next);
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
  if (preparing)
    return (
      <CopyDialog
        project={project}
        strategy={preparing}
        {...(hostId ? { initialHostId: hostId } : {})}
        {...(resourceId ? { resourceId } : {})}
        onSaved={(value) => {
          setPreparedCopy(value);
          setCopyId(value.id);
          setPreparing(null);
          onChanged();
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
          <Button
            disabled={
              busy ||
              copiesReadiness !== "ready" ||
              !copy ||
              !allowed ||
              !canRegister ||
              !modelSelection ||
              !authority.connected ||
              host?.connection.phase !== "connected"
            }
            onClick={() => void submit()}
          >
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
            items={authority.environments.map((entry) => ({
              value: entry.environmentId,
              label: entry.label,
            }))}
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
        {candidates.length > 1 ? (
          <LibraryField label="Working copy">
            <Select
              value={copyId}
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
          <p className="break-words text-sm text-muted-foreground">
            Use the existing {copy.ownership === "borrowed" ? "borrowed folder" : "working copy"} on{" "}
            {host?.label}: {copy.rootPath}
          </p>
        ) : hostId ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Choose a suitable working copy on this computer before starting.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || attempt !== null || host?.connection.phase !== "connected"}
                onClick={() => setPreparing("reuse")}
              >
                Use existing folder
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || attempt !== null || host?.connection.phase !== "connected"}
                onClick={() => setPreparing("clone")}
              >
                Prepare workspace
              </Button>
            </div>
          </div>
        ) : null}
        {project.brief ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Shared project brief</summary>
            <p className="mt-2 whitespace-pre-wrap">{project.brief}</p>
          </details>
        ) : null}
        {continuation ? (
          <LibraryField label="Context to carry forward">
            <Textarea
              disabled={busy || attempt !== null}
              value={context}
              onChange={(event) => setContext(event.target.value)}
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
