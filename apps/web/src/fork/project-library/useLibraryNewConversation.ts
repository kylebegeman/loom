import {
  parseLibraryProjectScope,
  supportsLoomFeature,
  libraryRouteParams,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { readThreadShell } from "~/state/entities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useEnvironments } from "~/state/environments";
import { useStableCallback } from "~/hooks/useStableCallback";
import { projectLibrary, useLibraryAuthority } from "./state";
import { openLibraryAction } from "./actions";
import { useUiStateStore } from "~/uiStateStore";

/** Recover only explicit registered identities, never a coincidentally matching folder or name. */
export function libraryContextForLocalProject(
  ref: { readonly environmentId: string; readonly projectId: string },
  copies: readonly LibraryWorkingCopy[],
) {
  const matches = copies.flatMap((copy) => {
    if (
      copy.environmentId !== ref.environmentId ||
      copy.registered === false ||
      copy.state === "released"
    )
      return [];
    const root = copy.rootLocalProjectId === ref.projectId;
    const resources = copy.repositories.filter(
      (repository) => repository.localProjectId === ref.projectId,
    );
    if (!root && resources.length !== 1) return [];
    return [
      {
        projectId: copy.projectId,
        workingCopyId: copy.id,
        ...(!root ? { resourceId: resources[0]!.resourceId } : {}),
      },
    ];
  });
  if (
    !matches.length ||
    new Set(matches.map((entry) => entry.projectId)).size !== 1 ||
    new Set(matches.map((entry) => entry.resourceId ?? null)).size !== 1
  )
    return null;
  return matches[0]!;
}

/** Resolve context on the source before choosing a new execution binding. No full history read. */
export function useLibraryNewConversation() {
  const params = useParams({ strict: false });
  const context = libraryRouteParams(params);
  const { environments } = useEnvironments();
  const filterKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const lookup = useAtomQueryRunner(projectLibrary.lookupThread, { reportFailure: false });
  const authority = useLibraryAuthority();
  const loadCopies = useAtomQueryRunner(projectLibrary.copies, {
    refresh: true,
    reportFailure: false,
  });
  const binding = useAtomQueryRunner(projectLibrary.threadBinding, {
    refresh: true,
    reportFailure: false,
  });
  const openConversation = async (
    source?: ScopedThreadRef,
    options?: { inheritSettings?: boolean },
  ) => {
    if (!source && /^\/(?:projects|library)(?:\/|$)/.test(window.location.pathname)) {
      openLibraryAction("new-conversation", context.projectId);
      return true;
    }
    const thread =
      source ??
      (context.environmentId && context.threadId
        ? scopeThreadRef(EnvironmentId.make(context.environmentId), ThreadId.make(context.threadId))
        : undefined);
    if (!thread) {
      const scope = parseLibraryProjectScope(filterKey);
      if (!scope) {
        if (!authority.authorityId) return false;
        openLibraryAction("new-conversation");
        return true;
      }
      openLibraryAction(
        "new-conversation",
        scope.projectId,
        scope.resourceId ? { resourceId: scope.resourceId } : {},
      );
      return true;
    }
    if (!authority.authorityId) return false;
    const sourceShell = options?.inheritSettings ? readThreadShell(thread) : null;
    // The project form cannot select an explicit branch; reuse that checkout and its lane.
    if (sourceShell?.branch) return false;
    const launchDefaults = sourceShell
      ? {
          modelSelection: sourceShell.modelSelection,
          runtimeMode: sourceShell.runtimeMode,
          interactionMode: sourceShell.interactionMode,
        }
      : {};
    const host = environments.find((entry) => entry.environmentId === thread.environmentId);
    const connected =
      host?.connection.phase === "connected" &&
      supportsLoomFeature(host.serverConfig?.environment.capabilities, "project-library");
    const result = connected
      ? await binding({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        })
      : null;
    if (result?._tag === "Failure") {
      openLibraryAction("new-conversation");
      return true;
    }
    if (!result || !result.value) {
      const saved = await lookup({
        environmentId: authority.authorityId,
        input: { sourceEnvironmentId: thread.environmentId, threadId: thread.threadId },
      });
      if (saved._tag === "Success" && saved.value) {
        openLibraryAction("new-conversation", saved.value.projectId, {
          ...launchDefaults,
          environmentId: thread.environmentId,
          ...(saved.value.workingCopyId ? { workingCopyId: saved.value.workingCopyId } : {}),
          ...(saved.value.resourceIds.length === 1
            ? { resourceId: saved.value.resourceIds[0] }
            : {}),
        });
        return true;
      }
      if (saved._tag === "Failure") {
        openLibraryAction("new-conversation");
        return true;
      }
      const shell = sourceShell ?? readThreadShell(thread);
      if (!shell) {
        openLibraryAction("new-conversation");
        return true;
      }
      const copies = await loadCopies({ environmentId: authority.authorityId, input: {} });
      if (copies._tag === "Failure") {
        openLibraryAction("new-conversation");
        return true;
      }
      const recovered = libraryContextForLocalProject(
        { environmentId: thread.environmentId, projectId: shell.projectId },
        copies.value,
      );
      if (!recovered) {
        if (options?.inheritSettings) return false;
        openLibraryAction("new-conversation");
        return true;
      }
      openLibraryAction("new-conversation", recovered.projectId, {
        ...launchDefaults,
        environmentId: thread.environmentId,
        workingCopyId: recovered.workingCopyId,
        ...(recovered.resourceId ? { resourceId: recovered.resourceId } : {}),
      });
      return true;
    }
    openLibraryAction("new-conversation", result.value.projectId, {
      ...launchDefaults,
      environmentId: result.value.environmentId,
      workingCopyId: result.value.workingCopyId,
      ...(result.value.resourceIds.length === 1 ? { resourceId: result.value.resourceIds[0] } : {}),
    });
    return true;
  };
  return useStableCallback(openConversation);
}
