import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { createVaultHealthAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
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
    return <p>Project references need a newer Vault server.</p>;
  return <ContextPage environmentId={environmentId} itemId={itemId} />;
}
function ContextPage({ environmentId, itemId }: { environmentId: EnvironmentId; itemId: string }) {
  const [cursor, setCursor] = useState<ProjectId | null>(null);
  const atom = atoms.context({ environmentId, input: { itemId, cursor } });
  const result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  return (
    <div className="flex flex-col gap-3">
      <p>
        Current profile and grant references only. These do not prove working access. Retained run
        selections and external consumers are not listed.
      </p>
      <Button size="sm" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
        Refresh project references
      </Button>
      {result.waiting ? <p role="status">Inspecting project references…</p> : null}
      {result._tag === "Failure" ? (
        <p role="alert">Could not inspect project references. Check the connection and refresh.</p>
      ) : null}
      {page && !result.waiting && result._tag !== "Failure" ? (
        <>
          <p>
            Inspected {page.inspectedProjects} projects on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </p>
          {page.projects.length === 0 ? (
            <p>No references in these projects. Continue to the next page if available.</p>
          ) : null}
          {page.projects.map((project) => (
            <section
              key={project.id}
              aria-label={`References in ${project.title}`}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <p className="font-medium">{project.title}</p>
              {project.profiles.map((profile) => (
                <p key={profile.id}>
                  {profile.label} · {profile.state}
                  {profile.isDefault ? " · Default" : ""} · Requirements:{" "}
                  {profile.requirements.join(", ")}
                </p>
              ))}
              {project.grants.map((grant) => (
                <p key={grant.id}>
                  {grant.label} · {grant.principalKind} grant · {grant.state}
                  {grant.expiresAt === null
                    ? ""
                    : ` · Expires ${new Date(grant.expiresAt).toLocaleString()}`}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openVaultProfiles({ environmentId, projectId: project.id, section: "profiles" })
                  }
                >
                  Review project profiles
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openVaultAccess({ environmentId, itemId })}
                >
                  Review grants
                </Button>
              </div>
            </section>
          ))}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!cursor || result.waiting}
          onClick={() => setCursor(null)}
        >
          First projects
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!page?.nextCursor || result.waiting || result._tag === "Failure"}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More projects
        </Button>
      </div>
    </div>
  );
}
