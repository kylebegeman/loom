import { useAtomValue } from "@effect/atom-react";
import {
  accountLinkedComputers,
  createAccountLinkAtoms,
  linksAccountComputers,
} from "@t3tools/client-runtime/fork";
import { offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";

export const accountLinks = createAccountLinkAtoms(connectionAtomRuntime);

/** Of a sorted JSON list of environments, those holding at least one account link. */
const accountLinkHosts = Atom.family((key: string) =>
  Atom.make((get) => {
    const environmentIds: ReadonlyArray<EnvironmentId> = JSON.parse(key);
    return new Set(
      environmentIds.filter((environmentId) => {
        const status = get(accountLinks.status({ environmentId, input: {} }));
        return accountLinkedComputers(AsyncResult.getOrElse(status, () => null)).size > 0;
      }),
    );
  }).pipe(Atom.withLabel(`account-links:hosts:${key}`)),
);

type LinkHost = Pick<EnvironmentPresentation, "environmentId" | "serverConfig">;

/**
 * Whether an environment has a Linked environments list to show: always while its beta is on,
 * and with the beta off only once it holds an account link.
 */
export function useListsLinkedEnvironments(
  environments: ReadonlyArray<LinkHost>,
): (environment: LinkHost) => boolean {
  const asked = environments
    .filter(
      ({ serverConfig }) =>
        !offersLinkedEnvironments(serverConfig) && linksAccountComputers(serverConfig),
    )
    .map(({ environmentId }) => environmentId)
    .sort();
  const hosts = useAtomValue(accountLinkHosts(JSON.stringify(asked)));
  return ({ environmentId, serverConfig }) =>
    offersLinkedEnvironments(serverConfig) || hosts.has(environmentId);
}

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
