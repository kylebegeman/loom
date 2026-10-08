import { useAtomValue } from "@effect/atom-react";
import { useCallback, useRef, useState, useMemo } from "react";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { EMPTY_MODEL_WORKSPACE, type ModelWorkspaceOperation } from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { models, runModelCommand, modelUrl } from "./state";
export function useModelWorkspace(threadRef: ScopedThreadRef, path: string) {
  const canEdit = useAtomValue(models.updateWorkspace.permissionAtom(threadRef.environmentId));
  const result = useAtomValue(
    models.workspace({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, path },
    }),
  );
  const value = Option.getOrNull(AsyncResult.value(result));
  const data = useMemo(() => {
    if (!value) return EMPTY_MODEL_WORKSPACE;
    const url = (image: string | null) =>
      image === null || image.startsWith("data:")
        ? image
        : modelUrl(threadRef.environmentId, image);
    return {
      ...value,
      variants: value.variants.map((item) => ({ ...item, thumbnail: url(item.thumbnail) })),
      annotations: value.annotations.map((item) => ({
        ...item,
        referenceImage: url(item.referenceImage),
      })),
    };
  }, [value, threadRef.environmentId]);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingSaves, setPendingSaves] = useState(0);
  const mutate = useCallback(
    (operation: ModelWorkspaceOperation) => {
      setPendingSaves((count) => count + 1);
      const next = queue.current
        .catch(() => undefined)
        .then(() =>
          runModelCommand(models.updateWorkspace, {
            environmentId: threadRef.environmentId,
            input: { file: { threadId: threadRef.threadId, path }, operation },
          }),
        );
      queue.current = next;
      void next.then(
        () => setError(null),
        (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
      );
      return next.catch(() => undefined).finally(() => setPendingSaves((count) => count - 1));
    },
    [threadRef.environmentId, threadRef.threadId, path],
  );
  return {
    data,
    canEdit,
    ready: value !== null,
    pendingSaves,
    mutate,
    error: error ?? (result._tag === "Failure" ? String(Cause.squash(result.cause)) : null),
  };
}
