import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  PROJECT_ECOSYSTEM_FEATURE,
  LIBRARY_PROJECT_DEPENDENCY_LIMIT,
  SITES_FEATURE,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import {
  projectRelationships,
  projectServices,
  projectComputerCapabilities,
} from "@t3tools/client-runtime/fork/project-ecosystem";
import { SITE_HEALTH_STATES, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { NetworkIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sites } from "../sites/state";
import { useSiteCheckClock } from "../sites/use-site-check-clock";
import {
  LibraryDialog,
  LibraryErrorNotice,
  LibraryPanel,
  LibraryStateBadge,
} from "./LibraryControls";
import { projectLibrary } from "./state";
import { useProjectUpdate } from "./useProjectUpdate";

export function ProjectEcosystem({
  project,
  authorityId,
  connected,
  onChanged,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly onChanged: () => void;
}) {
  const catalog = useEnvironmentQuery(
    projectLibrary.projects({ environmentId: authorityId, input: { includeArchived: true } }),
  );
  const { environments } = useEnvironments();
  const host = environments.find((entry) => entry.environmentId === authorityId);
  const capabilities = host?.serverConfig?.environment.capabilities;
  const supported = supportsLoomFeature(capabilities, PROJECT_ECOSYSTEM_FEATURE);
  const sitesSupported = supportsLoomFeature(capabilities, SITES_FEATURE);
  const inventory = useEnvironmentQuery(
    sitesSupported ? sites.snapshot({ environmentId: authorityId, input: {} }) : null,
  );
  const snapshot = inventory.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  const relationships = projectRelationships(project, catalog.data ?? []);
  const services = snapshot
    ? projectServices([project.id, ...(project.dependencies ?? [])], snapshot, now)
    : [];
  const update = useProjectUpdate({ project, authorityId, connected, onSaved: onChanged });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<readonly string[]>([]);
  const projectsById = new Map((catalog.data ?? []).map((entry) => [entry.id, entry]));
  const choices = [
    ...(catalog.data ?? []).filter((entry) => entry.id !== project.id),
    ...draft
      .filter((id) => !projectsById.has(id))
      .map((id) => ({
        id,
        title: `Project unavailable (${id})`,
        archived: false,
      })),
  ];
  const open = () => {
    if (!update.needsRecovery) setDraft(project.dependencies ?? []);
    update.clearError();
    setEditing(true);
  };
  return (
    <LibraryPanel
      title="Ecosystem"
      icon={NetworkIcon}
      action={
        <Button size="xs" variant="ghost" disabled={!supported || !update.canEdit} onClick={open}>
          Edit dependencies
        </Button>
      }
    >
      <div className="space-y-4 px-3.5 pb-4">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Depends on</h3>
          {catalog.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Reading project relationships...
            </p>
          ) : null}
          <LibraryErrorNotice
            error={catalog.error}
            onRetry={catalog.refresh}
            accessContext={{ environmentId: authorityId }}
          />
          {relationships.dependencies.length ? (
            <ul className="space-y-1.5">
              {relationships.dependencies.map(({ id, project: dependency }) => (
                <li key={id} className="flex items-center gap-2 text-sm">
                  {dependency ? (
                    <Link
                      to="/library/$projectId"
                      params={{ projectId: id }}
                      className="underline decoration-border underline-offset-4"
                    >
                      {dependency.title}
                    </Link>
                  ) : (
                    <span>Project unavailable</span>
                  )}
                  {dependency?.archived ? (
                    <LibraryStateBadge tone="neutral">Archived</LibraryStateBadge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No project dependencies declared.</p>
          )}
        </div>
        {relationships.dependents.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Used by</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {relationships.dependents.map((entry) => (
                <li key={entry.id}>
                  <Link
                    className="text-sm underline decoration-border underline-offset-4"
                    to="/library/$projectId"
                    params={{ projectId: entry.id }}
                  >
                    {entry.title}
                    {entry.archived ? " (archived)" : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Registered services</h3>
          <p className="text-xs text-muted-foreground">
            Linked in Sites to this project and its dependencies. Observations do not grant access
            or prove sign-in works.
          </p>
          {services.length ? (
            <ul className="space-y-3">
              {services.map(({ service, linkedProjectIds, health }) => (
                <li key={service.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <a
                      className="text-sm underline decoration-border underline-offset-4"
                      href={service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {service.name}
                    </a>
                    <p className="break-all text-xs text-muted-foreground">{service.url}</p>
                    <p className="text-xs text-muted-foreground">
                      {linkedProjectIds
                        .map((id) => projectsById.get(id)?.title ?? "Project unavailable")
                        .join(", ")}
                    </p>
                  </div>
                  <LibraryStateBadge tone={SITE_HEALTH_STATES[health.state].tone}>
                    {SITE_HEALTH_STATES[health.state].label}
                  </LibraryStateBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {!connected
                ? "Reconnect the Library to read service inventory."
                : capabilities === undefined
                  ? "Checking Library capabilities..."
                  : !sitesSupported
                    ? "Update the Library to read service inventory."
                    : inventory.error
                      ? "Service inventory could not be read."
                      : inventory.data?.configured === false
                        ? "Sites is not configured on this Library."
                        : inventory.isPending
                          ? "Reading service inventory..."
                          : "No services registered for these projects."}
            </p>
          )}
          {snapshot ? (
            <p className="text-xs text-muted-foreground">
              {connected ? "Observed" : "Saved observation"}: {snapshot.observedAt}
            </p>
          ) : null}
          <LibraryErrorNotice
            error={inventory.error}
            onRetry={inventory.refresh}
            accessContext={{ environmentId: authorityId }}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="ghost" render={<Link to="/sites" />}>
              Open Sites
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!connected || !sitesSupported || inventory.isPending}
              onClick={inventory.refresh}
            >
              Refresh services
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Library: {host?.label ?? "selected computer"}
          {host?.serverConfig
            ? `, Loom ${host.serverConfig.environment.serverVersion}`
            : ", version not checked"}
          .
          {connected && capabilities !== undefined && !supported
            ? " Update the Library to edit project dependencies."
            : ""}
        </p>
      </div>
      <details className="px-3.5 pb-4">
        <summary className="cursor-pointer text-sm font-medium">
          Computers and compatibility
        </summary>
        <ul className="mt-3 space-y-3">
          {environments
            .filter((entry) => entry.entry.enabled)
            .map((entry) => (
              <li key={entry.environmentId} className="space-y-1">
                <p className="text-sm font-medium">
                  {entry.label}
                  {entry.connection.phase !== "connected" ? " (offline)" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.connection.phase === "connected" ? "Reported" : "Last reported"} Loom
                  version: {entry.serverConfig?.environment.serverVersion ?? "not checked"}
                </p>
                <ul className="space-y-1">
                  {projectComputerCapabilities(
                    entry.serverConfig?.environment.capabilities.loomFeatures,
                  ).map((feature) => (
                    <li
                      key={feature.id}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span>{feature.label}</span>
                      <span className="text-muted-foreground">
                        {feature.supported === null
                          ? "Not checked"
                          : feature.supported
                            ? "Supported"
                            : "Needs update"}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Support describes the reported Loom version. Check the selected computer's current access
          and tools before preparing files.
        </p>
        <Button size="xs" variant="ghost" render={<Link to="/settings/connections" />}>
          Open computers
        </Button>
      </details>
      <LibraryDialog
        open={editing}
        onOpenChange={(open) => {
          if (!update.busy) setEditing(open);
        }}
        title="Project dependencies"
        description="Declare the other projects this one uses. Repositories and releases stay with their owning projects."
        actions={
          <>
            <Button variant="ghost" disabled={update.busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={update.busy || !update.canEdit}
              onClick={async () => {
                if (await update.save({ dependencies: draft })) setEditing(false);
              }}
            >
              {update.busy
                ? "Checking..."
                : update.needsRecovery
                  ? "Check result"
                  : "Save dependencies"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {draft.length} of {LIBRARY_PROJECT_DEPENDENCY_LIMIT} dependencies selected.
        </p>
        <div className="space-y-3">
          {choices.map((entry) => (
            <label key={entry.id} className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={draft.includes(entry.id)}
                disabled={
                  update.busy ||
                  update.needsRecovery ||
                  (!draft.includes(entry.id) &&
                    (entry.archived || draft.length >= LIBRARY_PROJECT_DEPENDENCY_LIMIT))
                }
                onCheckedChange={(checked) =>
                  setDraft((ids) => {
                    if (!checked) return ids.filter((id) => id !== entry.id);
                    return ids.includes(entry.id) || ids.length >= LIBRARY_PROJECT_DEPENDENCY_LIMIT
                      ? ids
                      : [...ids, entry.id];
                  })
                }
              />
              <span className="min-w-0 break-words">
                {entry.title}
                {entry.archived ? " (archived)" : ""}
              </span>
            </label>
          ))}
        </div>
        {!choices.length ? (
          <p role="status" className="text-sm text-muted-foreground">
            {catalog.isPending
              ? "Reading projects..."
              : catalog.error
                ? "Projects could not be read."
                : "No other projects in this Library."}
          </p>
        ) : null}
        <LibraryErrorNotice
          error={catalog.error}
          onRetry={catalog.refresh}
          accessContext={{ environmentId: authorityId }}
        />
        <LibraryErrorNotice error={update.error} accessContext={{ environmentId: authorityId }} />
      </LibraryDialog>
    </LibraryPanel>
  );
}
