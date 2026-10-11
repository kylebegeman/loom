import { sha256 } from "@noble/hashes/sha2";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  relativePartPath,
  resolvePartPath,
  type AssemblyPart,
  type AssemblyOperation,
  type AssemblyReadResult,
  type AssemblyCheckReport,
  type ModelAssembly,
} from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { models, runModelCommand } from "./state";
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
export const assemblyBasis = (snapshot: AssemblyReadResult) =>
  JSON.stringify([
    snapshot.revision,
    snapshot.parts.map((part) => [part.id, part.revision, part.error]),
  ]);
/** Marks markup stale for changed placement, source dependencies or rendered geometry. */
export function assemblySourceRevision(
  snapshot: AssemblyReadResult | null,
  epochs: Readonly<Record<string, number>>,
  geometry: Readonly<Record<string, string>>,
) {
  if (!snapshot) return "";
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      snapshot.revision,
      snapshot.parts.map((part) => [
        part.id,
        part.revision,
        epochs[part.path ?? ""] ?? 0,
        geometry[part.id] ?? null,
      ]),
    ]),
  );
  return Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
/** A CAS undo is a new save; it never overwrites an intervening edit. */
export function assemblyRestoreOperations(
  current: ModelAssembly,
  target: ModelAssembly,
  assemblyPath: string,
): AssemblyOperation[] {
  const ops: AssemblyOperation[] = [];
  const replacedIds = new Set<string>();
  for (const part of current.parts)
    if (!target.parts.some((p) => p.id === part.id)) ops.push({ op: "remove-part", id: part.id });
  for (const part of target.parts) {
    const existing = current.parts.find((p) => p.id === part.id);
    if (existing?.path !== part.path) {
      if (existing) {
        replacedIds.add(part.id);
        ops.push({ op: "remove-part", id: part.id });
      }
      const path = resolvePartPath(assemblyPath, part.path);
      if (!path) throw new Error("This part path is outside the workspace.");
      ops.push({
        op: "add-part",
        id: part.id,
        path,
        name: part.name,
        position: part.position,
        rotation: part.rotation,
        color: part.color,
        parameters: part.parameters,
        parameterSet: part.parameterSet,
      });
      if (!part.visible || part.explode)
        ops.push({ op: "update-part", id: part.id, visible: part.visible, explode: part.explode });
    } else if (JSON.stringify(existing) !== JSON.stringify(part)) {
      const { path: _path, id, ...fields } = part;
      ops.push({ op: "update-part", id, ...fields });
    }
  }
  for (const clearance of current.clearances)
    if (!target.clearances.some((c) => c.id === clearance.id))
      ops.push({ op: "remove-clearance", id: clearance.id });
  for (const clearance of target.clearances)
    if (
      replacedIds.has(clearance.a) ||
      replacedIds.has(clearance.b) ||
      JSON.stringify(current.clearances.find((c) => c.id === clearance.id)) !==
        JSON.stringify(clearance)
    )
      ops.push({ op: "set-clearance", ...clearance });
  if (current.name !== target.name) ops.push({ op: "set-name", name: target.name });
  return ops;
}
export function useAssembly(threadRef: ScopedThreadRef, path: string, active: boolean) {
  const file = { threadId: threadRef.threadId, path },
    [snapshot, setSnapshot] = useState<AssemblyReadResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [undoCount, setUndoCount] = useState(0),
    [report, setReport] = useState<AssemblyCheckReport | null>(null),
    [reportBasis, setReportBasis] = useState<string | null>(null),
    [checking, setChecking] = useState(false);
  const latest = useRef(snapshot),
    saving = useRef(false),
    generation = useRef(0),
    undo = useRef<ModelAssembly[]>([]),
    lastSavedRevision = useRef<string | null>(null),
    request = useRef<string | null>(null),
    checkGeneration = useRef(0);
  const canEdit = useAtomValue(models.updateAssembly.permissionAtom(threadRef.environmentId));
  const canTerminal = useAtomValue(models.renderModel.permissionAtom(threadRef.environmentId));
  const canCheck = useAtomValue(models.checkAssembly.permissionAtom(threadRef.environmentId));

  const refresh = useCallback(async () => {
    const own = ++generation.current;
    try {
      const result = await runModelCommand(models.assembly, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path } },
      });
      if (generation.current !== own) return;
      if (!saving.current && undo.current.length && result.revision !== lastSavedRevision.current) {
        undo.current = [];
        lastSavedRevision.current = null;
        setUndoCount(0);
      }
      latest.current = result;
      setSnapshot(result);
      setError(null);
    } catch (cause) {
      if (generation.current === own) setError(message(cause));
    }
  }, [threadRef.environmentId, threadRef.threadId, path]);
  useEffect(() => {
    if (active) queueMicrotask(() => void refresh());
    return () => {
      generation.current++;
    };
  }, [active, refresh]);
  const apply = useCallback(
    async (operations: readonly AssemblyOperation[], remember = true) => {
      const current = latest.current;
      if (!current || !canEdit || current.readOnly) throw new Error("This assembly is read-only.");
      if (!canTerminal && operations.some((operation) => operation.op === "align"))
        throw new Error("This connection does not permit aligning assembly parts.");
      if (saving.current) throw new Error("Wait for the current save to finish.");
      saving.current = true;
      setBusy(true);
      setError(null);
      generation.current++;
      try {
        const result = await runModelCommand(models.updateAssembly, {
          environmentId: threadRef.environmentId,
          input: {
            file: { threadId: threadRef.threadId, path },
            expectedRevision: current.revision,
            operations,
          },
        });
        generation.current++;
        lastSavedRevision.current = result.revision;
        latest.current = result;
        setSnapshot(result);
        if (remember) {
          undo.current.push(current.assembly);
          if (undo.current.length > 20) undo.current.shift();
          setUndoCount(undo.current.length);
        }
      } catch (cause) {
        setError(message(cause));
        await refresh();
        throw cause;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [canEdit, canTerminal, threadRef.environmentId, threadRef.threadId, path, refresh],
  );
  const revert = useCallback(async () => {
    const current = latest.current,
      target = undo.current.at(-1);
    if (!current || !target) return;
    const operations = assemblyRestoreOperations(current.assembly, target, path);
    if (operations.length) await apply(operations, false);
    undo.current.pop();
    setUndoCount(undo.current.length);
  }, [apply, path]);
  const cancel = useCallback(() => {
    const id = request.current;
    request.current = null;
    checkGeneration.current++;
    setChecking(false);
    if (id)
      void runModelCommand(models.cancelAssemblyCheck, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, requestId: id },
      }).catch(() => {});
  }, [threadRef.environmentId, threadRef.threadId, path]);
  useEffect(() => {
    if (!active) queueMicrotask(cancel);
    return () => {
      queueMicrotask(cancel);
    };
  }, [active, cancel]);
  const check = useCallback(async () => {
    const current = latest.current;
    if (!current) return;
    if (!canCheck) {
      setError("This connection does not permit checking assembly fit.");
      return;
    }
    cancel();
    const id = randomUUID(),
      own = ++checkGeneration.current,
      basis = assemblyBasis(current);
    request.current = id;
    setChecking(true);
    setError(null);
    try {
      const result = await runModelCommand(models.checkAssembly, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, requestId: id, force: true },
      });
      if (checkGeneration.current === own && result.report) {
        setReport(result.report);
        setReportBasis(basis);
      }
    } catch (cause) {
      if (checkGeneration.current === own) setError(message(cause));
    } finally {
      if (checkGeneration.current === own) {
        setChecking(false);
        request.current = null;
      }
    }
  }, [cancel, canCheck, threadRef.environmentId, threadRef.threadId, path]);
  const loadParameters = useCallback(
    async (part: AssemblyPart) => {
      const source = resolvePartPath(path, part.path);
      if (!source) throw new Error("This part path is outside the workspace.");
      return runModelCommand(models.parameters, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, path: source },
      });
    },
    [path, threadRef.environmentId, threadRef.threadId],
  );
  const invalidate = useCallback(() => {
    cancel();
    setReportBasis(null);
  }, [cancel]);
  return {
    canCheck,
    canAlign: canTerminal,
    invalidate,
    file,
    snapshot,
    error,
    busy,
    readOnly: !canEdit || snapshot?.readOnly === true,
    canUndo: undoCount > 0,
    apply,
    revert,
    refresh,
    report,
    checking,
    check,
    cancel,
    stale: !!snapshot && reportBasis !== assemblyBasis(snapshot),
    loadParameters,
  };
}
export const assemblyPartPath = relativePartPath;
