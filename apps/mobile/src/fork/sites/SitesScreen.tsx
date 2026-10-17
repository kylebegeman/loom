import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Linking, View } from "react-native";
import {
  createSitesAtoms,
  siteCheckState,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { LibraryPage } from "../library/LibraryScreens";
import { useLibraryAuthority } from "../library/libraryState";

const sites = createSitesAtoms(connectionAtomRuntime);
export function SitesRouteScreen() {
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const [selection, select] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    authority.environmentId && supported
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const selected = snapshot?.sites.find((site) => site.id === selection) ?? snapshot?.sites[0];
  const analytics = useEnvironmentQuery(
    authority.environmentId && supported && selected
      ? sites.analytics({ environmentId: authority.environmentId, input: { siteId: selected.id } })
      : null,
  );
  const open = (url: string) => {
    setLinkError(null);
    void Linking.openURL(url).catch(() => setLinkError("Could not open your browser. Try again."));
  };
  return (
    <LibraryPage title="Sites" back={navigation.canGoBack()}>
      <Text className="text-foreground-muted">
        Your websites, their services, and the activity they receive.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <MaterialButton
          label="Manage sites"
          tone="primary"
          onPress={() => open("https://api.begam.in/admin#/sites")}
        />
        <MaterialButton
          label="Refresh"
          disabled={!authority.connected || !supported || query.isPending}
          onPress={() => {
            query.refresh();
            analytics.refresh();
          }}
        />
      </View>
      {linkError ? <Text accessibilityRole="alert">{linkError}</Text> : null}
      {!authority.environmentId ? (
        <MaterialButton
          label="Choose Library server"
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : !authority.connected ? (
        <Text>
          Library offline. Reconnect {authority.label} to refresh. Any saved results may be out of
          date.
        </Text>
      ) : !supported ? (
        <Text>Update your Library server to use Sites.</Text>
      ) : null}
      {query.isPending && !snapshot ? <Text>Loading sites…</Text> : null}
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {query.data?.configured === false ? (
        <Text>
          Connect the personal API to your Library server to view sites here. You can still manage
          sites directly.
        </Text>
      ) : null}
      {snapshot ? (
        <>
          <Text className="text-xs text-foreground-muted">
            Updated {new Date(snapshot.observedAt).toLocaleString()} through {authority.label}.
          </Text>
          {snapshot.sites.length === 0 ? (
            <Text>No sites registered yet. Add your first site in Manage sites.</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {snapshot.sites.map((site) => (
              <MaterialButton
                key={site.id}
                label={`${site.name}${!site.active ? " (paused)" : ""}`}
                tone={selected?.id === site.id ? "primary" : "secondary"}
                onPress={() => select(site.id)}
              />
            ))}
          </View>
          {selected ? (
            <View className="gap-5">
              <Text className="text-xl font-t3-semibold">{selected.name}</Text>
              <MaterialButton label="Visit site" tone="text" onPress={() => open(selected.url)} />
              <Text className="font-t3-semibold">Services and checks</Text>
              {selected.serviceIds.length === 0 ? (
                <Text>
                  No services linked. Link a service in Manage sites to monitor its endpoints.
                </Text>
              ) : null}
              {snapshot.services
                .filter((service) => selected.serviceIds.includes(service.id))
                .map((service) => {
                  const checks = snapshot.checks.filter((check) => check.service_id === service.id);
                  return (
                    <View key={service.id} className="gap-2 rounded-xl bg-surface p-4">
                      <Text className="font-t3-semibold">
                        {service.name}
                        {!service.active ? " (paused)" : ""}
                      </Text>
                      {checks.length === 0 ? <Text>No endpoint checks configured.</Text> : null}
                      {checks.map((check) => (
                        <View key={check.id} className="gap-1">
                          <Text>
                            {check.name}:{" "}
                            {siteCheckState(check, snapshot.staleAfterSeconds, Date.now())}
                          </Text>
                          <Text className="text-xs text-foreground-muted">
                            {check.last
                              ? `Checked ${new Date(check.last.checked_at).toLocaleString()}`
                              : "Awaiting first check"}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              <Text className="font-t3-semibold">Activity in the last 30 days</Text>
              {analytics.isPending && !analytics.data ? <Text>Loading activity…</Text> : null}
              {analytics.error ? <Text accessibilityRole="alert">{analytics.error}</Text> : null}
              {analytics.data ? (
                <>
                  <Text>
                    {analytics.data.pageviews} page views · {analytics.data.visitors} daily visitors
                    · {analytics.data.events} events
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    Visitors are counted per day.
                  </Text>
                  {analytics.data.pages.length === 0 ? (
                    <Text>No page views recorded for this site in this period.</Text>
                  ) : (
                    <Text className="font-t3-semibold">Top pages</Text>
                  )}
                  {analytics.data.pages.map((page) => (
                    <Text key={page.path}>
                      {page.path}: {page.pageviews}
                    </Text>
                  ))}
                  {analytics.data.named.length ? (
                    <Text className="font-t3-semibold">Clicks and events</Text>
                  ) : null}
                  {analytics.data.named.map((event) => (
                    <Text key={JSON.stringify([event.name, event.label, event.target])}>
                      {event.label || event.name}: {event.count}
                    </Text>
                  ))}
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      <MaterialButton
        label="Explore the personal API"
        tone="text"
        onPress={() => open("https://api.begam.in/v1/public/catalog")}
      />
    </LibraryPage>
  );
}
