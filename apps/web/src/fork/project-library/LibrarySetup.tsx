import { LoomLibraryAddress } from "~/fork/identity/LoomLibraryAddress";
import { LoomSignIn } from "~/fork/identity/LoomSignIn";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { LibraryErrorNotice } from "./LibraryControls";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { PROJECT_LIBRARY_FEATURE } from "@t3tools/contracts/fork";
import {
  librarySignInTarget,
  squashLibraryCommandFailure,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useEnvironmentScope } from "~/state/session";
import {
  projectLibrary,
  readLibraryAuthorityId,
  useLibraryAuthority,
  useSelectedLibraryProject,
} from "./state";

export const LIBRARY_SETUP_DESCRIPTION =
  "Sign in once to open your computers, projects and saved conversations on all your devices.";

/** Choose storage once; working-copy and conversation computers are separate choices. */
export function LibrarySetup({
  onSelected,
  showConnectionsLink = true,
  heading = true,
}: {
  readonly onSelected?: () => void;
  readonly showConnectionsLink?: boolean;
  /** Off when a dialog already names the step. */
  readonly heading?: boolean;
}) {
  const authority = useLibraryAuthority();
  const [, selectProject] = useSelectedLibraryProject();
  const [saveError, setSaveError] = useState<string | null>(null);
  const readInfo = useAtomQueryRunner(projectLibrary.info, { refresh: true, reportFailure: false });
  const eligible = authority.environments.filter(
    (entry) =>
      supportsLoomFeature(entry.serverConfig?.environment.capabilities, PROJECT_LIBRARY_FEATURE) &&
      entry.serverConfig?.environment.capabilities.libraryAuthority !== false,
  );
  const onlyLibraryId = eligible.length === 1 ? eligible[0]!.environmentId : null;
  const [chosenCandidate, setCandidate] = useState<EnvironmentId | null>(authority.authorityId);
  const candidate = chosenCandidate ?? onlyLibraryId;
  const connectedBaseUrl = useEnvironmentHttpBaseUrl(candidate);
  const environment = authority.environments.find((entry) => entry.environmentId === candidate);
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_LIBRARY_FEATURE,
  );
  const canRead = useEnvironmentScope(candidate, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    candidate && connected && supported && canRead
      ? projectLibrary.info({ environmentId: candidate, input: {} })
      : null,
  );
  const signInTarget = librarySignInTarget({
    candidate:
      query.data ??
      (environment?.serverConfig?.environment.capabilities.libraryAuthority === true
        ? { environmentId: environment.environmentId, isAuthority: true }
        : null),
    candidateUrl: connectedBaseUrl,
    destination: authority.destination,
  });
  const chooseLibrary = (environmentId: EnvironmentId) => {
    authority.setAuthorityId(environmentId);
    if (readLibraryAuthorityId() === environmentId) {
      if (environmentId !== authority.authorityId) selectProject(null);
      setSaveError(null);
      onSelected?.();
    } else {
      setSaveError(
        "This device could not save your account connection. Allow site storage and try again.",
      );
    }
  };
  const finishSignIn = async (environmentId: EnvironmentId) => {
    setCandidate(environmentId);
    const result = await readInfo({ environmentId, input: {} });
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      setSaveError(
        cause instanceof Error
          ? cause.message
          : "Loom could not verify your account connection. Try again.",
      );
    } else if (result.value.environmentId !== environmentId || result.value.isAuthority !== true) {
      setSaveError(
        "This address is a work computer. Enter your Library address to sign in to your account.",
      );
    } else {
      chooseLibrary(environmentId);
    }
  };
  return (
    <div className="max-w-xl space-y-4">
      {heading ? (
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Sign in to Loom</h2>
          <p className="text-sm text-muted-foreground">{LIBRARY_SETUP_DESCRIPTION}</p>
        </div>
      ) : null}
      {!signInTarget ? (
        <p className="text-sm text-muted-foreground" role="status">
          Enter your Library address to sign in to your Loom account.
        </p>
      ) : null}
      {eligible.length > 1 ? (
        <Select
          items={eligible.map((entry) => ({
            value: entry.environmentId,
            label: entry.label,
          }))}
          value={candidate}
          onValueChange={(value) => setCandidate(value)}
        >
          <SelectTrigger aria-label="Library connection">
            <SelectValue placeholder="Choose your Library connection" />
          </SelectTrigger>
          <SelectPopup>
            {eligible.map((entry) => (
              <SelectItem key={entry.environmentId} value={entry.environmentId}>
                {entry.label}
                {entry.connection.phase === "connected" ? "" : " (offline)"}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {candidate && !signInTarget ? (
        <p className="text-xs text-muted-foreground" role="status">
          {!connected
            ? "Reconnect this server to use its Library."
            : !supported
              ? "Update Loom on this server to use the Library."
              : !canRead
                ? "This connection cannot read the Library."
                : (query.error ??
                  (!query.isSuccess
                    ? "Checking the Library..."
                    : query.data?.isAuthority !== true
                      ? "This computer runs work. Connect your shared Library server instead."
                      : "Library ready."))}
        </p>
      ) : null}
      {authority.authorityId && candidate !== authority.authorityId ? (
        <p className="text-xs text-muted-foreground">
          Changing the Library server does not move your existing projects or history.
        </p>
      ) : null}
      {signInTarget ? (
        <LoomSignIn
          baseUrl={signInTarget.url}
          expectedEnvironmentId={signInTarget.environmentId}
          onConnected={(id) => void finishSignIn(id)}
          actionLabel="Sign in to Loom"
          description={false}
          showUnavailable
        />
      ) : null}
      <LoomLibraryAddress onConnected={(id) => void finishSignIn(id)} />
      <LibraryErrorNotice error={saveError} />
      <div className="flex flex-wrap gap-2">
        {candidate && connected && query.isSuccess && query.data?.isAuthority === true ? (
          <Button disabled={query.isPending} onClick={() => chooseLibrary(candidate)}>
            Use this account
          </Button>
        ) : null}
        {showConnectionsLink ? (
          <Button variant="outline" render={<Link to="/settings/connections" />}>
            Open computers
          </Button>
        ) : null}
      </div>
    </div>
  );
}
