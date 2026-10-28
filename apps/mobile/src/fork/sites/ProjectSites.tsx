import { useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { sites } from "./state";
import { SiteStateDot, siteHost } from "./SiteHealth";
import { useSiteCheckClock } from "./use-site-check-clock";

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
  const snapshot = query.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  if (!supported) return null;
  const linked = snapshot?.sites.filter((site) => site.projectIds?.includes(projectId)) ?? [];
  return (
    <SettingsSection title="Sites">
      {query.error ? (
        <Text accessibilityRole="alert" className="px-4 pt-4 text-sm text-danger-foreground">
          {query.error}
        </Text>
      ) : null}
      {query.isPending && !query.data ? (
        <Text className="p-4 text-sm text-foreground-muted">Loading sites…</Text>
      ) : null}
      {linked.length && snapshot ? (
        <View>
          {linked.map((site, index) => {
            const health = SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state];
            return (
              <Pressable
                key={site.id}
                accessibilityRole="button"
                accessibilityLabel={`${site.name}, ${health.label}`}
                onPress={() => navigation.navigate("Sites", { siteId: site.id })}
                className={cn(
                  "min-h-12 flex-row items-center gap-3 px-4 py-2.5 active:opacity-70",
                  index > 0 && "border-t border-border-subtle",
                )}
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text numberOfLines={1} className="text-sm font-t3-medium text-foreground">
                    {site.name}
                  </Text>
                  <Text numberOfLines={1} className="font-mono text-2xs text-foreground-muted">
                    {siteHost(site.url)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <SiteStateDot tone={health.tone} />
                  <Text className="text-xs text-foreground-muted">{health.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : query.data ? (
        <Text className="p-4 text-sm text-foreground-muted">
          No sites linked. Register a site or link an existing one in Sites.
        </Text>
      ) : null}
      <Button label="Open Sites" tone="text" onPress={() => navigation.navigate("Sites")} />
    </SettingsSection>
  );
}
