import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckpointId, ScopedThreadRef } from "@t3tools/contracts";
import type { ModelHistory } from "@t3tools/contracts/fork";
import { useThreadProjection } from "~/state/entities";
import { models, runModelCommand } from "./state";
import { historyChips } from "./history";

/** Fetch only while the history strip or a historical version is active. */
export function useModelHistory(input: {
  threadRef: ScopedThreadRef;
  path: string;
  active: boolean;
  liveRevision: string | null;
  selected: CheckpointId | null;
}) {
  const { threadRef, path, active, liveRevision, selected } = input;
  const projection = useThreadProjection(threadRef)?.projection;
  const hasProjection = projection !== undefined;
  const signature = useMemo(() => {
    const rootIds = new Set(
      projection?.checkpointScopes
        .filter((scope) => scope.kind === "root_run")
        .map((scope) => scope.id),
    );
    return (
      projection?.checkpoints
        .filter((checkpoint) => checkpoint.status === "ready" && rootIds.has(checkpoint.scopeId))
        .map((checkpoint) => `${checkpoint.id}\u001f${checkpoint.ref}`)
        .join("\0") ?? ""
    );
  }, [projection?.checkpoints, projection?.checkpointScopes]);
  const [pages, setPages] = useState<ReadonlyArray<ModelHistory>>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const request = useRef(0);
  const latestPages = useRef(pages);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest history pages in a ref for async page loads
  useEffect(() => {
    latestPages.current = pages;
  }, [pages]);
  const busy = useRef(false);
  const previousKey = useRef(`${threadRef.environmentId}\0${threadRef.threadId}\0${path}`);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the file's history from the server while active and resets it when the file changes
  useEffect(() => {
    const key = `${threadRef.environmentId}\0${threadRef.threadId}\0${path}`;
    const changed = previousKey.current !== key;
    previousKey.current = key;
    if (changed) {
      latestPages.current = [];
      queueMicrotask(() => {
        if (request.current === id) setPages([]);
      });
    }
    const id = ++request.current;
    if (!active) {
      busy.current = false;
      queueMicrotask(() => {
        if (request.current === id) setStatus("idle");
      });
      return;
    }
    busy.current = true;
    queueMicrotask(() => {
      if (request.current === id) {
        setStatus("loading");
        setError(null);
      }
    });
    void runModelCommand(models.history, {
      environmentId: threadRef.environmentId,
      input: { file: { threadId: threadRef.threadId, path } },
    })
      .then((page) => {
        if (request.current !== id) return;
        setPages((previous) => {
          const readyIds = new Set(
            signature.split("\0").map((entry) => entry.slice(0, entry.indexOf("\u001f"))),
          );
          const older = changed
            ? []
            : previous.slice(1).map((older) => ({
                ...older,
                versions: hasProjection
                  ? older.versions.filter((version) => readyIds.has(version.checkpointId))
                  : older.versions,
              }));
          return [page, ...older];
        });
        busy.current = false;
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (request.current !== id) return;
        busy.current = false;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Could not load model history.");
      });
    return () => {
      if (request.current === id) {
        request.current++;
        busy.current = false;
      }
    };
  }, [
    active,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- File revisions and explicit refreshes invalidate remote checkpoint data without changing RPC input.
    liveRevision,
    signature,
    hasProjection,
    generation,
    threadRef.environmentId,
    threadRef.threadId,
    path,
  ]);
  const loadEarlier = useCallback(() => {
    const cursor = latestPages.current.at(-1)?.nextCursor;
    if (!active || busy.current || !cursor) return;
    const id = ++request.current;
    busy.current = true;
    setStatus("loading");
    setError(null);
    void runModelCommand(models.history, {
      environmentId: threadRef.environmentId,
      input: { file: { threadId: threadRef.threadId, path }, cursor },
    })
      .then((page) => {
        if (request.current !== id) return;
        setPages((previous) => [...previous, page]);
        busy.current = false;
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (request.current !== id) return;
        busy.current = false;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Could not load earlier versions.");
      });
  }, [active, threadRef.environmentId, threadRef.threadId, path]);
  const includePage = useCallback((page: ModelHistory) => {
    setPages((pages) =>
      page.versions.every((candidate) =>
        pages.some((loaded) =>
          loaded.versions.some((version) => candidate.checkpointId === version.checkpointId),
        ),
      )
        ? pages
        : [...pages, page],
    );
  }, []);
  const chips = useMemo(() => historyChips(pages, selected), [pages, selected]);
  return {
    status,
    error,
    pages,
    chips,
    latestTurn: pages[0]?.latestTurn ?? null,
    current: pages[0]?.current ?? null,
    threadRunning: pages[0]?.threadRunning ?? false,
    unavailable: pages[0]?.unavailable ?? null,
    loadEarlier,
    includePage,
    refresh: useCallback(() => setGeneration((generation) => generation + 1), []),
  };
}
