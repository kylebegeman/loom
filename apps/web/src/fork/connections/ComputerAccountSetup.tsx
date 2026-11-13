import { randomUUID } from "~/lib/utils";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { reach } from "../reach/state";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  squashLibraryCommandFailure,
  supportsLoomFeature,
  directoryReportingView,
  accountComputerEnrollmentReady,
} from "@t3tools/client-runtime/fork";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { LibraryError, ACCOUNT_ENROLLMENT_FEATURE } from "@t3tools/contracts/fork";
import { useState } from "react";
import * as Schema from "effect/Schema";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { Button } from "~/components/ui/button";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";
import { requestLibraryConnect } from "../project-library/libraryPaletteSession";
import { directoryReporting } from "../directory-computers/state";

const isLibraryError = Schema.is(LibraryError);
const RequestId = Schema.NullOr(Schema.String);

export function ComputerAccountSetup({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const supported = supportsLoomFeature(
    environment.serverConfig?.environment.capabilities,
    ACCOUNT_ENROLLMENT_FEATURE,
  );
  if (
    !supported ||
    environment.serverConfig?.environment.capabilities.libraryAuthority === true ||
    environment.serverConfig?.environment.capabilities.supportsExecution === false
  )
    return null;
  return <ComputerAccountSetupForm key={environment.environmentId} environment={environment} />;
}

function ComputerAccountSetupForm({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const authority = useLibraryAuthority();
  const connected = environment.connection.phase === "connected";
  const source = useEnvironmentQuery(
    connected ? projectLibrary.info({ environmentId: environment.environmentId, input: {} }) : null,
  );
  const computers = useEnvironmentQuery(
    authority.connected && authority.authorityId
      ? projectLibrary.accountComputers({ environmentId: authority.authorityId, input: {} })
      : null,
  );
  const canInstall = useAtomValue(
    projectLibrary.enrollComputer.permissionAtom(environment.environmentId),
  );
  const canApprove = useEnvironmentScope(authority.authorityId, AuthSettingsWriteScope);
  const enroll = useAtomCommand(projectLibrary.enrollComputer, { reportFailure: false });
  const reportAtom = directoryReporting(connected ? environment.environmentId : null);
  const refreshReport = useAtomRefresh(reportAtom);
  const report = directoryReportingView(useAtomValue(reportAtom), connected).report;
  const route = useAtomValue(reach.status(connected ? environment.environmentId : null));
  const key = `loom:account-enrollment:v1:${environment.environmentId}:${authority.authorityId}`;
  const [savedRequestId, saveRequestId] = useLocalStorage(key, null, RequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  const finished = finishedFor === key;
  const available = connected && authority.connected && canInstall && canApprove;
  const signedIn = report?.signIn?.state === "ready" || report?.signIn?.state === "expiring";
  const ready = accountComputerEnrollmentReady({
    libraryEnvironmentId: authority.authorityId,
    sourceLibraryEnvironmentId: source.data?.destination?.environmentId ?? null,
    membership: computers.isSuccess
      ? (computers.data?.find((computer) => computer.environmentId === environment.environmentId) ??
        null)
      : null,
    signedIn,
    remoteEnabled: Option.exists(AsyncResult.value(route), (status) => status.enabled),
  });
  const start = async () => {
    if (busy || !available || !authority.authorityId) return;
    setBusy(true);
    setError(null);
    try {
      const requestId = savedRequestId ?? randomUUID();
      saveRequestId(requestId);
      if (getLocalStorageItem(key, RequestId) !== requestId) {
        setError("Loom could not save this setup request. Allow site storage and try again.");
      } else {
        const result = await enroll({
          environmentId: environment.environmentId,
          input: { authorityEnvironmentId: authority.authorityId, requestId },
        });
        if (result._tag === "Failure") {
          const cause = squashLibraryCommandFailure(result);
          if (isLibraryError(cause) && cause.reason === "request-conflict") saveRequestId(null);
          setError(
            cause instanceof Error ? cause.message : "Setup could not finish. Resume to continue.",
          );
        } else {
          saveRequestId(null);
          setFinishedFor(key);
          refreshReport();
          source.refresh();
          computers.refresh();
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Setup could not finish. Resume to continue.",
      );
    }
    setBusy(false);
  };
  return (
    <section
      aria-label="Account access"
      className="space-y-3 rounded-xl bg-secondary/40 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {ready ? "Connected to your account" : "Use this computer from your other devices"}
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {ready
            ? "Your Library keeps this computer’s saved work. Account access uses the same sign-in on your phone, Mac and browser."
            : "Add it once. Loom connects your Library, saves conversations and sets up remote access for your other devices."}
        </p>
      </div>
      {!authority.authorityId || !authority.connected ? (
        <Button size="sm" variant="outline" onClick={() => requestLibraryConnect("computers")}>
          Sign in to Loom
        </Button>
      ) : !ready || savedRequestId ? (
        <Button
          size="sm"
          variant="default"
          disabled={!available || busy || !computers.isSuccess || computers.isPending}
          onClick={() => void start()}
        >
          {busy ? "Setting up computer..." : savedRequestId ? "Resume setup" : "Add to my account"}
        </Button>
      ) : null}
      {authority.connected && !available ? (
        <p role="status" className="text-xs text-muted-foreground">
          {!connected
            ? "Reconnect this computer to finish setup."
            : "Full settings access is needed on this computer and your Library."}
        </p>
      ) : null}
      {finished ? (
        <p role="status" className="text-xs text-muted-foreground">
          Computer added. Remote access starts automatically.
        </p>
      ) : null}
      {computers.error ? (
        <p role="alert" className="text-sm text-destructive">
          {computers.error}
          <Button size="sm" variant="outline" onClick={computers.refresh}>
            Check account setup again
          </Button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
