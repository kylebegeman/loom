import { useAtomValue } from "@effect/atom-react";
import {
  accountVaultState,
  connectsWithIdentity,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import type { AuthSessionState } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useLibraryAuthority } from "../library/libraryState";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { environmentSession } from "../../state/session";

const NO_SESSION = Atom.make(AsyncResult.initial<AuthSessionState>());

/** Whether this device's Library session can manage the account Vault, as on web. */
export function useAccountVault() {
  const authority = useLibraryAuthority();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const { presentation } = useEnvironmentPresentation(authority.environmentId);
  const session = useAtomValue(
    authority.environmentId === null
      ? NO_SESSION
      : environmentSession.sessionStateAtom(authority.environmentId),
  );
  const state = accountVaultState({
    authorityId: authority.environmentId,
    supported: supportsLoomFeature(config?.environment.capabilities, ACCOUNT_VAULT_FEATURE),
    connected: authority.connected,
    identity: connectsWithIdentity(presentation?.entry),
    session: AsyncResult.getOrElse(session, () => null),
    sessionFailed: session._tag === "Failure",
  });
  return { authority, state };
}
