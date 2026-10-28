import { LoomSettingsActions, LoomSettingsField, LoomSettingsNotice } from "../settings/parts";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import {
  createVaultHealthAtoms,
  supportsLoomFeature,
  vaultHealthCoverageMessages,
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
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
    <section aria-label="Retained selections" className="flex min-w-0 flex-col gap-4">
      <p className="font-medium">Retained run selections</p>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Check a project on this page, including projects without current references. A retained
        selection records earlier use, not current access. Retired snapshots and consumers outside
        Loom may be unknown.
      </p>
      <LoomSettingsField label="Project to inspect">
        <Select
          value={projects.some((p) => p.id === projectId) ? (projectId ?? "") : ""}
          onValueChange={(nextValue) => setProjectId(nextValue ? ProjectId.make(nextValue) : null)}
        >
          <SelectTrigger aria-label="Retained selection project">
            <SelectValue>
              {projects.find((p) => p.id === projectId)?.title ?? "Choose a project"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Choose a project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
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
    <div className="flex min-w-0 flex-col gap-4">
      <LoomSettingsActions>
        <Button size="sm-multiline" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
          Refresh retained selections
        </Button>
      </LoomSettingsActions>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Inspecting retained selections…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          Could not inspect retained selections. Refresh and retry.
        </LoomSettingsNotice>
      ) : null}
      {page && !result.waiting && result._tag !== "Failure" ? (
        <>
          <p>
            Inspected {page.inspectedSelections} selections on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </p>
          {vaultHealthCoverageMessages(page.coverage).map((message) => (
            <p key={message}>{message}</p>
          ))}
          {page.unattributableSelections > 0 ? (
            <p>
              Retired selections without binding snapshots: {page.unattributableSelections}. Their
              item references are unknown.
            </p>
          ) : null}
          {page.items.length === 0 ? (
            <p>
              No matching retained selections on this page. Continue if more pages are available.
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col divide-y divide-border/60">
            {page.items.map((pin) => (
              <div
                key={pin.id}
                className="flex min-w-0 flex-col gap-3 py-3 text-sm wrap-anywhere first:pt-0 last:pb-0"
              >
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
          </div>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="outline"
              onClick={() => openVaultProfiles({ environmentId, projectId, section: "profiles" })}
            >
              Review project run selections
            </Button>
          </LoomSettingsActions>
        </>
      ) : null}
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={!cursor || result.waiting}
          onClick={() => setCursor(null)}
        >
          First retained selections
        </Button>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={!page?.nextCursor || result.waiting || result._tag === "Failure"}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More retained selections
        </Button>
      </LoomSettingsActions>
    </div>
  );
}
