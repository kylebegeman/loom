import { createMiniOffloadAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
export const mini = createMiniOffloadAtoms(connectionAtomRuntime);
export async function runMini<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
export const openMini = (threadRef: ScopedThreadRef) =>
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("mini-offload"));
