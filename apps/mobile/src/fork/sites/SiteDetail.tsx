import { Pressable, View } from "react-native";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import type { EnvironmentQueryView } from "../../state/query";
import { LibraryProjectTile } from "../library/libraryProjectColors";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import type { SiteEditTarget } from "./SiteEditor";
import { SiteServiceGroup, ago, siteHost } from "./SiteHealth";
import { SiteTraffic, SiteTrafficSkeleton } from "./SiteTraffic";

type Site = SitesSnapshot["sites"][number];

/** Hex alpha for the hero's globe tile, matching project tiles. */
const TILE_ALPHA = "24";

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
  /** The resolved color of the first project the site serves. */
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
        <View className="gap-4 p-4">
          <View className="flex-row items-start gap-4">
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className="size-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${color}${TILE_ALPHA}` }}
            >
              <SymbolView name="globe" size={26} tintColor={color} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text
                accessibilityRole="header"
                className="text-2xl font-t3-semibold text-foreground"
              >
                {site.name}
              </Text>
              <Text numberOfLines={1} className="font-mono text-xs text-foreground-muted">
                {siteHost(site.url)}
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
            <LibraryStateBadge tone={state.tone} label={state.label} />
            {health.total ? (
              <Text className="text-xs tabular-nums text-foreground-muted">
                {health.passing} of {health.total} checks passing
              </Text>
            ) : null}
            {snapshot.observedAt ? (
              <Text className="text-xs text-foreground-muted">
                Checked {ago(snapshot.observedAt)}
              </Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button label="Visit" icon="safari" onPress={() => onVisit(site.url)} />
            <Button
              label="Edit site"
              icon="pencil"
              disabled={!canManage}
              onPress={() => onEdit({ kind: "site", row: site })}
            />
          </View>
          {site.projectIds?.length ? (
            <View className="gap-2 border-t border-border-subtle pt-4">
              <Text className="text-xs text-foreground-muted">Serves</Text>
              <View className="flex-row flex-wrap gap-2">
                {site.projectIds.map((id) => {
                  const project = projects.get(id);
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open project ${project?.title ?? "Unavailable project"}`}
                      onPress={() => onOpenProject(id)}
                      className="max-w-full flex-row items-center gap-2 rounded-xl border border-border-subtle py-1 ps-1 pe-3 active:opacity-70"
                    >
                      <LibraryProjectTile project={project ?? { id, title: id }} />
                      <Text
                        numberOfLines={1}
                        className="shrink text-sm font-t3-medium text-foreground"
                      >
                        {project?.title ?? "Unavailable project"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <Text className="border-t border-border-subtle pt-4 text-xs text-warning-foreground">
              Not linked to a project yet. Edit the site to choose the projects it serves.
            </Text>
          )}
        </View>
      </SettingsSection>

      <SettingsSection
        title="Health"
        trailing={
          services.length ? (
            <Text className="text-xs tabular-nums text-foreground-muted">
              {services.length} {services.length === 1 ? "service" : "services"}
            </Text>
          ) : undefined
        }
      >
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
          <View className="gap-2 p-4">
            <Text className="text-sm text-foreground-muted">
              No services linked. Link the services this site runs on to watch their endpoints.
            </Text>
            <Button
              label="Link services"
              tone="text"
              disabled={!canManage}
              onPress={() => onEdit({ kind: "site", row: site })}
            />
          </View>
        )}
      </SettingsSection>

      <SettingsSection
        title="Traffic"
        trailing={
          analytics.data ? (
            <Text className="text-xs tabular-nums text-foreground-muted">
              Last {analytics.data.days} days
            </Text>
          ) : undefined
        }
      >
        {analytics.error ? (
          <View className="gap-1 p-4">
            <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
              {analytics.error}
            </Text>
            <Button label="Try again" tone="text" onPress={analytics.refresh} />
          </View>
        ) : null}
        {analytics.data ? (
          <SiteTraffic analytics={analytics.data} origins={site.origins} color={color} />
        ) : analytics.isPending ? (
          <SiteTrafficSkeleton />
        ) : null}
      </SettingsSection>
    </View>
  );
}
