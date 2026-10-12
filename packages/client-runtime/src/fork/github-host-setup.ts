import { GITHUB_HOST_SETUP_WS_METHODS as GH, type GitHubSetupState } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export const GITHUB_DEVICE_APPROVAL_URL = "https://github.com/login/device";
export const githubSetupIsActive = (state: GitHubSetupState | null) =>
  state !== null && ["checking", "installing", "waiting", "configuring"].includes(state.phase);
export const githubSetupMessage = (state: GitHubSetupState | null): string => {
  if (state?.message) return state.message;
  switch (state?.phase) {
    case "checking":
      return "Checking saved GitHub access…";
    case "installing":
      return "Installing verified GitHub CLI…";
    case "waiting":
      return "Enter this code on GitHub and approve access. Loom will finish automatically.";
    case "configuring":
      return "Configuring Git access…";
    case "ready":
      return "GitHub is ready for Git on this host. Projects reuse its saved authorization.";
    default:
      return "Prepare GitHub access once for private repositories on this host. Existing authorization is reused.";
  }
};
export function createGitHubHostSetupAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    start: createEnvironmentRpcCommand(runtime, {
      label: "loom:github-setup-start",
      tag: GH.start,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:github-setup-cancel",
      tag: GH.cancel,
    }),
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:github-setup-state",
      tag: GH.watch,
    }),
  };
}
