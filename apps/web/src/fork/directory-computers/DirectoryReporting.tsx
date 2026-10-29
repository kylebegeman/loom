import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  backgroundCheckFailureText,
  directoryReportingText,
  directoryReportingView,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { DIRECTORY_REPORTING_FEATURE } from "@t3tools/contracts/fork";
import type { EnvironmentPresentation } from "~/state/environments";
import { Button } from "~/components/ui/button";
import { useNowMinute } from "~/hooks/useNowMinute";
import { directoryReporting } from "./state";
import { ForgetDirectoryEntry } from "./ForgetDirectoryEntry";

export function DirectoryReporting({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const supported =
    environment.serverConfig &&
    supportsLoomFeature(
      environment.serverConfig.environment.capabilities,
      DIRECTORY_REPORTING_FEATURE,
    );
  const atom = directoryReporting(
    supported && environment.connection.phase === "connected" ? environment.environmentId : null,
  );
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const view = directoryReportingView(result, environment.connection.phase === "connected");
  const report = view.report;
  const now = Date.parse(`${useNowMinute()}Z`);
  if (!supported) return null;
  return (
    <section aria-label="Library sign-in and directory" className="space-y-2 px-3 py-3 sm:px-4">
      <h3 className="text-xs font-medium">Library sign-in and directory</h3>
      {report ? (
        <>
          {directoryReportingText(report, now).map((text, index) => (
            <p key={text} className="break-words text-xs text-muted-foreground">
              {index === 0 && view.stale ? "Last checked: " : ""}
              {text}
            </p>
          ))}
          {backgroundCheckFailureText(report, now).map((text) => (
            <p key={text} className="break-words text-xs text-destructive">
              {text}
            </p>
          ))}
          {report.state === "key-changed" ? (
            <ForgetDirectoryEntry
              request={{ kind: "environment", environmentId: environment.environmentId }}
              label={environment.label}
              title="Forget in your Library"
            />
          ) : null}
        </>
      ) : null}
      {view.notice ? (
        <p role="status" className="break-words text-xs text-muted-foreground">
          {view.notice}
        </p>
      ) : null}
      <Button
        size="xs"
        variant="ghost-muted"
        onClick={() => refresh()}
        disabled={environment.connection.phase !== "connected" || result.waiting}
      >
        Refresh Library status
      </Button>
    </section>
  );
}
