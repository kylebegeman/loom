import { offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import { peerLinkHealth } from "@t3tools/client-runtime/state/peerLinks";
import { useFocusEffect } from "@react-navigation/native";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useCallback, useState } from "react";
import { AppState, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAccountLinksView } from "../../fork/connections/accountLinksState"; // fork: account-links
import { useEnvironmentServerConfig } from "../../state/entities";
import { peerLinkEnvironment } from "../../state/peerLinks";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../settings/components/SettingsSection";

export function LinkedEnvironmentsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const canRead = useEnvironmentScope(props.environmentId, AuthAccessReadScope);
  const account = useAccountLinksView(props.environmentId); // fork: account-links
  const supported = canRead && (offersLinkedEnvironments(config) || account.linksAccount); // fork: account-links
  const links = useEnvironmentQuery(
    supported ? peerLinkEnvironment.list({ environmentId: props.environmentId, input: {} }) : null,
  );
  const [nowMs, setNowMs] = useState(Date.now);
  // fork: account-links -- with the beta off, only the links Loom keeps for the account are listed.
  const listed = (links.data?.links ?? []).filter(
    (link) => account.offers || account.managed.has(link.environmentId),
  );
  const hasLinks = supported && listed.length > 0; // fork: account-links
  useFocusEffect(
    useCallback(() => {
      if (!hasLinks) return;
      const updateNow = () => setNowMs(Date.now());
      updateNow();
      const timer = setInterval(updateNow, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") updateNow();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [hasLinks]),
  );
  if (!supported || links.error || listed.length === 0) return null; // fork: account-links
  const now = DateTime.makeUnsafe(nowMs);
  return (
    <View className="mt-5 gap-3">
      <SettingsSection title={`Linked from ${props.environmentLabel}`}>
        {listed.map((link) => {
          const health = peerLinkHealth(link, now);
          // fork: account-links -- an account link renews by itself, so its expiry is not news.
          const managed = account.managed.has(link.environmentId);
          const status =
            managed && health.kind === "reachable"
              ? "Managed by your account"
              : health.kind === "expired"
                ? managed
                  ? "Expired. Loom renews it on its next check."
                  : "Expired. Link it again with a new pairing code."
                : health.kind === "unreachable"
                  ? (health.detail ?? "Not answering right now.")
                  : health.kind === "failing"
                    ? health.detail
                    : health.expiresInDays !== null
                      ? `Expires in ${health.expiresInDays} ${health.expiresInDays === 1 ? "day" : "days"}`
                      : "Reachable";
          return (
            <View key={link.environmentId} className="gap-0.5 p-4">
              <Text className="text-base font-t3-bold text-foreground">{link.label}</Text>
              <Text
                className={
                  health.kind === "reachable" && (health.expiresInDays === null || managed) // fork: account-links
                    ? "text-xs text-foreground-muted"
                    : "text-xs text-danger-foreground"
                }
                numberOfLines={2}
              >
                {status}
              </Text>
            </View>
          );
        })}
      </SettingsSection>
    </View>
  );
}
