import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Linking, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { SITES_FEATURE, type LibraryProject } from "@t3tools/contracts/fork";
import {
  projectRelationships,
  projectServices,
} from "@t3tools/client-runtime/fork/project-ecosystem";
import { SITE_HEALTH_STATES, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { sites } from "../sites/state";
import { useSiteCheckClock } from "../sites/use-site-check-clock";
import { library } from "./libraryState";
import { LibraryNotice } from "./LibraryPage";

export function LibraryProjectEcosystem({
  project,
  authorityId,
  connected,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(authorityId);
  const catalog = useEnvironmentQuery(
    library.projects({ environmentId: authorityId, input: { includeArchived: true } }),
  );
  const sitesSupported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const inventory = useEnvironmentQuery(
    supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE)
      ? sites.snapshot({ environmentId: authorityId, input: {} })
      : null,
  );
  const snapshot = inventory.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  const relationships = projectRelationships(project, catalog.data ?? []);
  const services = snapshot
    ? projectServices([project.id, ...(project.dependencies ?? [])], snapshot, now)
    : [];
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection
      title="Ecosystem"
      footer="Project dependencies keep separate repositories and releases. Service observations do not grant access."
    >
      <View className="gap-3 p-4">
        <Text className="font-t3-medium text-sm text-foreground">Depends on</Text>
        {relationships.dependencies.length ? (
          relationships.dependencies.map(({ id, project: dependency }) =>
            dependency ? (
              <Button
                key={id}
                tone="text"
                label={`${dependency.title}${dependency.archived ? " (archived)" : ""}`}
                onPress={() => navigation.navigate("LibraryProject", { projectId: id })}
              />
            ) : (
              <Text key={id} className="text-sm text-foreground-muted">
                Project unavailable
              </Text>
            ),
          )
        ) : (
          <Text className="text-sm text-foreground-muted">No project dependencies declared.</Text>
        )}
        {relationships.dependents.length ? (
          <>
            <Text className="font-t3-medium text-sm text-foreground">Used by</Text>
            {relationships.dependents.map((entry) => (
              <Button
                key={entry.id}
                tone="text"
                label={entry.title}
                onPress={() => navigation.navigate("LibraryProject", { projectId: entry.id })}
              />
            ))}
          </>
        ) : null}
        <Text className="font-t3-medium text-sm text-foreground">Registered services</Text>
        {services.length ? (
          services.map(({ service, health }) => (
            <View key={service.id} className="gap-1">
              <Text className="text-sm text-foreground">
                {service.name}: {SITE_HEALTH_STATES[health.state].label}
              </Text>
              <Button
                label={service.url}
                tone="text"
                onPress={() => {
                  void Linking.openURL(service.url).catch(() =>
                    setError("Could not open this service."),
                  );
                }}
              />
            </View>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">
            {!sitesSupported
              ? "Update the Library to read service inventory."
              : inventory.error
                ? "Service inventory could not be read."
                : inventory.data?.configured === false
                  ? "Sites is not configured on this Library."
                  : inventory.isPending
                    ? "Reading service inventory..."
                    : "No services registered for these projects."}
          </Text>
        )}
        {snapshot ? (
          <Text className="text-xs text-foreground-muted">
            {connected ? "Observed" : "Saved observation"}: {snapshot.observedAt}
          </Text>
        ) : null}
        <Button label="Open Sites" tone="text" onPress={() => navigation.navigate("Sites")} />
        <Text className="text-xs text-foreground-muted">
          Library Loom version: {config?.environment.serverVersion ?? "not checked"}
        </Text>
        {error ? <LibraryNotice error={error} /> : null}
      </View>
    </SettingsSection>
  );
}
