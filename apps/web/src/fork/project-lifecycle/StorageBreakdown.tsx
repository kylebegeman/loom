import { useNavigate } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { PROJECT_STORAGE_FEATURE, type ProjectStorageCategory } from "@t3tools/contracts/fork";
import {
  createProjectStorageAtoms,
  STORAGE_CATEGORY_LABELS,
  storageBytes,
  storageCategorySize,
  storageCategoryDetail,
  storageMeasuredAge,
  storageReviewDestinations,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useServerConfigs } from "~/state/entities";
import { useNowMinute } from "~/hooks/useNowMinute";

const storage = createProjectStorageAtoms(connectionAtomRuntime);

function ComputerStorage({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const navigate = useNavigate();
  const review = (kind: ProjectStorageCategory) => {
    if (kind === "library-copies") void navigate({ to: "/library" });
    else
      void navigate({
        to: storageReviewDestinations[kind].to,
        search: { machine: environmentId, project: undefined, checkout: undefined },
        hash: storageReviewDestinations[kind].hash,
      });
  };
  const allowed = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(allowed ? storage.report({ environmentId, input: {} }) : null);
  const refresh = useAtomCommand(storage.refresh, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00.000Z`);
  const measure = () => {
    setRefreshing(true);
    setError(null);
    void refresh({ environmentId, input: { refresh: true } })
      .then((result) => {
        if (result._tag === "Failure") setError("Storage could not be refreshed. Try again.");
      })
      .catch(() => setError("Storage could not be refreshed. Try again."))
      .finally(() => setRefreshing(false));
  };
  const data = query.data;
  return (
    <div className="min-w-0">
      <SettingsRow
        title={label}
        description={
          data
            ? `Measured ${storageMeasuredAge(data.breakdown.measuredAt, now)}. Sizes estimate space occupied by these files.`
            : !allowed
              ? "Read access is required to measure storage."
              : query.isPending
                ? "Measuring storage…"
                : "Storage is unavailable."
        }
        control={
          <Button
            variant="outline"
            size="xs"
            disabled={!allowed || refreshing || query.isPending}
            onClick={() => void measure()}
          >
            {refreshing ? "Measuring…" : "Refresh"}
          </Button>
        }
      />
      {error || query.error ? (
        <p className="px-4 py-2 text-sm text-destructive-foreground" role="alert">
          {error ?? query.error}
        </p>
      ) : null}
      {data?.breakdown.categories.map((row) => (
        <SettingsRow
          key={row.kind}
          title={STORAGE_CATEGORY_LABELS[row.kind]}
          description={storageCategoryDetail(row)}
          control={
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-sm tabular-nums">{storageCategorySize(row)}</span>
              <Button variant="link" size="xs" onClick={() => review(row.kind)}>
                Review
              </Button>
            </div>
          }
        />
      ))}
      {data && (data.cleanup || data.additionalEntries.length > 0) ? (
        <details className="px-4 py-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Recent cleanup
            {data.additionalBytesFreed > 0
              ? ` · ${storageBytes(data.additionalBytesFreed)} from Library releases`
              : ""}
          </summary>
          <p className="mt-2">
            {data.cleanup
              ? `Last cleanup freed ${storageBytes(data.cleanup.bytesFreed)}.`
              : "No general cleanup report yet."}{" "}
            Cleanup history is separate from the sizes above.
          </p>
          {data.additionalEntries.slice(0, 10).map((entry) => (
            <p className="mt-1 break-all" key={entry.id}>
              {entry.kind === "library-copy" ? "Library copy" : "Git mirror"}:{" "}
              {entry.bytes === null ? "size not measured" : storageBytes(entry.bytes)}.{" "}
              {entry.reason}
            </p>
          ))}
        </details>
      ) : null}
    </div>
  );
}

export function StorageBreakdown({
  environments,
}: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
}) {
  const configs = useServerConfigs();
  const supported = environments.filter((environment) =>
    supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      PROJECT_STORAGE_FEATURE,
    ),
  );
  if (supported.length === 0) return null;
  return (
    <SettingsSection id="storage-breakdown" title="Storage by computer">
      {supported.map((environment) => (
        <ComputerStorage key={environment.environmentId} {...environment} />
      ))}
    </SettingsSection>
  );
}
