import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import { createVaultHealthAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { openVaultProfiles } from "./profile-navigation";
const atoms = createVaultHealthAtoms(connectionAtomRuntime);
export function VaultHealthRetained({
  environmentId,
  itemId,
  projects,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  projects: ReadonlyArray<{ id: ProjectId; title: string }>;
}) {
  const configs = useServerConfigs();
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  if (
    !supportsLoomFeature(
      configs.get(environmentId)?.environment.capabilities,
      "vault-health-retained",
    )
  )
    return <p>Retained selection discovery needs a newer Vault server.</p>;
  return (
    <section aria-label="Retained selections" className="flex flex-col gap-3">
      <p className="font-medium">Retained run selections</p>
      <p>
        Check a project on this page, including projects without current references. A retained
        selection records earlier use, not current access. Retired snapshots and consumers outside
        Loom may be unknown.
      </p>
      <label>
        Project to inspect
        <select
          aria-label="Retained selection project"
          value={projects.some((p) => p.id === projectId) ? (projectId ?? "") : ""}
          onChange={(e) => setProjectId(e.target.value ? ProjectId.make(e.target.value) : null)}
        >
          <option value="">Choose a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      {projectId && projects.some((p) => p.id === projectId) ? (
        <SelectionPage
          key={projectId}
          environmentId={environmentId}
          itemId={itemId}
          projectId={projectId}
        />
      ) : null}
    </section>
  );
}
function SelectionPage({
  environmentId,
  itemId,
  projectId,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  projectId: ProjectId;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const atom = atoms.retained({ environmentId, input: { itemId, projectId, cursor } });
  const result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
        Refresh retained selections
      </Button>
      {result.waiting ? <p role="status">Inspecting retained selections…</p> : null}
      {result._tag === "Failure" ? (
        <p role="alert">Could not inspect retained selections. Refresh and retry.</p>
      ) : null}
      {page && !result.waiting && result._tag !== "Failure" ? (
        <>
          <p>
            Inspected {page.inspectedSelections} selections on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </p>
          {page.unattributableSelections > 0 ? (
            <p>
              {page.unattributableSelections} retired selections have no binding snapshot and cannot
              be attributed to an item.
            </p>
          ) : null}
          {page.items.length === 0 ? (
            <p>
              No matching retained selections on this page. Continue if more pages are available.
            </p>
          ) : null}
          {page.items.map((pin) => (
            <div key={pin.id} className="flex flex-col gap-1 rounded-md border p-3">
              <p>
                {pin.profileLabel} · Profile version {pin.profileVersion} · {pin.runState}
              </p>
              <p>
                Thread {pin.threadId} · Run {pin.runId}
              </p>
              <p>
                {pin.bindings.map((b) => `${b.name}: item version ${b.itemVersion}`).join(", ")}
              </p>
              <p>
                {pin.canRetire
                  ? "Stopped selection. Review it before retiring its current binding snapshot."
                  : "This selection cannot currently be retired."}
              </p>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openVaultProfiles({ environmentId, projectId, section: "profiles" })}
          >
            Review project run selections
          </Button>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!cursor || result.waiting}
          onClick={() => setCursor(null)}
        >
          First retained selections
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!page?.nextCursor || result.waiting || result._tag === "Failure"}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More retained selections
        </Button>
      </div>
    </div>
  );
}
