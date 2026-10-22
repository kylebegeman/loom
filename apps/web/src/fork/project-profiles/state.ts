import { createProjectProfilesAtoms, loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { forkPanelSurface } from "../panels/registry";
export const profiles = createProjectProfilesAtoms(connectionAtomRuntime);
import { FEATURE, PANEL_ID } from "./constants";
export { FEATURE, PANEL_ID, SETTINGS_HASH } from "./constants";
export function useProfilesSupported(environmentId: EnvironmentId) {
  return loomFeaturesOf(useServerConfigs().get(environmentId)?.environment.capabilities).includes(
    FEATURE,
  );
}
export async function runProfileCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
export function openEnv(threadRef: ScopedThreadRef) {
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(PANEL_ID));
}
type ProfileAction =
  | { readonly kind: "edit"; readonly environmentId: EnvironmentId; readonly projectId: ProjectId }
  | {
      readonly kind: "run";
      readonly threadRef: ScopedThreadRef;
      readonly intent: import("@t3tools/contracts/fork").CommandIntent;
    };
const listeners = new Set<(action: ProfileAction) => void>();
export function onProfileAction(listener: (action: ProfileAction) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function requestProfileAction(action: ProfileAction) {
  for (const listener of listeners) listener(action);
}
export const profileError = (error: unknown) =>
  error instanceof Error ? error.message : "The project profile request failed.";
