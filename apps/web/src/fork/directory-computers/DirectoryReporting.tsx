import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { directoryReportingText, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { DIRECTORY_REPORTING_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import type { EnvironmentPresentation } from "~/state/environments";
import { Button } from "~/components/ui/button";
import { directoryReporting } from "./state";

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
  const report = Option.getOrNull(AsyncResult.value(result));
  if (!supported) return null;
  return (
    <section aria-label="Library sign-in and directory" className="space-y-2 px-3 py-3 sm:px-4">
      <h3 className="text-xs font-medium">Library sign-in and directory</h3>
      {report ? (
        directoryReportingText(report).map((text) => (
          <p key={text} className="text-xs text-muted-foreground">
            {text}
          </p>
        ))
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {environment.connection.phase !== "connected"
            ? "Reconnect to check this computer's Library sign-in."
            : AsyncResult.isFailure(result)
              ? "Could not read this computer's Library sign-in. Try again."
              : "Checking Library sign-in..."}
        </p>
      )}
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
