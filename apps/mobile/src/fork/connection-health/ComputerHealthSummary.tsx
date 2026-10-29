import { useAtomValue } from "@effect/atom-react";
import {
  computerDirectoryHealth,
  computerDisplayLabel,
  directoryComputersView,
  directoryReportingSummary,
  directoryReportingView,
  supportsLoomFeature,
  tailnetOnlyConnectionHint,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_FEATURE, DIRECTORY_REPORTING_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { directoryComputers } from "../directory-computers/state";
import { directoryReporting } from "../connections/reach";

export function ComputerHealthSummary({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const chosen = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  const libraryId = chosen ? EnvironmentId.make(chosen) : null;
  const libraryConfig = useEnvironmentServerConfig(libraryId);
  const { presentation: library } = useEnvironmentPresentation(libraryId);
  const { presentation: environment } = useEnvironmentPresentation(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const [shownAt, setShownAt] = useState(Date.now);
  useFocusEffect(
    useCallback(() => {
      setShownAt(Date.now());
    }, []),
  );
  const supported = libraryConfig
    ? supportsLoomFeature(libraryConfig.environment.capabilities, DIRECTORY_FEATURE)
    : null;
  const live = useAtomValue(directoryComputers.listing(supported === false ? null : libraryId));
  const stored = useAtomValue(directoryComputers.stored(libraryId));
  const answeredAt = AsyncResult.isSuccess(live) ? Date.parse(live.value.fetchedAt) : shownAt;
  const now = Math.max(shownAt, answeredAt);
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
    view.listing.listing === null || environment === null
      ? null
      : computerDirectoryHealth({
          listing: view.listing.listing,
          source: view.listing.source === "live" ? "live" : "cache",
          environmentId,
          label: computerDisplayLabel(environment),
          now,
        });
  const connected = environment?.connection.phase === "connected";
  const reportingSupported = supportsLoomFeature(
    config?.environment.capabilities,
    DIRECTORY_REPORTING_FEATURE,
  );
  const result = useAtomValue(
    directoryReporting(connected && reportingSupported ? environmentId : null),
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
    environment ? tailnetOnlyConnectionHint(environment.entry, environment.connection) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return text ? <Text className="text-xs text-foreground-muted">{text}</Text> : null;
}
