import { createSkillRegistryAtoms, loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { forkPanelSurface } from "../panels/registry";

export const skills = createSkillRegistryAtoms(connectionAtomRuntime);
import { FEATURE } from "./constants";
export { FEATURE } from "./constants";
export type SkillTab = "skills" | "sources" | "lab";
export function useSkillsSupported(environmentId: EnvironmentId | null) {
  const configs = useServerConfigs();
  return loomFeaturesOf(
    environmentId === null ? undefined : configs.get(environmentId)?.environment.capabilities,
  ).includes(FEATURE);
}
export function openSkills(threadRef: ScopedThreadRef, tab: SkillTab = "skills") {
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(FEATURE, tab));
}
export async function runSkillCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
export function useSkillOperation() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run<A>(label: string, action: () => Promise<A>): Promise<A | null> {
    setPending(label);
    setError(null);
    setNotice(null);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The skills request failed.");
      return null;
    } finally {
      setPending(null);
    }
  }
  return { pending, error, notice, setNotice, run };
}
export type SkillOperation = ReturnType<typeof useSkillOperation>;
