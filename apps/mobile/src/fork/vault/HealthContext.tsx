import { VaultHealthRetained } from "./HealthRetained";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { AuthAccessWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import {
  createVaultHealthAtoms,
  supportsLoomFeature,
  vaultHealthCoverageMessages,
} from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { VaultProjectProfiles } from "./ProfileSettingsSection";
import { VaultAccessCheckSheet } from "./AccessSettingsSection";
const atoms = createVaultHealthAtoms(connectionAtomRuntime);
export function VaultHealthContext({
  environmentId,
  itemId,
  connected,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-health-context"))
    return <Text>Project references need a newer Vault server.</Text>;
  return <ContextPage environmentId={environmentId} itemId={itemId} connected={connected} />;
}
function ContextPage({
  environmentId,
  itemId,
  connected,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  connected: boolean;
}) {
  const [cursor, setCursor] = useState<ProjectId | null>(null),
    [reviewingProject, setReviewingProject] = useState<ProjectId | null>(null),
    [reviewingAccess, setReviewingAccess] = useState(false);
  const result = useEnvironmentQuery(
    connected ? atoms.context({ environmentId, input: { itemId, cursor } }) : null,
  );
  const page = result.data,
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  return (
    <View className="gap-3">
      <Text>
        Current profile and grant references do not prove working access. Inspect retained run
        selections separately below. External consumers are not discovered.
      </Text>
      <Button label="Refresh project references" disabled={!connected} onPress={result.refresh} />
      {result.isPending ? <Text>Inspecting project references…</Text> : null}
      {result.error ? (
        <Text accessibilityRole="alert">
          Could not inspect project references. Check the connection and refresh.
        </Text>
      ) : null}
      {page && !result.isPending && !result.error ? (
        <>
          <Text>
            Inspected {page.inspectedProjects} projects on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </Text>
          {vaultHealthCoverageMessages(page.coverage).map((message) => (
            <Text key={message}>{message}</Text>
          ))}
          {page.coverage && page.coverage.unattributedGrants > 0 ? (
            <Button
              label="Review unattributed grants"
              disabled={!connected}
              onPress={() => setReviewingAccess(true)}
            />
          ) : null}
          {page.projects.length === 0 ? (
            <Text>No references in these projects. Continue to the next page if available.</Text>
          ) : null}
          <VaultHealthRetained
            environmentId={environmentId}
            itemId={itemId}
            connected={connected}
            projects={page.scannedProjects ?? page.projects}
            onReview={setReviewingProject}
          />
          {page.projects.map((project) => (
            <View key={project.id} className="gap-2 rounded-lg border border-border p-3">
              <Text className="font-semibold">{project.title}</Text>
              {project.profiles.map((profile) => (
                <Text key={profile.id}>
                  {profile.label} · {profile.state}
                  {profile.isDefault ? " · Default" : ""} · Requirements:{" "}
                  {profile.requirements.join(", ")}
                </Text>
              ))}
              {project.grants.map((grant) => (
                <Text key={grant.id}>
                  {grant.label} · {grant.principalKind} grant · {grant.state}
                  {grant.expiresAt === null
                    ? ""
                    : ` · Expires ${new Date(grant.expiresAt).toLocaleString()}`}
                </Text>
              ))}
              <Button
                label="Review project profiles"
                disabled={!connected}
                onPress={() => setReviewingProject(project.id)}
              />
              <Button
                label="Review grants"
                disabled={!connected}
                onPress={() => setReviewingAccess(true)}
              />
            </View>
          ))}
        </>
      ) : null}
      <Button
        label="First projects"
        disabled={!cursor || result.isPending || !connected}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More projects"
        disabled={!page?.nextCursor || result.isPending || !!result.error || !connected}
        onPress={() => setCursor(page?.nextCursor ?? null)}
      />
      {reviewingProject ? (
        <Sheet title="Project profiles" onClose={() => setReviewingProject(null)}>
          <ScrollView contentContainerClassName="gap-3 p-4">
            <VaultProjectProfiles
              key={reviewingProject}
              environmentId={environmentId}
              initialProject={reviewingProject}
              connected={connected}
              canWrite={canWrite}
            />
          </ScrollView>
        </Sheet>
      ) : null}
      {reviewingAccess ? (
        <VaultAccessCheckSheet
          environmentId={environmentId}
          itemId={itemId}
          onClose={() => setReviewingAccess(false)}
        />
      ) : null}
    </View>
  );
}
