import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { PROJECT_STORAGE_FEATURE, type ProjectStorageCategory } from "@t3tools/contracts/fork";
import {
  createProjectStorageAtoms,
  STORAGE_CATEGORY_LABELS,
  storageCategorySize,
  storageCategoryDetail,
  storageMeasuredAge,
  storageWebSettingsUrl,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { useNowMinuteMs } from "../../lib/clock";
import { Linking, View } from "react-native";
import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentServerConfigsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironments } from "../../state/environments";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { openSettings } from "../../features/settings/settings-navigation";

const storage = createProjectStorageAtoms(connectionAtomRuntime);

export function StorageBreakdown({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const supported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    PROJECT_STORAGE_FEATURE,
  );
  const allowed = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    connected && supported && allowed ? storage.report({ environmentId, input: {} }) : null,
  );
  const refresh = useAtomCommand(storage.refresh, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation();
  const now = useNowMinuteMs();
  const { environments } = useEnvironments();
  const displayUrl = environments.find(
    (environment) => environment.environmentId === environmentId,
  )?.displayUrl;
  const webUrl = storageWebSettingsUrl(displayUrl);
  const open = (kind: ProjectStorageCategory) => {
    const destination = storageWebSettingsUrl(displayUrl, kind);
    if (kind === "worktrees" || kind === "primary") navigation.navigate("ProjectStorageInventory");
    else if (kind === "library-copies") navigation.navigate("Library");
    else if (kind === "database") openSettings(navigation, "SettingsEnvironmentMaintenance");
    else if (destination !== null)
      void Linking.openURL(destination).catch(() =>
        setError("This computer's web app could not be opened."),
      );
  };
  const measure = () => {
    setBusy(true);
    setError(null);
    void refresh({ environmentId, input: { refresh: true } })
      .then((result) => {
        if (result._tag === "Failure") setError("Storage could not be refreshed. Try again.");
      })
      .catch(() => setError("Storage could not be refreshed. Try again."))
      .finally(() => setBusy(false));
  };
  if (!supported) return null;
  return (
    <SettingsSection title="Storage">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {query.data
            ? `Measured ${storageMeasuredAge(query.data.breakdown.measuredAt, now)}. Sizes estimate space occupied by these files.`
            : connected && allowed
              ? "Measuring storage…"
              : "Connect with read access to measure this computer."}
        </Text>
        <Button
          label={busy ? "Measuring…" : "Refresh storage"}
          disabled={!connected || !allowed || busy || query.isPending}
          onPress={() => void measure()}
        />
        {error || query.error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error ?? query.error}
          </Text>
        ) : null}
      </View>
      {query.data?.breakdown.categories.map((row) => {
        const web = row.kind === "lanes" || row.kind === "git-mirrors" || row.kind === "scratch";
        return (
          <ListActionRow
            key={row.kind}
            icon="internaldrive"
            label={STORAGE_CATEGORY_LABELS[row.kind]}
            detail={storageCategorySize(row)}
            description={`${storageCategoryDetail(row)}${web ? (webUrl === null ? ". Manage in Loom on this computer." : ". Opens this computer's web settings; sign-in may be needed.") : ""}`}
            disabled={web && webUrl === null}
            onPress={() => open(row.kind)}
          />
        );
      })}
    </SettingsSection>
  );
}
