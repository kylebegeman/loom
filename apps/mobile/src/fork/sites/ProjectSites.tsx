import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { sites } from "./state";
export function ProjectSites({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: EnvironmentId;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const query = useEnvironmentQuery(
    supported ? sites.snapshot({ environmentId, input: {} }) : null,
  );
  if (!supported) return null;
  const linked =
    query.data?.snapshot?.sites.filter((site) => site.projectIds?.includes(projectId)) ?? [];
  return (
    <View className="gap-2">
      <Text className="font-t3-semibold">Sites</Text>
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {query.isPending && !query.data ? <Text>Loading sites…</Text> : null}
      {linked.map((site) => (
        <Button
          key={site.id}
          label={`${site.name}${!site.active ? " (paused)" : ""}`}
          onPress={() => navigation.navigate("Sites", { siteId: site.id })}
        />
      ))}
      {query.data && !linked.length ? <Text>No sites linked to this project.</Text> : null}
      <Button label="Open Sites" onPress={() => navigation.navigate("Sites")} />
    </View>
  );
}
