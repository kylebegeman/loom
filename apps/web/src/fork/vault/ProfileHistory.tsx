import { useServerConfigs } from "~/state/entities";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createVaultProfileAtoms } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
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
    <section aria-label="Retained run selections" className="flex flex-col gap-3">
      <h3 className="font-medium">Retained run selections</h3>
      <p className="text-sm">
        Inspect the exact profile revision and key versions a run selected. Retire stopped
        selections to remove their current binding snapshot. Retirement cannot be undone. OpenBao
        version history remains; credentials and grants are unchanged.
      </p>
      <Button
        size="sm"
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
      {result.waiting ? <p role="status">Loading run selections…</p> : null}
      {result._tag === "Failure" || error ? (
        <p role="alert">
          {error ?? "Could not load run selections. Refresh after checking Vault access."}
        </p>
      ) : null}
      {page?.items.length === 0 ? <p>No retained selections in this page.</p> : null}
      {page?.items.map((pin) => (
        <div key={pin.id} className="flex flex-col gap-2 rounded-md border p-3">
          <p>
            {pin.resolution?.label ?? "Retired selection"} · {pin.runState}
          </p>
          <p className="break-all text-sm">
            Thread {pin.threadId} · Run {pin.runId}
          </p>
          <p className="text-sm">
            {pin.createdAt
              ? `Selected ${pin.createdAt}`
              : "Selection time unavailable for this older record"}
            {pin.retiredAt ? ` · Retired ${pin.retiredAt}` : ""}
          </p>
          {pin.resolution ? (
            <details>
              <summary>Inspect pinned bindings</summary>
              <p>Profile version {pin.resolution.profileVersion}</p>
              {pin.resolution.bindings.map((b) => (
                <p key={b.name} className="break-all text-sm">
                  {b.name} · {b.kind === "github" ? "connection" : "key"} {b.itemId} version{" "}
                  {b.version} · {b.destination}
                </p>
              ))}
            </details>
          ) : null}
          {confirm === pin.id ? (
            <>
              <p>
                Retire this stopped selection permanently? This run will be denied if resumed. A new
                run can select a profile.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
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
                  Retire selection permanently
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel retirement
                </Button>
              </div>
            </>
          ) : pin.resolution ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canWrite || !pin.canRetire}
              onClick={() => setConfirm(pin.id)}
            >
              Retire stopped selection
            </Button>
          ) : null}
          {!pin.canRetire && pin.resolution ? (
            <p className="text-sm">
              Only confirmed terminal runs can be retired. Active or unavailable runs are retained.
            </p>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
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
          size="sm"
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => {
            setCursor(page?.nextCursor ?? null);
            setConfirm(null);
          }}
        >
          More selections
        </Button>
      </div>
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
  return <History {...props} />;
}
