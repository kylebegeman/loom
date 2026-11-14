import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import {
  ACCOUNT_LINK_WS_METHODS as LINKS,
  ACCOUNT_LINKS_FEATURE,
  type AccountLinkStatus,
} from "@t3tools/contracts/fork";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { offersLinkedEnvironments } from "../linkRequest.ts";
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

/** Which linked computers an environment's agents can work on, as its link tools decide. */
export interface AgentLinkReach {
  /** Its Linked environments beta is on, so every link it holds. */
  readonly offers: boolean;
  /** With the beta off, only the computers it holds an account link to. */
  readonly accountLinked: ReadonlySet<EnvironmentId>;
}

const NO_COMPUTERS: ReadonlySet<EnvironmentId> = new Set();
const NONE: ReadonlyArray<never> = [];

/** Whether an environment's agents can work on any computer it links to. */
export const reachesOverLinks = (reach: AgentLinkReach): boolean =>
  reach.offers || reach.accountLinked.size > 0;

/** Of `candidates`, the computers an environment's agents can work on over its links. */
export const agentReachable = <T extends { readonly environmentId: EnvironmentId }>(
  reach: AgentLinkReach,
  candidates: ReadonlyArray<T>,
): ReadonlyArray<T> =>
  reach.offers
    ? candidates
    : reach.accountLinked.size === 0
      ? NONE
      : candidates.filter(({ environmentId }) => reach.accountLinked.has(environmentId));

const sameComputers = (a: ReadonlySet<EnvironmentId>, b: ReadonlySet<EnvironmentId>) =>
  a.size === b.size && [...a].every((environmentId) => b.has(environmentId));

export function createAccountLinkAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  serverConfig: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>,
) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:account-links:status",
    tag: LINKS.status,
  });
  const noReach = Atom.make<AgentLinkReach>({ offers: false, accountLinked: NO_COMPUTERS }).pipe(
    Atom.withLabel("loom:account-links:agent-reach:none"),
  );
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
    status,
    /** What `environmentId`'s agents reach over links; reads its account links only with the beta off. */
    agentReach: Atom.family((environmentId: EnvironmentId | null) =>
      environmentId === null
        ? noReach
        : Atom.make((get): AgentLinkReach => {
            const config = get(serverConfig(environmentId));
            const offers = offersLinkedEnvironments(config);
            if (offers || !linksAccountComputers(config)) {
              return { offers, accountLinked: NO_COMPUTERS };
            }
            const held = AsyncResult.getOrElse(
              get(status({ environmentId, input: {} })),
              () => null,
            );
            return { offers, accountLinked: accountLinkedComputers(held) };
          }).pipe(
            Atom.withEquality<AgentLinkReach>(
              (a, b) => a.offers === b.offers && sameComputers(a.accountLinked, b.accountLinked),
            ),
            Atom.withLabel(`loom:account-links:agent-reach:${environmentId}`),
          ),
    ),
  };
}
