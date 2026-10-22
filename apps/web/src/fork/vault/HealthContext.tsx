import { VaultHealthRetained } from "./HealthRetained";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import {
  createVaultHealthAtoms,
  supportsLoomFeature,
  vaultHealthCoverageMessages,
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { LoomSettingsActions, LoomSettingsNotice, LoomSettingsPanel } from "../settings/parts";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { openVaultProfiles } from "./profile-navigation";
import { openVaultAccess } from "./access-navigation";
const atoms = createVaultHealthAtoms(connectionAtomRuntime);
export function VaultHealthContext({
  environmentId,
  itemId,
}: {
  environmentId: EnvironmentId;
  itemId: string;
}) {
  const configs = useServerConfigs();
  if (
    !supportsLoomFeature(
      configs.get(environmentId)?.environment.capabilities,
      "vault-health-context",
    )
  )
    return <LoomSettingsNotice>Project references need a newer Vault server.</LoomSettingsNotice>;
  return <ContextPage environmentId={environmentId} itemId={itemId} />;
}
function ContextPage({ environmentId, itemId }: { environmentId: EnvironmentId; itemId: string }) {
  const [cursor, setCursor] = useState<ProjectId | null>(null);
  const atom = atoms.context({ environmentId, input: { itemId, cursor } });
  const result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Current profile and grant references do not prove working access. Inspect retained run
        selections separately below. External consumers are not discovered.
      </p>
      <LoomSettingsActions>
        <Button size="sm-multiline" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
          Refresh project references
        </Button>
      </LoomSettingsActions>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Inspecting project references…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          Could not inspect project references. Check the connection and refresh.
        </LoomSettingsNotice>
      ) : null}
      {page && !result.waiting && result._tag !== "Failure" ? (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Inspected {page.inspectedProjects} projects on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </p>
          {vaultHealthCoverageMessages(page.coverage).map((message) => (
            <LoomSettingsNotice key={message}>{message}</LoomSettingsNotice>
          ))}
          {page.coverage && page.coverage.unattributedGrants > 0 ? (
            <LoomSettingsActions>
              <Button
                size="sm-multiline"
                variant="outline"
                onClick={() => openVaultAccess({ environmentId, itemId })}
              >
                Review unattributed grants
              </Button>
            </LoomSettingsActions>
          ) : null}
          {page.projects.length === 0 ? (
            <LoomSettingsNotice>
              No references in these projects. Continue to the next page if available.
            </LoomSettingsNotice>
          ) : null}
          <VaultHealthRetained
            environmentId={environmentId}
            itemId={itemId}
            projects={page.scannedProjects ?? page.projects}
          />
          {page.projects.map((project) => (
            <section
              key={project.id}
              aria-label={`References in ${project.title}`}
              className="min-w-0"
            >
              <LoomSettingsPanel title={<span className="wrap-anywhere">{project.title}</span>}>
                {project.profiles.length ? (
                  <div className="min-w-0 space-y-2">
                    <h4 className="text-sm font-medium">Profiles</h4>
                    <ul className="divide-y divide-border">
                      {project.profiles.map((profile) => (
                        <li
                          key={profile.id}
                          className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 wrap-anywhere text-sm font-medium">
                              {profile.label}
                            </p>
                            <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                              {profile.state}
                              {profile.isDefault ? " · Default" : ""}
                            </span>
                          </div>
                          <p className="wrap-anywhere text-sm leading-relaxed text-muted-foreground">
                            Requirements: {profile.requirements.join(", ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {project.grants.length ? (
                  <div className="min-w-0 space-y-2">
                    <h4 className="text-sm font-medium">Grants</h4>
                    <ul className="divide-y divide-border">
                      {project.grants.map((grant) => (
                        <li key={grant.id} className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 wrap-anywhere text-sm font-medium">
                              {grant.label}
                            </p>
                            <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                              {grant.state}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {grant.principalKind} grant
                            {grant.expiresAt === null
                              ? ""
                              : ` · Expires ${new Date(grant.expiresAt).toLocaleString()}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <LoomSettingsActions>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    onClick={() =>
                      openVaultProfiles({
                        environmentId,
                        projectId: project.id,
                        section: "profiles",
                      })
                    }
                  >
                    Review project profiles
                  </Button>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    onClick={() => openVaultAccess({ environmentId, itemId })}
                  >
                    Review grants
                  </Button>
                </LoomSettingsActions>
              </LoomSettingsPanel>
            </section>
          ))}
        </>
      ) : null}
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={!cursor || result.waiting}
          onClick={() => setCursor(null)}
        >
          First projects
        </Button>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={!page?.nextCursor || result.waiting || result._tag === "Failure"}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More projects
        </Button>
      </LoomSettingsActions>
    </div>
  );
}
