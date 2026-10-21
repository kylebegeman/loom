import {
  projectTemporaryResourceLabels,
  TEMPORARY_RESOURCES_EXPLANATION,
} from "@t3tools/client-runtime/fork";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { lanes } from "../project-lifecycle/state";
import { useLoomFeature } from "./libraryState";

export function LibraryTemporaryResources({
  copy,
  connected,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly connected: boolean;
}) {
  const supported = useLoomFeature(copy.environmentId, "project-lifecycle");
  const status = useEnvironmentQuery(
    connected && supported ? lanes.status({ environmentId: copy.environmentId, input: {} }) : null,
  );
  const labels = projectTemporaryResourceLabels({
    location: copy,
    status: status.data,
    connected,
    supported,
    failed: status.error !== null,
  });
  return (
    <View className="gap-2 rounded-xl bg-subtle p-3">
      <Text className="text-sm font-medium text-foreground">Temporary resources</Text>
      <Text className="text-xs text-foreground">{labels.usage}</Text>
      {labels.activity ? (
        <Text className="text-xs text-foreground-muted">{labels.activity}</Text>
      ) : null}
      <Text className="text-xs text-foreground-muted">{TEMPORARY_RESOURCES_EXPLANATION}</Text>
    </View>
  );
}
