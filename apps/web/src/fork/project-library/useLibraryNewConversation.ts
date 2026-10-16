import {
  parseLibraryProjectScope,
  supportsLoomFeature,
  libraryRouteParams,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useEnvironments } from "~/state/environments";
import { useStableCallback } from "~/hooks/useStableCallback";
import { projectLibrary, useLibraryAuthority } from "./state";
import { openLibraryAction } from "./actions";
import { useUiStateStore } from "~/uiStateStore";

/** Resolve context on the source before choosing a new execution binding. No full history read. */
export function useLibraryNewConversation() {
  const params = useParams({ strict: false });
  const context = libraryRouteParams(params);
  const { environments } = useEnvironments();
  const filterKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const lookup = useAtomQueryRunner(projectLibrary.lookupThread, { reportFailure: false });
  const authority = useLibraryAuthority();
  const binding = useAtomQueryRunner(projectLibrary.threadBinding, {
    refresh: true,
    reportFailure: false,
  });
  return useStableCallback(async (thread?: ScopedThreadRef): Promise<boolean> => {
    if (/^\/(?:projects|library)(?:\/|$)/.test(window.location.pathname)) {
      openLibraryAction("new-conversation", context.projectId);
      return true;
    }
    thread ??=
      context.environmentId && context.threadId
        ? scopeThreadRef(EnvironmentId.make(context.environmentId), ThreadId.make(context.threadId))
        : undefined;
    if (!thread) {
      const scope = parseLibraryProjectScope(filterKey);
      if (!scope) return false;
      openLibraryAction(
        "new-conversation",
        scope.projectId,
        scope.resourceId ? { resourceId: scope.resourceId } : {},
      );
      return true;
    }
    if (!authority.authorityId) return false;
    const host = environments.find((entry) => entry.environmentId === thread.environmentId);
    if (
      host?.connection.phase !== "connected" ||
      !supportsLoomFeature(host?.serverConfig?.environment.capabilities, "project-library")
    ) {
      const saved = await lookup({
        environmentId: authority.authorityId,
        input: { sourceEnvironmentId: thread.environmentId, threadId: thread.threadId },
      });
      if (saved._tag !== "Success" || !saved.value) return false;
      openLibraryAction("new-conversation", saved.value.projectId, {
        environmentId: thread.environmentId,
        ...(saved.value.workingCopyId ? { workingCopyId: saved.value.workingCopyId } : {}),
        ...(saved.value.resourceIds.length === 1 ? { resourceId: saved.value.resourceIds[0] } : {}),
      });
      return true;
    }
    const result = await binding({
      environmentId: thread.environmentId,
      input: { threadId: thread.threadId },
    });
    if (result._tag === "Failure") {
      // A failed context lookup opens an explicit project choice instead of silently losing context.
      openLibraryAction("new-conversation");
      return true;
    }
    if (!result.value) return false;
    openLibraryAction("new-conversation", result.value.projectId, {
      environmentId: result.value.environmentId,
      workingCopyId: result.value.workingCopyId,
      ...(result.value.resourceIds.length === 1 ? { resourceId: result.value.resourceIds[0] } : {}),
    });
    return true;
  });
}
