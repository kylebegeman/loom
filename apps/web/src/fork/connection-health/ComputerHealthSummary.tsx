import { useAtomValue } from "@effect/atom-react";
import {
  computerDirectoryHealth,
  directoryComputersView,
  directoryReportingSummary,
  directoryReportingView,
  supportsLoomFeature,
  tailnetOnlyConnectionHint,
} from "@t3tools/client-runtime/fork";
import { DIRECTORY_FEATURE, DIRECTORY_REPORTING_FEATURE } from "@t3tools/contracts/fork";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironment, type EnvironmentPresentation } from "~/state/environments";
import { directoryComputers, directoryReporting } from "../directory-computers/state";
import { useLibraryAuthorityId } from "../project-library/state";

export function ComputerHealthSummary({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const libraryId = useLibraryAuthorityId();
  const library = useEnvironment(libraryId);
  const now = Date.parse(`${useNowMinute()}Z`);
  const supported = library?.serverConfig
    ? supportsLoomFeature(library.serverConfig.environment.capabilities, DIRECTORY_FEATURE)
    : null;
  const live = useAtomValue(directoryComputers.listing(supported === false ? null : libraryId));
  const stored = useAtomValue(directoryComputers.stored(libraryId));
  const view = directoryComputersView({
    authorityEnvironmentId: libraryId,
    supportsDirectory: supported,
    libraryConnection: library?.connection ?? null,
    live,
    stored,
    saved: [],
    now,
  });
  const health =
    view.listing.listing === null
      ? null
      : computerDirectoryHealth({
          listing: view.listing.listing,
          source: view.listing.source === "live" ? "live" : "cache",
          environmentId: environment.environmentId,
          label: environment.label,
          now,
        });
  const connected = environment.connection.phase === "connected";
  const reportingSupported = supportsLoomFeature(
    environment.serverConfig?.environment.capabilities,
    DIRECTORY_REPORTING_FEATURE,
  );
  const result = useAtomValue(
    directoryReporting(connected && reportingSupported ? environment.environmentId : null),
  );
  const reporting = directoryReportingView(result, connected);
  const summary =
    reporting.report === null
      ? (health?.text ?? (connected && reportingSupported ? reporting.notice : null))
      : `${reporting.stale ? "Last checked: " : ""}${directoryReportingSummary(reporting.report, now)}`;
  const text = [
    summary,
    reporting.notice !== summary &&
    ((reporting.report !== null && reporting.stale) ||
      (connected && reportingSupported && result._tag === "Failure"))
      ? reporting.notice
      : null,
    health?.attention,
    tailnetOnlyConnectionHint(environment.entry, environment.connection),
  ]
    .filter(Boolean)
    .join(" ");
  return text ? <p className="mt-1 break-words text-xs text-muted-foreground">{text}</p> : null;
}
