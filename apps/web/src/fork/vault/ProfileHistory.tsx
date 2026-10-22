import { useServerConfigs } from "~/state/entities";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createVaultProfileAtoms } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
const atoms = createVaultProfileAtoms(connectionAtomRuntime);
function History({
  environmentId,
  projectId,
  canWrite,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  canWrite: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const atom = atoms.pins({ environmentId, input: { projectId, cursor } }),
    result = useAtomValue(atom),
    page = result._tag === "Success" && !result.waiting ? result.value : null;
  return (
    <section aria-label="Retained run selections" className="flex min-w-0 flex-col gap-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Retained run selections</h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Inspect the exact profile revision and key versions a run selected. Retire stopped
          selections to remove their current binding snapshot. Retirement cannot be undone. OpenBao
          version history remains; credentials and grants are unchanged.
        </p>
      </div>
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setConfirm(null);
            setError(null);
            appAtomRegistry.refresh(atom);
          }}
        >
          Refresh run selections
        </Button>
      </LoomSettingsActions>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Loading run selections…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" || error ? (
        <LoomSettingsNotice role="alert">
          {error ?? "Could not load run selections. Refresh after checking Vault access."}
        </LoomSettingsNotice>
      ) : null}
      {page?.items.length === 0 ? (
        <LoomSettingsNotice>No retained selections on this page.</LoomSettingsNotice>
      ) : null}
      {page?.items.map((pin) => (
        <LoomSettingsPanel key={pin.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 className="min-w-0 wrap-anywhere text-sm font-medium">
              {pin.resolution?.label ?? "Retired selection"}
            </h4>
            <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">{pin.runState}</span>
          </div>
          <p className="wrap-anywhere text-xs leading-relaxed text-muted-foreground">
            {pin.createdAt
              ? `Selected ${pin.createdAt}`
              : "Selection time unavailable for this older record"}
            {pin.retiredAt ? ` · Retired ${pin.retiredAt}` : ""}
          </p>
          <LoomSettingsDetails title="Run details">
            <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
              <div className="min-w-0 space-y-1">
                <dt className="text-muted-foreground">Thread ID</dt>
                <dd className="wrap-anywhere">{pin.threadId}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="text-muted-foreground">Run ID</dt>
                <dd className="wrap-anywhere">{pin.runId}</dd>
              </div>
            </dl>
          </LoomSettingsDetails>
          {pin.resolution ? (
            <LoomSettingsDetails title="Inspect pinned bindings">
              <p className="text-sm text-muted-foreground">
                Profile version {pin.resolution.profileVersion}
              </p>
              <ul className="divide-y divide-border">
                {pin.resolution.bindings.map((b) => (
                  <li
                    key={b.name}
                    className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <p className="wrap-anywhere text-sm font-medium">{b.name}</p>
                    <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                      <div className="min-w-0 space-y-1">
                        <dt className="text-muted-foreground">
                          {b.kind === "github" ? "Connection ID" : "Key ID"}
                        </dt>
                        <dd className="wrap-anywhere">{b.itemId}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Version</dt>
                        <dd>{b.version}</dd>
                      </div>
                      <div className="min-w-0 space-y-1 col-span-full">
                        <dt className="text-muted-foreground">Destination</dt>
                        <dd className="wrap-anywhere">{b.destination}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </LoomSettingsDetails>
          ) : null}
          {confirm === pin.id ? (
            <LoomSettingsNotice>
              <div className="flex flex-col gap-3">
                <p>
                  Retire this stopped selection permanently? This run will be denied if resumed. A
                  new run can select a profile.
                </p>
                <LoomSettingsActions>
                  <Button
                    size="sm-multiline"
                    variant="destructive"
                    disabled={busy || !canWrite || !pin.canRetire}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      void runVault(atoms.retirePin, {
                        environmentId,
                        input: {
                          projectId,
                          id: pin.id,
                          expectedVersion: pin.version,
                          operationId: randomUUID().replaceAll("-", ""),
                        },
                      })
                        .then(
                          () => setConfirm(null),
                          (cause: unknown) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "Retirement failed. Refresh and review the run state.",
                            ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Retiring selection…" : "Retire selection permanently"}
                  </Button>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirm(null)}
                  >
                    Cancel retirement
                  </Button>
                </LoomSettingsActions>
              </div>
            </LoomSettingsNotice>
          ) : pin.resolution ? (
            <LoomSettingsActions>
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={busy || !canWrite || !pin.canRetire}
                onClick={() => setConfirm(pin.id)}
              >
                Retire stopped selection
              </Button>
            </LoomSettingsActions>
          ) : null}
          {!pin.canRetire && pin.resolution ? (
            <LoomSettingsNotice>
              Only confirmed terminal runs can be retired. Active or unavailable runs are retained.
            </LoomSettingsNotice>
          ) : null}
        </LoomSettingsPanel>
      ))}
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy || !cursor || result.waiting}
          onClick={() => {
            setCursor(null);
            setConfirm(null);
          }}
        >
          First selections
        </Button>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => {
            setCursor(page?.nextCursor ?? null);
            setConfirm(null);
          }}
        >
          More selections
        </Button>
      </LoomSettingsActions>
    </section>
  );
}

export function VaultProfileHistory(props: Parameters<typeof History>[0]) {
  const configs = useServerConfigs();
  if (
    !supportsLoomFeature(
      configs.get(props.environmentId)?.environment.capabilities,
      "vault-profile-history",
    )
  )
    return null;
  return (
    <LoomSettingsDetails title="Retained run selections">
      <History {...props} />
    </LoomSettingsDetails>
  );
}
