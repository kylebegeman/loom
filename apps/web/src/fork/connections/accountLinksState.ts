import { useAtomValue } from "@effect/atom-react";
import {
  accountLinkedComputers,
  createAccountLinkAtoms,
  linksAccountComputers,
  reachesOverLinks,
} from "@t3tools/client-runtime/fork";
import { offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

export const accountLinks = createAccountLinkAtoms(connectionAtomRuntime, (environmentId) =>
  serverEnvironment.configValueAtom(environmentId),
);

/** Of a sorted JSON list of environments, those whose agents reach a computer over links. */
const linkHosts = Atom.family((key: string) =>
  Atom.make((get) => {
    const environmentIds: ReadonlyArray<EnvironmentId> = JSON.parse(key);
    return environmentIds.filter((environmentId) =>
      reachesOverLinks(get(accountLinks.agentReach(environmentId))),
    );
  }).pipe(
    Atom.withEquality<ReadonlyArray<EnvironmentId>>(
      (a, b) =>
        a.length === b.length && a.every((environmentId, index) => b[index] === environmentId),
    ),
    Atom.withLabel(`account-links:hosts:${key}`),
  ),
);

/**
 * Whether an environment has a Linked environments list to show: always while its beta is on,
 * and with the beta off only once it holds an account link.
 */
export function useListsLinkedEnvironments(
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
): (environment: { readonly environmentId: EnvironmentId }) => boolean {
  const key = JSON.stringify(environments.map(({ environmentId }) => environmentId).sort());
  const hosts = new Set(useAtomValue(linkHosts(key)));
  return ({ environmentId }) => hosts.has(environmentId);
}

/** What `environmentId`'s agents reach over links, for composer mentions to follow. */
export const useAgentLinkReach = (environmentId: EnvironmentId | null) =>
  useAtomValue(accountLinks.agentReach(environmentId));

/**
 * How `environmentId` lists its links: `offers` while its Linked environments beta is on, and
 * `managed`, the computers it holds an account link to (empty while unknown).
 */
export function useAccountLinksView(environmentId: EnvironmentId) {
  const config = useServerConfigs().get(environmentId);
  const status = useEnvironmentQuery(
    linksAccountComputers(config) ? accountLinks.status({ environmentId, input: {} }) : null,
  );
  return { offers: offersLinkedEnvironments(config), managed: accountLinkedComputers(status.data) };
}
