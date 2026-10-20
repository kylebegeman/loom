import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
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
const atoms = createVaultHealthAtoms(connectionAtomRuntime);
export function VaultHealthRetained({
  environmentId,
  itemId,
  connected,
  projects,
  onReview,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  connected: boolean;
  projects: ReadonlyArray<{ id: ProjectId; title: string }>;
  onReview: (projectId: ProjectId) => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const [projectId, setProjectId] = useState<ProjectId | null>(null),
    [choosing, setChoosing] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-health-retained"))
    return <Text>Retained selection discovery needs a newer Vault server.</Text>;
  return (
    <View className="gap-3">
      <Text className="font-semibold">Retained run selections</Text>
      <Text>
        Check a project on this page, including projects without current references. A retained
        selection records earlier use, not current access. Retired snapshots and consumers outside
        Loom may be unknown.
      </Text>
      <Button
        label={
          project
            ? `Retained selection project: ${project.title}`
            : "Choose retained selection project"
        }
        disabled={!connected}
        onPress={() => setChoosing(true)}
      />
      {choosing ? (
        <Sheet title="Retained selection project" onClose={() => setChoosing(false)}>
          <ScrollView contentContainerClassName="gap-3 p-4">
            {projects.length === 0 ? <Text>No projects on this page.</Text> : null}
            {projects.map((p) => (
              <Button
                key={p.id}
                label={p.title}
                onPress={() => {
                  setProjectId(p.id);
                  setChoosing(false);
                }}
              />
            ))}
          </ScrollView>
        </Sheet>
      ) : null}
      {project ? (
        <SelectionPage
          key={project.id}
          environmentId={environmentId}
          itemId={itemId}
          connected={connected}
          projectId={project.id}
          onReview={onReview}
        />
      ) : null}
    </View>
  );
}
function SelectionPage({
  environmentId,
  itemId,
  connected,
  projectId,
  onReview,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  connected: boolean;
  projectId: ProjectId;
  onReview: (projectId: ProjectId) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useEnvironmentQuery(
    connected ? atoms.retained({ environmentId, input: { itemId, projectId, cursor } }) : null,
  );
  const page = result.data;
  return (
    <View className="gap-3">
      <Button label="Refresh retained selections" disabled={!connected} onPress={result.refresh} />
      {result.isPending ? <Text>Inspecting retained selections…</Text> : null}
      {result.error ? (
        <Text accessibilityRole="alert">
          Could not inspect retained selections. Refresh and retry.
        </Text>
      ) : null}
      {page && !result.isPending && !result.error ? (
        <>
          <Text>
            Inspected {page.inspectedSelections} selections on this page, at{" "}
            {new Date(page.checkedAt).toLocaleString()}.
          </Text>
          {vaultHealthCoverageMessages(page.coverage).map((message) => (
            <Text key={message}>{message}</Text>
          ))}
          {page.unattributableSelections > 0 ? (
            <Text>
              {page.unattributableSelections} retired selections have no binding snapshot and cannot
              be attributed to an item.
            </Text>
          ) : null}
          {page.items.length === 0 ? (
            <Text>
              No matching retained selections on this page. Continue if more pages are available.
            </Text>
          ) : null}
          {page.items.map((pin) => (
            <View key={pin.id} className="gap-1 rounded-lg border border-border p-3">
              <Text>
                {pin.profileLabel} · Profile version {pin.profileVersion} · {pin.runState}
              </Text>
              <Text>
                Thread {pin.threadId} · Run {pin.runId}
              </Text>
              <Text>
                {pin.bindings.map((b) => `${b.name}: item version ${b.itemVersion}`).join(", ")}
              </Text>
              <Text>
                {pin.canRetire
                  ? "Stopped selection. Review it before retiring its current binding snapshot."
                  : "This selection cannot currently be retired."}
              </Text>
            </View>
          ))}
          <Button
            label="Review project run selections"
            disabled={!connected}
            onPress={() => onReview(projectId)}
          />
        </>
      ) : null}
      <Button
        label="First retained selections"
        disabled={!cursor || result.isPending || !connected}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More retained selections"
        disabled={!page?.nextCursor || result.isPending || !!result.error || !connected}
        onPress={() => setCursor(page?.nextCursor ?? null)}
      />
    </View>
  );
}
