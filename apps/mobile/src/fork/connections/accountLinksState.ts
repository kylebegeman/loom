import {
  accountLinkedComputers,
  createAccountLinkAtoms,
  linksAccountComputers,
} from "@t3tools/client-runtime/fork";
import { offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import type { EnvironmentId } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";

export const accountLinks = createAccountLinkAtoms(connectionAtomRuntime);

/**
 * How `environmentId` lists its links: `offers` while its Linked environments beta is on,
 * `linksAccount` when it links the account's computers itself, and `managed`, the computers it
 * holds an account link to (empty while unknown).
 */
export function useAccountLinksView(environmentId: EnvironmentId) {
  const config = useEnvironmentServerConfig(environmentId);
  const linksAccount = linksAccountComputers(config);
  const status = useEnvironmentQuery(
    linksAccount ? accountLinks.status({ environmentId, input: {} }) : null,
  );
  return {
    offers: offersLinkedEnvironments(config),
    linksAccount,
    managed: accountLinkedComputers(status.data),
  };
}
