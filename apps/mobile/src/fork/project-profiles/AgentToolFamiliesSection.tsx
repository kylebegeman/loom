import { useState } from "react";
import { View } from "react-native";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  AGENT_TOOL_FAMILIES,
  AGENT_TOOL_FAMILIES_FEATURE,
  DEFAULT_AGENT_TOOL_FAMILIES,
  type AgentToolFamily,
  type AgentToolFamilies,
  type ProjectProfile,
} from "@t3tools/contracts/fork";
import { createProjectProfilesAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsRow } from "../../features/settings/components/SettingsRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";

const profiles = createProjectProfilesAtoms(connectionAtomRuntime);
const labels = { hardware: "Hardware", reach: "Reach", sites: "Sites" };
const choices = { auto: "Automatic", always: "Always", never: "Never" };

export function AgentToolFamiliesSection({
  environmentId,
  projectId,
  computerLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly computerLabel: string;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const supported = supportsLoomFeature(
    config?.environment.capabilities,
    AGENT_TOOL_FAMILIES_FEATURE,
  );
  const query = useEnvironmentQuery(
    supported ? profiles.profile({ environmentId, input: { projectId } }) : null,
  );
  const allowed = useAtomValue(profiles.update.permissionAtom(environmentId));
  const update = useAtomCommand(profiles.update, { reportFailure: false });
  const [saved, setSaved] = useState<{
    source: ProjectProfile | null;
    profile: ProjectProfile;
  } | null>(null);
  const profile = saved && saved.source === query.data ? saved.profile : query.data;
  const [choosing, setChoosing] = useState<AgentToolFamily | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;
  const preferences = profile?.agentToolFamilies ?? DEFAULT_AGENT_TOOL_FAMILIES;
  const save = async (family: AgentToolFamily, choice: AgentToolFamilies[AgentToolFamily]) => {
    if (!profile || !allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await update({
        environmentId,
        input: { projectId, patch: { agentToolFamilies: { ...preferences, [family]: choice } } },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setSaved({ source: query.data, profile: result.value });
      setChoosing(null);
      query.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save agent tools. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={`Tools for agents · ${computerLabel}`}
      footer="Applies to the next agent session. Automatic shows Hardware for board or CAD projects, Reach when your Library has a Reach zone, and Sites when the project links a site."
    >
      {!profile ? (
        <View className="gap-2 p-4">
          <Text>{query.error ?? "Loading agent tools..."}</Text>
          {query.error ? <Button label="Retry" onPress={query.refresh} /> : null}
        </View>
      ) : (
        AGENT_TOOL_FAMILIES.map((family) => (
          <SettingsRow
            key={family}
            icon="gearshape"
            label={labels[family]}
            value={choices[preferences[family]]}
            disabled={!allowed || busy}
            onPress={() => setChoosing(family)}
          />
        ))
      )}
      {error && !choosing ? (
        <Text accessibilityRole="alert" className="px-4 py-2 text-danger">
          {error}
        </Text>
      ) : null}
      {choosing ? (
        <Sheet
          title={`${labels[choosing]} tools for agents`}
          dismissible={!busy}
          onClose={() => {
            if (!busy) setChoosing(null);
          }}
        >
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="py-4"
          >
            {error ? (
              <Text accessibilityRole="alert" className="px-4 py-2 text-danger">
                {error}
              </Text>
            ) : null}
            {(["auto", "always", "never"] as const).map((choice, index) => (
              <SelectionRow
                key={choice}
                title={choices[choice]}
                selected={preferences[choosing] === choice}
                disabled={busy}
                isFirst={index === 0}
                isLast={index === 2}
                onPress={() => void save(choosing, choice)}
              />
            ))}
          </ScreenScrollView>
        </Sheet>
      ) : null}
    </SettingsSection>
  );
}
