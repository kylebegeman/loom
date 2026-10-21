import { Link } from "@tanstack/react-router";
import {
  projectTemporaryResourceLabels,
  supportsLoomFeature,
  TEMPORARY_RESOURCES_EXPLANATION,
} from "@t3tools/client-runtime/fork";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { FEATURE, lanes, SETTINGS_HASH } from "../project-lifecycle/state";

export function TemporaryResources({
  copy,
  connected,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly connected: boolean;
}) {
  const { environments } = useEnvironments();
  const supported = supportsLoomFeature(
    environments.find((entry) => entry.environmentId === copy.environmentId)?.serverConfig
      ?.environment.capabilities,
    FEATURE,
  );
  const status = useEnvironmentQuery(
    connected && supported ? lanes.status({ environmentId: copy.environmentId, input: {} }) : null,
  );
  const labels = projectTemporaryResourceLabels({
    location: copy,
    status: status.data,
    connected,
    supported,
    failed: status.error !== null,
  });
  return (
    <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Temporary resources</p>
        {connected && supported ? (
          <Button
            variant="link"
            size="xs"
            render={
              <Link
                to="/settings/loom"
                search={{ machine: copy.environmentId }}
                hash={SETTINGS_HASH}
              />
            }
          >
            Computer storage settings
          </Button>
        ) : null}
      </div>
      <p>{labels.usage}</p>
      {labels.activity ? <p className="text-muted-foreground">{labels.activity}</p> : null}
      <p className="text-muted-foreground">{TEMPORARY_RESOURCES_EXPLANATION}</p>
    </div>
  );
}
