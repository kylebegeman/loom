import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import { useLayoutEffect, useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { PcbInspection, PcbWorkspace } from "@t3tools/contracts/fork";
import { pcb } from "./state";
import { asyncValue, asyncError, errorMessage } from "./usePcbPreview";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
const idle = Atom.make(AsyncResult.initial<PcbInspection, never>());
const EMPTY: PcbWorkspace = {
  version: 0,
  views: [],
  layerSets: [],
  measurements: [],
  annotations: [],
  simulations: [],
  variants: [],
};
export function usePcbWorkbench(
  threadRef: ScopedThreadRef,
  designId: string,
  sourceHash: string | null,
  allowed: boolean,
) {
  const canInspect = useAtomValue(pcb.inspect.permissionAtom(threadRef.environmentId));
  const canEdit = useAtomValue(pcb.updateWorkspace.permissionAtom(threadRef.environmentId));
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, designId },
  };
  const inspected = useAtomValue(
    allowed && canInspect
      ? pcb.inspect.resultAtom({
          ...target,
          input: { ...target.input, revision: sourceHash ?? "initial" },
        })
      : idle,
  );
  const saved = useAtomValue(pcb.workspaceUpdates(target));
  const value = asyncValue(saved);
  const [local, setLocal] = useState<PcbWorkspace | null>(null),
    [pending, setPending] = useState(0),
    [error, setError] = useState<string | null>(null);
  const latest = useRef<PcbWorkspace>(EMPTY),
    queue = useRef(Promise.resolve());
  const data = local && (!value || local.version >= value.version) ? local : (value ?? EMPTY);
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  const mutate = (change: (current: PcbWorkspace) => PcbWorkspace) => {
    if (!canEdit || !value) {
      const reason = !canEdit
        ? "Workspace write permission is required to save editor changes."
        : "Wait for the saved workspace to load before editing.";
      setError(reason);
      const failed = Promise.reject(new Error(reason));
      void failed.catch(() => undefined);
      return failed;
    }
    setPending((n) => n + 1);
    const next = queue.current
      .catch(() => undefined)
      .then(async () => {
        const current = latest.current;
        const updated = await runPcbCommand(pcb.updateWorkspace, {
          ...target,
          input: { ...target.input, expectedVersion: current.version, workspace: change(current) },
        });
        latest.current = updated;
        setLocal(updated);
        setError(null);
      });
    queue.current = next;
    void next.catch((e) => setError(errorMessage(e))).finally(() => setPending((n) => n - 1));
    return next;
  };
  return {
    inspection: asyncValue(inspected),
    inspecting: allowed && canInspect && (inspected.waiting || inspected._tag === "Initial"),
    inspectionError: asyncError(inspected),
    data,
    ready: value !== null,
    canEdit,
    pending,
    error: error ?? asyncError(saved),
    mutate,
  };
}
