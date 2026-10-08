import { createAppleBuildToolingAtoms } from "@t3tools/client-runtime/fork";
import { environmentThreadShells } from "~/state/threads";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { AppleRunRecord } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { toastManager } from "~/components/ui/toast";
import { forkPanelSurface } from "../panels/registry";
import { readSelection, requestFor, type AppleAction } from "./selection";

export const apple = createAppleBuildToolingAtoms(connectionAtomRuntime);

export const FEATURE = "apple-build-tooling";
export const PANEL_ID = "apple-build-tooling";

export async function runAppleCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<A> {
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

export const isActiveRun = (run: Pick<AppleRunRecord, "status">) =>
  run.status === "queued" || run.status === "running";

/** The project a thread belongs to, read once without subscribing. */
export function projectIdOf(threadRef: ScopedThreadRef): string | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef))?.projectId ?? null;
}

/**
 * The newest active run per thread, as last seen by the panel or started from a shortcut.
 * Lets the pure palette offer "Cancel run" without its own subscription.
 */
const activeRuns = new Map<string, string>();
const threadKey = (threadRef: ScopedThreadRef) =>
  `${threadRef.environmentId}:${threadRef.threadId}`;

export function noteRuns(threadRef: ScopedThreadRef, runs: ReadonlyArray<AppleRunRecord>) {
  const active = runs.find(isActiveRun);
  if (active) activeRuns.set(threadKey(threadRef), active.id);
  else activeRuns.delete(threadKey(threadRef));
}

export const activeRunOf = (threadRef: ScopedThreadRef) =>
  activeRuns.get(threadKey(threadRef)) ?? null;

export const openPanel = (threadRef: ScopedThreadRef) =>
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(PANEL_ID));

export function togglePanel(threadRef: ScopedThreadRef) {
  const panels = useRightPanelStore.getState();
  const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
  if (active?.kind === "fork" && active.panelId === PANEL_ID)
    panels.closeSurface(threadRef, active.id);
  else panels.openSurface(threadRef, forkPanelSurface(PANEL_ID));
}

/** Whether the palette can start runs for this thread without opening the panel first. */
export function hasRememberedSelection(threadRef: ScopedThreadRef) {
  const projectId = projectIdOf(threadRef);
  return (
    projectId !== null && readSelection(threadRef.environmentId, projectId).container !== undefined
  );
}

/** Starts a run with the panel's remembered selection and shows the panel. */
export async function startRemembered(threadRef: ScopedThreadRef, action: AppleAction) {
  openPanel(threadRef);
  const projectId = projectIdOf(threadRef);
  if (projectId === null) return;
  const planned = requestFor(
    threadRef.threadId,
    readSelection(threadRef.environmentId, projectId),
    action,
  );
  if ("missing" in planned) {
    toastManager.add({ type: "info", title: "Apple build", description: planned.missing });
    return;
  }
  try {
    const run = await runAppleCommand(apple.start, {
      environmentId: threadRef.environmentId,
      input: planned.request,
    });
    activeRuns.set(threadKey(threadRef), run.id);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Apple build did not start",
      description: errorText(error),
    });
  }
}

export async function cancelActiveRun(threadRef: ScopedThreadRef) {
  const runId = activeRunOf(threadRef);
  if (runId === null) return;
  try {
    await runAppleCommand(apple.cancel, {
      environmentId: threadRef.environmentId,
      input: { runId },
    });
  } catch (error) {
    toastManager.add({ type: "error", title: "Cancel failed", description: errorText(error) });
  }
}

/** Saves the last 256 KB of a run's log as a file; works over every connection mode. */
export async function downloadRunLog(environmentId: EnvironmentId, runId: string) {
  const atom = apple.run({ environmentId, input: { runId, includeLogTail: true } });
  appAtomRegistry.refresh(atom);
  const detail = await Effect.runPromise(AtomRegistry.getResult(appAtomRegistry, atom));
  const url = URL.createObjectURL(new Blob([detail.logTail ?? ""], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${runId}.log`;
  link.click();
  URL.revokeObjectURL(url);
}
