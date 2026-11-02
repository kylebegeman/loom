import { createDevEnvironmentAtoms } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { forkPanelSurface } from "../panels/registry";
export const devEnvironment = createDevEnvironmentAtoms(connectionAtomRuntime);
export const openDevEnvironment = (threadRef: ScopedThreadRef) =>
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("browser-dev-tools"));
export async function runDevCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
export function attachDevEvidence(threadRef: ScopedThreadRef, text: string) {
  const composer = useComposerDraftStore.getState();
  const draft = composer.getComposerDraft(threadRef)?.prompt ?? "";
  composer.setPrompt(threadRef, `${draft.trimEnd()}${draft ? "\n\n" : ""}${text}`);
}
