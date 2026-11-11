import { useNavigation } from "@react-navigation/native";
import {
  libraryAccessRepairNotice,
  LIBRARY_ACCESS_REPAIR_RETURN_TEXT,
  type LibraryAccessRepairContext,
} from "@t3tools/client-runtime/fork";
import type { LibraryAccessRepair, LibraryError } from "@t3tools/contracts/fork";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { GitHubHostSetupSettings } from "../../features/settings/components/GitHubHostSetupSettings";
import { openSettings } from "../../features/settings/settings-navigation";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { VaultGitHubRepairSheet } from "../vault/GitHubSettingsSection";
import { LibrarySignInAgainButton } from "./LibrarySignInStatus";
import { useLibraryAuthorityId } from "./libraryState";

export function LibraryAccessBlock({
  accessRepair,
  accessContext,
  error,
  repair,
}: {
  readonly accessRepair?: LibraryAccessRepair | undefined;
  readonly accessContext?: LibraryAccessRepairContext | undefined;
  readonly error?: string | null | undefined;
  readonly repair?: LibraryError["repair"] | undefined;
}) {
  const navigation = useNavigation();
  const authorityEnvironmentId = useLibraryAuthorityId();
  const environmentId =
    accessRepair?.environmentId ?? accessContext?.environmentId ?? authorityEnvironmentId;
  const connection = useSavedRemoteConnection(environmentId);
  const [review, setReview] = useState<string | null>(null);
  const notice = libraryAccessRepairNotice(
    accessRepair,
    {
      authorityEnvironmentId,
      ...accessContext,
      environmentId,
      originalAccountEnvironmentId:
        accessContext?.originalAccountEnvironmentId ?? accessContext?.environmentId,
      computerLabel:
        connection?.environmentLabel ??
        (accessContext?.environmentId === environmentId ? accessContext.computerLabel : undefined),
      account: accessContext?.account ?? connection?.identity,
    },
    error,
  );
  const destination = notice?.destination;
  const repairKey = JSON.stringify(destination ?? repair);
  const reviewing = review === repairKey;
  function openRepair() {
    if (!destination) return;
    if (destination.kind === "vault-github") {
      setReview(repairKey);
      return;
    }
    if (destination.kind === "connection") {
      if (destination.environmentId)
        openSettings(navigation, "SettingsEnvironmentDetail", {
          environmentId: destination.environmentId,
        });
      else navigation.navigate("Connections");
      return;
    }
  }
  if (repair && !notice)
    return (
      <View className="gap-2">
        <Text className="text-sm text-foreground-muted">
          Set up host GitHub login on {repair.label}
          {repair.repository ? ` for ${repair.repository}` : ""}.{" "}
          {LIBRARY_ACCESS_REPAIR_RETURN_TEXT}
        </Text>
        <Button
          label={`Set up GitHub on ${repair.label}`}
          tone="secondary"
          onPress={() => setReview(repairKey)}
        />
        {reviewing ? (
          <Sheet title={`GitHub on ${repair.label}`} onClose={() => setReview(null)}>
            <GitHubHostSetupSettings environmentId={repair.environmentId} label={repair.label} />
          </Sheet>
        ) : null}
      </View>
    );
  if (!notice) return null;
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="text-sm font-semibold">
        {notice.title}
      </Text>
      <Text className="text-sm text-foreground-muted">{notice.description}</Text>
      <Text className="text-xs text-foreground-muted">{notice.afterReturn}</Text>
      {destination?.kind === "library-sign-in" || destination?.kind === "computer-sign-in" ? (
        <LibrarySignInAgainButton
          environmentId={destination.environmentId}
          expectedIdentity={notice.expectedIdentity ?? undefined}
          kind={destination.kind}
          label={notice.actionLabel}
        />
      ) : (
        <Button label={notice.actionLabel} tone="secondary" onPress={openRepair} />
      )}
      {reviewing && destination?.kind === "vault-github" && destination.environmentId ? (
        <VaultGitHubRepairSheet
          environmentId={destination.environmentId}
          target={destination}
          onClose={() => setReview(null)}
        />
      ) : null}
    </View>
  );
}
