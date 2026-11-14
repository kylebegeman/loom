import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import {
  ACCOUNT_LINK_WS_METHODS as LINKS,
  ACCOUNT_LINKS_FEATURE,
  type AccountLinkStatus,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { supportsLoomFeature } from "./capabilities.ts";

/** Whether an environment links to its account's other computers by itself. */
export const linksAccountComputers = (
  config: Pick<ServerConfig, "environment"> | null | undefined,
): boolean =>
  config?.environment.capabilities.peerLinks === true &&
  supportsLoomFeature(config.environment.capabilities, ACCOUNT_LINKS_FEATURE);

/** The computers an environment holds an account link to, which Loom keeps and renews itself. */
export const accountLinkedComputers = (
  status: AccountLinkStatus | null | undefined,
): ReadonlySet<EnvironmentId> =>
  new Set(
    (status?.outbound ?? [])
      .filter((entry) => entry.expiresAt !== null)
      .map((entry) => entry.environmentId),
  );

export function createAccountLinkAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** On the Library, for its owner. */
    policy: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:account-links:policy",
      tag: LINKS.policy,
    }),
    setPolicy: createEnvironmentRpcCommand(runtime, {
      label: "loom:account-links:set-policy",
      tag: LINKS.setPolicy,
    }),
    /** On any computer of the account. */
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:account-links:status",
      tag: LINKS.status,
    }),
  };
}
