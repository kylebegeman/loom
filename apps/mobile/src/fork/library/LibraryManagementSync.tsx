import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect } from "react";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession, useEnvironmentScope } from "../../state/session";
import { library } from "./libraryState";

export function LibraryManagementSync() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments
        .filter(
          (environment) =>
            environment.entry.enabled &&
            environment.connection.phase === "connected" &&
            environment.serverConfig?.environment.capabilities.supportsExecution !== false &&
            supportsLoomFeature(
              environment.serverConfig?.environment.capabilities,
              LIBRARY_MANAGEMENT_FEATURE,
            ),
        )
        .map((environment) => (
          <ComputerManagement
            key={environment.environmentId}
            environmentId={environment.environmentId}
          />
        ))}
    </>
  );
}

function ComputerManagement({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const info = useEnvironmentQuery(library.info({ environmentId, input: {} }));
  const authorityId = info.data?.destination?.environmentId ?? null;
  const { environments } = useEnvironments();
  const authority = environments.find((environment) => environment.environmentId === authorityId);
  const allowed = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const authorityAllowed = useEnvironmentScope(authorityId, AuthSettingsWriteScope);
  if (
    !authorityId ||
    !allowed ||
    !authorityAllowed ||
    !authority?.entry.enabled ||
    authority.connection.phase !== "connected" ||
    !supportsLoomFeature(
      authority.serverConfig?.environment.capabilities,
      LIBRARY_MANAGEMENT_FEATURE,
    )
  )
    return null;
  return <DelegateManagement environmentId={environmentId} authorityId={authorityId} />;
}

function DelegateManagement({
  environmentId,
  authorityId,
}: {
  readonly environmentId: EnvironmentId;
  readonly authorityId: EnvironmentId;
}) {
  const registry = useContext(RegistryContext);
  const session = useAtomValue(environmentSession.sessionStateAtom(authorityId));
  const expiresAt = AsyncResult.isSuccess(session)
    ? session.value.expiresAt?.epochMilliseconds
    : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes the enrolled computer's management delegation with the existing authenticated Library session
  useEffect(() => {
    if (expiresAt !== undefined && expiresAt <= Date.now()) return;
    void runAtomCommand(
      registry,
      library.prepareManagement,
      {
        environmentId,
        input: { authorityEnvironmentId: authorityId },
      },
      { reportFailure: false },
    );
  }, [registry, environmentId, authorityId, expiresAt]);
  return null;
}
