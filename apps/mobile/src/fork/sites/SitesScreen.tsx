import { useSiteCheckClock } from "./use-site-check-clock";
import { useState } from "react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Linking, View } from "react-native";
import { siteCheckState, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { sites } from "./state";
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { LibraryPage } from "../library/LibraryScreens";
import { library, useLibraryAuthority } from "../library/libraryState";

export function SitesRouteScreen({ route }: StaticScreenProps<{ siteId?: string } | undefined>) {
  const authority = useLibraryAuthority();
  return <SitesScreen key={authority.environmentId} authority={authority} route={route} />;
}

// Keep drafts and pending actions bound to the Library where they started.
function SitesScreen({
  route,
  authority,
}: StaticScreenProps<{ siteId?: string } | undefined> & {
  authority: ReturnType<typeof useLibraryAuthority>;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const selection = route.params?.siteId;
  const select = (siteId: string) => navigation.navigate("Sites", { siteId });
  const [linkError, setLinkError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    authority.environmentId && supported
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  const selected = snapshot?.sites.find((site) => site.id === selection) ?? snapshot?.sites[0];
  const analytics = useEnvironmentQuery(
    authority.environmentId && supported && selected
      ? sites.analytics({ environmentId: authority.environmentId, input: { siteId: selected.id } })
      : null,
  );
  const manages = supportsLoomFeature(config?.environment.capabilities, SITES_MANAGEMENT_FEATURE);
  const allowed = useAtomValue(sites.saveSite.permissionAtom(authority.environmentId));
  const canManage = Boolean(
    manages && query.data?.managementConfigured && allowed && authority.connected,
  );
  const projects = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const [editing, setEditing] = useState<SiteEditTarget | null>(null);
  const [running, setRunning] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const runChecks = useAtomCommand(sites.runChecks, { reportFailure: false });
  const run = async () => {
    if (!authority.environmentId || !canManage || running) return;
    setRunning(true);
    setActionError(null);
    try {
      const result = await runChecks({ environmentId: authority.environmentId, input: {} });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      query.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not run checks.");
    } finally {
      setRunning(false);
    }
  };
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
        <Button
          label="Register site"
          tone="primary"
          disabled={!canManage || !snapshot}
          onPress={() => setEditing({ kind: "site" })}
        />
        <Button
          label="Refresh"
          disabled={!authority.connected || !supported || query.isPending}
          onPress={() => {
            query.refresh();
            analytics.refresh();
          }}
        />
        <Button
          label={running ? "Running checks…" : "Run checks now"}
          disabled={!canManage || !snapshot || running}
          onPress={() => void run()}
        />
      </View>
      {actionError ? <Text accessibilityRole="alert">{actionError}</Text> : null}
      {supported && query.data?.configured && !query.data.managementConfigured ? (
        <Text>
          {manages
            ? "Site management needs a manager connection on your Library server."
            : "Update your Library server to manage sites here."}
        </Text>
      ) : null}
      {linkError ? <Text accessibilityRole="alert">{linkError}</Text> : null}
      {!authority.environmentId ? (
        <Button
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
        <Text>Connect the personal API to your Library server to view sites here.</Text>
      ) : null}
      {snapshot ? (
        <>
          <Text className="text-xs text-foreground-muted">
            Updated {new Date(snapshot.observedAt).toLocaleString()} through {authority.label}.
          </Text>
          {snapshot.sites.length === 0 ? (
            <Text>
              No sites registered yet. Register your first site to connect it to a project.
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {snapshot.sites.map((site) => (
              <Button
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
              <Button
                label="Edit site"
                disabled={!canManage}
                onPress={() => setEditing({ kind: "site", row: selected })}
              />
              <Button label="Visit site" tone="text" onPress={() => open(selected.url)} />
              <Text className="font-t3-semibold">Projects</Text>
              {!selected.projectIds?.length ? (
                <Text>Link this existing site to at least one project in Edit site.</Text>
              ) : null}
              {selected.projectIds?.map((projectId) => (
                <Button
                  key={projectId}
                  label={projects.data?.find((p) => p.id === projectId)?.title ?? projectId}
                  onPress={() => navigation.navigate("LibraryProject", { projectId })}
                />
              ))}
              <Text className="font-t3-semibold">Services and checks</Text>
              {selected.serviceIds.length === 0 ? (
                <Text>
                  No services linked. Link a service in Edit site to monitor its endpoints.
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
                      <Button
                        label="Edit service"
                        disabled={!canManage}
                        onPress={() => setEditing({ kind: "service", row: service })}
                      />
                      <Button
                        label="Add check"
                        disabled={!canManage}
                        onPress={() => setEditing({ kind: "check", serviceId: service.id })}
                      />
                      {checks.length === 0 ? <Text>No endpoint checks configured.</Text> : null}
                      {checks.map((check) => (
                        <View key={check.id} className="gap-1">
                          <Button
                            label="Edit check"
                            disabled={!canManage}
                            onPress={() => setEditing({ kind: "check", row: check })}
                          />
                          <Text>
                            {check.name}: {siteCheckState(check, snapshot.staleAfterSeconds, now)}
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
      {snapshot ? (
        <View className="gap-3">
          <Text className="font-t3-semibold">Shared services</Text>
          <Button
            label="Register service"
            disabled={!canManage}
            onPress={() => setEditing({ kind: "service" })}
          />
          {snapshot.services.map((service) => (
            <View key={service.id} className="gap-2 rounded-xl bg-surface p-4">
              <Text>
                {service.name}
                {!service.active ? " (paused)" : ""}
              </Text>
              <Text>{service.url}</Text>
              <Button
                label="Edit service"
                disabled={!canManage}
                onPress={() => setEditing({ kind: "service", row: service })}
              />
              <Button
                label="Add check"
                disabled={!canManage}
                onPress={() => setEditing({ kind: "check", serviceId: service.id })}
              />
              {snapshot.checks
                .filter((c) => c.service_id === service.id)
                .map((check) => (
                  <Button
                    key={check.id}
                    label={`Edit ${check.name}`}
                    disabled={!canManage}
                    onPress={() => setEditing({ kind: "check", row: check })}
                  />
                ))}
            </View>
          ))}
        </View>
      ) : null}
      {snapshot && authority.environmentId && editing ? (
        <SiteEditor
          key={`${editing.kind}:${editing.row?.id ?? "new"}`}
          target={editing}
          snapshot={snapshot}
          environmentId={authority.environmentId}
          connected={canManage}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing.kind === "site") select(id);
            setEditing(null);
            query.refresh();
            analytics.refresh();
          }}
        />
      ) : null}
      <Button
        label="Explore the personal API"
        tone="text"
        onPress={() => open("https://api.begam.in/v1/public/catalog")}
      />
    </LibraryPage>
  );
}
