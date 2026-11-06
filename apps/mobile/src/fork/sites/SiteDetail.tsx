import { useState, type ReactNode } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { RowPressable } from "../../components/ui/RowPressable";
import { SymbolView } from "../../components/ui/AppSymbol";
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
      className="size-12 items-center justify-center rounded-full bg-secondary"
    >
      <Text
        textRole="title"
        className="font-t3-bold text-secondary-foreground"
        style={{ opacity: loaded && !failed ? 0 : 1 }}
      >
        {site.name.trim().slice(0, 1).toLocaleUpperCase() || "W"}
      </Text>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ position: "absolute", width: 28, height: 28, borderRadius: 6 }}
          contentFit="contain"
          cachePolicy="memory"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

function DetailSection(props: {
  readonly title: string;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-4 border-t border-border pt-6">
      <View className="flex-row flex-wrap items-baseline justify-between gap-2">
        <Text accessibilityRole="header" textRole="headline" className="font-t3-bold">
          {props.title}
        </Text>
        {props.trailing}
      </View>
      {props.children}
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
    <View className="gap-7">
      <View className="gap-5 pb-1">
        <View className="flex-row items-start gap-3">
          <WebsiteIdentity key={site.url} site={site} />
          <View className="min-w-0 flex-1 gap-1">
            <Text accessibilityRole="header" textRole="title" className="font-t3-bold">
              {site.name}
            </Text>
            <Text textRole="body" className="text-foreground-muted">
              {siteHost(site.url)}
            </Text>
          </View>
        </View>
        <View className="gap-1.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <SiteStateDot tone={state.tone} />
            <Text textRole="body" className="font-t3-bold">
              {state.label}
            </Text>
            <Text textRole="footnote" className="text-foreground-muted">
              {health.total
                ? `${health.passing} of ${health.total} checks passing`
                : "No monitoring checks"}
            </Text>
          </View>
          {snapshot.observedAt ? (
            <Text textRole="footnote" className="text-foreground-muted">
              Updated {ago(snapshot.observedAt)}
            </Text>
          ) : null}
        </View>
        <View className="self-start">
          <Button
            label="Visit website"
            icon="safari"
            tone="primary"
            onPress={() => onVisit(site.url)}
          />
        </View>
      </View>

      <DetailSection
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
          <View className="items-start gap-2">
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
          <Text textRole="body" className="text-foreground-muted">
            Traffic is not available for this website yet.
          </Text>
        ) : null}
      </DetailSection>

      <DetailSection title="Monitoring">
        {services.length ? (
          services.map((service, index) => (
            <SiteServiceGroup
              key={service.id}
              service={service}
              separated={index > 0}
              inset={false}
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
          <View className="items-start gap-3">
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
      </DetailSection>

      {site.projectIds?.length ? (
        <DetailSection title="Linked projects">
          <View>
            {site.projectIds.map((id) => {
              const project = projects.get(id);
              return (
                <RowPressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !project }}
                  disabled={!project}
                  onPress={() => onOpenProject(id)}
                  className="min-h-12 flex-row items-center justify-between gap-3 border-b border-border-subtle py-3"
                >
                  <Text textRole="body" className="min-w-0 flex-1 font-t3-medium">
                    {project?.title ?? "Unavailable project"}
                  </Text>
                  <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
                </RowPressable>
              );
            })}
          </View>
        </DetailSection>
      ) : null}
    </View>
  );
}
