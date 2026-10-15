import { LoomLibraryAddress } from "~/fork/identity/LoomLibraryAddress";
import { LoomSignIn } from "~/fork/identity/LoomSignIn";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { LibraryErrorNotice } from "./LibraryControls";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { PROJECT_LIBRARY_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import {
  projectLibrary,
  readLibraryAuthorityId,
  useLibraryAuthority,
  useSelectedLibraryProject,
} from "./state";

/** Choose storage once; working-copy and conversation computers are separate choices. */
export function LibrarySetup({
  onSelected,
  showConnectionsLink = true,
}: {
  readonly onSelected?: () => void;
  readonly showConnectionsLink?: boolean;
}) {
  const authority = useLibraryAuthority();
  const [, selectProject] = useSelectedLibraryProject();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<EnvironmentId | null>(authority.authorityId);
  const signInBaseUrl = useEnvironmentHttpBaseUrl(candidate);
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
  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Choose your Library</h2>
        <p className="text-sm text-muted-foreground">
          Your Library stores projects and saved conversations. Choose where to keep it, then choose
          a computer whenever you start work.
        </p>
      </div>
      <Select
        items={authority.environments.map((entry) => ({
          value: entry.environmentId,
          label: entry.label,
        }))}
        value={candidate}
        onValueChange={(value) => setCandidate(value)}
      >
        <SelectTrigger aria-label="Library server">
          <SelectValue placeholder="Choose a Library server" />
        </SelectTrigger>
        <SelectPopup>
          {authority.environments.map((entry) => (
            <SelectItem key={entry.environmentId} value={entry.environmentId}>
              {entry.label}
              {entry.connection.phase === "connected" ? "" : " (offline)"}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {candidate ? (
        <p className="text-xs text-muted-foreground" role="status">
          {!connected
            ? "Reconnect this server to use its Library."
            : !supported
              ? "Update Loom on this server to use the Library."
              : !canRead
                ? "This connection cannot read the Library."
                : (query.error ??
                  (!query.isSuccess ? "Checking the Library..." : "Library ready."))}
        </p>
      ) : null}
      {authority.authorityId && candidate !== authority.authorityId ? (
        <p className="text-xs text-muted-foreground">
          Changing the Library server does not move your existing projects or history.
        </p>
      ) : null}
      {signInBaseUrl ? (
        <LoomSignIn baseUrl={signInBaseUrl} onConnected={setCandidate} />
      ) : (
        <LoomSignIn onConnected={setCandidate} />
      )}
      <LoomLibraryAddress onConnected={setCandidate} />
      <LibraryErrorNotice error={saveError} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!candidate || !connected || !query.isSuccess || query.isPending}
          onClick={() => {
            if (candidate) {
              authority.setAuthorityId(candidate);
              if (readLibraryAuthorityId() === candidate) {
                if (candidate !== authority.authorityId) selectProject(null);
                onSelected?.();
                setSaveError(null);
              } else {
                setSaveError(
                  "This browser could not save the Library choice. Allow site storage and try again.",
                );
              }
            }
          }}
        >
          Use this Library
        </Button>
        {showConnectionsLink ? (
          <Button variant="outline" render={<Link to="/settings/connections" />}>
            Connections
          </Button>
        ) : null}
      </div>
    </div>
  );
}
