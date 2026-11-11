import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PREPARATION_PLAN_FEATURE, type LibraryProject } from "@t3tools/contracts/fork";
import {
  libraryPreparationPlanMatches,
  libraryPreparationPlanSteps,
  libraryPreparationPlanSummary,
  libraryPreparationScriptPolicy,
  libraryToolCheckText,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary } from "./state";

export function ProjectPreparationPlans({ project }: { readonly project: LibraryProject }) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Review what this project needs on a computer before preparing its files.
      </p>
      <Menu>
        <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
          {environments.find((entry) => entry.environmentId === selected)?.label ??
            "Choose a computer"}
        </MenuTrigger>
        <MenuPopup>
          {environments.map((entry) => (
            <MenuItem key={entry.environmentId} onClick={() => setSelected(entry.environmentId)}>
              {entry.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      {environments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Connect a computer to review preparation.</p>
      ) : null}
      {selected ? (
        <ProjectPreparationPlan
          key={`${project.id}:${project.revision}:${selected}`}
          project={project}
          environmentId={selected}
          expanded
        />
      ) : null}
    </div>
  );
}

export function ProjectPreparationPlan({
  environmentId,
  project,
  resourceIds,
  expanded = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly resourceIds?: readonly string[] | undefined;
  readonly expanded?: boolean;
}) {
  const { environments } = useEnvironments();
  const computer = environments.find((entry) => entry.environmentId === environmentId);
  const supported = supportsLoomFeature(
    computer?.serverConfig?.environment.capabilities,
    LIBRARY_PREPARATION_PLAN_FEATURE,
  );
  const [open, setOpen] = useState(expanded);
  return (
    <div className="space-y-2">
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Hide preparation plan" : "Review preparation plan"}
      </Button>
      {open ? (
        supported ? (
          <PreparationPlanReview
            key={`${project.id}:${project.revision}:${environmentId}`}
            project={project}
            environmentId={environmentId}
            computerLabel={computer?.label ?? environmentId}
            resourceIds={resourceIds}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            This computer cannot provide a preparation plan yet. Connect it and update Loom to
            review its tools and proposed files.
          </p>
        )
      ) : null}
    </div>
  );
}

function PreparationPlanReview({
  environmentId,
  project,
  computerLabel,
  resourceIds,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly computerLabel: string;
  readonly resourceIds?: readonly string[] | undefined;
}) {
  const input = { project, environmentId, ...(resourceIds === undefined ? {} : { resourceIds }) };
  const query = useEnvironmentQuery(projectLibrary.preparationPlan({ environmentId, input }));
  const plan =
    query.data && !query.error && libraryPreparationPlanMatches(query.data, input)
      ? query.data
      : null;
  return (
    <section
      aria-label="Preparation plan"
      className="space-y-3 rounded-xl border border-border p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {project.title} · Revision {project.revision} · {computerLabel}
        </p>
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={query.isPending}
          onClick={query.refresh}
        >
          {query.isPending ? "Checking..." : "Check again"}
        </Button>
      </div>
      <p className="text-muted-foreground">
        Read-only review. No project scripts run, tools install, credentials load or files change.
      </p>
      {query.error ? (
        <p role="alert" className="text-warning-foreground">
          Could not read this computer's preparation plan. Reconnect and try again.
        </p>
      ) : !plan ? (
        <p role="status" className="text-muted-foreground">
          {query.isPending
            ? "Checking preparation..."
            : "The plan no longer matches this selection. Check again."}
        </p>
      ) : (
        <>
          <p className="font-medium">{libraryPreparationPlanSummary(plan)}</p>
          <p className="text-muted-foreground">
            Checked {new Date(plan.checkedAt).toLocaleString()}. Unknown checks are unverified.
          </p>
          <div className="space-y-1">
            <p className="font-medium">Proposed files</p>
            <p className="wrap-anywhere text-muted-foreground">
              {plan.placement.rootPath} · {plan.placement.reason}
            </p>
            {plan.repositories.length ? (
              <ul className="space-y-2">
                {plan.repositories.map(({ resource, path }) => (
                  <li key={resource.id} className="space-y-0.5">
                    <p>
                      {resource.title} · {resource.relativePath} ·{" "}
                      {resource.defaultBranch ?? "Remote default branch"}
                    </p>
                    <p className="wrap-anywhere font-mono text-muted-foreground">
                      {resource.remoteUrl ?? "Local files, no download source"}
                    </p>
                    <p className="wrap-anywhere font-mono text-muted-foreground">{path}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No repositories selected.</p>
            )}
            {plan.links.map((link) => (
              <p key={link.id} className="wrap-anywhere text-muted-foreground">
                {link.title}: {link.url} (link only)
              </p>
            ))}
          </div>
          <div className="space-y-1">
            <p className="font-medium">Required tools</p>
            {plan.checks.length ? (
              <ul className="space-y-1">
                {plan.checks.map((check) => (
                  <li
                    key={check.id}
                    className={
                      check.status === "ok" ? "text-muted-foreground" : "text-warning-foreground"
                    }
                  >
                    {libraryToolCheckText(check)} · Required:{" "}
                    {check.minimumVersion ? `${check.minimumVersion}+` : "any version"} ·{" "}
                    {check.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No tool requirements recorded.</p>
            )}
          </div>
          <p className="wrap-anywhere text-muted-foreground">
            Named connections: {plan.connections.map(({ name }) => name).join(", ") || "none"}.{" "}
            {plan.connections.length ? "Availability and access unverified." : ""}
          </p>
          <p className="wrap-anywhere text-muted-foreground">
            Secret names: {plan.secrets.map(({ name }) => name).join(", ") || "none"}.{" "}
            {plan.secrets.length ? "Presence unverified; values are never read." : ""}
          </p>
          {plan.scripts.length ? (
            <div className="space-y-2">
              <p className="font-medium">Commands to review</p>
              {plan.scripts.map((script) => (
                <div key={script.id} className="space-y-1">
                  <p>
                    {script.name} · {libraryPreparationScriptPolicy(script)}
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-mono wrap-anywhere">
                    {script.command}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No setup scripts recorded.</p>
          )}
          <div className="space-y-1">
            <p className="font-medium">Preparation actions</p>
            <ol className="list-decimal space-y-1 ps-4 text-muted-foreground">
              {libraryPreparationPlanSteps(plan).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
