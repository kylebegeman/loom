import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "~/threadRoutes";

export interface RouteThread {
  readonly threadRef: ScopedThreadRef;
  /** Not sent yet: the chat view shows it, but the server has no such thread. */
  readonly isDraft: boolean;
}

/**
 * The thread the chat route shows, drafts included, read from the route and the draft store
 * only. ForkRoot components use it rather than useHandleNewThread, which subscribes to the
 * thread's detail and re-renders on every streamed event.
 */
export function useRouteThread(): RouteThread | null {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const serverRef = resolveActiveThreadRouteRef(target, draft);
  const environmentId = serverRef?.environmentId ?? draft?.environmentId ?? null;
  const threadId = serverRef?.threadId ?? draft?.threadId ?? null;
  const isDraft = serverRef === null;
  return useMemo(
    () =>
      environmentId !== null && threadId !== null
        ? { threadRef: scopeThreadRef(environmentId, threadId), isDraft }
        : null,
    [environmentId, isDraft, threadId],
  );
}
