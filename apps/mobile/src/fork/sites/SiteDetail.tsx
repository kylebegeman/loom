import { useState } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import type { EnvironmentQueryView } from "../../state/query";
import { siteFaviconUrl } from "../site-browser/site-browser-model";
import type { SiteEditTarget } from "./SiteEditor";
import { SiteServiceGroup, SiteStateDot, ago, siteHost } from "./SiteHealth";
import { SiteTraffic, SiteTrafficSkeleton } from "./SiteTraffic";

type Site = SitesSnapshot["sites"][number];

function WebsiteIdentity({ site }: { readonly site: Site }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const uri = siteFaviconUrl(site.url);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="size-16 items-center justify-center rounded-full bg-secondary"
    >
      <Text
        textRole="title"
        className="font-t3-semibold text-secondary-foreground"
        style={{ opacity: loaded && !failed ? 0 : 1 }}
      >
        {site.name.trim().slice(0, 1).toLocaleUpperCase() || "W"}
      </Text>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ position: "absolute", width: 32, height: 32, borderRadius: 6 }}
          contentFit="contain"
          cachePolicy="memory"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

export function SiteDetail({
  site,
  snapshot,
  now,
  color,
  projects,
  analytics,
  canManage,
  onEdit,
  onVisit,
  onOpenProject,
}: {
  readonly site: Site;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly color: string;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
  readonly canManage: boolean;
  readonly onEdit: (target: SiteEditTarget) => void;
  readonly onVisit: (url: string) => void;
  readonly onOpenProject: (projectId: string) => void;
}) {
  const health = siteHealth(site, snapshot, now);
  const state = SITE_HEALTH_STATES[health.state];
  const services = snapshot.services.filter((service) => site.serviceIds.includes(service.id));
  return (
    <View className="gap-6">
      <SettingsSection>
        <View className="gap-5 p-5">
          <View className="flex-row items-center gap-4">
            <WebsiteIdentity key={site.url} site={site} />
            <View className="min-w-0 flex-1 gap-1.5">
              <Text
                accessibilityRole="header"
                textRole="title"
                className="font-t3-semibold text-foreground"
              >
                {site.name}
              </Text>
              <Text textRole="body" className="text-foreground-muted">
                {siteHost(site.url)}
              </Text>
            </View>
          </View>
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <SiteStateDot tone={state.tone} />
              <Text textRole="body" className="font-t3-medium text-foreground">
                {state.label}
              </Text>
            </View>
            <Text textRole="footnote" className="text-foreground-muted">
              {health.total
                ? `${health.passing} of ${health.total} checks passing`
                : "No monitoring checks"}
              {snapshot.observedAt ? ` · Updated ${ago(snapshot.observedAt)}` : ""}
            </Text>
          </View>
          <Button
            label="Visit website"
            icon="safari"
            tone="primary"
            onPress={() => onVisit(site.url)}
          />
        </View>
      </SettingsSection>

      <SettingsSection title="Monitoring">
        {services.length ? (
          services.map((service, index) => (
            <SiteServiceGroup
              key={service.id}
              service={service}
              separated={index > 0}
              checks={snapshot.checks.filter((check) => check.service_id === service.id)}
              staleAfterSeconds={snapshot.staleAfterSeconds}
              now={now}
              canManage={canManage}
              onEditService={() => onEdit({ kind: "service", row: service })}
              onAddCheck={() => onEdit({ kind: "check", serviceId: service.id })}
              onEditCheck={(check) => onEdit({ kind: "check", row: check })}
            />
          ))
        ) : (
          <View className="gap-3 p-5">
            <Text textRole="body" className="text-foreground-muted">
              No monitoring services are linked to this website.
            </Text>
            {canManage ? (
              <Button
                label="Link services"
                tone="text"
                onPress={() => onEdit({ kind: "site", row: site })}
              />
            ) : null}
          </View>
        )}
      </SettingsSection>

      <SettingsSection
        title="Traffic"
        trailing={
          analytics.data ? (
            <Text textRole="footnote" className="text-foreground-muted">
              Last {analytics.data.days} days
            </Text>
          ) : undefined
        }
      >
        {analytics.error ? (
          <View className="gap-2 p-5">
            <Text accessibilityRole="alert" textRole="body" className="text-danger-foreground">
              {analytics.error}
            </Text>
            <Button label="Try again" tone="text" onPress={analytics.refresh} />
          </View>
        ) : null}
        {analytics.data ? (
          <SiteTraffic analytics={analytics.data} origins={site.origins} color={color} />
        ) : analytics.isPending ? (
          <SiteTrafficSkeleton />
        ) : !analytics.error ? (
          <Text textRole="body" className="p-5 text-foreground-muted">
            Traffic is not available for this website yet.
          </Text>
        ) : null}
      </SettingsSection>

      {site.projectIds?.length ? (
        <SettingsSection title="Linked projects">
          {site.projectIds.map((id) => {
            const project = projects.get(id);
            return (
              <ListRow
                key={id}
                label={project?.title ?? "Unavailable project"}
                disabled={!project}
                onPress={() => onOpenProject(id)}
              />
            );
          })}
        </SettingsSection>
      ) : null}
    </View>
  );
}
