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
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { library, useRefreshOnRefocus } from "./libraryState";

export function LibraryPreparationPlans({ project }: { readonly project: LibraryProject }) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  return (
    <View className="gap-3">
      <Text className="text-sm font-semibold text-foreground">Preparation on a computer</Text>
      <Text className="text-xs text-foreground-muted">
        Choose a computer to review preparation for the saved project revision.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {environments.map((entry) => (
          <Button
            key={entry.environmentId}
            label={entry.label}
            tone={selected === entry.environmentId ? "primary" : "text"}
            onPress={() => setSelected(entry.environmentId)}
          />
        ))}
      </View>
      {environments.length === 0 ? (
        <Text className="text-xs text-foreground-muted">
          Connect a computer to review preparation.
        </Text>
      ) : null}
      {selected ? (
        <LibraryPreparationPlan
          key={`${project.id}:${project.revision}:${selected}`}
          project={project}
          environmentId={selected}
          expanded
        />
      ) : null}
    </View>
  );
}

export function LibraryPreparationPlan({
  environmentId,
  project,
  resourceIds,
  expanded = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly resourceIds?: readonly string[];
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
    <View className="gap-2">
      <Button
        label={open ? "Hide preparation plan" : "Review preparation plan"}
        tone="text"
        onPress={() => setOpen(!open)}
      />
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
          <Text className="text-xs text-foreground-muted">
            This computer cannot provide a preparation plan yet. Connect it and update Loom to
            review its tools and proposed files.
          </Text>
        )
      ) : null}
    </View>
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
  readonly resourceIds?: readonly string[];
}) {
  const input = { project, environmentId, ...(resourceIds === undefined ? {} : { resourceIds }) };
  const query = useEnvironmentQuery(library.preparationPlan({ environmentId, input }));
  useRefreshOnRefocus(query.refresh);
  const plan =
    query.data && !query.error && libraryPreparationPlanMatches(query.data, input)
      ? query.data
      : null;
  return (
    <View
      accessibilityLabel="Preparation plan"
      className="gap-3 rounded-xl border border-border p-3"
    >
      <Text className="text-sm font-semibold text-foreground">
        {project.title} · Revision {project.revision} · {computerLabel}
      </Text>
      <Text className="text-xs text-foreground-muted">
        Read-only review. No project scripts run, tools install, credentials load or files change.
      </Text>
      <Button
        label={query.isPending ? "Checking..." : "Check again"}
        tone="text"
        disabled={query.isPending}
        onPress={query.refresh}
      />
      {query.error ? (
        <Text accessibilityRole="alert" className="text-xs text-warning-foreground">
          Could not read this computer's preparation plan. Reconnect and try again.
        </Text>
      ) : !plan ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          {query.isPending
            ? "Checking preparation..."
            : "The plan no longer matches this selection. Check again."}
        </Text>
      ) : (
        <>
          <Text className="text-sm font-semibold text-foreground">
            {libraryPreparationPlanSummary(plan)}
          </Text>
          <Text className="text-xs text-foreground-muted">
            Checked {new Date(plan.checkedAt).toLocaleString()}. Unknown checks are unverified.
          </Text>
          <View className="gap-1">
            <Text className="text-xs font-semibold text-foreground">Proposed files</Text>
            <Text selectable className="text-xs text-foreground-muted">
              {plan.placement.rootPath} · {plan.placement.reason}
            </Text>
            {plan.repositories.length ? (
              plan.repositories.map(({ resource, path }) => (
                <View key={resource.id} className="gap-1 py-1">
                  <Text className="text-xs text-foreground">
                    {resource.title} · {resource.relativePath} ·{" "}
                    {resource.defaultBranch ?? "Remote default branch"}
                  </Text>
                  <Text selectable className="font-mono text-xs text-foreground-muted">
                    {resource.remoteUrl ?? "Local files, no download source"}
                  </Text>
                  <Text selectable className="font-mono text-xs text-foreground-muted">
                    {path}
                  </Text>
                </View>
              ))
            ) : (
              <Text className="text-xs text-foreground-muted">No repositories selected.</Text>
            )}
            {plan.links.map((link) => (
              <Text key={link.id} selectable className="text-xs text-foreground-muted">
                {link.title}: {link.url} (link only)
              </Text>
            ))}
          </View>
          <View className="gap-1">
            <Text className="text-xs font-semibold text-foreground">Required tools</Text>
            {plan.checks.length ? (
              plan.checks.map((check) => (
                <Text
                  key={check.id}
                  className={
                    check.status === "ok"
                      ? "text-xs text-foreground-muted"
                      : "text-xs text-warning-foreground"
                  }
                >
                  {libraryToolCheckText(check)} · Required:{" "}
                  {check.minimumVersion ? `${check.minimumVersion}+` : "any version"} ·{" "}
                  {check.status}
                </Text>
              ))
            ) : (
              <Text className="text-xs text-foreground-muted">No tool requirements recorded.</Text>
            )}
          </View>
          <Text selectable className="text-xs text-foreground-muted">
            Named connections: {plan.connections.map(({ name }) => name).join(", ") || "none"}.{" "}
            {plan.connections.length ? "Availability and access unverified." : ""}
          </Text>
          <Text selectable className="text-xs text-foreground-muted">
            Secret names: {plan.secrets.map(({ name }) => name).join(", ") || "none"}.{" "}
            {plan.secrets.length ? "Presence unverified; values are never read." : ""}
          </Text>
          {plan.scripts.length ? (
            <View className="gap-2">
              <Text className="text-xs font-semibold text-foreground">Commands to review</Text>
              {plan.scripts.map((script) => (
                <View key={script.id} className="gap-1">
                  <Text className="text-xs text-foreground">
                    {script.name} · {libraryPreparationScriptPolicy(script)}
                  </Text>
                  <Text
                    selectable
                    className="rounded-lg bg-surface p-2 font-mono text-xs text-foreground-muted"
                  >
                    {script.command}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-xs text-foreground-muted">No setup scripts recorded.</Text>
          )}
          <View className="gap-1">
            <Text className="text-xs font-semibold text-foreground">Preparation actions</Text>
            {libraryPreparationPlanSteps(plan).map((step, index) => (
              <Text key={step} className="text-xs text-foreground-muted">
                {index + 1}. {step}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
