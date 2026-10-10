import { createCodeGraphAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { CodeGraphBuildMode } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadShell } from "~/state/entities";
import { forkPanelSurface } from "../panels/registry";
import { useCodeGraphViewStore, type ImpactRequest } from "./viewStore";

export const codeGraph = createCodeGraphAtoms(connectionAtomRuntime);

export const FEATURE = "code-graph";
export const PANEL_ID = "code-graph";

export async function runCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

/** The thread's project, or the project of a draft that has not started yet. */
export const projectIdOf = (threadRef: ScopedThreadRef): ProjectId | null =>
  readThreadShell(threadRef)?.projectId ??
  useComposerDraftStore.getState().getDraftThreadByRef(threadRef)?.projectId ??
  null;

export function openPanel(threadRef: ScopedThreadRef) {
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(PANEL_ID));
}

/** Opens the panel on Impact for `request`, or for the uncommitted changes without one. */
export function openImpact(threadRef: ScopedThreadRef, request: ImpactRequest | null = null) {
  useCodeGraphViewStore.getState().update(threadRef, { tab: "impact", impact: request });
  openPanel(threadRef);
}

export async function buildGraph(threadRef: ScopedThreadRef, mode: CodeGraphBuildMode) {
  const projectId = projectIdOf(threadRef);
  if (!projectId) return;
  openPanel(threadRef);
  try {
    await runCommand(codeGraph.build, {
      environmentId: threadRef.environmentId,
      input: { projectId, mode },
    });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Code graph build did not start",
      description: errorText(error),
    });
  }
}

/** Appends `text` to the thread's composer as its own paragraph. */
export function appendToComposer(threadRef: ScopedThreadRef, text: string) {
  const store = useComposerDraftStore.getState();
  const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
  store.setPrompt(threadRef, prompt.trim().length === 0 ? text : `${prompt.trimEnd()}\n\n${text}`);
}
